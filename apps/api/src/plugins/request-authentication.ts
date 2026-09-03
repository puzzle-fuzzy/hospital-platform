import {
	requirePrincipal,
	type SessionPrincipal,
	type SessionTokenService,
} from "../modules/auth/service";
import { setRequestOwner } from "./request-context";

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
 * 判断请求是否恰好命中当前模块声明的公开入口。
 *
 * 模块被挂在 `/api/v1` 或 `/api/v2` 分组下时，公开入口配置只保留模块
 * 相对路径（例如 `/auth/wechat`）。不能直接使用 `endsWith`：否则一个
 * 未注册的 `/api/v1/other/auth/wechat` 也会因为尾缀相同而跳过认证。
 * 这里仅允许无分组前缀的单元测试路径，或当前 API 版本分组的精确路径；
 * 其它路径一律进入 Bearer 校验，保持 fail-closed。
 */
export function isPublicRequestPath(
	pathname: string,
	publicPathSuffixes: readonly string[],
): boolean {
	return publicPathSuffixes.some((suffix) => {
		const normalizedSuffix = suffix.startsWith("/") ? suffix : `/${suffix}`;
		if (pathname === normalizedSuffix) return true;
		if (!pathname.endsWith(normalizedSuffix)) return false;

		const groupPrefix = pathname.slice(0, -normalizedSuffix.length);
		return /^\/api\/v\d+$/.test(groupPrefix);
	});
}

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
		return isPublicRequestPath(pathname, publicPathSuffixes);
	};

	return {
		async authenticate({ request }) {
			if (isPublicPath(request)) return;
			const principal = await requirePrincipal(
				request.headers.get("authorization") ?? undefined,
				sessions,
			);
			principals.set(request, principal);
			setRequestOwner(request, principal.userId);
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
