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

/**
 * Provider 请求边界的结果确定性。
 *
 * `not_sent` 表示平台在签名/参数校验阶段就停止了，允许修复后重试；
 * `rejected` 表示 provider 已明确拒绝，不能把它误当成支付成功；
 * `unknown` 表示请求可能已经到达 provider，必须先查单再决定是否重建。
 */
export type ProviderRequestOutcome = "not_sent" | "rejected" | "unknown";

/** 已确认的 Provider 业务竞争原因；只用于稳定映射和低敏日志。 */
export type ProviderFailureReason =
	| "appointment-source-unavailable"
	/** 微信查单明确返回订单不存在，可安全把本地尝试置为 failed 后重试。 */
	| "payment-order-not-found";

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
	/** Provider 错误响应中的有限字段；不保存原始响应，供服务端日志关联。 */
	readonly providerErrorCode: string | undefined;
	readonly providerErrorMessage: string | undefined;
	/** 请求是否已越过 provider 边界；支付预支付重试策略依赖该字段。 */
	readonly requestOutcome: ProviderRequestOutcome | undefined;

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
		providerErrorCode?: string;
		providerErrorMessage?: string;
		requestOutcome?: ProviderRequestOutcome;
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
		this.providerErrorCode = input.providerErrorCode;
		this.providerErrorMessage = input.providerErrorMessage;
		this.requestOutcome = input.requestOutcome;
	}
}
