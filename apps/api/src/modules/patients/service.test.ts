import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	IdentityUserReadModelValidationError,
	MAX_PATIENT_DIRECTORY_ITEMS,
	type PatientDirectoryGateway,
	PatientDirectoryGeneratedIdValidationError,
	PatientDirectoryResultValidationError,
	PatientDirectorySnapshotResultValidationError,
	PatientDirectorySnapshotUnsafeError,
	PatientDirectorySyncInProgressError,
	PatientReadModelValidationError,
	type PatientRecord,
	type PatientRepository,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import { PatientService } from "./service";

test("患者目录读取使用独立读模型日志且不泄露 owner 或患者正文", async () => {
	const lines: string[] = [];
	const service = new PatientService(
		createInMemoryPatientRepository([
			{
				id: "internal-patient-read-001",
				ownerUserId: "fixture-owner-read-001",
				displayName: "读模型患者",
				relationship: "self",
				cardNumberMasked: "******0001",
				source: "hospital-his",
				clinicalAccess: "ready",
			},
		]),
		{
			logger: createLogger({
				service: "hospital-api-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		},
	);

	await expect(
		service.list("fixture-owner-read-001", {
			traceId: "patient-read-trace-001",
			idempotencyKey: "patient-read-key-001",
		}),
	).resolves.toMatchObject({ total: 1 });

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"patient.directory.read.requested",
		"patient.directory.read.loaded",
	]);
	expect(records[1]).toMatchObject({
		traceId: "patient-read-trace-001",
		itemCount: 1,
	});
	expect(JSON.stringify(records)).not.toContain("fixture-owner-read-001");
	expect(JSON.stringify(records)).not.toContain("读模型患者");
});

test("患者同步拒绝越过 owner 范围的身份仓储结果并且不调用 Provider", async () => {
	let providerCalls = 0;
	const lines: string[] = [];
	const service = new PatientService(createInMemoryPatientRepository(), {
		identityUsers: {
			async findByUserId() {
				return {
					userId: "other-owner",
					providerSubject: "openid-001",
					unionId: "unionid-001",
				} as never;
			},
			async findOrCreateByWechat() {
				throw new Error("not used");
			},
		},
		directory: {
			async listByIdentity() {
				providerCalls += 1;
				throw new Error("provider must not be called");
			},
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-identity-read-trace",
			idempotencyKey: "patient-identity-read-key",
		}),
	).rejects.toBeInstanceOf(IdentityUserReadModelValidationError);

	expect(providerCalls).toBe(0);
	expect(lines.join("\n")).toContain('"identityViolation":"user-id-mismatch"');
});

test("患者快照已提交后读模型失败不再伪造同步失败", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-read-failure",
		unionId: "fixture-union-patient-read-failure",
	});
	const baseRepository = createInMemoryPatientRepository();
	const lines: string[] = [];
	let readModelShouldFail = false;
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	const repository: PatientRepository = {
		...baseRepository,
		async listByOwner(ownerUserId) {
			if (readModelShouldFail) {
				throw new Error("fixture read model unavailable");
			}
			return baseRepository.listByOwner(ownerUserId);
		},
		async replaceDirectorySnapshot(input) {
			// 让底层快照事务先使用自己的 this 完成提交，再模拟提交后的
			// 独立读模型连接失败；这样可以验证两条业务事实不会混日志。
			const snapshot = await replaceDirectorySnapshot.call(
				baseRepository,
				input,
			);
			readModelShouldFail = true;
			return snapshot;
		},
	};
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-read-failure-provider-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-read-failure-trace",
			idempotencyKey: "patient-read-failure-key",
		}),
	).rejects.toThrow("fixture read model unavailable");

	const events = lines.map(
		(line) => (JSON.parse(line) as Record<string, unknown>).event,
	);
	expect(events).toContain("patient.directory.synced");
	expect(events).toContain("patient.directory.read.failed");
	expect(events).not.toContain("patient.directory.failed");
});

