import { createHash } from "node:crypto";
import type { PaymentState } from "@hospital/contracts";
import type {
	AppointmentScheduleSnapshot,
	AppointmentScheduleSnapshotRepository,
	HealthKnowledgeRepository,
	IdentityUser,
	OutboxEvent,
	OutboxRepository,
	PatientDirectorySnapshotInput,
	PatientDirectorySnapshotResult,
	PatientDirectorySyncStart,
	PatientDirectorySyncStartInput,
	PatientDirectoryUpsertInput,
	PatientProviderReference,
	PatientRecord,
	PatientRelationship,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	PaymentQuoteRepository,
	ReportReference,
	ReportReferenceRepository,
	UserIdentityRepository,
	UserProfile,
	UserProfileRepository,
	UserProfileUpdate,
	WechatMiniProgramPayParams,
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
	UserProfileVersionConflictError,
	validateAppointmentScheduleSnapshot,
	validateReportReference,
} from "@hospital/domain";
import type {
	Pool,
	PoolConnection,
	ResultSetHeader,
	RowDataPacket,
} from "mysql2/promise";
import {
	isTransientPersistenceError,
	PersistenceNotConfiguredError,
	PersistenceUnavailableError,
} from "./errors";
import { createMySqlHealthKnowledgeRepository } from "./mysql-health-knowledge-repository";
import {
	createAesGcmSecretValueCipher,
	type SecretValueCipher,
} from "./prepay-cipher";

/** MySQL claim lease，防止 worker 崩溃后事件永久停留在 claimed 状态。 */
const DEFAULT_OUTBOX_CLAIM_LEASE_MS = 60_000;

/**
 * 连接被网络侧回收时，只读 SQL 可以安全地从连接池重新取得连接后重试。
 *
 * 这里明确限制为三次尝试，并使用短退避窗口：这是为了覆盖云 MySQL
 * 连接刚被发现断开、连接池正在清理坏连接的瞬态时间，不是把数据库故障
 * 伪装成无限重试。写入、事务和 Provider 调用仍然禁止自动重放。
 */
const READ_CONNECTION_RECOVERY_DELAYS_MS = [25, 100] as const;

/** 将 mysql2 的多重 overload 收窄为 repository 需要的参数形状。 */
type QueryExecutor = {
	execute(
		sql: string,
		values?: readonly unknown[],
	): Promise<[unknown, readonly unknown[]]>;
};

function isReadStatement(sql: string): boolean {
	// `WITH` 也可以包裹 UPDATE/DELETE/INSERT；当前仓储没有使用 CTE，
	// 因此不能仅凭前缀把它当成可安全重放的读操作。
	return /^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(sql);
}

function isPoolClient(client: Pool | PoolConnection): client is Pool {
	return typeof (client as Pool).getConnection === "function";
}

type IdentityUserRow = RowDataPacket & {
	user_id: string;
	provider_subject: string;
	union_id: string | null;
};

type UserProfileRow = RowDataPacket & {
	user_id: string;
	display_name: string;
	gender: string;
	age: number | string | null;
	email: string | null;
	version: number | string;
};

type PatientRow = RowDataPacket & {
	patient_id: string;
	owner_user_id: string;
	display_name: string;
	relationship: string;
	card_number_masked: string;
	source: string;
	provider_name: string | null;
	provider_patient_id: string | null;
	directory_last_seen_at: string | null;
	clinical_access: "ready" | "unavailable";
};

type PatientProviderReferenceRow = RowDataPacket & {
	patient_id: string;
	provider_name: string;
	reference_kind: "directory" | "his-patient";
	provider_patient_id: string;
};

type PatientDirectorySyncOperationRow = RowDataPacket & {
	operation_id: string;
	status: "in_progress" | "succeeded";
	attempt_count: number | string;
	lease_until: string;
};

type AppointmentScheduleSnapshotRow = RowDataPacket & {
	schedule_id: string;
	provider: string;
	provider_schedule_id: string;
	department_id: string;
	department_name: string;
	doctor_id: string;
	doctor_name: string;
	work_date: string;
	shift_name: string;
	start_time: string | null;
	end_time: string | null;
	total_slots: number | string;
	available_slots: number | string;
	time_group: string;
	provider_request_id: string;
	observed_at: string;
	expires_at: string;
};

type ReportReferenceRow = RowDataPacket & {
	report_id: string;
	owner_user_id: string;
	patient_id: string;
	provider: string;
	kind: string;
	provider_report_id: string;
	expires_at: string;
	created_at: string;
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
	query_claimed_until: string | null;
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
	userProfiles: UserProfileRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
	appointmentScheduleSnapshots: AppointmentScheduleSnapshotRepository;
	reportReferences: ReportReferenceRepository;
	outbox: OutboxRepository;
	healthKnowledge: HealthKnowledgeRepository;
};

