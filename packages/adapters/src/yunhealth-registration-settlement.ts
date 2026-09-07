import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	HospitalSettlementGateway,
	PaymentOrderSnapshot,
	RegistrationSelfPaySettlementContext,
	YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import {
	type ProviderFetcher,
	type ProviderRequestLogger,
	requestJson,
} from "./http";

const THIRD_PART_PAY_START_PATH = "/msun-yb-app-miop/thirdPartPay/start";
const PAYMENT_NOTIFY_PATH =
	"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify";
const COMPLETE_SETTLE_PATH =
	"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle";
const THIRD_PART_OPERATION = "registration-self-pay.2.27.2.29";
const PAYMENT_NOTIFY_OPERATION = "registration-self-pay.2.6.65.15";
const COMPLETE_SETTLE_OPERATION = "registration-self-pay.2.6.65.5";
const ALLOWED_PAY_TYPES = new Set(["CREDIT", "POS", "CROWD_FUNDING"]);

export type YunhealthRegistrationPluginPayType =
	| "CREDIT"
	| "POS"
	| "CROWD_FUNDING";

export type YunhealthRegistrationSettlementGatewayOptions = {
	/** 云健康/众阳共享上游地址，必须是 HTTPS 且只来自服务端配置。 */
	baseUrl: string;
	/** 不得从小程序请求传入；支持原始 token 或完整 Bearer 值。 */
	authorizationToken: string;
	/** 2.6.65.15 orgId，必须是正整数文本。 */
	paymentOrgId: string;
	/** 旧服务已确认的插件 payTypeId，必须是正整数文本。 */
	pluginPayTypeId: string;
	pluginPayType: YunhealthRegistrationPluginPayType;
	/** HIS 已确认插件版收款的工作站号；当前合同允许为空字符串。 */
	workStationId: string;
	paymentSource?: string;
	authSysCode?: string;
	tradeTypeCode?: string;
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
	patientId: number;
	certNo: string;
	psnCertType: string;
	psnName: string;
	psnNo: string;
	patInHosId: number;
	payingId: number;
	tradingId: number;
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

function normalizedAuthorization(value: string): string {
	const token = requiredText(value, "authorizationToken");
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

function requireProviderSuccess(
	value: unknown,
	operation: string,
	requestId: string,
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
			throw providerError(operation, "Yunhealth rejected the request", {
				requestId,
				failureStage: "response",
				requestOutcome: "rejected",
				...(typeof candidate.code === "string"
					? { providerErrorCode: candidate.code }
					: {}),
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
		patientId: positiveInteger(value.patientId, "patientId"),
		certNo: requiredText(value.certNo, "certNo"),
		psnCertType: requiredText(value.psnCertType, "psnCertType"),
		psnName: requiredText(value.psnName, "psnName"),
		psnNo: requiredText(value.psnNo, "psnNo"),
		patInHosId: nonNegativeInteger(value.patInHosId, "patInHosId"),
		payingId: positiveInteger(value.payingId, "payingId"),
		tradingId: positiveInteger(value.tradingId, "tradingId"),
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
	const paymentOrgId = positiveInteger(options.paymentOrgId, "paymentOrgId");
	const pluginPayTypeId = positiveInteger(
		options.pluginPayTypeId,
		"pluginPayTypeId",
	);
	const pluginPayType = requiredText(
		options.pluginPayType,
		"pluginPayType",
	) as YunhealthRegistrationPluginPayType;
	if (!ALLOWED_PAY_TYPES.has(pluginPayType))
		throw new AdapterNotConfiguredError("yunhealth");
	const workStationId = textAllowEmpty(options.workStationId, "workStationId");
	const paymentSource = requiredText(
		options.paymentSource ?? "1",
		"paymentSource",
	);
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
			const payFee = validatePureCashSettlement(input.settlement);
			const registrationContext = input.registrationContext;
			const outTradeNo = registrationContext?.outTradeNo
				? requiredText(registrationContext.outTradeNo, "outTradeNo", 64)
				: orderId;
			const recordCode = registrationContext?.recordCode
				? requiredText(registrationContext.recordCode, "recordCode", 32)
				: stableRecordCode(outTradeNo);
			if (!/^[A-Za-z0-9]{32}$/u.test(recordCode)) {
				throw providerError(THIRD_PART_OPERATION, "recordCode is invalid", {
					failureStage: "validation",
					requestOutcome: "not_sent",
				});
			}
			const requestPayTypeId = registrationContext?.payTypeId
				? positiveInteger(registrationContext.payTypeId, "payTypeId")
				: pluginPayTypeId;
			const requestPayType = registrationContext?.payType
				? requiredText(registrationContext.payType, "payType")
				: pluginPayType;
			if (!ALLOWED_PAY_TYPES.has(requestPayType))
				throw providerError(THIRD_PART_OPERATION, "payType is invalid", {
					failureStage: "validation",
					requestOutcome: "not_sent",
				});
			const requestWorkStationId =
				registrationContext?.workStationId !== undefined
					? textAllowEmpty(registrationContext.workStationId, "workStationId")
					: workStationId;
			if (
				requestPayTypeId !== pluginPayTypeId ||
				requestPayType !== pluginPayType
			) {
				throw providerError(
					THIRD_PART_OPERATION,
					"stored plugin payment configuration does not match server configuration",
					{
						failureStage: "validation",
						requestOutcome: "not_sent",
					},
				);
			}
			if (requestWorkStationId !== workStationId) {
				throw providerError(
					THIRD_PART_OPERATION,
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
						headers: { Authorization: authorization },
						body,
						...(captureRawBody ? { captureRawBody: true } : {}),
						...(options.logger ? { logger: options.logger } : {}),
					},
					fetcher,
				);
				requestIds.push(response.requestId);
				return response;
			};

			const thirdPartRecordId = registrationContext?.thirdPartPayRecordId
				? positiveInteger(
						registrationContext.thirdPartPayRecordId,
						"thirdPartPayRecordId",
					)
				: undefined;
			if (thirdPartRecordId === undefined) {
				const thirdPart = await request<unknown>(
					"2.27.2.29",
					THIRD_PART_OPERATION,
					THIRD_PART_PAY_START_PATH,
					{
						agreementNo: outTradeNo,
						bankCode: "-",
						certNo: normalizedContext.certNo,
						commercialInsuranceId: 0,
						creditUserId: "",
						patId: normalizedContext.patientId,
						patInHosId: normalizedContext.patInHosId,
						payFee,
						payType: requestPayType,
						payTypeId: requestPayTypeId,
						payingId: normalizedContext.payingId,
						psnCertType: normalizedContext.psnCertType,
						psnName: normalizedContext.psnName,
						psnNo: normalizedContext.psnNo,
						sceneCode: "OUT",
						settleId: normalizedContext.businessId,
						tradingId: normalizedContext.tradingId,
						transStatus: "0",
					},
					true,
				);
				requireProviderSuccess(
					thirdPart.data,
					THIRD_PART_OPERATION,
					thirdPart.requestId,
				);
				const thirdPartPayRecordId = positiveInteger(
					nestedValue(thirdPart.data, [
						"thirdPartPayRecordId",
						"third_part_pay_record_id",
					]),
					"thirdPartPayRecordId",
				).toString();
				if (typeof thirdPart.rawBodyText !== "string") {
					throw providerError(
						THIRD_PART_OPERATION,
						"2.27.2.29 raw response was not captured",
						{
							requestId: thirdPart.requestId,
							failureStage: "response",
							requestOutcome: "unknown",
						},
					);
				}
				await input.onThirdPartPayResponse?.({
					rawResponse: thirdPart.rawBodyText,
					thirdPartPayRecordId,
				});
			}

			const paymentNotify = await request<unknown>(
				"2.6.65.15",
				PAYMENT_NOTIFY_OPERATION,
				PAYMENT_NOTIFY_PATH,
				{
					authSysCode,
					hospitalId: normalizedContext.hospitalId,
					nonce: stableRecordCode(`${orderId}:nonce`),
					orgId: paymentOrgId,
					payingId: normalizedContext.payingId,
					requestParam: JSON.stringify(
						{
							payingType: "1",
							recordList: [
								{
									payingId: normalizedContext.payingId,
									payTypeId: requestPayTypeId,
									receiveAmount: payFee,
									recordCode,
									status: "3",
									source: paymentSource,
								},
							],
						},
						undefined,
						0,
					),
					tradeTypeCode,
					workStationId: requestWorkStationId,
				},
			);
			requireProviderSuccess(
				paymentNotify.data,
				PAYMENT_NOTIFY_OPERATION,
				paymentNotify.requestId,
			);

			const complete = await request<unknown>(
				"2.6.65.5",
				COMPLETE_SETTLE_OPERATION,
				COMPLETE_SETTLE_PATH,
				{
					authSysCode,
					autoSettle: 2,
					businessId: normalizedContext.businessId,
					hospitalId: normalizedContext.hospitalId,
					thirdFlag: 1,
					tradeTypeCode,
					workStationId: requestWorkStationId,
				},
			);
			requireProviderSuccess(
				complete.data,
				COMPLETE_SETTLE_OPERATION,
				complete.requestId,
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
		async createPreOrder(input, context) {
			const orderId = requiredText(input.orderId, "orderId", 128);
			const businessId = requiredText(input.businessId, "businessId");
			const tradeCode = requiredText(input.tradeCode, "tradeCode");
			const hospitalId = positiveInteger(input.hospitalId, "hospitalId");
			const patientId = positiveInteger(input.patientId, "patientId");
			const totalFen = positiveInteger(input.totalFen, "totalFen");
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
			if (input.payTypeId !== String(pluginPayTypeId)) {
				throw providerError(
					"registration-self-pay.2.6.65.2.plugin",
					"plugin payTypeId does not match server configuration",
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
					headers: { Authorization: authorization },
					body: {
						appCode: "WeChatSmallProg",
						authSysCode,
						autoSettle: 3,
						body: "预约挂号医保自费插件支付",
						businessId,
						expire: 20,
						hospitalId,
						notifyUrl: "",
						payModel: "H5",
						payTypeId: pluginPayTypeId,
						payTypeParams: [
							{
								payTypeId: pluginPayTypeId,
								amount: Number((totalFen / 100).toFixed(2)),
								paymentSystemUserId: "",
								spbillCreateIp: "",
							},
						],
						paymentSystemUserId: "",
						recordCode,
						requestId: recordCode,
						sceneCode: "WeChatSmallProgram",
						spbillCreateIp: "",
						total: Number((totalFen / 100).toFixed(2)),
						tradeCode,
						tradeTypeCode,
						workStationId,
					},
				},
				fetcher,
			);
			requireProviderSuccess(response.data, operation, response.requestId);
			const payingId = positiveInteger(
				nestedValue(response.data, ["payingId", "paying_id"]),
				"plugin payingId",
			).toString();
			const tradingId = positiveInteger(
				nestedValue(response.data, ["tradingId", "trading_id"]),
				"plugin tradingId",
			).toString();
			return {
				payingId,
				tradingId,
				payTypeId: String(pluginPayTypeId),
				payType: pluginPayType,
				workStationId,
				tradeTypeCode,
				trace: {
					provider: "yunhealth",
					operation,
					requestId: response.requestId,
					providerOrderId: payingId,
				},
			};
		},
	};
}
