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
	| "session"
	| "patient-sync"
	| "patients"
	| "appointment-directory"
	| "appointment-records"
	| "outpatient-payments"
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
	"session",
	"patients",
	"appointment-directory",
	"appointment-records",
	"outpatient-payments",
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
	/** 失败请求仍要保留 traceId，便于和 API/反向代理日志进行一一关联。 */
	readonly traceId: string | undefined;

	constructor(message: string, statusCode: number, traceId?: string) {
		super(message);
		this.name = "ProviderSmokeRequestError";
		this.statusCode = statusCode;
		this.traceId = traceId;
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

/** 提取当前 session 的内部患者 ID；只接受平台读模型中的 `items[].id`。 */
function patientIds(data: unknown, traceId?: string): readonly string[] {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new ProviderSmokeRequestError(
			"Patient directory response is not an object",
			200,
			traceId,
		);
	}
	const items = (data as { items?: unknown }).items;
	if (!Array.isArray(items)) {
		throw new ProviderSmokeRequestError(
			"Patient directory response does not contain items",
			200,
			traceId,
		);
	}
	const ids: string[] = [];
	for (const [index, item] of items.entries()) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw new ProviderSmokeRequestError(
				`Patient directory item ${index} is invalid`,
				200,
				traceId,
			);
		}
		const id = (item as { id?: unknown }).id;
		if (typeof id !== "string" || !id.trim()) {
			throw new ProviderSmokeRequestError(
				`Patient directory item ${index} has no internal id`,
				200,
				traceId,
			);
		}
		ids.push(id.trim());
	}
	return ids;
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