test("患者快照事务已提交但返回读模型损坏时保留提交事实并单独记录读取失败", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-snapshot-result-invalid",
		unionId: "fixture-union-snapshot-result-invalid",
	});
	const baseRepository = createInMemoryPatientRepository();
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	const repository: PatientRepository = {
		...baseRepository,
		async replaceDirectorySnapshot(input) {
			await replaceDirectorySnapshot.call(baseRepository, input);
			return {
				activePatients: [],
				deactivatedPatientCount: -1,
			} as never;
		},
	};
	const lines: string[] = [];
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "snapshot-result-invalid-provider-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "snapshot-result-invalid-trace",
			idempotencyKey: "snapshot-result-invalid-key",
		}),
	).rejects.toBeInstanceOf(PatientDirectorySnapshotResultValidationError);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	const readFailure = records.find(
		(record) => record.event === "patient.directory.read.failed",
	);
	expect(
		records.some(
			(record) => record.event === "patient.directory.snapshot.committed",
		),
	).toBe(true);
	expect(readFailure).toMatchObject({
		readModelViolation: "deactivated-count-invalid",
	});
	expect(
		records.some((record) => record.event === "patient.directory.synced"),
	).toBe(false);
	expect(
		records.some((record) => record.event === "patient.directory.failed"),
	).toBe(false);
});

test("患者目录同步在快照写入前拒绝非法网关结果并记录固定原因", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-result-invalid",
		unionId: "fixture-union-patient-result-invalid",
	});
	const baseRepository = createInMemoryPatientRepository();
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	let replaceCalls = 0;
	const repository: PatientRepository = {
		...baseRepository,
		async replaceDirectorySnapshot(input) {
			replaceCalls += 1;
			return replaceDirectorySnapshot.call(baseRepository, input);
		},
	};
	const lines: string[] = [];
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [
					{
						providerPatientId: "provider-patient-result-invalid",
						displayName: "非法卡号患者",
						relationship: "self",
						// 故意模拟网关绕过 adapter，把完整卡号交给 service。
						cardNumberMasked: "123456789012345678",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-result-invalid-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-result-invalid-trace",
			idempotencyKey: "patient-result-invalid-key",
		}),
	).rejects.toBeInstanceOf(PatientDirectoryResultValidationError);
	expect(replaceCalls).toBe(0);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.failed",
			resultViolation: "patient-card-number-invalid",
		}),
	);
	expect(lines.join("\n")).not.toContain("123456789012345678");
});

test("患者目录同步超过资源上限时在快照事务前整批拒绝", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-too-many",
		unionId: "fixture-union-patient-too-many",
	});
	const baseRepository = createInMemoryPatientRepository();
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	let replaceCalls = 0;
	const repository: PatientRepository = {
		...baseRepository,
		async replaceDirectorySnapshot(input) {
			replaceCalls += 1;
			return replaceDirectorySnapshot.call(baseRepository, input);
		},
	};
	const lines: string[] = [];
	const patients = Array.from(
		{ length: MAX_PATIENT_DIRECTORY_ITEMS + 1 },
		(_, index) => ({
			providerPatientId: `provider-patient-too-many-${index}`,
			displayName: `患者${index}`,
			relationship: "self" as const,
			cardNumberMasked: "12345*7890",
		}),
	);
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients,
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-too-many-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-too-many-trace",
			idempotencyKey: "patient-too-many-key",
		}),
	).rejects.toMatchObject({
		name: "PatientDirectoryResultValidationError",
		violation: "patients-too-many",
	});
	expect(replaceCalls).toBe(0);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.failed",
			resultViolation: "patients-too-many",
		}),
	);
});

test("患者目录同步在快照事务前拒绝重复的平台患者 ID", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-generated-id",
		unionId: "fixture-union-patient-generated-id",
	});
	const baseRepository = createInMemoryPatientRepository();
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	let replaceCalls = 0;
	const repository: PatientRepository = {
		...baseRepository,
		async replaceDirectorySnapshot(input) {
			replaceCalls += 1;
			return replaceDirectorySnapshot.call(baseRepository, input);
		},
	};
	const lines: string[] = [];
	const service = new PatientService(repository, {
		identityUsers,
		createPatientId: () => "same-platform-patient-id",
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [
					{
						providerPatientId: "provider-patient-generated-id-001",
						displayName: "第一位患者",
						relationship: "self",
						cardNumberMasked: "12345*7890",
					},
					{
						providerPatientId: "provider-patient-generated-id-002",
						displayName: "第二位患者",
						relationship: "child",
						cardNumberMasked: "54321*0987",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-generated-id-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-generated-id-trace",
			idempotencyKey: "patient-generated-id-key",
		}),
	).rejects.toBeInstanceOf(PatientDirectoryGeneratedIdValidationError);
	expect(replaceCalls).toBe(0);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.failed",
			generatedIdViolation: "patient-id-duplicate",
		}),
	);
});