async function execute<T extends RowDataPacket[] | ResultSetHeader>(
	client: Pool | PoolConnection,
	sql: string,
	values: readonly unknown[] = [],
): Promise<T> {
	const executor = client as unknown as QueryExecutor;
	try {
		const [rows] = await executor.execute(sql, values);
		return rows as T;
	} catch (error) {
		if (!isTransientPersistenceError(error)) throw error;

		// 只有连接池上的幂等读允许自动重试；事务连接和所有写语句
		// 都不能在“不确定服务端是否已执行”的状态下盲目再次执行。
		if (isPoolClient(client) && isReadStatement(sql)) {
			let lastError: unknown = error;
			for (const delayMs of READ_CONNECTION_RECOVERY_DELAYS_MS) {
				await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
				try {
					// 每次 execute 都重新向连接池申请连接；不能复用已经报告
					// PROTOCOL_CONNECTION_LOST 的底层连接对象。
					const [rows] = await executor.execute(sql, values);
					return rows as T;
				} catch (retryError) {
					if (!isTransientPersistenceError(retryError)) throw retryError;
					lastError = retryError;
				}
			}
			throw new PersistenceUnavailableError("read", lastError);
		}

		throw new PersistenceUnavailableError(
			isPoolClient(client) ? "write" : "transaction",
			error,
		);
	}
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
		// 断连时 rollback 也可能失败，但不能覆盖原始业务/持久化错误；
		// 连接最终会在 finally 中释放，池会丢弃已失效的连接。
		try {
			await connection.rollback();
		} catch {
			// rollback 失败不应把底层错误重新包装成无上下文的异常。
		}
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

function safeSlotCount(value: number | string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error("Persistence returned an invalid appointment slot count");
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

function userGender(value: string): UserProfile["gender"] {
	if (value === "male" || value === "female" || value === "unknown") {
		return value;
	}
	throw new Error("Persistence returned an unknown user profile gender");
}

function userProfile(row: UserProfileRow): UserProfile {
	const version = Number(row.version);
	const age = row.age === null ? null : Number(row.age);
	if (!Number.isSafeInteger(version) || version < 1) {
		throw new Error("Persistence returned an invalid user profile version");
	}
	if (age !== null && (!Number.isSafeInteger(age) || age < 0 || age > 150)) {
		throw new Error("Persistence returned an invalid user profile age");
	}
	return {
		userId: row.user_id,
		displayName: row.display_name,
		gender: userGender(row.gender),
		age,
		email: row.email,
		version,
	};
}

function patient(row: PatientRow): PatientRecord {
	if (row.source !== "hospital-his" && row.source !== "legacy-record") {
		throw new Error("Persistence returned an unknown patient source");
	}
	if (
		row.clinical_access !== "ready" &&
		row.clinical_access !== "unavailable"
	) {
		throw new Error("Persistence returned an unknown patient clinical access");
	}
	return {
		id: row.patient_id,
		ownerUserId: row.owner_user_id,
		displayName: row.display_name,
		relationship: patientRelationship(row.relationship),
		cardNumberMasked: row.card_number_masked,
		source: row.source,
		clinicalAccess: row.clinical_access,
	};
}

/** 将当前脱敏读模型压缩成低敏摘要；原始患者资料和幂等键不进入操作表摘要。 */
function patientDirectoryResultDigest(rows: readonly PatientRow[]): string {
	return createHash("sha256")
		.update(
			rows
				.map((row) =>
					[
						row.patient_id,
						row.display_name,
						row.relationship,
						row.card_number_masked,
						row.source,
					].join("\u001f"),
				)
				.join("\u001e"),
		)
		.digest("hex");
}

/**
 * 写入患者的能力专用 provider 引用。
 *
 * 患者目录返回的 thirdPatientId 仍保存在 hp_patients；临床档案 patId
 * 写入独立表，避免更新一次目录数据时覆盖其他业务能力的外部身份。
 */
async function persistPatientProviderReferences(
	pool: Pool | PoolConnection,
	input: PatientDirectoryUpsertInput,
	patientId: string,
): Promise<void> {
	const references = Object.entries(
		input.profile.providerReferences ?? {},
	).filter(
		([referenceKind, providerPatientId]) =>
			(referenceKind === "directory" || referenceKind === "his-patient") &&
			Boolean(providerPatientId),
	);
	for (const [referenceKind, providerPatientId] of references) {
		const now = mysqlDateTime(new Date());
		await execute<ResultSetHeader>(
			pool,
			"INSERT INTO hp_patient_provider_references (owner_user_id, patient_id, provider_name, reference_kind, provider_patient_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE provider_patient_id = VALUES(provider_patient_id), updated_at = VALUES(updated_at)",
			[
				input.ownerUserId,
				patientId,
				input.provider,
				referenceKind,
				providerPatientId,
				now,
				now,
			],
		);
	}
}

const PATIENT_BY_PROVIDER_SQL =
	"SELECT patients.patient_id, patients.owner_user_id, patients.display_name, patients.relationship, patients.card_number_masked, patients.source, patients.provider_name, patients.provider_patient_id, patients.directory_last_seen_at, CASE WHEN EXISTS (SELECT 1 FROM hp_patient_provider_references AS refs WHERE refs.owner_user_id = patients.owner_user_id AND refs.patient_id = patients.patient_id AND refs.provider_name = patients.provider_name AND refs.reference_kind = 'his-patient') THEN 'ready' ELSE 'unavailable' END AS clinical_access FROM hp_patients AS patients WHERE patients.owner_user_id = ? AND patients.provider_name = ? AND patients.provider_patient_id = ? LIMIT 1";

/**
 * 把 MySQL DATETIME(3) 和领域层 ISO 时间统一转换为毫秒。
 *
 * mysql2 运行时配置了 `dateStrings: true`，数据库返回值没有时区后缀；
 * 这里明确按 UTC 解释，不能让 API 进程所在机器的本地时区参与快照顺序判断。
 */
function timestampMilliseconds(
	value: string | Date | null | undefined,
): number | undefined {
	if (value === null || value === undefined) return undefined;
	const text = value instanceof Date ? value.toISOString() : value;
	const normalized = text.includes(" ") ? text.replace(" ", "T") : text;
	const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
		? normalized
		: `${normalized}Z`;
	const milliseconds = Date.parse(withZone);
	return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

/** 只有新快照才能更新患者资料；旧快照不能重新激活或覆盖临床引用。 */
function isNewerDirectoryObservation(
	existing: string | null | undefined,
	incoming: string,
): boolean {
	const existingMilliseconds = timestampMilliseconds(existing);
	const incomingMilliseconds = timestampMilliseconds(incoming);
	return (
		existingMilliseconds !== undefined &&
		incomingMilliseconds !== undefined &&
		existingMilliseconds > incomingMilliseconds
	);
}

/** 在数据库条件更新后再处理引用，避免并发旧快照覆盖新快照。 */
async function refreshExistingPatientFromDirectory(
	client: Pool | PoolConnection,
	input: PatientDirectoryUpsertInput,
	existing: PatientRow,
	timestamp: string,
): Promise<PatientRecord> {
	if (isNewerDirectoryObservation(existing.directory_last_seen_at, timestamp)) {
		return patient(existing);
	}

	const updated = await execute<ResultSetHeader>(
		client,
		"UPDATE hp_patients SET display_name = ?, relationship = ?, card_number_masked = ?, source = ?, directory_active = 1, directory_last_seen_at = ?, updated_at = ? WHERE patient_id = ? AND owner_user_id = ? AND (directory_last_seen_at IS NULL OR directory_last_seen_at <= ?)",
		[
			input.profile.displayName,
			input.profile.relationship,
			input.profile.cardNumberMasked,
			"hospital-his",
			timestamp,
			timestamp,
			existing.patient_id,
			input.ownerUserId,
			timestamp,
		],
	);
	if (updated.affectedRows === 0) {
		// SELECT 与 UPDATE 之间可能有另一条更快的同步已经写入新快照。
		// 只有确认数据库中的时间确实更新，才跳过本次旧引用写入；否则
		// 继续写入当前资料，兼容 MySQL “值未变化时 affectedRows=0”的行为。
		const currentRows = await execute<PatientRow[]>(
			client,
			PATIENT_BY_PROVIDER_SQL,
			[input.ownerUserId, input.provider, input.profile.providerPatientId],
		);
		const current = currentRows[0];
		if (!current)
			throw new Error("Patient disappeared during directory refresh");
		if (
			isNewerDirectoryObservation(current.directory_last_seen_at, timestamp)
		) {
			return patient(current);
		}
	}

	const updatedPatient = patient({
		...existing,
		display_name: input.profile.displayName,
		relationship: input.profile.relationship,
		card_number_masked: input.profile.cardNumberMasked,
		source: "hospital-his",
		// 单条 upsert 不负责清理缺失的临床引用；只有完整快照才有权把
		// 上一次 `his-patient` 事实判定为失效。因此本次有新引用时标记 ready，
		// 没有新引用时沿用数据库当前计算结果。
		clinical_access: input.profile.providerReferences?.["his-patient"]
			? "ready"
			: existing.clinical_access,
	});
	await persistPatientProviderReferences(client, input, updatedPatient.id);
	return updatedPatient;
}

/**
 * 在指定连接上 upsert 一个目录患者，并恢复它的 active 状态。
 *
 * 该 helper 同时被单条测试入口和目录快照事务使用；快照调用方必须把
 * 多个患者及失效回收放在同一个 connection/transaction 中，不能拆成多次
 * pool 写入，否则 provider 半响应会留下不可解释的目录中间态。
 */
async function upsertPatientFromDirectory(
	client: Pool | PoolConnection,
	input: PatientDirectoryUpsertInput,
	observedAt: string,
): Promise<PatientRecord> {
	const existingRows = await execute<PatientRow[]>(
		client,
		PATIENT_BY_PROVIDER_SQL,
		[input.ownerUserId, input.provider, input.profile.providerPatientId],
	);
	const timestamp = mysqlDateTime(observedAt);
	if (existingRows[0]) {
		return refreshExistingPatientFromDirectory(
			client,
			input,
			existingRows[0],
			timestamp,
		);
	}

	try {
		await execute<ResultSetHeader>(
			client,
			"INSERT INTO hp_patients (patient_id, owner_user_id, display_name, relationship, card_number_masked, source, provider_name, provider_patient_id, directory_active, directory_last_seen_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				input.patientId,
				input.ownerUserId,
				input.profile.displayName,
				input.profile.relationship,
				input.profile.cardNumberMasked,
				"hospital-his",
				input.provider,
				input.profile.providerPatientId,
				1,
				timestamp,
				timestamp,
				timestamp,
			],
		);
		const insertedPatient: PatientRecord = {
			id: input.patientId,
			ownerUserId: input.ownerUserId,
			displayName: input.profile.displayName,
			relationship: input.profile.relationship,
			cardNumberMasked: input.profile.cardNumberMasked,
			source: "hospital-his",
			clinicalAccess: input.profile.providerReferences?.["his-patient"]
				? "ready"
				: "unavailable",
		};
		await persistPatientProviderReferences(client, input, insertedPatient.id);
		return insertedPatient;
	} catch (error) {
		if (!isDuplicateEntry(error)) throw error;
		const racedRows = await execute<PatientRow[]>(
			client,
			PATIENT_BY_PROVIDER_SQL,
			[input.ownerUserId, input.provider, input.profile.providerPatientId],
		);
		if (!racedRows[0]) throw error;
		return refreshExistingPatientFromDirectory(
			client,
			input,
			racedRows[0],
			timestamp,
		);
	}
}

/**
 * 清理完整快照中不再出现的能力专用引用。
 *
 * `hp_patients.provider_patient_id` 是目录引用，不能替代临床档案引用；
 * 本次完整快照若没有返回 `his-patient`，旧 patId 就已经失去当前目录证据，
 * 必须在同一事务内删除，避免后续预约、报告或费用查询继续读到过期患者身份。
 * 该操作只在完整快照路径调用，普通单条 upsert 不会误删尚未加载的引用。
 */
async function clearMissingPatientProviderReferences(
	client: Pool | PoolConnection,
	input: PatientDirectoryUpsertInput,
	patientId: string,
	observedAt: string,
): Promise<void> {
	const references = input.profile.providerReferences ?? {};
	// 目录引用已经由 hp_patients.provider_patient_id 维护；这里仅处理
	// 独立保存的临床 patId，避免把“没有额外目录引用字段”误当成目录失效。
	const missingKinds = references["his-patient"] ? [] : ["his-patient"];
	if (missingKinds.length === 0) return;

	const placeholders = missingKinds.map(() => "?").join(", ");
	await execute<ResultSetHeader>(
		client,
		`DELETE FROM hp_patient_provider_references WHERE owner_user_id = ? AND patient_id = ? AND provider_name = ? AND reference_kind IN (${placeholders}) AND EXISTS (SELECT 1 FROM hp_patients AS patients WHERE patients.owner_user_id = ? AND patients.patient_id = ? AND (patients.directory_last_seen_at IS NULL OR patients.directory_last_seen_at <= ?))`,
		[
			input.ownerUserId,
			patientId,
			input.provider,
			...missingKinds,
			input.ownerUserId,
			patientId,
			mysqlDateTime(observedAt),
		],
	);
}

function appointmentScheduleSnapshot(
	row: AppointmentScheduleSnapshotRow,
): AppointmentScheduleSnapshot {
	if (row.provider !== "zhongyang") {
		throw new Error("Persistence returned an unknown appointment provider");
	}
	if (
		row.time_group !== "point" &&
		row.time_group !== "range" &&
		row.time_group !== "unknown"
	) {
		throw new Error("Persistence returned an unknown appointment time group");
	}
	const totalSlots = safeSlotCount(row.total_slots);
	const availableSlots = safeSlotCount(row.available_slots);
	if (availableSlots > totalSlots) {
		throw new Error(
			"Persistence returned inconsistent appointment slot counts",
		);
	}
	const provider: AppointmentScheduleSnapshot["provider"] = row.provider;
	const timeGroup: AppointmentScheduleSnapshot["schedule"]["timeGroup"] =
		row.time_group;
	const snapshot: AppointmentScheduleSnapshot = {
		scheduleId: row.schedule_id,
		provider,
		providerScheduleId: row.provider_schedule_id,
		schedule: {
			scheduleId: row.schedule_id,
			departmentId: row.department_id,
			departmentName: row.department_name,
			doctorId: row.doctor_id,
			doctorName: row.doctor_name,
			workDate: row.work_date,
			shiftName: row.shift_name,
			...(row.start_time ? { startTime: row.start_time } : {}),
			...(row.end_time ? { endTime: row.end_time } : {}),
			totalSlots,
			availableSlots,
			timeGroup,
		},
		providerRequestId: row.provider_request_id,
		observedAt: row.observed_at,
		expiresAt: row.expires_at,
	};
	validateAppointmentScheduleSnapshot({
		schedule: snapshot.schedule,
		provider: snapshot.provider,
		providerScheduleId: snapshot.providerScheduleId,
		providerRequestId: snapshot.providerRequestId,
		observedAt: snapshot.observedAt,
		expiresAt: snapshot.expiresAt,
	});
	return snapshot;
}

function reportReference(row: ReportReferenceRow): ReportReference {
	if (row.provider !== "zhongyang" || row.kind !== "laboratory") {
		throw new Error("Persistence returned an unknown report reference kind");
	}
	const reference: ReportReference = {
		reportId: row.report_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		provider: "zhongyang",
		kind: "laboratory",
		providerReportId: row.provider_report_id,
		expiresAt: row.expires_at,
		createdAt: row.created_at,
	};
	validateReportReference(reference);
	return reference;
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
		...(row.query_claimed_until
			? { queryClaimedUntil: row.query_claimed_until }
			: {}),
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
			if (existingRows[0]) {
				const existing = identityUser(existingRows[0]);
				// unionId 可能因微信主体配置变化而延迟返回；只补齐空值，绝不覆盖
				// 已绑定的 unionId，避免把同一 provider subject 错绑到另一主体。
				if (input.unionId && !existing.unionId) {
					const updateResult = await execute<ResultSetHeader>(
						pool,
						"UPDATE hp_identity_users SET union_id = ?, updated_at = ? WHERE user_id = ? AND union_id IS NULL",
						[input.unionId, mysqlDateTime(new Date()), existing.userId],
					);
					if (updateResult.affectedRows === 1) {
						return { ...existing, unionId: input.unionId };
					}
					// 并发登录可能已经补齐了 unionId；重新读取权威行，不能把本次
					// 未生效的候选值返回给上层，避免身份绑定在竞争条件下漂移。
					const refreshedRows = await execute<IdentityUserRow[]>(
						pool,
						"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE user_id = ? LIMIT 1",
						[existing.userId],
					);
					return refreshedRows[0] ? identityUser(refreshedRows[0]) : existing;
				}
				return existing;
			}

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

	const userProfiles: UserProfileRepository = {
		async findByUserId(userId) {
			const rows = await execute<UserProfileRow[]>(
				pool,
				"SELECT user_id, display_name, gender, age, email, version FROM hp_user_profiles WHERE user_id = ? LIMIT 1",
				[userId],
			);
			return rows[0] ? userProfile(rows[0]) : undefined;
		},
		async update(input: UserProfileUpdate) {
			const now = mysqlDateTime(new Date());
			if (input.expectedVersion === 0) {
				try {
					await execute<ResultSetHeader>(
						pool,
						"INSERT INTO hp_user_profiles (user_id, display_name, gender, age, email, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
						[
							input.userId,
							input.displayName ?? "微信用户",
							input.gender ?? "unknown",
							input.age ?? null,
							input.email ?? null,
							1,
							now,
							now,
						],
					);
				} catch (error) {
					if (!isDuplicateEntry(error)) throw error;
					// 两个设备都拿到 version=0 时，只有一个可以完成首次插入；
					// 另一个必须收到冲突，不能覆盖已经保存的资料。
					throw new UserProfileVersionConflictError();
				}
			} else {
				const current = await userProfiles.findByUserId(input.userId);
				if (!current || current.version !== input.expectedVersion) {
					throw new UserProfileVersionConflictError();
				}
				const result = await execute<ResultSetHeader>(
					pool,
					"UPDATE hp_user_profiles SET display_name = ?, gender = ?, age = ?, email = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?",
					[
						input.displayName ?? current.displayName,
						input.gender ?? current.gender,
						input.age !== undefined ? input.age : current.age,
						input.email !== undefined ? input.email : current.email,
						now,
						input.userId,
						input.expectedVersion,
					],
				);
				if (result.affectedRows !== 1) {
					throw new UserProfileVersionConflictError();
				}
			}

			const updated = await userProfiles.findByUserId(input.userId);
			if (!updated) throw new Error("User profile was not stored");
			return updated;
		},
	};

	const patients: PatientRepository = {
		async listByOwner(ownerUserId) {
			const rows = await execute<PatientRow[]>(
				pool,
				"SELECT patients.patient_id, patients.owner_user_id, patients.display_name, patients.relationship, patients.card_number_masked, patients.source, patients.provider_name, patients.provider_patient_id, patients.directory_last_seen_at, CASE WHEN EXISTS (SELECT 1 FROM hp_patient_provider_references AS refs WHERE refs.owner_user_id = patients.owner_user_id AND refs.patient_id = patients.patient_id AND refs.provider_name = patients.provider_name AND refs.reference_kind = 'his-patient') THEN 'ready' ELSE 'unavailable' END AS clinical_access FROM hp_patients AS patients WHERE patients.owner_user_id = ? AND (patients.provider_name IS NULL OR patients.directory_active = 1) ORDER BY patients.patient_id",
				[ownerUserId],
			);
			return rows.map(patient);
		},
		async beginDirectorySync(
			input: PatientDirectorySyncStartInput,
		): Promise<PatientDirectorySyncStart> {
			return withTransaction(pool, async (connection) => {
				const operationId = crypto.randomUUID();
				const now = mysqlDateTime(input.now);
				const leaseUntil = mysqlDateTime(input.leaseUntil);
				// 幂等键可能来自不同页面，所以不能只锁定“owner + key”这一行：
				// 首页和选择页若分别生成新 key，先查再插入仍会同时访问 provider。
				// 先锁定身份行，把同一 owner 的同步开始阶段串行化；这也是外键已经
				// 保证存在的稳定锁行，不需要新增一张容易产生孤儿锁的业务表。
				const ownerRows = await execute<RowDataPacket[]>(
					connection,
					"SELECT user_id FROM hp_identity_users WHERE user_id = ? LIMIT 1 FOR UPDATE",
					[input.ownerUserId],
				);
				if (!ownerRows[0]) {
					throw new Error(
						"Patient sync owner disappeared before operation start",
					);
				}

				// 先处理精确幂等键：成功记录必须 replay，未过期租约必须返回
				// in_progress，过期租约才允许同一个 operation 递增代次接管。
				const exactRows = await execute<PatientDirectorySyncOperationRow[]>(
					connection,
					"SELECT operation_id, status, attempt_count, lease_until FROM hp_patient_directory_sync_operations WHERE owner_user_id = ? AND provider_name = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE",
					[input.ownerUserId, input.provider, input.idempotencyKey],
				);
				const exactRow = exactRows[0];
				const readExistingOperation = async (
					row: PatientDirectorySyncOperationRow,
					conflictScope: "same-key" | "owner-provider" = "same-key",
				): Promise<PatientDirectorySyncStart> => {
					const attemptCount = Number(row.attempt_count);
					if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
						throw new Error(
							"Persistence returned an invalid patient sync attempt count",
						);
					}
					if (row.status === "succeeded") {
						return {
							outcome: "replay",
							operationId: row.operation_id,
							attemptCount,
						};
					}
					const leaseMilliseconds = timestampMilliseconds(row.lease_until);
					const nowMilliseconds = timestampMilliseconds(input.now);
					if (
						leaseMilliseconds === undefined ||
						nowMilliseconds === undefined
					) {
						throw new Error(
							"Persistence returned an invalid patient sync lease",
						);
					}
					if (leaseMilliseconds > nowMilliseconds) {
						return {
							outcome: "in_progress",
							operationId: row.operation_id,
							attemptCount,
							leaseUntil: new Date(leaseMilliseconds).toISOString(),
							conflictScope,
						};
					}

					const updated = await execute<ResultSetHeader>(
						connection,
						"UPDATE hp_patient_directory_sync_operations SET status = 'in_progress', attempt_count = attempt_count + 1, lease_until = ?, updated_at = ? WHERE operation_id = ? AND status = 'in_progress'",
						[leaseUntil, now, row.operation_id],
					);
					if (updated.affectedRows !== 1) {
						throw new Error("Patient sync operation lease takeover failed");
					}
					return {
						outcome: "started",
						operationId: row.operation_id,
						attemptCount: attemptCount + 1,
					};
				};

				if (exactRow) return readExistingOperation(exactRow);

				// 这是和唯一幂等键不同的第二道并发边界：即使本次 key 从未出现，
				// 同 owner/provider 仍只能有一个未过期同步。0016 的复合索引让这条
				// 查询不会随着 operation ledger 增长退化为全表扫描。
				const activeRows = await execute<PatientDirectorySyncOperationRow[]>(
					connection,
					"SELECT operation_id, status, attempt_count, lease_until FROM hp_patient_directory_sync_operations WHERE owner_user_id = ? AND provider_name = ? AND status = 'in_progress' AND lease_until > ? ORDER BY updated_at DESC, operation_id DESC LIMIT 1 FOR UPDATE",
					[input.ownerUserId, input.provider, now],
				);
				const activeRow = activeRows[0];
				if (activeRow) {
					const active = await readExistingOperation(
						activeRow,
						"owner-provider",
					);
					if (active.outcome !== "in_progress") {
						throw new Error(
							"Patient sync active-operation query returned an invalid state",
						);
					}
					return active;
				}

				// ON DUPLICATE KEY UPDATE 只用于兼容尚未采用 owner 行锁的旧 worker
				// 在同一幂等键上的竞争；不使用 INSERT IGNORE，避免吞掉外键或字段
				// 校验错误。当前 worker 之间的不同 key 竞争已由 owner 行锁消除。
				await execute<ResultSetHeader>(
					connection,
					"INSERT INTO hp_patient_directory_sync_operations (operation_id, owner_user_id, provider_name, idempotency_key, status, attempt_count, lease_until, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_progress', 1, ?, ?, ?) ON DUPLICATE KEY UPDATE operation_id = operation_id",
					[
						operationId,
						input.ownerUserId,
						input.provider,
						input.idempotencyKey,
						leaseUntil,
						now,
						now,
					],
				);
				const rows = await execute<PatientDirectorySyncOperationRow[]>(
					connection,
					"SELECT operation_id, status, attempt_count, lease_until FROM hp_patient_directory_sync_operations WHERE owner_user_id = ? AND provider_name = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE",
					[input.ownerUserId, input.provider, input.idempotencyKey],
				);
				const row = rows[0];
				if (!row)
					throw new Error("Patient sync operation disappeared after insert");
				// 不依赖 mysql2 对 ON DUPLICATE KEY 的 affectedRows 约定；
				// 新生成的 operationId 只有在本事务确实插入时才会被查询回来。
				if (row.operation_id === operationId) {
					return {
						outcome: "started",
						operationId: row.operation_id,
						attemptCount: 1,
					};
				}
				return readExistingOperation(row);
			});
		},
		async upsertFromDirectory(input) {
			return upsertPatientFromDirectory(pool, input, new Date().toISOString());
		},
		async replaceDirectorySnapshot(
			input: PatientDirectorySnapshotInput,
		): Promise<PatientDirectorySnapshotResult> {
			if (
				input.operationId &&
				(!Number.isSafeInteger(input.operationAttemptCount) ||
					(input.operationAttemptCount ?? 0) < 1)
			) {
				throw new Error("Patient sync operation attempt is required");
			}
			return withTransaction(pool, async (connection) => {
				for (const snapshotPatient of input.patients) {
					const patient = await upsertPatientFromDirectory(
						connection,
						{
							ownerUserId: input.ownerUserId,
							provider: input.provider,
							patientId: snapshotPatient.patientId,
							profile: snapshotPatient.profile,
						},
						input.observedAt,
					);
					await clearMissingPatientProviderReferences(
						connection,
						{
							ownerUserId: input.ownerUserId,
							provider: input.provider,
							patientId: snapshotPatient.patientId,
							profile: snapshotPatient.profile,
						},
						patient.id,
						input.observedAt,
					);
				}

				const observedAt = mysqlDateTime(input.observedAt);
				const deactivated = await execute<ResultSetHeader>(
					connection,
					"UPDATE hp_patients SET directory_active = 0, updated_at = ? WHERE owner_user_id = ? AND provider_name = ? AND directory_active = 1 AND (directory_last_seen_at IS NULL OR directory_last_seen_at < ?)",
					[observedAt, input.ownerUserId, input.provider, observedAt],
				);
				const currentRows = await execute<PatientRow[]>(
					connection,
					"SELECT patients.patient_id, patients.owner_user_id, patients.display_name, patients.relationship, patients.card_number_masked, patients.source, patients.provider_name, patients.provider_patient_id, patients.directory_last_seen_at, CASE WHEN EXISTS (SELECT 1 FROM hp_patient_provider_references AS refs WHERE refs.owner_user_id = patients.owner_user_id AND refs.patient_id = patients.patient_id AND refs.provider_name = patients.provider_name AND refs.reference_kind = 'his-patient') THEN 'ready' ELSE 'unavailable' END AS clinical_access FROM hp_patients AS patients WHERE patients.owner_user_id = ? AND (patients.provider_name IS NULL OR patients.directory_active = 1) ORDER BY patients.patient_id",
					[input.ownerUserId],
				);
				if (input.operationId) {
					const completedAt = mysqlDateTime(new Date());
					const completed = await execute<ResultSetHeader>(
						connection,
						"UPDATE hp_patient_directory_sync_operations SET status = 'succeeded', observed_at = ?, completed_at = ?, result_digest = ?, updated_at = ? WHERE operation_id = ? AND owner_user_id = ? AND provider_name = ? AND attempt_count = ? AND status = 'in_progress'",
						[
							observedAt,
							completedAt,
							patientDirectoryResultDigest(currentRows),
							completedAt,
							input.operationId,
							input.ownerUserId,
							input.provider,
							input.operationAttemptCount,
						],
					);
					if (completed.affectedRows !== 1) {
						throw new Error("Patient sync operation completion failed");
					}
				}

				return {
					activePatients: currentRows.map(patient),
					deactivatedPatientCount: deactivated.affectedRows,
				};
			});
		},
		async resolveProviderReference(
			input,
		): Promise<PatientProviderReference | undefined> {
			const referenceKind = input.referenceKind ?? "directory";
			if (referenceKind === "his-patient") {
				const rows = await execute<PatientProviderReferenceRow[]>(
					pool,
					"SELECT provider_refs.patient_id, provider_refs.provider_name, provider_refs.reference_kind, provider_refs.provider_patient_id FROM hp_patient_provider_references AS provider_refs INNER JOIN hp_patients AS patients ON patients.owner_user_id = provider_refs.owner_user_id AND patients.patient_id = provider_refs.patient_id WHERE provider_refs.owner_user_id = ? AND provider_refs.patient_id = ? AND provider_refs.provider_name = ? AND provider_refs.reference_kind = ? AND patients.directory_active = 1 LIMIT 1",
					[input.ownerUserId, input.patientId, input.provider, referenceKind],
				);
				const row = rows[0];
				return row?.provider_patient_id
					? {
							patientId: row.patient_id,
							provider: input.provider,
							providerPatientId: row.provider_patient_id,
						}
					: undefined;
			}

			const rows = await execute<PatientRow[]>(
				pool,
				"SELECT patient_id, provider_name, provider_patient_id FROM hp_patients WHERE owner_user_id = ? AND patient_id = ? AND provider_name = ? AND provider_patient_id IS NOT NULL AND directory_active = 1 LIMIT 1",
				[input.ownerUserId, input.patientId, input.provider],
			);
			const row = rows[0];
			if (
				!row ||
				row.provider_name !== input.provider ||
				!row.provider_patient_id
			) {
				return undefined;
			}
			return {
				patientId: row.patient_id,
				provider: input.provider,
				providerPatientId: row.provider_patient_id,
			};
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
				"SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE owner_user_id = ? AND order_id = ? AND idempotency_key = ? LIMIT 1",
				[ownerUserId, orderId, idempotencyKey],
			);
			return rows[0] ? paymentPrepayAttempt(rows[0], cipher) : undefined;
		},
		async insert(attempt) {
			const cipher = requiredPrepayCipher();
			try {
				await execute<ResultSetHeader>(
					pool,
					"INSERT INTO hp_payment_prepay_attempts (attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
						attempt.queryClaimedUntil
							? mysqlDateTime(attempt.queryClaimedUntil)
							: null,
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
				"UPDATE hp_payment_prepay_attempts SET status = ?, version = ?, query_attempts = ?, last_queried_at = ?, next_query_at = ?, query_claimed_until = ?, prepay_id_hash = ?, pay_params_ciphertext = ?, provider_request_id = ?, last_error_code = ?, updated_at = ? WHERE attempt_id = ? AND owner_user_id = ? AND version = ?",
				[
					attempt.status,
					attempt.version,
					attempt.queryAttempts,
					attempt.lastQueriedAt ? mysqlDateTime(attempt.lastQueriedAt) : null,
					attempt.nextQueryAt ? mysqlDateTime(attempt.nextQueryAt) : null,
					attempt.queryClaimedUntil
						? mysqlDateTime(attempt.queryClaimedUntil)
						: null,
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
		async claimDueForQuery(now, limit, leaseMs) {
			const cipher = requiredPrepayCipher();
			if (
				!Number.isSafeInteger(limit) ||
				limit <= 0 ||
				!Number.isSafeInteger(leaseMs) ||
				leaseMs <= 0
			) {
				return [];
			}
			// mysql2/MySQL 对 `LIMIT ? FOR UPDATE SKIP LOCKED` 的 prepared
			// 参数组合不兼容；这里先把 limit 收窄为安全整数，再作为 SQL
			// 结构常量插入，其他值仍全部通过参数绑定传递。
			const queryLimit = Math.min(limit, 1_000);
			const claimedUntil = new Date(now.getTime() + leaseMs);
			return withTransaction(pool, async (connection) => {
				const rows = await execute<PaymentPrepayAttemptRow[]>(
					connection,
					`SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE next_query_at IS NOT NULL AND next_query_at <= ? AND (query_claimed_until IS NULL OR query_claimed_until <= ?) AND status IN (?, ?, ?) ORDER BY next_query_at, attempt_id LIMIT ${queryLimit} FOR UPDATE SKIP LOCKED`,
					[
						mysqlDateTime(now),
						mysqlDateTime(now),
						"pending",
						"succeeded",
						"unknown",
					],
				);
				for (const row of rows) {
					const result = await execute<ResultSetHeader>(
						connection,
						"UPDATE hp_payment_prepay_attempts SET query_claimed_until = ?, version = version + 1, updated_at = ? WHERE attempt_id = ? AND version = ?",
						[
							mysqlDateTime(claimedUntil),
							mysqlDateTime(now),
							row.attempt_id,
							row.version,
						],
					);
					// 行已被 FOR UPDATE 锁定，正常情况下这里必须恰好更新一行；
					// 若约束被未来改动破坏，直接回滚而不是返回一个未真正 claim 的任务。
					if (result.affectedRows !== 1) {
						throw new PaymentPrepayAttemptVersionConflictError();
					}
				}
				return rows.map((row) =>
					paymentPrepayAttempt(
						{
							...row,
							version: row.version + 1,
							query_claimed_until: mysqlDateTime(claimedUntil),
							updated_at: mysqlDateTime(now),
						},
						cipher,
					),
				);
			});
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

	const reportReferences: ReportReferenceRepository = {
		async upsert(input) {
			validateReportReference(input);
			const createdAt = input.createdAt ?? new Date().toISOString();
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_report_references
					(report_id, owner_user_id, patient_id, provider, kind,
					 provider_report_id, expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE
					owner_user_id = VALUES(owner_user_id),
					patient_id = VALUES(patient_id),
					provider = VALUES(provider),
					kind = VALUES(kind),
					provider_report_id = VALUES(provider_report_id),
					expires_at = VALUES(expires_at),
					created_at = VALUES(created_at),
					updated_at = VALUES(updated_at)`,
				[
					input.reportId,
					input.ownerUserId,
					input.patientId,
					input.provider,
					input.kind,
					input.providerReportId,
					mysqlDateTime(input.expiresAt),
					mysqlDateTime(createdAt),
					mysqlDateTime(new Date()),
				],
			);
			return {
				...input,
				createdAt,
			};
		},
		async findByOwnerAndId(ownerUserId, reportId, now) {
			const rows = await execute<ReportReferenceRow[]>(
				pool,
				`SELECT report_id, owner_user_id, patient_id, provider, kind,
					provider_report_id, expires_at, created_at
				 FROM hp_report_references
				 WHERE owner_user_id = ? AND report_id = ? AND expires_at > ? LIMIT 1`,
				[ownerUserId, reportId, mysqlDateTime(now)],
			);
			return rows[0] ? reportReference(rows[0]) : undefined;
		},
	};

	const appointmentScheduleSnapshots: AppointmentScheduleSnapshotRepository = {
		async upsert(input) {
			validateAppointmentScheduleSnapshot(input);
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_appointment_schedule_snapshots
					(schedule_id, provider, provider_schedule_id, department_id, department_name,
					 doctor_id, doctor_name, work_date, shift_name, start_time, end_time,
					 total_slots, available_slots, time_group, provider_request_id,
					 observed_at, expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE
					provider_schedule_id = IF(observed_at <= VALUES(observed_at), VALUES(provider_schedule_id), provider_schedule_id),
					department_id = IF(observed_at <= VALUES(observed_at), VALUES(department_id), department_id),
					department_name = IF(observed_at <= VALUES(observed_at), VALUES(department_name), department_name),
					doctor_id = IF(observed_at <= VALUES(observed_at), VALUES(doctor_id), doctor_id),
					doctor_name = IF(observed_at <= VALUES(observed_at), VALUES(doctor_name), doctor_name),
					work_date = IF(observed_at <= VALUES(observed_at), VALUES(work_date), work_date),
					shift_name = IF(observed_at <= VALUES(observed_at), VALUES(shift_name), shift_name),
					start_time = IF(observed_at <= VALUES(observed_at), VALUES(start_time), start_time),
					end_time = IF(observed_at <= VALUES(observed_at), VALUES(end_time), end_time),
					total_slots = IF(observed_at <= VALUES(observed_at), VALUES(total_slots), total_slots),
					available_slots = IF(observed_at <= VALUES(observed_at), VALUES(available_slots), available_slots),
					time_group = IF(observed_at <= VALUES(observed_at), VALUES(time_group), time_group),
					provider_request_id = IF(observed_at <= VALUES(observed_at), VALUES(provider_request_id), provider_request_id),
					observed_at = GREATEST(observed_at, VALUES(observed_at)),
					expires_at = IF(observed_at <= VALUES(observed_at), VALUES(expires_at), expires_at),
					updated_at = VALUES(updated_at)`,
				[
					input.schedule.scheduleId,
					input.provider,
					input.providerScheduleId,
					input.schedule.departmentId,
					input.schedule.departmentName,
					input.schedule.doctorId,
					input.schedule.doctorName,
					input.schedule.workDate,
					input.schedule.shiftName,
					input.schedule.startTime ?? null,
					input.schedule.endTime ?? null,
					input.schedule.totalSlots,
					input.schedule.availableSlots,
					input.schedule.timeGroup,
					input.providerRequestId,
					mysqlDateTime(input.observedAt),
					mysqlDateTime(input.expiresAt),
					mysqlDateTime(input.observedAt),
					mysqlDateTime(input.observedAt),
				],
			);
			const rows = await execute<AppointmentScheduleSnapshotRow[]>(
				pool,
				`SELECT schedule_id, provider, provider_schedule_id, department_id,
					department_name, doctor_id, doctor_name, work_date, shift_name,
					start_time, end_time, total_slots, available_slots, time_group,
					provider_request_id, observed_at, expires_at
				 FROM hp_appointment_schedule_snapshots WHERE schedule_id = ? LIMIT 1`,
				[input.schedule.scheduleId],
			);
			if (!rows[0])
				throw new Error("Appointment schedule snapshot was not stored");
			return appointmentScheduleSnapshot(rows[0]);
		},
		async findActive(scheduleId, now) {
			const rows = await execute<AppointmentScheduleSnapshotRow[]>(
				pool,
				`SELECT schedule_id, provider, provider_schedule_id, department_id,
					department_name, doctor_id, doctor_name, work_date, shift_name,
					start_time, end_time, total_slots, available_slots, time_group,
					provider_request_id, observed_at, expires_at
				 FROM hp_appointment_schedule_snapshots
				 WHERE schedule_id = ? AND expires_at > ? LIMIT 1`,
				[scheduleId, mysqlDateTime(now)],
			);
			return rows[0] ? appointmentScheduleSnapshot(rows[0]) : undefined;
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
					[mysqlDateTime(now), mysqlDateTime(now)],
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
		userProfiles,
		patients,
		paymentOrders,
		paymentQuotes,
		paymentPrepayAttempts,
		wechatPaymentNotifications,
		appointmentScheduleSnapshots,
		reportReferences,
		outbox,
		healthKnowledge: createMySqlHealthKnowledgeRepository(pool),
	};
}
