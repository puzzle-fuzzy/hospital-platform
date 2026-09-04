import { createHash } from "node:crypto";
import type { PaymentState } from "@hospital/contracts";
import type {
	AppointmentHold,
	AppointmentRegistration,
	AppointmentWriteRepository,
	AppointmentScheduleSnapshot,
	AppointmentScheduleSnapshotRepository,
	HealthKnowledgeRepository,
	IdentityUser,
	ManualReviewRepository,
	MedicalInsuranceCredentialContext,
	MedicalInsuranceCredentialHandle,
	MedicalInsuranceCredentialRepository,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceAuthorizationRepository,
	MedicalInsuranceProviderQueryIdentity,
	ManualReviewSnapshot,
	MedicalInsuranceOrder,
	MedicalInsuranceOrderRepository,
	MedicalInsuranceSettlementContext,
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MyDoctor,
	MyDoctorRepository,
	OutboxEvent,
	OutboxManualReviewItem,
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
	PaymentManualReviewItem,
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
	WechatMedicalInsurancePayParams,
	WechatMiniProgramPayParams,
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
} from "@hospital/domain";
import {
	MyDoctorAlreadyExistsError,
	normalizeUserProfileReadModel,
	PatientDirectoryReferenceConflictError,
	PatientDirectorySnapshotStaleError,
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
	parseStrictIsoInstant,
	UserProfileVersionConflictError,
	validateAppointmentScheduleSnapshot,
	validateReportReference,
	isValidMedicalInsuranceProviderQueryIdentity,
	normalizeMyDoctorReadModel,
	validateMyDoctorCreateInput,
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
	title_name: string | null;
	introduction: string | null;
	expertise: string | null;
	department_location: string | null;
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

type AppointmentHoldRow = RowDataPacket & {
	hold_id: string;
	owner_user_id: string;
	patient_id: string;
	schedule_id: string;
	provider_schedule_id: string;
	provider_source_id: string;
	source_serial_number: string;
	total_fen: number | string;
	status: string;
	idempotency_key: string;
	expires_at: string;
	created_at: string;
	updated_at: string;
};

type AppointmentRegistrationRow = RowDataPacket & {
	appointment_id: string;
	owner_user_id: string;
	patient_id: string;
	hold_id: string;
	provider_appointment_id: string;
	provider_patient_id: string;
	provider_register_id: string | null;
	provider_his_register_id: string | null;
	idempotency_key: string;
	department_name: string;
	department_id: string | null;
	doctor_id: string | null;
	doctor_name: string;
	work_date: string;
	shift_name: string;
	source_serial_number: string;
	total_fen: number | string;
	status: string;
	created_at: string;
	updated_at: string;
};

type MyDoctorRow = RowDataPacket & {
	relation_id: string;
	owner_user_id: string;
	doctor_id: string;
	doctor_name: string;
	title_name: string | null;
	introduction: string | null;
	expertise: string | null;
	department_location: string | null;
	department_name: string;
	doctor_avatar_url: string | null;
	created_at: string;
};

/**
 * 将 dateStrings 模式下的 MySQL DATETIME(3) 读值恢复为领域层 ISO UTC。
 *
 * MySQL 的 DATETIME 没有时区后缀，本项目写入时已经统一使用 UTC；读取时
 * 必须在 persistence 边界明确补上 `T` 和 `Z`，不能让领域层或 Node 进程
 * 本地时区猜测含义。这里不使用宽松的 `Date.parse`，因为非法自然日可能
 * 被自动进位，进而改变预约快照的观察窗口和过期时间。
 */
function mysqlUtcDateTimeToIso(value: string): string {
	const match =
		/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(value);
	if (!match) {
		throw new Error("Persistence returned an invalid appointment timestamp");
	}
	const milliseconds = (match[3] ?? "").padEnd(3, "0");
	const iso = `${match[1]}T${match[2]}.${milliseconds}Z`;
	if (parseStrictIsoInstant(iso) === undefined) {
		throw new Error("Persistence returned an invalid appointment timestamp");
	}
	return iso;
}

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
	version: number | string;
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
	version: number | string;
	query_attempts: number | string;
	last_queried_at: string | null;
	next_query_at: string | null;
	query_claimed_until: string | null;
	manual_review_at: string | null;
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
	status: OutboxEvent["status"];
	aggregate_id: string;
	payload: string | Readonly<Record<string, unknown>>;
	occurred_at: string;
	available_at: string;
	attempts: number;
	claimed_until: string | null;
	manual_review_at: string | null;
};

type OutboxManualReviewRow = RowDataPacket & {
	event_id: string;
	event_name: string;
	aggregate_id: string;
	attempts: number | string;
	occurred_at: string;
	available_at: string;
	manual_review_at: string | null;
	last_error: string | null;
};

type PaymentManualReviewRow = RowDataPacket & {
	attempt_id: string;
	order_id: string;
	provider: string;
	status: string;
	version: number | string;
	query_attempts: number | string;
	manual_review_at: string | null;
	last_error_code: string | null;
	created_at: string;
	updated_at: string;
};

const OUTBOX_EVENT_STATUSES: readonly OutboxEvent["status"][] = [
	"pending",
	"processed",
	"manual_review",
];

function outboxEventStatus(value: string): OutboxEvent["status"] {
	if (OUTBOX_EVENT_STATUSES.includes(value as OutboxEvent["status"])) {
		return value as OutboxEvent["status"];
	}
	throw new Error("Persistence returned an unknown outbox event status");
}

type MIRow = RowDataPacket & {
	medical_order_id: string;
	owner_user_id: string;
	patient_id: string;
	business_type: string | null;
	order_type: string | null;
	business_id: string | null;
	appointment_id: string | null;
	authorization_id: string | null;
	fee_upload_id: string | null;
	idempotency_key: string;
	med_org_ord: string;
	chrg_bchno: string;
	pay_ord_id: string | null;
	pay_token_hash: string | null;
	mdtrt_id: string | null;
	acct_used_flag: string | null;
	status: string;
	ord_stas: string | null;
	total_fen: number;
	cash_fen: number;
	personal_account_fen: number;
	fund_fen: number;
	setl_type: string | null;
	revs_token_hash: string | null;
	revs_token_expires_at: Date | null;
	last_error: string | null;
	wechat_mix_trade_no: string | null;
	wechat_out_trade_no: string | null;
	wechat_payment_state: string;
	wechat_pay_params_ciphertext: string | null;
	version: number;
	created_at: Date;
	updated_at: Date;
};

type MedicalInsuranceQueryTaskRow = RowDataPacket & {
	task_id: string;
	medical_order_id: string;
	status: string;
	attempts: number | string;
	max_attempts: number | string;
	version: number | string;
	next_attempt_at: string;
	claimed_until: string | null;
	terminal_ord_stas: string | null;
	last_error_code: string | null;
	created_at: string;
	updated_at: string;
};

type MedicalInsuranceCredentialRow = RowDataPacket & {
	credential_id: string;
	owner_user_id: string;
	medical_order_id: string;
	pay_ord_id: string;
	purpose: string;
	payload_ciphertext: string;
	expires_at: string;
	created_at: string;
};

type MedicalInsuranceCredentialPayload = {
	payToken: string;
	providerQueryIdentity: MedicalInsuranceProviderQueryIdentity;
};

function serializeMedicalInsuranceSettlementContext(
	input: MedicalInsuranceSettlementContext,
): string {
	return JSON.stringify(input);
}

function deserializeMedicalInsuranceSettlementContext(
	value: string,
): MedicalInsuranceSettlementContext {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error("Medical insurance settlement context is invalid", {
			cause: error,
		});
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		typeof (parsed as { businessId?: unknown }).businessId !== "string" ||
		typeof (parsed as { hospitalId?: unknown }).hospitalId !== "string" ||
		typeof (parsed as { patientId?: unknown }).patientId !== "string" ||
		typeof (parsed as { payingId?: unknown }).payingId !== "string" ||
		typeof (parsed as { tradingId?: unknown }).tradingId !== "string" ||
		typeof (parsed as { networkRegister?: unknown }).networkRegister !==
			"object" ||
		(parsed as { networkRegister?: unknown }).networkRegister === null ||
		Array.isArray((parsed as { networkRegister?: unknown }).networkRegister) ||
		typeof (parsed as { outNetworkSettleMain?: unknown })
			.outNetworkSettleMain !== "object" ||
		(parsed as { outNetworkSettleMain?: unknown }).outNetworkSettleMain ===
			null ||
		!Array.isArray(
			(parsed as { nationalUpDetailList?: unknown }).nationalUpDetailList,
		) ||
		!Array.isArray((parsed as { upDetailList?: unknown }).upDetailList) ||
		!Array.isArray((parsed as { tradeOrderIds?: unknown }).tradeOrderIds)
	) {
		throw new Error("Medical insurance settlement context is invalid");
	}
	return parsed as MedicalInsuranceSettlementContext;
}

type MedicalInsuranceAuthorizationRow = RowDataPacket & {
	authorization_id: string;
	owner_user_id: string;
	medical_order_id: string;
	payload_ciphertext: string;
	expires_at: string;
	created_at: string;
};

type MedicalInsuranceAuthorizationPayload = Omit<
	MedicalInsuranceAuthorizationContext,
	| "authorizationId"
	| "ownerUserId"
	| "medicalOrderId"
	| "expiresAt"
	| "createdAt"
>;

function deserializeMedicalInsuranceAuthorizationPayload(
	value: string,
): MedicalInsuranceAuthorizationPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error("Medical insurance authorization payload is invalid", {
			cause: error,
		});
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Medical insurance authorization payload is invalid");
	}
	const candidate = parsed as {
		payAuthNo?: unknown;
		providerSubject?: unknown;
		patient?: unknown;
		psnNo?: unknown;
		insutype?: unknown;
		insuplcAdmdvs?: unknown;
		insuCode?: unknown;
	};
	if (
		typeof candidate.payAuthNo !== "string" ||
		typeof candidate.providerSubject !== "string" ||
		typeof candidate.patient !== "object" ||
		candidate.patient === null ||
		Array.isArray(candidate.patient) ||
		typeof candidate.psnNo !== "string" ||
		typeof candidate.insutype !== "string" ||
		typeof candidate.insuplcAdmdvs !== "string" ||
		typeof candidate.insuCode !== "string"
	) {
		throw new Error("Medical insurance authorization payload is invalid");
	}
	const patient = candidate.patient as {
		idNo?: unknown;
		userName?: unknown;
		idType?: unknown;
	};
	if (
		typeof patient.idNo !== "string" ||
		typeof patient.userName !== "string" ||
		typeof patient.idType !== "string"
	) {
		throw new Error("Medical insurance authorization payload is invalid");
	}
	return parsed as MedicalInsuranceAuthorizationPayload;
}

function serializeMedicalInsuranceCredentialPayload(
	input: MedicalInsuranceCredentialPayload,
): string {
	return JSON.stringify(input);
}