test("空患者快照先校验已有读模型并记录固定原因", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-empty-read-model",
		unionId: "fixture-union-patient-empty-read-model",
	});
	const baseRepository = createInMemoryPatientRepository();
	const replaceDirectorySnapshot = baseRepository.replaceDirectorySnapshot;
	if (!replaceDirectorySnapshot) throw new Error("snapshot unavailable");
	let replaceCalls = 0;
	const repository: PatientRepository = {
		...baseRepository,
		// 故意模拟越过 TypeScript 的回放/缓存实现，验证空快照保护不会
		// 把非数组仓储结果当成“当前没有患者”。
		listByOwner: async () => null as unknown as readonly PatientRecord[],
		async replaceDirectorySnapshot(input) {
			replaceCalls += 1;
			return replaceDirectorySnapshot.call(baseRepository, input);
		},
	};
	const lines: string[] = [];
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-empty-read-model-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-empty-read-model-trace",
			idempotencyKey: "patient-empty-read-model-key",
		}),
	).rejects.toBeInstanceOf(PatientReadModelValidationError);
	expect(replaceCalls).toBe(0);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.failed",
			readModelViolation: "patients-not-array",
		}),
	);
});

test("已有医院目录时拒绝把歧义空快照应用成批量失效", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-empty-unsafe",
		unionId: "fixture-union-patient-empty-unsafe",
	});
	const repository = createInMemoryPatientRepository([
		{
			id: "internal-patient-empty-unsafe",
			ownerUserId: "fixture-user-0001",
			displayName: "已有就诊人",
			relationship: "self",
			cardNumberMasked: "12345*7890",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);
	const lines: string[] = [];
	const service = new PatientService(repository, {
		identityUsers,
		directory: {
			listByIdentity: async () => ({
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-empty-unsafe-request",
				},
			}),
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-empty-unsafe-trace",
			idempotencyKey: "patient-empty-unsafe-key",
		}),
	).rejects.toBeInstanceOf(PatientDirectorySnapshotUnsafeError);

	await expect(repository.listByOwner("fixture-user-0001")).resolves.toEqual([
		expect.objectContaining({
			id: "internal-patient-empty-unsafe",
			displayName: "已有就诊人",
		}),
	]);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.failed",
			errorType: "PatientDirectorySnapshotUnsafeError",
		}),
	);
	expect(
		records.some((record) => record.event === "patient.directory.synced"),
	).toBe(false);
});

test("患者目录快照使用 provider 请求发起时间，避免乱序响应覆盖新快照", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-order",
		unionId: "fixture-union-patient-order",
	});
	const repository = createInMemoryPatientRepository();
	let providerRequestStarted = false;
	let nowCalls = 0;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerRequestStarted = true;
			return {
				complete: true,
				patients: [
					{
						providerPatientId: "provider-patient-order",
						displayName: "顺序患者",
						relationship: "self",
						cardNumberMasked: "******0001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-order-request",
				},
			};
		},
	};

	const service = new PatientService(repository, {
		identityUsers,
		directory,
		now: () => {
			// 如果时间是在 provider 返回后才采样，本断言会在真实竞态位置失败。
			expect(providerRequestStarted).toBe(false);
			nowCalls += 1;
			return new Date("2026-08-16T00:00:00.000Z");
		},
		createPatientId: () => "internal-patient-order",
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-order-trace",
			idempotencyKey: "patient-order-key",
		}),
	).resolves.toMatchObject({ total: 1 });
	expect(nowCalls).toBe(1);
});

