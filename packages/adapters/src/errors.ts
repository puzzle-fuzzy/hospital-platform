import type { AdapterName } from "./context";

export class AdapterNotConfiguredError extends Error {
	readonly adapter: AdapterName;

	constructor(adapter: AdapterName) {
		super(`Adapter is not configured: ${adapter}`);
		this.name = "AdapterNotConfiguredError";
		this.adapter = adapter;
	}
}

export class ProviderRequestError extends Error {
	readonly provider: AdapterName;
	readonly operation: string;
	readonly statusCode: number | undefined;
	readonly retryable: boolean;

	constructor(input: {
		provider: AdapterName;
		operation: string;
		message: string;
		statusCode?: number;
		retryable: boolean;
		cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.name = "ProviderRequestError";
		this.provider = input.provider;
		this.operation = input.operation;
		this.statusCode = input.statusCode;
		this.retryable = input.retryable;
	}
}
