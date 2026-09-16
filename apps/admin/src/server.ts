import { extname, join, normalize } from "node:path";
import { readRawLogTrace } from "./raw-logs";

type JsonObject = Record<string, unknown>;

const host = Bun.env.INSURANCE_QUERY_HOST?.trim() || "127.0.0.1";
const port = Number(Bun.env.INSURANCE_QUERY_PORT || "18083");
const legacyUpstream = new URL(
	Bun.env.LEGACY_HOSPITAL_API_BASE_URL?.trim() ||
		"https://test-hp.meiyi.pro/api/v1",
);
const adminQueryUpstreamValue = Bun.env.ADMIN_QUERY_API_BASE_URL?.trim() || "";
const adminQueryUpstream = adminQueryUpstreamValue
	? new URL(adminQueryUpstreamValue)
	: undefined;
const adminQueryToken = Bun.env.ADMIN_QUERY_API_TOKEN?.trim() || "";
const adminLogsUpstreamValue = Bun.env.ADMIN_LOGS_API_BASE_URL?.trim() || "";
const adminLogsUpstream = adminLogsUpstreamValue
	? new URL(adminLogsUpstreamValue)
	: undefined;
const adminLogsToken = Bun.env.ADMIN_LOGS_API_TOKEN?.trim() || "";
const allowHttpUpstream =
	Bun.env.INSURANCE_QUERY_ALLOW_HTTP_UPSTREAM === "true";
const clientRoot = join(import.meta.dir, "client");
const bodyLimit = 16 * 1024;
const rateLimitWindowMs = 60_000;
const rateLimitMaximum = 30;
const rateLimits = new Map<string, { count: number; expiresAt: number }>();
const activeSessions = new Map<string, number>();
const maxActiveSessions = 500;
const maxSessionTokenLength = 4096;
const rawLogWindowMs = 30 * 60 * 1_000;

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error("INSURANCE_QUERY_PORT must be a valid TCP port");
}
if (legacyUpstream.protocol !== "https:") {
	throw new Error("Legacy hospital API must use HTTPS");
}
if (
	adminQueryUpstream &&
	adminQueryUpstream.protocol !== "https:" &&
	!(allowHttpUpstream && adminQueryUpstream.protocol === "http:")
) {
	throw new Error(
		"Admin query API must use HTTPS unless HTTP is explicitly enabled",
	);
}
if (
	adminLogsUpstream &&
	adminLogsUpstream.protocol !== "https:" &&
	!(allowHttpUpstream && adminLogsUpstream.protocol === "http:")
) {
	throw new Error(
		"Admin logs API must use HTTPS unless HTTP is explicitly enabled",
	);
}

function json(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			"X-Content-Type-Options": "nosniff",
		},
	});
}

function errorResponse(message: string, status: number): Response {
	return json({ code: status, msg: message, data: null }, status);
}

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function requestJson(request: Request): Promise<JsonObject> {
	const contentLength = Number(request.headers.get("content-length") || "0");
	if (contentLength > bodyLimit) throw new Error("REQUEST_TOO_LARGE");
	const text = await request.text();
	if (text.length > bodyLimit) throw new Error("REQUEST_TOO_LARGE");
	const parsed = JSON.parse(text) as unknown;
	if (!isObject(parsed)) throw new Error("INVALID_JSON_OBJECT");
	return parsed;
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
): string {
	if (typeof value !== "string") throw new Error(`INVALID_${field}`);
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength) {
		throw new Error(`INVALID_${field}`);
	}
	return normalized;
}

function optionalText(value: unknown, maxLength: number): string {
	if (value === undefined || value === null || value === "") return "";
	if (typeof value !== "string") throw new Error("INVALID_OPTIONAL_TEXT");
	const normalized = value.trim();
	if (normalized.length > maxLength) throw new Error("INVALID_OPTIONAL_TEXT");
	return normalized;
}

