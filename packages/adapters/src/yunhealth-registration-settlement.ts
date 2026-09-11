import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	HospitalSettlementGateway,
	PaymentOrderSnapshot,
	RegistrationSelfPayPreparationGateway,
	RegistrationSelfPaySettlementContext,
	YunhealthMiniProgramPayParams,
	YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import {
	type ProviderFetcher,
	type ProviderRequestLogger,
	providerRawLoggingEnabled,
	requestJson,
} from "./http";

const COMPLETE_SETTLE_PATH =
	"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle";
const APPLY_SETTLE_PATH =
	"/msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle";
const SETTLE_DETAILS_PATH = "/msun-yb-app-miop/v1/out-insur-settle-infos";
const THIRD_PART_OPERATION = "yunhealth-registration.validation";
const COMPLETE_SETTLE_OPERATION = "registration-self-pay.2.6.65.5";
const ALLOWED_PAY_TYPES = new Set(["CREDIT", "POS", "CROWD_FUNDING"]);
/** 纯自费和医保混合现金腿通过微信支付时，2.6.65.2 固定使用该支付方式。 */
const SELF_PAY_WECHAT_PAY_TYPE_ID = 31;
/** 6202 返回有个人账户实际支付金额时使用的支付方式。 */
const PERSONAL_ACCOUNT_PAY_TYPE_ID = 5;
/** 已创建的历史支付流水仍需按原支付方式完成 HIS 回写，不能中途改号。 */
const LEGACY_PAYMENT_TYPE_IDS = [3, 50, 5027] as const;

export type YunhealthRegistrationPluginPayType =
	| "CREDIT"
	| "POS"
	| "CROWD_FUNDING";

export type YunhealthRegistrationSettlementGatewayOptions = {
	/** 云健康/众阳共享上游地址，必须是 HTTPS 且只来自服务端配置。 */
	baseUrl: string;
	/** 不得从小程序请求传入；支持原始 token 或完整 Bearer 值。旧服务允许为空。 */
	authorizationToken?: string;
	/** 仅兼容旧配置；非 HIS 收款 .2/.5/.9 不使用 2.6.65.15 的 orgId。 */
	paymentOrgId?: string;
	/** 2.6.65.1 / 2.27.2.27 使用的医院 ID。 */
	hospitalId?: string;
	/** 医保自费混合插件的 payTypeId，必须是正整数文本。 */
	pluginPayTypeId: string;
	pluginPayType: YunhealthRegistrationPluginPayType;
	/** 众阳收款工作站号；当前合同允许为空字符串。 */
	workStationId: string;
	paymentSource?: string;
	authSysCode?: string;
	tradeTypeCode?: string;
	/** 用于拒绝 Provider 返回其他小程序的收银台参数。 */
	miniProgramAppId?: string;
	logger?: ProviderRequestLogger;
	fetcher?: ProviderFetcher;
};

type ProviderEnvelope = {
	success?: unknown;
	code?: unknown;
	data?: unknown;
};

type NormalizedContext = {
	businessId: string;
	hospitalId: number;
	patientId: string;
	certNo: string;
	psnCertType: string;
	psnName: string;
	psnNo: string;
	patInHosId: number;
	payingId: string;
	tradingId: string;
};

function providerError(
	operation: string,
	message: string,
	input: {
		requestId?: string;
		failureStage?: "validation" | "response";
		responseInvalid?: boolean;
		requestOutcome?: "not_sent" | "rejected" | "unknown";
		providerErrorCode?: string;
		providerErrorMessage?: string;
	} = {},
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "yunhealth",
		operation,
		message,
		retryable: false,
		...(input.failureStage ? { failureStage: input.failureStage } : {}),
		...(input.responseInvalid ? { responseInvalid: true } : {}),
		...(input.requestOutcome ? { requestOutcome: input.requestOutcome } : {}),
		...(input.requestId ? { requestId: input.requestId } : {}),
		...(input.providerErrorCode
			? { providerErrorCode: input.providerErrorCode }
			: {}),
		...(input.providerErrorMessage
			? { providerErrorMessage: input.providerErrorMessage }
			: {}),
	});
}

function textAllowEmpty(
	value: unknown,
	label: string,
	maxLength = 256,
): string {
	if (typeof value !== "string") {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	const normalized = value.trim();
	if (
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code < 0x20 || code === 0x7f;
		})
	) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	return normalized;
}

function requiredText(value: unknown, label: string, maxLength = 256): string {
	const normalized = textAllowEmpty(value, label, maxLength);
	if (!normalized) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	return normalized;
}

