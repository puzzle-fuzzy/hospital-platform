import {
	type AppLogger,
	createLogger,
	createNoopLogger,
} from "@hospital/observability";
import {
	type ApiPrefix,
	apiRoute,
	healthRoute,
	resolveApiPrefix,
} from "./api-route-prefix";
import {
	parseReadinessEnvironmentNumber,
	ReadinessStabilityProbeError,
	resolveReadinessStability,
	runReadinessStabilityProbe,
} from "./readiness-stability";

export type RuntimeSmokeFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type RuntimeSmokeCheck = {
	name:
		| "health-live"
		| "health-ready"
		| "system-ping"
		| "auth-boundary"
		| "closed-boundary";
	status: "passed" | "warning" | "failed";
	statusCode?: number;
	details?: readonly string[];
	traceId?: string;
	/** 连续 readiness 采样的全部 traceId；单次检查只保留 traceId。 */
	traceIds?: readonly string[];
};

export type RuntimeSmokeResult = {
	passed: boolean;
	checks: readonly RuntimeSmokeCheck[];
};

export type RuntimeSmokeOptions = {
	baseUrl: string;
	/** `/api/v1` 用于内网直连，`/api/v2` 用于公网转发验收。 */
	apiPrefix?: ApiPrefix;
	/** 本机 HTTP 只允许显式打开，公网/部署地址仍必须使用 HTTPS。 */
	allowLocalHttp?: boolean;
	/** 开发环境可以只观察 readiness；发布验收必须要求 ready。 */
	requireReady?: boolean;
	/** 发布验收可用连续采样识别依赖抖动；库调用默认保持单次兼容行为。 */
	readinessSamples?: number;
	/** 连续 readiness 采样间隔，单位为毫秒。 */
	readinessIntervalMs?: number;
	fetcher?: RuntimeSmokeFetcher;
	logger?: AppLogger;
	traceIdFactory?: () => string;
};

const RUNTIME_REQUEST_TIMEOUT_MS = 5_000;

class RuntimeSmokeConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RuntimeSmokeConfigurationError";
	}
}

class RuntimeSmokeRequestError extends Error {
	readonly statusCode: number;
	readonly traceId: string | undefined;

	constructor(message: string, statusCode: number, traceId?: string) {
		super(message);
		this.name = "RuntimeSmokeRequestError";
		this.statusCode = statusCode;
		this.traceId = traceId;
	}
}

function requireBaseUrl(value: string, allowLocalHttp: boolean): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new RuntimeSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL is invalid",
		);
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new RuntimeSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL must not contain credentials or query data",
		);
	}
	const isLocalHttp =
		url.protocol === "http:" &&
		(url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !(allowLocalHttp && isLocalHttp)) {
		throw new RuntimeSmokeConfigurationError(
			"HOSPITAL_API_BASE_URL must use HTTPS; local HTTP requires explicit opt-in",
		);
	}
	return url.toString().replace(/\/$/, "");
}

function responseStatus(data: unknown): unknown {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	return (data as { status?: unknown }).status;
}

function responseService(data: unknown): unknown {
	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		return undefined;
	}
	return (data as { service?: unknown }).service;
}

function responseErrorCode(body: unknown): unknown {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return undefined;
	}
	const error = (body as { error?: unknown }).error;
	if (typeof error !== "object" || error === null || Array.isArray(error)) {
		return undefined;
	}
	return (error as { code?: unknown }).code;
}

/**
 * 这些路径使用合法的最小查询参数，但不携带会话，专门验证认证边界。
 * 如果省略查询参数，Elysia 会先返回 validation；那只能证明输入校验，
 * 不能证明未登录请求被认证层拒绝，所以这里不能用空 query 做验收。
 */
const AUTH_BOUNDARY_ROUTES = [
	{ name: "me", path: "/me" },
	// 普通资料是“我的”页按当前用户隔离的独立路由，不能只依赖 /me 间接覆盖。
	// 未携带会话时必须先命中认证边界，不能被资料参数校验或业务读取逻辑吞掉。
	{ name: "profile", path: "/me/profile" },
	{ name: "patients", path: "/patients" },
	{ name: "appointment-departments", path: "/appointments/departments" },
	{
		name: "appointment-records",
		path: "/appointments/records?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
	},
	{
		name: "reports",
		path: "/reports?patientId=runtime-smoke-patient&startDate=2026-01-01&endDate=2026-01-02",
	},
	{
		name: "outpatient-payments",
		path: "/payments/outpatient/records?patientId=runtime-smoke-patient&status=unpaid",
	},
] as const;

