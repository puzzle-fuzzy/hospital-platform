import type { AdapterCallContext } from "@hospital/domain";

export type AdapterName =
	| "zhongyang"
	| "hospital-his"
	| "medical-insurance"
	| "legacy-fsi"
	| "wechat-identity"
	| "wechat-pay"
	| "yunhealth"
	| "ai";

export type AdapterContext = AdapterCallContext;