test("患者目录同步成功后使用 durable operation replay，不重复访问 provider", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-replay",
		unionId: "fixture-union-patient-replay",
	});
	const repository = createInMemoryPatientRepository();
	let providerCalls = 0;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCalls += 1;
			return {
				complete: true,
				patients: [
					{
						providerPatientId: "provider-patient-replay",
						displayName: "重放患者",
						relationship: "self",
						cardNumberMasked: "******0002",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-replay-request",
				},
			};
		},
	};
	const service = new PatientService(repository, {
		identityUsers,
		directory,
		createPatientId: () => "internal-patient-replay",
		now: () => new Date("2026-08-16T00:00:00.000Z"),
	});
	const context = {
		traceId: "patient-replay-trace",
		idempotencyKey: "patient-replay-key",
	};

	const first = await service.sync("fixture-user-0001", context);
	const replay = await service.sync("fixture-user-0001", context);

	expect(replay).toEqual(first);
	expect(providerCalls).toBe(1);
});

test("患者目录同步租约未到期时返回处理中冲突且不触发第二次 provider 请求", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-in-progress",
		unionId: "fixture-union-patient-in-progress",
	});
	const repository = createInMemoryPatientRepository();
	const lines: string[] = [];
	let providerCalls = 0;
	let releaseProvider!: () => void;
	const providerReleased = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCalls += 1;
			await providerReleased;
			return {
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-in-progress-request",
				},
			};
		},
	};
	const service = new PatientService(repository, {
		identityUsers,
		directory,
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
		now: () => new Date("2026-08-16T00:00:00.000Z"),
		syncLeaseMs: 1_000,
	});
	const context = {
		traceId: "patient-in-progress-trace",
		idempotencyKey: "patient-in-progress-key",
	};

	const first = service.sync("fixture-user-0001", context);
	// 让第一个请求先取得租约并进入 provider，再发起相同 key 的第二个请求。
	while (providerCalls === 0) await Promise.resolve();
	await expect(
		service.sync("fixture-user-0001", context),
	).rejects.toBeInstanceOf(PatientDirectorySyncInProgressError);
	expect(providerCalls).toBe(1);
	releaseProvider();
	await expect(first).resolves.toMatchObject({ total: 0 });
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	const conflictRecord = records.find(
		(record) => record.event === "patient.directory.operation.in_progress",
	);
	expect(conflictRecord).toMatchObject({ conflictScope: "same-key" });
	expect(
		records.some((record) => record.event === "patient.directory.failed"),
	).toBe(false);
});

test("患者目录不同幂等键也不能在同一 owner 下并发访问 provider", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-cross-page",
		unionId: "fixture-union-patient-cross-page",
	});
	const repository = createInMemoryPatientRepository();
	const lines: string[] = [];
	let providerCalls = 0;
	let releaseProvider!: () => void;
	const providerReleased = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCalls += 1;
			await providerReleased;
			return {
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-cross-page-request",
				},
			};
		},
	};
	const service = new PatientService(repository, {
		identityUsers,
		directory,
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
		now: () => new Date("2026-08-16T00:00:00.000Z"),
		syncLeaseMs: 1_000,
	});

	const first = service.sync("fixture-user-0001", {
		traceId: "patient-cross-page-home-trace",
		idempotencyKey: "patient-cross-page-home-key",
	});
	while (providerCalls === 0) await Promise.resolve();
	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-cross-page-select-trace",
			idempotencyKey: "patient-cross-page-select-key",
		}),
	).rejects.toBeInstanceOf(PatientDirectorySyncInProgressError);
	expect(providerCalls).toBe(1);

	releaseProvider();
	await expect(first).resolves.toMatchObject({ total: 0 });
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	const conflictRecord = records.find(
		(record) => record.event === "patient.directory.operation.in_progress",
	);
	expect(conflictRecord).toMatchObject({ conflictScope: "owner-provider" });
	expect(
		records.some((record) => record.event === "patient.directory.failed"),
	).toBe(false);
	expect(JSON.stringify(records)).not.toContain(
		"patient-cross-page-select-key",
	);
});

