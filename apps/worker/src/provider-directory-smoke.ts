import {
	type AppLogger,
	createLogger,
	createNoopLogger,
} from "@hospital/observability";
import {
	apiRoute,
	healthRoute,
	resolveApiPrefix,
	type ApiPrefix,
} from "./api-route-prefix";

/**
 * 目录 smoke 支持的能力；`patient-sync` 是显式开启的幂等 POST，除此之外只读。
 * 这里不包含预约写入、取消、锁号或支付。
 */
export type ProviderSmokeCapability =
	| "patient-sync"
	| "patients"
	| "appointment-directory"
	| "appointment-records"
	| "reports"
	| "report-detail";

export type ProviderSmokeFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type ProviderSmokeCheck = {
	name: string;
	status: "passed" | "failed";
	itemCount?: number;
	errorType?: string;
	traceId?: string;
};

export type ProviderSmokeResult = {
	passed: boolean;
	checks: readonly ProviderSmokeCheck[];
};

export type ProviderSmokeOptions = {
	baseUrl: string;
	/** `/api/v1` 用于内网直连，`/api/v2` 用于公网转发验收。 */
	apiPrefix?: ApiPrefix;
	accessToken: string;
	patientId?: string;
	capabilities: readonly ProviderSmokeCapability[];
	allowLocalHttp?: boolean;
	fetcher?: ProviderSmokeFetcher;
	logger?: AppLogger;
	traceIdFactory?: () => string;
	date?: Date;
};

const DEFAULT_CAPABILITIES: readonly ProviderSmokeCapability[] = [
	"patients",
	"appointment-directory",
	"appointment-records",
	"reports",
];

/** smoke 不是后台重试器；单次平台请求超时后应把证据标记为失败并退出。 */
const SMOKE_REQUEST_TIMEOUT_MS = 15_000;

/** 响应安全审计的禁止字段；匹配大小写不敏感并忽略下划线/短横线。 */
const FORBIDDEN_RESPONSE_KEYS = new Set([
	"provider",
	"providerid",
	"providerpatientid",
	"providerscheduleid",
	"providerrequestid",
	"providerreportid",
	"hisscheduleid",
	"sourceid",
	"appointmentinfoid",
	"ecgreportid",
	"patid",
	"patname",
	"patcardno",
	"idcardno",
	"idcard",
	"idnumber",
	"telephone",
	"phone",
	"mobile",
	"openid",
	"unionid",
	"sessionkey",
	"accesstoken",
	"refreshtoken",
	"authorization",
	"payparams",
	"prepayid",
	"paysign",
	"registrationfee",
	"registfree",
	"ispay",
	"payorderno",
	"hisregisterid",
	"registerid",
	"pdfurl",
	"pdfurllist",
	"raw",
]);

class ProviderSmokeConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderSmokeConfigurationError";
	}
}

class ProviderSmokeRequestError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.name = "ProviderSmokeRequestError";
		this.statusCode = statusCode;
	}
}

function normalizedResponseKey(key: string): string {
	return key.toLowerCase().replaceAll("_", "").replaceAll("-", "");
}

function forbiddenResponseKey(
	value: unknown,
	path = "response",
): string | undefined {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			const result = forbiddenResponseKey(item, `${path}[${index}]`);
			if (result) return result;
		}
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;

	for (const [key, child] of Object.entries(value)) {
		const normalizedKey = normalizedResponseKey(key);
		if (normalizedKey === "reportid") {
			if (typeof child !== "string" || !/^report_[a-f0-9]{48}$/.test(child)) {
				return `${path}.${key}`;
			}
			continue;
		}
		if (FORBIDDEN_RESPONSE_KEYS.has(normalizedKey)) {
			return `${path}.${key}`;
		}
		const result = forbiddenResponseKey(child, `${path}.${key}`);
		if (result) return result;
	}
	return undefined;
}

function requireBaseUrl(value: string, allowLocalHttp: boolean): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL is invalid",
		);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL must not contain credentials or query data",
		);
	}
	const isLocalHttp =
		url.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !(allowLocalHttp && isLocalHttp)) {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL must use HTTPS; local HTTP requires explicit opt-in",
		);
	}
	return url.toString().replace(/\/$/, "");
}

