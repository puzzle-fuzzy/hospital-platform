import type { AdapterCallContext } from "@hospital/domain";

export type AdapterName =
	| "zhongyang"
	| "hospital-his"
	| "medical-insurance"
	| "legacy-fsi"
	| "wechat-pay"
	| "yunhealth"
	| "ai";

export type AdapterContext = AdapterCallContext;
