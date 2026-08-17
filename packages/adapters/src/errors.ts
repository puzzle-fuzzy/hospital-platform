import type { AdapterName } from "./context";
import { DependencyNotConfiguredError } from "@hospital/domain";

export class AdapterNotConfiguredError extends DependencyNotConfiguredError {
	readonly adapter: AdapterName;

	constructor(adapter: AdapterName) {
		super(`adapter:${adapter}`);
		this.name = "AdapterNotConfiguredError";
		this.adapter = adapter;
	}
}

export class ProviderRequestError extends Error {
	readonly provider: AdapterName;
	readonly operation: string;
	readonly requestId: string | undefined;
	readonly statusCode: number | undefined;
	readonly retryable: boolean;
	/** Provider 已响应但内容不符合平台读模型时，公共错误码必须区分于请求被拒绝。 */
	readonly responseInvalid: boolean;

	constructor(input: {
		provider: AdapterName;
		operation: string;
		message: string;
		requestId?: string;
		statusCode?: number;
		retryable: boolean;
		responseInvalid?: boolean;
		cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.name = "ProviderRequestError";
		this.provider = input.provider;
		this.operation = input.operation;
		this.requestId = input.requestId;
		this.statusCode = input.statusCode;
		this.retryable = input.retryable;
		this.responseInvalid = input.responseInvalid === true;
	}
}
