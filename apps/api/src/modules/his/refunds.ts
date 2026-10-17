import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
	parseJsonPreservingLargeIntegers,
	stringifyJsonPreservingLargeIntegers,
	success,
} from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	normalizeHisPaymentReference,
	type WechatRefund,
	WechatRefundAmountExceededError,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
} from "@hospital/domain";
import type { AppLogger } from "@hospital/observability";
import type { HisRefundSecurityStore } from "@hospital/persistence";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import {
	adapterContextFromHeaders,
	requestHadClientProvidedRequestId,
} from "../../plugins/request-context";
import {
	AdminWechatRefundInputError,
	type AdminWechatRefundService,
} from "../admin/wechat-refund-service";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "../medical-insurance/errors";
import type { MedicalInsuranceRefundService } from "../medical-insurance/refund-service";

/** HIS 正式调用方的唯一来源地址；中转 Nginx 也必须使用同一值。 */
export const HIS_REFUND_ALLOWED_SOURCE_IP = "124.164.248.83";
const HIS_REFUND_NONCE_TTL_SECONDS = 10 * 60;
const HIS_REFUND_TIMESTAMP_WINDOW_SECONDS = 5 * 60;
const HIS_REFUND_RATE_WINDOW_SECONDS = 60;
const HIS_REFUND_RATE_LIMIT_PER_MINUTE = 10;
const HIS_OPERATOR_REF = "his-refund";

const HisRefundHeaders = t.Object({
	"x-his-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-his-timestamp": t.String({ minLength: 1, maxLength: 12 }),
	"x-his-nonce": t.String({ minLength: 16, maxLength: 128 }),
	"x-his-signature": t.String({ minLength: 64, maxLength: 64 }),
	"x-request-id": t.String({ minLength: 1, maxLength: 128 }),
	"x-real-ip": t.Optional(t.String({ maxLength: 64 })),
	"content-type": t.String({ minLength: 1, maxLength: 128 }),
});

