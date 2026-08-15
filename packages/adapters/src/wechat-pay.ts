import {
	createDecipheriv,
	createSign,
	createVerify,
	randomUUID,
} from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	WechatMiniProgramPayParams,
	WechatPaymentGateway,
} from "@hospital/domain";
import type { PaymentState } from "@hospital/contracts";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { requestJson, type ProviderFetcher } from "./http";

const DEFAULT_WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";
const JSAPI_ORDER_PATH = "/v3/pay/transactions/jsapi";
const PLATFORM_SIGNATURE_MAX_SKEW_SECONDS = 300;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_KEY_BYTES = 32;

type WechatJsapiOrderResponse = {
	prepay_id?: unknown;
};

type WechatOrderQueryResponse = {
	trade_state?: unknown;
	transaction_id?: unknown;
};

type WechatPaymentNotificationEnvelope = {
	id?: unknown;
	event_type?: unknown;
	resource?: unknown;
};

type WechatPaymentNotificationResource = {
	algorithm?: unknown;
	ciphertext?: unknown;
	nonce?: unknown;
	associated_data?: unknown;
};

export type WechatPaymentGatewayOptions = {
	/** 小程序 AppID；只服务端使用，不写入日志。 */
	appId: string;
	/** 微信支付商户号；只用于 APIv3 请求和调起参数。 */
	mchId: string;
	/** 商户 API 证书序列号，Authorization 的 serial_no。 */
	merchantCertificateSerial: string;
	/** 商户 API 私钥 PEM；不得从客户端输入或写入日志。 */
	merchantPrivateKey: string;
	/** 微信支付平台证书/公钥序列号，响应验签时必须严格匹配。 */
	platformCertificateSerial: string;
	/** 微信支付平台公钥 PEM；只保存在 adapter 内存边界。 */
	platformPublicKey: string;
	/** 微信支付通知地址；必须由服务端配置，不能由订单请求覆盖。 */
	notifyUrl: string;
	baseUrl?: string;
	fetcher?: ProviderFetcher;
	/** 测试注入时钟；生产使用当前时间。 */
	now?: () => Date;
	/** 测试注入随机数；生产使用 node:crypto 的 randomUUID。 */
	nonce?: () => string;
};

export type WechatPaymentNotificationVerifierOptions = {
	platformCertificateSerial: string;
	platformPublicKey: string;
	apiV3Key: string;
	now?: () => Date;
	maxClockSkewSeconds?: number;
};

export type WechatPaymentNotification = {
	notificationId: string;
	eventType: string;
	resource: Record<string, unknown>;
};

function requiredConfig(value: string, adapter: "wechat-pay"): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError(adapter);
	return normalized;
}

function requiredPositiveFen(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new ProviderRequestError({
			provider: "wechat-pay",
			operation: "jsapi-prepay",
			message: "Wechat payment totalFen must be a positive safe integer",
			retryable: false,
		});
	}
	return value;
}

function requiredInput(value: string, field: string, maxLength = 256): string {
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength) {
		throw new ProviderRequestError({
			provider: "wechat-pay",
			operation: "request-validation",
			message: `Wechat payment ${field} is invalid`,
			retryable: false,
		});
	}
	return normalized;
}

function providerError(input: {
	operation: string;
	message: string;
	requestId?: string;
	cause?: unknown;
}): ProviderRequestError {
	return new ProviderRequestError({
		provider: "wechat-pay",
		operation: input.operation,
		message: input.message,
		retryable: false,
		...(input.requestId ? { requestId: input.requestId } : {}),
		...(input.cause ? { cause: input.cause } : {}),
	});
}

function unixSeconds(now: () => Date): string {
	return Math.floor(now().getTime() / 1000).toString();
}

function defaultNonce(): string {
	return randomUUID().replaceAll("-", "");
}

function signRsaSha256(message: string, privateKey: string): string {
	const signer = createSign("RSA-SHA256");
	signer.update(message, "utf8");
	signer.end();
	return signer.sign(privateKey).toString("base64");
}

function verifyRsaSha256(
	message: string,
	signature: string,
	publicKey: string,
): boolean {
	try {
		const verifier = createVerify("RSA-SHA256");
		verifier.update(message, "utf8");
		verifier.end();
		return verifier.verify(publicKey, decodeBase64(signature));
	} catch {
		return false;
	}
}

function decodeBase64(value: string): Uint8Array {
	try {
		const decoded = atob(value);
		return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
	} catch (cause) {
		throw providerError({
			operation: "signature-verification",
			message: "Wechat provider signature was not valid base64",
			cause,
		});
	}
}

