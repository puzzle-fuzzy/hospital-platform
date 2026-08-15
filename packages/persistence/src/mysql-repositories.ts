import { createHash } from "node:crypto";
import type {
	OutboxEvent,
	OutboxRepository,
	PatientRecord,
	PatientRelationship,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	PaymentQuoteRepository,
	UserIdentityRepository,
	IdentityUser,
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
} from "@hospital/domain";
import type { PaymentState } from "@hospital/contracts";
import type { WechatMiniProgramPayParams } from "@hospital/domain";
import { PersistenceNotConfiguredError } from "./errors";
import {
	createAesGcmSecretValueCipher,
	type SecretValueCipher,
} from "./prepay-cipher";
import type {
	Pool,
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2/promise";

/** MySQL claim lease，防止 worker 崩溃后事件永久停留在 claimed 状态。 */
const DEFAULT_OUTBOX_CLAIM_LEASE_MS = 60_000;

/** 将 mysql2 的多重 overload 收窄为 repository 需要的参数形状。 */
type QueryExecutor = {
	execute(
		sql: string,
		values?: readonly unknown[],
	): Promise<[unknown, readonly unknown[]]>;
};

type IdentityUserRow = RowDataPacket & {
	user_id: string;
	provider_subject: string;
	union_id: string | null;
};

type PatientRow = RowDataPacket & {
	patient_id: string;
	owner_user_id: string;
	display_name: string;
	relationship: string;
	card_number_masked: string;
	source: string;
};

type PaymentQuoteRow = RowDataPacket & {
	quote_id: string;
	owner_user_id: string;
	patient_id: string;
	total_fen: number | string;
	insurance_fen: number | string;
	cash_fen: number | string;
	expires_at: string;
	source: string;
};

type PaymentOrderRow = RowDataPacket & {
	order_id: string;
	owner_user_id: string;
	patient_id: string;
	idempotency_key: string;
	total_fen: number | string;
	insurance_fen: number | string;
	cash_fen: number | string;
	state: string;
	version: number;
	created_at: string;
	updated_at: string;
};

type PaymentPrepayAttemptRow = RowDataPacket & {
	attempt_id: string;
	owner_user_id: string;
	order_id: string;
	provider: string;
	idempotency_key: string;
	status: string;
	version: number;
	query_attempts: number;
	last_queried_at: string | null;
	next_query_at: string | null;
	prepay_id_hash: string | null;
	pay_params_ciphertext: string | null;
	provider_request_id: string | null;
	last_error_code: string | null;
	created_at: string;
	updated_at: string;
};

type WechatPaymentNotificationRow = RowDataPacket & {
	notification_id: string;
	event_type: string;
	order_id: string;
	trade_state: string;
	total_fen: number | string;
	provider_transaction_id: string;
	received_at: string;
};

type OutboxEventRow = RowDataPacket & {
	event_id: string;
	event_name: OutboxEvent["eventName"];
	aggregate_id: string;
	payload: string | Readonly<Record<string, unknown>>;
	occurred_at: string;
	available_at: string;
	attempts: number;
	claimed_until: string | null;
};

export type MySqlRepositories = {
	identityUsers: UserIdentityRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
	outbox: OutboxRepository;
};

async function execute<T extends RowDataPacket[] | ResultSetHeader>(
	client: Pool | PoolConnection,
	sql: string,
	values: readonly unknown[] = [],
): Promise<T> {
	const executor = client as unknown as QueryExecutor;
	const [rows] = await executor.execute(sql, values);
	return rows as T;
}

async function withTransaction<T>(
	pool: Pool,
	operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		const result = await operation(connection);
		await connection.commit();
		return result;
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
	}
}

function isDuplicateEntry(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ER_DUP_ENTRY"
	);
}

function safeFen(value: number | string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error("Persistence returned an invalid amount");
	}
	return parsed;
}

/**
 * MySQL DATETIME(3) 没有时区标记；领域层统一使用 ISO UTC，落库时在
 * persistence 边界转换成 UTC 的 DATETIME 字符串，避免把 `T`/`Z` 原样
 * 交给 MySQL 导致真实数据库拒绝写入。
 */
