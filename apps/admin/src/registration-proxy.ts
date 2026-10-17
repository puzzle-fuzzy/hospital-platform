import { createHash } from "node:crypto";
import { validCancellationReason } from "./registration-display";

type ProxyDependencies = {
	authorize(request: Request): string;
	readBody(request: Request): Promise<Record<string, unknown>>;
	upstream: URL | undefined;
	token: string;
	forward(
		base: URL,
		path: string,
		init: RequestInit,
		message: string,
	): Promise<Response>;
	error(message: string, status: number): Response;
};

/** 固定管理端挂号入口；授权先于读取正文、配置检查或任何上游请求。 */
export function createAdminRegistrationProxy(dependencies: ProxyDependencies) {
	return async (
		request: Request,
		source: string,
		orderId: string,
		cancel: boolean,
	): Promise<Response> => {
		const authorization = dependencies.authorize(request);
		if (request.method !== (cancel ? "POST" : "GET"))
			return dependencies.error("请求方法不支持", 405);
		try {
			source = decodeURIComponent(source);
			orderId = decodeURIComponent(orderId);
		} catch {
			return dependencies.error("挂号订单参数不合法", 400);
		}
		if (
			!["payment_order", "medical_insurance"].includes(source) ||
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(orderId)
		) {
			return dependencies.error("挂号订单参数不合法", 400);
		}
		if (!dependencies.upstream || !dependencies.token)
			return dependencies.error("管理端挂号接口尚未配置", 503);
		if (new URL(request.url).searchParams.size > 0)
			return dependencies.error("挂号接口不接受额外查询参数", 400);
		let body: string | undefined;
		let key: string | undefined;
		if (cancel) {
			key = request.headers.get("idempotency-key")?.trim();
			if (!key || !/^[A-Za-z0-9._:-]{1,128}$/u.test(key))
				return dependencies.error("取消挂号需要有效的幂等键", 400);
			const input = await dependencies.readBody(request);
			if (
				Object.keys(input).length !== 1 ||
				typeof input.reason !== "string" ||
				!validCancellationReason(input.reason)
			)
				return dependencies.error("请填写 2 至 80 字的取消原因", 400);
			body = JSON.stringify({ reason: input.reason.trim() });
		}
		const operatorRef = `admin-session:${createHash("sha256").update(authorization.slice("Bearer ".length)).digest("hex").slice(0, 40)}`;
		return dependencies.forward(
			dependencies.upstream,
			`/admin/registrations/${encodeURIComponent(source)}/${encodeURIComponent(orderId)}${cancel ? "/cancel" : ""}`,
			{
				method: cancel ? "POST" : "GET",
				headers: {
					"X-Admin-Refund-Token": dependencies.token,
					"X-Admin-Operator-Ref": operatorRef,
					"X-Request-Id": crypto.randomUUID(),
					...(cancel ? { "Content-Type": "application/json" } : {}),
					...(key ? { "Idempotency-Key": key } : {}),
				},
				...(body ? { body } : {}),
			},
			"挂号状态暂时无法确认，请先核对状态再重试",
		);
	};
}
