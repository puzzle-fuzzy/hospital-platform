import { expect, test } from "bun:test";
import {
	type PatientDirectoryGateway,
	PatientDirectorySyncInProgressError,
} from "@hospital/domain";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import { PatientService } from "./service";

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
});

test("患者目录不同幂等键也不能在同一 owner 下并发访问 provider", async () => {
	const identityUsers = createInMemoryIdentityUserRepository();
	await identityUsers.findOrCreateByWechat({
		providerSubject: "fixture-openid-patient-cross-page",
		unionId: "fixture-union-patient-cross-page",
	});
	const repository = createInMemoryPatientRepository();
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
