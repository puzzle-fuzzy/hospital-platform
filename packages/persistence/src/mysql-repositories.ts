import type {
	OutboxEvent,
	OutboxRepository,
	PatientRecord,
	PatientRelationship,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	PaymentQuoteRepository,
	UserIdentityRepository,
	IdentityUser,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
} from "@hospital/domain";
import type { PaymentState } from "@hospital/contracts";
import type {
	Pool,
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2/promise";

/** MySQL claim lease，防止 worker 崩溃后事件永久停留在 claimed 状态。 */
const OUTBOX_CLAIM_LEASE_MS = 60_000;

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
			event.occurredAt,
			event.availableAt,
			event.attempts,
			event.occurredAt,
		],
	};
}

/**
 * MySQL repository 实现。
 *
 * 订单写入和对应 outbox 事件在同一事务；并发幂等依赖数据库唯一键，
 * 版本更新依赖 affectedRows，不能退化成先读后写覆盖。
 */
export function createMySqlRepositories(pool: Pool): MySqlRepositories {
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
						timestamp,
						timestamp,
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
							order.createdAt,
							order.updatedAt,
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
						order.updatedAt,
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

				const claimedUntil = new Date(now.getTime() + OUTBOX_CLAIM_LEASE_MS);
				const result = await execute<ResultSetHeader>(
					connection,
					"UPDATE hp_outbox_events SET claimed_until = ? WHERE event_id = ? AND processed_at IS NULL",
					[claimedUntil, row.event_id],
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
				[processedAt, eventId],
			);
		},
		async markRetry(eventId, nextAvailableAt, reason) {
			await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_outbox_events SET available_at = ?, attempts = attempts + 1, claimed_until = NULL, last_error = ? WHERE event_id = ? AND processed_at IS NULL",
				[nextAvailableAt, reason.slice(0, 512), eventId],
			);
		},
	};

	return { identityUsers, patients, paymentOrders, paymentQuotes, outbox };
}
