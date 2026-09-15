import { extname, join, normalize } from "node:path";

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
const allowHttpUpstream =
	Bun.env.INSURANCE_QUERY_ALLOW_HTTP_UPSTREAM === "true";
const clientRoot = join(import.meta.dir, "client");
const bodyLimit = 16 * 1024;
const rateLimitWindowMs = 60_000;
const rateLimitMaximum = 30;
const rateLimits = new Map<string, { count: number; expiresAt: number }>();

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
	return authorization;
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
	return upstreamRequest(
		legacyUpstream,
		"/system/auth/login",
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		},
		"旧服务暂时不可用，请稍后重试",
	);
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

async function logoutRequest(request: Request): Promise<Response> {
	const authorization = bearer(request);
	const token = authorization.slice("Bearer ".length);
	return upstreamRequest(
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
	}),
);