function deserializeMedicalInsuranceCredentialPayload(
	value: string,
): MedicalInsuranceCredentialPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new Error("Medical insurance credential payload is invalid", {
			cause: error,
		});
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		typeof (parsed as { payToken?: unknown }).payToken !== "string" ||
		!isValidMedicalInsuranceProviderQueryIdentity(
			(parsed as { providerQueryIdentity?: unknown }).providerQueryIdentity,
		)
	) {
		throw new Error("Medical insurance credential payload is invalid");
	}
	return parsed as MedicalInsuranceCredentialPayload;
}

const MEDICAL_INSURANCE_QUERY_TASK_STATUSES: readonly MedicalInsuranceQueryTask["status"][] =
	[
		"pending",
		"in_progress",
		"awaiting_confirmation",
		"completed",
		"manual_review",
	];

function medicalInsuranceQueryTaskStatus(
	value: string,
): MedicalInsuranceQueryTask["status"] {
	if (
		MEDICAL_INSURANCE_QUERY_TASK_STATUSES.includes(
			value as MedicalInsuranceQueryTask["status"],
		)
	) {
		return value as MedicalInsuranceQueryTask["status"];
	}
	throw new Error(
		"Persistence returned an unknown medical insurance query task status",
	);
}

function medicalInsuranceQueryTask(
	row: MedicalInsuranceQueryTaskRow,
): MedicalInsuranceQueryTask {
	const attempts = safeDatabaseInteger(
		row.attempts,
		0,
		"Persistence returned an invalid medical insurance query attempts count",
	);
	const maxAttempts = safeDatabaseInteger(
		row.max_attempts,
		1,
		"Persistence returned an invalid medical insurance query max attempts",
	);
	if (attempts > maxAttempts) {
		throw new Error(
			"Persistence returned medical insurance query attempts above its limit",
		);
	}
	return {
		taskId: row.task_id,
		medicalOrderId: row.medical_order_id,
		status: medicalInsuranceQueryTaskStatus(row.status),
		version: safeDatabaseInteger(
			row.version,
			1,
			"Persistence returned an invalid medical insurance query task version",
		),
		attempts,
		maxAttempts,
		nextAttemptAt: mysqlUtcDateTimeToIso(row.next_attempt_at),
		claimedUntil: row.claimed_until
			? mysqlUtcDateTimeToIso(row.claimed_until)
			: null,
		terminalOrdStas: row.terminal_ord_stas,
		lastErrorCode: row.last_error_code,
		createdAt: mysqlUtcDateTimeToIso(row.created_at),
		updatedAt: mysqlUtcDateTimeToIso(row.updated_at),
	};
}

function medicalInsuranceCredentialPurpose(
	value: string,
): MedicalInsuranceCredentialHandle["purpose"] {
	if (value === "settlement" || value === "query") return value;
	throw new Error(
		"Persistence returned an unknown medical insurance credential purpose",
	);
}

function medicalInsuranceCredentialHandle(
	row: MedicalInsuranceCredentialRow,
): MedicalInsuranceCredentialHandle {
	return {
		credentialId: row.credential_id,
		ownerUserId: row.owner_user_id,
		medicalOrderId: row.medical_order_id,
		payOrdId: row.pay_ord_id,
		purpose: medicalInsuranceCredentialPurpose(row.purpose),
		expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
		createdAt: mysqlUtcDateTimeToIso(row.created_at),
	};
}

const MI_SELECT =
	"SELECT medical_order_id, owner_user_id, patient_id, business_type, order_type, business_id, appointment_id, authorization_id, fee_upload_id, idempotency_key, med_org_ord, chrg_bchno, pay_ord_id, pay_token_hash, mdtrt_id, acct_used_flag, status, ord_stas, total_fen, cash_fen, personal_account_fen, fund_fen, setl_type, revs_token_hash, revs_token_expires_at, last_error, wechat_mix_trade_no, wechat_out_trade_no, wechat_payment_state, wechat_pay_params_ciphertext, version, created_at, updated_at FROM hp_medical_insurance_orders";

const MI_WECHAT_PAYMENT_STATES = [
	"not_started",
	"prepay_ready",
	"cash_paid",
	"failed",
	"unknown",
] as const;

function miWechatPaymentState(
	value: string,
): NonNullable<MedicalInsuranceOrder["wechatPaymentState"]> {
	if (
		MI_WECHAT_PAYMENT_STATES.includes(
			value as (typeof MI_WECHAT_PAYMENT_STATES)[number],
		)
	) {
		return value as NonNullable<MedicalInsuranceOrder["wechatPaymentState"]>;
	}
	throw new Error(
		"Persistence returned an unknown medical WeChat payment state",
	);
}

function miOrder(
	row: MIRow,
	cipher?: SecretValueCipher,
): MedicalInsuranceOrder {
	const storedPayParams = row.wechat_pay_params_ciphertext
		? (() => {
				if (!cipher) {
					throw new PersistenceNotConfiguredError("payment-prepay-attempts");
				}
				return (
					medicalWechatPayParams(row.wechat_pay_params_ciphertext, cipher) ??
					null
				);
			})()
		: null;
	const businessId = row.business_id ?? row.appointment_id;
	return {
		medicalOrderId: row.medical_order_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		// 0034 之后这两个字段由数据库保证；fallback 只为读取尚未完成
		// 迁移的历史回放数据，真实写入仍必须经过业务层显式赋值。
		businessType:
			row.business_type === "outpatient" ? "outpatient" : "registration",
		orderType: row.order_type === "DiagPay" ? "DiagPay" : "RegPay",
		...(businessId ? { businessId } : {}),
		...(row.appointment_id ? { appointmentId: row.appointment_id } : {}),
		authorizationId: row.authorization_id,
		feeUploadId: row.fee_upload_id,
		idempotencyKey: row.idempotency_key,
		medOrgOrd: row.med_org_ord,
		chrgBchno: row.chrg_bchno,
		payOrdId: row.pay_ord_id,
		payTokenHash: row.pay_token_hash,
		mdtrtId: row.mdtrt_id,
		acctUsedFlag: row.acct_used_flag,
		status: row.status as MedicalInsuranceOrder["status"],
		ordStas: row.ord_stas,
		amounts:
			row.total_fen > 0
				? {
						totalFen: row.total_fen,
						cashFen: row.cash_fen,
						personalAccountFen: row.personal_account_fen,
						fundFen: row.fund_fen,
					}
				: null,
		setlType: (row.setl_type as "ALL" | "CASH" | "HI" | null) ?? null,
		revsTokenHash: row.revs_token_hash,
		revsTokenExpiresAt: row.revs_token_expires_at?.toISOString() ?? null,
		lastError: row.last_error,
		wechatMixTradeNo: row.wechat_mix_trade_no,
		wechatOutTradeNo: row.wechat_out_trade_no,
		wechatPayParams: storedPayParams,
		wechatPaymentState: miWechatPaymentState(row.wechat_payment_state),
		version: row.version,
		createdAt: row.created_at.toISOString(),
		updatedAt: row.updated_at.toISOString(),
	};
}

export type MySqlRepositories = {
	identityUsers: UserIdentityRepository;
	userProfiles: UserProfileRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	medicalInsuranceOrders: MedicalInsuranceOrderRepository;
	medicalInsuranceQueryTasks: MedicalInsuranceQueryTaskRepository;
	medicalInsuranceCredentials: MedicalInsuranceCredentialRepository;
	medicalInsuranceAuthorizations: MedicalInsuranceAuthorizationRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
	appointmentScheduleSnapshots: AppointmentScheduleSnapshotRepository;
	appointmentWrites: AppointmentWriteRepository;
	myDoctors: MyDoctorRepository;
	reportReferences: ReportReferenceRepository;
	outbox: OutboxRepository;
	/** 只供受控维护命令使用；患者 API 和普通 Worker 不应调用。 */
	operations: ManualReviewRepository;
	healthKnowledge: HealthKnowledgeRepository;
};

/**
 * 医保订单 INSERT 的唯一字段清单。
 *
 * 挂号和门诊共用这张订单表；字段每次扩展时必须同时更新这里和下面的
 * 参数数组。占位符由参数数组自动生成，避免再次出现“列 33 个、值 33 个，
 * 但 SQL 只有 32 个 ?”这种只能在线上点击支付后才暴露的问题。
 */
const MEDICAL_INSURANCE_ORDER_INSERT_COLUMNS = [
	"medical_order_id",
	"owner_user_id",
	"patient_id",
	"business_type",
	"order_type",
	"business_id",
	"appointment_id",
	"authorization_id",
	"fee_upload_id",
	"idempotency_key",
	"med_org_ord",
	"chrg_bchno",
	"pay_ord_id",
	"pay_token_hash",
	"mdtrt_id",
	"acct_used_flag",
	"status",
	"ord_stas",
	"total_fen",
	"cash_fen",
	"personal_account_fen",
	"fund_fen",
	"setl_type",
	"revs_token_hash",
	"revs_token_expires_at",
	"last_error",
	"wechat_mix_trade_no",
	"wechat_out_trade_no",
	"wechat_payment_state",
	"wechat_pay_params_ciphertext",
	"version",
	"created_at",
	"updated_at",
] as const;

function sqlParameterPlaceholders(count: number): string {
	return Array.from({ length: count }, () => "?").join(", ");
}

class SqlParameterCountMismatchError extends Error {
	readonly code = "PERSISTENCE_SQL_PARAMETER_COUNT_MISMATCH";

	constructor(
		readonly expected: number,
		readonly actual: number,
	) {
		super("Persistence SQL parameter count mismatch");
		this.name = "SqlParameterCountMismatchError";
	}
}

function assertSqlParameterCount(
	sql: string,
	values: readonly unknown[],
): void {
	const expected = [...sql].filter((character) => character === "?").length;
	if (expected !== values.length) {
		throw new SqlParameterCountMismatchError(expected, values.length);
	}
}

async function execute<T extends RowDataPacket[] | ResultSetHeader>(
	client: Pool | PoolConnection,
	sql: string,
	values: readonly unknown[] = [],
): Promise<T> {
	// 所有 SQL 都先做参数形状校验；这是开发/部署遗漏字段时的最后一道
	// 保护，避免 MySQL 只在真实用户操作时返回 ER_WRONG_VALUE_COUNT_ON_ROW。
	assertSqlParameterCount(sql, values);
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
			throw new PersistenceUnavailableError("read", lastError, "mysql");
		}

		throw new PersistenceUnavailableError(
			isPoolClient(client) ? "write" : "transaction",
			error,
			"mysql",
		);
	}
}

async function withTransaction<T>(
	pool: Pool,
	operation: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
	let connection: PoolConnection;
	try {
		connection = await pool.getConnection();
	} catch (error) {
		// 事务连接申请失败时还没有可 rollback 的连接，但它仍然属于
		// 持久化瞬态故障；统一包装成 transaction，避免调用方看到驱动原文。
		if (isTransientPersistenceError(error)) {
			throw new PersistenceUnavailableError("transaction", error, "mysql");
		}
		throw error;
	}
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

/**
 * MySQL BIGINT/INT 可能按连接配置返回 number 或十进制字符串。
 *
 * 这里只接受这两种真实数据库形态，不使用宽松的 `Number(value)`：
 * `Number([])`、`Number(false)` 等隐式转换会把损坏行伪装成合法的 0，
 * 甚至让预支付版本发生字符串拼接。所有数值读模型在进入领域层前都
 * 必须经过这个统一边界；超出 JavaScript 安全整数也必须停止。
 */
function safeDatabaseInteger(
	value: unknown,
	minimum: number,
	errorMessage: string,
): number {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/u.test(value)
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < minimum) {
		throw new Error(errorMessage);
	}
	return parsed;
}

