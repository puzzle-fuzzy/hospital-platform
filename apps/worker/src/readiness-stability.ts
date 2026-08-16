/**
 * readiness 连续采样工具。
 *
 * 健康探针只能回答“这一次请求是否可用”，不能回答远端 MySQL/Redis/schema
 * 是否在整个验收窗口内稳定。这里故意限制采样次数和间隔，避免把 smoke 变成
 * 永不结束的监控任务；业务 smoke 仍必须由调用方继续完成患者、Provider 和真机验收。
 */

export type ReadinessStabilityOptions = {
	/** 连续采样次数；库函数默认 1，命令行入口会使用更严格的默认值。 */
	readinessSamples?: number;
	/** 两次采样之间的间隔，单位为毫秒；默认不等待。 */
	readinessIntervalMs?: number;
};

export type ResolvedReadinessStabilityOptions = {
	readinessSamples: number;
	readinessIntervalMs: number;
};

export type ReadinessStabilityResult<T> = {
	/** 按时间顺序保留每次探针结果，调用方可识别中途 not_ready 的抖动。 */
	values: readonly T[];
	readinessSamples: number;
	readinessIntervalMs: number;
};

export class ReadinessStabilityConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReadinessStabilityConfigurationError";
	}
}

/**
 * 多次采样中某一次失败时保留原始错误，方便上层继续提取 HTTP 状态码和 traceId。
 * 只把采样序号加入安全诊断，不携带 URL、响应正文或连接串。
 */
export class ReadinessStabilityProbeError extends Error {
	readonly sampleNumber: number;
	readonly sampleCount: number;
	readonly cause: unknown;

	constructor(sampleNumber: number, sampleCount: number, cause: unknown) {
		super(`Readiness sample ${sampleNumber}/${sampleCount} failed`);
		this.name = "ReadinessStabilityProbeError";
		this.sampleNumber = sampleNumber;
		this.sampleCount = sampleCount;
		this.cause = cause;
	}
}

export const DEFAULT_READINESS_SAMPLES = 1;
export const DEFAULT_READINESS_INTERVAL_MS = 0;
export const MAX_READINESS_SAMPLES = 60;
export const MAX_READINESS_INTERVAL_MS = 60_000;

function requireBoundedInteger(
	value: number,
	name: string,
	minimum: number,
	maximum: number,
): number {
	if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new ReadinessStabilityConfigurationError(
			`${name} must be an integer between ${minimum} and ${maximum}`,
		);
	}
	return value;
}

export function resolveReadinessStability(
	options: ReadinessStabilityOptions = {},
): ResolvedReadinessStabilityOptions {
	return {
		readinessSamples: requireBoundedInteger(
			options.readinessSamples ?? DEFAULT_READINESS_SAMPLES,
			"readinessSamples",
			1,
			MAX_READINESS_SAMPLES,
		),
		readinessIntervalMs: requireBoundedInteger(
			options.readinessIntervalMs ?? DEFAULT_READINESS_INTERVAL_MS,
			"readinessIntervalMs",
			0,
			MAX_READINESS_INTERVAL_MS,
		),
	};
}

/**
 * 按顺序执行有界 readiness 采样。
 *
 * 任意一次探针失败都会中止本轮验收；这样 release 模式不会因为最后一次恢复
 * 就掩盖窗口中间的依赖抖动。原始错误通过 `ReadinessStabilityProbeError.cause`
 * 保留，调用方可以继续输出自己的状态码、错误码和 traceId。
 */
export async function runReadinessStabilityProbe<T>(
	probe: (context: { sampleNumber: number; sampleCount: number }) => Promise<T>,
	options: ReadinessStabilityOptions = {},
): Promise<ReadinessStabilityResult<T>> {
	const resolved = resolveReadinessStability(options);
	const values: T[] = [];

	for (
		let sampleNumber = 1;
		sampleNumber <= resolved.readinessSamples;
		sampleNumber += 1
	) {
		try {
			values.push(
				await probe({
					sampleNumber,
					sampleCount: resolved.readinessSamples,
				}),
			);
		} catch (error) {
			throw new ReadinessStabilityProbeError(
				sampleNumber,
				resolved.readinessSamples,
				error,
			);
		}

		if (
			sampleNumber < resolved.readinessSamples &&
			resolved.readinessIntervalMs > 0
		) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, resolved.readinessIntervalMs);
			});
		}
	}

	return {
		values,
		...resolved,
	};
}

/**
 * 从环境变量读取数字；非法值交给 resolveReadinessStability 统一拒绝，避免
 * CLI 入口各自复制不同的范围校验。返回 NaN 只作为内部配置错误哨兵，不会写入日志。
 */
export function parseReadinessEnvironmentNumber(
	value: string | undefined,
	fallback: number,
): number {
	if (value === undefined || value.trim() === "") return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : Number.NaN;
}
