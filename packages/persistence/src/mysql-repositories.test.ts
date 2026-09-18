import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceSettlementContext,
	OutboxEvent,
	PaymentOrder,
	PaymentPrepayAttempt,
	WechatPaymentNotification,
} from "@hospital/domain";
import {
	createWechatPaymentNotificationEvent,
	PatientDirectoryReferenceConflictError,
	UserProfileReadModelValidationError,
	UserProfileVersionConflictError,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { PersistenceUnavailableError } from "./errors";
import { createMySqlRepositories } from "./mysql-repositories";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

type FakeConnectionState = {
	statements: string[];
	values: unknown[][];
	committed: boolean;
	rolledBack: boolean;
	responses: unknown[];
};

function createFakePool(responses: unknown[] = []): {
	pool: Pool;
	state: FakeConnectionState;
} {
	const state: FakeConnectionState = {
		statements: [],
		values: [],
		committed: false,
		rolledBack: false,
		responses: [...responses],
	};
	const connection = {
		async beginTransaction() {},
		async commit() {
			state.committed = true;
		},
		async rollback() {
			state.rolledBack = true;
		},
		release() {},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			const response = state.responses.shift();
			if (response instanceof Error) throw response;
			return [response ?? { affectedRows: 1 }, []];
		},
	};
	const pool = {
		async getConnection() {
			return connection;
		},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			const response = state.responses.shift();
			if (response instanceof Error) throw response;
			return [response ?? [], []];
		},
	} as unknown as Pool;

	return { pool, state };
}

const order: PaymentOrder = {
	orderId: "order-001",
	ownerUserId: "user-001",
	patientId: "patient-001",
	idempotencyKey: "idempotency-001",
	amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
	state: "created",
	version: 1,
	createdAt: "2026-08-15T00:00:00.000Z",
	updatedAt: "2026-08-15T00:00:00.000Z",
};

const createdEvent: OutboxEvent = {
	eventId: "payment-order:order-001:created",
	eventName: "payment-order.created",
	status: "pending",
	aggregateId: "order-001",
	payload: { orderId: "order-001", state: "created" },
	occurredAt: order.updatedAt,
	availableAt: order.updatedAt,
	attempts: 0,
};

function protocolConnectionLostError(): Error & { code: string } {
	const error = new Error("socket closed") as Error & { code: string };
	error.code = "PROTOCOL_CONNECTION_LOST";
	return error;
}

function duplicateEntryError(): Error & { code: string } {
	const error = new Error("duplicate provider subject") as Error & {
		code: string;
	};
	error.code = "ER_DUP_ENTRY";
	return error;
}

test("MySQL idempotent reads recover within the bounded retry window", async () => {
	let attempts = 0;
	const pool = {
		async getConnection() {
			throw new Error("transaction connection is not used");
		},
		async execute() {
			attempts += 1;
			if (attempts < 3) throw protocolConnectionLostError();
			return [
				[
					{
						patient_id: "patient-001",
						owner_user_id: "user-001",
						display_name: "张三",
						relationship: "self",
						card_number_masked: "******7890",
						source: "hospital-his",
						clinical_access: "ready",
						provider_name: "zhongyang",
						provider_patient_id: "provider-patient-001",
					},
				],
				[],
			];
		},
	} as unknown as Pool;

	const repositories = createMySqlRepositories(pool);
	await expect(
		repositories.patients.listByOwner("user-001"),
	).resolves.toHaveLength(1);
	expect(attempts).toBe(3);
});

test("MySQL read recovery stops after the bounded retry window", async () => {
	let attempts = 0;
	const pool = {
		async getConnection() {
			throw new Error("transaction connection is not used");
		},
		async execute() {
			attempts += 1;
			throw protocolConnectionLostError();
		},
	} as unknown as Pool;
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.listByOwner("user-001"),
	).rejects.toMatchObject({
		name: "PersistenceUnavailableError",
		operation: "read",
		errorCode: "PROTOCOL_CONNECTION_LOST",
	});
	expect(attempts).toBe(3);
});

test("MySQL 微信身份重复键竞争后仍补齐迟到的 unionId", async () => {
	const { pool, state } = createFakePool([
		[],
		duplicateEntryError(),
		[
			{
				user_id: "user-raced-001",
				provider_subject: "openid-raced-001",
				union_id: null,
			},
		],
		// 模拟另一个并发请求在本请求读取胜出行后先补齐 unionId；本请求
		// 的条件更新因此没有抢到写入权，必须继续回读数据库权威值。
		{ affectedRows: 0 },
		[
			{
				user_id: "user-raced-001",
				provider_subject: "openid-raced-001",
				union_id: "union-raced-001",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.identityUsers.findOrCreateByWechat({
			providerSubject: "openid-raced-001",
			unionId: "union-raced-001",
		}),
	).resolves.toEqual({
		userId: "user-raced-001",
		providerSubject: "openid-raced-001",
		unionId: "union-raced-001",
	});
	// 关键顺序是：首次查询、插入竞争、读取胜出行、条件补全、权威回读。
	// 测试不允许重复键分支直接返回没有 unionId 的 raced 行。
	expect(state.statements).toHaveLength(5);
	expect(state.statements[3]).toContain("union_id IS NULL");
	expect(state.values[3]).toContain("user-raced-001");
});

test("MySQL transient write failures become a safe persistence error", async () => {
	const pool = {
		async getConnection() {
			throw protocolConnectionLostError();
		},
		async execute() {
			throw protocolConnectionLostError();
		},
	} as unknown as Pool;
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.upsertFromDirectory({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			profile: {
				providerPatientId: "provider-patient-001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "******7890",
			},
		}),
	).rejects.toBeInstanceOf(PersistenceUnavailableError);
});

test("MySQL order insert commits order and outbox in one transaction", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);

	expect(await repositories.paymentOrders.insert(order, createdEvent)).toEqual(
		order,
	);
	expect(state.committed).toBe(true);
	expect(state.rolledBack).toBe(false);
	expect(state.statements).toHaveLength(2);
	expect(state.statements[0]).toContain("INSERT INTO hp_payment_orders");
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
	expect(state.values[0]?.[9]).toBe("2026-08-15 00:00:00.000");
	expect(state.values[1]?.[5]).toBe("2026-08-15 00:00:00.000");
});