function safeFen(value: number | string): number {
	return safeDatabaseInteger(
		value,
		0,
		"Persistence returned an invalid amount",
	);
}

function safeSlotCount(value: number | string): number {
	return safeDatabaseInteger(
		value,
		0,
		"Persistence returned an invalid appointment slot count",
	);
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
	"unknown",
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

function userProfile(row: UserProfileRow): UserProfile {
	const version = safeDatabaseInteger(
		row.version,
		0,
		"Persistence returned an invalid user profile version",
	);
	const age =
		row.age === null
			? null
			: safeDatabaseInteger(
					row.age,
					0,
					"Persistence returned an invalid user profile age",
				);
	// MySQL 驱动的类型声明不能证明线上行仍符合业务读模型；例如历史脏数据
	// 可能包含未知 gender 或越界 version。这里必须复用领域层的公开归一化函数，
	// 让仓储异常统一成为 UserProfileReadModelValidationError，继续进入 API 的
	// persistence-invalid 响应和 readModelViolation 日志，而不是泄漏成普通 500。
	return normalizeUserProfileReadModel(
		{
			userId: row.user_id,
			displayName: row.display_name,
			gender: row.gender,
			age,
			email: row.email,
			version,
		},
		row.user_id,
	);
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
		try {
			// 这里故意不用 ON DUPLICATE KEY UPDATE：该表同时有当前患者主键和
			// 外部患者号唯一约束，通用 upsert 会把“另一位患者占用了同一个
			// patId”的数据冲突静默吞掉，导致上层误以为临床映射已同步成功。
			await execute<ResultSetHeader>(
				pool,
				"INSERT INTO hp_patient_provider_references (owner_user_id, patient_id, provider_name, reference_kind, provider_patient_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
			continue;
		} catch (error) {
			if (!isDuplicateEntry(error)) throw error;
		}

		// 重复键可能来自同一患者的幂等重放，也可能来自另一位患者的
		// provider_patient_id。必须按当前主键加锁判别，不能直接更新冲突行。
		const existingRows = await execute<PatientProviderReferenceRow[]>(
			pool,
			"SELECT patient_id, provider_patient_id FROM hp_patient_provider_references WHERE owner_user_id = ? AND patient_id = ? AND provider_name = ? AND reference_kind = ? LIMIT 1 FOR UPDATE",
			[input.ownerUserId, patientId, input.provider, referenceKind],
		);
		const existing = existingRows[0];
		if (!existing) throw new PatientDirectoryReferenceConflictError();
		if (existing.provider_patient_id === providerPatientId) continue;

		try {
			const updated = await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_patient_provider_references SET provider_patient_id = ?, updated_at = ? WHERE owner_user_id = ? AND patient_id = ? AND provider_name = ? AND reference_kind = ?",
				[
					providerPatientId,
					now,
					input.ownerUserId,
					patientId,
					input.provider,
					referenceKind,
				],
			);
			if (updated.affectedRows !== 1) {
				throw new PatientDirectoryReferenceConflictError();
			}
		} catch (error) {
			// 更新时若二级唯一约束仍被其他患者占用，保持同一公共错误，
			// 不把 MySQL 的内部约束名泄露给客户端。
			if (isDuplicateEntry(error)) {
				throw new PatientDirectoryReferenceConflictError();
			}
			throw error;
		}
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
			...(row.title_name ? { titleName: row.title_name } : {}),
			...(row.introduction ? { introduction: row.introduction } : {}),
			...(row.expertise ? { expertise: row.expertise } : {}),
			...(row.department_location
				? { departmentLocation: row.department_location }
				: {}),
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
		// MySQL 返回的是没有时区的 DATETIME 文本；先恢复成领域层约定的
		// ISO UTC，再执行同一套严格观察窗口校验，避免数据库合法值被误判。
		observedAt: mysqlUtcDateTimeToIso(row.observed_at),
		expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
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

function appointmentHold(row: AppointmentHoldRow): AppointmentHold {
	const totalFen = Number(row.total_fen);
	if (!Number.isSafeInteger(totalFen) || totalFen <= 0) {
		throw new Error("Persistence returned an invalid appointment hold amount");
	}
	if (!["held", "consumed", "cancelled", "expired"].includes(row.status)) {
		throw new Error("Persistence returned an invalid appointment hold status");
	}
	return {
		holdId: row.hold_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		scheduleId: row.schedule_id,
		providerScheduleId: row.provider_schedule_id,
		providerSourceId: row.provider_source_id,
		sourceSerialNumber: row.source_serial_number,
		totalFen,
		status: row.status as AppointmentHold["status"],
		idempotencyKey: row.idempotency_key,
		expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
		createdAt: mysqlUtcDateTimeToIso(row.created_at),
		updatedAt: mysqlUtcDateTimeToIso(row.updated_at),
	};
}

function appointmentRegistration(
	row: AppointmentRegistrationRow,
): AppointmentRegistration {
	const totalFen = Number(row.total_fen);
	if (!Number.isSafeInteger(totalFen) || totalFen <= 0) {
		throw new Error("Persistence returned an invalid appointment amount");
	}
	if (!["booked", "cancelled", "unknown"].includes(row.status)) {
		throw new Error("Persistence returned an invalid appointment status");
	}
	return {
		appointmentId: row.appointment_id,
		ownerUserId: row.owner_user_id,
		patientId: row.patient_id,
		holdId: row.hold_id,
		idempotencyKey: row.idempotency_key,
		providerAppointmentId: row.provider_appointment_id,
		providerPatientId: row.provider_patient_id,
		...(row.provider_register_id
			? { providerRegisterId: row.provider_register_id }
			: {}),
		...(row.provider_his_register_id
			? { providerHisRegisterId: row.provider_his_register_id }
			: {}),
		departmentName: row.department_name,
		...(row.department_id ? { departmentId: row.department_id } : {}),
		...(row.doctor_id ? { doctorId: row.doctor_id } : {}),
		doctorName: row.doctor_name,
		workDate: row.work_date,
		shiftName: row.shift_name,
		sourceSerialNumber: row.source_serial_number,
		totalFen,
		status: row.status as AppointmentRegistration["status"],
		createdAt: mysqlUtcDateTimeToIso(row.created_at),
		updatedAt: mysqlUtcDateTimeToIso(row.updated_at),
	};
}

function myDoctor(row: MyDoctorRow): MyDoctor {
	return normalizeMyDoctorReadModel({
		ownerUserId: row.owner_user_id,
		doctorId: row.doctor_id,
		doctorName: row.doctor_name,
		...(row.title_name ? { titleName: row.title_name } : {}),
		...(row.introduction ? { introduction: row.introduction } : {}),
		...(row.expertise ? { expertise: row.expertise } : {}),
		...(row.department_location
			? { departmentLocation: row.department_location }
			: {}),
		departmentName: row.department_name,
		...(row.doctor_avatar_url
			? { doctorAvatarUrl: row.doctor_avatar_url }
			: {}),
		createdAt: mysqlUtcDateTimeToIso(row.created_at),
	});
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
		version: safeDatabaseInteger(
			row.version,
			1,
			"Persistence returned an invalid payment order version",
		),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

const PREPAY_ATTEMPT_STATUSES: readonly PaymentPrepayAttempt["status"][] = [
	"pending",
	"succeeded",
	"unknown",
	"manual_review",
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

function medicalWechatPayParams(
	value: string | null,
	cipher: SecretValueCipher,
): WechatMedicalInsurancePayParams | undefined {
	if (value === null) return undefined;
	const parsed = JSON.parse(cipher.open(value)) as unknown;
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		typeof (parsed as { timeStamp?: unknown }).timeStamp !== "string" ||
		typeof (parsed as { nonceStr?: unknown }).nonceStr !== "string" ||
		typeof (parsed as { package?: unknown }).package !== "string" ||
		(parsed as { signType?: unknown }).signType !== "RSA" ||
		typeof (parsed as { paySign?: unknown }).paySign !== "string" ||
		typeof (parsed as { mixTradeNo?: unknown }).mixTradeNo !== "string"
	) {
		throw new Error("Persistence returned invalid medical Wechat pay params");
	}
	return parsed as WechatMedicalInsurancePayParams;
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
		version: safeDatabaseInteger(
			row.version,
			1,
			"Persistence returned an invalid payment prepay version",
		),
		queryAttempts: safeDatabaseInteger(
			row.query_attempts,
			0,
			"Persistence returned an invalid payment prepay query count",
		),
		...(row.last_queried_at ? { lastQueriedAt: row.last_queried_at } : {}),
		...(row.next_query_at ? { nextQueryAt: row.next_query_at } : {}),
		...(row.query_claimed_until
			? { queryClaimedUntil: row.query_claimed_until }
			: {}),
		...(row.manual_review_at ? { manualReviewAt: row.manual_review_at } : {}),
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
		status: outboxEventStatus(row.status),
		aggregateId: row.aggregate_id,
		payload,
		occurredAt: row.occurred_at,
		availableAt: row.available_at,
		attempts: row.attempts,
		...(row.manual_review_at ? { manualReviewAt: row.manual_review_at } : {}),
	};
}

/**
 * 维护列表只允许回显固定格式的内部原因码。
 *
 * `last_error` 是历史上为了诊断保留的字符串，不能假设未来所有写入方都
 * 只写固定枚举；如果值不符合低敏格式，宁可显示为 unknown，也不能把 SQL、
 * provider 原文或异常参数打印到运维终端。
 */
function safeOperationalReasonCode(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.startsWith("manual-replay:")
		? value.slice("manual-replay:".length)
		: value;
	return /^[a-z][a-z0-9._-]{0,63}$/u.test(normalized) ? normalized : undefined;
}

function manualReviewLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error("Manual review limit must be a positive integer");
	}
	return Math.min(value, 100);
}

function outboxManualReviewItem(
	row: OutboxManualReviewRow,
): OutboxManualReviewItem {
	const attempts = safeDatabaseInteger(
		row.attempts,
		0,
		"Persistence returned an invalid outbox attempts count",
	);
	const reasonCode = safeOperationalReasonCode(row.last_error);
	return {
		kind: "outbox",
		eventId: row.event_id,
		eventName: row.event_name,
		aggregateId: row.aggregate_id,
		attempts,
		occurredAt: row.occurred_at,
		availableAt: row.available_at,
		...(row.manual_review_at ? { manualReviewAt: row.manual_review_at } : {}),
		...(reasonCode ? { reasonCode } : {}),
	};
}