/** `/me` 只允许返回当前平台内部用户 id；provider subject 和身份凭证不能出现在响应中。 */
function currentUserId(data: unknown): string | undefined {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	const user = (data as { user?: unknown }).user;
	if (typeof user !== "object" || user === null || Array.isArray(user)) {
		return undefined;
	}
	const id = (user as { id?: unknown }).id;
	return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function requireSafeData(data: unknown, traceId?: string): number | undefined {
	const forbiddenPath = forbiddenResponseKey(data);
	if (forbiddenPath) {
		throw new ProviderSmokeRequestError(
			`Response contains a forbidden field at ${forbiddenPath}`,
			200,
			traceId,
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
	const scopedCapabilities = new Set<ProviderSmokeCapability>([
		"appointment-records",
		"outpatient-payments",
		"reports",
		"report-detail",
	]);
	let ownerPatientIds = new Set<string>();
	let patientDirectoryTraceId: string | undefined;
	let patientDirectoryLoaded = false;
	let patientOwnerVerified = false;
	// 调用方显式传入 [] 时只验证 API 健康状态；CLI 入口通过
	// parseCapabilities 自己提供默认能力，避免库函数隐式扩大验收范围。
	const capabilityOrder: readonly ProviderSmokeCapability[] = [
		"session",
		"patient-sync",
		"patients",
		"appointment-directory",
		"appointment-records",
		"outpatient-payments",
		"reports",
		"report-detail",
	];
	// 固定执行顺序，保证患者同步完成后才读取最新 owner 目录，再进行患者作用域查询。
	const capabilities = capabilityOrder.filter((capability) =>
		options.capabilities.includes(capability),
	);
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
		let response: Response;
		try {
			response = await fetcher(`${baseUrl}${path}`, {
				method,
				signal: AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS),
				headers,
			});
		} catch (error) {
			// 网络失败也必须携带本次请求的 traceId；只保留错误类型，避免把
			// URL、响应正文或其他可能包含敏感信息的异常内容写入 smoke 证据。
			const errorType = error instanceof Error ? error.name : "UnknownError";
			throw new ProviderSmokeRequestError(
				`Hospital API request failed (${errorType})`,
				0,
				traceId,
			);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new ProviderSmokeRequestError(
				"Hospital API returned invalid JSON",
				response.status,
				traceId,
			);
		}
		if (!response.ok) {
			throw new ProviderSmokeRequestError(
				`Hospital API returned HTTP ${response.status}`,
				response.status,
				traceId,
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
				traceId,
			);
		}
		const data = (body as { data?: unknown }).data;
		if (data === undefined) {
			throw new ProviderSmokeRequestError(
				"Hospital API response did not contain data",
				response.status,
				traceId,
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
	async function syncPatients(
		idempotencyKey: string,
		traceId: string,
	): Promise<{
		data: unknown;
		traceId: string;
	}> {
		return requestJson(
			apiRoute(apiPrefix, "/patients/sync"),
			"POST",
			{
				"idempotency-key": idempotencyKey,
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
			const traceId =
				error instanceof ProviderSmokeRequestError ? error.traceId : undefined;
			checks.push({
				name,
				status: "failed",
				errorType,
				...(traceId ? { traceId } : {}),
			});
			logger.error(
				{
					event: "provider.smoke.capability.failed",
					capability: name,
					errorType,
					errorMessage,
					...(traceId ? { traceId } : {}),
				},
				"Provider directory smoke capability failed",
			);
		}
	}

	async function readSafe(path: string): Promise<SmokeObservation> {
		const result = await getJson(path);
		const itemCount = requireSafeData(result.data, result.traceId);
		return {
			traceId: result.traceId,
			...(itemCount === undefined ? {} : { itemCount }),
		};
	}

	async function readPatients(): Promise<SmokeObservation> {
		const result = await getJson(apiRoute(apiPrefix, "/patients"));
		const itemCount = requireSafeData(result.data, result.traceId);
		ownerPatientIds = new Set(patientIds(result.data, result.traceId));
		patientDirectoryTraceId = result.traceId;
		return {
			traceId: result.traceId,
			...(itemCount === undefined ? {} : { itemCount }),
		};
	}

	/** 患者作用域业务必须使用刚读取的 owner 目录中的内部 ID，禁止拿外部或其他用户 ID 试探 Provider。 */
	async function verifyPatientOwner(): Promise<SmokeObservation> {
		const requestedPatientId = requirePatientId(patientId);
		const traceId = patientDirectoryTraceId;
		if (!traceId) {
			throw new ProviderSmokeRequestError(
				"Patient directory trace is missing",
				0,
			);
		}
		if (!ownerPatientIds.has(requestedPatientId)) {
			throw new ProviderSmokeRequestError(
				"Requested patient is not in the current session directory",
				200,
				traceId,
			);
		}
		return { traceId };
	}

	async function readLive(): Promise<SmokeObservation> {
		const result = await getJson(healthRoute(apiPrefix, "/health/live"), true);
		if (responseStatus(result.data) !== "ok") {
			throw new ProviderSmokeRequestError(
				"Hospital API liveness status is not ok",
				200,
				result.traceId,
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
				result.traceId,
			);
		}
		return { traceId: result.traceId };
	}

	/**
	 * 先验证 Bearer 会话对应的平台用户，再允许 smoke 访问患者或 Provider 只读目录。
	 * 这一步不把 userId 写入 smoke 结果，只用结构存在性证明会话边界，避免把身份信息扩散到验收文件。
	 */
	async function readSession(): Promise<SmokeObservation> {
		const result = await getJson(apiRoute(apiPrefix, "/me"));
		requireSafeData(result.data, result.traceId);
		if (!currentUserId(result.data)) {
			throw new ProviderSmokeRequestError(
				"Current platform session response is invalid",
				200,
				result.traceId,
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

	// session 是业务 smoke 的第二道门；会话无效时不得继续触碰患者或 provider。
	if (capabilities.includes("session")) {
		await check("session", readSession);
		if (
			checks.some(
				(check) => check.name === "session" && check.status === "failed",
			)
		) {
			return complete();
		}
	}

	for (const capability of capabilities) {
		if (capability === "session") continue;
		if (capability === "patient-sync") {
			const firstTraceId = traceIdFactory();
			const idempotencyKey = `provider-smoke-${firstTraceId}`;
			let firstSyncData: unknown;
			let firstSyncPassed = false;

			await check("patient-sync", async () => {
				const result = await syncPatients(idempotencyKey, firstTraceId);
				const itemCount = requireSafeData(result.data, result.traceId);
				// 只有首轮响应完成安全字段审计后，才允许用它作为重放比较基线。
				firstSyncData = result.data;
				firstSyncPassed = true;
				return {
					traceId: result.traceId,
					...(itemCount === undefined ? {} : { itemCount }),
				};
			});

			/**
			 * 第二次请求必须复用同一个 owner-scoped 幂等键，验证服务端从 durable
			 * operation ledger 重放当前平台读模型，而不是再次访问 provider 或生成
			 * 第二套患者 ID。traceId 刻意不同，确保不是客户端重复发送同一请求的假测试。
			 */
			if (firstSyncPassed) {
				await check("patient-sync-replay", async () => {
					const result = await syncPatients(idempotencyKey, traceIdFactory());
					const itemCount = requireSafeData(result.data, result.traceId);
					if (JSON.stringify(result.data) !== JSON.stringify(firstSyncData)) {
						throw new ProviderSmokeRequestError(
							"Patient sync replay did not return the same platform read model",
							200,
							result.traceId,
						);
					}
					return {
						traceId: result.traceId,
						...(itemCount === undefined ? {} : { itemCount }),
					};
				});
			}
			continue;
		}

		if (capability === "patients") {
			if (!patientDirectoryLoaded) {
				await check("patients", readPatients);
				if (
					checks.some(
						(check) => check.name === "patients" && check.status === "failed",
					)
				) {
					return complete();
				}
				patientDirectoryLoaded = true;
			}
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

		if (scopedCapabilities.has(capability)) {
			if (!patientDirectoryLoaded) {
				await check("patients", readPatients);
				if (
					checks.some(
						(check) => check.name === "patients" && check.status === "failed",
					)
				) {
					return complete();
				}
				patientDirectoryLoaded = true;
			}
			if (!patientOwnerVerified) {
				await check("patient-owner", verifyPatientOwner);
				if (
					checks.some(
						(check) =>
							check.name === "patient-owner" && check.status === "failed",
					)
				) {
					return complete();
				}
				patientOwnerVerified = true;
			}
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

		/**
		 * 门诊费用的 `unpaid`/`paid` 是两个独立的只读查询状态，不代表发起支付或完成结算。
		 * Smoke 必须分别验证请求状态和服务端回显状态，防止 provider/代理返回了另一状态的
		 * 快照却被当成当前 tab 的正确数据；金额、订单和医保字段仍由安全响应审计统一拦截。
		 */
		if (capability === "outpatient-payments") {
			const paymentPatientId = requirePatientId(patientId);
			for (const status of ["unpaid", "paid"] as const) {
				await check(`outpatient-payments-${status}`, async () => {
					const query = new URLSearchParams({
						patientId: paymentPatientId,
						status,
					});
					const result = await getJson(
						`${apiRoute(apiPrefix, "/payments/outpatient/records")}?${query}`,
					);
					if (responseStatus(result.data) !== status) {
						throw new ProviderSmokeRequestError(
							`Outpatient payment response status does not match ${status}`,
							200,
							result.traceId,
						);
					}
					const itemCount = requireSafeData(result.data, result.traceId);
					return {
						traceId: result.traceId,
						...(itemCount === undefined ? {} : { itemCount }),
					};
				});
			}
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
		let reportDirectoryTraceId: string | undefined;
		await check("reports", async () => {
			const query = new URLSearchParams({
				patientId: scopedPatientId,
				startDate: reportStartDate,
				endDate: today,
			});
			const result = await getJson(
				`${apiRoute(apiPrefix, "/reports")}?${query}`,
			);
			const itemCount = requireSafeData(result.data, result.traceId);
			reportId = firstOpaqueReportId(result.data);
			reportDirectoryTraceId = result.traceId;
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
					reportDirectoryTraceId,
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
		"session",
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