test("患者目录旧租约晚返回时记录过期事件且不能覆盖新快照", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-stale",
		unionId: "fixture-union-patient-stale",
	});
	const repository = createInMemoryPatientRepository();
	const lines: string[] = [];
	let now = new Date("2026-08-16T00:00:00.000Z");
	let providerCalls = 0;
	let releaseFirst!: () => void;
	const firstBlocked = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCalls += 1;
			if (providerCalls === 1) await firstBlocked;
			return {
				complete: true,
				patients: [
					{
						providerPatientId:
							providerCalls === 1 ? "provider-stale-old" : "provider-stale-new",
						displayName: providerCalls === 1 ? "旧快照患者" : "新快照患者",
						relationship: "self",
						cardNumberMasked: "******0001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: `patient-stale-request-${providerCalls}`,
				},
			};
		},
	};
	let generatedIds = 0;
	const service = new PatientService(repository, {
		identityUsers,
		directory,
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
		now: () => now,
		syncLeaseMs: 1_000,
		createPatientId: () => `internal-patient-stale-${++generatedIds}`,
	});

	const first = service.sync("fixture-user-0001", {
		traceId: "patient-stale-old-trace",
		idempotencyKey: "patient-stale-old-key",
	});
	while (providerCalls === 0) await Promise.resolve();
	now = new Date("2026-08-16T00:00:02.000Z");
	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-stale-new-trace",
			idempotencyKey: "patient-stale-new-key",
		}),
	).resolves.toMatchObject({ total: 1 });
	releaseFirst();
	await expect(first).rejects.toMatchObject({
		name: "PatientDirectorySnapshotStaleError",
	});

	expect(await repository.listByOwner("fixture-user-0001")).toMatchObject([
		{ displayName: "新快照患者", source: "hospital-his" },
	]);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(
		records.some(
			(record) => record.event === "patient.directory.snapshot.stale",
		),
	).toBe(true);
	expect(
		records.some((record) => record.event === "patient.directory.failed"),
	).toBe(false);
});

test("患者目录 provider 失败后只在租约到期才允许同 key 接管重试", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-retry",
		unionId: "fixture-union-patient-retry",
	});
	const repository = createInMemoryPatientRepository();
	let now = new Date("2026-08-16T00:00:00.000Z");
	let providerCalls = 0;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCalls += 1;
			if (providerCalls === 1) throw new Error("fixture provider timeout");
			return {
				complete: true,
				patients: [],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "patient-retry-request",
				},
			};
		},
	};
	const service = new PatientService(repository, {
		identityUsers,
		directory,
		now: () => now,
		syncLeaseMs: 1_000,
	});
	const context = {
		traceId: "patient-retry-trace",
		idempotencyKey: "patient-retry-key",
	};

	await expect(service.sync("fixture-user-0001", context)).rejects.toThrow(
		"fixture provider timeout",
	);
	await expect(
		service.sync("fixture-user-0001", context),
	).rejects.toBeInstanceOf(PatientDirectorySyncInProgressError);
	now = new Date("2026-08-16T00:00:01.001Z");
	await expect(
		service.sync("fixture-user-0001", context),
	).resolves.toMatchObject({
		total: 0,
	});
	expect(providerCalls).toBe(2);
});

test("患者目录 provider 失败日志保留安全诊断字段且不泄露查询参数", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-log-safe",
		unionId: "fixture-union-patient-log-safe",
	});
	const lines: string[] = [];
	const sensitiveCard = "fixture-archive-card-secret";
	const sensitiveName = "fixture-archive-name-secret";
	const providerError = new ProviderRequestError({
		provider: "zhongyang",
		operation: "patient-archive",
		requestId: "patient-archive-failed-request",
		statusCode: 502,
		retryable: true,
		message: `raw URL contains ${sensitiveCard} and ${sensitiveName}`,
		cause: new Error(`raw provider body contains ${sensitiveCard}`),
	});
	const service = new PatientService(createInMemoryPatientRepository(), {
		identityUsers,
		directory: {
			async listByIdentity() {
				throw providerError;
			},
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.sync("fixture-user-0001", {
			traceId: "patient-log-safe-trace",
			idempotencyKey: "patient-log-safe-key",
		}),
	).rejects.toBe(providerError);

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	const failure = records.find(
		(record) => record.event === "patient.directory.failed",
	);
	expect(failure).toMatchObject({
		providerOperation: "patient-archive",
		providerRequestId: "patient-archive-failed-request",
		providerStatusCode: 502,
		providerRetryable: true,
	});
	// 失败日志只能出现白名单元数据，不能把 Provider 错误 message/cause
	// 中的卡号、姓名或原始报文带回结构化日志。
	expect(lines.join("\n")).not.toContain(sensitiveCard);
	expect(lines.join("\n")).not.toContain(sensitiveName);
});