function paymentManualReviewItem(
	row: PaymentManualReviewRow,
): PaymentManualReviewItem {
	if (row.provider !== "wechat-pay" || row.status !== "manual_review") {
		throw new Error(
			"Persistence returned an invalid payment manual review row",
		);
	}
	const lastErrorCode = safeOperationalReasonCode(row.last_error_code);
	return {
		kind: "wechat-payment-query",
		attemptId: row.attempt_id,
		orderId: row.order_id,
		provider: "wechat-pay",
		status: "manual_review",
		version: safeDatabaseInteger(
			row.version,
			1,
			"Persistence returned an invalid payment manual review version",
		),
		queryAttempts: safeDatabaseInteger(
			row.query_attempts,
			0,
			"Persistence returned an invalid payment query attempts count",
		),
		...(row.manual_review_at ? { manualReviewAt: row.manual_review_at } : {}),
		...(lastErrorCode ? { lastErrorCode } : {}),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
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
				(event_id, event_name, status, aggregate_id, payload, occurred_at, available_at, attempts, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE event_id = event_id
		`,
		values: [
			event.eventId,
			event.eventName,
			event.status,
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
		/** 医保 payToken 只允许以独立密钥加密后落库，不能复用支付密钥。 */
		medicalInsuranceCredentialCipher?: SecretValueCipher;
		medicalInsuranceCredentialEncryptionKey?: string;
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
	const medicalInsuranceCredentialCipher =
		options.medicalInsuranceCredentialCipher ??
		(options.medicalInsuranceCredentialEncryptionKey
			? createAesGcmSecretValueCipher(
					options.medicalInsuranceCredentialEncryptionKey,
					{
						keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
						valueName: "medical insurance credential",
					},
				)
			: undefined);
	const requiredMedicalInsuranceCredentialCipher = (): SecretValueCipher => {
		if (!medicalInsuranceCredentialCipher) {
			throw new PersistenceNotConfiguredError("medical-insurance-credentials");
		}
		return medicalInsuranceCredentialCipher;
	};

	/**
	 * 补齐微信身份迟到的 unionId，并始终以数据库最终值作为返回值。
	 *
	 * 首次登录可能先落库一个没有 unionId 的行；另一个并发请求随后才拿到
	 * unionId。这里的条件 UPDATE 只允许把 NULL 补成值，绝不覆盖已经绑定的
	 * unionId。若 UPDATE 没抢到补全权，则重新读取同一 userId，避免把本次
	 * 未生效的候选值伪装成权威身份，进而让患者目录拿错 Provider 身份。
	 */
	async function completeMissingUnionId(
		existing: IdentityUser,
		unionId: string | undefined,
	): Promise<IdentityUser> {
		if (!unionId || existing.unionId) return existing;

		const updateResult = await execute<ResultSetHeader>(
			pool,
			"UPDATE hp_identity_users SET union_id = ?, updated_at = ? WHERE user_id = ? AND union_id IS NULL",
			[unionId, mysqlDateTime(new Date()), existing.userId],
		);
		if (updateResult.affectedRows === 1) {
			return { ...existing, unionId };
		}

		const refreshedRows = await execute<IdentityUserRow[]>(
			pool,
			"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE user_id = ? LIMIT 1",
			[existing.userId],
		);
		return refreshedRows[0] ? identityUser(refreshedRows[0]) : existing;
	}

	const identityUsers: UserIdentityRepository = {
		async findOrCreateByWechat(input) {
			const existingRows = await execute<IdentityUserRow[]>(
				pool,
				"SELECT user_id, provider_subject, union_id FROM hp_identity_users WHERE provider_subject = ? LIMIT 1",
				[input.providerSubject],
			);
			if (existingRows[0]) {
				const existing = identityUser(existingRows[0]);
				return completeMissingUnionId(existing, input.unionId);
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
				// 重复键只说明另一请求先创建了同一 provider subject，并不说明
				// 它已经拿到了 unionId；继续走补全流程，保证本次登录不会因
				// 竞争顺序偶发地签发一个无法同步患者目录的会话。
				return completeMissingUnionId(
					identityUser(racedRows[0]),
					input.unionId,
				);
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

	/**
	 * 在资料写事务内读取并锁定当前用户行。
	 *
	 * 资料 service 已经用 version 做了输入校验，但“读当前版本 → 条件更新 →
	 * 回读响应”如果跨越多个连接池语句，另一个设备可以在最后一次 SELECT 前
	 * 抢先更新，导致本次 PUT 返回别人的 canonical 快照。这个 helper 只接收
	 * 已经从当前事务连接发起的查询，确保版本判断、写入和响应快照属于同一锁
	 * 保护范围；它不接受客户端 owner，也不把个人资料正文写进日志。
	 */
	async function selectUserProfileForUpdate(
		connection: PoolConnection,
		userId: string,
	): Promise<UserProfile | undefined> {
		const rows = await execute<UserProfileRow[]>(
			connection,
			"SELECT user_id, display_name, gender, age, email, version FROM hp_user_profiles WHERE user_id = ? LIMIT 1 FOR UPDATE",
			[userId],
		);
		return rows[0] ? userProfile(rows[0]) : undefined;
	}

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
			return withTransaction(pool, async (connection) => {
				const now = mysqlDateTime(new Date());
				if (input.expectedVersion === 0) {
					try {
						await execute<ResultSetHeader>(
							connection,
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
					// 版本判断和字段补全必须在同一行锁内完成；否则两个设备可能
					// 同时读取同一个旧版本，再让其中一个在 UPDATE 前改变资料。
					const current = await selectUserProfileForUpdate(
						connection,
						input.userId,
					);
					if (!current || current.version !== input.expectedVersion) {
						throw new UserProfileVersionConflictError();
					}
					const result = await execute<ResultSetHeader>(
						connection,
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

				// 返回快照也必须在同一事务中读取。事务提交前当前用户行仍被本次
				// 事务锁定，因此响应不会漂移到另一个设备随后提交的版本。
				const updated = await selectUserProfileForUpdate(
					connection,
					input.userId,
				);
				if (!updated || updated.version !== input.expectedVersion + 1) {
					// 数据库实际版本与本次条件更新不一致时宁可返回冲突，不能把
					// 不确定的资料快照包装成成功响应。
					throw new UserProfileVersionConflictError();
				}
				return updated;
			});
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
					const attemptCount = safeDatabaseInteger(
						row.attempt_count,
						1,
						"Persistence returned an invalid patient sync attempt count",
					);
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

				if (exactRow?.status === "in_progress") {
					const exactLeaseMilliseconds = timestampMilliseconds(
						exactRow.lease_until,
					);
					const nowMilliseconds = timestampMilliseconds(input.now);
					if (
						exactLeaseMilliseconds === undefined ||
						nowMilliseconds === undefined
					) {
						throw new Error(
							"Persistence returned an invalid patient sync lease",
						);
					}
					if (exactLeaseMilliseconds <= nowMilliseconds) {
						// 同一 key 的旧租约过期，不代表 owner/provider 已经空闲。
						// 另一页面可能使用新 key 取得了有效租约；此时必须先返回
						// owner-provider 冲突，不能直接接管旧 key，避免两个请求同时
						// 访问 Provider 并竞争同一份患者快照。
						const activeRows = await execute<
							PatientDirectorySyncOperationRow[]
						>(
							connection,
							"SELECT operation_id, status, attempt_count, lease_until FROM hp_patient_directory_sync_operations WHERE owner_user_id = ? AND provider_name = ? AND status = 'in_progress' AND lease_until > ? AND operation_id <> ? ORDER BY updated_at DESC, operation_id DESC LIMIT 1 FOR UPDATE",
							[input.ownerUserId, input.provider, now, exactRow.operation_id],
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
					}
				}

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
			// 单条 upsert 也必须具备原子性：患者主表更新和临床 patId
			// 映射写入不能一成功一失败，否则会留下“资料已更新但临床身份未
			// 同步”的半状态。完整快照路径同样使用这个 helper，但有自己的
			// 更大事务，不会重复套事务。
			return withTransaction(pool, async (connection) =>
				upsertPatientFromDirectory(connection, input, new Date().toISOString()),
			);
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
			if (input.operationId && !input.completedAt) {
				throw new Error("Patient directory sync completion time is required");
			}
			return withTransaction(pool, async (connection) => {
				const observedAt = mysqlDateTime(input.observedAt);
				const completedAt = input.operationId
					? mysqlDateTime(input.completedAt ?? "")
					: undefined;
				if (input.operationId) {
					// beginDirectorySync 只在请求 Provider 前锁 owner 行；Provider
					// 响应返回后必须再次锁同一行，才能把“检查最新快照、修改目录、
					// 完成 operation”串成一个顺序。否则租约过期的旧请求可能和新
					// operation 同时提交，重新激活新快照已经停用的患者。
					const ownerRows = await execute<RowDataPacket[]>(
						connection,
						"SELECT user_id FROM hp_identity_users WHERE user_id = ? LIMIT 1 FOR UPDATE",
						[input.ownerUserId],
					);
					if (!ownerRows[0]) {
						throw new Error(
							"Patient sync owner disappeared before snapshot commit",
						);
					}
					// 不同幂等键接管后，旧 operation 记录仍可能暂时是
					// in_progress。这里必须在任何患者写入前锁定并核对“当前代次
					// 仍在租约内”，不能只依赖最后的 UPDATE affectedRows：后者
					// 发生在患者 upsert/deactivate 之后，无法阻止过期快照短暂可见。
					const activeOperationRows = await execute<
						PatientDirectorySyncOperationRow[]
					>(
						connection,
						"SELECT operation_id, status, attempt_count, lease_until FROM hp_patient_directory_sync_operations WHERE operation_id = ? AND owner_user_id = ? AND provider_name = ? AND status = 'in_progress' AND attempt_count = ? AND lease_until > ? LIMIT 1 FOR UPDATE",
						[
							input.operationId,
							input.ownerUserId,
							input.provider,
							input.operationAttemptCount,
							completedAt,
						],
					);
					const activeOperation = activeOperationRows[0];
					if (!activeOperation) {
						throw new PatientDirectorySnapshotStaleError();
					}
					// SQL 条件已经做了第一次筛选；这里再按返回值核对一次，
					// 防止驱动、测试替身或未来查询改动把过期 operation 当成
					// 活跃租约继续使用。双重校验仍然必须发生在患者写入之前。
					const leaseUntilMilliseconds = timestampMilliseconds(
						activeOperation.lease_until,
					);
					const completedAtMilliseconds = timestampMilliseconds(completedAt);
					if (
						leaseUntilMilliseconds === undefined ||
						completedAtMilliseconds === undefined
					) {
						throw new Error(
							"Persistence returned an invalid patient sync lease",
						);
					}
					if (leaseUntilMilliseconds <= completedAtMilliseconds) {
						throw new PatientDirectorySnapshotStaleError();
					}
					const newerRows = await execute<
						(RowDataPacket & { observed_at: string | null })[]
					>(
						connection,
						"SELECT observed_at FROM hp_patient_directory_sync_operations WHERE owner_user_id = ? AND provider_name = ? AND status = 'succeeded' AND observed_at IS NOT NULL AND observed_at > ? ORDER BY observed_at DESC LIMIT 1 FOR UPDATE",
						[input.ownerUserId, input.provider, observedAt],
					);
					if (newerRows[0]?.observed_at) {
						// 这里必须在任何患者写入之前拒绝；事务虽然可以回滚，
						// 但先写再报错会扩大锁持有时间，也让排障难以区分
						// “旧快照被拒绝”和“数据库写入失败”。
						throw new PatientDirectorySnapshotStaleError();
					}
				}
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
					const operationCompletedAt = completedAt ?? mysqlDateTime(new Date());
					const completed = await execute<ResultSetHeader>(
						connection,
						"UPDATE hp_patient_directory_sync_operations SET status = 'succeeded', observed_at = ?, completed_at = ?, result_digest = ?, updated_at = ? WHERE operation_id = ? AND owner_user_id = ? AND provider_name = ? AND attempt_count = ? AND status = 'in_progress'",
						[
							observedAt,
							operationCompletedAt,
							patientDirectoryResultDigest(currentRows),
							operationCompletedAt,
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
				// 临床映射表的 provider 归属还必须与患者主表一致。仅过滤
				// provider_refs.provider_name 不够：异常数据修复或历史迁移可能留下
				// “患者主表属于其它 Provider、独立表却有众阳 patId”的交叉记录；
				// 这类记录不能进入预约、报告或费用调用帧，必须在仓储层拒绝。
				const rows = await execute<PatientProviderReferenceRow[]>(
					pool,
					"SELECT provider_refs.patient_id, provider_refs.provider_name, provider_refs.reference_kind, provider_refs.provider_patient_id FROM hp_patient_provider_references AS provider_refs INNER JOIN hp_patients AS patients ON patients.owner_user_id = provider_refs.owner_user_id AND patients.patient_id = provider_refs.patient_id AND patients.provider_name = provider_refs.provider_name WHERE provider_refs.owner_user_id = ? AND provider_refs.patient_id = ? AND provider_refs.provider_name = ? AND provider_refs.reference_kind = ? AND patients.provider_name = ? AND patients.directory_active = 1 LIMIT 1",
					[
						input.ownerUserId,
						input.patientId,
						input.provider,
						referenceKind,
						input.provider,
					],
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
				"SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, manual_review_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE owner_user_id = ? AND order_id = ? AND idempotency_key = ? LIMIT 1",
				[ownerUserId, orderId, idempotencyKey],
			);
			return rows[0] ? paymentPrepayAttempt(rows[0], cipher) : undefined;
		},
		async insert(attempt) {
			const cipher = requiredPrepayCipher();
			try {
				await execute<ResultSetHeader>(
					pool,
					"INSERT INTO hp_payment_prepay_attempts (attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, manual_review_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
						attempt.manualReviewAt
							? mysqlDateTime(attempt.manualReviewAt)
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
				"UPDATE hp_payment_prepay_attempts SET status = ?, version = ?, query_attempts = ?, last_queried_at = ?, next_query_at = ?, query_claimed_until = ?, manual_review_at = ?, prepay_id_hash = ?, pay_params_ciphertext = ?, provider_request_id = ?, last_error_code = ?, updated_at = ? WHERE attempt_id = ? AND owner_user_id = ? AND version = ?",
				[
					attempt.status,
					attempt.version,
					attempt.queryAttempts,
					attempt.lastQueriedAt ? mysqlDateTime(attempt.lastQueriedAt) : null,
					attempt.nextQueryAt ? mysqlDateTime(attempt.nextQueryAt) : null,
					attempt.queryClaimedUntil
						? mysqlDateTime(attempt.queryClaimedUntil)
						: null,
					attempt.manualReviewAt ? mysqlDateTime(attempt.manualReviewAt) : null,
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
					`SELECT attempt_id, owner_user_id, order_id, provider, idempotency_key, status, version, query_attempts, last_queried_at, next_query_at, query_claimed_until, manual_review_at, prepay_id_hash, pay_params_ciphertext, provider_request_id, last_error_code, created_at, updated_at FROM hp_payment_prepay_attempts WHERE next_query_at IS NOT NULL AND next_query_at <= ? AND (query_claimed_until IS NULL OR query_claimed_until <= ?) AND status IN (?, ?, ?) ORDER BY next_query_at, attempt_id LIMIT ${queryLimit} FOR UPDATE SKIP LOCKED`,
					[
						mysqlDateTime(now),
						mysqlDateTime(now),
						"pending",
						"succeeded",
						"unknown",
					],
				);
				for (const row of rows) {
					// MySQL 可能把 INT 版本按字符串返回；先收窄为安全整数，
					// 再用于条件更新和响应递增，禁止 `"3" + 1` 变成 `"31"`。
					const currentVersion = safeDatabaseInteger(
						row.version,
						1,
						"Persistence returned an invalid payment prepay version",
					);
					const result = await execute<ResultSetHeader>(
						connection,
						"UPDATE hp_payment_prepay_attempts SET query_claimed_until = ?, version = version + 1, updated_at = ? WHERE attempt_id = ? AND version = ?",
						[
							mysqlDateTime(claimedUntil),
							mysqlDateTime(now),
							row.attempt_id,
							currentVersion,
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
							version:
								safeDatabaseInteger(
									row.version,
									1,
									"Persistence returned an invalid payment prepay version",
								) + 1,
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
		async findByOwnerPatientAndId(ownerUserId, patientId, reportId, now) {
			const rows = await execute<ReportReferenceRow[]>(
				pool,
				`SELECT report_id, owner_user_id, patient_id, provider, kind,
					provider_report_id, expires_at, created_at
				 FROM hp_report_references
					 WHERE owner_user_id = ? AND patient_id = ? AND report_id = ?
					   AND expires_at > ? LIMIT 1`,
				[ownerUserId, patientId, reportId, mysqlDateTime(now)],
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
					 title_name, introduction, expertise, department_location,
					 doctor_id, doctor_name, work_date, shift_name, start_time, end_time,
					 total_slots, available_slots, time_group, provider_request_id,
					 observed_at, expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE
					provider_schedule_id = IF(observed_at <= VALUES(observed_at), VALUES(provider_schedule_id), provider_schedule_id),
					department_id = IF(observed_at <= VALUES(observed_at), VALUES(department_id), department_id),
					department_name = IF(observed_at <= VALUES(observed_at), VALUES(department_name), department_name),
					title_name = IF(observed_at <= VALUES(observed_at), VALUES(title_name), title_name),
					introduction = IF(observed_at <= VALUES(observed_at), VALUES(introduction), introduction),
					expertise = IF(observed_at <= VALUES(observed_at), VALUES(expertise), expertise),
					department_location = IF(observed_at <= VALUES(observed_at), VALUES(department_location), department_location),
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
					input.schedule.titleName ?? null,
					input.schedule.introduction ?? null,
					input.schedule.expertise ?? null,
					input.schedule.departmentLocation ?? null,
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
					department_name, title_name, introduction, expertise, department_location,
					doctor_id, doctor_name, work_date, shift_name,
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
					department_name, title_name, introduction, expertise, department_location,
					doctor_id, doctor_name, work_date, shift_name,
					start_time, end_time, total_slots, available_slots, time_group,
					provider_request_id, observed_at, expires_at
				 FROM hp_appointment_schedule_snapshots
				 WHERE schedule_id = ? AND expires_at > ? LIMIT 1`,
				[scheduleId, mysqlDateTime(now)],
			);
			return rows[0] ? appointmentScheduleSnapshot(rows[0]) : undefined;
		},
	};

	const myDoctors: MyDoctorRepository = {
		async listByOwner(ownerUserId) {
			const rows = await execute<MyDoctorRow[]>(
				pool,
				`SELECT owner_user_id, doctor_id, doctor_name, title_name, introduction, expertise,
					department_location, department_name, doctor_avatar_url, created_at
				 FROM hp_my_doctors
				 WHERE owner_user_id = ?
				 ORDER BY created_at, relation_id`,
				[ownerUserId],
			);
			return rows.map(myDoctor);
		},
		async findByOwnerAndDoctor(ownerUserId, doctorId) {
			const rows = await execute<MyDoctorRow[]>(
				pool,
				`SELECT owner_user_id, doctor_id, doctor_name, title_name, introduction, expertise,
					department_location, department_name, doctor_avatar_url, created_at
				 FROM hp_my_doctors
				 WHERE owner_user_id = ? AND doctor_id = ? LIMIT 1`,
				[ownerUserId, doctorId],
			);
			return rows[0] ? myDoctor(rows[0]) : undefined;
		},
		async create(input) {
			const createdAt = input.createdAt ?? new Date().toISOString();
			validateMyDoctorCreateInput({ ...input, createdAt });
			const relationId = crypto.randomUUID();
			try {
				await execute<ResultSetHeader>(
					pool,
					`INSERT INTO hp_my_doctors
						(relation_id, owner_user_id, doctor_id, doctor_name, title_name,
						 introduction, expertise, department_location, department_name,
						 doctor_avatar_url,
						 created_at, updated_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						relationId,
						input.ownerUserId,
						input.doctorId,
						input.doctorName,
						input.titleName ?? null,
						input.introduction ?? null,
						input.expertise ?? null,
						input.departmentLocation ?? null,
						input.departmentName,
						input.doctorAvatarUrl ?? null,
						mysqlDateTime(createdAt),
						mysqlDateTime(new Date()),
					],
				);
			} catch (error) {
				if (!isDuplicateEntry(error)) throw error;
				const existing = await myDoctors.findByOwnerAndDoctor(
					input.ownerUserId,
					input.doctorId,
				);
				if (existing) throw new MyDoctorAlreadyExistsError();
				throw error;
			}
			const created = await this.findByOwnerAndDoctor(
				input.ownerUserId,
				input.doctorId,
			);
			if (!created) throw new Error("My doctor was not stored");
			return created;
		},
		async deleteByOwnerAndDoctor(ownerUserId, doctorId) {
			const result = await execute<ResultSetHeader>(
				pool,
				"DELETE FROM hp_my_doctors WHERE owner_user_id = ? AND doctor_id = ?",
				[ownerUserId, doctorId],
			);
			return result.affectedRows === 1;
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
					`SELECT event_id, event_name, status, aggregate_id, payload, occurred_at, available_at, attempts, claimed_until, manual_review_at
					 FROM hp_outbox_events
					 WHERE status = 'pending'
					   AND processed_at IS NULL
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
					"UPDATE hp_outbox_events SET claimed_until = ? WHERE event_id = ? AND status = 'pending' AND processed_at IS NULL",
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
				"UPDATE hp_outbox_events SET status = 'processed', processed_at = ?, claimed_until = NULL WHERE event_id = ? AND status = 'pending' AND processed_at IS NULL",
				[mysqlDateTime(processedAt), eventId],
			);
		},
		async markRetry(eventId, nextAvailableAt, reason) {
			await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_outbox_events SET status = 'pending', available_at = ?, attempts = attempts + 1, claimed_until = NULL, last_error = ? WHERE event_id = ? AND status = 'pending' AND processed_at IS NULL",
				[mysqlDateTime(nextAvailableAt), reason.slice(0, 512), eventId],
			);
		},
		async markManualReview(eventId, manualReviewAt, reason) {
			await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_outbox_events SET status = 'manual_review', attempts = attempts + 1, manual_review_at = ?, claimed_until = NULL, last_error = ? WHERE event_id = ? AND status = 'pending' AND processed_at IS NULL",
				[mysqlDateTime(manualReviewAt), reason.slice(0, 512), eventId],
			);
		},
	};

	/**
	 * 受控人工复核仓储。
	 *
	 * 列表查询只投影运维摘要，不读取 payload 或支付密文；重新入队使用
	 * `status = 'manual_review'` 条件，防止过期的人工操作覆盖另一位操作员
	 * 已经完成的处理。attempt/queryAttempts 不重置，若再次失败仍会很快回到
	 * 人工复核，避免通过人工命令绕过自动重试上限。
	 */
	const operations: ManualReviewRepository = {
		async list(limit) {
			const queryLimit = manualReviewLimit(limit);
			const [outboxRows, paymentRows] = await Promise.all([
				execute<OutboxManualReviewRow[]>(
					pool,
					`SELECT event_id, event_name, aggregate_id, attempts, occurred_at,
						available_at, manual_review_at, last_error
					 FROM hp_outbox_events
					 WHERE status = 'manual_review' AND processed_at IS NULL
					 ORDER BY manual_review_at IS NULL, manual_review_at, event_id
					 LIMIT ${queryLimit}`,
				),
				execute<PaymentManualReviewRow[]>(
					pool,
					`SELECT attempt_id, order_id, provider, status, version, query_attempts,
						manual_review_at, last_error_code, created_at, updated_at
					 FROM hp_payment_prepay_attempts
					 WHERE provider = 'wechat-pay' AND status = 'manual_review'
					 ORDER BY manual_review_at IS NULL, manual_review_at, attempt_id
					 LIMIT ${queryLimit}`,
				),
			]);
			const snapshot: ManualReviewSnapshot = {
				outbox: outboxRows.map(outboxManualReviewItem),
				paymentQueries: paymentRows.map(paymentManualReviewItem),
			};
			return snapshot;
		},
		async requeue({ kind, id, now, reasonCode }) {
			const replayReason = `manual-replay:${reasonCode}` satisfies string;
			if (kind === "outbox") {
				const result = await execute<ResultSetHeader>(
					pool,
					"UPDATE hp_outbox_events SET status = 'pending', available_at = ?, claimed_until = NULL, manual_review_at = NULL, last_error = ? WHERE event_id = ? AND status = 'manual_review' AND processed_at IS NULL",
					[mysqlDateTime(now), replayReason, id],
				);
				return result.affectedRows === 1;
			}

			const result = await execute<ResultSetHeader>(
				pool,
				"UPDATE hp_payment_prepay_attempts SET status = 'pending', next_query_at = ?, query_claimed_until = NULL, manual_review_at = NULL, last_error_code = ?, version = version + 1, updated_at = ? WHERE attempt_id = ? AND provider = 'wechat-pay' AND status = 'manual_review'",
				[mysqlDateTime(now), replayReason, mysqlDateTime(now), id],
			);
			return result.affectedRows === 1;
		},
	};

	const appointmentWrites: AppointmentWriteRepository = {
		async findHold(ownerUserId, holdId) {
			const rows = await execute<AppointmentHoldRow[]>(
				pool,
				`SELECT hold_id, owner_user_id, patient_id, schedule_id, provider_schedule_id,
					provider_source_id, source_serial_number, total_fen, status, idempotency_key,
					expires_at, created_at, updated_at
				 FROM hp_appointment_holds WHERE owner_user_id = ? AND hold_id = ? LIMIT 1`,
				[ownerUserId, holdId],
			);
			return rows[0] ? appointmentHold(rows[0]) : undefined;
		},
		async findHoldByIdempotency(ownerUserId, idempotencyKey) {
			const rows = await execute<AppointmentHoldRow[]>(
				pool,
				`SELECT hold_id, owner_user_id, patient_id, schedule_id, provider_schedule_id,
					provider_source_id, source_serial_number, total_fen, status, idempotency_key,
					expires_at, created_at, updated_at
				 FROM hp_appointment_holds WHERE owner_user_id = ? AND idempotency_key = ? LIMIT 1`,
				[ownerUserId, idempotencyKey],
			);
			return rows[0] ? appointmentHold(rows[0]) : undefined;
		},
		async insertHold(hold) {
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_appointment_holds (
					hold_id, owner_user_id, patient_id, schedule_id, provider_schedule_id,
					provider_source_id, source_serial_number, total_fen, status, idempotency_key,
					expires_at, created_at, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON DUPLICATE KEY UPDATE hold_id = hold_id`,
				[
					hold.holdId,
					hold.ownerUserId,
					hold.patientId,
					hold.scheduleId,
					hold.providerScheduleId,
					hold.providerSourceId,
					hold.sourceSerialNumber,
					hold.totalFen,
					hold.status,
					hold.idempotencyKey,
					mysqlDateTime(hold.expiresAt),
					mysqlDateTime(hold.createdAt),
					mysqlDateTime(hold.updatedAt),
				],
			);
			return (await this.findHold(hold.ownerUserId, hold.holdId)) ?? hold;
		},
		async updateHold(hold, expectedStatus) {
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_appointment_holds SET status = ?, provider_source_id = ?,
					total_fen = ?, expires_at = ?, updated_at = ?
				 WHERE hold_id = ? AND owner_user_id = ?${expectedStatus ? " AND status = ?" : ""}`,
				[
					hold.status,
					hold.providerSourceId,
					hold.totalFen,
					mysqlDateTime(hold.expiresAt),
					mysqlDateTime(hold.updatedAt),
					hold.holdId,
					hold.ownerUserId,
					...(expectedStatus ? [expectedStatus] : []),
				],
			);
			if (result.affectedRows === 0) return undefined;
			return this.findHold(hold.ownerUserId, hold.holdId);
		},
		async findRegistration(ownerUserId, appointmentId) {
			const rows = await execute<AppointmentRegistrationRow[]>(
				pool,
				`SELECT appointment_id, owner_user_id, patient_id, hold_id,
					provider_appointment_id, provider_patient_id, provider_register_id,
					provider_his_register_id, idempotency_key, department_name, department_id, doctor_id, doctor_name, work_date,
					shift_name, source_serial_number, total_fen, status, created_at, updated_at
				 FROM hp_appointment_registrations
				 WHERE owner_user_id = ? AND appointment_id = ? LIMIT 1`,
				[ownerUserId, appointmentId],
			);
			return rows[0] ? appointmentRegistration(rows[0]) : undefined;
		},
		async findRegistrationByIdempotency(ownerUserId, idempotencyKey) {
			const rows = await execute<AppointmentRegistrationRow[]>(
				pool,
				`SELECT appointment_id, owner_user_id, patient_id, hold_id,
					provider_appointment_id, provider_patient_id, provider_register_id,
					provider_his_register_id, idempotency_key, department_name, department_id, doctor_id, doctor_name, work_date,
					shift_name, source_serial_number, total_fen, status, created_at, updated_at
				 FROM hp_appointment_registrations
				 WHERE owner_user_id = ? AND idempotency_key = ? LIMIT 1`,
				[ownerUserId, idempotencyKey],
			);
			return rows[0] ? appointmentRegistration(rows[0]) : undefined;
		},
		async findActiveRegistration(input) {
			const rows = await execute<AppointmentRegistrationRow[]>(
				pool,
				`SELECT appointment_id, owner_user_id, patient_id, hold_id,
					provider_appointment_id, provider_patient_id, provider_register_id,
					provider_his_register_id, idempotency_key, department_name, department_id, doctor_id, doctor_name, work_date,
					shift_name, source_serial_number, total_fen, status, created_at, updated_at
				 FROM hp_appointment_registrations
				 WHERE owner_user_id = ? AND patient_id = ? AND work_date = ?
				   AND department_name = ? AND status = 'booked' LIMIT 1`,
				[
					input.ownerUserId,
					input.patientId,
					input.workDate,
					input.departmentName,
				],
			);
			return rows[0] ? appointmentRegistration(rows[0]) : undefined;
		},
		async insertRegistration(registration) {
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_appointment_registrations (
					appointment_id, owner_user_id, patient_id, hold_id,
					provider_appointment_id, provider_patient_id, provider_register_id,
					provider_his_register_id, idempotency_key, department_name, department_id, doctor_id, doctor_name, work_date,
					shift_name, source_serial_number, total_fen, status, created_at, updated_at
				) VALUES (
					?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
					?, ?, ?, ?, ?, ?, ?, ?, ?, ?
				)
				ON DUPLICATE KEY UPDATE appointment_id = appointment_id`,
				[
					registration.appointmentId,
					registration.ownerUserId,
					registration.patientId,
					registration.holdId,
					registration.providerAppointmentId,
					registration.providerPatientId,
					registration.providerRegisterId ?? null,
					registration.providerHisRegisterId ?? null,
					registration.idempotencyKey,
					registration.departmentName,
					registration.departmentId ?? null,
					registration.doctorId ?? null,
					registration.doctorName,
					registration.workDate,
					registration.shiftName,
					registration.sourceSerialNumber,
					registration.totalFen,
					registration.status,
					mysqlDateTime(registration.createdAt),
					mysqlDateTime(registration.updatedAt),
				],
			);
			return (
				(await this.findRegistration(
					registration.ownerUserId,
					registration.appointmentId,
				)) ?? registration
			);
		},
		async updateRegistration(registration, expectedStatus) {
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_appointment_registrations SET status = ?, updated_at = ?
				 WHERE appointment_id = ? AND owner_user_id = ?${expectedStatus ? " AND status = ?" : ""}`,
				[
					registration.status,
					mysqlDateTime(registration.updatedAt),
					registration.appointmentId,
					registration.ownerUserId,
					...(expectedStatus ? [expectedStatus] : []),
				],
			);
			if (result.affectedRows === 0) return undefined;
			return this.findRegistration(
				registration.ownerUserId,
				registration.appointmentId,
			);
		},
	};

	const medicalInsuranceOrders: MedicalInsuranceOrderRepository = {
		async insert(order) {
			const values = [
				order.medicalOrderId,
				order.ownerUserId,
				order.patientId,
				order.businessType ?? "registration",
				order.orderType ?? "RegPay",
				order.businessId ?? order.appointmentId ?? null,
				order.appointmentId ?? null,
				order.authorizationId ?? null,
				order.feeUploadId ?? null,
				order.idempotencyKey,
				order.medOrgOrd,
				order.chrgBchno,
				order.payOrdId,
				order.payTokenHash,
				order.mdtrtId ?? null,
				order.acctUsedFlag ?? null,
				order.status,
				order.ordStas,
				order.amounts?.totalFen ?? 0,
				order.amounts?.cashFen ?? 0,
				order.amounts?.personalAccountFen ?? 0,
				order.amounts?.fundFen ?? 0,
				order.setlType,
				order.revsTokenHash,
				order.revsTokenExpiresAt,
				order.lastError,
				order.wechatMixTradeNo ?? null,
				order.wechatOutTradeNo ?? null,
				order.wechatPaymentState ?? "not_started",
				order.wechatPayParams
					? requiredPrepayCipher().seal(JSON.stringify(order.wechatPayParams))
					: null,
				order.version,
				mysqlDateTime(order.createdAt),
				mysqlDateTime(order.updatedAt),
			] satisfies readonly unknown[];
			if (values.length !== MEDICAL_INSURANCE_ORDER_INSERT_COLUMNS.length) {
				throw new SqlParameterCountMismatchError(
					MEDICAL_INSURANCE_ORDER_INSERT_COLUMNS.length,
					values.length,
				);
			}
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_medical_insurance_orders (${MEDICAL_INSURANCE_ORDER_INSERT_COLUMNS.join(", ")}) VALUES (${sqlParameterPlaceholders(values.length)})`,
				values,
			);
			return order;
		},
		async findByPayOrdId(payOrdId) {
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE pay_ord_id = ? LIMIT 1`,
				[payOrdId],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
		async findByMedicalOrderId(medicalOrderId) {
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE medical_order_id = ? LIMIT 1`,
				[medicalOrderId],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
		async findByOwnerAndAppointmentId(ownerUserId, appointmentId) {
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE owner_user_id = ? AND appointment_id = ? LIMIT 1`,
				[ownerUserId, appointmentId],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
		async findByOwnerAndBusinessKey(ownerUserId, businessType, businessId) {
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE owner_user_id = ? AND business_type = ? AND business_id = ? LIMIT 1`,
				[ownerUserId, businessType, businessId],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE owner_user_id = ? AND idempotency_key = ? LIMIT 1`,
				[ownerUserId, idempotencyKey],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
		async saveSettlementContext(ownerUserId, medicalOrderId, context) {
			const cipher = requiredMedicalInsuranceCredentialCipher();
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_medical_insurance_orders
				 SET settlement_context_ciphertext = ?, updated_at = NOW(3)
				 WHERE medical_order_id = ? AND owner_user_id = ?`,
				[
					cipher.seal(serializeMedicalInsuranceSettlementContext(context)),
					medicalOrderId,
					ownerUserId,
				],
			);
			if (result.affectedRows !== 1) {
				throw new Error(
					"Medical insurance settlement context order is unavailable",
				);
			}
		},
		async getSettlementContext(ownerUserId, medicalOrderId) {
			const cipher = requiredMedicalInsuranceCredentialCipher();
			const rows = await execute<
				(RowDataPacket & { settlement_context_ciphertext: string | null })[]
			>(
				pool,
				`SELECT settlement_context_ciphertext
				 FROM hp_medical_insurance_orders
				 WHERE medical_order_id = ? AND owner_user_id = ? LIMIT 1`,
				[medicalOrderId, ownerUserId],
			);
			const ciphertext = rows[0]?.settlement_context_ciphertext;
			return ciphertext
				? deserializeMedicalInsuranceSettlementContext(cipher.open(ciphertext))
				: undefined;
		},
		async applySettlement(medicalOrderId, expectedVersion, patch) {
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_medical_insurance_orders SET
					status = ?, ord_stas = ?, total_fen = ?, cash_fen = ?, personal_account_fen = ?, fund_fen = ?,
					pay_ord_id = COALESCE(?, pay_ord_id), pay_token_hash = COALESCE(?, pay_token_hash),
					mdtrt_id = COALESCE(?, mdtrt_id),
					acct_used_flag = COALESCE(?, acct_used_flag),
					setl_type = ?, revs_token_hash = ?, revs_token_expires_at = ?,
					business_type = COALESCE(?, business_type), order_type = COALESCE(?, order_type),
					business_id = COALESCE(?, business_id), appointment_id = COALESCE(?, appointment_id),
					authorization_id = COALESCE(?, authorization_id),
					fee_upload_id = COALESCE(?, fee_upload_id),
					wechat_mix_trade_no = COALESCE(?, wechat_mix_trade_no),
					wechat_out_trade_no = COALESCE(?, wechat_out_trade_no),
					wechat_payment_state = COALESCE(?, wechat_payment_state),
					wechat_pay_params_ciphertext = COALESCE(?, wechat_pay_params_ciphertext),
					version = version + 1, updated_at = NOW(3)
				WHERE medical_order_id = ? AND version = ?`,
				[
					patch.status,
					patch.ordStas,
					patch.amounts?.totalFen ?? 0,
					patch.amounts?.cashFen ?? 0,
					patch.amounts?.personalAccountFen ?? 0,
					patch.amounts?.fundFen ?? 0,
					patch.payOrdId ?? null,
					patch.payTokenHash ?? null,
					patch.mdtrtId ?? null,
					patch.acctUsedFlag ?? null,
					patch.setlType,
					patch.revsTokenHash,
					patch.revsTokenExpiresAt,
					patch.businessType ?? null,
					patch.orderType ?? null,
					patch.businessId ?? null,
					patch.appointmentId ?? null,
					patch.authorizationId ?? null,
					patch.feeUploadId ?? null,
					patch.wechatMixTradeNo ?? null,
					patch.wechatOutTradeNo ?? null,
					patch.wechatPaymentState ?? null,
					patch.wechatPayParams === undefined
						? null
						: patch.wechatPayParams === null
							? null
							: requiredPrepayCipher().seal(
									JSON.stringify(patch.wechatPayParams),
								),
					medicalOrderId,
					expectedVersion,
				],
			);
			if (result.affectedRows === 0) return undefined;
			const rows = await execute<MIRow[]>(
				pool,
				`${MI_SELECT} WHERE medical_order_id = ? LIMIT 1`,
				[medicalOrderId],
			);
			return rows[0] ? miOrder(rows[0], prepayCipher) : undefined;
		},
	};

	/**
	 * 医保 6301 查单任务仓储。
	 *
	 * claim 在短事务内锁定最早到期任务，再把状态改为 in_progress 并递增
	 * version；Provider 调用发生在事务提交之后，避免长时间占用数据库行锁。
	 * update 使用 claim 后的版本做 CAS，过期 Worker 不能覆盖新一轮查单结果。
	 */
	const medicalInsuranceQueryTasks: MedicalInsuranceQueryTaskRepository = {
		async insert(task) {
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_medical_insurance_query_tasks
					(task_id, medical_order_id, status, attempts, max_attempts, version,
					 next_attempt_at, claimed_until, terminal_ord_stas, last_error_code,
					 created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE task_id = task_id`,
				[
					task.taskId,
					task.medicalOrderId,
					task.status,
					task.attempts,
					task.maxAttempts,
					task.version,
					mysqlDateTime(task.nextAttemptAt),
					task.claimedUntil ? mysqlDateTime(task.claimedUntil) : null,
					task.terminalOrdStas,
					task.lastErrorCode,
					mysqlDateTime(task.createdAt),
					mysqlDateTime(task.updatedAt),
				],
			);
			const rows = await execute<MedicalInsuranceQueryTaskRow[]>(
				pool,
				`SELECT task_id, medical_order_id, status, attempts, max_attempts,
					version, next_attempt_at, claimed_until, terminal_ord_stas,
					last_error_code, created_at, updated_at
				 FROM hp_medical_insurance_query_tasks WHERE task_id = ? LIMIT 1`,
				[task.taskId],
			);
			const existing = rows[0];
			if (!existing) {
				throw new Error(
					"Medical insurance query task disappeared after insert",
				);
			}
			const persisted = medicalInsuranceQueryTask(existing);
			if (!sameMedicalInsuranceQueryTask(persisted, task)) {
				throw new Error(
					"Medical insurance query task idempotency payload changed",
				);
			}
			return persisted;
		},
		async claimDueForQuery(now, limit, leaseMs) {
			if (
				!Number.isSafeInteger(limit) ||
				limit <= 0 ||
				!Number.isSafeInteger(leaseMs) ||
				leaseMs <= 0
			) {
				return [];
			}
			const boundedLimit = Math.min(limit, 100);
			const nowValue = mysqlDateTime(now);
			const leaseUntil = mysqlDateTime(new Date(now.getTime() + leaseMs));
			return withTransaction(pool, async (connection) => {
				const rows = await execute<MedicalInsuranceQueryTaskRow[]>(
					connection,
					`SELECT task_id, medical_order_id, status, attempts, max_attempts,
						version, next_attempt_at, claimed_until, terminal_ord_stas,
						last_error_code, created_at, updated_at
					 FROM hp_medical_insurance_query_tasks
					 WHERE status = 'pending'
					   AND next_attempt_at <= ?
					   AND (claimed_until IS NULL OR claimed_until <= ?)
					 ORDER BY next_attempt_at ASC, task_id ASC
					 LIMIT ${boundedLimit} FOR UPDATE`,
					[nowValue, nowValue],
				);
				const claimed: MedicalInsuranceQueryTask[] = [];
				for (const row of rows) {
					const currentVersion = safeDatabaseInteger(
						row.version,
						1,
						"Persistence returned an invalid medical insurance query task version",
					);
					const result = await execute<ResultSetHeader>(
						connection,
						`UPDATE hp_medical_insurance_query_tasks
						 SET status = 'in_progress', claimed_until = ?,
						     version = version + 1, updated_at = ?
						 WHERE task_id = ? AND status = 'pending' AND version = ?`,
						[leaseUntil, nowValue, row.task_id, currentVersion],
					);
					if (result.affectedRows !== 1) continue;
					claimed.push(
						medicalInsuranceQueryTask({
							...row,
							status: "in_progress",
							version: currentVersion + 1,
							claimed_until: leaseUntil,
							updated_at: nowValue,
						}),
					);
				}
				return claimed;
			});
		},
		async update(task, expectedVersion) {
			if (
				!Number.isSafeInteger(expectedVersion) ||
				expectedVersion < 1 ||
				task.version !== expectedVersion + 1
			) {
				throw new Error(
					"Medical insurance query task version update is invalid",
				);
			}
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_medical_insurance_query_tasks SET
					status = ?, attempts = ?, max_attempts = ?, version = ?,
					next_attempt_at = ?, claimed_until = ?, terminal_ord_stas = ?,
					last_error_code = ?, updated_at = ?
				 WHERE task_id = ? AND version = ?`,
				[
					task.status,
					task.attempts,
					task.maxAttempts,
					task.version,
					mysqlDateTime(task.nextAttemptAt),
					task.claimedUntil ? mysqlDateTime(task.claimedUntil) : null,
					task.terminalOrdStas,
					task.lastErrorCode,
					mysqlDateTime(task.updatedAt),
					task.taskId,
					expectedVersion,
				],
			);
			if (result.affectedRows !== 1) {
				throw new Error(
					"Medical insurance query task was changed by another worker",
				);
			}
			const rows = await execute<MedicalInsuranceQueryTaskRow[]>(
				pool,
				`SELECT task_id, medical_order_id, status, attempts, max_attempts,
					version, next_attempt_at, claimed_until, terminal_ord_stas,
					last_error_code, created_at, updated_at
				 FROM hp_medical_insurance_query_tasks WHERE task_id = ? LIMIT 1`,
				[task.taskId],
			);
			if (!rows[0]) {
				throw new Error(
					"Medical insurance query task disappeared after update",
				);
			}
			return medicalInsuranceQueryTask(rows[0]);
		},
	};

	/**
	 * 医保授权解析后的短期上下文仓储。
	 *
	 * payAuthNo、ecToken、参保号、openid 和实名字段全部进入同一个独立密文
	 * 载荷；订单表只保存 authorization_id，授权接口重试时仍按 owner/订单取回。
	 */
	const medicalInsuranceAuthorizations: MedicalInsuranceAuthorizationRepository =
		{
			async put(input) {
				const cipher = requiredMedicalInsuranceCredentialCipher();
				const payload = JSON.stringify({
					providerSubject: input.providerSubject,
					payAuthNo: input.payAuthNo,
					patient: input.patient,
					psnNo: input.psnNo,
					insutype: input.insutype,
					insuplcAdmdvs: input.insuplcAdmdvs,
					insuCode: input.insuCode,
					...(input.ecToken ? { ecToken: input.ecToken } : {}),
					...(input.regionCode ? { regionCode: input.regionCode } : {}),
				});
				await execute<ResultSetHeader>(
					pool,
					`INSERT INTO hp_medical_insurance_authorizations
					(authorization_id, owner_user_id, medical_order_id, payload_ciphertext,
					 expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON DUPLICATE KEY UPDATE authorization_id = authorization_id`,
					[
						input.authorizationId,
						input.ownerUserId,
						input.medicalOrderId,
						cipher.seal(payload),
						mysqlDateTime(input.expiresAt),
						mysqlDateTime(input.createdAt),
						mysqlDateTime(input.createdAt),
					],
				);
				const rows = await execute<MedicalInsuranceAuthorizationRow[]>(
					pool,
					`SELECT authorization_id, owner_user_id, medical_order_id,
					payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_authorizations
				 WHERE authorization_id = ? LIMIT 1`,
					[input.authorizationId],
				);
				const row = rows[0];
				if (!row)
					throw new Error(
						"Medical insurance authorization disappeared after insert",
					);
				const existingPayload = deserializeMedicalInsuranceAuthorizationPayload(
					cipher.open(row.payload_ciphertext),
				);
				if (
					row.owner_user_id !== input.ownerUserId ||
					row.medical_order_id !== input.medicalOrderId ||
					row.expires_at.toString() !== mysqlDateTime(input.expiresAt) ||
					JSON.stringify(existingPayload) !== payload
				) {
					throw new Error(
						"Medical insurance authorization idempotency payload changed",
					);
				}
				return {
					authorizationId: row.authorization_id,
					ownerUserId: row.owner_user_id,
					medicalOrderId: row.medical_order_id,
					expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
					createdAt: mysqlUtcDateTimeToIso(row.created_at),
				};
			},
			async get(input) {
				const cipher = requiredMedicalInsuranceCredentialCipher();
				const rows = await execute<MedicalInsuranceAuthorizationRow[]>(
					pool,
					`SELECT authorization_id, owner_user_id, medical_order_id,
					payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_authorizations
				 WHERE authorization_id = ? AND owner_user_id = ? AND medical_order_id = ?
				   AND expires_at > ? LIMIT 1`,
					[
						input.authorizationId,
						input.ownerUserId,
						input.medicalOrderId,
						mysqlDateTime(input.now),
					],
				);
				const row = rows[0];
				if (!row) return undefined;
				return {
					authorizationId: row.authorization_id,
					ownerUserId: row.owner_user_id,
					medicalOrderId: row.medical_order_id,
					expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
					createdAt: mysqlUtcDateTimeToIso(row.created_at),
					...deserializeMedicalInsuranceAuthorizationPayload(
						cipher.open(row.payload_ciphertext),
					),
				} satisfies MedicalInsuranceAuthorizationContext;
			},
			async getActiveForOrder(input) {
				const cipher = requiredMedicalInsuranceCredentialCipher();
				const rows = await execute<MedicalInsuranceAuthorizationRow[]>(
					pool,
					`SELECT authorization_id, owner_user_id, medical_order_id,
					payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_authorizations
				 WHERE owner_user_id = ? AND medical_order_id = ? AND expires_at > ?
				 ORDER BY created_at DESC, authorization_id DESC LIMIT 1`,
					[input.ownerUserId, input.medicalOrderId, mysqlDateTime(input.now)],
				);
				const row = rows[0];
				if (!row) return undefined;
				return {
					authorizationId: row.authorization_id,
					ownerUserId: row.owner_user_id,
					medicalOrderId: row.medical_order_id,
					expiresAt: mysqlUtcDateTimeToIso(row.expires_at),
					createdAt: mysqlUtcDateTimeToIso(row.created_at),
					...deserializeMedicalInsuranceAuthorizationPayload(
						cipher.open(row.payload_ciphertext),
					),
				} satisfies MedicalInsuranceAuthorizationContext;
			},
		};

	/**
	 * 医保 6201 凭证上下文仓储。
	 *
	 * 数据库只接触 AES-GCM 密文；payToken 仅在 `get` 解密后短暂存在于当前
	 * provider 调用栈。查询同时绑定 owner、订单、用途和过期时间，避免一个
	 * 用户/订单拿到另一个上下文的凭证。
	 */
	const medicalInsuranceCredentials: MedicalInsuranceCredentialRepository = {
		async put(input) {
			const cipher = requiredMedicalInsuranceCredentialCipher();
			if (
				!isValidMedicalInsuranceProviderQueryIdentity(
					input.providerQueryIdentity,
				)
			) {
				throw new Error("Medical insurance provider query identity is invalid");
			}
			const payloadCiphertext = cipher.seal(
				serializeMedicalInsuranceCredentialPayload({
					payToken: input.payToken,
					providerQueryIdentity: input.providerQueryIdentity,
				}),
			);
			await execute<ResultSetHeader>(
				pool,
				`INSERT INTO hp_medical_insurance_credentials
					(credential_id, owner_user_id, medical_order_id, pay_ord_id, purpose,
					 payload_ciphertext, expires_at, created_at, updated_at, revoked_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
				 ON DUPLICATE KEY UPDATE credential_id = credential_id`,
				[
					input.credentialId,
					input.ownerUserId,
					input.medicalOrderId,
					input.payOrdId,
					input.purpose,
					payloadCiphertext,
					mysqlDateTime(input.expiresAt),
					mysqlDateTime(input.createdAt),
					mysqlDateTime(input.createdAt),
				],
			);
			const rows = await execute<MedicalInsuranceCredentialRow[]>(
				pool,
				`SELECT credential_id, owner_user_id, medical_order_id, pay_ord_id,
					purpose, payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_credentials
				 WHERE credential_id = ? LIMIT 1`,
				[input.credentialId],
			);
			const existing = rows[0];
			if (!existing) {
				throw new Error(
					"Medical insurance credential disappeared after insert",
				);
			}
			const handle = medicalInsuranceCredentialHandle(existing);
			const existingPayload = deserializeMedicalInsuranceCredentialPayload(
				cipher.open(existing.payload_ciphertext),
			);
			if (
				handle.ownerUserId !== input.ownerUserId ||
				handle.medicalOrderId !== input.medicalOrderId ||
				handle.payOrdId !== input.payOrdId ||
				handle.purpose !== input.purpose ||
				handle.expiresAt !== new Date(input.expiresAt).toISOString() ||
				handle.createdAt !== new Date(input.createdAt).toISOString() ||
				existingPayload.payToken !== input.payToken ||
				JSON.stringify(existingPayload.providerQueryIdentity) !==
					JSON.stringify(input.providerQueryIdentity)
			) {
				throw new Error(
					"Medical insurance credential idempotency payload changed",
				);
			}
			return handle;
		},
		async get(input) {
			const cipher = requiredMedicalInsuranceCredentialCipher();
			const rows = await execute<MedicalInsuranceCredentialRow[]>(
				pool,
				`SELECT credential_id, owner_user_id, medical_order_id, pay_ord_id,
					purpose, payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_credentials
				 WHERE credential_id = ? AND owner_user_id = ? AND medical_order_id = ?
				   AND purpose = ? AND revoked_at IS NULL AND expires_at > ?
				 LIMIT 1`,
				[
					input.credentialId,
					input.ownerUserId,
					input.medicalOrderId,
					input.purpose,
					mysqlDateTime(input.now),
				],
			);
			const row = rows[0];
			if (!row) return undefined;
			const handle = medicalInsuranceCredentialHandle(row);
			const payload = deserializeMedicalInsuranceCredentialPayload(
				cipher.open(row.payload_ciphertext),
			);
			return {
				...handle,
				payToken: payload.payToken,
				providerQueryIdentity: payload.providerQueryIdentity,
			} satisfies MedicalInsuranceCredentialContext;
		},
		async getActiveForOrder(input) {
			const cipher = requiredMedicalInsuranceCredentialCipher();
			const rows = await execute<MedicalInsuranceCredentialRow[]>(
				pool,
				`SELECT credential_id, owner_user_id, medical_order_id, pay_ord_id,
					purpose, payload_ciphertext, expires_at, created_at
				 FROM hp_medical_insurance_credentials
				 WHERE owner_user_id = ? AND medical_order_id = ? AND purpose = ?
				   AND revoked_at IS NULL AND expires_at > ?
				 ORDER BY created_at DESC, credential_id DESC LIMIT 1`,
				[
					input.ownerUserId,
					input.medicalOrderId,
					input.purpose,
					mysqlDateTime(input.now),
				],
			);
			const row = rows[0];
			if (!row) return undefined;
			const handle = medicalInsuranceCredentialHandle(row);
			const payload = deserializeMedicalInsuranceCredentialPayload(
				cipher.open(row.payload_ciphertext),
			);
			return {
				...handle,
				payToken: payload.payToken,
				providerQueryIdentity: payload.providerQueryIdentity,
			} satisfies MedicalInsuranceCredentialContext;
		},
		async revoke(input) {
			const result = await execute<ResultSetHeader>(
				pool,
				`UPDATE hp_medical_insurance_credentials
				 SET payload_ciphertext = '', revoked_at = ?, updated_at = ?
				 WHERE credential_id = ? AND owner_user_id = ? AND medical_order_id = ?
				   AND revoked_at IS NULL`,
				[
					mysqlDateTime(input.now),
					mysqlDateTime(input.now),
					input.credentialId,
					input.ownerUserId,
					input.medicalOrderId,
				],
			);
			return result.affectedRows === 1;
		},
	};

	return {
		identityUsers,
		userProfiles,
		patients,
		paymentOrders,
		medicalInsuranceOrders,
		medicalInsuranceQueryTasks,
		medicalInsuranceAuthorizations,
		medicalInsuranceCredentials,
		paymentQuotes,
		paymentPrepayAttempts,
		wechatPaymentNotifications,
		appointmentScheduleSnapshots,
		appointmentWrites,
		myDoctors,
		reportReferences,
		outbox,
		operations,
		healthKnowledge: createMySqlHealthKnowledgeRepository(pool),
	};
}

function sameMedicalInsuranceQueryTask(
	left: MedicalInsuranceQueryTask,
	right: MedicalInsuranceQueryTask,
): boolean {
	return (
		left.taskId === right.taskId && left.medicalOrderId === right.medicalOrderId
	);
}
