import { expect, test } from "bun:test";
import type { PatientBindingGateway } from "@hospital/domain";
import {
	PatientBindingDirectoryConfirmationError,
	PatientBindingInputError,
	PatientBindingService,
} from "./binding-service";
import type { PatientService } from "./service";

const context = {
	traceId: "binding-service-trace-001",
	idempotencyKey: "binding-service-key-001",
};

test("患者绑定服务派生身份证事实并用独立同步幂等键刷新目录", async () => {
	let received: Record<string, unknown> | undefined;
	let syncKey = "";
	const gateway: PatientBindingGateway = {
		async bind(input) {
			received = input;
			return {
				created: true,
				providerPatientId: "his-patient-binding-001",
				trace: {
					provider: "zhongyang",
					operation: "patient-binding",
					requestId: "provider-binding-001",
				},
			};
		},
	};
	const patients = {
		async sync(_owner: string, syncContext: { idempotencyKey: string }) {
			syncKey = syncContext.idempotencyKey;
			return { items: [], total: 0 };
		},
		async resolvePatientByProviderReference() {
			return {
				patientId: "platform-patient-binding-001",
				provider: "zhongyang" as const,
				providerPatientId: "his-patient-binding-001",
			};
		},
	} as unknown as PatientService;
	const service = new PatientBindingService({
		patients,
		gateway,
		directoryRetryDelaysMs: [],
	});

	await expect(
		service.bind(
			"fixture-owner-binding-001",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
			},
			context,
		),
	).resolves.toMatchObject({ created: true, total: 0 });
	expect(received).toMatchObject({
		displayName: "张三",
		mobile: "13812345678",
		identityNumber: "11010519900101007X",
		birthDate: "1990-01-01",
		sex: "1",
	});
	expect(syncKey).toBe("binding-sync-binding-service-key-001");
});

test("患者绑定服务拒绝未同意或非法身份证且不调用下游", async () => {
	let gatewayCalls = 0;
	const gateway: PatientBindingGateway = {
		async bind() {
			gatewayCalls += 1;
			throw new Error("should not be called");
		},
	};
	const patients = {
		async sync() {
			throw new Error("should not be called");
		},
	} as unknown as PatientService;
	const service = new PatientBindingService({ patients, gateway });

	await expect(
		service.bind(
			"fixture-owner-binding-002",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: false,
			},
			context,
		),
	).rejects.toBeInstanceOf(PatientBindingInputError);
	await expect(
		service.bind(
			"fixture-owner-binding-002",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "not-an-id",
				consent: true,
			},
			context,
		),
	).rejects.toBeInstanceOf(PatientBindingInputError);
	expect(gatewayCalls).toBe(0);
});

test("患者绑定服务迁移旧服务授权并把 JWT 只注入众阳上下文", async () => {
	let receivedInput: Record<string, unknown> | undefined;
	let receivedProviderContext: unknown;
	const service = new PatientBindingService({
		patients: {
			async sync() {
				return { items: [], total: 0 };
			},
			async resolvePatientByProviderReference() {
				return {
					patientId: "platform-patient-binding-003",
					provider: "zhongyang" as const,
					providerPatientId: "his-patient-binding-003",
				};
			},
		} as unknown as PatientService,
		identityUsers: {
			async findOrCreateByWechat() {
				throw new Error("not used");
			},
			async findByUserId() {
				return {
					userId: "fixture-owner-binding-003",
					providerSubject: "openid-003",
					unionId: "union-003",
				};
			},
		},
		providerAuthorizationGateway: {
			async exchangeWechatCode(input) {
				expect(input).toEqual({ code: "wx-code-003" });
				return {
					authorizationToken: "legacy-jwt-003",
					unionId: "union-003",
					trace: {
						provider: "hospital-his",
						operation: "legacy-wechat-login",
						requestId: "legacy-auth-003",
					},
				};
			},
		},
		gateway: {
			async bind(input, _context, providerContext) {
				receivedInput = input;
				receivedProviderContext = providerContext;
				return {
					created: false,
					providerPatientId: "his-patient-binding-003",
					trace: {
						provider: "zhongyang",
						operation: "patient-binding",
						requestId: "provider-binding-003",
					},
				};
			},
		},
		directoryRetryDelaysMs: [],
	});

	await expect(
		service.bind(
			"fixture-owner-binding-003",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
				legacyLoginCode: "wx-code-003",
			},
			{ ...context, idempotencyKey: "binding-service-key-003" },
		),
	).resolves.toMatchObject({ created: false, total: 0 });
	expect(receivedInput).not.toHaveProperty("legacyLoginCode");
	expect(receivedProviderContext).toEqual({
		authorizationToken: "legacy-jwt-003",
	});
});