test("MySQL 普通挂号自费上下文只以密文保存并可按 owner 读回", async () => {
	const { pool, state } = createFakePool([{ affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});
	const context = {
		businessId: "1952638941030000001",
		tradeTypeCode: "10",
		businessCode: "REG-20260907-001",
		payingId: "1952638941030000002",
		tradingId: "1952638941030000003",
		hospitalId: "10389001",
		patientId: "1952638941030000200",
		certNo: "11010519900101007X",
		psnCertType: "01",
		psnName: "测试患者",
		psnNo: "P000001",
		patInHosId: "0",
		outTradeNo: "YUNHEALTH-WX-OUT-001",
		outTradeNoSource: "yunhealth_2_6_65_2" as const,
		recordCode: "0123456789abcdef0123456789abcdef",
		payTypeId: "5032",
		payType: "CREDIT" as const,
		workStationId: "",
		payParams: {
			appId: "wx1234567890abcdef",
			timeStamp: "1789000000",
			nonceStr: "0123456789abcdef0123456789abcdef",
			package: "prepay_id=wx-provider-prepay-001",
			signType: "MD5" as const,
			paySign: "0123456789abcdef0123456789abcdef",
		},
		refundWriteBack: {
			merchantRefundNo: "RF-PO-YUNHEALTH-001",
			refundFen: 1000,
			syncedAt: "2026-09-18T01:02:00.000Z",
		},
	};
	const save = repositories.paymentOrders.saveRegistrationSelfPayContext;
	const read = repositories.paymentOrders.getRegistrationSelfPayContext;
	if (!save || !read)
		throw new Error("self-pay context repository unavailable");

	await save("user-001", "payment-order-new-001", context);
	const ciphertext = String(state.values[0]?.[0]);
	expect(ciphertext).not.toContain(context.certNo);
	expect(state.statements[0]).toContain(
		"registration_self_pay_context_ciphertext",
	);
	state.responses.push([
		{ registration_self_pay_context_ciphertext: ciphertext },
	]);
	await expect(read("user-001", "payment-order-new-001")).resolves.toEqual(
		context,
	);
	expect(state.values[1]).toEqual(["user-001", "payment-order-new-001"]);
});

test("MySQL patient directory upsert stores provider mapping but returns internal id", async () => {
	const { pool, state } = createFakePool([[], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.upsertFromDirectory({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			profile: {
				providerPatientId: "provider-patient-001",
				providerReferences: { "his-patient": "his-patient-001" },
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "******7890",
			},
		}),
	).resolves.toEqual({
		id: "internal-patient-001",
		ownerUserId: "user-001",
		displayName: "张三",
		relationship: "self",
		cardNumberMasked: "******7890",
		source: "hospital-his",
		clinicalAccess: "ready",
	});
	expect(state.statements[0]).toContain("provider_patient_id = ?");
	expect(state.statements[1]).toContain("INSERT INTO hp_patients");
	expect(state.values[1]).toContain("provider-patient-001");
	expect(state.statements[2]).toContain(
		"INSERT INTO hp_patient_provider_references",
	);
	expect(state.values[2]).toContain("his-patient-001");
});

test("MySQL patient directory upsert keeps same-patient mapping idempotent", async () => {
	const existingPatient = {
		patient_id: "internal-patient-001",
		owner_user_id: "user-001",
		display_name: "旧姓名",
		relationship: "self",
		card_number_masked: "******7890",
		source: "hospital-his",
		clinical_access: "ready",
		provider_name: "zhongyang",
		provider_patient_id: "provider-patient-001",
		directory_last_seen_at: "2026-08-15 00:00:00.000",
	};
	const { pool, state } = createFakePool([
		[existingPatient],
		{ affectedRows: 1 },
		duplicateEntryError(),
		[
			{
				patient_id: "internal-patient-001",
				provider_patient_id: "old-his-patient-001",
			},
		],
		{ affectedRows: 1 },
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.upsertFromDirectory({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			profile: {
				providerPatientId: "provider-patient-001",
				providerReferences: { "his-patient": "new-his-patient-001" },
				displayName: "新姓名",
				relationship: "self",
				cardNumberMasked: "******7890",
			},
		}),
	).resolves.toMatchObject({
		id: "internal-patient-001",
		displayName: "新姓名",
		clinicalAccess: "ready",
	});
	expect(state.statements[2]).toContain(
		"INSERT INTO hp_patient_provider_references",
	);
	expect(state.statements[3]).toContain("FOR UPDATE");
	expect(state.statements[4]).toContain(
		"UPDATE hp_patient_provider_references",
	);
	expect(state.committed).toBe(true);
	expect(state.rolledBack).toBe(false);
});

test("MySQL patient directory mapping collision rolls back the whole upsert", async () => {
	const { pool, state } = createFakePool([
		[],
		{ affectedRows: 1 },
		duplicateEntryError(),
		[],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.upsertFromDirectory({
			ownerUserId: "user-001",
			patientId: "internal-patient-new",
			provider: "zhongyang",
			profile: {
				providerPatientId: "provider-patient-new",
				providerReferences: { "his-patient": "his-patient-owned-by-old" },
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "******7890",
			},
		}),
	).rejects.toBeInstanceOf(PatientDirectoryReferenceConflictError);
	// 患者主表 INSERT 已经发生，但事务没有提交；否则后续列表会看到一个
	// 没有临床 patId 的半成品患者，业务层无法区分冲突和暂不可查。
	expect(state.committed).toBe(false);
	expect(state.rolledBack).toBe(true);
	expect(state.statements[3]).toContain("FOR UPDATE");
});

test("MySQL patient sync operation uses owner-scoped lease and replay states", async () => {
	const { pool, state } = createFakePool([
		[{ user_id: "user-001" }],
		[
			{
				operation_id: "operation-001",
				status: "in_progress",
				attempt_count: 1,
				lease_until: "2026-08-15 23:59:00.000",
			},
		],
		[],
		{ affectedRows: 1 },
		[{ user_id: "user-001" }],
		[
			{
				operation_id: "operation-001",
				status: "succeeded",
				attempt_count: 2,
				lease_until: "2026-08-16 02:00:00.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);
	const input = {
		ownerUserId: "user-001",
		provider: "zhongyang" as const,
		idempotencyKey: "patient-sync-key",
		now: "2026-08-16T00:00:00.000Z",
		leaseUntil: "2026-08-16T00:01:00.000Z",
	};

	await expect(
		repositories.patients.beginDirectorySync?.(input),
	).resolves.toEqual({
		outcome: "started",
		operationId: "operation-001",
		attemptCount: 2,
	});
	await expect(
		repositories.patients.beginDirectorySync?.(input),
	).resolves.toEqual({
		outcome: "replay",
		operationId: "operation-001",
		attemptCount: 2,
	});
	expect(state.statements[0]).toContain("hp_identity_users");
	expect(state.statements[1]).toContain("hp_patient_directory_sync_operations");
	expect(state.values[1]).toContain("patient-sync-key");
	expect(state.statements[1]).toContain("FOR UPDATE");
});

test("MySQL patient sync does not take over an expired key beside another active lease", async () => {
	const { pool, state } = createFakePool([
		[{ user_id: "user-001" }],
		[
			{
				operation_id: "operation-expired",
				status: "in_progress",
				attempt_count: 2,
				lease_until: "2026-08-15 23:59:00.000",
			},
		],
		[
			{
				operation_id: "operation-active",
				status: "in_progress",
				attempt_count: 1,
				lease_until: "2026-08-16 00:01:00.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.beginDirectorySync?.({
			ownerUserId: "user-001",
			provider: "zhongyang",
			idempotencyKey: "expired-key",
			now: "2026-08-16T00:00:00.000Z",
			leaseUntil: "2026-08-16T00:01:00.000Z",
		}),
	).resolves.toEqual({
		outcome: "in_progress",
		operationId: "operation-active",
		attemptCount: 1,
		leaseUntil: "2026-08-16T00:01:00.000Z",
		conflictScope: "owner-provider",
	});
	// 只有 owner、精确 key 和排除旧 operation 的活跃租约查询，不能出现
	// 接管 UPDATE；否则同一 owner/provider 会同时拥有两把有效租约。
	expect(state.statements).toHaveLength(3);
	expect(state.statements[2]).toContain("operation_id <> ?");
	expect(state.values[2]).toContain("operation-expired");
});

test("MySQL patient sync blocks a different key while the owner has an active lease", async () => {
	const { pool, state } = createFakePool([
		[{ user_id: "user-001" }],
		[],
		[
			{
				operation_id: "operation-active",
				status: "in_progress",
				attempt_count: 1,
				lease_until: "2026-08-16 00:01:00.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.beginDirectorySync?.({
			ownerUserId: "user-001",
			provider: "zhongyang",
			idempotencyKey: "different-page-key",
			now: "2026-08-16T00:00:00.000Z",
			leaseUntil: "2026-08-16T00:01:00.000Z",
		}),
	).resolves.toEqual({
		outcome: "in_progress",
		operationId: "operation-active",
		attemptCount: 1,
		leaseUntil: "2026-08-16T00:01:00.000Z",
		conflictScope: "owner-provider",
	});
	expect(state.statements).toHaveLength(3);
	expect(state.statements[2]).toContain("status = 'in_progress'");
	expect(state.values[1]).toContain("different-page-key");
});

test("MySQL patient snapshot marks sync operation succeeded in the same transaction", async () => {
	const currentRow = {
		patient_id: "patient-sync-001",
		owner_user_id: "user-001",
		display_name: "张三",
		relationship: "self",
		card_number_masked: "******7890",
		source: "hospital-his",
		clinical_access: "unavailable",
		provider_name: "zhongyang",
		provider_patient_id: "provider-patient-001",
		directory_last_seen_at: "2026-08-16 00:00:00.000",
	};
	const { pool, state } = createFakePool([
		[{ user_id: "user-001" }],
		[
			{
				operation_id: "operation-001",
				status: "in_progress",
				attempt_count: 1,
				lease_until: "2026-08-16 00:01:00.000",
			},
		],
		[],
		[],
		{ affectedRows: 1 },
		{ affectedRows: 0 },
		{ affectedRows: 0 },
		[currentRow],
		{ affectedRows: 1 },
	]);
	const repositories = createMySqlRepositories(pool);
	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");

	await expect(
		snapshot({
			ownerUserId: "user-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T00:00:00.000Z",
			operationId: "operation-001",
			operationAttemptCount: 1,
			completedAt: "2026-08-16T00:00:00.500Z",
			patients: [
				{
					patientId: "patient-sync-001",
					profile: {
						providerPatientId: "provider-patient-001",
						displayName: "张三",
						relationship: "self",
						cardNumberMasked: "******7890",
					},
				},
			],
		}),
	).resolves.toMatchObject({ deactivatedPatientCount: 0 });

	expect(state.committed).toBe(true);
	expect(state.statements.at(-1)).toContain("SET status = 'succeeded'");
});

test("MySQL ordinary profile uses insert-once and conditional version updates", async () => {
	const firstRow = {
		user_id: "user-profile-001",
		display_name: "测试用户",
		gender: "female",
		age: 32,
		email: "test@example.com",
		version: 1,
	};
	const secondRow = { ...firstRow, display_name: "测试用户2", version: 2 };
	const { pool, state } = createFakePool([
		{ affectedRows: 1 },
		[firstRow],
		[firstRow],
		{ affectedRows: 1 },
		[secondRow],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.userProfiles.update({
			userId: "user-profile-001",
			expectedVersion: 0,
			displayName: "测试用户",
			gender: "female",
			age: 32,
			email: "test@example.com",
		}),
	).resolves.toMatchObject({ version: 1, displayName: "测试用户" });
	await expect(
		repositories.userProfiles.update({
			userId: "user-profile-001",
			expectedVersion: 1,
			displayName: "测试用户2",
		}),
	).resolves.toMatchObject({ version: 2, displayName: "测试用户2" });

	expect(state.statements[0]).toContain("INSERT INTO hp_user_profiles");
	expect(state.statements[2]).toContain("FROM hp_user_profiles");
	expect(state.statements[3]).toContain("version = version + 1");
	expect(state.statements[3]).toContain("AND version = ?");
	expect(state.values[3]?.at(-1)).toBe(1);
});

test("MySQL ordinary profile rejects a response snapshot from a later version", async () => {
	const currentRow = {
		user_id: "user-profile-response-race-001",
		display_name: "当前资料",
		gender: "unknown",
		age: null,
		email: null,
		version: 1,
	};
	const laterRow = {
		...currentRow,
		display_name: "另一个设备的资料",
		version: 3,
	};
	const { pool, state } = createFakePool([
		[currentRow],
		{ affectedRows: 1 },
		[laterRow],
	]);
	const repositories = createMySqlRepositories(pool);

	// 真实事务会用 FOR UPDATE 阻塞后来的设备；测试替身故意返回更晚版本，
	// 用来锁定“不能把非本次写入的 canonical 快照包装成成功”的最后一道门禁。
	await expect(
		repositories.userProfiles.update({
			userId: currentRow.user_id,
			expectedVersion: 1,
			displayName: "本次资料",
		}),
	).rejects.toBeInstanceOf(UserProfileVersionConflictError);

	expect(state.committed).toBe(false);
	expect(state.rolledBack).toBe(true);
	expect(
		state.statements.filter((statement) => statement.includes("FOR UPDATE")),
	).toHaveLength(2);
});

test("MySQL ordinary profile preserves null as the explicit clear value", async () => {
	const currentRow = {
		user_id: "user-profile-clear-001",
		display_name: "需要清空的资料",
		gender: "unknown",
		age: 42,
		email: "clear@example.com",
		version: 1,
	};
	const clearedRow = { ...currentRow, age: null, email: null, version: 2 };
	const { pool, state } = createFakePool([
		[currentRow],
		{ affectedRows: 1 },
		[clearedRow],
	]);
	const repositories = createMySqlRepositories(pool);

	// null 不是“字段未提供”：它必须沿着 UPDATE 参数进入数据库，才能真正
	// 清除用户主动删除的年龄和邮箱；使用 `?? current` 会错误地保留旧资料。
	await expect(
		repositories.userProfiles.update({
			userId: "user-profile-clear-001",
			expectedVersion: 1,
			age: null,
			email: null,
		}),
	).resolves.toMatchObject({
		age: null,
		email: null,
		version: 2,
	});

	expect(state.values[1]?.slice(0, 4)).toEqual([
		"需要清空的资料",
		"unknown",
		null,
		null,
	]);
});

test("MySQL ordinary profile rejects a version beyond INT UNSIGNED", async () => {
	const { pool } = createFakePool([
		[
			{
				user_id: "user-profile-version-overflow-001",
				display_name: "版本异常",
				gender: "unknown",
				age: null,
				email: null,
				version: 4_294_967_296,
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	// 数据库读模型也必须 fail-closed；不能因为历史脏数据超出写入边界，
	// 就把它当作可继续递增的正常版本交给资料服务。
	await expect(
		repositories.userProfiles.findByUserId("user-profile-version-overflow-001"),
	).rejects.toMatchObject({
		name: "UserProfileReadModelValidationError",
		violation: "profile-version-invalid",
	});
});

test("MySQL ordinary profile converts unknown gender into the shared read-model error", async () => {
	const { pool } = createFakePool([
		[
			{
				user_id: "user-profile-gender-invalid-001",
				display_name: "性别异常",
				gender: "other",
				age: null,
				email: null,
				version: 1,
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	// 仓储不能用自己的普通 Error 绕过 API 已冻结的 persistence-invalid 契约；
	// 领域错误还会携带有限 violation，供请求日志安全关联具体异常字段。
	const result = repositories.userProfiles.findByUserId(
		"user-profile-gender-invalid-001",
	);
	await expect(result).rejects.toBeInstanceOf(
		UserProfileReadModelValidationError,
	);
	await expect(result).rejects.toMatchObject({
		violation: "profile-gender-invalid",
	});
});

test("MySQL ordinary profile rejects implicit numeric coercion from a malformed row", async () => {
	const { pool } = createFakePool([
		[
			{
				user_id: "user-profile-numeric-coercion-001",
				display_name: "数值边界",
				gender: "unknown",
				// `Number([])` 会得到 0；年龄 0 在领域层是合法值，
				// 所以必须在 persistence 边界先拒绝数组，不能等领域层猜测。
				age: [],
				email: null,
				version: 1,
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.userProfiles.findByUserId("user-profile-numeric-coercion-001"),
	).rejects.toThrow("invalid user profile age");
});

test("MySQL patient snapshot clears missing clinical references by stable internal id", async () => {
	const existingPatient = {
		patient_id: "stable-internal-patient-001",
		owner_user_id: "user-001",
		display_name: "张三",
		relationship: "self",
		card_number_masked: "******7890",
		source: "hospital-his",
		clinical_access: "unavailable",
		provider_name: "zhongyang",
		provider_patient_id: "provider-patient-001",
		directory_active: 1,
		directory_last_seen_at: "2026-08-16 00:00:00.000",
	};
	const { pool, state } = createFakePool([
		[existingPatient],
		{ affectedRows: 1 },
		{ affectedRows: 1 },
		{ affectedRows: 0 },
		[],
	]);
	const repositories = createMySqlRepositories(pool);
	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");

	await expect(
		snapshot({
			ownerUserId: "user-001",
			provider: "zhongyang",
			observedAt: "2026-08-17T00:00:00.000Z",
			patients: [
				{
					// provider 患者号相同但本次返回了不同候选内部 ID；
					// 持久化层必须沿用数据库中的稳定 ID。
					patientId: "incoming-patient-id-must-not-be-used",
					profile: {
						providerPatientId: "provider-patient-001",
						displayName: "张三（更新）",
						relationship: "self",
						cardNumberMasked: "******0000",
					},
				},
			],
		}),
	).resolves.toMatchObject({ deactivatedPatientCount: 0 });

	const clearReferenceIndex = state.statements.findIndex((statement) =>
		statement.includes("DELETE FROM hp_patient_provider_references"),
	);
	expect(clearReferenceIndex).toBeGreaterThanOrEqual(0);
	expect(state.values[clearReferenceIndex ?? -1]).toContain(
		"stable-internal-patient-001",
	);
	expect(state.values[clearReferenceIndex ?? -1]).not.toContain(
		"incoming-patient-id-must-not-be-used",
	);
});

test("MySQL patient directory snapshot deactivates missing rows in one transaction", async () => {
	const { pool, state } = createFakePool([
		[],
		{ affectedRows: 1 },
		{ affectedRows: 0 },
		{ affectedRows: 1 },
		[],
	]);
	const repositories = createMySqlRepositories(pool);

	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");
	await expect(
		snapshot({
			ownerUserId: "user-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T00:00:00.000Z",
			patients: [
				{
					patientId: "internal-patient-001",
					profile: {
						providerPatientId: "provider-patient-001",
						displayName: "张三",
						relationship: "self",
						cardNumberMasked: "******7890",
					},
				},
			],
		}),
	).resolves.toEqual({ activePatients: [], deactivatedPatientCount: 1 });

	expect(state.committed).toBe(true);
	expect(state.rolledBack).toBe(false);
	expect(
		state.statements.some((statement) =>
			statement.includes("SET directory_active = 0"),
		),
	).toBe(true);
	expect(state.values.some((values) => values.includes("user-001"))).toBe(true);
});

test("MySQL complete patient snapshot removes a missing clinical reference", async () => {
	const currentRow = {
		patient_id: "patient-reference-001",
		owner_user_id: "user-reference-001",
		display_name: "张三",
		relationship: "self",
		card_number_masked: "******7890",
		source: "hospital-his",
		clinical_access: "unavailable",
		provider_name: "zhongyang",
		provider_patient_id: "provider-patient-001",
		directory_last_seen_at: "2026-08-16 00:00:00.000",
	};
	const { pool, state } = createFakePool([
		[currentRow],
		{ affectedRows: 1 },
		{ affectedRows: 1 },
		{ affectedRows: 0 },
		[currentRow],
	]);
	const repositories = createMySqlRepositories(pool);
	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");

	await expect(
		snapshot({
			ownerUserId: "user-reference-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T01:00:00.000Z",
			patients: [
				{
					patientId: "patient-reference-001",
					profile: {
						providerPatientId: "provider-patient-001",
						displayName: "张三",
						relationship: "self",
						cardNumberMasked: "******7890",
					},
				},
			],
		}),
	).resolves.toMatchObject({ deactivatedPatientCount: 0 });

	const deleteStatement = state.statements.find((statement) =>
		statement.includes("DELETE FROM hp_patient_provider_references"),
	);
	expect(deleteStatement).toContain("reference_kind IN (?)");
	expect(deleteStatement).toContain("directory_last_seen_at <= ?");
	expect(state.values.some((values) => values.includes("his-patient"))).toBe(
		true,
	);
	expect(state.committed).toBe(true);
});

test("MySQL patient directory ignores a stale snapshot without reactivating or overwriting", async () => {
	const currentRow = {
		patient_id: "patient-order-001",
		owner_user_id: "user-order-001",
		display_name: "新资料",
		relationship: "self",
		card_number_masked: "******2001",
		source: "hospital-his",
		clinical_access: "unavailable",
		provider_name: "zhongyang",
		provider_patient_id: "provider-order-001",
		directory_last_seen_at: "2026-08-16 02:00:00.000",
	};
	const { pool, state } = createFakePool([
		[currentRow],
		{ affectedRows: 0 },
		{ affectedRows: 0 },
		[currentRow],
	]);
	const repositories = createMySqlRepositories(pool);

	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");
	await expect(
		snapshot({
			ownerUserId: "user-order-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T01:00:00.000Z",
			patients: [
				{
					patientId: "must-not-replace-order-id",
					profile: {
						providerPatientId: "provider-order-001",
						displayName: "旧资料",
						relationship: "self",
						cardNumberMasked: "******1001",
					},
				},
			],
		}),
	).resolves.toEqual({
		activePatients: [
			{
				id: "patient-order-001",
				ownerUserId: "user-order-001",
				displayName: "新资料",
				relationship: "self",
				cardNumberMasked: "******2001",
				source: "hospital-his",
				clinicalAccess: "unavailable",
			},
		],
		deactivatedPatientCount: 0,
	});
	expect(
		state.statements.some((statement) =>
			statement.includes("SET display_name = ?"),
		),
	).toBe(false);
});

test("MySQL patient snapshot rejects an older committed operation before writes", async () => {
	const { pool, state } = createFakePool([
		[{ user_id: "user-stale-001" }],
		[
			{
				operation_id: "operation-stale-001",
				status: "in_progress",
				attempt_count: 1,
				lease_until: "2026-08-16 02:00:00.000",
			},
		],
		[{ observed_at: "2026-08-16 02:00:00.000" }],
	]);
	const repositories = createMySqlRepositories(pool);
	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");

	await expect(
		snapshot({
			ownerUserId: "user-stale-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T01:00:00.000Z",
			operationId: "operation-stale-001",
			operationAttemptCount: 1,
			completedAt: "2026-08-16T01:00:00.500Z",
			patients: [],
		}),
	).rejects.toMatchObject({ name: "PatientDirectorySnapshotStaleError" });

	expect(state.rolledBack).toBe(true);
	expect(
		state.statements.some((statement) =>
			statement.includes("SET directory_active"),
		),
	).toBe(false);
	expect(
		state.statements.some((statement) =>
			statement.includes(
				"SELECT observed_at FROM hp_patient_directory_sync_operations",
			),
		),
	).toBe(true);
});

test("MySQL patient snapshot rejects a late response after a different key takeover", async () => {
	const { pool, state } = createFakePool([
		[{ user_id: "user-lease-takeover-001" }],
		[
			{
				operation_id: "operation-old-001",
				status: "in_progress",
				attempt_count: 1,
				// 不同幂等键已经在租约到期后接管；旧 operation 的 ledger
				// 行仍可能保留 in_progress，不能以此证明旧请求仍有写权限。
				lease_until: "2026-08-16 00:00:01.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);
	const snapshot = repositories.patients.replaceDirectorySnapshot;
	if (!snapshot) throw new Error("snapshot unavailable");

	await expect(
		snapshot({
			ownerUserId: "user-lease-takeover-001",
			provider: "zhongyang",
			observedAt: "2026-08-16T00:00:00.000Z",
			operationId: "operation-old-001",
			operationAttemptCount: 1,
			completedAt: "2026-08-16T00:00:01.001Z",
			patients: [
				{
					patientId: "stale-patient-id",
					profile: {
						providerPatientId: "provider-stale-patient-001",
						displayName: "旧租约资料",
						relationship: "self",
						cardNumberMasked: "******9999",
					},
				},
			],
		}),
	).rejects.toMatchObject({ name: "PatientDirectorySnapshotStaleError" });

	expect(state.rolledBack).toBe(true);
	expect(
		state.statements.some((statement) =>
			statement.includes("INSERT INTO hp_patients"),
		),
	).toBe(false);
});

test("MySQL patient provider lookup is owner-scoped and server-only", async () => {
	const { pool, state } = createFakePool([
		[
			{
				patient_id: "internal-patient-001",
				provider_name: "zhongyang",
				provider_patient_id: "provider-patient-001",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
		}),
	).resolves.toEqual({
		patientId: "internal-patient-001",
		provider: "zhongyang",
		providerPatientId: "provider-patient-001",
	});
	expect(state.statements[0]).toContain("owner_user_id = ?");
	expect(state.statements[0]).toContain("provider_patient_id IS NOT NULL");
	expect(state.values[0]).toEqual([
		"user-001",
		"internal-patient-001",
		"zhongyang",
	]);
});

test("MySQL clinical provider lookup uses the purpose-specific HIS mapping", async () => {
	const { pool, state } = createFakePool([
		[
			{
				patient_id: "internal-patient-001",
				provider_name: "zhongyang",
				reference_kind: "his-patient",
				provider_patient_id: "his-patient-001",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			referenceKind: "his-patient",
		}),
	).resolves.toEqual({
		patientId: "internal-patient-001",
		provider: "zhongyang",
		providerPatientId: "his-patient-001",
	});
	expect(state.statements[0]).toContain("FROM hp_patient_provider_references");
	expect(state.statements[0]).toContain(
		"patients.provider_name = provider_refs.provider_name",
	);
	expect(state.values[0]).toEqual([
		"user-001",
		"internal-patient-001",
		"zhongyang",
		"his-patient",
		"zhongyang",
	]);
});

test("MySQL order update requires the expected version before writing its event", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);
	const updated = { ...order, state: "authorized" as const, version: 2 };
	const event: OutboxEvent = {
		...createdEvent,
		eventId: "payment-order:order-001:2",
		eventName: "payment-order.state-changed",
		payload: { orderId: "order-001", state: "authorized", version: 2 },
	};

	expect(
		await repositories.paymentOrders.update(updated, order.version, event),
	).toEqual(updated);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("version = ?");
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
});

test("MySQL outbox claim returns an event and commits its lease", async () => {
	const row = {
		event_id: createdEvent.eventId,
		event_name: createdEvent.eventName,
		aggregate_id: createdEvent.aggregateId,
		payload: JSON.stringify(createdEvent.payload),
		occurred_at: createdEvent.occurredAt,
		available_at: createdEvent.availableAt,
		attempts: 0,
		claimed_until: null,
		status: "pending",
		manual_review_at: null,
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	const claimed = await repositories.outbox.claimAvailable(
		new Date("2026-08-15T00:00:00.000Z"),
	);

	expect(claimed).toMatchObject({
		eventId: createdEvent.eventId,
		eventName: createdEvent.eventName,
		aggregateId: createdEvent.aggregateId,
	});
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("FOR UPDATE SKIP LOCKED");
	expect(state.statements[1]).toContain("SET claimed_until");
});

test("MySQL prepay repository encrypts pay params and stores only prepay hash", async () => {
	const { pool, state } = createFakePool([
		{ affectedRows: 1 },
		{ affectedRows: 1 },
	]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});
	const pending: PaymentPrepayAttempt = {
		attemptId: "attempt-001",
		ownerUserId: "user-001",
		orderId: "order-001",
		provider: "wechat-pay",
		idempotencyKey: "prepay-001",
		status: "pending",
		version: 1,
		queryAttempts: 0,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const succeeded: PaymentPrepayAttempt = {
		...pending,
		status: "succeeded",
		version: 2,
		prepayId: "prepay-credential-001",
		payParams: {
			appId: "app-001",
			timeStamp: "1700000000",
			nonceStr: "nonce-001",
			package: "prepay_id=prepay-credential-001",
			signType: "RSA",
			paySign: "sensitive-sign-001",
		},
		providerRequestId: "request-001",
		updatedAt: "2026-08-15T00:00:01.000Z",
	};

	await repositories.paymentPrepayAttempts.insert(pending);
	await repositories.paymentPrepayAttempts.update(succeeded, pending.version);

	const updateValues = state.values[1] ?? [];
	const storedPrepayHash = updateValues[7];
	const serialized = updateValues[8];
	expect(state.statements[0]).toContain("prepay_id_hash");
	expect(state.statements[1]).toContain("pay_params_ciphertext");
	expect(String(storedPrepayHash)).not.toBe("prepay-credential-001");
	expect(String(serialized)).not.toContain("sensitive-sign-001");
});

test("MySQL prepay repository reads a provider-confirmed failed attempt", async () => {
	const row = {
		attempt_id: "attempt-failed-001",
		owner_user_id: "user-001",
		order_id: "order-001",
		provider: "wechat-pay",
		idempotency_key: "prepay-failed-001",
		status: "failed",
		version: 29,
		query_attempts: 12,
		last_queried_at: "2026-08-15 00:00:15.000",
		next_query_at: null,
		query_claimed_until: null,
		manual_review_at: null,
		prepay_id_hash: null,
		pay_params_ciphertext: null,
		provider_request_id: "request-404-001",
		last_error_code: "provider-order-not-found",
		created_at: "2026-08-15 00:00:00.000",
		updated_at: "2026-08-15 00:00:15.000",
	};
	const { pool } = createFakePool([[row]]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});

	await expect(
		repositories.paymentPrepayAttempts.findByOwnerOrderAndIdempotencyKey(
			"user-001",
			"order-001",
			"prepay-failed-001",
		),
	).resolves.toMatchObject({
		attemptId: "attempt-failed-001",
		status: "failed",
		lastErrorCode: "provider-order-not-found",
	});
});

test("MySQL medical insurance order insert keeps columns and values aligned", async () => {
	const medicalOrder: MedicalInsuranceOrder = {
		medicalOrderId: "medical-order-insert-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "appointment-001",
		appointmentId: "appointment-001",
		authorizationId: null,
		feeUploadId: null,
		idempotencyKey: "medical-order-idempotency-001",
		medOrgOrd: "med-org-001",
		chrgBchno: "batch-001",
		payOrdId: null,
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "created",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatMixTradeNo: null,
		wechatOutTradeNo: null,
		wechatPaymentState: "not_started",
		wechatPayParams: null,
		version: 1,
		createdAt: "2026-09-03T00:00:00.000Z",
		updatedAt: "2026-09-03T00:00:00.000Z",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.medicalInsuranceOrders.insert(medicalOrder),
	).resolves.toEqual(medicalOrder);

	const statement = state.statements[0] ?? "";
	const values = state.values[0] ?? [];
	expect(statement).toContain("updated_at");
	expect(statement.match(/\?/g) ?? []).toHaveLength(values.length);
	expect(values).toHaveLength(41);
});

test("MySQL 医保历史 MD5 调起参数隔离后仍可读取混合订单事实", async () => {
	const cipher = createAesGcmSecretValueCipher(
		Buffer.alloc(32, 9).toString("base64"),
	);
	const legacyMd5 = {
		timeStamp: "1786752000",
		nonceStr: "legacy-md5-nonce-001",
		package: "prepay_id=legacy-md5-prepay-001",
		signType: "MD5",
		paySign: "A".repeat(32),
		mixTradeNo: "mix-legacy-md5-001",
	};
	const row = {
		medical_order_id: "medical-order-legacy-md5-001",
		owner_user_id: "user-legacy-md5-001",
		patient_id: "patient-legacy-md5-001",
		business_type: "registration",
		order_type: "RegPay",
		business_id: "appointment-legacy-md5-001",
		appointment_id: "appointment-legacy-md5-001",
		authorization_id: null,
		fee_upload_id: null,
		idempotency_key: "legacy-md5-idempotency-001",
		med_org_ord: "med-org-legacy-md5-001",
		chrg_bchno: "batch-legacy-md5-001",
		pay_ord_id: "pay-ord-legacy-md5-001",
		pay_token_hash: null,
		mdtrt_id: null,
		acct_used_flag: null,
		status: "cash_pending",
		ord_stas: "2",
		total_fen: 1000,
		cash_fen: 200,
		personal_account_fen: 300,
		fund_fen: 500,
		other_payment_fen: 0,
		hospital_part_fen: 0,
		personal_account_mutual_aid_fen: 0,
		personal_account_self_fen: 0,
		deposit_fen: 0,
		delivery_fee_fen: 0,
		setl_type: "ALL",
		revs_token_hash: null,
		revs_token_expires_at: null,
		last_error: null,
		med_ins_fail_reason: null,
		wechat_mix_trade_no: "mix-legacy-md5-001",
		wechat_out_trade_no: "out-legacy-md5-001",
		wechat_payment_state: "prepay_ready",
		wechat_pay_params_ciphertext: cipher.seal(JSON.stringify(legacyMd5)),
		wechat_prepay_expires_at: "2026-09-17 12:00:00.000",
		version: 7,
		created_at: "2026-09-17 10:00:00.000",
		updated_at: "2026-09-17 11:00:00.000",
	};
	const { pool } = createFakePool([[row], [row], [row]]);
	const repositories = createMySqlRepositories(pool, { prepayCipher: cipher });

	const loaded = await repositories.medicalInsuranceOrders.findByMedicalOrderId(
		"medical-order-legacy-md5-001",
	);
	const loadedByMix =
		await repositories.medicalInsuranceOrders.findByWechatMixTradeNo(
			"mix-legacy-md5-001",
		);
	const loadedByOut =
		await repositories.medicalInsuranceOrders.findByWechatOutTradeNo(
			"out-legacy-md5-001",
		);

	for (const candidate of [loaded, loadedByMix, loadedByOut]) {
		expect(candidate).toMatchObject({
			medicalOrderId: "medical-order-legacy-md5-001",
			status: "cash_pending",
			wechatMixTradeNo: "mix-legacy-md5-001",
			wechatOutTradeNo: "out-legacy-md5-001",
			wechatPaymentState: "prepay_ready",
			wechatPayParams: null,
			wechatPayParamsFormat: "legacy_md5",
		});
		expect(candidate).not.toHaveProperty("paySign");
	}
});

test("MySQL 医保调起参数不是合法 RSA 或历史 MD5 时仍拒绝损坏数据", async () => {
	const cipher = createAesGcmSecretValueCipher(
		Buffer.alloc(32, 9).toString("base64"),
	);
	const { pool } = createFakePool([
		[
			{
				medical_order_id: "medical-order-invalid-medical-pay-001",
				owner_user_id: "user-invalid-medical-pay-001",
				patient_id: "patient-invalid-medical-pay-001",
				business_type: "registration",
				order_type: "RegPay",
				business_id: null,
				appointment_id: null,
				authorization_id: null,
				fee_upload_id: null,
				idempotency_key: "invalid-medical-pay-idempotency-001",
				med_org_ord: "med-org-invalid-medical-pay-001",
				chrg_bchno: "batch-invalid-medical-pay-001",
				pay_ord_id: null,
				pay_token_hash: null,
				mdtrt_id: null,
				acct_used_flag: null,
				status: "cash_pending",
				ord_stas: "2",
				total_fen: 100,
				cash_fen: 20,
				personal_account_fen: 30,
				fund_fen: 50,
				other_payment_fen: 0,
				hospital_part_fen: 0,
				personal_account_mutual_aid_fen: 0,
				personal_account_self_fen: 0,
				deposit_fen: 0,
				delivery_fee_fen: 0,
				setl_type: "ALL",
				revs_token_hash: null,
				revs_token_expires_at: null,
				last_error: null,
				med_ins_fail_reason: null,
				wechat_mix_trade_no: "mix-invalid-medical-pay-001",
				wechat_out_trade_no: "out-invalid-medical-pay-001",
				wechat_payment_state: "prepay_ready",
				wechat_pay_params_ciphertext: cipher.seal(
					JSON.stringify({
						timeStamp: "1786752000",
						nonceStr: "invalid-md5-nonce-001",
						package: "prepay_id=invalid-md5-prepay-001",
						signType: "MD5",
						paySign: "not-a-md5-signature",
						mixTradeNo: "mix-invalid-medical-pay-001",
					}),
				),
				wechat_prepay_expires_at: null,
				version: 1,
				created_at: "2026-09-17 10:00:00.000",
				updated_at: "2026-09-17 10:00:00.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool, { prepayCipher: cipher });

	await expect(
		repositories.medicalInsuranceOrders.findByMedicalOrderId(
			"medical-order-invalid-medical-pay-001",
		),
	).rejects.toThrow("Persistence returned invalid medical Wechat pay params");
});

test("MySQL 医保上下文修复使用加密且条件写入", async () => {
	const key = Buffer.alloc(32, 8).toString("base64");
	const { pool, state } = createFakePool([
		{ affectedRows: 1 },
		{ affectedRows: 0 },
	]);
	const repositories = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});
	const context: MedicalInsuranceSettlementContext = {
		businessId: "provider-business-001",
		hospitalId: "provider-hospital-001",
		patientId: "provider-patient-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["provider-trade-order-001"],
		payingId: "260650000000001",
		tradingId: "260650000000002",
		postPaymentComponents: [
			{
				componentId: "medical-repair-001:wechat_cash",
				kind: "wechat_cash",
				totalFen: 100,
				amountFen: 100,
				payModel: "MINI_PROGRAM",
				payTypeId: "5027",
				recordCode: "0123456789abcdef0123456789abcdef",
				state: "pending",
				attempts: 0,
				updatedAt: "2026-09-03T00:00:00.000Z",
			},
		],
	};

	await expect(
		repositories.medicalInsuranceOrders.saveSettlementContextIfMissing(
			"user-repair-001",
			"medical-repair-001",
			context,
		),
	).resolves.toBe(true);
	await expect(
		repositories.medicalInsuranceOrders.saveSettlementContextIfMissing(
			"user-repair-001",
			"medical-repair-001",
			context,
		),
	).resolves.toBe(false);

	expect(state.statements[0]).toContain(
		"settlement_context_ciphertext IS NULL",
	);
	expect(state.values[0]?.[0]).not.toContain(context.businessId);
});

test("MySQL 医保上下文可加密读回历史 5031 自费回写事实", async () => {
	const key = Buffer.alloc(32, 12).toString("base64");
	const cipher = createAesGcmSecretValueCipher(key, {
		keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
		valueName: "medical insurance credential",
	});
	const context: MedicalInsuranceSettlementContext = {
		businessId: "provider-sequenced-001",
		hospitalId: "10389001",
		patientId: "provider-patient-sequenced-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["provider-trade-sequenced-001"],
		payingId: "260650000000011",
		tradingId: "260650000000012",
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [
			{
				componentId: "medical-sequenced-001:medical",
				kind: "medical",
				totalFen: 17_600,
				amountFen: 3_588,
				payModel: "H5",
				payTypeId: "2",
				payTypeParams: [{ kind: "fund", payTypeId: "2", amountFen: 3_588 }],
				recordCode: "0123456789abcdef0123456789abcdef",
				state: "succeeded",
				attempts: 1,
				payingId: "260650000000011",
				tradingId: "260650000000012",
				updatedAt: "2026-09-18T09:00:00.000Z",
			},
			{
				componentId: "medical-sequenced-001:wechat_cash",
				kind: "wechat_cash",
				totalFen: 17_600,
				amountFen: 14_012,
				payModel: "H5",
				payTypeId: "5031",
				recordCode: "fedcba9876543210fedcba9876543210",
				state: "succeeded",
				attempts: 1,
				payingId: "260650000000021",
				tradingId: "260650000000022",
				updatedAt: "2026-09-18T09:01:00.000Z",
			},
		],
		selfPayThirdPartyWriteback: {
			attemptedAt: "2026-09-18T09:02:00.000Z",
			status: "succeeded",
			providerRequestId: "provider-2.27.2.29-001",
			providerStatus: "SUCCESS",
			thirdPartPayRecordId: "9007199254740993",
			rawResponse:
				'{"success":true,"data":{"thirdPartPayRecordId":"9007199254740993"}}',
		},
		selfPayPaymentNotify: {
			attemptedAt: "2026-09-18T09:03:00.000Z",
			status: "succeeded",
			providerRequestId: "provider-2.6.65.15-001",
			providerStatus: "SUCCESS",
		},
	};
	const ciphertext = cipher.seal(JSON.stringify(context));
	expect(ciphertext).not.toContain("9007199254740993");
	const { pool } = createFakePool([
		[
			{
				settlement_context_ciphertext: ciphertext,
			},
		],
	]);
	const repositories = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});

	await expect(
		repositories.medicalInsuranceOrders.getSettlementContext(
			"user-sequenced-001",
			"medical-sequenced-001",
		),
	).resolves.toMatchObject({
		businessId: "provider-sequenced-001",
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [
			{
				componentId: "medical-sequenced-001:medical",
				kind: "medical",
				payTypeId: "2",
				amountFen: 3_588,
				payTypeParams: [{ kind: "fund", payTypeId: "2", amountFen: 3_588 }],
			},
			{
				componentId: "medical-sequenced-001:wechat_cash",
				kind: "wechat_cash",
				payTypeId: "5031",
				amountFen: 14_012,
				recordCode: "fedcba9876543210fedcba9876543210",
				payingId: "260650000000021",
				tradingId: "260650000000022",
			},
		],
		selfPayThirdPartyWriteback: {
			status: "succeeded",
			thirdPartPayRecordId: "9007199254740993",
			rawResponse:
				'{"success":true,"data":{"thirdPartPayRecordId":"9007199254740993"}}',
		},
		selfPayPaymentNotify: {
			status: "succeeded",
			providerRequestId: "provider-2.6.65.15-001",
		},
	});
});

test("MySQL 医保上下文可加密读回新 5033 自费计划", async () => {
	const key = Buffer.alloc(32, 13).toString("base64");
	const cipher = createAesGcmSecretValueCipher(key, {
		keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
		valueName: "medical insurance credential",
	});
	const context: MedicalInsuranceSettlementContext = {
		businessId: "provider-sequenced-5033",
		hospitalId: "10389001",
		patientId: "provider-patient-sequenced-5033",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["provider-trade-sequenced-5033"],
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [
			{
				componentId: "medical-sequenced-5033:wechat_cash",
				kind: "wechat_cash",
				totalFen: 14_012,
				amountFen: 14_012,
				payModel: "H5",
				payTypeId: "5033",
				recordCode: "abcdef0123456789abcdef0123456789",
				state: "pending",
				attempts: 0,
				updatedAt: "2026-09-18T09:04:00.000Z",
			},
		],
	};
	const { pool } = createFakePool([
		[
			{
				settlement_context_ciphertext: cipher.seal(JSON.stringify(context)),
			},
		],
	]);
	const repositories = createMySqlRepositories(pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});

	await expect(
		repositories.medicalInsuranceOrders.getSettlementContext(
			"user-sequenced-5033",
			"medical-sequenced-5033",
		),
	).resolves.toMatchObject({
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [
			{
				kind: "wechat_cash",
				payModel: "H5",
				payTypeId: "5033",
				state: "pending",
			},
		],
	});
});

test("MySQL notification repository commits the safe fact and outbox together", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);
	const notification: WechatPaymentNotification = {
		notificationId: "notification-mysql-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "order-001",
		tradeState: "SUCCESS",
		totalFen: 300,
		providerTransactionId: "4200000000000300",
		receivedAt: "2026-08-15T00:00:01.000Z",
	};

	await expect(
		repositories.wechatPaymentNotifications.record(
			notification,
			createWechatPaymentNotificationEvent(notification),
		),
	).resolves.toMatchObject({ status: "inserted", notification });
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain(
		"INSERT INTO hp_wechat_payment_notifications",
	);
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
});

test("MySQL prepay repository atomically claims due query schedules", async () => {
	const row = {
		attempt_id: "attempt-due-001",
		owner_user_id: "user-001",
		order_id: "order-001",
		provider: "wechat-pay",
		idempotency_key: "prepay-due-001",
		status: "succeeded",
		// mysql2 在 BIGINT/INT 配置下可能返回十进制字符串；读取后必须
		// 先转成安全整数，不能让 `version + 1` 变成字符串拼接。
		version: "3",
		query_attempts: 2,
		last_queried_at: "2026-08-15 00:00:15.000",
		next_query_at: "2026-08-15 00:01:00.000",
		query_claimed_until: null,
		manual_review_at: null,
		prepay_id_hash: null,
		pay_params_ciphertext: null,
		provider_request_id: "request-001",
		last_error_code: null,
		created_at: "2026-08-15 00:00:00.000",
		updated_at: "2026-08-15 00:00:15.000",
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});

	await expect(
		repositories.paymentPrepayAttempts.claimDueForQuery(
			new Date("2026-08-15T00:01:00.000Z"),
			1,
			60_000,
		),
	).resolves.toMatchObject([
		{
			attemptId: "attempt-due-001",
			queryAttempts: 2,
			version: 4,
			lastQueriedAt: "2026-08-15 00:00:15.000",
			nextQueryAt: "2026-08-15 00:01:00.000",
			queryClaimedUntil: "2026-08-15 00:02:00.000",
		},
	]);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("FOR UPDATE SKIP LOCKED");
	expect(state.statements[1]).toContain("query_claimed_until = ?");
});

test("MySQL medical insurance query tasks claim and update with a version fence", async () => {
	const row = {
		task_id: "medical-query-task-001",
		medical_order_id: "medical-order-001",
		status: "pending",
		attempts: "0",
		max_attempts: "12",
		version: "1",
		next_attempt_at: "2026-09-03 00:00:00.000",
		claimed_until: null,
		terminal_ord_stas: null,
		last_error_code: null,
		created_at: "2026-09-03 00:00:00.000",
		updated_at: "2026-09-03 00:00:00.000",
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	const claimed =
		await repositories.medicalInsuranceQueryTasks.claimDueForQuery(
			new Date("2026-09-03T00:00:00.000Z"),
			1,
			60_000,
		);
	expect(claimed).toMatchObject([
		{
			taskId: "medical-query-task-001",
			medicalOrderId: "medical-order-001",
			status: "in_progress",
			version: 2,
			claimedUntil: "2026-09-03T00:01:00.000Z",
		},
	]);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("FOR UPDATE");
	expect(state.statements[1]).toContain("status = 'in_progress'");

	const current = claimed[0];
	if (!current) throw new Error("Claimed medical query task is missing");
	const completed: MedicalInsuranceQueryTask = {
		...current,
		status: "completed",
		version: current.version + 1,
		attempts: 1,
		claimedUntil: null,
		updatedAt: "2026-09-03T00:00:01.000Z",
	};
	const updatePool = createFakePool([
		{ affectedRows: 1 },
		[
			{
				...row,
				status: "completed",
				attempts: 1,
				version: 3,
				updated_at: "2026-09-03 00:00:01.000",
			},
		],
	]);
	const updateRepositories = createMySqlRepositories(updatePool.pool);
	const updated = await updateRepositories.medicalInsuranceQueryTasks.update(
		completed,
		current.version,
	);
	expect(updated).toMatchObject({
		status: "completed",
		version: 3,
		attempts: 1,
	});
});

test("MySQL medical insurance query tasks reclaim an expired in-progress lease", async () => {
	const row = {
		task_id: "medical-query-task-expired-001",
		medical_order_id: "medical-order-expired-001",
		status: "in_progress",
		attempts: "2",
		max_attempts: "12",
		version: "4",
		next_attempt_at: "2026-09-03 00:00:00.000",
		claimed_until: "2026-09-03 00:04:59.999",
		terminal_ord_stas: null,
		last_error_code: "provider-query-failed",
		created_at: "2026-09-03 00:00:00.000",
		updated_at: "2026-09-03 00:00:00.000",
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.medicalInsuranceQueryTasks.claimDueForQuery(
			new Date("2026-09-03T00:05:00.000Z"),
			1,
			5 * 60_000,
		),
	).resolves.toMatchObject([
		{
			taskId: "medical-query-task-expired-001",
			medicalOrderId: "medical-order-expired-001",
			status: "in_progress",
			attempts: 2,
			version: 5,
			claimedUntil: "2026-09-03T00:10:00.000Z",
		},
	]);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain(
		"OR (status = 'in_progress' AND claimed_until <= ?)",
	);
	expect(state.values[0]).toEqual([
		"2026-09-03 00:05:00.000",
		"2026-09-03 00:05:00.000",
		"2026-09-03 00:05:00.000",
	]);
	expect(state.values[1]).toEqual([
		"2026-09-03 00:10:00.000",
		"2026-09-03 00:05:00.000",
		"medical-query-task-expired-001",
		"in_progress",
		4,
	]);
});

test("MySQL medical insurance requeue preserves an active Worker lease", async () => {
	const { pool, state } = createFakePool([{ affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	await repositories.medicalInsuranceQueryTasks.requeue(
		"medical-order-in-progress-001",
		new Date("2026-09-03T00:00:01.000Z"),
	);

	expect(state.statements[0]).toContain(
		"status IN ('manual_review', 'in_progress')",
	);
	expect(state.statements[0]).toContain(
		"version = CASE WHEN status IN ('manual_review', 'in_progress') THEN version",
	);
});

test("MySQL medical insurance query task insert is idempotent and rejects drift", async () => {
	const now = "2026-09-03 00:00:00.000";
	const task: MedicalInsuranceQueryTask = {
		taskId: "medical-query-task-insert-001",
		medicalOrderId: "medical-order-001",
		status: "pending",
		version: 1,
		attempts: 0,
		maxAttempts: 12,
		nextAttemptAt: "2026-09-03T00:00:00.000Z",
		claimedUntil: null,
		terminalOrdStas: null,
		lastErrorCode: null,
		createdAt: "2026-09-03T00:00:00.000Z",
		updatedAt: "2026-09-03T00:00:00.000Z",
	};
	const { pool, state } = createFakePool([
		{ affectedRows: 1 },
		[
			{
				task_id: task.taskId,
				medical_order_id: task.medicalOrderId,
				status: task.status,
				attempts: "0",
				max_attempts: "12",
				version: "1",
				next_attempt_at: now,
				claimed_until: null,
				terminal_ord_stas: null,
				last_error_code: null,
				created_at: now,
				updated_at: now,
			},
		],
		{ affectedRows: 0 },
		[
			{
				task_id: task.taskId,
				medical_order_id: task.medicalOrderId,
				status: task.status,
				attempts: "0",
				max_attempts: "12",
				version: "1",
				next_attempt_at: now,
				claimed_until: null,
				terminal_ord_stas: null,
				last_error_code: null,
				created_at: now,
				updated_at: now,
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.medicalInsuranceQueryTasks.insert(task),
	).resolves.toEqual(task);
	expect(state.statements[0]).toContain(
		"ON DUPLICATE KEY UPDATE task_id = task_id",
	);
	await expect(
		repositories.medicalInsuranceQueryTasks.insert({
			...task,
			version: 7,
			attempts: 3,
			nextAttemptAt: "2026-09-03T00:10:00.000Z",
			updatedAt: "2026-09-03T00:10:00.000Z",
		}),
	).resolves.toEqual(task);

	const driftPool = createFakePool([
		{ affectedRows: 0 },
		[
			{
				task_id: task.taskId,
				medical_order_id: "medical-order-other",
				status: task.status,
				attempts: "0",
				max_attempts: "12",
				version: "1",
				next_attempt_at: now,
				claimed_until: null,
				terminal_ord_stas: null,
				last_error_code: null,
				created_at: now,
				updated_at: now,
			},
		],
	]);
	const driftRepositories = createMySqlRepositories(driftPool.pool);
	await expect(
		driftRepositories.medicalInsuranceQueryTasks.insert(task),
	).rejects.toThrow("idempotency payload changed");
});

test("MySQL medical insurance credentials store ciphertext and enforce scoped reads", async () => {
	const key = Buffer.alloc(32, 8).toString("base64");
	const input = {
		credentialId: "credential-001",
		ownerUserId: "user-001",
		medicalOrderId: "medical-order-001",
		payOrdId: "pay-ord-001",
		payToken: "provider-token-secret",
		providerQueryIdentity: {
			orgCodg: "org-001",
			idNo: "masked-id-001",
			userName: "测试用户",
			idType: "01",
		},
		purpose: "query" as const,
		expiresAt: "2026-09-03T12:00:00.000Z",
		createdAt: "2026-09-03T10:00:00.000Z",
	};
	const payloadCiphertext = createAesGcmSecretValueCipher(key).seal(
		JSON.stringify({
			payToken: input.payToken,
			providerQueryIdentity: input.providerQueryIdentity,
		}),
	);
	const row = {
		credential_id: input.credentialId,
		owner_user_id: input.ownerUserId,
		medical_order_id: input.medicalOrderId,
		pay_ord_id: input.payOrdId,
		purpose: input.purpose,
		payload_ciphertext: payloadCiphertext,
		expires_at: "2026-09-03 12:00:00.000",
		created_at: "2026-09-03 10:00:00.000",
	};
	const putPool = createFakePool([{ affectedRows: 1 }, [row]]);
	const repositories = createMySqlRepositories(putPool.pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});
	await expect(
		repositories.medicalInsuranceCredentials.put(input),
	).resolves.toMatchObject({
		credentialId: input.credentialId,
		payOrdId: input.payOrdId,
		purpose: input.purpose,
	});
	expect(putPool.state.values[0]?.[5]).not.toBe(input.payToken);

	const getPool = createFakePool([[row]]);
	const getRepositories = createMySqlRepositories(getPool.pool, {
		medicalInsuranceCredentialEncryptionKey: key,
	});
	await expect(
		getRepositories.medicalInsuranceCredentials.get({
			credentialId: input.credentialId,
			ownerUserId: input.ownerUserId,
			medicalOrderId: input.medicalOrderId,
			purpose: input.purpose,
			now: "2026-09-03T11:00:00.000Z",
		}),
	).resolves.toMatchObject(input);
	await expect(
		getRepositories.medicalInsuranceCredentials.get({
			credentialId: input.credentialId,
			ownerUserId: "another-user",
			medicalOrderId: input.medicalOrderId,
			purpose: input.purpose,
			now: "2026-09-03T11:00:00.000Z",
		}),
	).resolves.toBeUndefined();
});

test("MySQL appointment snapshot rejects implicit zero slot counts", async () => {
	const { pool } = createFakePool([
		[
			{
				schedule_id: "schedule-numeric-coercion-001",
				provider: "zhongyang",
				provider_schedule_id: "provider-schedule-001",
				department_id: "dept-001",
				department_name: "心内科",
				doctor_id: "doctor-001",
				doctor_name: "李医生",
				work_date: "2026-08-20",
				shift_name: "上午",
				start_time: "08:00",
				end_time: "12:00",
				// `Number([]) === 0` 会把损坏排班误报成“0 个号源”。
				total_slots: [],
				available_slots: 0,
				time_group: "range",
				provider_request_id: "provider-request-001",
				observed_at: "2026-08-15 00:00:10.000",
				expires_at: "2026-08-15 00:01:10.000",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.appointmentScheduleSnapshots.findActive(
			"schedule-numeric-coercion-001",
			"2026-08-15T00:00:30.000Z",
		),
	).rejects.toThrow("invalid appointment slot count");
});

test("MySQL appointment schedule snapshots persist provider evidence and enforce expiry reads", async () => {
	const row = {
		schedule_id: "schedule-001",
		provider: "zhongyang",
		provider_schedule_id: "provider-schedule-001",
		department_id: "dept-001",
		department_name: "心内科",
		doctor_id: "doctor-001",
		doctor_name: "李医生",
		work_date: "2026-08-20",
		shift_name: "上午",
		start_time: "08:00",
		end_time: "12:00",
		total_slots: 30,
		available_slots: 12,
		time_group: "range",
		provider_request_id: "provider-request-001",
		observed_at: "2026-08-15 00:00:10.000",
		expires_at: "2026-08-15 00:01:10.000",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }, [row], [row]]);
	const repositories = createMySqlRepositories(pool);
	const schedule = {
		scheduleId: "schedule-001",
		departmentId: "dept-001",
		departmentName: "心内科",
		doctorId: "doctor-001",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		startTime: "08:00",
		endTime: "12:00",
		totalSlots: 30,
		availableSlots: 12,
		timeGroup: "range" as const,
	};

	await expect(
		repositories.appointmentScheduleSnapshots.upsert({
			schedule,
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-001",
			providerRequestId: "provider-request-001",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:01:10.000Z",
		}),
	).resolves.toMatchObject({
		scheduleId: "schedule-001",
		providerScheduleId: "provider-schedule-001",
	});
	await expect(
		repositories.appointmentScheduleSnapshots.findActive(
			"schedule-001",
			"2026-08-15T00:00:30.000Z",
		),
	).resolves.toMatchObject({ providerRequestId: "provider-request-001" });
	expect(state.statements[0]).toContain(
		"INSERT INTO hp_appointment_schedule_snapshots",
	);
	expect(state.statements[0]).toContain("ON DUPLICATE KEY UPDATE");
	expect(state.statements[2]).toContain("expires_at > ?");
});

test("MySQL appointment snapshot rejects malformed UTC DATETIME without timezone guessing", async () => {
	const row = {
		schedule_id: "schedule-invalid-datetime-001",
		provider: "zhongyang",
		provider_schedule_id: "provider-schedule-001",
		department_id: "dept-001",
		department_name: "心内科",
		doctor_id: "doctor-001",
		doctor_name: "李医生",
		work_date: "2026-08-20",
		shift_name: "上午",
		start_time: "08:00",
		end_time: "12:00",
		total_slots: 30,
		available_slots: 12,
		time_group: "range",
		provider_request_id: "provider-request-001",
		// 2 月 30 日不能被 Date.parse 自动进位成另一条有效快照。
		observed_at: "2026-02-30 00:00:10.000",
		expires_at: "2026-02-30 00:01:10.000",
	};
	const { pool } = createFakePool([[row]]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.appointmentScheduleSnapshots.findActive(
			"schedule-invalid-datetime-001",
			"2026-08-15T00:00:30.000Z",
		),
	).rejects.toThrow("invalid appointment timestamp");
});

test("MySQL appointment snapshot validation fails before SQL execution", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.appointmentScheduleSnapshots.upsert({
			schedule: {
				scheduleId: "schedule-invalid-mysql",
				departmentId: "dept-001",
				departmentName: "心内科",
				doctorId: "doctor-001",
				doctorName: "李医生",
				workDate: "2026-08-20",
				shiftName: "上午",
				totalSlots: 1,
				availableSlots: 2,
				timeGroup: "range",
			},
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-invalid",
			providerRequestId: "provider-request-invalid",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:01:10.000Z",
		}),
	).rejects.toMatchObject({
		name: "AppointmentScheduleSnapshotValidationError",
		reason: "invalid_slot_counts",
	});

	expect(state.statements).toHaveLength(0);
});

test("MySQL report references persist provider ids but read them owner-scoped", async () => {
	const row = {
		report_id: "report-001",
		owner_user_id: "user-001",
		patient_id: "patient-001",
		provider: "zhongyang",
		kind: "laboratory",
		provider_report_id: "provider-report-001",
		expires_at: "2026-08-15 00:10:00.000",
		created_at: "2026-08-15 00:00:00.000",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }, [row]]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.reportReferences.upsert({
			reportId: "report-001",
			ownerUserId: "user-001",
			patientId: "patient-001",
			provider: "zhongyang",
			kind: "laboratory",
			providerReportId: "provider-report-001",
			createdAt: "2026-08-15T00:00:00.000Z",
			expiresAt: "2026-08-15T00:10:00.000Z",
		}),
	).resolves.toMatchObject({ reportId: "report-001" });
	await expect(
		repositories.reportReferences.findByOwnerPatientAndId(
			"user-001",
			"patient-001",
			"report-001",
			"2026-08-15T00:05:00.000Z",
		),
	).resolves.toMatchObject({ providerReportId: "provider-report-001" });
	expect(state.statements[0]).toContain("INSERT INTO hp_report_references");
	expect(state.statements[0]).toContain("created_at = VALUES(created_at)");
	expect(state.statements[1]).toContain(
		"owner_user_id = ? AND patient_id = ? AND report_id = ?",
	);
});

test("MySQL PACS 引用持久化查询窗口并按 owner 和患者读回", async () => {
	const row = {
		report_id: "report-pacs-001",
		owner_user_id: "user-001",
		patient_id: "patient-001",
		provider: "zhongyang",
		kind: "imaging",
		provider_report_id: "provider-pacs-001",
		start_date: "2026-08-01",
		end_date: "2026-08-15",
		expires_at: "2026-08-15 00:10:00.000",
		created_at: "2026-08-15 00:00:00.000",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }, [row]]);
	const repositories = createMySqlRepositories(pool);

	await repositories.reportReferences.upsert({
		reportId: "report-pacs-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		provider: "zhongyang",
		kind: "imaging",
		providerReportId: "provider-pacs-001",
		startDate: "2026-08-01",
		endDate: "2026-08-15",
		createdAt: "2026-08-15T00:00:00.000Z",
		expiresAt: "2026-08-15T00:10:00.000Z",
	});
	await expect(
		repositories.reportReferences.findByOwnerPatientAndId(
			"user-001",
			"patient-001",
			"report-pacs-001",
			"2026-08-15T00:05:00.000Z",
		),
	).resolves.toMatchObject({
		kind: "imaging",
		startDate: "2026-08-01",
		endDate: "2026-08-15",
	});
	expect(state.statements[0]).toContain("start_date, end_date");
	expect(state.values[0]).toContain("2026-08-01");
	expect(state.values[0]).toContain("2026-08-15");
});