function responseHeader(headers: Headers, name: string): string {
	return headers.get(name)?.trim() ?? "";
}

function verifyPlatformSignature(input: {
	rawBody: Uint8Array;
	headers: Headers;
	statusCode: number;
	requestId: string;
	platformCertificateSerial: string;
	platformPublicKey: string;
	now: () => Date;
	operation: string;
	maxClockSkewSeconds?: number;
}): void {
	const serial = responseHeader(input.headers, "Wechatpay-Serial");
	const signature = responseHeader(input.headers, "Wechatpay-Signature");
	const timestamp = responseHeader(input.headers, "Wechatpay-Timestamp");
	const nonce = responseHeader(input.headers, "Wechatpay-Nonce");
	const requestId = input.requestId || undefined;
	const invalid = (message: string, cause?: unknown): never => {
		throw providerError({
			operation: input.operation,
			message,
			...(requestId ? { requestId } : {}),
			...(cause ? { cause } : {}),
		});
	};

	if (input.statusCode < 200 || input.statusCode >= 300) {
		return;
	}
	if (!serial || !signature || !timestamp || !nonce) {
		invalid("Wechat provider response signature headers are incomplete");
	}
	if (serial !== input.platformCertificateSerial) {
		invalid("Wechat provider response certificate serial did not match");
	}

	const timestampNumber = Number(timestamp);
	const maxSkew =
		input.maxClockSkewSeconds ?? PLATFORM_SIGNATURE_MAX_SKEW_SECONDS;
	const currentTimestamp = Math.floor(input.now().getTime() / 1000);
	if (
		!Number.isSafeInteger(timestampNumber) ||
		Math.abs(currentTimestamp - timestampNumber) > maxSkew
	) {
		invalid("Wechat provider response timestamp was outside the allowed skew");
	}

	const body = new TextDecoder().decode(input.rawBody);
	const message = `${timestamp}\n${nonce}\n${body}\n`;
	if (!verifyRsaSha256(message, signature, input.platformPublicKey)) {
		invalid("Wechat provider response signature was invalid");
	}
}

function apiV3Authorization(input: {
	method: string;
	path: string;
	timestamp: string;
	nonce: string;
	body: string;
	mchId: string;
	merchantCertificateSerial: string;
	merchantPrivateKey: string;
}): string {
	const message = `${input.method}\n${input.path}\n${input.timestamp}\n${input.nonce}\n${input.body}\n`;
	const signature = signRsaSha256(message, input.merchantPrivateKey);
	return [
		"WECHATPAY2-SHA256-RSA2048",
		`mchid="${input.mchId}"`,
		`nonce_str="${input.nonce}"`,
		`timestamp="${input.timestamp}"`,
		`serial_no="${input.merchantCertificateSerial}"`,
		`signature="${signature}"`,
	].join(" ");
}

function paymentTrace(
	operation: string,
	requestId: string,
	providerOrderId?: string,
): ExternalTrace {
	return {
		provider: "wechat-pay",
		operation,
		requestId,
		...(providerOrderId ? { providerOrderId } : {}),
	};
}