function dateOnly(value: Date): string {
	return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
	const result = new Date(value);
	result.setUTCDate(result.getUTCDate() + days);
	return result;
}

function requirePatientId(patientId: string | undefined): string {
	if (!patientId?.trim()) {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_PATIENT_ID is required for patient-scoped smoke checks",
		);
	}
	return patientId.trim();
}

function responseItemCount(data: unknown): number | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	const items = (data as { items?: unknown }).items;
	return Array.isArray(items) ? items.length : undefined;
}

function firstOpaqueReportId(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	const items = (data as { items?: unknown }).items;
	if (!Array.isArray(items)) return undefined;
	const report = items.find(
		(item) =>
			typeof item === "object" &&
			item !== null &&
			(item as { kind?: unknown }).kind === "laboratory",
	);
	const reportId =
		typeof report === "object" && report !== null
			? (report as { reportId?: unknown }).reportId
			: undefined;
	return typeof reportId === "string" ? reportId : undefined;
}

function responseStatus(data: unknown): unknown {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	return (data as { status?: unknown }).status;
}

function requireSafeData(data: unknown): number | undefined {
	const forbiddenPath = forbiddenResponseKey(data);
	if (forbiddenPath) {
		throw new ProviderSmokeRequestError(
			`Response contains a forbidden field at ${forbiddenPath}`,
			200,
		);
	}
	return responseItemCount(data);
}

type SmokeObservation = {
	traceId: string;
	itemCount?: number;
};

/**
 * 只读 API smoke runner。
 *
 * 它不构造 provider 请求、不接收 provider 患者号，也不执行任何写操作；
 * 通过平台 API 验证真实部署的会话、owner mapping、provider adapter 和公开 contract。
 */
