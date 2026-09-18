import { extname, join, normalize } from "node:path";
import type { PaymentDaySnapshot } from "./payment-day";
import {
	buildPaymentDaySnapshot,
	collectPaymentOrders,
	PAYMENT_MAX_INTERFACES,
	PAYMENT_MAX_JOURNAL_BYTES,
	PAYMENT_MAX_ORDERS,
	parsePaymentJournal,
	paymentDayWindow,
	paymentInterfaceDetail,
	publicPaymentDay,
} from "./payment-day";
import { formatJournalTimestamp, readRawLogTrace } from "./raw-logs";
import type { RawLogEntry } from "./types";

type JsonObject = Record<string, unknown>;

const host = Bun.env.INSURANCE_QUERY_HOST?.trim() || "127.0.0.1";
const port = Number(Bun.env.INSURANCE_QUERY_PORT || "18083");
const legacyUpstream = new URL(
	Bun.env.LEGACY_HOSPITAL_API_BASE_URL?.trim() ||
		"https://test-hp.meiyi.pro/api/v1",
);
const adminLogsUpstreamValue = Bun.env.ADMIN_LOGS_API_BASE_URL?.trim() || "";
const adminLogsUpstream = adminLogsUpstreamValue
	? new URL(adminLogsUpstreamValue)
	: undefined;
const adminLogsToken = Bun.env.ADMIN_LOGS_API_TOKEN?.trim() || "";
const adminRefundsUpstreamValue =
	Bun.env.ADMIN_REFUNDS_API_BASE_URL?.trim() || "";
const adminRefundsUpstream = adminRefundsUpstreamValue
	? new URL(adminRefundsUpstreamValue)
	: undefined;
const adminRefundsToken = Bun.env.ADMIN_REFUNDS_API_TOKEN?.trim() || "";
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
// 单条日志详情默认只查前后 15 分钟；traceId 已在元数据列表中确定，
// 继续扫描半小时会把大量无关 raw chunk 传给管理端。需要更宽窗口时，
// 使用受控 provider-trace-export 工具显式指定 since/until。
const rawLogWindowMs = 15 * 60 * 1_000;
const rawLogFallbackWindowMs = 30 * 60 * 1_000;
const paymentJournalUnits = [
	"hospital-platform-api-v2.service",
	"hospital-platform-worker-v2.service",
] as const;
// 日汇总只需支付业务事件；原始 Provider 报文由 readPaymentRawEntries 按订单
// 关联号定向读取，避免把全日 raw chunk 一次性装入内存并触发 64 MiB 门槛。
const paymentJournalGrep =
	'"event":"(medical-insurance\\.|payment\\.wechat_prepay\\.|outpatient\\.self-payment\\.|appointment\\.self-payment\\.|worker\\.payment\\.)';
const paymentSnapshotCacheTtlMs = 30_000;
const paymentSnapshotCacheMaxEntries = 2;
const paymentSnapshotCache = new Map<
	string,
	{ expiresAt: number; snapshot: PaymentDaySnapshot }