/**
 * 这些能力目前没有完成 Provider/HIS contract，因此必须保持“未注册”的 404。
 * smoke 只发送空 JSON 来确认 HTTP 方法和路径边界，不传患者、订单、医保或支付
 * 数据；如果将来有人注册了其中任一路由，门禁会立即失败，避免把“接口存在”误写
 * 成业务迁移完成。取消和预约写入也放在这里，是因为它们属于同一个待审核的命令面。
 */
const CLOSED_BOUNDARY_ROUTES = [
	{ name: "patient-create", method: "POST", path: "/patients" },
	{ name: "medical-records", method: "GET", path: "/medical-records" },
	{
		name: "medical-record-detail",
		method: "GET",
		path: "/medical-records/closed-boundary-visit",
	},
	{
		name: "insurance-authorization",
		method: "POST",
		path: "/payments/insurance/authorization",
	},
	{ name: "appointment-create", method: "POST", path: "/appointments" },
	{
		name: "appointment-hold",
		method: "POST",
		path: "/appointments/holds",
	},
	{
		name: "appointment-cancel",
		method: "POST",
		path: "/appointments/closed-boundary-appointment/cancel",
	},
] as const;

/**
 * 健康接口是瞬时探针，发布 smoke 必须确认反向代理没有移除 no-store。
 * 只按 Cache-Control 指令解析，不把其他缓存参数误判为等价的禁止缓存。
 */
function hasNoStoreDirective(value: string | null): boolean {
	return (
		value
			?.split(",")
			.some((directive) => directive.trim().toLowerCase() === "no-store") ??
		false
	);
}

/**
 * 运行时 smoke 只验证平台 API 的最小可观测面：不会登录、读患者或调用
 * provider。ready 的 not_ready 在开发观察模式下是 warning，发布模式通过
 * HOSPITAL_RUNTIME_REQUIRE_READY=true 将其升级为失败。
 */
