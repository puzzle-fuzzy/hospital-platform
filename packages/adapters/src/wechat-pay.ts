import {
	constants,
	createDecipheriv,
	createHash,
	createSign,
	createVerify,
	publicEncrypt,
	randomUUID,
} from "node:crypto";
import type {
	AdapterCallContext,
	ExternalTrace,
	MedicalInsuranceWechatPaymentGateway,
	WechatPaymentNotification as WechatPaymentNotificationRecord,
	WechatMiniProgramPayParams,
	WechatPaymentGateway,
	WechatPaymentQueryState,
	WechatMedicalInsurancePayParams,
} from "@hospital/domain";
import { assertValidMedicalInsuranceAmounts } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { requestJson, type ProviderFetcher } from "./http";

const DEFAULT_WECHAT_PAY_BASE_URL = "https://api.mch.weixin.qq.com";
const JSAPI_ORDER_PATH = "/v3/pay/transactions/jsapi";
const MEDICAL_MIX_ORDER_PATH = "/v3/med-ins/orders";
const PLATFORM_SIGNATURE_MAX_SKEW_SECONDS = 300;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_KEY_BYTES = 32;

type WechatJsapiOrderResponse = {
	prepay_id?: unknown;
};

type WechatOrderQueryResponse = {
	trade_state?: unknown;
	transaction_id?: unknown;
	amount?: unknown;
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
	/** APIv3 密钥；用于支付通知解密，完整支付配置必须同时提供。 */
	apiV3Key: string;
	/** 微信支付通知地址；必须由服务端配置，不能由订单请求覆盖。 */
	notifyUrl: string;
	baseUrl?: string;
	fetcher?: ProviderFetcher;
	/** 测试注入时钟；生产使用当前时间。 */
	now?: () => Date;
	/** 测试注入随机数；生产使用 node:crypto 的 randomUUID。 */
	nonce?: () => string;
	/** 医保混合支付的官方微信医保商户参数；普通自费支付不依赖这组字段。 */
	medicalInsurance?: WechatMedicalInsuranceOptions;
};

export type WechatMedicalInsuranceOptions = {
	appId: string;
	cityId: string;
	orderType: string;
	medicalInstitutionName: string;
	medicalInstitutionNo: string;
	callbackUrl: string;
	geoLocation: string;
	channelNo?: string;
	testEnvironment?: boolean;
};

export type WechatPaymentNotificationVerifierOptions = {
	platformCertificateSerial: string;
	platformPublicKey: string;
	apiV3Key: string;
	/** 解密后再次校验商户归属，防止把其他商户的合法通知写入本库。 */
	expectedAppId?: string;
	expectedMchId?: string;
	now?: () => Date;
	maxClockSkewSeconds?: number;
};

export type WechatPaymentNotification = {
	notificationId: string;
	eventType: string;
	resource: Record<string, unknown>;
};

