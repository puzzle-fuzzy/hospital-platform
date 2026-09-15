export type QueryMode =
	| "identity-card"
	| "electronic-credential"
	| "social-security-card";

export type LoginValues = {
	username: string;
	password: string;
	captcha?: string;
};

export type QueryValues = {
	mode: QueryMode;
	name: string;
	identityNumber: string;
	credentialNumber?: string;
	cardSerialNumber?: string;
	expectedPsnNo?: string;
};

export type CaptchaState = {
	enabled: boolean;
	key: string;
	image: string;
};

export type Session = {
	accessToken: string;
	refreshToken: string;
	tokenType: string;
	expiresIn: number;
	username: string;
};

export type ProviderRecord = Record<string, unknown>;

export type InsuranceRecord = {
	key: string;
	index: number;
	psnNo: string;
	insuranceType: string;
	balance: string;
	status: string;
	insuredArea: string;
	employerName: string;
	personType: string;
	raw: ProviderRecord;
};

export type Normalized1101Result = {
	baseInfo: ProviderRecord;
	insuranceRecords: InsuranceRecord[];
	identityRecords: ProviderRecord[];
	raw: unknown;
};

export type AdminLogLevel = "debug" | "info" | "warn" | "error";

export type AdminLogRecord = {
	id: string;
	timestamp: string;
	level: AdminLogLevel;
	source: "process" | "database";
	service: string;
	environment: string;
	event?: string;
	method?: string;
	path?: string;
	statusCode?: number;
	durationMs?: number;
	requestId?: string;
	traceId?: string;
	errorName?: string;
	errorCode?: string;
	dependency?: string;
	provider?: string;
	providerOperation?: string;
	providerRequestId?: string;
	providerStatusCode?: number;
	providerFailureStage?: string;
	providerRequestOutcome?: string;
	providerRetryable?: boolean;
	providerErrorCode?: string;
	providerErrorMessageLength?: number;
	providerErrorMessageSha256?: string;
	providerTransportErrorCode?: string;
	providerResponseBusinessSuccess?: boolean;
	providerResponseCode?: string;
	providerResponseBodyByteLength?: number;
	providerResponseBodySha256?: string;
	providerResponseMessageLength?: number;
	persistenceOperation?: string;
	parameterVisibility: "not-recorded";
};

export type AdminLogPage = {
	items: AdminLogRecord[];
	total: number;
	page: number;
	pageSize: number;
	source: "process" | "database";
	parameterPolicy: "safe-metadata-only";
};

export type AdminLogQuery = {
	page?: number;
	pageSize?: number;
	level?: AdminLogLevel;
	event?: string;
	path?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	providerOperation?: string;
	service?: string;
	startTime?: string;
	endTime?: string;
};