function positiveInteger(value: unknown, label: string): number {
	const normalized =
		typeof value === "number"
			? Number.isSafeInteger(value) && value > 0
				? String(value)
				: ""
			: typeof value === "string"
				? value.trim()
				: "";
	if (!/^\d+$/u.test(normalized)) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	const parsed = Number(normalized);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
	const normalized =
		typeof value === "number"
			? Number.isSafeInteger(value) && value >= 0
				? String(value)
				: ""
			: typeof value === "string"
				? value.trim()
				: "";
	if (!/^\d+$/u.test(normalized)) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	const parsed = Number(normalized);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	return parsed;
}

/** Provider 的雪花 ID 会超过 JS safe integer，必须按十进制字符串透传。 */
function positiveIntegerText(value: unknown, label: string): string {
	const normalized =
		typeof value === "number"
			? Number.isSafeInteger(value) && value > 0
				? String(value)
				: ""
			: typeof value === "string"
				? value.trim()
				: "";
	if (!/^[1-9]\d{0,31}$/u.test(normalized)) {
		throw providerError(THIRD_PART_OPERATION, `${label} is invalid`, {
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
	}
	return normalized;
}

function normalizedAuthorization(
	value: string | undefined,
): string | undefined {
	const token = value?.trim();
	if (!token) return undefined;
	return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

function providerUrl(baseUrl: string, path: string): string {
	const normalized = requiredText(baseUrl, "baseUrl");
	let url: URL;
	try {
		url = new URL(normalized);
	} catch {
		throw new AdapterNotConfiguredError("yunhealth");
	}
	if (url.protocol !== "https:")
		throw new AdapterNotConfiguredError("yunhealth");
	return `${url.toString().replace(/\/$/u, "")}${path}`;
}

function stableRecordCode(orderId: string): string {
	return createHash("sha256").update(orderId).digest("hex").slice(0, 32);
}

function stableStepIdempotencyKey(step: string, orderId: string): string {
	const digest = createHash("sha256")
		.update(`${step}:${orderId}`)
		.digest("hex")
		.slice(0, 40);
	return `registration-self-pay-${step}:${digest}`;
}

function responseData(value: unknown): Record<string, unknown> {
	let current = value;
	for (let depth = 0; depth < 4; depth += 1) {
		if (
			typeof current !== "object" ||
			current === null ||
			Array.isArray(current)
		) {
			return {};
		}
		const record = current as ProviderEnvelope;
		if (
			typeof record.data === "object" &&
			record.data !== null &&
			!Array.isArray(record.data)
		) {
			current = record.data;
			continue;
		}
		return current as Record<string, unknown>;
	}
	return {};
}

function nestedValue(
	value: unknown,
	keys: readonly string[],
	depth = 0,
): unknown {
	if (depth > 8 || typeof value !== "object" || value === null)
		return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = nestedValue(item, keys, depth + 1);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	const record = value as Record<string, unknown>;
	for (const key of keys) {
		const candidate = record[key];
		if (
			candidate !== undefined &&
			candidate !== null &&
			candidate !== "" &&
			typeof candidate !== "object"
		) {
			return candidate;
		}
	}
	for (const child of Object.values(record)) {
		const found = nestedValue(child, keys, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

function yunhealthMiniProgramPayParams(
	value: unknown,
	input: {
		operation: string;
		requestId: string;
		expectedAppId?: string;
	},
): YunhealthMiniProgramPayParams | undefined {
	const raw = responseData(value).result;
	if (raw === undefined || raw === null || raw === "") return undefined;
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			throw providerError(
				input.operation,
				"Yunhealth mini-program payment result is not valid JSON",
				{
					requestId: input.requestId,
					failureStage: "response",
					responseInvalid: true,
					requestOutcome: "unknown",
				},
			);
		}
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw providerError(
			input.operation,
			"Yunhealth mini-program payment result is invalid",
			{
				requestId: input.requestId,
				failureStage: "response",
				responseInvalid: true,
				requestOutcome: "unknown",
			},
		);
	}
	const result = parsed as Record<string, unknown>;
	const appId = providerScalarText(result.appId, 64);
	const timeStamp = providerScalarText(result.timeStamp, 10);
	const nonceStr = providerScalarText(result.nonceStr, 32);
	const packageValue = providerScalarText(result.package, 128);
	const signType = providerScalarText(result.signType, 32);
	const paySign = providerScalarText(result.sign, 32);
	if (
		!appId ||
		(input.expectedAppId !== undefined && appId !== input.expectedAppId) ||
		!timeStamp ||
		!/^\d{10}$/u.test(timeStamp) ||
		!nonceStr ||
		!packageValue ||
		!/^prepay_id=\S+$/u.test(packageValue) ||
		signType !== "MD5" ||
		!paySign ||
		!/^[A-Fa-f0-9]{32}$/u.test(paySign)
	) {
		throw providerError(
			input.operation,
			"Yunhealth mini-program payment parameters are invalid",
			{
				requestId: input.requestId,
				failureStage: "response",
				responseInvalid: true,
				requestOutcome: "unknown",
			},
		);
	}
	return {
		appId,
		timeStamp,
		nonceStr,
		package: packageValue,
		signType: "MD5",
		paySign,
	};
}

function requireProviderSuccess(
	value: unknown,
	operation: string,
	requestId: string,
	diagnostics: {
		logger?: ProviderRequestLogger;
		traceId?: string;
		statusCode?: number;
		rawBodyText?: string;
	} = {},
): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(operation, "Yunhealth response is invalid", {
			requestId,
			failureStage: "response",
			responseInvalid: true,
			requestOutcome: "unknown",
		});
	}
	const root = value as ProviderEnvelope;
	const data = responseData(value);
	for (const candidate of [root, data]) {
		if (candidate.success === false) {
			const providerErrorCode = providerScalarText(candidate.code, 128);
			diagnostics.logger?.warn(
				{
					event: "provider.response.business_rejected",
					provider: "yunhealth",
					operation,
					...(diagnostics.traceId ? { traceId: diagnostics.traceId } : {}),
					providerRequestId: requestId,
					...(diagnostics.statusCode !== undefined
						? { providerStatusCode: diagnostics.statusCode }
						: {}),
					providerResponseBusinessSuccess: false,
					...(providerErrorCode ? { providerErrorCode } : {}),
					...(diagnostics.rawBodyText !== undefined &&
					providerRawLoggingEnabled()
						? {
								providerResponseBodyText: diagnostics.rawBodyText,
								providerResponseBodyByteLength: new TextEncoder().encode(
									diagnostics.rawBodyText,
								).byteLength,
								providerResponseBodySha256: createHash("sha256")
									.update(diagnostics.rawBodyText)
									.digest("hex"),
							}
						: {}),
				},
				"Yunhealth business response rejected",
			);
			throw providerError(operation, "Yunhealth rejected the request", {
				requestId,
				failureStage: "response",
				requestOutcome: "rejected",
				...(providerErrorCode ? { providerErrorCode } : {}),
			});
		}
	}
	if ([root, data].some((candidate) => candidate.success === true)) return;
	if (
		[root, data].some((candidate) =>
			["0", "200", "0000"].includes(String(candidate.code ?? "")),
		)
	) {
		return;
	}
	throw providerError(operation, "Yunhealth success result is unknown", {
		requestId,
		failureStage: "response",
		responseInvalid: true,
		requestOutcome: "unknown",
	});
}

function providerScalarText(
	value: unknown,
	maxLength: number,
): string | undefined {
	const candidate =
		typeof value === "string"
			? value
			: typeof value === "number" && Number.isFinite(value)
				? String(value)
				: undefined;
	if (candidate === undefined) return undefined;
	if (
		[...candidate].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127;
		})
	) {
		return undefined;
	}
	const normalized = candidate.trim();
	return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function requireYunhealthSuccess(
	response: {
		data: unknown;
		requestId: string;
		statusCode: number;
		rawBodyText?: string;
	},
	operation: string,
	context: AdapterCallContext,
	logger?: ProviderRequestLogger,
): void {
	requireProviderSuccess(response.data, operation, response.requestId, {
		...(logger ? { logger } : {}),
		traceId: context.traceId,
		statusCode: response.statusCode,
		...(response.rawBodyText !== undefined
			? { rawBodyText: response.rawBodyText }
			: {}),
	});
}

function normalizeContext(
	value: RegistrationSelfPaySettlementContext | undefined,
): NormalizedContext {
	if (!value) {
		throw providerError(
			THIRD_PART_OPERATION,
			"Registration settlement context is missing",
			{
				failureStage: "validation",
				requestOutcome: "not_sent",
			},
		);
	}
	const businessId = requiredText(value.businessId, "businessId");
	return {
		businessId,
		hospitalId: positiveInteger(value.hospitalId, "hospitalId"),
		patientId: positiveIntegerText(value.patientId, "patientId"),
		certNo: requiredText(value.certNo, "certNo"),
		psnCertType: requiredText(value.psnCertType, "psnCertType"),
		psnName: requiredText(value.psnName, "psnName"),
		psnNo: requiredText(value.psnNo, "psnNo"),
		patInHosId: nonNegativeInteger(value.patInHosId, "patInHosId"),
		payingId: positiveIntegerText(value.payingId, "payingId"),
		tradingId: positiveIntegerText(value.tradingId, "tradingId"),
	};
}

function validatePureCashSettlement(input: PaymentOrderSnapshot): number {
	if (
		input.state !== "cash_paid" ||
		!Number.isSafeInteger(input.totalFen) ||
		!Number.isSafeInteger(input.insuranceFen) ||
		!Number.isSafeInteger(input.cashFen) ||
		input.cashFen <= 0 ||
		input.insuranceFen !== 0 ||
		input.totalFen !== input.cashFen
	) {
		throw providerError(
			THIRD_PART_OPERATION,
			"Registration settlement amount is not pure self-pay",
			{
				failureStage: "validation",
				requestOutcome: "not_sent",
			},
		);
	}
	return Number((input.cashFen / 100).toFixed(2));
}

function settleFlag(value: unknown): boolean {
	return String(value ?? "").trim() === "1";
}

export function createYunhealthRegistrationSettlementGateway(
	options: YunhealthRegistrationSettlementGatewayOptions,
): HospitalSettlementGateway {
	const baseUrl = requiredText(options.baseUrl, "baseUrl");
	const providerBaseUrl = providerUrl(baseUrl, "");
	const authorization = normalizedAuthorization(options.authorizationToken);
	positiveInteger(options.pluginPayTypeId, "pluginPayTypeId");
	const pluginPayType = requiredText(
		options.pluginPayType,
		"pluginPayType",
	) as YunhealthRegistrationPluginPayType;
	if (!ALLOWED_PAY_TYPES.has(pluginPayType))
		throw new AdapterNotConfiguredError("yunhealth");
	const workStationId = textAllowEmpty(options.workStationId, "workStationId");
	const authSysCode = requiredText(
		options.authSysCode ?? "thirdSelfMachine",
		"authSysCode",
	);
	const tradeTypeCode = requiredText(
		options.tradeTypeCode ?? "10",
		"tradeTypeCode",
	);
	const fetcher = options.fetcher ?? fetch;

	return {
		async writeBack(
			input,
			context: AdapterCallContext,
		): Promise<ExternalTrace> {
			const normalizedContext = normalizeContext(input.registrationContext);
			const orderId = requiredText(input.orderId, "orderId", 128);
			if (input.settlement.orderId !== orderId) {
				throw providerError(
					THIRD_PART_OPERATION,
					"Registration settlement order id does not match the payment order",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			validatePureCashSettlement(input.settlement);
			const registrationContext = input.registrationContext;
			const outTradeNo = registrationContext?.outTradeNo
				? requiredText(registrationContext.outTradeNo, "outTradeNo", 64)
				: orderId;
			const recordCode = requiredText(
				registrationContext?.recordCode,
				"recordCode",
				32,
			);
			if (!/^[A-Za-z0-9]{32}$/u.test(recordCode)) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"recordCode is invalid",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			const requestWorkStationId =
				registrationContext?.workStationId !== undefined
					? textAllowEmpty(registrationContext.workStationId, "workStationId")
					: workStationId;
			if (requestWorkStationId !== workStationId) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"stored plugin workStationId does not match server configuration",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			const requestIds: string[] = [];
			const request = async <T>(
				step: string,
				operation: string,
				path: string,
				body: unknown,
				captureRawBody = false,
			) => {
				const response = await requestJson<T>(
					{
						provider: "yunhealth",
						operation,
						url: `${providerBaseUrl}${path}`,
						method: "POST",
						context: {
							...context,
							idempotencyKey: stableStepIdempotencyKey(step, outTradeNo),
						},
						...(authorization
							? { headers: { Authorization: authorization } }
							: {}),
						body,
						...(captureRawBody || providerRawLoggingEnabled()
							? { captureRawBody: true }
							: {}),
						...(options.logger ? { logger: options.logger } : {}),
					},
					fetcher,
				);
				requestIds.push(response.requestId);
				return response;
			};
			const complete = await request<unknown>(
				"2.6.65.5",
				COMPLETE_SETTLE_OPERATION,
				COMPLETE_SETTLE_PATH,
				{
					appCode: "WeChatSmallProg",
					authSysCode,
					autoSettle: 2,
					businessId: normalizedContext.businessId,
					hospitalId: normalizedContext.hospitalId,
					sceneCode: "WeChatSmallProgram",
					thirdFlag: 1,
					tradeTypeCode,
					workStationId: requestWorkStationId,
				},
			);
			requireYunhealthSuccess(
				complete,
				COMPLETE_SETTLE_OPERATION,
				context,
				options.logger,
			);
			if (!settleFlag(responseData(complete.data).isSettle)) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"Yunhealth final settlement was not confirmed",
					{
						requestId: complete.requestId,
						failureStage: "response",
						responseInvalid: true,
						requestOutcome: "unknown",
					},
				);
			}

			return {
				provider: "yunhealth",
				operation: COMPLETE_SETTLE_OPERATION,
				requestId: complete.requestId,
				requestIds,
				providerOrderId: normalizedContext.businessId,
			};
		},
	};
}

function providerRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function providerText(
	record: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value !== "string" && typeof value !== "number") continue;
		const normalized = String(value).trim();
		if (normalized) return normalized;
	}
	return undefined;
}

