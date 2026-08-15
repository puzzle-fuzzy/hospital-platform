import type {
	AdapterCallContext,
	UserIdentityRepository,
	WechatIdentityGateway,
} from "@hospital/domain";
import type {
	AuthSessionPayload,
	WechatLoginPayload,
} from "@hospital/contracts";
import type { RedisSessionStore } from "@hospital/persistence";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { HttpError } from "../../errors";

export type SessionPrincipal = {
	userId: string;
};

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
};

/** 患者端认证编排：兑换 provider code、幂等建用户、签发平台会话。 */
export class AuthService {
	constructor(private readonly dependencies: AuthServiceDependencies) {}

	async login(
		input: WechatLoginPayload,
		context: AdapterCallContext,
	): Promise<AuthSessionPayload["data"]> {
		const identity = await this.dependencies.identityGateway.exchangeCode(
			{ code: input.code },
			context,
		);
		const user = await this.dependencies.identityUsers.findOrCreateByWechat({
			providerSubject: identity.providerSubject,
			...(identity.unionId ? { unionId: identity.unionId } : {}),
		});
		const session = await this.dependencies.sessions.issue(user.userId);

		return {
			accessToken: session.accessToken,
			tokenType: "Bearer",
			expiresInSeconds: session.expiresInSeconds,
			user: { id: user.userId },
		};
	}
}

/** 从 HTTP Authorization 头提取会话；provider 错误不能被误报成 401。 */
export async function requirePrincipal(
	authorization: string | undefined,
	sessions: SessionTokenService,
): Promise<SessionPrincipal> {
	const match = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "");
	if (!match?.[1]) {
		throw new HttpError(401, "unauthorized", "Authentication required");
	}

	try {
		return await sessions.verify(match[1]);
	} catch (error) {
		if (error instanceof DependencyNotConfiguredError) throw error;
		throw new HttpError(401, "unauthorized", "Invalid or expired session");
	}
}

/** 测试专用内存 session；生产环境替换为签名 token 或集中式会话实现。 */
export function createInMemorySessionTokenService(): SessionTokenService {
	const sessions = new Map<string, string>();
	let sequence = 0;

	return {
		async issue(userId) {
			sequence += 1;
			const accessToken = `fixture-session-${String(sequence).padStart(4, "0")}`;
			sessions.set(accessToken, userId);
			return { accessToken, expiresInSeconds: 3600 };
		},
		async verify(accessToken) {
			const userId = sessions.get(accessToken);
			if (!userId) throw new HttpError(401, "unauthorized", "Invalid session");
			return { userId };
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
			const accessToken = crypto.randomUUID();
			try {
				await store.save(accessToken, userId, expiresInSeconds);
			} catch {
				throw new DependencyNotConfiguredError("session-token");
			}
			return { accessToken, expiresInSeconds };
		},
		async verify(accessToken) {
			try {
				const userId = await store.findUserId(accessToken);
				if (!userId) {
					throw new HttpError(401, "unauthorized", "Invalid session");
				}
				return { userId };
			} catch (error) {
				if (error instanceof HttpError) throw error;
				throw new DependencyNotConfiguredError("session-token");
			}
		},
	};
}
