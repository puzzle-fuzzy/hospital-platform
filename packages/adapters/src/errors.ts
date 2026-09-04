import { DependencyNotConfiguredError } from "@hospital/domain";
import type { AdapterName } from "./context";

export class AdapterNotConfiguredError extends DependencyNotConfiguredError {
	readonly adapter: AdapterName;

	constructor(adapter: AdapterName) {
		super(`adapter:${adapter}`);
		this.name = "AdapterNotConfiguredError";
		this.adapter = adapter;
	}
}

/**
 * Provider 失败发生的阶段。
 *
 * `validation` 表示在发出 Provider 请求前的平台合同校验失败；`transport` 表示没有拿到
 * 可验证的 HTTP 响应（例如 TLS、DNS、连接或超时）；`http` 表示 Provider 已返回 HTTP 响应但
 * 状态码不是 2xx；`response` 表示 HTTP 响应已返回，但响应格式或 Provider 业务结果不符合
 * 已声明 contract。
 * 该字段只用于服务端日志，不改变对小程序暴露的业务错误码。
 */
export type ProviderFailureStage =
	| "validation"
	| "transport"
	| "http"
	| "response";

/** 已确认的 Provider 业务竞争原因；只用于稳定映射和低敏日志。 */
export type ProviderFailureReason = "appointment-source-unavailable";

export class ProviderRequestError extends Error {
	readonly provider: AdapterName;
	readonly operation: string;
	readonly requestId: string | undefined;
	readonly statusCode: number | undefined;
	readonly retryable: boolean;
	/** 失败阶段用于区分 TLS/网络故障、HTTP 5xx 和响应内容故障。 */
	readonly failureStage: ProviderFailureStage | undefined;
	/** Provider 已响应但内容不符合平台读模型时，公共错误码必须区分于请求被拒绝。 */
	readonly responseInvalid: boolean;
	/** 已确认的号源竞争边界；不能把其它 Provider 拒绝猜测成该原因。 */
	readonly reason: ProviderFailureReason | undefined;

	constructor(input: {
		provider: AdapterName;
		operation: string;
		message: string;
		requestId?: string;
		statusCode?: number;
		retryable: boolean;
		failureStage?: ProviderFailureStage;
		responseInvalid?: boolean;
		reason?: ProviderFailureReason;
		cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.name = "ProviderRequestError";
		this.provider = input.provider;
		this.operation = input.operation;
		this.requestId = input.requestId;
		this.statusCode = input.statusCode;
		this.retryable = input.retryable;
		this.failureStage = input.failureStage;
		this.responseInvalid = input.responseInvalid === true;
		this.reason = input.reason;
	}
}