function payParams(input: {
	appId: string;
	prepayId: string;
	now: () => Date;
	nonce: () => string;
	merchantPrivateKey: string;
}): WechatMiniProgramPayParams {
	const timeStamp = unixSeconds(input.now);
	const nonceStr = input.nonce();
	const packageValue = `prepay_id=${input.prepayId}`;
	const message = `${input.appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
	return {
		appId: input.appId,
		timeStamp,
		nonceStr,
		package: packageValue,
		signType: "RSA",
		paySign: signRsaSha256(message, input.merchantPrivateKey),
	};
}

function mapTradeState(value: unknown): PaymentState {
	if (value === "SUCCESS") return "cash_paid";
	if (value === "NOTPAY" || value === "USERPAYING") return "cash_pending";
	if (value === "CLOSED" || value === "REVOKED" || value === "PAYERROR") {
		return "failed";
	}
	throw providerError({
		operation: "order-query",
		message: "Wechat order returned an unsupported trade state",
	});
}

function notificationText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw providerError({
			operation: "notification-decrypt",
			message: `Wechat notification field ${field} is invalid`,
		});
	}
	return value;
}

function recordValue(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError({
			operation: "notification-decrypt",
			message: `Wechat notification ${field} must be an object`,
		});
	}
	return value as Record<string, unknown>;
}

function decryptNotificationResource(input: {
	resource: WechatPaymentNotificationResource;
	apiV3Key: string;
}): Record<string, unknown> {
	const algorithm = notificationText(input.resource.algorithm, "algorithm");
	if (algorithm !== "AEAD_AES_256_GCM") {
		throw providerError({
			operation: "notification-decrypt",
			message: "Wechat notification encryption algorithm is unsupported",
		});
	}
	const ciphertext = notificationText(input.resource.ciphertext, "ciphertext");
	const nonce = notificationText(input.resource.nonce, "nonce");
	const associatedData =
		typeof input.resource.associated_data === "string"
			? input.resource.associated_data
			: "";
	const key = new TextEncoder().encode(input.apiV3Key);
	if (key.byteLength !== AES_GCM_KEY_BYTES) {
		throw providerError({
			operation: "notification-decrypt",
			message: "Wechat APIv3 key must be exactly 32 UTF-8 bytes",
		});
	}
	const encrypted = decodeBase64(ciphertext);
	if (encrypted.byteLength <= AES_GCM_TAG_BYTES) {
		throw providerError({
			operation: "notification-decrypt",
			message: "Wechat notification ciphertext is too short",
		});
	}

	try {
		const decipher = createDecipheriv(
			"aes-256-gcm",
			key,
			new TextEncoder().encode(nonce),
		);
		decipher.setAAD(new TextEncoder().encode(associatedData));
		decipher.setAuthTag(encrypted.slice(-AES_GCM_TAG_BYTES));
		const plaintext = new Uint8Array(
			Buffer.concat([
				decipher.update(encrypted.slice(0, -AES_GCM_TAG_BYTES)),
				decipher.final(),
			]),
		);
		return recordValue(
			JSON.parse(new TextDecoder().decode(plaintext)),
			"resource",
		);
	} catch (cause) {
		throw providerError({
			operation: "notification-decrypt",
			message: "Wechat notification could not be decrypted",
			cause,
		});
	}
}

export class WechatPaymentApiGateway implements WechatPaymentGateway {
	private readonly appId: string;
	private readonly mchId: string;
	private readonly merchantCertificateSerial: string;
	private readonly merchantPrivateKey: string;
	private readonly platformCertificateSerial: string;
	private readonly platformPublicKey: string;
	private readonly notifyUrl: string;
	private readonly baseUrl: string;
	private readonly fetcher: ProviderFetcher;
	private readonly now: () => Date;
	private readonly nonce: () => string;

	constructor(options: WechatPaymentGatewayOptions) {
		this.appId = requiredConfig(options.appId, "wechat-pay");
		this.mchId = requiredConfig(options.mchId, "wechat-pay");
		this.merchantCertificateSerial = requiredConfig(
			options.merchantCertificateSerial,
			"wechat-pay",
		);
		this.merchantPrivateKey = requiredConfig(
			options.merchantPrivateKey,
			"wechat-pay",
		);
		this.platformCertificateSerial = requiredConfig(
			options.platformCertificateSerial,
			"wechat-pay",
		);
		this.platformPublicKey = requiredConfig(
			options.platformPublicKey,
			"wechat-pay",
		);
		this.notifyUrl = requiredConfig(options.notifyUrl, "wechat-pay");
		this.baseUrl = options.baseUrl ?? DEFAULT_WECHAT_PAY_BASE_URL;
		this.fetcher = options.fetcher ?? fetch;
		this.now = options.now ?? (() => new Date());
		this.nonce = options.nonce ?? defaultNonce;
	}

	async createJsapiOrder(
		input: { orderId: string; openid: string; totalFen: number },
		context: AdapterCallContext,
	): Promise<{
		prepayId: string;
		payParams: WechatMiniProgramPayParams;
		trace: ExternalTrace;
	}> {
		const orderId = requiredInput(input.orderId, "orderId", 32);
		const openid = requiredInput(input.openid, "openid");
		const totalFen = requiredPositiveFen(input.totalFen);
		const body = JSON.stringify({
			appid: this.appId,
			mchid: this.mchId,
			description: "医院自费支付",
			out_trade_no: orderId,
			notify_url: this.notifyUrl,
			amount: { total: totalFen, currency: "CNY" },
			payer: { openid },
		});
		const nonce = this.nonce();
		const timestamp = unixSeconds(this.now);
		const response = await requestJson<WechatJsapiOrderResponse>(
			{
				provider: "wechat-pay",
				operation: "jsapi-prepay",
				url: new URL(JSAPI_ORDER_PATH, this.baseUrl).toString(),
				method: "POST",
				context,
				bodyText: body,
				headers: {
					Authorization: apiV3Authorization({
						method: "POST",
						path: JSAPI_ORDER_PATH,
						timestamp,
						nonce,
						body,
						mchId: this.mchId,
						merchantCertificateSerial: this.merchantCertificateSerial,
						merchantPrivateKey: this.merchantPrivateKey,
					}),
				},
				verifyResponse: (verification) =>
					verifyPlatformSignature({
						...verification,
						platformCertificateSerial: this.platformCertificateSerial,
						platformPublicKey: this.platformPublicKey,
						now: this.now,
						operation: "jsapi-prepay",
					}),
			},
			this.fetcher,
		);
		const prepayId =
			typeof response.data.prepay_id === "string"
				? response.data.prepay_id.trim()
				: "";
		if (!prepayId) {
			throw providerError({
				operation: "jsapi-prepay",
				message: "Wechat JSAPI response did not contain prepay_id",
				requestId: response.requestId,
			});
		}

		return {
			prepayId,
			payParams: payParams({
				appId: this.appId,
				prepayId,
				now: this.now,
				nonce: this.nonce,
				merchantPrivateKey: this.merchantPrivateKey,
			}),
			trace: paymentTrace("jsapi-prepay", response.requestId, prepayId),
		};
	}

	async query(
		input: { orderId: string },
		context: AdapterCallContext,
	): Promise<{ state: PaymentState; trace: ExternalTrace }> {
		const orderId = requiredInput(input.orderId, "orderId", 32);
		const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderId)}?mchid=${encodeURIComponent(this.mchId)}`;
		const nonce = this.nonce();
		const timestamp = unixSeconds(this.now);
		const response = await requestJson<WechatOrderQueryResponse>(
			{
				provider: "wechat-pay",
				operation: "order-query",
				url: new URL(path, this.baseUrl).toString(),
				method: "GET",
				context,
				headers: {
					Authorization: apiV3Authorization({
						method: "GET",
						path,
						timestamp,
						nonce,
						body: "",
						mchId: this.mchId,
						merchantCertificateSerial: this.merchantCertificateSerial,
						merchantPrivateKey: this.merchantPrivateKey,
					}),
				},
				verifyResponse: (verification) =>
					verifyPlatformSignature({
						...verification,
						platformCertificateSerial: this.platformCertificateSerial,
						platformPublicKey: this.platformPublicKey,
						now: this.now,
						operation: "order-query",
					}),
			},
			this.fetcher,
		);
		const state = mapTradeState(response.data.trade_state);
		const providerOrderId =
			typeof response.data.transaction_id === "string"
				? response.data.transaction_id.trim()
				: undefined;
		return {
			state,
			trace: paymentTrace("order-query", response.requestId, providerOrderId),
		};
	}
}