function mysqlDateTime(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error("Persistence received an invalid timestamp");
	}
	const pad = (part: number, length = 2) => String(part).padStart(length, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

const PAYMENT_STATES: readonly PaymentState[] = [
	"created",
	"authorized",
	"pre_settled",
	"insurance_submitted",
	"insurance_settled",
	"cash_pending",
	"cash_paid",
	"his_written_back",
	"awaiting_confirmation",
	"completed",
	"failed",
	"cancelled",
];

function paymentState(value: string): PaymentState {
	if (PAYMENT_STATES.includes(value as PaymentState)) {
		return value as PaymentState;
	}
	throw new Error("Persistence returned an unknown payment state");
}

const PATIENT_RELATIONSHIPS: readonly PatientRelationship[] = [
	"self",
	"spouse",
	"child",
	"parent",
	"other",
];

function patientRelationship(value: string): PatientRelationship {
	if (PATIENT_RELATIONSHIPS.includes(value as PatientRelationship)) {
		return value as PatientRelationship;
	}
	throw new Error("Persistence returned an unknown patient relationship");
}

function identityUser(row: IdentityUserRow): IdentityUser {
	return {
		userId: row.user_id,
		providerSubject: row.provider_subject,
		...(row.union_id ? { unionId: row.union_id } : {}),
	};
}

function patient(row: PatientRow): PatientRecord {
	if (row.source !== "hospital-his" && row.source !== "legacy-record") {
		throw new Error("Persistence returned an unknown patient source");
	}
	return {
		id: row.patient_id,
		ownerUserId: row.owner_user_id,
		displayName: row.display_name,
		relationship: patientRelationship(row.relationship),
		cardNumberMasked: row.card_number_masked,
		source: row.source,
	};
}

function paymentQuote(row: PaymentQuoteRow) {
	if (row.source !== "hospital-his" && row.source !== "fixture") {
		throw new Error("Persistence returned an unknown payment quote source");
	}
	return {
		quoteId: row.quote_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		amounts: {
			totalFen: safeFen(row.total_fen),
			insuranceFen: safeFen(row.insurance_fen),
			cashFen: safeFen(row.cash_fen),
		},
		expiresAt: row.expires_at,
		source: row.source,
	} as const;
}

function paymentOrder(row: PaymentOrderRow): PaymentOrder {
	return {
		orderId: row.order_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		idempotencyKey: row.idempotency_key,
		amounts: {
			totalFen: safeFen(row.total_fen),
			insuranceFen: safeFen(row.insurance_fen),
			cashFen: safeFen(row.cash_fen),
		},
		state: paymentState(row.state),
		version: row.version,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

const PREPAY_ATTEMPT_STATUSES: readonly PaymentPrepayAttempt["status"][] = [
	"pending",
	"succeeded",
	"unknown",
];

function paymentPrepayAttemptStatus(
	value: string,
): PaymentPrepayAttempt["status"] {
	if (
		PREPAY_ATTEMPT_STATUSES.includes(value as PaymentPrepayAttempt["status"])
	) {
		return value as PaymentPrepayAttempt["status"];
	}
	throw new Error("Persistence returned an unknown prepay attempt status");
}

function payParams(
	value: PaymentPrepayAttemptRow["pay_params_ciphertext"],
	cipher: SecretValueCipher,
): WechatMiniProgramPayParams | undefined {
	if (value === null) return undefined;
	const parsed = JSON.parse(cipher.open(value)) as unknown;
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		typeof (parsed as { appId?: unknown }).appId !== "string" ||
		typeof (parsed as { timeStamp?: unknown }).timeStamp !== "string" ||
		typeof (parsed as { nonceStr?: unknown }).nonceStr !== "string" ||
		typeof (parsed as { package?: unknown }).package !== "string" ||
		(parsed as { signType?: unknown }).signType !== "RSA" ||
		typeof (parsed as { paySign?: unknown }).paySign !== "string"
	) {
		throw new Error("Persistence returned invalid Wechat pay params");
	}
	return parsed as WechatMiniProgramPayParams;
}

function paymentPrepayAttempt(
	row: PaymentPrepayAttemptRow,
	cipher: SecretValueCipher,
): PaymentPrepayAttempt {
	if (row.provider !== "wechat-pay") {
		throw new Error("Persistence returned an unknown prepay provider");
	}
	const storedPayParams = payParams(row.pay_params_ciphertext, cipher);
	return {
		attemptId: row.attempt_id,
		ownerUserId: row.owner_user_id,
		orderId: row.order_id,
		provider: "wechat-pay",
		idempotencyKey: row.idempotency_key,
		status: paymentPrepayAttemptStatus(row.status),
		version: row.version,
		queryAttempts: row.query_attempts,
		...(row.last_queried_at ? { lastQueriedAt: row.last_queried_at } : {}),
		...(row.next_query_at ? { nextQueryAt: row.next_query_at } : {}),
		...(storedPayParams ? { payParams: storedPayParams } : {}),
		...(row.provider_request_id
			? { providerRequestId: row.provider_request_id }
			: {}),
		...(row.last_error_code ? { lastErrorCode: row.last_error_code } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function wechatPaymentNotification(
	row: WechatPaymentNotificationRow,
): WechatPaymentNotification {
	if (
		row.event_type !== "TRANSACTION.SUCCESS" ||
		row.trade_state !== "SUCCESS" ||
		!row.provider_transaction_id
	) {
		throw new Error("Persistence returned an invalid Wechat notification");
	}
	const totalFen = safeFen(row.total_fen);
	if (totalFen <= 0) {
		throw new Error(
			"Persistence returned an invalid Wechat notification amount",
		);
	}
	return {
		notificationId: row.notification_id,
		eventType: "TRANSACTION.SUCCESS",
		orderId: row.order_id,
		tradeState: "SUCCESS",
		totalFen,
		providerTransactionId: row.provider_transaction_id,
		receivedAt: row.received_at,
	};
}

function outboxEvent(row: OutboxEventRow): OutboxEvent {
	const payload =
		typeof row.payload === "string"
			? (JSON.parse(row.payload) as Readonly<Record<string, unknown>>)
			: row.payload;
	return {
		eventId: row.event_id,
		eventName: row.event_name,
		aggregateId: row.aggregate_id,
		payload,
		occurredAt: row.occurred_at,
		availableAt: row.available_at,
		attempts: row.attempts,
	};
}

function sameOrderIdentity(left: PaymentOrder, right: PaymentOrder): boolean {
	return (
		left.patientId === right.patientId &&
		left.amounts.totalFen === right.amounts.totalFen &&
		left.amounts.insuranceFen === right.amounts.insuranceFen &&
		left.amounts.cashFen === right.amounts.cashFen
	);
}

function insertOutboxSql(event: OutboxEvent): {
	sql: string;
	values: readonly unknown[];
} {
	return {
		sql: `
			INSERT INTO hp_outbox_events
				(event_id, event_name, aggregate_id, payload, occurred_at, available_at, attempts, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE event_id = event_id
		`,
		values: [
			event.eventId,
			event.eventName,
			event.aggregateId,
			JSON.stringify(event.payload),
			mysqlDateTime(event.occurredAt),
			mysqlDateTime(event.availableAt),
			event.attempts,
			mysqlDateTime(event.occurredAt),
		],
	};
}

/**
 * MySQL repository 实现。
 *
 * 订单写入和对应 outbox 事件在同一事务；并发幂等依赖数据库唯一键，
 * 版本更新依赖 affectedRows，不能退化成先读后写覆盖。
 */
export function createMySqlRepositories(
	pool: Pool,
	options: {
		outboxClaimLeaseMs?: number;
		/** 支付调起参数必须使用部署注入的 AES-GCM 密钥保护后再落库。 */
		prepayCipher?: SecretValueCipher;
		paymentDataEncryptionKey?: string;
	} = {},
): MySqlRepositories {
	const outboxClaimLeaseMs =
		options.outboxClaimLeaseMs ?? DEFAULT_OUTBOX_CLAIM_LEASE_MS;
	if (!Number.isSafeInteger(outboxClaimLeaseMs) || outboxClaimLeaseMs <= 0) {
		throw new Error("outboxClaimLeaseMs must be a positive safe integer");
	}
	const prepayCipher =
		options.prepayCipher ??
		(options.paymentDataEncryptionKey
			? createAesGcmSecretValueCipher(options.paymentDataEncryptionKey)
			: undefined);
	const requiredPrepayCipher = (): SecretValueCipher => {
		if (!prepayCipher) {
			throw new PersistenceNotConfiguredError("payment-prepay-attempts");
		}
		return prepayCipher;
	};

	const identityUsers: UserIdentityRepository = {
		async findOrCreateByWechat(input) {
			const existingRows = await execute<IdentityUserRow[]>(
				pool,
				"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE provider_subject = ? LIMIT 1",
				[input.providerSubject],
			);
			if (existingRows[0]) return identityUser(existingRows[0]);

			const timestamp = new Date();
			const created: IdentityUser = {
				userId: crypto.randomUUID(),
				providerSubject: input.providerSubject,
				...(input.unionId ? { unionId: input.unionId } : {}),
			};
			try {
				await execute<ResultSetHeader>(
					pool,
					"INSERT INTO hp_identity_users (user_id, provider_subject, union_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
					[
						created.userId,
						created.providerSubject,
						created.unionId ?? null,
						mysqlDateTime(timestamp),
						mysqlDateTime(timestamp),
					],
				);
				return created;
			} catch (error) {
				if (!isDuplicateEntry(error)) throw error;
				const racedRows = await execute<IdentityUserRow[]>(
					pool,
					"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE provider_subject = ? LIMIT 1",
					[input.providerSubject],
				);
				if (!racedRows[0]) throw error;
				return identityUser(racedRows[0]);
			}
		},
		async findByUserId(userId) {
			const rows = await execute<IdentityUserRow[]>(
				pool,
				"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE user_id = ? LIMIT 1",
				[userId],
			);
			return rows[0] ? identityUser(rows[0]) : undefined;
		},
	};

	const patients: PatientRepository = {
		async listByOwner(ownerUserId) {
			const rows = await execute<PatientRow[]>(
				pool,
				"SELECT patient_id, owner_user_id, display_name, relationship, card_number_masked, source FROM hp_patients WHERE owner_user_id = ? ORDER BY patient_id",
				[ownerUserId],
			);
			return rows.map(patient);
		},
	};

	const paymentQuotes: PaymentQuoteRepository = {
		async findByOwnerAndId(ownerUserId, quoteId) {
			const rows = await execute<PaymentQuoteRow[]>(
				pool,
				"SELECT quote_id, owner_user_id, patient_id, total_fen, insurance_fen, cash_fen, expires_at, source FROM hp_payment_quotes WHERE owner_user_id = ? AND quote_id = ? LIMIT 1",
				[ownerUserId, quoteId],
			);
			return rows[0] ? paymentQuote(rows[0]) : undefined;
		},
	};

	const paymentOrders: PaymentOrderRepository = {
		async findById(orderId) {
			const rows = await execute<PaymentOrderRow[]>(
				pool,
				"SELECT order_id, owner_user_id, patient_id, idempotency_key, total_fen, insurance_fen, cash_fen, state, version, created_at, updated_at FROM hp_payment_orders WHERE order_id = ? LIMIT 1",
				[orderId],
			);
			return rows[0] ? paymentOrder(rows[0]) : undefined;
		},
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			const rows = await execute<PaymentOrderRow[]>(
				pool,
				"SELECT order_id, owner_user_id, patient_id, idempotency_key, total_fen, insurance_fen, cash_fen, state, version, created_at, updated_at FROM hp_payment_orders WHERE owner_user_id = ? AND idempotency_key = ? LIMIT 1",
				[ownerUserId, idempotencyKey],
			);
			return rows[0] ? paymentOrder(rows[0]) : undefined;
		},
		async findByOwnerAndId(ownerUserId, orderId) {
			const rows = await execute<PaymentOrderRow[]>(
				pool,
				"SELECT order_id, owner_user_id, patient_id, idempotency_key, total_fen, insurance_fen, cash_fen, state, version, created_at, updated_at FROM hp_payment_orders WHERE owner_user_id = ? AND order_id = ? LIMIT 1",
				[ownerUserId, orderId],
			);
			return rows[0] ? paymentOrder(rows[0]) : undefined;
		},
		async insert(order, event) {
			try {
				await withTransaction(pool, async (connection) => {
					await execute<ResultSetHeader>(
						connection,
						"INSERT INTO hp_payment_orders (order_id, owner_user_id, patient_id, idempotency_key, total_fen, insurance_fen, cash_fen, state, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
						[
							order.orderId,
							order.ownerUserId,
							order.patientId,
							order.idempotencyKey,
							order.amounts.totalFen,
							order.amounts.insuranceFen,
							order.amounts.cashFen,
							order.state,
							order.version,
							mysqlDateTime(order.createdAt),
							mysqlDateTime(order.updatedAt),
						],
					);
					const outbox = insertOutboxSql(event);
					await execute<ResultSetHeader>(connection, outbox.sql, outbox.values);
				});
				return order;
			} catch (error) {
				if (!isDuplicateEntry(error)) throw error;
				const existing = await paymentOrders.findByOwnerAndIdempotencyKey(
					order.ownerUserId,
					order.idempotencyKey,
				);
				if (!existing) throw error;
				if (!sameOrderIdentity(existing, order)) {
					throw new PaymentIdempotencyConflictError();
				}
				return existing;
			}
		},
		async update(order, expectedVersion, event) {
			return withTransaction(pool, async (connection) => {
				const result = await execute<ResultSetHeader>(
					connection,
					"UPDATE hp_payment_orders SET state = ?, version = ?, updated_at = ? WHERE order_id = ? AND owner_user_id = ? AND version = ?",
					[
						order.state,
						order.version,
						mysqlDateTime(order.updatedAt),
						order.orderId,
						order.ownerUserId,
						expectedVersion,
					],
				);
				if (result.affectedRows !== 1) {
					throw new PaymentOrderVersionConflictError();
				}
				const outbox = insertOutboxSql(event);
				await execute<ResultSetHeader>(connection, outbox.sql, outbox.values);
				return order;
			});
		},
	};

	const paymentPrepayAttempts: PaymentPrepayAttemptRepository = {
		async findByOwnerOrderAndIdempotencyKey(
			ownerUserId,
			orderId,
			idempotencyKey,
		) {
			const cipher = requiredPrepayCipher();
			const rows = await execute<PaymentPrepayAttemptRow[]>(
				pool,
				"SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE owner_user_id = ? AND order_id = ? AND idempotency_key = ? LIMIT 1",
				[ownerUserId, orderId, idempotencyKey],
			);
			return rows[0] ? paymentPrepayAttempt(rows[0], cipher) : undefined;
		},
		async insert(attempt) {
			const cipher = requiredPrepayCipher();
			try {
				await execute<ResultSetHeader>(
					pool,
					"INSERT INTO hp_payment_prepay_attempts (attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
					[
						attempt.attemptId,
						attempt.ownerUserId,
						attempt.orderId,
						attempt.provider,
						attempt.idempotencyKey,
						attempt.status,
						attempt.version,
						attempt.queryAttempts,
						attempt.lastQueriedAt ? mysqlDateTime(attempt.lastQueriedAt) : null,
						attempt.nextQueryAt ? mysqlDateTime(attempt.nextQueryAt) : null,
						attempt.prepayId
							? createHash("sha256")
									.update(attempt.prepayId, "utf8")
									.digest("hex")
							: null,
						attempt.payParams
							? cipher.seal(JSON.stringify(attempt.payParams))
							: null,
						attempt.providerRequestId ?? null,
						attempt.lastErrorCode ?? null,
						mysqlDateTime(attempt.createdAt),
						mysqlDateTime(attempt.updatedAt),
					],
				);
				return attempt;
			} catch (error) {
				if (!isDuplicateEntry(error)) throw error;
				const existing =
					await paymentPrepayAttempts.findByOwnerOrderAndIdempotencyKey(
						attempt.ownerUserId,
						attempt.orderId,
						attempt.idempotencyKey,
					);
				if (!existing) throw error;
				return existing;
			}
		},
		async update(attempt, expectedVersion) {
			const cipher = requiredPrepayCipher();
			const result = await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_payment_prepay_attempts SET status = ?, version = ?, query_attempts = ?, last_queried_at = ?, next_query_at = ?, prepay_id_hash = ?, pay_params_ciphertext = ?, provider_request_id = ?, last_error_code = ?, updated_at = ? WHERE attempt_id = ? AND owner_user_id = ? AND version = ?",
				[
					attempt.status,
					attempt.version,
					attempt.queryAttempts,
					attempt.lastQueriedAt ? mysqlDateTime(attempt.lastQueriedAt) : null,
					attempt.nextQueryAt ? mysqlDateTime(attempt.nextQueryAt) : null,
					attempt.prepayId
						? createHash("sha256")
								.update(attempt.prepayId, "utf8")
								.digest("hex")
						: null,
					attempt.payParams
						? cipher.seal(JSON.stringify(attempt.payParams))
						: null,
					attempt.providerRequestId ?? null,
					attempt.lastErrorCode ?? null,
					mysqlDateTime(attempt.updatedAt),
					attempt.attemptId,
					attempt.ownerUserId,
					expectedVersion,
				],
			);
			if (result.affectedRows !== 1) {
				throw new PaymentPrepayAttemptVersionConflictError();
			}
			return attempt;
		},
		async listDueForQuery(now, limit) {
			const cipher = requiredPrepayCipher();
			if (!Number.isSafeInteger(limit) || limit <= 0) return [];
			const rows = await execute<PaymentPrepayAttemptRow[]>(
				pool,
				"SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE next_query_at IS NOT NULL AND next_query_at <= ? AND status IN (?, ?, ?) ORDER BY next_query_at, attempt_id LIMIT ?",
				[now, "pending", "succeeded", "unknown", limit],
			);
			return rows.map((row) => paymentPrepayAttempt(row, cipher));
		},
	};

	const wechatPaymentNotifications: WechatPaymentNotificationRepository = {
		async record(notification, event) {
			try {
				return await withTransaction(pool, async (connection) => {
					await execute<ResultSetHeader>(
						connection,
						"INSERT INTO hp_wechat_payment_notifications (notification_id, event_type, order_id, trade_state, total_fen, provider_transaction_id, received_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
						[
							notification.notificationId,
							notification.eventType,
							notification.orderId,
							notification.tradeState,
							notification.totalFen,
							notification.providerTransactionId,
							mysqlDateTime(notification.receivedAt),
							mysqlDateTime(notification.receivedAt),
						],
					);
					const outbox = insertOutboxSql(event);
					await execute<ResultSetHeader>(connection, outbox.sql, outbox.values);
					return { status: "inserted" as const, notification };
				});
			} catch (error) {
				if (!isDuplicateEntry(error)) throw error;
				const rows = await execute<WechatPaymentNotificationRow[]>(
					pool,
					"SELECT notification_id, event_type, order_id, trade_state, total_fen, provider_transaction_id, received_at FROM hp_wechat_payment_notifications WHERE notification_id = ? OR provider_transaction_id = ? LIMIT 1",
					[notification.notificationId, notification.providerTransactionId],
				);
				const existing = rows[0];
				if (!existing) throw error;
				return {
					status: "duplicate" as const,
					notification: wechatPaymentNotification(existing),
				};
			}
		},
	};

	const outbox: OutboxRepository = {
		async append(event) {
			const statement = insertOutboxSql(event);
			await execute<ResultSetHeader>(pool, statement.sql, statement.values);
		},
		async claimAvailable(now) {
			return withTransaction(pool, async (connection) => {
				const rows = await execute<OutboxEventRow[]>(
					connection,
					`SELECT event_id, event_name, aggregate_id, payload, occurred_at, available_at, attempts, claimed_until
					 FROM hp_outbox_events
					 WHERE processed_at IS NULL
					   AND available_at <= ?
					   AND (claimed_until IS NULL OR claimed_until <= ?)
					 ORDER BY available_at, event_id
					 LIMIT 1
					 FOR UPDATE SKIP LOCKED`,
					[now, now],
				);
				const row = rows[0];
				if (!row) return undefined;

				const claimedUntil = new Date(now.getTime() + outboxClaimLeaseMs);
				const result = await execute<ResultSetHeader>(
					connection,
					"UPDATE hp_outbox_events SET claimed_until = ? WHERE event_id = ? AND processed_at IS NULL",
					[mysqlDateTime(claimedUntil), row.event_id],
				);
				if (result.affectedRows !== 1) return undefined;

				return outboxEvent({
					...row,
					claimed_until: claimedUntil.toISOString(),
				});
			});
		},
		async markProcessed(eventId, processedAt) {
			await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_outbox_events SET processed_at = ?, claimed_until = NULL WHERE event_id = ? AND processed_at IS NULL",
				[mysqlDateTime(processedAt), eventId],
			);
		},
		async markRetry(eventId, nextAvailableAt, reason) {
			await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_outbox_events SET available_at = ?, attempts = attempts + 1, claimed_until = NULL, last_error = ? WHERE event_id = ? AND processed_at IS NULL",
				[mysqlDateTime(nextAvailableAt), reason.slice(0, 512), eventId],
			);
		},
	};

	return {
		identityUsers,
		patients,
		paymentOrders,
		paymentQuotes,
		paymentPrepayAttempts,
		wechatPaymentNotifications,
		outbox,
	};
}