>();
const paymentSnapshotInFlight = new Map<string, Promise<PaymentDaySnapshot>>();

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new Error("INSURANCE_QUERY_PORT must be a valid TCP port");
}
if (legacyUpstream.protocol !== "https:") {
	throw new Error("Legacy hospital API must use HTTPS");
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
if (
	adminRefundsUpstream &&
	adminRefundsUpstream.protocol !== "https:" &&
	!(allowHttpUpstream && adminRefundsUpstream.protocol === "http:")
) {
	throw new Error(
		"Admin refunds API must use HTTPS unless HTTP is explicitly enabled",
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

function currentShanghaiDate(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

async function runPaymentJournal(
	window: ReturnType<typeof paymentDayWindow>,
): Promise<string> {
	const args = [
		"--all",
		"-o",
		"json",
		"--no-pager",
		...paymentJournalUnits.flatMap((unit) => ["-u", unit]),
		"--grep",
		paymentJournalGrep,
		"--since",
		formatJournalTimestamp(window.readSince),
		"--until",
		formatJournalTimestamp(window.readUntil),
	] as const;
	const process = Bun.spawn(["journalctl", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [serialized, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	if (
		new TextEncoder().encode(serialized).byteLength > PAYMENT_MAX_JOURNAL_BYTES
	) {
		throw new Error("payment-day-journal-too-large");
	}
	if (exitCode !== 0) {
		const suffix = stderr.trim().slice(-240);
		throw new Error(`payment-day-journal-failed${suffix ? `:${suffix}` : ""}`);
	}
	return serialized;
}

function rawEntryKey(entry: RawLogEntry): string {
	return [
		entry.unit,
		entry.direction,
		entry.event,
		entry.timestamp,
		entry.traceId || "",
		entry.requestId || "",
		entry.providerRequestId || "",
		entry.operation || "",
		entry.integrity?.actualSha256 || "",
	].join("\u0001");
}

async function readPaymentRawEntries(
	date: string,
	orders: ReturnType<typeof collectPaymentOrders>,
): Promise<RawLogEntry[]> {
	const window = paymentDayWindow(date);
	const selectedOrders = orders.slice(0, PAYMENT_MAX_ORDERS);
	const collected: RawLogEntry[] = [];
	const batchSize = 6;
	for (let offset = 0; offset < selectedOrders.length; offset += batchSize) {
		const batch = selectedOrders.slice(offset, offset + batchSize);
		const traces = await Promise.all(
			batch.map(async (order) => {
				const identifiers = [...order.identifiers];
				if (identifiers.length === 0) return [] as RawLogEntry[];
				try {
					const trace = await readRawLogTrace({
						identifiers,
						since: window.readSince.toISOString(),
						until: window.readUntil.toISOString(),
						maxEntries: PAYMENT_MAX_INTERFACES,
					});
					return trace.entries as RawLogEntry[];
				} catch {
					// 某一笔 raw 日志过大或暂时不可读时，不影响同日其它订单汇总；
					// 该笔保持现有“不完整”状态，刷新日期后可再次尝试读取。
					return [] as RawLogEntry[];
				}
			}),
		);
		for (const entries of traces) collected.push(...entries);
	}
	const unique = new Map<string, RawLogEntry>();
	for (const entry of collected) unique.set(rawEntryKey(entry), entry);
	return [...unique.values()];
}

async function readPaymentJournal(date: string): Promise<string> {
	const window = paymentDayWindow(date);
	return runPaymentJournal(window);
}

async function paymentSnapshot(date: string): Promise<PaymentDaySnapshot> {
	const now = Date.now();
	const cached = paymentSnapshotCache.get(date);
	if (cached && cached.expiresAt > now) return cached.snapshot;
	if (cached) paymentSnapshotCache.delete(date);
	const existing = paymentSnapshotInFlight.get(date);
	if (existing) return existing;
	const pending = readPaymentJournal(date)
		.then(async (serialized) => {
			const orders = collectPaymentOrders(parsePaymentJournal(serialized));
			const rawEntries = await readPaymentRawEntries(date, orders);
			return buildPaymentDaySnapshot(date, serialized, rawEntries);
		})
		.then((snapshot) => {
			for (const [cachedDate, cachedSnapshot] of paymentSnapshotCache) {
				if (cachedSnapshot.expiresAt <= Date.now()) {
					paymentSnapshotCache.delete(cachedDate);
				}
			}
			paymentSnapshotCache.set(date, {
				expiresAt: Date.now() + paymentSnapshotCacheTtlMs,
				snapshot,
			});
			while (paymentSnapshotCache.size > paymentSnapshotCacheMaxEntries) {
				const oldestDate = paymentSnapshotCache.keys().next().value;
				if (typeof oldestDate !== "string") break;
				paymentSnapshotCache.delete(oldestDate);
			}
			return snapshot;
		})
		.finally(() => paymentSnapshotInFlight.delete(date));
	paymentSnapshotInFlight.set(date, pending);
	return pending;
}

async function paymentDayRequest(
	request: Request,
	url: URL,
): Promise<Response> {
	bearer(request);
	const date = url.searchParams.get("date") || currentShanghaiDate();
	try {
		const snapshot = await paymentSnapshot(date);
		console.info(
			JSON.stringify({
				event: "admin.payment_day.read",
				date,
				orderCount: snapshot.orders.length,
				parsedRecords: snapshot.parsedRecords,
				unmatchedPaymentEventCount: snapshot.unmatchedPaymentEventCount,
				boundaryBufferMinutes: snapshot.window.boundaryBufferMinutes,
			}),
		);
		return json({ code: 0, data: publicPaymentDay(snapshot) });
	} catch (error) {
		const reason = error instanceof Error ? error.message : "UNKNOWN";
		if (reason === "payment-day-date-invalid") {
			return errorResponse("支付日期必须是有效的 YYYY-MM-DD", 422);
		}
		if (reason === "payment-day-journal-too-large") {
			return errorResponse("支付日志窗口过大，请缩小日期范围", 413);
		}
		return errorResponse("支付日志暂时不可用，请稍后重试", 502);
	}
}

async function paymentInterfaceRequest(
	request: Request,
	date: string,
	flowId: string,
	ordinalText: string,
): Promise<Response> {
	bearer(request);
	if (!/^payment-[a-f0-9]{24}$/u.test(flowId)) {
		return errorResponse("支付流程标识不合法", 400);
	}
	const ordinal = Number(ordinalText);
	if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 300) {
		return errorResponse("支付接口序号不合法", 400);
	}
	try {
		const snapshot = await paymentSnapshot(date);
		const detail = paymentInterfaceDetail(snapshot, flowId, ordinal);
		if (!detail) return errorResponse("支付流程或接口不存在", 404);
		console.info(
			JSON.stringify({
				event: "admin.payment_interface.read",
				date,
				flowId,
				ordinal,
				complete: detail.interface.complete,
			}),
		);
		return json({ code: 0, data: detail });
	} catch (error) {
		const reason = error instanceof Error ? error.message : "UNKNOWN";
		if (reason === "payment-day-date-invalid") {
			return errorResponse("支付日期必须是有效的 YYYY-MM-DD", 422);
		}
		if (reason === "payment-day-journal-too-large") {
			return errorResponse("支付日志窗口过大，请缩小日期范围", 413);
		}
		return errorResponse("支付接口原文暂时不可用，请稍后重试", 502);
	}
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

async function adminRefundRequest(
	request: Request,
	path: string,
): Promise<Response> {
	const authorization = bearer(request);
	if (!adminRefundsUpstream || !adminRefundsToken) {
		return errorResponse("新服务退费接口尚未配置", 503);
	}
	const input = await requestJson(request);
	return upstreamRequest(
		adminRefundsUpstream,
		path,
		{
			method: "POST",
			headers: {
				Authorization: authorization,
				"Content-Type": "application/json",
				"X-Admin-Refund-Token": adminRefundsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
			body: JSON.stringify(input),
		},
		"新服务退费接口暂时不可用，请稍后重试",
	);
}

async function adminRefundQueryRequest(
	request: Request,
	merchantRefundNo: string,
): Promise<Response> {
	const authorization = bearer(request);
	if (!adminRefundsUpstream || !adminRefundsToken) {
		return errorResponse("新服务退费接口尚未配置", 503);
	}
	return upstreamRequest(
		adminRefundsUpstream,
		`/admin/wechat-refunds/${encodeURIComponent(merchantRefundNo)}`,
		{
			method: "GET",
			headers: {
				Authorization: authorization,
				"X-Admin-Refund-Token": adminRefundsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
		},
		"新服务退费接口暂时不可用，请稍后重试",
	);
}

/** 管理端退款历史只允许转发白名单查询字段，不能成为任意上游代理。 */
async function adminRefundHistoryRequest(
	request: Request,
	url: URL,
): Promise<Response> {
	const authorization = bearer(request);
	if (!adminRefundsUpstream || !adminRefundsToken) {
		return errorResponse("新服务退费接口尚未配置", 503);
	}
	const forwarded = new URLSearchParams();
	const source = url.searchParams.get("source");
	if (source) {
		if (source !== "payment_order" && source !== "medical_insurance") {
			return errorResponse("资金来源参数不合法", 400);
		}
		forwarded.set("source", source);
	}
	const orderId = url.searchParams.get("orderId");
	if (orderId) {
		if (orderId.length > 64) return errorResponse("订单号参数不合法", 400);
		forwarded.set("orderId", orderId);
	}
	const limit = url.searchParams.get("limit");
	if (limit) {
		if (!/^[1-9][0-9]{0,2}$/u.test(limit)) {
			return errorResponse("查询条数参数不合法", 400);
		}
		forwarded.set("limit", limit);
	}
	const query = forwarded.toString();
	return upstreamRequest(
		adminRefundsUpstream,
		`/admin/wechat-refund-payments${query ? `?${query}` : ""}`,
		{
			method: "GET",
			headers: {
				Authorization: authorization,
				"X-Admin-Refund-Token": adminRefundsToken,
				"X-Request-Id": crypto.randomUUID(),
			},
		},
		"新服务退费接口暂时不可用，请稍后重试",
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
		let trace = await readRawLogTrace({
			identifiers,
			since: new Date(center - rawLogWindowMs).toISOString(),
			until: new Date(center + rawLogWindowMs).toISOString(),
			maxEntries: 300,
		});
		// 正常情况下 15 分钟足够；只有完全没有匹配块时才扩大到旧的 30 分钟，
		// 避免长链路被静默判定为“没有原始日志”，同时不让普通查询承担大窗口成本。
		if (trace.entries.length === 0) {
			trace = await readRawLogTrace({
				identifiers,
				since: new Date(center - rawLogFallbackWindowMs).toISOString(),
				until: new Date(center + rawLogFallbackWindowMs).toISOString(),
				maxEntries: 300,
			});
		}
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
			const paymentInterfaceMatch = url.pathname.match(
				/^\/api\/payments\/day\/(\d{4}-\d{2}-\d{2})\/(payment-[a-f0-9]{24})\/interfaces\/([1-9][0-9]*)$/u,
			);
			if (paymentInterfaceMatch && request.method === "GET") {
				return await paymentInterfaceRequest(
					request,
					paymentInterfaceMatch[1] ?? "",
					paymentInterfaceMatch[2] ?? "",
					paymentInterfaceMatch[3] ?? "",
				);
			}
			if (url.pathname === "/api/payments/day" && request.method === "GET") {
				return await paymentDayRequest(request, url);
			}
			if (url.pathname === "/api/refunds/wechat" && request.method === "POST") {
				return await adminRefundRequest(request, "/admin/wechat-refunds");
			}
			if (
				url.pathname === "/api/refunds/wechat/payments" &&
				request.method === "GET"
			) {
				return await adminRefundHistoryRequest(request, url);
			}
			const refundQueryMatch = url.pathname.match(
				/^\/api\/refunds\/wechat\/([A-Za-z0-9_@*|-]{1,64})$/u,
			);
			if (refundQueryMatch && request.method === "GET") {
				return await adminRefundQueryRequest(
					request,
					refundQueryMatch[1] ?? "",
				);
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
		adminLogsConfigured: Boolean(adminLogsUpstream && adminLogsToken),
		adminRefundsConfigured: Boolean(adminRefundsUpstream && adminRefundsToken),
	}),
);