function providerAmount(
	record: Record<string, unknown>,
	keys: readonly string[],
): number | undefined {
	const value = providerText(record, keys);
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stableNumericRequestId(value: string): number {
	const id = Number.parseInt(
		createHash("sha256").update(value).digest("hex").slice(0, 12),
		16,
	);
	return id > 0 ? id : 1;
}

/**
 * 普通挂号自费的众阳前置流程。
 *
 * 旧服务在第二次 `.2` 前调用只读的 `.27` 获取门诊结算信息；`.27`
 * 未确认成功或没有真实费用明细时立即停止，绝不会创建云健康 `.2`
 * 或微信 APIv3 订单。`.32` 只保留给医保结算结果回写链路。
 */
export function createYunhealthRegistrationSelfPayPreparationGateway(
	options: YunhealthRegistrationSettlementGatewayOptions,
): RegistrationSelfPayPreparationGateway {
	const baseUrl = requiredText(options.baseUrl, "baseUrl");
	const providerBaseUrl = providerUrl(baseUrl, "");
	const authorization = normalizedAuthorization(options.authorizationToken);
	const hospitalId = positiveInteger(options.hospitalId, "hospitalId");
	const selfPayPayTypeId = SELF_PAY_WECHAT_PAY_TYPE_ID;
	const pluginPayType = requiredText(
		options.pluginPayType,
		"pluginPayType",
	) as YunhealthRegistrationPluginPayType;
	if (!ALLOWED_PAY_TYPES.has(pluginPayType))
		throw new AdapterNotConfiguredError("yunhealth");
	const workStationId = textAllowEmpty(options.workStationId, "workStationId");
	const authSysCode = requiredText(
		options.authSysCode ?? "thirdSelfMachine",
		"authSysCode",
	);
	const tradeTypeCode = requiredText(
		options.tradeTypeCode ?? "10",
		"tradeTypeCode",
	);
	const fetcher = options.fetcher ?? fetch;
	const pluginGateway = createYunhealthRegistrationPluginPaymentGateway({
		...options,
		pluginPayTypeId: String(selfPayPayTypeId),
	});

	const request = async <T>(input: {
		step: string;
		operation: string;
		path: string;
		method?: "GET" | "POST";
		query?: Record<string, string | number>;
		body?: unknown;
		orderId: string;
		context: AdapterCallContext;
	}) => {
		const url = new URL(`${providerBaseUrl}${input.path}`);
		for (const [key, value] of Object.entries(input.query ?? {}))
			url.searchParams.set(key, String(value));
		return requestJson<T>(
			{
				provider: "yunhealth",
				operation: input.operation,
				url: url.toString(),
				method: input.method ?? "POST",
				context: {
					...input.context,
					idempotencyKey: stableStepIdempotencyKey(input.step, input.orderId),
				},
				...(authorization ? { headers: { Authorization: authorization } } : {}),
				...(input.body !== undefined ? { body: input.body } : {}),
				...(providerRawLoggingEnabled() ? { captureRawBody: true } : {}),
				...(options.logger ? { logger: options.logger } : {}),
			},
			fetcher,
		);
	};

	return {
		async prepare(input, context) {
			const orderId = requiredText(input.orderId, "orderId", 128);
			const totalFen = positiveInteger(input.totalFen, "totalFen");
			const providerRegisterId = positiveIntegerText(
				input.providerRegisterId,
				"providerRegisterId",
			);
			const providerPatientId = positiveIntegerText(
				input.providerPatientId,
				"providerPatientId",
			);
			const paymentSystemUserId = requiredText(
				input.paymentSystemUserId,
				"paymentSystemUserId",
				128,
			);
			const patientName = requiredText(input.patient.name, "patient.name", 64);
			const patientIdNo = requiredText(input.patient.idNo, "patient.idNo", 64);
			const patientCardNo = requiredText(
				input.patient.cardNo,
				"patient.cardNo",
				64,
			);
			const requestIds: string[] = [];

			const applyOperation = "registration-self-pay.2.6.65.1";
			const apply = await request<unknown>({
				step: "2.6.65.1",
				operation: applyOperation,
				path: APPLY_SETTLE_PATH,
				orderId,
				context,
				body: {
					authSysCode,
					appCode: "WeChatSmallProg",
					autoSettle: "2",
					hospitalId,
					patId: providerPatientId,
					requestId: stableNumericRequestId(`2.6.65.1:${orderId}`),
					requestParam: {
						registerId: providerRegisterId,
						registerSource: 15,
						settleWay: 6,
					},
					sceneCode: "WeChatSmallProgram",
					paySceneCode: "WeChatSmallProgram",
					tradeTypeCode,
					workStationId,
				},
			});
			requestIds.push(apply.requestId);
			requireYunhealthSuccess(apply, applyOperation, context, options.logger);
			const applyData = responseData(apply.data);
			const businessId = requiredText(
				providerText(applyData, ["businessId"]),
				"2.6.65.1 businessId",
			);
			const businessCode = requiredText(
				providerText(applyData, ["businessCode", "tradeCode"]),
				"2.6.65.1 businessCode",
			);
			const providerTotal = providerAmount(applyData, ["getAmount"]);
			if (
				providerTotal === undefined ||
				Math.round(providerTotal * 100) !== totalFen
			) {
				throw providerError(
					applyOperation,
					"2.6.65.1 amount does not match the appointment",
					{
						requestId: apply.requestId,
						failureStage: "response",
						requestOutcome: "rejected",
					},
				);
			}
			const settleDetailsOperation = "registration-self-pay.2.27.2.27";
			const settleDetails = await request<unknown>({
				step: "2.27.2.27",
				operation: settleDetailsOperation,
				path: SETTLE_DETAILS_PATH,
				method: "GET",
				query: {
					patId: providerPatientId,
					outSettleMainId: businessId,
				},
				orderId,
				context,
			});
			requestIds.push(settleDetails.requestId);
			requireYunhealthSuccess(
				settleDetails,
				settleDetailsOperation,
				context,
				options.logger,
			);
			const settleDetailsData = responseData(settleDetails.data);
			const settleMain = providerRecord(settleDetailsData.outNetworkSettleMain);
			const settleDetailList = Array.isArray(
				settleDetailsData.outSettleDetailList,
			)
				? settleDetailsData.outSettleDetailList
				: [];
			if (settleDetailList.length === 0) {
				throw providerError(
					settleDetailsOperation,
					"2.27.2.27 did not return fee details",
					{
						requestId: settleDetails.requestId,
						failureStage: "response",
						responseInvalid: true,
						requestOutcome: "unknown",
					},
				);
			}
			options.logger?.info(
				{
					event: "registration-self-pay.settlement-details.fetched",
					traceId: context.traceId,
					orderId,
					providerRequestId: settleDetails.requestId,
					businessId,
					patId: providerPatientId,
					detailCount: settleDetailList.length,
					hasOutNetworkSettleMain: Boolean(settleMain),
				},
				"Registration self-pay settlement details fetched",
			);

			const recordCode = stableRecordCode(`registration-self-pay:${orderId}`);
			const plugin = await pluginGateway.createPreOrder(
				{
					orderId,
					businessId,
					tradeCode: businessCode,
					totalFen,
					hospitalId: String(hospitalId),
					patientId: providerPatientId,
					payTypeId: String(selfPayPayTypeId),
					payModel: "MINI_PROGRAM",
					paymentSystemUserId,
					payType: pluginPayType,
					workStationId,
					recordCode,
					tradeTypeCode,
				},
				context,
			);
			requestIds.push(plugin.trace.requestId);
			if (!plugin.payParams) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"2.6.65.2 did not return mini-program payment parameters",
					{
						requestId: plugin.trace.requestId,
						failureStage: "response",
						responseInvalid: true,
						requestOutcome: "unknown",
					},
				);
			}

			return {
				registrationContext: {
					businessId,
					businessCode,
					payingId: plugin.payingId,
					tradingId: plugin.tradingId,
					hospitalId: String(hospitalId),
					patientId: providerPatientId,
					certNo: patientIdNo,
					psnCertType: "01",
					psnName: patientName,
					psnNo: patientCardNo,
					patInHosId: "0",
					outTradeNo: orderId,
					recordCode,
					payTypeId: plugin.payTypeId,
					payType: plugin.payType,
					workStationId: plugin.workStationId,
					payParams: plugin.payParams,
				},
				trace: {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.2.plugin",
					requestId: plugin.trace.requestId,
					requestIds,
					providerOrderId: businessId,
				},
			};
		},
	};
}

