import {
	requirePrincipal,
	type SessionPrincipal,
	type SessionTokenService,
} from "../modules/auth/service";

/**
 * 当前 HTTP Request 对应的认证主体解析器。
 *
 * Elysia 的 TypeBox 校验发生在 route handler 之前，但晚于本模块的 local
 * `onTransform` 生命周期。
 * 如果只在 handler 里校验 Bearer，缺少 query/body 的未登录请求会先得到
 * 400，导致认证错误契约不一致。这里在 schema 校验前完成认证，并用
 * WeakMap 把主体绑定到本次 Request，避免 handler 再次读取 Redis。
 */
export type RequestPrincipalResolver = {
	authenticate: (context: { request: Request }) => Promise<void>;
	get: (request: Request) => Promise<SessionPrincipal>;
};

/**
 * 创建模块级认证边界。
 * `publicPathSuffixes` 只用于同一模块中明确存在的公开入口，例如微信登录
 * 和微信支付回调；其它路径默认全部要求平台 Bearer 会话。
 */
export function createRequestPrincipalResolver(
	sessions: SessionTokenService,
	publicPathSuffixes: readonly string[] = [],
): RequestPrincipalResolver {
	const principals = new WeakMap<Request, SessionPrincipal>();

	const isPublicPath = (request: Request): boolean => {
		const pathname = new URL(request.url).pathname;
		return publicPathSuffixes.some((suffix) => pathname.endsWith(suffix));
	};

	return {
		async authenticate({ request }) {
			if (isPublicPath(request)) return;
			const principal = await requirePrincipal(
				request.headers.get("authorization") ?? undefined,
				sessions,
			);
			principals.set(request, principal);
		},
		async get(request) {
			const principal = principals.get(request);
			if (principal) return principal;
			// 公开路由不会调用此方法；fallback 让未被 local 生命周期覆盖的
			// 组合测试仍然保持 fail-closed，而不是返回一个伪造主体。
			return requirePrincipal(
				request.headers.get("authorization") ?? undefined,
				sessions,
			);
		},
	};
}
