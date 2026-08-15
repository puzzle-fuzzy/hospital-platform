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
