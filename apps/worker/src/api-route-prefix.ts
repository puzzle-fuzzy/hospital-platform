/**
 * 平台 API 的公网前缀与应用内部挂载路径不是一回事。
 *
 * 本地/内网直接访问 Elysia 时，业务路由是 `/api/v1`，健康检查在根路径；
 * 阿里云公网转发则把 `/api/v2` 同时映射到业务路由和健康检查。smoke 必须
 * 明确知道自己验收的是哪一层，不能把公网域名和内部路径悄悄拼在一起。
 */
export type ApiPrefix = "/api/v1" | "/api/v2";

export const DEFAULT_API_PREFIX: ApiPrefix = "/api/v1";

export class ApiRoutePrefixConfigurationError extends Error {
	constructor() {
		super("HOSPITAL_API_PREFIX must be /api/v1 or /api/v2");
		this.name = "ApiRoutePrefixConfigurationError";
	}
}

/** 只接受已知的内部/公网前缀，避免把任意路径拼进验收请求。 */
export function resolveApiPrefix(value: string | undefined): ApiPrefix {
	const normalized = value?.trim() || DEFAULT_API_PREFIX;
	if (normalized === "/api/v1" || normalized === "/api/v2") return normalized;
	throw new ApiRoutePrefixConfigurationError();
}

/** 业务、系统和认证路由均挂在选定的 API 前缀下。 */
export function apiRoute(prefix: ApiPrefix, path: string): string {
	return `${prefix}${path}`;
}

/**
 * 健康检查在应用内部是根路径；只有公网 v2 转发层把它暴露在 `/api/v2` 下。
 * 这条特殊规则必须集中维护，避免 smoke 把 `/api/v1/health/*` 当成真实路径。
 */
export function healthRoute(prefix: ApiPrefix, path: string): string {
	return prefix === "/api/v2" ? apiRoute(prefix, path) : path;
}