/**
 * 验证微信支付通知的 APIv3 签名并解密 resource。
 *
 * 必须先验签再解密和编排状态迁移；解密后的 provider 字段也只允许留在
 * callback adapter/mapper 内，不能原样写入日志、outbox 或小程序响应。
 */
export function verifyAndDecryptWechatPaymentNotification(input: {
	rawBody: Uint8Array;
	headers: Headers;
	options: WechatPaymentNotificationVerifierOptions;
}): WechatPaymentNotification {
	const requestId = responseHeader(input.headers, "Wechatpay-Request-Id");
	verifyPlatformSignature({
		rawBody: input.rawBody,
		headers: input.headers,
		statusCode: 200,
		requestId,
		platformCertificateSerial: requiredConfig(
			input.options.platformCertificateSerial,
			"wechat-pay",
		),
		platformPublicKey: requiredConfig(
			input.options.platformPublicKey,
			"wechat-pay",
		),
		now: input.options.now ?? (() => new Date()),
		operation: "notification-verify",
		...(input.options.maxClockSkewSeconds === undefined
			? {}
			: { maxClockSkewSeconds: input.options.maxClockSkewSeconds }),
	});

	let envelope: WechatPaymentNotificationEnvelope;
	try {
		envelope = JSON.parse(
			new TextDecoder().decode(input.rawBody),
		) as WechatPaymentNotificationEnvelope;
	} catch (cause) {
		throw providerError({
			operation: "notification-decrypt",
			message: "Wechat notification body was not valid JSON",
			...(requestId ? { requestId } : {}),
			cause,
		});
	}

	const notificationId = notificationText(envelope.id, "id");
	const eventType = notificationText(envelope.event_type, "event_type");
	const resource = recordValue(
		envelope.resource,
		"resource",
	) as WechatPaymentNotificationResource;
	return {
		notificationId,
		eventType,
		resource: decryptNotificationResource({
			resource,
			apiV3Key: input.options.apiV3Key,
		}),
	};
}

export function createWechatPaymentGateway(
	options: WechatPaymentGatewayOptions,
): WechatPaymentGateway {
	return new WechatPaymentApiGateway(options);
}
