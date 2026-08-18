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
	DependencyNotConfiguredError,
	IdentityUserReadModelValidationError,
	isBoundedOpaqueIdentifier,
	normalizeIdentityUserReadModel,
	normalizeWechatIdentityResult,
	WechatIdentityResultValidationError,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";
import type { RedisSessionStore } from "@hospital/persistence";
import { HttpError } from "../../errors";

export type SessionPrincipal = {
	userId: string;
};

/** 会话 principal 读模型目前只允许落入身份表使用的安全 user_id 列宽。 */
const MAX_SESSION_USER_ID_LENGTH = 64;

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
				traceId: context.traceId,
				provider: "wechat-identity",
				idempotencyKeyPresent: Boolean(context.idempotencyKey),
			},
			"Wechat login requested",
		);

		try {
			// code2session 结果属于可替换 gateway 的运行时边界；在身份写入
			// MySQL 前重新投影，不能把 TypeScript 类型当成授权事实。
			const identity = normalizeWechatIdentityResult(
				await this.dependencies.identityGateway.exchangeCode(
					{ code: input.code },
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
					traceId: context.traceId,
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
					traceId: context.traceId,
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

	try {
		// 即使自定义 session 实现声明了正确的返回类型，这里仍是所有 owner-scoped
		// 路由的共同入口，必须再次校验运行时 principal，而不是直接信任类型。
		return normalizeSessionPrincipal(await sessions.verify(match[1]));
	} catch (error) {
		if (
			error instanceof DependencyNotConfiguredError ||
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
			} catch {
				throw new DependencyNotConfiguredError("session-token");
			}
			return { accessToken, expiresInSeconds };
		},
		async verify(accessToken) {
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
					error instanceof SessionPrincipalReadModelValidationError
				)
					throw error;
				throw new DependencyNotConfiguredError("session-token");
			}
		},
	};
}