const HisRefundBody = t.Object(
	{
		orderId: t.String({ minLength: 1, maxLength: 64 }),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

/** 医保中心 6201 返回的支付订单号；仅用于定位平台医保订单。 */
const HisRefundByPayOrdIdBody = t.Object(
	{
		payOrdId: t.String({ minLength: 1, maxLength: 64 }),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

/** 微信原支付商户单号；当前微信 APIv3 退款适配器上限为 32 位。 */
const HisRefundByOutTradeNoBody = t.Object(
	{
		outTradeNo: t.String({ minLength: 1, maxLength: 32 }),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

/** HIS 原样回传 .29 的整数关联号；保持原 JSON 类型参与签名。 */
const HisRefundByPaymentReferenceBody = t.Object(
	{
		// 精确类型和范围在专属 parse 中校验。Elysia 的数值 Union 会隐式
		// 转换数字字符串，改变 HMAC 原文甚至损失 19 位整数精度。
		thirdPartPayRecordId: t.Unknown(),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

const HisRefundParams = t.Object({
	refundNo: t.String({ minLength: 1, maxLength: 64 }),
});

type HisRefundRequestHeaders = Record<string, string | undefined>;

type HisRefundModuleOptions = {
	token: string;
	hmacSecret: string;
	security: HisRefundSecurityStore;
	now?: () => number;
	logger?: AppLogger;
	/** 只返回已确认且仍与当前原现金支付腿绑定的映射。 */
	resolvePaymentReference?: (referenceId: string) => Promise<
		| {
				medicalOrderId: string;
				paymentScopeId: string;
				source: "plugin" | "component";
		  }
		| undefined
	>;
};

type HisRefundSplitServices = {
	medicalInsurance?: Pick<
		MedicalInsuranceRefundService,
		"requestMedicalOnlyByOrder" | "requestMedicalOnlyByPayOrdId"
	>;
	wechat?: Pick<
		AdminWechatRefundService,
		| "requestMedicalInsuranceCashByOrder"
		| "requestMedicalInsuranceCashByOutTradeNo"
		| "query"
	>;
};

const HIS_MEDICAL_REFUND_PATH = "/his/medical-insurance-refunds";
const HIS_MEDICAL_LEG_REFUND_PATH = "/his/medical-insurance-leg-refunds";
const HIS_WECHAT_LEG_REFUND_PATH = "/his/wechat-leg-refunds";
const HIS_MEDICAL_LEG_BY_PAY_ORD_ID_REFUND_PATH =
	"/his/medical-insurance-leg-refunds/by-pay-ord-id";
const HIS_WECHAT_LEG_BY_OUT_TRADE_NO_REFUND_PATH =
	"/his/wechat-leg-refunds/by-out-trade-no";
const HIS_WECHAT_LEG_BY_PAYMENT_REFERENCE_REFUND_PATH =
	"/his/wechat-leg-refunds/by-third-part-pay-record-id";
const HIS_MEDICAL_LEG_OPERATOR_REF = "his-medical-leg";

function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	return timingSafeEqual(leftBytes, rightBytes);
}

function canonicalJson(value: unknown): string {
	if (value === undefined) return "";
	if (value === null || typeof value !== "object")
		return stringifyJsonPreservingLargeIntegers(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
	return `{${entries.join(",")}}`;
}

async function parsePaymentReferenceBody(request: Request): Promise<unknown> {
	try {
		const raw = await request.text();
		if (raw.length > 2048) throw new Error("body too large");
		const body = parseJsonPreservingLargeIntegers(raw);
		if (
			typeof body !== "object" ||
			body === null ||
			Array.isArray(body) ||
			Object.keys(body).some(
				(key) => key !== "thirdPartPayRecordId" && key !== "reason",
			)
		) {
			throw new Error("invalid reference body");
		}
		const record = body as Record<string, unknown>;
		normalizeHisPaymentReference(record.thirdPartPayRecordId);
		if (
			record.reason !== undefined &&
			(typeof record.reason !== "string" || record.reason.length > 80)
		) {
			throw new Error("invalid reason");
		}
		// 本请求只有关联号可以是数字。忽略 JSON 字符串后检查原始数值词法，
		// 避免 1.0/1e3 在解析成安全整数后绕过正整数十进制契约。
		const numericTokens = raw
			.replace(/"(?:\\.|[^"\\])*"/gu, "")
			.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu);
		if (numericTokens?.some((token) => !/^[1-9][0-9]*$/u.test(token))) {
			throw new Error("noncanonical reference");
		}
		return body;
	} catch {
		throw new HttpError(
			400,
			"validation",
			"支付关联号须为 19 位以内的正整数 Long，且仅支持可选退费原因",
		);
	}
}

function bodyHash(body: unknown): string {
	return createHash("sha256")
		.update(body === undefined ? "" : canonicalJson(body), "utf8")
		.digest("hex");
}

function signatureFor(input: {
	method: string;
	path: string;
	timestamp: string;
	nonce: string;
	requestId: string;
	body: unknown;
	hmacSecret: string;
}): string {
	const canonical = [
		input.method.toUpperCase(),
		input.path,
		input.timestamp,
		input.nonce,
		input.requestId,
		bodyHash(input.body),
	].join("\n");
	return createHmac("sha256", input.hmacSecret)
		.update(canonical, "utf8")
		.digest("hex");
}

function requireSafeHeader(value: string | undefined, label: string): string {
	const normalized = value?.trim();
	if (!normalized || !/^[A-Za-z0-9._:-]{1,128}$/u.test(normalized)) {
		throw new HttpError(400, "validation", `${label} 不合法`);
	}
	return normalized;
}

function mapRefundError(error: unknown): never {
	if (error instanceof DependencyNotConfiguredError) {
		throw new HttpError(503, "dependency-not-configured", "退费服务尚未配置");
	}
	if (error instanceof AdminWechatRefundInputError) {
		throw new HttpError(400, "validation", error.message);
	}
	if (error instanceof MedicalInsuranceOrderNotFoundError) {
		throw new HttpError(404, "not_found", "医保订单不存在或尚未落库");
	}
	if (error instanceof MedicalInsuranceRegistrationInputError) {
		throw new HttpError(400, "validation", error.message);
	}
	if (error instanceof WechatRefundNotFoundError) {
		throw new HttpError(404, "not_found", "退款订单不存在或尚未落库");
	}
	if (error instanceof WechatRefundAmountExceededError) {
		throw new HttpError(409, "refund_amount_exceeded", "退费金额超过可退金额");
	}
	if (error instanceof WechatRefundIdempotencyConflictError) {
		throw new HttpError(
			409,
			"idempotency_conflict",
			"退费幂等键与已有退款不一致",
		);
	}
	throw error;
}

function referenceHash(value: string | undefined): string | undefined {
	if (!value) return undefined;
	return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function statusOf(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const status = (value as { status?: unknown }).status;
	if (typeof status === "string") return status;
	const data = (value as { data?: unknown }).data;
	if (!data || typeof data !== "object") return undefined;
	const dataStatus = (data as { status?: unknown }).status;
	return typeof dataStatus === "string" ? dataStatus : undefined;
}

function logHis(
	logger: AppLogger | undefined,
	level: "info" | "warn" | "error",
	fields: Record<string, unknown>,
	message: string,
): void {
	if (!logger) return;
	if (level === "info") logger.info(fields, message);
	if (level === "warn") logger.warn(fields, message);
	if (level === "error") logger.error(fields, message);
}

function errorCodeForLog(error: unknown): string {
	if (error instanceof HttpError) return error.code;
	return error instanceof Error ? error.name : "UNKNOWN";
}

function safeWechatRefundResponse(record: WechatRefund) {
	const wechatStatus =
		record.status === "success"
			? "success"
			: record.status === "processing" || record.status === "requested"
				? "processing"
				: record.status === "unknown"
					? "unknown"
					: record.status === "request_failed"
						? "failed"
						: record.status;
	const status =
		record.status === "success"
			? "succeeded"
			: record.status === "processing" || record.status === "requested"
				? "processing"
				: record.status === "request_failed"
					? "failed"
					: "manual_review";
	return {
		orderId: record.sourceOrderId,
		refundNo: record.merchantRefundNo,
		status,
		wechatStatus,
		amounts: {
			totalFen: record.refundFen,
			cashFen: record.refundFen,
			personalAccountFen: 0,
			fundFen: 0,
		},
	};
}

async function executeHisRequest<T>(input: {
	request: Request;
	headers: HisRefundRequestHeaders;
	method: "POST" | "GET";
	path: string;
	body: unknown;
	operation: string;
	orderId?: string;
	options: HisRefundModuleOptions;
	now: () => number;
	invoke: (auth: {
		requestId: string;
		timestamp: string;
		nonce: string;
	}) => Promise<T>;
}): Promise<T> {
	const startedAt = Date.now();
	const sourceIp = input.request.headers.get("x-real-ip")?.trim();
	const baseFields = {
		operation: input.operation,
		method: input.method,
		route: input.path,
		sourceIp,
		...(referenceHash(input.orderId)
			? { orderRefHash: referenceHash(input.orderId) }
			: {}),
	};
	let auth: { requestId: string; timestamp: string; nonce: string };
	try {
		auth = authorizeHisRequest({
			request: input.request,
			headers: input.headers,
			method: input.method,
			path: input.path,
			body: input.body,
			options: input.options,
			now: input.now,
		});
		await reserveSecurityState(
			input.options.security,
			HIS_REFUND_ALLOWED_SOURCE_IP,
			auth.nonce,
			input.now(),
		);
	} catch (error) {
		logHis(
			input.options.logger,
			"warn",
			{
				event: "his.refund.rejected",
				...baseFields,
				durationMs: Date.now() - startedAt,
				errorCode: errorCodeForLog(error),
			},
			"HIS refund request rejected",
		);
		throw error;
	}
	logHis(
		input.options.logger,
		"info",
		{
			event: "his.refund.accepted",
			...baseFields,
			requestId: auth.requestId,
		},
		"HIS refund request accepted",
	);
	try {
		const result = await input.invoke(auth);
		logHis(
			input.options.logger,
			"info",
			{
				event: "his.refund.completed",
				...baseFields,
				requestId: auth.requestId,
				durationMs: Date.now() - startedAt,
				resultStatus: statusOf(result),
			},
			"HIS refund request completed",
		);
		return result;
	} catch (error) {
		let mappedError: unknown = error;
		try {
			mapRefundError(error);
		} catch (candidate) {
			mappedError = candidate;
		}
		logHis(
			input.options.logger,
			"error",
			{
				event: "his.refund.failed",
				...baseFields,
				requestId: auth.requestId,
				durationMs: Date.now() - startedAt,
				errorCode: errorCodeForLog(mappedError),
				...(mappedError instanceof HttpError
					? { statusCode: mappedError.statusCode }
					: {}),
			},
			"HIS refund request failed",
		);
		throw mappedError;
	}
}

function authorizeHisRequest(input: {
	request: Request;
	headers: HisRefundRequestHeaders;
	method: string;
	path: string;
	body: unknown;
	options: HisRefundModuleOptions;
	now: () => number;
}): { requestId: string; timestamp: string; nonce: string } {
	const sourceIp = input.request.headers.get("x-real-ip")?.trim();
	if (sourceIp !== HIS_REFUND_ALLOWED_SOURCE_IP) {
		throw new HttpError(
			403,
			"his-source-not-allowed",
			"HIS 来源地址不在白名单",
		);
	}
	if (!requestHadClientProvidedRequestId(input.request)) {
		throw new HttpError(400, "validation", "X-Request-Id 为必填项");
	}
	const requestId = requireSafeHeader(
		input.headers["x-request-id"],
		"X-Request-Id",
	);
	const contentType = input.headers["content-type"]?.split(";", 1)[0]?.trim();
	if (contentType !== "application/json") {
		throw new HttpError(
			400,
			"validation",
			"Content-Type 必须是 application/json",
		);
	}
	const timestamp = input.headers["x-his-timestamp"]?.trim() ?? "";
	const nonce = input.headers["x-his-nonce"]?.trim() ?? "";
	const signature = input.headers["x-his-signature"]?.trim() ?? "";
	if (!/^\d{1,12}$/u.test(timestamp)) {
		throw new HttpError(401, "his-unauthorized", "HIS 认证失败");
	}
	if (!/^[A-Za-z0-9._:-]{16,128}$/u.test(nonce)) {
		throw new HttpError(401, "his-unauthorized", "HIS 认证失败");
	}
	if (!/^[0-9a-f]{64}$/iu.test(signature)) {
		throw new HttpError(401, "his-unauthorized", "HIS 认证失败");
	}
	const timestampSeconds = Number(timestamp);
	const nowSeconds = Math.floor(input.now() / 1000);
	if (
		!Number.isSafeInteger(timestampSeconds) ||
		Math.abs(nowSeconds - timestampSeconds) >
			HIS_REFUND_TIMESTAMP_WINDOW_SECONDS
	) {
		throw new HttpError(401, "his-request-expired", "HIS 请求已过期");
	}
	if (
		!constantTimeEqual(
			input.headers["x-his-refund-token"] ?? "",
			input.options.token.trim(),
		)
	) {
		throw new HttpError(401, "his-unauthorized", "HIS 认证失败");
	}
	const expectedSignature = signatureFor({
		method: input.method,
		path: input.path,
		timestamp,
		nonce,
		requestId,
		body: input.body,
		hmacSecret: input.options.hmacSecret.trim(),
	});
	if (!constantTimeEqual(signature.toLowerCase(), expectedSignature)) {
		throw new HttpError(401, "his-signature-invalid", "HIS 签名无效");
	}
	return { requestId, timestamp, nonce };
}

async function reserveSecurityState(
	security: HisRefundSecurityStore,
	sourceIp: string,
	nonce: string,
	now: number,
): Promise<void> {
	try {
		const reserved = await security.reserveNonce(
			nonce,
			HIS_REFUND_NONCE_TTL_SECONDS,
		);
		if (!reserved) {
			throw new HttpError(409, "his-replay-detected", "HIS 请求已处理过");
		}
		const bucket = `${sourceIp}:${Math.floor(now / 60_000)}`;
		const count = await security.incrementRateLimit(
			bucket,
			HIS_REFUND_RATE_WINDOW_SECONDS,
		);
		if (count > HIS_REFUND_RATE_LIMIT_PER_MINUTE) {
			throw new HttpError(429, "his-rate-limited", "HIS 退费请求过于频繁");
		}
	} catch (error) {
		if (error instanceof HttpError) throw error;
		throw new HttpError(
			503,
			"his-security-unavailable",
			"HIS 退费安全服务暂不可用",
		);
	}
}

/**
 * HIS 专用整笔退费入口。该入口不接受退费金额或分项选择，服务端始终
 * 调用一次 MedicalInsuranceRefundService，由其编排医保 6203 + 微信 APIv3。
 */
export function hisMedicalInsuranceRefundModule(
	service: Pick<
		MedicalInsuranceRefundService,
		"requestFullRefundByOrder" | "query"
	>,
	options: HisRefundModuleOptions,
	splitServices: HisRefundSplitServices = {},
) {
	const now = options.now ?? (() => Date.now());
	return new Elysia({ name: "his-medical-insurance-refunds-module" })
		.post(
			HIS_MEDICAL_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_MEDICAL_REFUND_PATH,
					body,
					operation: "medical_insurance_aggregate",
					orderId: body.orderId,
					options,
					now,
					invoke: async (auth) =>
						success(
							await service.requestFullRefundByOrder({
								orderId: body.orderId,
								...(body.reason !== undefined ? { reason: body.reason } : {}),
								operatorRef: HIS_OPERATOR_REF,
								context: adapterContextFromHeaders({
									"x-request-id": auth.requestId,
								}),
							}),
						),
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundBody,
				detail: { hide: true },
			},
		)
		.get(
			`${HIS_MEDICAL_REFUND_PATH}/:refundNo`,
			async ({ headers, params, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "GET",
					path: `${HIS_MEDICAL_REFUND_PATH}/${params.refundNo}`,
					body: undefined,
					operation: "medical_insurance_aggregate_query",
					options,
					now,
					invoke: async (auth) => {
						const result = await service.query(params.refundNo, {
							requestId: auth.requestId,
							operatorRef: HIS_OPERATOR_REF,
						});
						if (!result)
							throw new HttpError(404, "not_found", "医保退费记录不存在");
						return success(result);
					},
				}),
			{
				headers: HisRefundHeaders,
				params: HisRefundParams,
				detail: { hide: true },
			},
		)
		.post(
			HIS_MEDICAL_LEG_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_MEDICAL_LEG_REFUND_PATH,
					body,
					operation: "medical_insurance_leg",
					orderId: body.orderId,
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.medicalInsurance) {
							throw new DependencyNotConfiguredError(
								"his.medicalInsuranceRefundLeg",
							);
						}
						return success(
							await splitServices.medicalInsurance.requestMedicalOnlyByOrder({
								orderId: body.orderId,
								...(body.reason !== undefined ? { reason: body.reason } : {}),
								operatorRef: HIS_MEDICAL_LEG_OPERATOR_REF,
								context: adapterContextFromHeaders({
									"x-request-id": auth.requestId,
								}),
							}),
						);
					},
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundBody,
				detail: { hide: true },
			},
		)
		.post(
			HIS_MEDICAL_LEG_BY_PAY_ORD_ID_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_MEDICAL_LEG_BY_PAY_ORD_ID_REFUND_PATH,
					body,
					operation: "medical_insurance_leg_by_pay_ord_id",
					// 仅写入哈希日志；外部医保号不会进入普通业务日志。
					orderId: body.payOrdId,
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.medicalInsurance) {
							throw new DependencyNotConfiguredError(
								"his.medicalInsuranceRefundLeg",
							);
						}
						return success(
							await splitServices.medicalInsurance.requestMedicalOnlyByPayOrdId(
								{
									payOrdId: body.payOrdId,
									...(body.reason !== undefined ? { reason: body.reason } : {}),
									operatorRef: HIS_MEDICAL_LEG_OPERATOR_REF,
									context: adapterContextFromHeaders({
										"x-request-id": auth.requestId,
									}),
								},
							),
						);
					},
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundByPayOrdIdBody,
				detail: { hide: true },
			},
		)
		.get(
			`${HIS_MEDICAL_LEG_REFUND_PATH}/:refundNo`,
			async ({ headers, params, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "GET",
					path: `${HIS_MEDICAL_LEG_REFUND_PATH}/${params.refundNo}`,
					body: undefined,
					operation: "medical_insurance_leg_query",
					options,
					now,
					invoke: async (auth) => {
						const result = await service.query(params.refundNo, {
							requestId: auth.requestId,
							operatorRef: HIS_MEDICAL_LEG_OPERATOR_REF,
						});
						if (!result)
							throw new HttpError(404, "not_found", "医保退费记录不存在");
						return success(result);
					},
				}),
			{
				headers: HisRefundHeaders,
				params: HisRefundParams,
				detail: { hide: true },
			},
		)
		.post(
			HIS_WECHAT_LEG_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_WECHAT_LEG_REFUND_PATH,
					body,
					operation: "wechat_leg",
					orderId: body.orderId,
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.wechat) {
							throw new DependencyNotConfiguredError("his.wechatRefundLeg");
						}
						const result =
							await splitServices.wechat.requestMedicalInsuranceCashByOrder(
								{
									orderId: body.orderId,
									...(body.reason !== undefined ? { reason: body.reason } : {}),
								},
								adapterContextFromHeaders({
									"x-request-id": auth.requestId,
								}),
							);
						return success(safeWechatRefundResponse(result));
					},
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundBody,
				detail: { hide: true },
			},
		)
		.post(
			HIS_WECHAT_LEG_BY_PAYMENT_REFERENCE_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_WECHAT_LEG_BY_PAYMENT_REFERENCE_REFUND_PATH,
					body,
					operation: "wechat_leg_by_third_part_pay_record_id",
					orderId: String(body.thirdPartPayRecordId),
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.wechat || !options.resolvePaymentReference) {
							throw new DependencyNotConfiguredError(
								"his.wechatPaymentReferenceRefund",
							);
						}
						let referenceId: string;
						try {
							referenceId = normalizeHisPaymentReference(
								body.thirdPartPayRecordId,
							);
						} catch {
							throw new HttpError(
								400,
								"validation",
								"支付关联号超出正整数 Long 范围",
							);
						}
						const reference =
							await options.resolvePaymentReference(referenceId);
						if (!reference) {
							throw new HttpError(
								404,
								"not_found",
								"支付关联号不存在或尚未确认",
							);
						}
						const result =
							await splitServices.wechat.requestMedicalInsuranceCashByOrder(
								{
									orderId: reference.medicalOrderId,
									...(body.reason !== undefined ? { reason: body.reason } : {}),
								},
								adapterContextFromHeaders({ "x-request-id": auth.requestId }),
							);
						return success(safeWechatRefundResponse(result));
					},
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundByPaymentReferenceBody,
				parse: ({ request }) => parsePaymentReferenceBody(request),
				detail: { hide: true },
			},
		)
		.post(
			HIS_WECHAT_LEG_BY_OUT_TRADE_NO_REFUND_PATH,
			async ({ headers, body, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "POST",
					path: HIS_WECHAT_LEG_BY_OUT_TRADE_NO_REFUND_PATH,
					body,
					operation: "wechat_leg_by_out_trade_no",
					// 仅写入哈希日志；微信原支付单号不会进入普通业务日志。
					orderId: body.outTradeNo,
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.wechat) {
							throw new DependencyNotConfiguredError("his.wechatRefundLeg");
						}
						const result =
							await splitServices.wechat.requestMedicalInsuranceCashByOutTradeNo(
								{
									outTradeNo: body.outTradeNo,
									...(body.reason !== undefined ? { reason: body.reason } : {}),
								},
								adapterContextFromHeaders({
									"x-request-id": auth.requestId,
								}),
							);
						return success(safeWechatRefundResponse(result));
					},
				}),
			{
				headers: HisRefundHeaders,
				body: HisRefundByOutTradeNoBody,
				detail: { hide: true },
			},
		)
		.get(
			`${HIS_WECHAT_LEG_REFUND_PATH}/:refundNo`,
			async ({ headers, params, request }) =>
				executeHisRequest({
					request,
					headers,
					method: "GET",
					path: `${HIS_WECHAT_LEG_REFUND_PATH}/${params.refundNo}`,
					body: undefined,
					operation: "wechat_leg_query",
					options,
					now,
					invoke: async (auth) => {
						if (!splitServices.wechat) {
							throw new DependencyNotConfiguredError("his.wechatRefundLeg");
						}
						const result = await splitServices.wechat.query(
							params.refundNo,
							adapterContextFromHeaders({
								"x-request-id": auth.requestId,
							}),
						);
						return success(safeWechatRefundResponse(result));
					},
				}),
			{
				headers: HisRefundHeaders,
				params: HisRefundParams,
				detail: { hide: true },
			},
		);
}

export const hisRefundSignature = signatureFor;
