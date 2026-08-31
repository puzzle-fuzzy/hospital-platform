import type {
	AuthSessionPayload,
	WechatLoginPayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	UserIdentityRepository,
	WechatIdentityGateway,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	IdentityUserReadModelValidationError,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeIdentityUserReadModel,
	normalizeWechatIdentityResult,
	WechatIdentityResultValidationError,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";
import {
	PersistenceUnavailableError,
	type RedisSessionStore,
} from "@hospital/persistence";
import { HttpError } from "../../errors";

export type SessionPrincipal = {
	userId: string;
};

/** 微信登录服务层输入错误；HTTP schema 之外的调用方也必须得到稳定 400。 */
export class WechatLoginInputError extends Error {
	constructor() {
		super("Wechat login input is invalid");
		this.name = "WechatLoginInputError";
	}
}

/** 会话 principal 读模型目前只允许落入身份表使用的安全 user_id 列宽。 */
const MAX_SESSION_USER_ID_LENGTH = 64;

/**
 * 平台会话 token 的 HTTP 传输上限，与小程序登录响应的运行时校验保持一致。
 *
 * token 是不透明凭证，服务端不解析它的 JWT 形状，也不允许任意长度或控制字符
 * 在进入 Redis 前扩散到 key。这个上限只保护传输和存储边界，不代表 token 已经
 * 通过 Redis 会话存在性、owner 或过期校验。
 */
const MAX_SESSION_ACCESS_TOKEN_LENGTH = 512;

/** 会话 token 只允许有界、无首尾空白和控制字符的字符串。 */
function isSafeSessionAccessToken(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_SESSION_ACCESS_TOKEN_LENGTH &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

/**
 * 认证失败的 token 不能进入 session 实现；统一返回 401，避免让 malformed
 * Authorization 头触发 Redis 查询或被误报成依赖故障。
 */
function requireSafeSessionAccessToken(value: unknown): string {
	if (!isSafeSessionAccessToken(value)) {
		throw new HttpError(401, "unauthorized", "登录状态已失效，请重新登录");
	}
	return value;
}

/** Redis 或可替换会话实现返回异常 principal 时只记录这个固定原因。 */
export type SessionPrincipalReadModelViolation = "user-id-invalid";

/**
 * 会话存储返回值违反内部 principal contract 时禁止继续进入 owner-scoped 路由。
 *
 * SessionTokenService 是运行时端口：Redis 中的旧值、手工写入值、测试 fixture 或
 * 未来替换的 token 实现都可能绕过 TypeScript 类型，因此鉴权入口必须重新投影。
 */
export class SessionPrincipalReadModelValidationError extends Error {
	readonly violation: SessionPrincipalReadModelViolation;

	constructor(violation: SessionPrincipalReadModelViolation) {
		super("Session principal read model is invalid");
		this.name = "SessionPrincipalReadModelValidationError";
		this.violation = violation;
	}
}

/**
 * 校验并重新投影会话 principal，丢弃未知字段，避免损坏 userId 进入业务 owner 范围。
 */
export function normalizeSessionPrincipal(value: unknown): SessionPrincipal {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new SessionPrincipalReadModelValidationError("user-id-invalid");
	}

	const userId = (value as Record<string, unknown>).userId;
	if (
		!isBoundedOpaqueIdentifier(userId) ||
		userId.length > MAX_SESSION_USER_ID_LENGTH
	) {
		throw new SessionPrincipalReadModelValidationError("user-id-invalid");
	}

	return { userId };
}

/** 会话实现的最小端口；API 不关心 token 是 JWT、Redis session 还是其他实现。 */
export type SessionTokenService = {
	issue(userId: string): Promise<{
		accessToken: string;
		expiresInSeconds: number;
	}>;
	verify(accessToken: string): Promise<SessionPrincipal>;
};

export type AuthServiceDependencies = {
	identityGateway: WechatIdentityGateway;
	identityUsers: UserIdentityRepository;
	sessions: SessionTokenService;
	/** 生产组合根注入 Pino；测试默认使用静默 logger。 */
	logger?: AppLogger;
};

/**
 * 重新校验微信登录输入的运行时形状。
 *
 * Elysia 会在 HTTP 边界校验 `code`，但登录 service 也可能被组合根、回放
 * 任务或未来 Worker 直接调用。这里不能把 TypeScript 的 payload 类型当成
 * 运行时事实，更不能让 null/数组在读取 `.code` 时变成未映射 500。
 */
function normalizeWechatLoginInput(value: unknown): { code: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new WechatLoginInputError();
	}
	const code = (value as Record<string, unknown>).code;
	if (
		typeof code !== "string" ||
		code.length < 1 ||
		Array.from(code).length > 256 ||
		code !== code.trim() ||
		Array.from(code).some((character) => {
			const codePoint = character.charCodeAt(0);
			return codePoint <= 0x1f || codePoint === 0x7f;
		})
	) {
		// wx.login 产生的 code 是一次性不透明凭证；不能像普通展示文本一样
		// 静默 trim 或清理。不同入口若对同一凭证采用不同规范化规则，会让
		// provider 调用、重试和审计日志出现不可复现的语义差异。
		throw new WechatLoginInputError();
	}
	return { code };
}

