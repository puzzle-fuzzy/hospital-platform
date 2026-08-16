import {
	createLogger,
	createNoopLogger,
	type AppLogger,
} from "@hospital/observability";

export type RuntimeSmokeFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export type RuntimeSmokeCheck = {
	name: "health-live" | "health-ready" | "system-ping";
	status: "passed" | "warning" | "failed";
	statusCode?: number;
	details?: readonly string[];
	traceId?: string;
};

export type RuntimeSmokeResult = {
	passed: boolean;
	checks: readonly RuntimeSmokeCheck[];
};

export type RuntimeSmokeOptions = {
	baseUrl: string;
	/** 本机 HTTP 只允许显式打开，公网/部署地址仍必须使用 HTTPS。 */
	allowLocalHttp?: boolean;
	/** 开发环境可以只观察 readiness；发布验收必须要求 ready。 */
	requireReady?: boolean;
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

	constructor(message: string, statusCode: number) {
		super(message);
		this.name = "RuntimeSmokeRequestError";
		this.statusCode = statusCode;
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
	const fetcher = options.fetcher ?? fetch;
	const logger = options.logger ?? createNoopLogger();
	const traceIdFactory = options.traceIdFactory ?? (() => crypto.randomUUID());
	const checks: RuntimeSmokeCheck[] = [];

	async function getJson(path: string): Promise<{
		data: unknown;
		statusCode: number;
		traceId: string;
		cacheControl: string | null;
	}> {
		const traceId = traceIdFactory();
		const response = await fetcher(`${baseUrl}${path}`, {
			method: "GET",
			signal: AbortSignal.timeout(RUNTIME_REQUEST_TIMEOUT_MS),
			headers: {
				accept: "application/json",
				"x-request-id": traceId,
			},
		});
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			throw new RuntimeSmokeRequestError(
				"Hospital API returned invalid JSON",
				response.status,
			);
		}
		if (!response.ok) {
			throw new RuntimeSmokeRequestError(
				`Hospital API returned HTTP ${response.status}`,
				response.status,
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
			);
		}
		return {
			data: (body as { data?: unknown }).data,
			statusCode: response.status,
			traceId,
			cacheControl: response.headers.get("cache-control"),
		};
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
			const errorType = error instanceof Error ? error.name : "UnknownError";
			const statusCode =
				error instanceof RuntimeSmokeRequestError
					? error.statusCode
					: undefined;
			const result: RuntimeSmokeCheck = {
				name,
				status: "failed",
				details: [errorType],
				...(statusCode === undefined ? {} : { statusCode }),
			};
			checks.push(result);
			logger.error(
				{
					event: "runtime.smoke.check.failed",
					check: name,
					errorType,
					...(statusCode === undefined ? {} : { statusCode }),
				},
				`Runtime smoke failed: ${name}`,
			);
		}
	}

	await check("health-live", async () => {
		const result = await getJson("/health/live");
		if (!hasNoStoreDirective(result.cacheControl)) {
			throw new RuntimeSmokeRequestError(
				"Hospital API liveness response must include Cache-Control: no-store",
				result.statusCode,
			);
		}
		if (responseStatus(result.data) !== "ok") {
			throw new RuntimeSmokeRequestError(
				"Hospital API liveness status is not ok",
				result.statusCode,
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
		const result = await getJson("/health/ready");
		if (!hasNoStoreDirective(result.cacheControl)) {
			throw new RuntimeSmokeRequestError(
				"Hospital API readiness response must include Cache-Control: no-store",
				result.statusCode,
			);
		}
		const status = responseStatus(result.data);
		if (status === "ready") {
			return {
				name: "health-ready",
				status: "passed",
				statusCode: result.statusCode,
				traceId: result.traceId,
			};
		}
		if (status === "not_ready" && options.requireReady !== true) {
			return {
				name: "health-ready",
				status: "warning",
				details: ["not_ready"],
				statusCode: result.statusCode,
				traceId: result.traceId,
			};
		}
		throw new RuntimeSmokeRequestError(
			"Hospital API readiness status is not ready",
			result.statusCode,
		);
	});

	await check("system-ping", async () => {
		const result = await getJson("/api/v1/system/ping");
		if (responseService(result.data) !== "hospital-api") {
			throw new RuntimeSmokeRequestError(
				"Hospital API system identity is invalid",
				result.statusCode,
			);
		}
		return {
			name: "system-ping",
			status: "passed",
			statusCode: result.statusCode,
			traceId: result.traceId,
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
			allowLocalHttp: Bun.env.HOSPITAL_ALLOW_LOCAL_HTTP === "true",
			requireReady: Bun.env.HOSPITAL_RUNTIME_REQUIRE_READY === "true",
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