export async function runProviderDirectorySmoke(
	options: ProviderSmokeOptions,
): Promise<ProviderSmokeResult> {
	if (!options.accessToken.trim()) {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_ACCESS_TOKEN is required",
		);
	}
	const baseUrl = requireBaseUrl(
		options.baseUrl.trim(),
		options.allowLocalHttp === true,
	);
	let apiPrefix: ApiPrefix;
	try {
		apiPrefix = resolveApiPrefix(options.apiPrefix);
	} catch {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_API_PREFIX must be /api/v1 or /api/v2",
		);
	}
	const fetcher = options.fetcher ?? fetch;
	const logger = options.logger ?? createNoopLogger();
	const traceIdFactory = options.traceIdFactory ?? (() => crypto.randomUUID());
	const now = options.date ?? new Date();
	const startDate = dateOnly(addDays(now, -7));
	const scheduleEndDate = dateOnly(addDays(now, 7));
	const recordStartDate = dateOnly(addDays(now, -90));
	const reportStartDate = dateOnly(addDays(now, -30));
	const today = dateOnly(now);
	const patientId = options.patientId?.trim();
	// 调用方显式传入 [] 时只验证 API 健康状态；CLI 入口通过
	// parseCapabilities 自己提供默认能力，避免库函数隐式扩大验收范围。
	const capabilities = options.capabilities;
	const checks: ProviderSmokeCheck[] = [];

	async function requestJson(
		path: string,
		method: "GET" | "POST",
		additionalHeaders: Record<string, string> = {},
		requestTraceId?: string,
		isHealth = false,
	): Promise<{ data: unknown; traceId: string }> {
		// POST 同步需要让幂等键、x-request-id 和返回证据使用同一个 traceId。
		const traceId = requestTraceId ?? traceIdFactory();
		const headers = new Headers({
			accept: "application/json",
			"x-request-id": traceId,
			...additionalHeaders,
		});
		// 健康探针不需要身份；只给业务 API 加 Bearer，避免 token 进入
		// 反向代理或基础设施的健康检查日志。
		if (!isHealth) {
			headers.set("Authorization", `Bearer ${options.accessToken}`);
		}
		const response = await fetcher(`${baseUrl}${path}`, {
			method,
			signal: AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS),
			headers,
		});
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new ProviderSmokeRequestError(
				"Hospital API returned invalid JSON",
				response.status,
			);
		}
		if (!response.ok) {
			throw new ProviderSmokeRequestError(
				`Hospital API returned HTTP ${response.status}`,
				response.status,
			);
		}
		if (
			typeof body !== "object" ||
			body === null ||
			(body as { success?: unknown }).success !== true
		) {
			throw new ProviderSmokeRequestError(
				"Hospital API returned an unsuccessful response",
				response.status,
			);
		}
		const data = (body as { data?: unknown }).data;
		if (data === undefined) {
			throw new ProviderSmokeRequestError(
				"Hospital API response did not contain data",
				response.status,
			);
		}
		return { data, traceId };
	}

	async function getJson(
		path: string,
		isHealth = false,
	): Promise<{ data: unknown; traceId: string }> {
		return requestJson(path, "GET", {}, undefined, isHealth);
	}

	/**
	 * 患者同步是唯一被 smoke 显式允许的 POST：它只触发服务端重新读取目录，
	 * 不接受患者号或正文，且使用 traceId 生成幂等键，避免验收脚本重复创建业务事实。
	 */
	async function syncPatients(): Promise<{
		data: unknown;
		traceId: string;
	}> {
		const traceId = traceIdFactory();
		return requestJson(
			apiRoute(apiPrefix, "/patients/sync"),
			"POST",
			{
				"idempotency-key": `provider-smoke-${traceId}`,
				"x-request-id": traceId,
			},
			traceId,
		);
	}

	async function check(
		name: string,
		operation: () => Promise<SmokeObservation>,
	): Promise<void> {
		try {
			const observation = await operation();
			checks.push({
				name,
				status: "passed",
				traceId: observation.traceId,
				...(observation.itemCount === undefined
					? {}
					: { itemCount: observation.itemCount }),
			});
			logger.info(
				{
					event: "provider.smoke.capability.passed",
					capability: name,
					traceId: observation.traceId,
					...(observation.itemCount === undefined
						? {}
						: { itemCount: observation.itemCount }),
				},
				"Provider directory smoke capability passed",
			);
		} catch (error) {
			const errorType = error instanceof Error ? error.name : "UnknownError";
			const errorMessage =
				error instanceof Error ? error.message : "Unknown provider smoke error";
			checks.push({ name, status: "failed", errorType });
			logger.error(
				{
					event: "provider.smoke.capability.failed",
					capability: name,
					errorType,
					errorMessage,
				},
				"Provider directory smoke capability failed",
			);
		}
	}

	async function readSafe(path: string): Promise<SmokeObservation> {
		const result = await getJson(path);
		const itemCount = requireSafeData(result.data);
		return {
			traceId: result.traceId,
			...(itemCount === undefined ? {} : { itemCount }),
		};
	}

	async function readLive(): Promise<SmokeObservation> {
		const result = await getJson(healthRoute(apiPrefix, "/health/live"), true);
		if (responseStatus(result.data) !== "ok") {
			throw new ProviderSmokeRequestError(
				"Hospital API liveness status is not ok",
				200,
			);
		}
		return { traceId: result.traceId };
	}

	async function readReady(): Promise<SmokeObservation> {
		const result = await getJson(healthRoute(apiPrefix, "/health/ready"), true);
		if (responseStatus(result.data) !== "ready") {
			throw new ProviderSmokeRequestError(
				"Hospital API readiness status is not ready",
				200,
			);
		}
		return { traceId: result.traceId };
	}

	function complete(): ProviderSmokeResult {
		const passed = checks.every((check) => check.status === "passed");
		logger[passed ? "info" : "error"](
			{
				event: passed ? "provider.smoke.completed" : "provider.smoke.failed",
				checks,
			},
			passed
				? "Provider directory smoke completed"
				: "Provider directory smoke failed",
		);
		return { passed, checks };
	}

	await check("health-live", readLive);
	await check("health-ready", readReady);
	// 平台健康检查未通过时不触碰任何业务 provider，避免把基础设施故障
	// 放大成一串无意义的 provider 请求和错误日志。
	if (
		checks.some(
			(check) =>
				(check.name === "health-live" || check.name === "health-ready") &&
				check.status === "failed",
		)
	) {
		return complete();
	}

	for (const capability of capabilities) {
		if (capability === "patient-sync") {
			await check("patient-sync", async () => {
				const result = await syncPatients();
				const itemCount = requireSafeData(result.data);
				return {
					traceId: result.traceId,
					...(itemCount === undefined ? {} : { itemCount }),
				};
			});
			continue;
		}

		if (capability === "patients") {
			await check("patients", () => readSafe(apiRoute(apiPrefix, "/patients")));
			continue;
		}

		if (capability === "appointment-directory") {
			await check("appointment-departments", () =>
				readSafe(apiRoute(apiPrefix, "/appointments/departments")),
			);
			await check("appointment-schedules", async () => {
				const query = new URLSearchParams({
					startDate,
					endDate: scheduleEndDate,
				});
				return readSafe(
					`${apiRoute(apiPrefix, "/appointments/schedules")}?${query}`,
				);
			});
			continue;
		}

		const scopedPatientId = requirePatientId(patientId);
		if (capability === "appointment-records") {
			await check("appointment-records", async () => {
				const query = new URLSearchParams({
					patientId: scopedPatientId,
					startDate: recordStartDate,
					endDate: today,
				});
				return readSafe(
					`${apiRoute(apiPrefix, "/appointments/records")}?${query}`,
				);
			});
			continue;
		}

		if (capability === "reports") {
			await check("reports", async () => {
				const query = new URLSearchParams({
					patientId: scopedPatientId,
					startDate: reportStartDate,
					endDate: today,
				});
				return readSafe(`${apiRoute(apiPrefix, "/reports")}?${query}`);
			});
			continue;
		}

		let reportId: string | undefined;
		await check("reports", async () => {
			const query = new URLSearchParams({
				patientId: scopedPatientId,
				startDate: reportStartDate,
				endDate: today,
			});
			const result = await getJson(
				`${apiRoute(apiPrefix, "/reports")}?${query}`,
			);
			const itemCount = requireSafeData(result.data);
			reportId = firstOpaqueReportId(result.data);
			return {
				traceId: result.traceId,
				...(itemCount === undefined ? {} : { itemCount }),
			};
		});
		await check("report-detail", async () => {
			if (!reportId) {
				throw new ProviderSmokeRequestError(
					"Report directory did not return an opaque laboratory reportId",
					200,
				);
			}
			return readSafe(
				apiRoute(apiPrefix, `/reports/${encodeURIComponent(reportId)}`),
			);
		});
	}

	return complete();
}

