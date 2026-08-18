import { expect, test } from "bun:test";
import type {
	OutboxEvent,
	PaymentOrder,
	PaymentPrepayAttempt,
	WechatPaymentNotification,
} from "@hospital/domain";
import { createWechatPaymentNotificationEvent } from "@hospital/domain";
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
			return [state.responses.shift() ?? { affectedRows: 1 }, []];
		},
	};
	const pool = {
		async getConnection() {
			return connection;
		},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			return [state.responses.shift() ?? [], []];
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

test("MySQL transient write failures become a safe persistence error", async () => {
	const pool = {
		async getConnection() {
			throw new Error("transaction connection is not used");
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
	expect(state.values[1]?.[4]).toBe("2026-08-15 00:00:00.000");
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
		{ affectedRows: 1 },
		[{ user_id: "user-001" }],
		[
			{
				operation_id: "operation-001",
				status: "succeeded",
				attempt_count: 2,
				lease_until: "2026-08-16 00:01:00.000",
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
	).rejects.toThrow("invalid user profile version");
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
	expect(state.values[0]).toEqual([
		"user-001",
		"internal-patient-001",
		"zhongyang",
		"his-patient",
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
	const serialized = updateValues[3];
	expect(state.statements[0]).toContain("prepay_id_hash");
	expect(state.statements[1]).toContain("pay_params_ciphertext");
	expect(String(updateValues[2])).not.toBe("prepay-credential-001");
	expect(String(serialized)).not.toContain("sensitive-sign-001");
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
		version: 3,
		query_attempts: 2,
		last_queried_at: "2026-08-15 00:00:15.000",
		next_query_at: "2026-08-15 00:01:00.000",
		query_claimed_until: null,
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
		repositories.reportReferences.findByOwnerAndId(
			"user-001",
			"report-001",
			"2026-08-15T00:05:00.000Z",
		),
	).resolves.toMatchObject({ providerReportId: "provider-report-001" });
	expect(state.statements[0]).toContain("INSERT INTO hp_report_references");
	expect(state.statements[0]).toContain("created_at = VALUES(created_at)");
	expect(state.statements[1]).toContain("owner_user_id = ? AND report_id = ?");
});
