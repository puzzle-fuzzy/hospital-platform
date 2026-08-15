export type AdapterName =
	| "zhongyang"
	| "hospital-his"
	| "medical-insurance"
	| "legacy-fsi"
	| "wechat-pay"
	| "yunhealth"
	| "ai";

export type AdapterContext = {
	traceId: string;
	idempotencyKey: string;
};

export class AdapterNotConfiguredError extends Error {
	readonly adapter: AdapterName;

	constructor(adapter: AdapterName) {
		super(`Adapter is not configured: ${adapter}`);
		this.name = "AdapterNotConfiguredError";
		this.adapter = adapter;
	}
}