/** 微信登录 service 也可能被组合根直接调用，先复用共享上下文运行时门禁。 */
function requireAuthContext(value: unknown): AdapterCallContext {
	const normalized = normalizeAdapterCallContext(value);
	if (!normalized) throw new WechatLoginInputError();
	return normalized;
}

/** 患者端认证编排：兑换 provider code、幂等建用户、签发平台会话。 */
export class AuthService {
	private readonly logger: AppLogger;

	constructor(private readonly dependencies: AuthServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async login(
		input: WechatLoginPayload,
		context: AdapterCallContext,
	): Promise<AuthSessionPayload["data"]> {
		// 只记录链路和结果元数据，绝不把临时 code、openid 或 session_key 写入日志。
		this.logger.info(
			{
				event: "auth.wechat.login.requested",
				traceId: adapterContextTraceId(context),
				provider: "wechat-identity",
				// 这里不能直接读取 context：非法 direct-call 需要先进入统一
				// 输入错误分支，失败日志本身不能再次抛 TypeError。
				idempotencyKeyPresent: Boolean(
					normalizeAdapterCallContext(context)?.idempotencyKey,
				),
			},
			"Wechat login requested",
		);

		try {
			context = requireAuthContext(context);
			const loginInput = normalizeWechatLoginInput(input);
			// code2session 结果属于可替换 gateway 的运行时边界；在身份写入
			// MySQL 前重新投影，不能把 TypeScript 类型当成授权事实。
			const identity = normalizeWechatIdentityResult(
				await this.dependencies.identityGateway.exchangeCode(
					loginInput,
					context,
				),
			);
			// 身份仓储返回值也是运行时边界；必须确认它仍然映射到本次
			// code2session 的 provider subject，才能签发 owner 会话。
			const user = normalizeIdentityUserReadModel(
				await this.dependencies.identityUsers.findOrCreateByWechat({
					providerSubject: identity.providerSubject,
					...(identity.unionId ? { unionId: identity.unionId } : {}),
				}),
				{ expectedProviderSubject: identity.providerSubject },
			);
			const session = await this.dependencies.sessions.issue(user.userId);

			this.logger.info(
				{
					event: "auth.wechat.login.succeeded",
					traceId: adapterContextTraceId(context),
					provider: "wechat-identity",
					providerRequestId: identity.trace.requestId,
					userId: user.userId,
					expiresInSeconds: session.expiresInSeconds,
				},
				"Wechat login succeeded",
			);

			return {
				accessToken: session.accessToken,
				tokenType: "Bearer",
				expiresInSeconds: session.expiresInSeconds,
				user: { id: user.userId },
			};
		} catch (error) {
			// ProviderRequestError 的 message 可能包含 provider 状态，日志只保留分类。
			const providerFailure = providerFailureMetadata(error);
			this.logger.error(
				{
					event: "auth.wechat.login.failed",
					traceId: adapterContextTraceId(context),
					provider: "wechat-identity",
					errorType: error instanceof Error ? error.name : "unknown",
					...providerFailure,
					// 保留旧日志查询使用的 retryable 别名；新业务统一使用
					// providerRetryable，避免维护时破坏既有告警检索。
					...(providerFailure.providerRetryable === undefined
						? {}
						: { retryable: providerFailure.providerRetryable }),
					...(error instanceof WechatIdentityResultValidationError
						? { resultViolation: error.violation }
						: {}),
					...(error instanceof IdentityUserReadModelValidationError
						? { identityViolation: error.violation }
						: {}),
					...(error instanceof SessionPrincipalReadModelValidationError
						? { sessionViolation: error.violation }
						: {}),
				},
				"Wechat login failed",
			);
			throw error;
		}
	}
}

/** 从 HTTP Authorization 头提取会话；provider 错误不能被误报成 401。 */
export async function requirePrincipal(
	authorization: string | undefined,
	sessions: SessionTokenService,
): Promise<SessionPrincipal> {
	const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
	if (!match?.[1]) {
		throw new HttpError(401, "unauthorized", "请先登录后再继续操作");
	}
	const accessToken = requireSafeSessionAccessToken(match[1]);

	try {
		// 即使自定义 session 实现声明了正确的返回类型，这里仍是所有 owner-scoped
		// 路由的共同入口，必须再次校验运行时 principal，而不是直接信任类型。
		return normalizeSessionPrincipal(await sessions.verify(accessToken));
	} catch (error) {
		if (
			error instanceof DependencyNotConfiguredError ||
			error instanceof PersistenceUnavailableError ||
			error instanceof SessionPrincipalReadModelValidationError
		)
			throw error;
		throw new HttpError(401, "unauthorized", "登录状态已失效，请重新登录");
	}
}

/** 测试专用内存 session；生产环境替换为签名 token 或集中式会话实现。 */
export function createInMemorySessionTokenService(): SessionTokenService {
	const sessions = new Map<string, string>();
	let sequence = 0;

	return {
		async issue(userId) {
			const principal = normalizeSessionPrincipal({ userId });
			sequence += 1;
			const accessToken = `fixture-session-${String(sequence).padStart(4, "0")}`;
			sessions.set(accessToken, principal.userId);
			return { accessToken, expiresInSeconds: 3600 };
		},
		async verify(accessToken) {
			requireSafeSessionAccessToken(accessToken);
			const userId = sessions.get(accessToken);
			if (!userId)
				throw new HttpError(401, "unauthorized", "登录状态已失效，请重新登录");
			return normalizeSessionPrincipal({ userId });
		},
	};
}

export function createNotConfiguredSessionTokenService(): SessionTokenService {
	return {
		async issue() {
			throw new DependencyNotConfiguredError("session-token");
		},
		async verify() {
			throw new DependencyNotConfiguredError("session-token");
		},
	};
}

/** 生产会话只保存到 Redis 并带 TTL；Redis 故障必须保留为 503，不伪装成 401。 */
export function createRedisSessionTokenService(
	store: RedisSessionStore,
	expiresInSeconds = 3600,
): SessionTokenService {
	return {
		async issue(userId) {
			const principal = normalizeSessionPrincipal({ userId });
			const accessToken = crypto.randomUUID();
			try {
				await store.save(accessToken, principal.userId, expiresInSeconds);
			} catch (error) {
				// 生产 persistence adapter 已把 Redis 传输错误投影为
				// PersistenceUnavailableError；这里仍保护可替换的测试/未来实现，
				// 防止一个未遵守 port 约定的 store 把故障误报成配置缺失。
				if (
					error instanceof DependencyNotConfiguredError ||
					error instanceof PersistenceUnavailableError
				)
					throw error;
				throw new PersistenceUnavailableError("write", error, "redis");
			}
			return { accessToken, expiresInSeconds };
		},
		async verify(accessToken) {
			requireSafeSessionAccessToken(accessToken);
			try {
				const userId = await store.findUserId(accessToken);
				if (!userId) {
					throw new HttpError(
						401,
						"unauthorized",
						"登录状态已失效，请重新登录",
					);
				}
				return normalizeSessionPrincipal({ userId });
			} catch (error) {
				if (
					error instanceof HttpError ||
					error instanceof DependencyNotConfiguredError ||
					error instanceof PersistenceUnavailableError ||
					error instanceof SessionPrincipalReadModelValidationError
				)
					throw error;
				throw new PersistenceUnavailableError("read", error, "redis");
			}
		},
	};
}
