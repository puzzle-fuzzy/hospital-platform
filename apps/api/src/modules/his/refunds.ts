import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { success } from "@hospital/contracts";
import {
	WechatRefundAmountExceededError,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
} from "@hospital/domain";
import type { HisRefundSecurityStore } from "@hospital/persistence";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import {
	requestHadClientProvidedRequestId,
	adapterContextFromHeaders,
} from "../../plugins/request-context";
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

const HisRefundParams = t.Object({
	refundNo: t.String({ minLength: 1, maxLength: 64 }),
});

type HisRefundRequestHeaders = Record<string, string | undefined>;

type HisRefundModuleOptions = {
	token: string;
	hmacSecret: string;
	security: HisRefundSecurityStore;
	now?: () => number;
};

function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	return timingSafeEqual(leftBytes, rightBytes);
}

function canonicalJson(value: unknown): string {
	if (value === undefined) return "";
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
	return `{${entries.join(",")}}`;
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
) {
	const now = options.now ?? (() => Date.now());
	return new Elysia({ name: "his-medical-insurance-refunds-module" })
		.post(
			"/his/medical-insurance-refunds",
			async ({ headers, body, request }) => {
				const auth = authorizeHisRequest({
					request,
					headers,
					method: "POST",
					path: "/his/medical-insurance-refunds",
					body,
					options,
					now,
				});
				await reserveSecurityState(
					options.security,
					HIS_REFUND_ALLOWED_SOURCE_IP,
					auth.nonce,
					now(),
				);
				try {
					return success(
						await service.requestFullRefundByOrder({
							orderId: body.orderId,
							...(body.reason !== undefined ? { reason: body.reason } : {}),
							operatorRef: HIS_OPERATOR_REF,
							context: adapterContextFromHeaders({
								"x-request-id": auth.requestId,
							}),
						}),
					);
				} catch (error) {
					return mapRefundError(error);
				}
			},
			{
				headers: HisRefundHeaders,
				body: HisRefundBody,
				detail: { hide: true },
			},
		)
		.get(
			"/his/medical-insurance-refunds/:refundNo",
			async ({ headers, params, request }) => {
				const auth = authorizeHisRequest({
					request,
					headers,
					method: "GET",
					path: `/his/medical-insurance-refunds/${params.refundNo}`,
					body: undefined,
					options,
					now,
				});
				await reserveSecurityState(
					options.security,
					HIS_REFUND_ALLOWED_SOURCE_IP,
					auth.nonce,
					now(),
				);
				const result = await service.query(params.refundNo, {
					requestId: auth.requestId,
					operatorRef: HIS_OPERATOR_REF,
				});
				if (!result)
					throw new HttpError(404, "not_found", "医保退费记录不存在");
				return success(result);
			},
			{
				headers: HisRefundHeaders,
				params: HisRefundParams,
				detail: { hide: true },
			},
		);
}

export const hisRefundSignature = signatureFor;