/**
 * 旧挂号医保混合支付的第二次 2.6.65.2 预下单。
 *
 * 这一步只创建云健康插件流水，不创建微信订单；调用方必须先把返回的
 * payingId/tradingId 连同 recordCode/outTradeNo 写入医保订单密文上下文，
 * 再调用普通微信 JSAPI 预下单。这样 Provider 两条支付流水不会被混用。
 */
export function createYunhealthRegistrationPluginPaymentGateway(
	options: YunhealthRegistrationSettlementGatewayOptions,
): YunhealthRegistrationPluginPaymentGateway {
	const baseUrl = requiredText(options.baseUrl, "baseUrl");
	const providerBaseUrl = providerUrl(baseUrl, "");
	const authorization = normalizedAuthorization(options.authorizationToken);
	const pluginPayTypeId = positiveInteger(
		options.pluginPayTypeId,
		"pluginPayTypeId",
	);
	if (pluginPayTypeId !== SELF_PAY_WECHAT_PAY_TYPE_ID)
		throw new AdapterNotConfiguredError("yunhealth");
	const pluginPayType = requiredText(
		options.pluginPayType,
		"pluginPayType",
	) as YunhealthRegistrationPluginPayType;
	if (!ALLOWED_PAY_TYPES.has(pluginPayType))
		throw new AdapterNotConfiguredError("yunhealth");
	const workStationId = textAllowEmpty(options.workStationId, "workStationId");
	const authSysCode = requiredText(
		options.authSysCode ?? "thirdSelfMachine",
		"authSysCode",
	);
	const tradeTypeCode = requiredText(
		options.tradeTypeCode ?? "10",
		"tradeTypeCode",
	);
	const fetcher = options.fetcher ?? fetch;
	const expectedAppId = options.miniProgramAppId
		? requiredText(options.miniProgramAppId, "miniProgramAppId", 64)
		: undefined;

	return {
		async createPreOrder(input, context) {
			const orderId = requiredText(input.orderId, "orderId", 128);
			const businessId = requiredText(input.businessId, "businessId");
			const tradeCode = requiredText(input.tradeCode, "tradeCode");
			const hospitalId = positiveInteger(input.hospitalId, "hospitalId");
			positiveIntegerText(input.patientId, "patientId");
			const totalFen = positiveInteger(input.totalFen, "totalFen");
			const amountFen = positiveInteger(
				input.amountFen ?? input.totalFen,
				"amountFen",
			);
			if (amountFen > totalFen) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"component amount exceeds settlement total",
					{ failureStage: "validation", requestOutcome: "not_sent" },
				);
			}
			const recordCode = requiredText(input.recordCode, "recordCode", 32);
			if (!/^[A-Za-z0-9]{32}$/u.test(recordCode)) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"recordCode is invalid",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			const requestPayTypeId = positiveInteger(input.payTypeId, "payTypeId");
			const payModel = input.payModel ?? "H5";
			const paymentSystemUserId =
				payModel === "MINI_PROGRAM"
					? requiredText(input.paymentSystemUserId, "paymentSystemUserId", 128)
					: "";
			const allowedComponent =
				(payModel === "H5" &&
					[
						2,
						PERSONAL_ACCOUNT_PAY_TYPE_ID,
						50,
						SELF_PAY_WECHAT_PAY_TYPE_ID,
						...LEGACY_PAYMENT_TYPE_IDS,
					].includes(requestPayTypeId)) ||
				(payModel === "MINI_PROGRAM" &&
					[SELF_PAY_WECHAT_PAY_TYPE_ID, 3, 5027].includes(requestPayTypeId));
			if (!allowedComponent) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"2.6.65.2 payModel and payTypeId combination is unsupported",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			if (
				input.payType !== pluginPayType ||
				input.workStationId !== workStationId
			) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"plugin payment configuration does not match server configuration",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			const operation = "registration-self-pay.2.6.65.2.plugin";
			const response = await requestJson<unknown>(
				{
					provider: "yunhealth",
					operation,
					url: `${providerBaseUrl}/msun-middle-open-settlepay/api/v2/open/payment/pre-order`,
					method: "POST",
					context: {
						...context,
						idempotencyKey: stableStepIdempotencyKey(
							"2.6.65.2-plugin",
							orderId,
						),
					},
					...(authorization
						? { headers: { Authorization: authorization } }
						: {}),
					body: {
						appCode: "WeChatSmallProg",
						authSysCode,
						autoSettle: 3,
						body: "自费支付",
						businessId,
						expire: 20,
						hospitalId,
						notifyUrl: "",
						payModel,
						payTypeId: requestPayTypeId,
						payTypeParams: [
							{
								payTypeId: requestPayTypeId,
								amount: Number((amountFen / 100).toFixed(2)),
								paymentSystemUserId,
								spbillCreateIp: "",
							},
						],
						paymentSystemUserId,
						recordCode,
						requestId: recordCode,
						sceneCode: "WeChatSmallProgram",
						spbillCreateIp: "",
						total: Number((totalFen / 100).toFixed(2)),
						tradeCode,
						tradeTypeCode,
						workStationId,
					},
					...(providerRawLoggingEnabled() ? { captureRawBody: true } : {}),
					...(options.logger ? { logger: options.logger } : {}),
				},
				fetcher,
			);
			requireYunhealthSuccess(response, operation, context, options.logger);
			const payParams = yunhealthMiniProgramPayParams(response.data, {
				operation,
				requestId: response.requestId,
				...(expectedAppId ? { expectedAppId } : {}),
			});
			const outTradeNo = payParams
				? providerScalarText(
						nestedValue(response.data, ["outTradeNo", "out_trade_no"]),
						32,
					)
				: undefined;
			if (
				payParams &&
				(!outTradeNo || !/^[A-Za-z0-9_\-*]+$/u.test(outTradeNo))
			) {
				throw providerError(
					operation,
					"Yunhealth mini-program payment outTradeNo is invalid",
					{
						requestId: response.requestId,
						failureStage: "response",
						responseInvalid: true,
						requestOutcome: "unknown",
					},
				);
			}
			const payingId = positiveIntegerText(
				nestedValue(response.data, ["payingId", "paying_id"]),
				"plugin payingId",
			);
			const tradingId = positiveIntegerText(
				nestedValue(response.data, ["tradingId", "trading_id"]),
				"plugin tradingId",
			);
			return {
				payingId,
				tradingId,
				payTypeId: String(requestPayTypeId),
				payType: pluginPayType,
				workStationId,
				tradeTypeCode,
				...(payParams && outTradeNo ? { payParams, outTradeNo } : {}),
				trace: {
					provider: "yunhealth",
					operation,
					requestId: response.requestId,
					providerOrderId: payingId,
				},
			};
		},
		async completeSettlement(input, context) {
			const businessId = requiredText(input.businessId, "businessId");
			const hospitalId = positiveInteger(input.hospitalId, "hospitalId");
			const requestWorkStationId = textAllowEmpty(
				input.workStationId,
				"workStationId",
			);
			if (requestWorkStationId !== workStationId) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"stored plugin workStationId does not match server configuration",
					{ failureStage: "validation", requestOutcome: "not_sent" },
				);
			}
			const requestTradeTypeCode = requiredText(
				input.tradeTypeCode,
				"tradeTypeCode",
			);
			if (requestTradeTypeCode !== tradeTypeCode) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"stored tradeTypeCode does not match server configuration",
					{ failureStage: "validation", requestOutcome: "not_sent" },
				);
			}
			const response = await requestJson<unknown>(
				{
					provider: "yunhealth",
					operation: COMPLETE_SETTLE_OPERATION,
					url: `${providerBaseUrl}${COMPLETE_SETTLE_PATH}`,
					method: "POST",
					context: {
						...context,
						idempotencyKey: stableStepIdempotencyKey("2.6.65.5", businessId),
					},
					...(authorization
						? { headers: { Authorization: authorization } }
						: {}),
					body: {
						appCode: "WeChatSmallProg",
						authSysCode,
						autoSettle: 2,
						businessId,
						hospitalId,
						sceneCode: "WeChatSmallProgram",
						thirdFlag: 1,
						tradeTypeCode: requestTradeTypeCode,
						workStationId: requestWorkStationId,
					},
					...(providerRawLoggingEnabled() ? { captureRawBody: true } : {}),
					...(options.logger ? { logger: options.logger } : {}),
				},
				fetcher,
			);
			requireYunhealthSuccess(
				response,
				COMPLETE_SETTLE_OPERATION,
				context,
				options.logger,
			);
			if (!settleFlag(responseData(response.data).isSettle)) {
				throw providerError(
					COMPLETE_SETTLE_OPERATION,
					"Yunhealth final settlement was not confirmed",
					{
						requestId: response.requestId,
						failureStage: "response",
						responseInvalid: true,
						requestOutcome: "unknown",
					},
				);
			}
			return {
				provider: "yunhealth",
				operation: COMPLETE_SETTLE_OPERATION,
				requestId: response.requestId,
				providerOrderId: businessId,
			};
		},
	};
}