export async function runApiRuntimeSmoke(
	options: RuntimeSmokeOptions,
): Promise<RuntimeSmokeResult> {
	const baseUrl = requireBaseUrl(
		options.baseUrl.trim(),
		options.allowLocalHttp === true,
	);
	let apiPrefix: ApiPrefix;
	try {
		apiPrefix = resolveApiPrefix(options.apiPrefix);
	} catch {
		throw new RuntimeSmokeConfigurationError(
			"HOSPITAL_API_PREFIX must be /api/v1 or /api/v2",
		);
	}
	const fetcher = options.fetcher ?? fetch;
	const logger = options.logger ?? createNoopLogger();
	const traceIdFactory = options.traceIdFactory ?? (() => crypto.randomUUID());
	const readinessStability = resolveReadinessStability(options);
	const checks: RuntimeSmokeCheck[] = [];

	async function getJson(
		path: string,
		isHealth = false,
	): Promise<{
		data: unknown;
		statusCode: number;
		traceId: string;
		cacheControl: string | null;
	}> {
		const traceId = traceIdFactory();
		const route = isHealth
			? healthRoute(apiPrefix, path)
			: apiRoute(apiPrefix, path);
		let response: Response;
		try {
			response = await fetcher(`${baseUrl}${route}`, {
				method: "GET",
				signal: AbortSignal.timeout(RUNTIME_REQUEST_TIMEOUT_MS),
				headers: {
					accept: "application/json",
					"x-request-id": traceId,
				},
			});
		} catch (error) {
			// 网络错误不能暴露 URL、请求头或底层连接串；只保留错误类型，并保留
			// 本次请求的 traceId，便于和服务端反向代理及应用日志进行关联。
			const errorType = error instanceof Error ? error.name : "UnknownError";
			throw new RuntimeSmokeRequestError(
				`Hospital API request failed (${errorType})`,
				0,
				traceId,
			);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new RuntimeSmokeRequestError(
				"Hospital API returned invalid JSON",
				response.status,
				traceId,
			);
		}
		if (!response.ok) {
			throw new RuntimeSmokeRequestError(
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
			throw new RuntimeSmokeRequestError(
				"Hospital API returned an unsuccessful response",
				response.status,
				traceId,
			);
		}
		return {
			data: (body as { data?: unknown }).data,
			statusCode: response.status,
			traceId,
			cacheControl: response.headers.get("cache-control"),
		};
	}

	async function requestWithoutAuth(
		path: string,
		method: "GET" | "POST" = "GET",
	): Promise<{
		body: unknown;
		statusCode: number;
		traceId: string;
	}> {
		const traceId = traceIdFactory();
		const route = apiRoute(apiPrefix, path);
		let response: Response;
		try {
			response = await fetcher(`${baseUrl}${route}`, {
				method,
				signal: AbortSignal.timeout(RUNTIME_REQUEST_TIMEOUT_MS),
				headers: {
					accept: "application/json",
					...(method === "POST" ? { "content-type": "application/json" } : {}),
					"x-request-id": traceId,
				},
				...(method === "POST" ? { body: "{}" } : {}),
			});
		} catch (error) {
			// 未授权/关闭能力边界的网络失败都必须携带 traceId，否则无法区分具体失败路由。
			const errorType = error instanceof Error ? error.name : "UnknownError";
			throw new RuntimeSmokeRequestError(
				`Hospital API request failed (${errorType})`,
				0,
				traceId,
			);
		}
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new RuntimeSmokeRequestError(
				`Protected route ${path} returned invalid JSON`,
				response.status,
				traceId,
			);
		}
		return { body, statusCode: response.status, traceId };
	}

	async function check(
		name: RuntimeSmokeCheck["name"],
		operation: () => Promise<RuntimeSmokeCheck>,
	): Promise<void> {
		try {
			const result = await operation();
			checks.push(result);
			logger[result.status === "failed" ? "error" : "info"](
				{
					event:
						result.status === "failed"
							? "runtime.smoke.check.failed"
							: result.status === "warning"
								? "runtime.smoke.check.warning"
								: "runtime.smoke.check.passed",
					check: name,
					...(result.statusCode === undefined
						? {}
						: { statusCode: result.statusCode }),
					...(result.traceId ? { traceId: result.traceId } : {}),
				},
				`Runtime smoke ${result.status}: ${name}`,
			);
		} catch (error) {
			const cause =
				error instanceof ReadinessStabilityProbeError ? error.cause : error;
			const errorType = cause instanceof Error ? cause.name : "UnknownError";
			const statusCode =
				cause instanceof RuntimeSmokeRequestError
					? cause.statusCode
					: undefined;
			const traceId =
				cause instanceof RuntimeSmokeRequestError ? cause.traceId : undefined;
			const result: RuntimeSmokeCheck = {
				name,
				status: "failed",
				details: [
					errorType,
					...(error instanceof ReadinessStabilityProbeError &&
					error.sampleCount > 1
						? [`readiness-sample-${error.sampleNumber}/${error.sampleCount}`]
						: []),
				],
				...(statusCode === undefined ? {} : { statusCode }),
				...(traceId ? { traceId } : {}),
			};
			checks.push(result);
			logger.error(
				{
					event: "runtime.smoke.check.failed",
					check: name,
					errorType,
					// 运行时 smoke 的异常 message 可能携带 URL 或底层连接信息；
					// 日志只保留固定类型、HTTP 状态和 traceId，避免原文成为泄露通道。
					...(statusCode === undefined ? {} : { statusCode }),
					...(traceId ? { traceId } : {}),
				},
				`Runtime smoke failed: ${name}`,
			);
		}
	}

	await check("health-live", async () => {
		const result = await getJson("/health/live", true);
		if (!hasNoStoreDirective(result.cacheControl)) {
			throw new RuntimeSmokeRequestError(
				"Hospital API liveness response must include Cache-Control: no-store",
				result.statusCode,
				result.traceId,
			);
		}
		if (responseStatus(result.data) !== "ok") {
			throw new RuntimeSmokeRequestError(
				"Hospital API liveness status is not ok",
				result.statusCode,
				result.traceId,
			);
		}
		return {
			name: "health-live",
			status: "passed",
			statusCode: result.statusCode,
			traceId: result.traceId,
		};
	});

	await check("health-ready", async () => {
		const observations = await runReadinessStabilityProbe(async () => {
			const result = await getJson("/health/ready", true);
			if (!hasNoStoreDirective(result.cacheControl)) {
				throw new RuntimeSmokeRequestError(
					"Hospital API readiness response must include Cache-Control: no-store",
					result.statusCode,
					result.traceId,
				);
			}
			const status = responseStatus(result.data);
			if (status === "ready") return { result, status: "ready" as const };
			if (status === "not_ready" && options.requireReady !== true) {
				return { result, status: "not_ready" as const };
			}
			throw new RuntimeSmokeRequestError(
				"Hospital API readiness status is not ready",
				result.statusCode,
				result.traceId,
			);
		}, readinessStability);
		const notReadySamples = observations.values.filter(
			(observation) => observation.status === "not_ready",
		).length;
		const last = observations.values.at(-1);
		if (!last) {
			throw new RuntimeSmokeRequestError(
				"Hospital API readiness returned no samples",
				0,
			);
		}
		return {
			name: "health-ready",
			status: notReadySamples > 0 ? "warning" : "passed",
			...(notReadySamples > 0
				? {
						details:
							observations.readinessSamples > 1
								? [
										"not_ready",
										`samples=${observations.readinessSamples}`,
										`not_ready_samples=${notReadySamples}`,
									]
								: ["not_ready"],
					}
				: observations.readinessSamples > 1
					? { details: [`samples=${observations.readinessSamples}`] }
					: {}),
			statusCode: last.result.statusCode,
			traceId: last.result.traceId,
			...(observations.readinessSamples > 1
				? {
						traceIds: observations.values.map(
							(observation) => observation.result.traceId,
						),
					}
				: {}),
		};
	});

	await check("system-ping", async () => {
		const result = await getJson("/system/ping");
		if (responseService(result.data) !== "hospital-api") {
			throw new RuntimeSmokeRequestError(
				"Hospital API system identity is invalid",
				result.statusCode,
				result.traceId,
			);
		}
		return {
			name: "system-ping",
			status: "passed",
			statusCode: result.statusCode,
			traceId: result.traceId,
		};
	});

	await check("auth-boundary", async () => {
		const failures: string[] = [];
		let statusCode: number | undefined;
		let traceId: string | undefined;
		let failureTraceId: string | undefined;

		for (const route of AUTH_BOUNDARY_ROUTES) {
			try {
				const result = await requestWithoutAuth(route.path);
				statusCode ??= result.statusCode;
				traceId = result.traceId;
				if (result.statusCode !== 401) {
					failures.push(`${route.name}:http-${result.statusCode}`);
					continue;
				}
				if (responseErrorCode(result.body) !== "unauthorized") {
					failures.push(`${route.name}:error-code`);
				}
			} catch (error) {
				if (error instanceof RuntimeSmokeRequestError && error.traceId) {
					failureTraceId = error.traceId;
				}
				failures.push(
					`${route.name}:${error instanceof Error ? error.name : "UnknownError"}`,
				);
			}
		}
		const finalTraceId = failureTraceId ?? traceId;

		return {
			name: "auth-boundary",
			status: failures.length > 0 ? "failed" : "passed",
			...(failures.length > 0 ? { details: failures } : {}),
			...(statusCode === undefined ? {} : { statusCode }),
			...(finalTraceId ? { traceId: finalTraceId } : {}),
		};
	});

	await check("closed-boundary", async () => {
		const failures: string[] = [];
		let statusCode: number | undefined;
		let traceId: string | undefined;
		let failureTraceId: string | undefined;

		for (const route of CLOSED_BOUNDARY_ROUTES) {
			try {
				const result = await requestWithoutAuth(route.path, route.method);
				statusCode ??= result.statusCode;
				traceId = result.traceId;
				if (result.statusCode !== 404) {
					failures.push(`${route.name}:http-${result.statusCode}`);
					continue;
				}
				if (responseErrorCode(result.body) !== "not-found") {
					failures.push(`${route.name}:error-code`);
				}
			} catch (error) {
				if (error instanceof RuntimeSmokeRequestError && error.traceId) {
					failureTraceId = error.traceId;
				}
				failures.push(
					`${route.name}:${error instanceof Error ? error.name : "UnknownError"}`,
				);
			}
		}
		const finalTraceId = failureTraceId ?? traceId;

		return {
			name: "closed-boundary",
			status: failures.length > 0 ? "failed" : "passed",
			...(failures.length > 0 ? { details: failures } : {}),
			...(statusCode === undefined ? {} : { statusCode }),
			...(finalTraceId ? { traceId: finalTraceId } : {}),
		};
	});

	const passed = checks.every((check) => check.status !== "failed");
	logger[passed ? "info" : "error"](
		{
			event: passed ? "runtime.smoke.completed" : "runtime.smoke.failed",
			checks,
		},
		passed ? "Runtime smoke completed" : "Runtime smoke failed",
	);
	return { passed, checks };
}

if (import.meta.main) {
	const logger = createLogger({
		service: "hospital-api-runtime-smoke",
		environment: Bun.env.NODE_ENV ?? "development",
		level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
	});
	try {
		const result = await runApiRuntimeSmoke({
			baseUrl: Bun.env.HOSPITAL_API_BASE_URL ?? "",
			apiPrefix: resolveApiPrefix(Bun.env.HOSPITAL_API_PREFIX),
			allowLocalHttp: Bun.env.HOSPITAL_ALLOW_LOCAL_HTTP === "true",
			requireReady: Bun.env.HOSPITAL_RUNTIME_REQUIRE_READY === "true",
			readinessSamples: parseReadinessEnvironmentNumber(
				Bun.env.HOSPITAL_RUNTIME_READINESS_SAMPLES,
				3,
			),
			readinessIntervalMs: parseReadinessEnvironmentNumber(
				Bun.env.HOSPITAL_RUNTIME_READINESS_INTERVAL_MS,
				1_000,
			),
			logger,
		});
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		logger.error(
			{
				event: "runtime.smoke.configuration.failed",
				errorType: error instanceof Error ? error.name : "UnknownError",
			},
			"Runtime smoke could not start",
		);
		process.exitCode = 1;
	}
}