function identityNumber(value: unknown): string {
	const normalized = requiredText(value, "IDENTITY_NUMBER", 18)
		.replaceAll(/\s/g, "")
		.toUpperCase();
	if (!/^\d{15}$|^\d{17}[0-9X]$/u.test(normalized)) {
		throw new Error("INVALID_IDENTITY_NUMBER");
	}
	return normalized;
}

function bearer(request: Request): string {
	const authorization = request.headers.get("authorization")?.trim() || "";
	if (!/^Bearer [A-Za-z0-9._~+/-]+=*$/u.test(authorization)) {
		throw new Error("UNAUTHORIZED");
	}
	const token = authorization.slice("Bearer ".length);
	const expiresAt = activeSessions.get(token);
	if (!expiresAt || expiresAt <= Date.now()) {
		activeSessions.delete(token);
		throw new Error("UNAUTHORIZED");
	}
	return authorization;
}

async function registerLoginSession(response: Response): Promise<void> {
	if (!response.ok) {
		console.info(
			JSON.stringify({
				event: "admin.auth.login.session",
				responseStatus: response.status,
				registered: false,
				reason: "upstream-not-ok",
			}),
		);
		return;
	}
	try {
		const payload = (await response.clone().json()) as unknown;
		const envelope = isObject(payload) ? payload : undefined;
		const firstData =
			envelope && isObject(envelope.data) ? envelope.data : undefined;
		const nestedData =
			firstData && isObject(firstData.data) ? firstData.data : undefined;
		const data = nestedData || firstData || envelope;
		const tokenValue =
			(data && typeof data.access_token === "string" && data.access_token) ||
			(data && typeof data.accessToken === "string" && data.accessToken);
		if (!tokenValue) {
			console.info(
				JSON.stringify({
					event: "admin.auth.login.session",
					responseStatus: response.status,
					registered: false,
					reason: "access-token-missing",
					payloadKeys: envelope ? Object.keys(envelope).sort() : [],
					dataKeys: data ? Object.keys(data).sort() : [],
				}),
			);
			return;
		}
		const accessToken = tokenValue.trim();
		if (!accessToken || accessToken.length > maxSessionTokenLength) {
			console.info(
				JSON.stringify({
					event: "admin.auth.login.session",
					responseStatus: response.status,
					registered: false,
					reason: "access-token-invalid",
					tokenLength: accessToken.length,
				}),
			);
			return;
		}
		const expiresIn =
			typeof data?.expires_in === "number" &&
			Number.isFinite(data.expires_in) &&
			data.expires_in > 0
				? data.expires_in * 1_000
				: 30 * 60 * 1_000;
		activeSessions.set(
			accessToken,
			Date.now() + Math.min(Math.max(expiresIn, 60_000), 24 * 60 * 60 * 1_000),
		);
		while (activeSessions.size > maxActiveSessions) {
			const oldest = activeSessions.keys().next().value;
			if (typeof oldest !== "string") break;
			activeSessions.delete(oldest);
		}
		console.info(
			JSON.stringify({
				event: "admin.auth.login.session",
				responseStatus: response.status,
				registered: true,
				tokenLength: accessToken.length,
				expiresInMs: Math.min(
					typeof data?.expires_in === "number" &&
						Number.isFinite(data.expires_in) &&
						data.expires_in > 0
						? data.expires_in * 1_000
						: 30 * 60 * 1_000,
					24 * 60 * 60 * 1_000,
				),
			}),
		);
	} catch {
		// 登录响应仍原样返回给浏览器；无法读出 token 时后续请求会要求重新登录。
		console.info(
			JSON.stringify({
				event: "admin.auth.login.session",
				responseStatus: response.status,
				registered: false,
				reason: "response-json-invalid",
			}),
		);
	}
}

function checkRateLimit(clientAddress: string): void {
	const now = Date.now();
	const current = rateLimits.get(clientAddress);
	if (!current || current.expiresAt <= now) {
		rateLimits.set(clientAddress, {
			count: 1,
			expiresAt: now + rateLimitWindowMs,
		});
		return;
	}
	if (current.count >= rateLimitMaximum) throw new Error("RATE_LIMITED");
	current.count += 1;
}

