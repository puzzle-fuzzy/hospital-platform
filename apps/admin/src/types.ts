export type LoginValues = {
	username: string;
	password: string;
	captcha?: string;
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

export type RawLogEntry = {
	timestamp: string;
	unit: string;
	event: string;
	direction: "request" | "response";
	provider?: string;
	operation?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	method?: string;
	statusCode?: number;
	url?: string;
	headersText?: string;
	bodyEncoding: "plain" | "json-string-v1";
	chunkCount: number;
	complete: boolean;
	missingChunkIndexes?: number[];
	integrity?: {
		expectedByteLength?: number;
		actualByteLength?: number;
		expectedSha256?: string;
		actualSha256?: string;
	};
	bodyText?: string;
	error?: string;
};

export type RawLogTrace = {
	entries: RawLogEntry[];
	total: number;
	truncated: boolean;
	maxEntries: number;
	identifiers: string[];
	since: string;
	until: string;
	matchedJournalRecords: number;
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

export type PaymentBoundary = "before-day" | "within-day" | "after-day";

export type PaymentStatus =
	| "CANCELLED"
	| "MANUAL_REVIEW_REQUIRED"
	| "PROVIDER_COMPLETED"
	| "OBSERVED"
	| "INCOMPLETE";

export type PaymentInterfaceSummary = {
	id: string;
	ordinal: number;
	operation?: string;
	displayOperation: string;
	invocationIndex: number;
	timestamp: string;
	traceId?: string;
	providerRequestId?: string;
	statusCode?: number;
	complete: boolean;
	attribution: "correlation" | "timeline";
	boundary: PaymentBoundary;
};

export type PaymentFlowSummary = {
	id: string;
	orderId: string;
	appointmentId?: string;
	startedAt: string;
	status: PaymentStatus;
	interfaceCount: number;
	completeInterfaceCount: number;
	hasBoundaryCrossing: boolean;
	attributionWarningCount: number;
	interfaces: PaymentInterfaceSummary[];
};

export type PaymentDayResult = {
	date: string;
	timezone: "Asia/Shanghai";
	window: {
		start: string;
		endExclusive: string;
		readSince: string;
		readUntil: string;
		boundaryBufferMinutes: number;
	};
	orders: PaymentFlowSummary[];
	parsedRecords: number;
	unmatchedPaymentEventCount: number;
};

export type PaymentInterfaceDetail = {
	flowId: string;
	orderId: string;
	appointmentId?: string;
	startedAt: string;
	status: PaymentStatus;
	interface: PaymentInterfaceSummary;
	request?: RawLogEntry;
	response?: RawLogEntry;
};

export type WechatRefundSource = "payment_order" | "medical_insurance";

export type WechatRefund = {
	refundRecordId: string;
	merchantRefundNo: string;
	source: WechatRefundSource;
	sourceOrderId: string;
	outTradeNo: string;
	totalFen: number;
	refundFen: number;
	reason: string | null;
	idempotencyKey: string;
	status:
		| "requested"
		| "processing"
		| "success"
		| "closed"
		| "abnormal"
		| "unknown"
		| "request_failed";
	providerStatus: "SUCCESS" | "CLOSED" | "PROCESSING" | "ABNORMAL" | null;
	providerRefundId: string | null;
	providerTransactionId: string | null;
	providerRequestId: string | null;
	successTime: string | null;
	lastErrorCode: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};
