export type LoginValues = {
	loginMode?: "operator" | "viewer";
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
	capabilities?: { readOnly: boolean };
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

export type AdminMedicalInsuranceRefund = {
	orderId: string;
	refundNo: string;
	status: "requested" | "processing" | "succeeded" | "failed" | "manual_review";
	medicalStatus:
		| "not_required"
		| "requested"
		| "processing"
		| "success"
		| "failed"
		| "unknown";
	wechatStatus:
		| "not_required"
		| "requested"
		| "processing"
		| "success"
		| "failed"
		| "unknown";
	amounts: {
		totalFen: number;
		cashFen: number;
		personalAccountFen: number;
		fundFen: number;
	};
};

export type AdminPaymentRefundType = "ALL" | "HI" | "CASH";

export type AdminPaymentRefundOption = {
	enabled: boolean;
	amountFen: number;
	reason?: string;
};

export type RegistrationRefundStage =
	| "wechat_refund_pending"
	| "hospital_writeback_pending"
	| "appointment_cancellation_pending"
	| "appointment_cancelled_writeback_pending"
	| "completed";

export type AdminPaymentRefundResult = {
	source: WechatRefundSource;
	orderId: string;
	refundType: AdminPaymentRefundType;
	status: AdminMedicalInsuranceRefund["status"];
	amounts: AdminMedicalInsuranceRefund["amounts"];
	medicalRefund?: AdminMedicalInsuranceRefund;
	wechatRefund?: WechatRefund;
	registrationRefundStage?: RegistrationRefundStage;
	registrationCancellationPending?: boolean;
	registrationCancellationConfirmed?: boolean;
	hospitalWritebackPending?: boolean;
};

export type AdminPaymentDisplayAmounts = {
	actualCashFen: number | null;
	hospitalDiscountFen: number | null;
	actualPaidFen: number | null;
	amountBreakdownStatus: "confirmed" | "unverified";
};

/** 管理端历史支付读模型；身份证号仅属于已关联就诊人，不含凭证或支付调起参数。 */
export type AdminWechatRefundPaymentRecord = AdminPaymentDisplayAmounts & {
	source: WechatRefundSource;
	orderId: string;
	operationAggregateId?: string;
	business: "registration" | "outpatient" | "other";
	registration?: AdminRegistrationStatus;
	patientDisplayName?: string;
	patientIdentityNumber?: string;
	orderUserDisplayName?: string;
	totalFen: number;
	insuranceFen?: number;
	paymentState: string;
	cashPaymentConfirmed: boolean;
	cashFen: number;
	medicalRefundableFen?: number;
	/** 兼容旧版读模型；缺少退款能力时界面禁止发起新退款。 */
	refundOptions?: Record<AdminPaymentRefundType, AdminPaymentRefundOption>;
	personalAccountFen?: number;
	fundFen?: number;
	otherPaymentFen?: number;
	hospitalPartFen?: number;
	personalAccountMutualAidFen?: number;
	personalAccountSelfFen?: number;
	depositFen?: number;
	deliveryFeeFen?: number;
	medicalStatus?: string;
	ordStas?: string | null;
	wechatPaymentState?: string;
	refundReservedFen: number;
	refundableFen: number;
	refundCount: number;
	latestRefund?: {
		merchantRefundNo: string;
		status: WechatRefund["status"];
		refundFen: number;
		updatedAt: string;
	};
	latestMedicalRefund?: {
		refundNo: string;
		status:
			| "requested"
			| "processing"
			| "succeeded"
			| "failed"
			| "manual_review";
		medicalStatus: string;
		wechatStatus: string;
		totalFen: number;
		updatedAt: string;
	};
	refundRoute: "admin" | "appointment_cancel" | "unavailable";
	createdAt: string;
	updatedAt: string;
};

export type AdminRegistrationStatus = {
	appointmentId: string | null;
	localStatus: "booked" | "cancelled" | "expired" | "unknown" | "not_found";
	hospitalStatus:
		| "scheduled"
		| "cancelled"
		| "expired"
		| "completed"
		| "missed"
		| "stopped"
		| "substituted"
		| "registered"
		| "unknown"
		| "not_checked"
		| "unavailable";
	hospitalPaymentStatus: "pending" | "paid" | "unavailable";
	checkedAt: string | null;
	departmentName?: string;
	doctorName?: string;
	workDate?: string;
	shiftName?: string;
	sourceSerialNumber?: string;
	cancellation: {
		allowed: boolean;
		mode: "cancel_only" | "unavailable";
		reason: string;
	};
};

export type AdminRegistrationResult = {
	source: WechatRefundSource;
	orderId: string;
	registration: AdminRegistrationStatus;
};

export type AdminRegistrationCancelResult = AdminRegistrationResult & {
	outcome: "cancelled" | "already_cancelled";
};

export type AdminWechatRefundPaymentHistoryQuery = {
	source?: WechatRefundSource;
	business?: "registration" | "outpatient" | "other";
	businessDay?: string;
	status?: "created" | "pending" | "paid" | "failed" | "manual_review";
	orderId?: string;
	participantName?: string;
	identityNumber?: string;
	page?: number;
	pageSize?: number;
	limit?: number;
};

export type AdminWechatRefundPaymentHistoryPage = {
	items: readonly AdminWechatRefundPaymentRecord[];
	total: number;
	page: number;
	pageSize: number;
};

export type AdminPaymentSyncTaskStatus =
	| "pending"
	| "in_progress"
	| "succeeded"
	| "failed"
	| "manual_review";

export type AdminPaymentSyncTask = {
	taskId: string;
	aggregateId: string;
	businessKey: string;
	source: "his" | "medical_insurance" | "wechat_pay";
	kind: "pull" | "reconcile" | "writeback";
	status: AdminPaymentSyncTaskStatus;
	attempts: number;
	maxAttempts: number;
	nextRunAt: string;
	claimedUntil: string | null;
	lastErrorCode: string | null;
	resultDigest: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type AdminPaymentOperationDetail = {
	aggregate: AdminPaymentDisplayAmounts & {
		aggregateId: string;
		business: "registration" | "outpatient" | "other";
		businessKey: string;
		businessId: string;
		totalFen: number;
		insuranceFen: number;
		cashFen: number;
		status: string;
		hisSyncStatus: string;
		sourceVersion: number;
		version: number;
		createdAt: string;
		updatedAt: string;
	};
	legs: readonly {
		legId: string;
		aggregateId: string;
		legType:
			| "medical_insurance"
			| "wechat_cash"
			| "hospital_reduce"
			| "hospital_part"
			| "unallocated";
		source: "payment_order" | "medical_insurance" | "wechat_pay" | "platform";
		sourceOrderId: string;
		amountFen: number;
		status: string;
		providerReferenceDigest?: string;
		confirmedAt?: string;
		version: number;
		createdAt: string;
		updatedAt: string;
	}[];
	events: readonly {
		eventId: string;
		aggregateId: string;
		legId?: string;
		source: "payment_order" | "medical_insurance" | "wechat_pay" | "platform";
		eventType: string;
		previousStatus?: string;
		nextStatus: string;
		amountFen?: number;
		providerRequestId?: string;
		idempotencyKey: string;
		eventAt: string;
		payloadDigest: string;
	}[];
};