function parseCapabilities(
	value: string | undefined,
): ProviderSmokeCapability[] {
	if (!value?.trim()) return [...DEFAULT_CAPABILITIES];
	const capabilities = value.split(",").map((item) => item.trim());
	const allowed = new Set<ProviderSmokeCapability>([
		"patient-sync",
		...DEFAULT_CAPABILITIES,
		"report-detail",
	]);
	if (
		capabilities.some(
			(capability) => !allowed.has(capability as ProviderSmokeCapability),
		)
	) {
		throw new ProviderSmokeConfigurationError(
			"HOSPITAL_SMOKE_CAPABILITIES contains an unsupported capability",
		);
	}
	return capabilities as ProviderSmokeCapability[];
}

if (import.meta.main) {
	const logger = createLogger({
		service: "hospital-provider-directory-smoke",
		environment: Bun.env.NODE_ENV ?? "development",
		level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
	});
	try {
		const result = await runProviderDirectorySmoke({
			baseUrl: Bun.env.HOSPITAL_API_BASE_URL ?? "",
			apiPrefix: resolveApiPrefix(Bun.env.HOSPITAL_API_PREFIX),
			accessToken: Bun.env.HOSPITAL_ACCESS_TOKEN ?? "",
			capabilities: parseCapabilities(Bun.env.HOSPITAL_SMOKE_CAPABILITIES),
			allowLocalHttp: Bun.env.HOSPITAL_ALLOW_LOCAL_HTTP === "true",
			logger,
			...(Bun.env.HOSPITAL_PATIENT_ID
				? { patientId: Bun.env.HOSPITAL_PATIENT_ID }
				: {}),
		});
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		logger.error(
			{
				event: "provider.smoke.configuration.failed",
				errorType: error instanceof Error ? error.name : "UnknownError",
			},
			"Provider directory smoke could not start",
		);
		process.exitCode = 1;
	}
}