test("患者目录读取再次校验 owner 和重复 ID，并记录固定读模型原因", async () => {
	const baseRepository = createInMemoryPatientRepository();
	const lines: string[] = [];
	const repository: PatientRepository = {
		...baseRepository,
		async listByOwner() {
			return [
				{
					id: "patient-read-invalid-001",
					ownerUserId: "other-owner",
					displayName: "错误归属患者",
					relationship: "self",
					cardNumberMasked: "******0001",
					source: "hospital-his",
					clinicalAccess: "ready",
				} as unknown as PatientRecord,
			];
		},
	};
	const service = new PatientService(repository, {
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("owner-001", {
			traceId: "patient-read-model-invalid-trace",
			idempotencyKey: "patient-read-model-invalid-key",
		}),
	).rejects.toMatchObject({
		name: "PatientReadModelValidationError",
		violation: "patient-owner-mismatch",
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.read.failed",
			readModelViolation: "patient-owner-mismatch",
		}),
	);
});

test("患者目录读模型拒绝完整卡号并记录固定脱敏违规原因", async () => {
	const baseRepository = createInMemoryPatientRepository();
	const lines: string[] = [];
	const repository: PatientRepository = {
		...baseRepository,
		async listByOwner() {
			return [
				{
					id: "patient-card-read-invalid-001",
					ownerUserId: "owner-001",
					displayName: "完整卡号患者",
					relationship: "self",
					// 故意模拟持久化层或人工修复把完整卡号带回读模型。
					cardNumberMasked: "123456789012345678",
					source: "hospital-his",
					clinicalAccess: "ready",
				} as unknown as PatientRecord,
			];
		},
	};
	const service = new PatientService(repository, {
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("owner-001", {
			traceId: "patient-card-read-invalid-trace",
			idempotencyKey: "patient-card-read-invalid-key",
		}),
	).rejects.toMatchObject({
		name: "PatientReadModelValidationError",
		violation: "patient-card-number-invalid",
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	// 日志只保留固定原因，不把完整卡号或患者展示文本写入日志。
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.read.failed",
			readModelViolation: "patient-card-number-invalid",
		}),
	);
	expect(lines.join("\n")).not.toContain("123456789012345678");
});

test("患者目录读取超过资源上限时不伪装成完整成功", async () => {
	const baseRepository = createInMemoryPatientRepository();
	const lines: string[] = [];
	const repository: PatientRepository = {
		...baseRepository,
		async listByOwner() {
			return Array.from(
				{ length: MAX_PATIENT_DIRECTORY_ITEMS + 1 },
				(_, index) =>
					({
						id: `patient-read-too-many-${index}`,
						ownerUserId: "owner-001",
						displayName: `患者${index}`,
						relationship: "self",
						cardNumberMasked: "12345*********7890",
						source: "hospital-his",
						clinicalAccess: "ready",
					}) as PatientRecord,
			);
		},
	};
	const service = new PatientService(repository, {
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("owner-001", {
			traceId: "patient-read-too-many-trace",
			idempotencyKey: "patient-read-too-many-key",
		}),
	).rejects.toMatchObject({
		name: "PatientReadModelValidationError",
		violation: "patients-too-many",
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "patient.directory.read.failed",
			readModelViolation: "patients-too-many",
		}),
	);
	expect(records).not.toContainEqual(
		expect.objectContaining({ event: "patient.directory.read.loaded" }),
	);
});