test("患者绑定后首次目录确认失败时仍使用确认窗口重试", async () => {
	let syncCalls = 0;
	const service = new PatientBindingService({
		gateway: {
			async bind() {
				return {
					created: false,
					providerPatientId: "his-patient-binding-004",
					trace: {
						provider: "zhongyang",
						operation: "patient-binding",
						requestId: "provider-binding-004",
					},
				};
			},
		},
		patients: {
			async sync(_owner: string, syncContext: { idempotencyKey: string }) {
				syncCalls += 1;
				if (syncCalls === 1) throw new Error("directory-not-yet-visible");
				expect(syncContext.idempotencyKey).toBe(
					syncCalls === 2
						? "binding-sync-binding-service-key-004-retry-1"
						: "binding-sync-binding-service-key-004-retry-2",
				);
				return { items: [], total: 0 };
			},
			async resolvePatientByProviderReference() {
				return syncCalls === 3
					? {
							patientId: "platform-patient-binding-004",
							provider: "zhongyang" as const,
							providerPatientId: "his-patient-binding-004",
						}
					: undefined;
			},
		} as unknown as PatientService,
		directoryRetryDelaysMs: [0, 0],
	});

	await expect(
		service.bind(
			"fixture-owner-binding-004",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
			},
			{ ...context, idempotencyKey: "binding-service-key-004" },
		),
	).resolves.toMatchObject({ created: false, total: 0 });
	expect(syncCalls).toBe(3);
});

test("患者绑定目录始终未出现时拒绝伪造成功", async () => {
	let syncCalls = 0;
	const service = new PatientBindingService({
		gateway: {
			async bind() {
				return {
					created: false,
					providerPatientId: "his-patient-binding-missing",
					trace: {
						provider: "zhongyang",
						operation: "patient-binding",
						requestId: "provider-binding-missing",
					},
				};
			},
		},
		patients: {
			async sync() {
				syncCalls += 1;
				return { items: [], total: 0 };
			},
			async resolvePatientByProviderReference() {
				return undefined;
			},
		} as unknown as PatientService,
		directoryRetryDelaysMs: [],
	});

	await expect(
		service.bind(
			"fixture-owner-binding-missing",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
			},
			{ ...context, idempotencyKey: "binding-service-key-missing" },
		),
	).rejects.toBeInstanceOf(PatientBindingDirectoryConfirmationError);
	expect(syncCalls).toBe(1);
});

test("患者绑定服务拒绝旧服务 JWT 与当前 owner 的 unionId 不一致", async () => {
	let gatewayCalls = 0;
	const service = new PatientBindingService({
		patients: {
			async sync() {
				throw new Error("should not be called");
			},
		} as unknown as PatientService,
		identityUsers: {
			async findOrCreateByWechat() {
				throw new Error("not used");
			},
			async findByUserId() {
				return {
					userId: "fixture-owner-binding-005",
					providerSubject: "openid-005",
					unionId: "union-current-005",
				};
			},
		},
		providerAuthorizationGateway: {
			async exchangeWechatCode() {
				return {
					authorizationToken: "legacy-jwt-005",
					unionId: "union-other-005",
					trace: {
						provider: "hospital-his",
						operation: "legacy-wechat-login",
						requestId: "legacy-auth-005",
					},
				};
			},
		},
		gateway: {
			async bind() {
				gatewayCalls += 1;
				throw new Error("should not be called");
			},
		},
		directoryRetryDelaysMs: [],
	});

	await expect(
		service.bind(
			"fixture-owner-binding-005",
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519900101007X",
				consent: true,
				legacyLoginCode: "wx-code-005",
			},
			{ ...context, idempotencyKey: "binding-service-key-005" },
		),
	).rejects.toBeInstanceOf(PatientBindingInputError);
	expect(gatewayCalls).toBe(0);
});

test("患者绑定相同幂等键并发只产生一次 Provider 操作", async () => {
	let providerCalls = 0;
	let releaseProvider!: () => void;
	const providerReleased = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	const service = new PatientBindingService({
		gateway: {
			async bind() {
				providerCalls += 1;
				await providerReleased;
				return {
					created: false,
					providerPatientId: "his-patient-binding-inflight",
					trace: {
						provider: "zhongyang",
						operation: "patient-binding",
						requestId: "provider-binding-inflight",
					},
				};
			},
		},
		patients: {
			async sync() {
				return { items: [], total: 0 };
			},
			async resolvePatientByProviderReference() {
				return {
					patientId: "platform-patient-binding-inflight",
					provider: "zhongyang" as const,
					providerPatientId: "his-patient-binding-inflight",
				};
			},
		} as unknown as PatientService,
		directoryRetryDelaysMs: [],
	});
	const input = {
		displayName: "张三",
		mobile: "13812345678",
		identityNumber: "11010519900101007X",
		consent: true as const,
	};
	const keyContext = { ...context, idempotencyKey: "binding-service-inflight" };
	const first = service.bind(
		"fixture-owner-binding-inflight",
		input,
		keyContext,
	);
	const second = service.bind(
		"fixture-owner-binding-inflight",
		input,
		keyContext,
	);
	const conflicting = service.bind(
		"fixture-owner-binding-inflight",
		{ ...input, displayName: "李四" },
		keyContext,
	);

	await expect(conflicting).rejects.toBeInstanceOf(PatientBindingInputError);
	expect(providerCalls).toBe(1);
	releaseProvider();
	await expect(Promise.all([first, second])).resolves.toEqual([
		{ created: false, items: [], total: 0 },
		{ created: false, items: [], total: 0 },
	]);
	expect(providerCalls).toBe(1);
});