async function upstreamRequest(
	base: URL,
	path: string,
	init: RequestInit,
	unavailableMessage: string,
): Promise<Response> {
	const target = new URL(
		`${base.pathname.replace(/\/$/u, "")}/${path.replace(/^\//u, "")}`,
		base.origin,
	);
	try {
		const response = await fetch(target, {
			...init,
			redirect: "manual",
			signal: AbortSignal.timeout(25_000),
		});
		const body = await response.arrayBuffer();
		return new Response(body, {
			status: response.status,
			headers: {
				"Content-Type":
					response.headers.get("content-type") ||
					"application/json; charset=utf-8",
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch {
		return errorResponse(unavailableMessage, 502);
	}
}

async function loginRequest(request: Request): Promise<Response> {
	const input = await requestJson(request);
	const username = requiredText(input.username, "USERNAME", 64);
	const password = requiredText(input.password, "PASSWORD", 256);
	const captchaKey = optionalText(input.captchaKey, 128);
	const captcha = optionalText(input.captcha, 32);
	const body = new URLSearchParams({
		username,
		password,
		login_type: "PC端",
		captcha_key: captchaKey,
		captcha,
	});
	const response = await upstreamRequest(
		legacyUpstream,
		"/system/auth/login",
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		},
		"旧服务暂时不可用，请稍后重试",
	);
	await registerLoginSession(response);
	return response;
}

async function insuranceRequest(request: Request): Promise<Response> {
	bearer(request);
	const input = await requestJson(request);
	const mode = requiredText(input.mode, "MODE", 32);
	if (
		mode !== "identity-card" &&
		mode !== "electronic-credential" &&
		mode !== "social-security-card"
	) {
		throw new Error("INVALID_MODE");
	}
	const certno = identityNumber(input.identityNumber);
	const psnName = requiredText(input.name, "NAME", 50);
	const credentialNumber =
		mode === "identity-card"
			? certno
			: requiredText(input.credentialNumber, "CREDENTIAL_NUMBER", 512);
	const cardSerialNumber =
		mode === "social-security-card"
			? requiredText(input.cardSerialNumber, "CARD_SERIAL_NUMBER", 64)
			: "";
	if (!adminQueryUpstream || !adminQueryToken) {
		return errorResponse("新服务查询接口尚未配置", 503);
	}
	return upstreamRequest(
		adminQueryUpstream,
		"/admin/insurance/1101",
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Admin-Query-Token": adminQueryToken,
				"X-Request-Id": crypto.randomUUID(),
			},
			body: JSON.stringify({
				mode,
				identityNumber: certno,
				name: psnName,
				...(mode === "identity-card" ? {} : { credentialNumber }),
				...(mode === "social-security-card" ? { cardSerialNumber } : {}),
			}),
		},
		"新服务医保查询暂时不可用，请稍后重试",
	);
}

async function logsRequest(request: Request, url: URL): Promise<Response> {
	bearer(request);
	if (!adminLogsUpstream || !adminLogsToken) {
		return errorResponse("新服务日志接口尚未配置", 503);
	}
	const forwarded = new URLSearchParams();
	for (const key of [
		"page",
		"pageSize",
		"level",
		"event",
		"path",
		"traceId",
		"requestId",
		"providerRequestId",
		"providerOperation",
		"service",
		"startTime",
		"endTime",
	] as const) {
		const value = url.searchParams.get(key);
		if (value) {
			if (value.length > 256) return errorResponse("请求参数不合法", 400);
			forwarded.set(key, value);
		}
	}
	const query = forwarded.toString();
	return upstreamRequest(
		adminLogsUpstream,
		`/admin/logs${query ? `?${query}` : ""}`,
		{
			method: "GET",
			headers: {
				"X-Admin-Token": adminLogsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
		},
		"新服务日志接口暂时不可用，请稍后重试",
	);
}

async function logDetailRequest(
	request: Request,
	id: string,
): Promise<Response> {
	bearer(request);
	if (!/^log-[1-9][0-9]*$/u.test(id) || id.length > 32) {
		return errorResponse("请求参数不合法", 400);
	}
	if (!adminLogsUpstream || !adminLogsToken) {
		return errorResponse("新服务日志接口尚未配置", 503);
	}
	return upstreamRequest(
		adminLogsUpstream,
		`/admin/logs/${id}`,
		{
			method: "GET",
			headers: {
				"X-Admin-Token": adminLogsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
		},
		"新服务日志接口暂时不可用，请稍后重试",
	);
}

function validDetailIdentifier(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > 256 ||
		[...normalized].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		return undefined;
	}
	return normalized;
}

async function logRawDetailRequest(
	request: Request,
	id: string,
): Promise<Response> {
	bearer(request);
	if (!/^log-[1-9][0-9]*$/u.test(id) || id.length > 32) {
		return errorResponse("请求参数不合法", 400);
	}
	if (!adminLogsUpstream || !adminLogsToken) {
		return errorResponse("新服务日志接口尚未配置", 503);
	}
	const detailResponse = await upstreamRequest(
		adminLogsUpstream,
		`/admin/logs/${id}`,
		{
			method: "GET",
			headers: {
				"X-Admin-Token": adminLogsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
		},
		"新服务日志接口暂时不可用，请稍后重试",
	);
	const detailText = await detailResponse.text();
	if (!detailResponse.ok) {
		return new Response(detailText, {
			status: detailResponse.status,
			headers: {
				"Content-Type":
					detailResponse.headers.get("content-type") ||
					"application/json; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	}
	let detailPayload: unknown;
	try {
		detailPayload = JSON.parse(detailText) as unknown;
	} catch {
		return errorResponse("日志详情格式异常", 502);
	}
	const detail =
		isObject(detailPayload) && isObject(detailPayload.data)
			? detailPayload.data
			: detailPayload;
	if (!isObject(detail)) return errorResponse("日志详情格式异常", 502);
	const identifiers = [
		validDetailIdentifier(detail.traceId),
		validDetailIdentifier(detail.requestId),
		validDetailIdentifier(detail.providerRequestId),
	].filter((value): value is string => Boolean(value));
	if (identifiers.length === 0) {
		return errorResponse(
			"该日志没有可关联的 trace/request/Provider 请求号",
			422,
		);
	}
	const detailTimestamp = validDetailIdentifier(detail.timestamp);
	const center = detailTimestamp ? Date.parse(detailTimestamp) : Number.NaN;
	if (Number.isNaN(center)) return errorResponse("日志时间格式异常", 502);
	try {
		const trace = await readRawLogTrace({
			identifiers,
			since: new Date(center - rawLogWindowMs).toISOString(),
			until: new Date(center + rawLogWindowMs).toISOString(),
			maxEntries: 300,
		});
		console.info(
			JSON.stringify({
				event: "admin.raw_log.read",
				logId: id,
				entryCount: trace.entries.length,
				matchedJournalRecords: trace.matchedJournalRecords,
				truncated: trace.truncated,
				completeEntryCount: trace.entries.filter((entry) => entry.complete)
					.length,
			}),
		);
		return json({ code: 0, data: trace });
	} catch (error) {
		const reason = error instanceof Error ? error.message : "UNKNOWN";
		if (
			reason === "raw-log-identifier-required" ||
			reason === "raw-log-window-invalid"
		) {
			return errorResponse("原始日志查询条件不合法", 422);
		}
		return errorResponse("服务器原始日志暂时不可用，请稍后重试", 502);
	}
}

async function logoutRequest(request: Request): Promise<Response> {
	const authorization = bearer(request);
	const token = authorization.slice("Bearer ".length);
	const response = await upstreamRequest(
		legacyUpstream,
		"/system/auth/logout",
		{
			method: "POST",
			headers: {
				Authorization: authorization,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ token }),
		},
		"旧服务暂时不可用，请稍后重试",
	);
	activeSessions.delete(token);
	return response;
}

const contentTypes: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".ico": "image/x-icon",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".map": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
};

async function staticResponse(pathname: string): Promise<Response> {
	const requested =
		pathname === "/" ? "index.html" : pathname.replace(/^\//u, "");
	const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/u, "");
	let file = Bun.file(join(clientRoot, safePath));
	if (!(await file.exists()) || file.type === "") {
		file = Bun.file(join(clientRoot, "index.html"));
	}
	return new Response(file, {
		headers: {
			"Content-Type": contentTypes[extname(file.name || "")] || file.type,
			"Cache-Control":
				safePath === "index.html"
					? "no-store"
					: "public, max-age=31536000, immutable",
			"Content-Security-Policy":
				"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
			"Referrer-Policy": "no-referrer",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY",
		},
	});
}

const server = Bun.serve({
	hostname: host,
	port,
	async fetch(request, serverInstance) {
		const url = new URL(request.url);
		const clientAddress =
			serverInstance.requestIP(request)?.address || "unknown";
		try {
			if (url.pathname === "/health" && request.method === "GET") {
				return json({ status: "ok", service: "admin" });
			}
			if (url.pathname.startsWith("/api/")) checkRateLimit(clientAddress);
			if (url.pathname === "/api/auth/captcha" && request.method === "GET") {
				return await upstreamRequest(
					legacyUpstream,
					"/system/auth/captcha/get",
					{
						method: "GET",
					},
					"旧服务暂时不可用，请稍后重试",
				);
			}
			if (url.pathname === "/api/auth/login" && request.method === "POST") {
				return await loginRequest(request);
			}
			if (url.pathname === "/api/auth/logout" && request.method === "POST") {
				return await logoutRequest(request);
			}
			if (url.pathname === "/api/insurance/1101" && request.method === "POST") {
				return await insuranceRequest(request);
			}
			if (url.pathname === "/api/logs" && request.method === "GET") {
				return await logsRequest(request, url);
			}
			const rawLogDetailMatch = url.pathname.match(
				/^\/api\/logs\/(log-[1-9][0-9]*)\/raw$/u,
			);
			if (rawLogDetailMatch && request.method === "GET") {
				return await logRawDetailRequest(request, rawLogDetailMatch[1] ?? "");
			}
			const logDetailMatch = url.pathname.match(
				/^\/api\/logs\/(log-[1-9][0-9]*)$/u,
			);
			if (logDetailMatch && request.method === "GET") {
				return await logDetailRequest(request, logDetailMatch[1] ?? "");
			}
			if (url.pathname.startsWith("/api/")) {
				return errorResponse("接口不存在", 404);
			}
			if (request.method !== "GET" && request.method !== "HEAD") {
				return errorResponse("请求方法不支持", 405);
			}
			return await staticResponse(url.pathname);
		} catch (error) {
			const reason = error instanceof Error ? error.message : "UNKNOWN";
			if (reason === "UNAUTHORIZED") return errorResponse("请先登录", 401);
			if (reason === "RATE_LIMITED")
				return errorResponse("查询过于频繁，请稍后重试", 429);
			if (reason === "REQUEST_TOO_LARGE")
				return errorResponse("请求内容过大", 413);
			return errorResponse("请求参数不合法", 400);
		}
	},
});

console.info(
	JSON.stringify({
		event: "admin.started",
		host: server.hostname,
		port: server.port,
		legacyUpstreamProtocol: legacyUpstream.protocol,
		adminQueryConfigured: Boolean(adminQueryUpstream && adminQueryToken),
		adminLogsConfigured: Boolean(adminLogsUpstream && adminLogsToken),
	}),
);