export type WechatPaymentNotificationDecoderInput = {
	rawBody: Uint8Array;
	headers: Headers;
	receivedAt: string;
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

function requiredNonNegativeFen(value: number, field: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new ProviderRequestError({
			provider: "wechat-pay",
			operation: "medical-mix-validation",
			message: `Wechat medical payment ${field} must be a non-negative safe integer`,
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

function encryptMedicalSensitive(
	value: string,
	platformPublicKey: string,
): string {
	try {
		return publicEncrypt(
			{
				key: platformPublicKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha1",
			},
			Buffer.from(value, "utf8"),
		).toString("base64");
	} catch (cause) {
		throw providerError({
			operation: "medical-mix-validation",
			message: "Wechat medical payer encryption failed",
			cause,
		});
	}
}

function medicalIdDigest(value: string): string {
	const normalized = value.replaceAll(/\s/g, "").toUpperCase();
	const idNo = /^\d{15}$/.test(normalized)
		? medicalId18From15(normalized)
		: normalized;
	return createHash("md5").update(idNo, "utf8").digest("hex");
}

function medicalId18From15(value: string): string {
	const base = `${value.slice(0, 6)}19${value.slice(6)}`;
	const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
	const checks = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
	const sum = Array.from(base).reduce((total, digit, index) => {
		const weight = weights[index];
		if (weight === undefined)
			throw new Error("Invalid 15-digit identity number");
		return total + Number(digit) * weight;
	}, 0);
	const check = checks[sum % 11];
	if (!check) throw new Error("Invalid identity number checksum");
	return `${base}${check}`;
}

function findProviderText(
	value: unknown,
	keys: readonly string[],
	depth = 0,
): string | undefined {
	if (depth > 4 || value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findProviderText(item, keys, depth + 1);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value !== "object") return undefined;
	const object = value as Record<string, unknown>;
	for (const key of keys) {
		const candidate = object[key];
		if (typeof candidate === "string" && candidate.trim())
			return candidate.trim();
	}
	for (const candidate of Object.values(object)) {
		const found = findProviderText(candidate, keys, depth + 1);
		if (found) return found;
	}
	return undefined;
}

function providerFen(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string" && /^\d+$/.test(value.trim())) {
		const parsed = Number(value.trim());
		if (Number.isSafeInteger(parsed)) return parsed;
	}
	throw providerError({
		operation: "medical-mix-query",
		message: `Wechat medical response ${field} was not a valid fen amount`,
	});
}

function medicalProviderState(
	value: unknown,
	field: string,
): "pending" | "paid" | "failed" {
	if (
		value === "MIX_PAY_SUCCESS" ||
		value === "SELF_PAY_SUCCESS" ||
		value === "MED_INS_PAY_SUCCESS"
	)
		return "paid";
	if (
		value === "MIX_PAY_CREATED" ||
		value === "SELF_PAY_CREATED" ||
		value === "MED_INS_PAY_CREATED"
	)
		return "pending";
	if (
		value === "MIX_PAY_FAIL" ||
		value === "MIX_PAY_REFUND" ||
		value === "SELF_PAY_FAIL" ||
		value === "SELF_PAY_REFUND" ||
		value === "MED_INS_PAY_FAIL" ||
		value === "MED_INS_PAY_REFUND"
	)
		return "failed";
	throw providerError({
		operation: "medical-mix-query",
		message: `Wechat medical response ${field} contained an unsupported state`,
	});
}

function mapTradeState(value: unknown): WechatPaymentQueryState {
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

function queryTotalFen(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw providerError({
			operation: "order-query",
			message: "Wechat order query amount.total was invalid",
		});
	}
	return value as number;
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

function mappedNotificationText(
	value: unknown,
	field: string,
	maxLength = 128,
): string {
	if (typeof value !== "string") {
		throw providerError({
			operation: "notification-map",
			message: `Wechat notification field ${field} is invalid`,
		});
	}
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength) {
		throw providerError({
			operation: "notification-map",
			message: `Wechat notification field ${field} is invalid`,
		});
	}
	return normalized;
}

function notificationFen(value: unknown): number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw providerError({
			operation: "notification-map",
			message: "Wechat notification amount.total is invalid",
		});
	}
	return value as number;
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

export class WechatPaymentApiGateway
	implements WechatPaymentGateway, MedicalInsuranceWechatPaymentGateway
{
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
	private readonly medicalInsurance?: WechatMedicalInsuranceOptions;

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
		requiredConfig(options.apiV3Key, "wechat-pay");
		this.notifyUrl = requiredConfig(options.notifyUrl, "wechat-pay");
		this.baseUrl = options.baseUrl ?? DEFAULT_WECHAT_PAY_BASE_URL;
		this.fetcher = options.fetcher ?? fetch;
		this.now = options.now ?? (() => new Date());
		this.nonce = options.nonce ?? defaultNonce;
		if (options.medicalInsurance) {
			this.medicalInsurance = {
				appId: requiredConfig(options.medicalInsurance.appId, "wechat-pay"),
				cityId: requiredConfig(options.medicalInsurance.cityId, "wechat-pay"),
				orderType: requiredConfig(
					options.medicalInsurance.orderType,
					"wechat-pay",
				),
				medicalInstitutionName: requiredConfig(
					options.medicalInsurance.medicalInstitutionName,
					"wechat-pay",
				),
				medicalInstitutionNo: requiredConfig(
					options.medicalInsurance.medicalInstitutionNo,
					"wechat-pay",
				),
				callbackUrl: requiredConfig(
					options.medicalInsurance.callbackUrl,
					"wechat-pay",
				),
				geoLocation: requiredConfig(
					options.medicalInsurance.geoLocation,
					"wechat-pay",
				),
				...(options.medicalInsurance.channelNo
					? {
							channelNo: requiredInput(
								options.medicalInsurance.channelNo,
								"channelNo",
							),
						}
					: {}),
				testEnvironment: options.medicalInsurance.testEnvironment === true,
			};
		}
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
	): Promise<{
		state: WechatPaymentQueryState;
		totalFen: number;
		trace: ExternalTrace;
	}> {
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
		const amount = response.data.amount;
		if (
			typeof amount !== "object" ||
			amount === null ||
			Array.isArray(amount)
		) {
			throw providerError({
				operation: "order-query",
				message: "Wechat order query amount was invalid",
			});
		}
		const totalFen = queryTotalFen((amount as { total?: unknown }).total);
		const providerOrderId =
			typeof response.data.transaction_id === "string"
				? response.data.transaction_id.trim()
				: undefined;
		return {
			state,
			totalFen,
			trace: paymentTrace("order-query", response.requestId, providerOrderId),
		};
	}

	/**
	 * 医保混合订单：先创建同一 out_trade_no 的 JSAPI 自费预支付，再创建
	 * 官方微信医保混合订单。两次请求均由服务端生成并签名，前端只收到调起参数。
	 */
	async createMixedOrder(
		input: Parameters<
			MedicalInsuranceWechatPaymentGateway["createMixedOrder"]
		>[0],
		context: AdapterCallContext,
	): ReturnType<MedicalInsuranceWechatPaymentGateway["createMixedOrder"]> {
		const medical = this.medicalInsurance;
		if (!medical) throw new AdapterNotConfiguredError("wechat-pay");
		requiredInput(input.orderId, "orderId", 64);
		const outTradeNo = requiredInput(input.outTradeNo, "outTradeNo", 32);
		const openid = requiredInput(input.openid, "openid");
		const payOrdId = requiredInput(input.payOrdId, "payOrdId", 64);
		const medOrgOrd = requiredInput(input.medOrgOrd, "medOrgOrd", 64);
		const amounts = assertValidMedicalInsuranceAmounts(input.amounts);
		if (medical.appId !== this.appId) {
			throw providerError({
				operation: "medical-mix-validation",
				message: "Wechat medical appId must match the JSAPI payment appId",
			});
		}
		if (amounts.cashFen <= 0) {
			throw providerError({
				operation: "medical-mix-prepay",
				message: "Wechat medical mixed order requires a positive cash amount",
			});
		}
		const patientName = requiredInput(
			input.authorization.patient.userName,
			"patientName",
			512,
		);
		const patientIdNo = requiredInput(
			input.authorization.patient.idNo,
			"patientIdNo",
			32,
		);

		const prepay = await this.createJsapiOrder(
			{ orderId: outTradeNo, openid, totalFen: amounts.cashFen },
			context,
		);
		const body = JSON.stringify({
			mix_pay_type: "CASH_AND_INSURANCE",
			order_type: medical.orderType,
			out_trade_no: outTradeNo,
			serial_no: medOrgOrd,
			med_inst_name: medical.medicalInstitutionName,
			med_inst_no: medical.medicalInstitutionNo,
			total_fee: amounts.totalFen,
			appid: medical.appId,
			openid,
			payer: {
				name: encryptMedicalSensitive(patientName, this.platformPublicKey),
				id_digest: encryptMedicalSensitive(
					medicalIdDigest(patientIdNo),
					this.platformPublicKey,
				),
				card_type: "ID_CARD",
			},
			city_id: medical.cityId,
			pay_order_id: payOrdId,
			pay_auth_no: input.authorization.payAuthNo,
			geo_location: medical.geoLocation,
			med_ins_gov_fee: amounts.fundFen,
			med_ins_self_fee: amounts.personalAccountFen,
			med_ins_other_fee: 0,
			med_ins_cash_fee: amounts.cashFen,
			wechat_pay_cash_fee: amounts.cashFen,
			med_ins_order_create_time: this.now().toISOString(),
			callback_url: medical.callbackUrl,
			prepay_id: prepay.prepayId,
			...(medical.channelNo ? { channel_no: medical.channelNo } : {}),
			...(medical.testEnvironment ? { med_ins_test_env: true } : {}),
		});
		const nonce = this.nonce();
		const timestamp = unixSeconds(this.now);
		const response = await requestJson<Record<string, unknown>>(
			{
				provider: "wechat-pay",
				operation: "medical-mix-create",
				url: new URL(MEDICAL_MIX_ORDER_PATH, this.baseUrl).toString(),
				method: "POST",
				context,
				bodyText: body,
				headers: {
					"Wechatpay-Serial": this.platformCertificateSerial,
					Authorization: apiV3Authorization({
						method: "POST",
						path: MEDICAL_MIX_ORDER_PATH,
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
						operation: "medical-mix-create",
					}),
			},
			this.fetcher,
		);
		const mixTradeNo = findProviderText(response.data, [
			"mix_trade_no",
			"mixTradeNo",
		]);
		if (!mixTradeNo) {
			throw providerError({
				operation: "medical-mix-create",
				message: "Wechat medical mixed order did not contain mix_trade_no",
				requestId: response.requestId,
			});
		}
		const medicalPayParams: WechatMedicalInsurancePayParams = {
			...prepay.payParams,
			mixTradeNo: requiredInput(mixTradeNo, "mixTradeNo", 64),
		};
		return {
			mixTradeNo: medicalPayParams.mixTradeNo,
			prepayId: prepay.prepayId,
			payParams: medicalPayParams,
			cashFen: amounts.cashFen,
			trace: {
				provider: "wechat-pay",
				operation: "medical-mix-create",
				requestId: response.requestId,
				requestIds: [prepay.trace.requestId, response.requestId],
				providerOrderId: mixTradeNo,
			},
		};
	}

	async queryMixedOrder(
		input: Parameters<
			MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]
		>[0],
		context: AdapterCallContext,
	): ReturnType<MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]> {
		const medical = this.medicalInsurance;
		if (!medical) throw new AdapterNotConfiguredError("wechat-pay");
		const mixTradeNo = requiredInput(input.mixTradeNo, "mixTradeNo", 64);
		const expectedTotalFen = requiredNonNegativeFen(
			input.expectedTotalFen,
			"totalFen",
		);
		const expectedCashFen = requiredNonNegativeFen(
			input.expectedCashFen,
			"cashFen",
		);
		const path = `${MEDICAL_MIX_ORDER_PATH}/mix-trade-no/${encodeURIComponent(mixTradeNo)}`;
		const nonce = this.nonce();
		const timestamp = unixSeconds(this.now);
		const response = await requestJson<Record<string, unknown>>(
			{
				provider: "wechat-pay",
				operation: "medical-mix-query",
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
						operation: "medical-mix-query",
					}),
			},
			this.fetcher,
		);
		const data = response.data;
		const mixStatus = findProviderText(data, ["mix_pay_status"]);
		const selfStatus = findProviderText(data, ["self_pay_status"]);
		const medicalStatus = findProviderText(data, ["med_ins_pay_status"]);
		if (!mixStatus || !selfStatus || !medicalStatus) {
			throw providerError({
				operation: "medical-mix-query",
				message: "Wechat medical query did not contain payment status fields",
				requestId: response.requestId,
			});
		}
		const dataRecord = data as Record<string, unknown>;
		const totalFen =
			providerFen(dataRecord.total_fee ?? dataRecord.totalFee, "total_fee") ??
			expectedTotalFen;
		const cashFen =
			providerFen(
				dataRecord.wechat_pay_cash_fee ?? dataRecord.wechatPayCashFee,
				"wechat_pay_cash_fee",
			) ?? expectedCashFen;
		if (totalFen !== expectedTotalFen || cashFen !== expectedCashFen) {
			throw providerError({
				operation: "medical-mix-query",
				message: "Wechat medical query amount did not match the order",
				requestId: response.requestId,
			});
		}
		return {
			cashState: medicalProviderState(selfStatus, "self_pay_status"),
			insuranceState: medicalProviderState(medicalStatus, "med_ins_pay_status"),
			cashFen,
			totalFen,
			providerStatus: [mixStatus, selfStatus, medicalStatus]
				.filter(Boolean)
				.join("/"),
			trace: paymentTrace("medical-mix-query", response.requestId, mixTradeNo),
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

/**
 * 将已验签、已解密的微信通知收窄成内部白名单事实。
 *
 * 该 mapper 不向上层暴露 payer、appid、mchid 或 provider 原始 resource；
 * 金额也必须是成功通知中的整数分，后续应用服务还要和订单 cashFen 比对。
 */
export function mapWechatPaymentNotification(input: {
	notification: WechatPaymentNotification;
	receivedAt: string;
	expectedAppId?: string;
	expectedMchId?: string;
}): WechatPaymentNotificationRecord {
	if (input.notification.eventType !== "TRANSACTION.SUCCESS") {
		throw providerError({
			operation: "notification-map",
			message: "Wechat notification event type is unsupported",
		});
	}

	const resource = input.notification.resource;
	if (
		input.expectedAppId !== undefined &&
		mappedNotificationText(resource.appid, "appid") !== input.expectedAppId
	) {
		throw providerError({
			operation: "notification-map",
			message: "Wechat notification appid did not match",
		});
	}
	if (
		input.expectedMchId !== undefined &&
		mappedNotificationText(resource.mchid, "mchid") !== input.expectedMchId
	) {
		throw providerError({
			operation: "notification-map",
			message: "Wechat notification mchid did not match",
		});
	}

	const tradeState = mappedNotificationText(
		resource.trade_state,
		"trade_state",
	);
	if (tradeState !== "SUCCESS") {
		throw providerError({
			operation: "notification-map",
			message: "Wechat success notification did not contain SUCCESS state",
		});
	}
	const amount = recordValue(resource.amount, "amount");
	return {
		notificationId: mappedNotificationText(
			input.notification.notificationId,
			"notificationId",
			64,
		),
		eventType: "TRANSACTION.SUCCESS",
		orderId: mappedNotificationText(resource.out_trade_no, "out_trade_no", 64),
		tradeState: "SUCCESS",
		totalFen: notificationFen(amount.total),
		providerTransactionId: mappedNotificationText(
			resource.transaction_id,
			"transaction_id",
		),
		receivedAt: input.receivedAt,
	};
}

/**
 * 创建微信支付通知 decoder，固定执行“原文验签 → resource 解密 → 白名单映射”。
 *
 * 组合根只需要注入这一份函数，避免 API 入口自行拼接安全步骤；任何一步失败
 * 都会在进入领域事实和 outbox 之前终止。该 decoder 不记录或返回 provider 原始报文。
 */
export function createWechatPaymentNotificationDecoder(
	options: WechatPaymentNotificationVerifierOptions,
): (
	input: WechatPaymentNotificationDecoderInput,
) => WechatPaymentNotificationRecord {
	return ({ rawBody, headers, receivedAt }) => {
		const notification = verifyAndDecryptWechatPaymentNotification({
			rawBody,
			headers,
			options,
		});
		return mapWechatPaymentNotification({
			notification,
			receivedAt,
			...(options.expectedAppId === undefined
				? {}
				: { expectedAppId: options.expectedAppId }),
			...(options.expectedMchId === undefined
				? {}
				: { expectedMchId: options.expectedMchId }),
		});
	};
}

export function createWechatPaymentGateway(
	options: WechatPaymentGatewayOptions,
): WechatPaymentApiGateway {
	return new WechatPaymentApiGateway(options);
}
