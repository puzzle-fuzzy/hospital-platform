import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	DependencyNotConfiguredError,
	IdentityUserReadModelValidationError,
	WechatIdentityResultValidationError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	AuthService,
	createRedisSessionTokenService,
	requirePrincipal,
	SessionPrincipalReadModelValidationError,
	WechatLoginInputError,
} from "./service";

test("Redis session service issues and verifies a TTL-backed token", async () => {
	const sessions = new Map<string, string>();
	const service = createRedisSessionTokenService({
		async save(accessToken, userId) {
			sessions.set(accessToken, userId);
		},
		async findUserId(accessToken) {
			return sessions.get(accessToken);
		},
	});

	const issued = await service.issue("user-001");

	expect(issued.expiresInSeconds).toBe(3600);
	expect((await service.verify(issued.accessToken)).userId).toBe("user-001");
});

test("Redis session service fails closed when Redis is unavailable", async () => {
	const service = createRedisSessionTokenService({
		async save() {
			throw new Error("redis unavailable");
		},
		async findUserId() {
			throw new Error("redis unavailable");
		},
	});

	expect(service.issue("user-001")).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
	expect(service.verify("token-001")).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
});

test("Redis session 读模型返回异常 userId 时拒绝进入业务", async () => {
	const service = createRedisSessionTokenService({
		async save() {
			throw new Error("must not be called");
		},
		async findUserId() {
			return "user-\u0000-corrupt";
		},
	});

	await expect(service.verify("token-001")).rejects.toBeInstanceOf(
		SessionPrincipalReadModelValidationError,
	);
});

test("Redis session 写入前拒绝异常 userId", async () => {
	let saveCalls = 0;
	const service = createRedisSessionTokenService({
		async save() {
			saveCalls += 1;
		},
		async findUserId() {
			return undefined;
		},
	});

	await expect(service.issue("user-\u0000-corrupt")).rejects.toBeInstanceOf(
		SessionPrincipalReadModelValidationError,
	);
	expect(saveCalls).toBe(0);
});

test("统一鉴权入口不信任自定义 session 返回的 principal 类型", async () => {
	const sessions = {
		async issue() {
			return { accessToken: "token-001", expiresInSeconds: 3600 };
		},
		async verify() {
			return { userId: "user-\u0000-corrupt" } as never;
		},
	};

	await expect(
		requirePrincipal("Bearer token-001", sessions),
	).rejects.toBeInstanceOf(SessionPrincipalReadModelValidationError);
});

test("鉴权入口拒绝越界或控制字符 token，且不触碰 session 实现", async () => {
	let verifyCalls = 0;
	const sessions = {
		async issue() {
			return { accessToken: "token-001", expiresInSeconds: 3600 };
		},
		async verify() {
			verifyCalls += 1;
			return { userId: "user-001" };
		},
	};

	for (const token of ["x".repeat(513), "token-\u0000-001"]) {
		await expect(
			requirePrincipal(`Bearer ${token}`, sessions),
		).rejects.toMatchObject({
			statusCode: 401,
			code: "unauthorized",
		});
	}
	expect(verifyCalls).toBe(0);
});

test("Redis session 直接校验 token 边界后才访问 Redis", async () => {
	let findCalls = 0;
	const service = createRedisSessionTokenService({
		async save() {
			throw new Error("must not be called");
		},
		async findUserId() {
			findCalls += 1;
			return "user-001";
		},
	});

	await expect(service.verify("x".repeat(513))).rejects.toMatchObject({
		statusCode: 401,
		code: "unauthorized",
	});
	expect(findCalls).toBe(0);
});

test("微信登录业务日志只记录可关联元数据，不记录身份凭证", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				return {
					providerSubject: "openid-must-not-be-logged",
					unionId: "unionid-must-not-be-logged",
					trace: {
						provider: "wechat-identity",
						operation: "code2session",
						requestId: "wechat-provider-request-001",
					},
				};
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				return {
					userId: "user-001",
					providerSubject: "openid-must-not-be-logged",
				};
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				return {
					accessToken: "access-token-must-not-be-logged",
					expiresInSeconds: 3600,
				};
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
		logger,
	});

	await service.login(
		{ code: "temporary-code-must-not-be-logged" },
		{ traceId: "auth-trace-001", idempotencyKey: "auth-idempotency-001" },
	);

	const output = lines.join("");
	expect(output).toContain("auth.wechat.login.requested");
	expect(output).toContain("auth.wechat.login.succeeded");
	expect(output).toContain("wechat-provider-request-001");
	expect(output).toContain("user-001");
	expect(output).not.toContain("temporary-code-must-not-be-logged");
	expect(output).not.toContain("openid-must-not-be-logged");
	expect(output).not.toContain("unionid-must-not-be-logged");
	expect(output).not.toContain("access-token-must-not-be-logged");
});

test("微信 provider 失败日志不记录 provider message 或临时 code", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				throw new ProviderRequestError({
					provider: "wechat-identity",
					operation: "code2session",
					message: "provider code 40029 with secret text",
					retryable: false,
				});
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				throw new Error("must not be called");
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				throw new Error("must not be called");
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
		logger,
	});

	await expect(
		service.login(
			{ code: "temporary-code-must-not-be-logged" },
			{ traceId: "auth-trace-failed-001", idempotencyKey: "idempotency-001" },
		),
	).rejects.toBeInstanceOf(ProviderRequestError);

	const output = lines.join("");
	expect(output).toContain("auth.wechat.login.failed");
	expect(output).toContain('"retryable":false');
	expect(output).not.toContain("40029");
	expect(output).not.toContain("secret text");
	expect(output).not.toContain("temporary-code-must-not-be-logged");
});

test("微信身份交换结果在身份写入前拒绝异常值并记录固定原因", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	let identityWriteCalls = 0;
	let sessionIssueCalls = 0;
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				// 运行时端口可以被替换或被错误实现，故意模拟绕过 adapter
				// 类型的异常 providerSubject，验证 AuthService 的第二道边界。
				return {
					providerSubject: "openid\u0000must-be-rejected",
					unionId: "unionid-001",
					trace: {
						provider: "wechat-identity",
						operation: "code2session",
						requestId: "wechat-provider-request-001",
					},
				} as never;
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				identityWriteCalls += 1;
				throw new Error("must not be called");
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				sessionIssueCalls += 1;
				throw new Error("must not be called");
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
		logger,
	});

	await expect(
		service.login(
			{ code: "temporary-code-001" },
			{
				traceId: "auth-trace-invalid-result-001",
				idempotencyKey: "auth-idempotency-invalid-result-001",
			},
		),
	).rejects.toBeInstanceOf(WechatIdentityResultValidationError);

	expect(identityWriteCalls).toBe(0);
	expect(sessionIssueCalls).toBe(0);
	const output = lines.join("");
	expect(output).toContain("auth.wechat.login.failed");
	expect(output).toContain('"resultViolation":"provider-subject-invalid"');
	expect(output).not.toContain("must-be-rejected");
});

test("身份仓储结果越过 owner/provider 范围时不签发会话", async () => {
	const lines: string[] = [];
	let sessionIssueCalls = 0;
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				return {
					providerSubject: "openid-identity-repository-001",
					trace: {
						provider: "wechat-identity",
						operation: "code2session",
						requestId: "wechat-provider-request-002",
					},
				};
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				// 模拟数据库/替换仓储返回了异常身份，不能让它成为本次会话 owner。
				return {
					userId: "user-\u0000-corrupt",
					providerSubject: "openid-identity-repository-001",
				} as never;
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				sessionIssueCalls += 1;
				throw new Error("must not be called");
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.login(
			{ code: "temporary-code-002" },
			{
				traceId: "auth-trace-identity-repository-001",
				idempotencyKey: "auth-idempotency-identity-repository-001",
			},
		),
	).rejects.toBeInstanceOf(IdentityUserReadModelValidationError);

	expect(sessionIssueCalls).toBe(0);
	const output = lines.join("");
	expect(output).toContain('"identityViolation":"user-id-invalid"');
	expect(output).not.toContain("corrupt");
});

test("微信登录服务拒绝绕过 HTTP schema 的畸形输入", async () => {
	let providerCalls = 0;
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				providerCalls += 1;
				throw new Error("must not be called");
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				throw new Error("must not be called");
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				throw new Error("must not be called");
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
	});

	await expect(
		service.login(null as never, {
			traceId: "auth-invalid-input-trace",
			idempotencyKey: "auth-invalid-input-key",
		}),
	).rejects.toBeInstanceOf(WechatLoginInputError);
	expect(providerCalls).toBe(0);
});

test("微信登录服务拒绝首尾空白和控制字符 code，且不调用 provider", async () => {
	let providerCalls = 0;
	const service = new AuthService({
		identityGateway: {
			async exchangeCode() {
				providerCalls += 1;
				throw new Error("must not be called");
			},
		},
		identityUsers: {
			async findOrCreateByWechat() {
				throw new Error("must not be called");
			},
			async findByUserId() {
				return undefined;
			},
		},
		sessions: {
			async issue() {
				throw new Error("must not be called");
			},
			async verify() {
				return { userId: "user-001" };
			},
		},
	});

	for (const code of [" login-code", "login-code ", "login-\u0000-code"]) {
		await expect(
			service.login(
				{ code },
				{
					traceId: "auth-invalid-code-boundary-trace",
					idempotencyKey: "auth-invalid-code-boundary-key",
				},
			),
		).rejects.toBeInstanceOf(WechatLoginInputError);
	}
	expect(providerCalls).toBe(0);
});
