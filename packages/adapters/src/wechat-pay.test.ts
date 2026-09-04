import {
	createCipheriv,
	createSign,
	generateKeyPairSync,
	createVerify,
} from "node:crypto";
import { expect, test } from "bun:test";
import {
	createWechatPaymentNotificationDecoder,
	mapWechatPaymentNotification,
	ProviderRequestError,
	verifyAndDecryptWechatPaymentNotification,
	WechatPaymentApiGateway,
} from "./index";

const context = {
	traceId: "test-wechat-pay-trace-001",
	idempotencyKey: "test-wechat-pay-idempotency-001",
};
const fixedNow = new Date("2026-08-15T00:00:00.000Z");
const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platformKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const merchantPrivateKey = merchantKeys.privateKey
	.export({ type: "pkcs8", format: "pem" })
	.toString();
const merchantPublicKey = merchantKeys.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();
const platformPrivateKey = platformKeys.privateKey
	.export({ type: "pkcs8", format: "pem" })
	.toString();
const platformPublicKey = platformKeys.publicKey
	.export({ type: "spki", format: "pem" })
	.toString();

function sign(message: string, privateKey: string): string {
	const signer = createSign("RSA-SHA256");
	signer.update(message, "utf8");
	signer.end();
	return signer.sign(privateKey).toString("base64");
}

function providerResponseHeaders(body: string, valid = true): Headers {
	const timestamp = Math.floor(fixedNow.getTime() / 1000).toString();
	const nonce = "provider-response-nonce";
	const signature = sign(
		`${timestamp}\n${nonce}\n${body}\n`,
		valid ? platformPrivateKey : merchantPrivateKey,
	);
	return new Headers({
		"Wechatpay-Serial": "platform-serial-001",
		"Wechatpay-Signature": signature,
		"Wechatpay-Timestamp": timestamp,
		"Wechatpay-Nonce": nonce,
		"Wechatpay-Request-Id": "provider-request-001",
	});
}

function verifyRequestAuthorization(
	init: RequestInit | undefined,
	method: string,
	path: string,
	body: string,
): void {
	const headers = new Headers(init?.headers);
	const authorization = headers.get("Authorization") ?? "";
	const timestamp = authorization.match(/timestamp="([^"]+)"/)?.[1];
	const nonce = authorization.match(/nonce_str="([^"]+)"/)?.[1];
	const signature = authorization.match(/signature="([^"]+)"/)?.[1];
	expect(authorization.startsWith("WECHATPAY2-SHA256-RSA2048 ")).toBe(true);
	expect(timestamp).toBe("1786752000");
	expect(nonce).toBeTruthy();
	expect(signature).toBeTruthy();
	const verifier = createVerify("RSA-SHA256");
	verifier.update(
		`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`,
		"utf8",
	);
	verifier.end();
	expect(
		verifier.verify(merchantPublicKey, Buffer.from(signature ?? "", "base64")),
	).toBe(true);
}

function createGateway(
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	nonces: string[] = ["request-nonce-001", "pay-nonce-001"],
	merchantPrivateKeyOverride = merchantPrivateKey,
): WechatPaymentApiGateway {
	return new WechatPaymentApiGateway({
		appId: "wx-app-001",
		mchId: "mch-001",
		merchantCertificateSerial: "merchant-serial-001",
		merchantPrivateKey: merchantPrivateKeyOverride,
		platformCertificateSerial: "platform-serial-001",
		platformPublicKey,
		apiV3Key: "0123456789abcdef0123456789abcdef",
		notifyUrl: "https://hospital.example.test/api/v1/payments/wechat/notify",
		baseUrl: "https://pay.example.test",
		now: () => fixedNow,
		nonce: () => nonces.shift() ?? "fallback-nonce",
		fetcher,
	});
}

test("systemd 转义的 PEM 换行可以用于 APIv3 查单签名", async () => {
	const body = JSON.stringify({
		trade_state: "NOTPAY",
		amount: { total: 6202 },
	});
	const escapedMerchantPrivateKey = merchantPrivateKey.replaceAll("\n", "\\n");
	const gateway = createGateway(
		async (_input, init) => {
			verifyRequestAuthorization(
				init,
				"GET",
				"/v3/pay/transactions/out-trade-no/order-escaped-001?mchid=mch-001",
				"",
			);
			return new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body),
			});
		},
		["request-nonce-escaped-001"],
		escapedMerchantPrivateKey,
	);

	const result = await gateway.query({ orderId: "order-escaped-001" }, context);

	expect(result.state).toBe("cash_pending");
	expect(result.totalFen).toBe(6202);
});

test("微信 JSAPI 下单使用 APIv3 签名并返回服务端调起参数", async () => {
	let requestBody = "";
	const body = JSON.stringify({ prepay_id: "wx-prepay-001" });
	const gateway = createGateway(async (_input, init) => {
		requestBody = typeof init?.body === "string" ? init.body : "";
		verifyRequestAuthorization(
			init,
			"POST",
			"/v3/pay/transactions/jsapi",
			requestBody,
		);
		return new Response(body, {
			status: 200,
			headers: providerResponseHeaders(body),
		});
	});

	const result = await gateway.createJsapiOrder(
		{ orderId: "order-001", openid: "openid-001", totalFen: 6202 },
		context,
	);

	expect(JSON.parse(requestBody)).toEqual({
		appid: "wx-app-001",
		mchid: "mch-001",
		description: "医院自费支付",
		out_trade_no: "order-001",
		notify_url: "https://hospital.example.test/api/v1/payments/wechat/notify",
		amount: { total: 6202, currency: "CNY" },
		payer: { openid: "openid-001" },
	});
	expect(result).toMatchObject({
		prepayId: "wx-prepay-001",
		payParams: {
			appId: "wx-app-001",
			timeStamp: "1786752000",
			package: "prepay_id=wx-prepay-001",
			signType: "RSA",
		},
		trace: {
			provider: "wechat-pay",
			operation: "jsapi-prepay",
			requestId: "provider-request-001",
			providerOrderId: "wx-prepay-001",
		},
	});
});

test("微信支付响应证书序列号或签名不匹配时 fail closed", async () => {
	const body = JSON.stringify({ prepay_id: "wx-prepay-002" });
	const gateway = createGateway(
		async () =>
			new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body, false),
			}),
	);

	await expect(
		gateway.createJsapiOrder(
			{ orderId: "order-002", openid: "openid-002", totalFen: 1 },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		retryable: false,
		requestId: "provider-request-001",
	});
});

test("微信订单查询只把已验签的 SUCCESS 映射为 cash_paid", async () => {
	const body = JSON.stringify({
		trade_state: "SUCCESS",
		transaction_id: "4200000000000001",
		amount: { total: 300 },
	});
	const gateway = createGateway(
		async (_input, init) => {
			verifyRequestAuthorization(
				init,
				"GET",
				"/v3/pay/transactions/out-trade-no/order-003?mchid=mch-001",
				"",
			);
			return new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body),
			});
		},
		["query-nonce-001"],
	);

	await expect(
		gateway.query({ orderId: "order-003" }, context),
	).resolves.toEqual({
		state: "cash_paid",
		totalFen: 300,
		trace: {
			provider: "wechat-pay",
			operation: "order-query",
			requestId: "provider-request-001",
			providerOrderId: "4200000000000001",
		},
	});
});

test("微信查单返回 ORDER_NOT_EXIST 时保留可重试的业务原因", async () => {
	const gateway = createGateway(
		async (_input, init) => {
			verifyRequestAuthorization(
				init,
				"GET",
				"/v3/pay/transactions/out-trade-no/order-missing-001?mchid=mch-001",
				"",
			);
			return new Response(
				JSON.stringify({ code: "ORDER_NOT_EXIST", message: "订单不存在" }),
				{ status: 404 },
			);
		},
		["query-nonce-missing-001"],
	);

	await expect(
		gateway.query({ orderId: "order-missing-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		statusCode: 404,
		requestOutcome: "rejected",
		reason: "payment-order-not-found",
		providerErrorCode: "ORDER_NOT_EXIST",
		providerErrorMessage: "订单不存在",
	});
});

test("微信支付通知先验签，再解密 AES-256-GCM resource", () => {
	const apiV3Key = "0123456789abcdef0123456789abcdef";
	const resourceNonce = "123456789012";
	const associatedData = "transaction";
	const plaintext = JSON.stringify({
		transaction_id: "4200000000000002",
		trade_state: "SUCCESS",
		amount: { total: 6202 },
	});
	const cipher = createCipheriv(
		"aes-256-gcm",
		Buffer.from(apiV3Key, "utf8"),
		Buffer.from(resourceNonce, "utf8"),
	);
	cipher.setAAD(Buffer.from(associatedData, "utf8"));
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
		cipher.getAuthTag(),
	]).toString("base64");
	const body = JSON.stringify({
		id: "notification-001",
		event_type: "TRANSACTION.SUCCESS",
		resource: {
			algorithm: "AEAD_AES_256_GCM",
			ciphertext: encrypted,
			nonce: resourceNonce,
			associated_data: associatedData,
		},
	});

	const headers = providerResponseHeaders(body);
	headers.set("Wechatpay-Request-Id", "notification-request-001");
	const result = verifyAndDecryptWechatPaymentNotification({
		rawBody: new TextEncoder().encode(body),
		headers,
		options: {
			platformCertificateSerial: "platform-serial-001",
			platformPublicKey,
			apiV3Key,
			now: () => fixedNow,
		},
	});

	expect(result).toEqual({
		notificationId: "notification-001",
		eventType: "TRANSACTION.SUCCESS",
		resource: {
			transaction_id: "4200000000000002",
			trade_state: "SUCCESS",
			amount: { total: 6202 },
		},
	});
});

test("微信支付通知 mapper 只保留可校验的白名单事实", () => {
	const mapped = mapWechatPaymentNotification({
		notification: {
			notificationId: "notification-map-001",
			eventType: "TRANSACTION.SUCCESS",
			resource: {
				appid: "wx-app-001",
				mchid: "mch-001",
				out_trade_no: "order-map-001",
				transaction_id: "4200000000000099",
				trade_state: "SUCCESS",
				amount: { total: 300 },
				payer: { openid: "must-not-cross-adapter-boundary" },
			},
		},
		receivedAt: "2026-08-15T00:00:01.000Z",
		expectedAppId: "wx-app-001",
		expectedMchId: "mch-001",
	});

	expect(mapped).toEqual({
		notificationId: "notification-map-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "order-map-001",
		tradeState: "SUCCESS",
		totalFen: 300,
		providerTransactionId: "4200000000000099",
		receivedAt: "2026-08-15T00:00:01.000Z",
	});
	expect(JSON.stringify(mapped)).not.toContain(
		"must-not-cross-adapter-boundary",
	);
});

test("微信支付通知 mapper rejects a success event with an invalid amount", () => {
	expect(() =>
		mapWechatPaymentNotification({
			notification: {
				notificationId: "notification-map-002",
				eventType: "TRANSACTION.SUCCESS",
				resource: {
					out_trade_no: "order-map-002",
					transaction_id: "4200000000000100",
					trade_state: "SUCCESS",
					amount: { total: 0 },
				},
			},
			receivedAt: "2026-08-15T00:00:01.000Z",
		}),
	).toThrow(ProviderRequestError);
});

test("微信支付通知 decoder 固定执行验签、解密和白名单映射", () => {
	const apiV3Key = "0123456789abcdef0123456789abcdef";
	const resourceNonce = "123456789012";
	const associatedData = "transaction";
	const plaintext = JSON.stringify({
		appid: "wx-app-001",
		mchid: "mch-001",
		out_trade_no: "order-decoder-001",
		transaction_id: "4200000000000101",
		trade_state: "SUCCESS",
		amount: { total: 300 },
		payer: { openid: "must-not-leave-adapter" },
	});
	const cipher = createCipheriv(
		"aes-256-gcm",
		Buffer.from(apiV3Key, "utf8"),
		Buffer.from(resourceNonce, "utf8"),
	);
	cipher.setAAD(Buffer.from(associatedData, "utf8"));
	const encrypted = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
		cipher.getAuthTag(),
	]).toString("base64");
	const body = JSON.stringify({
		id: "notification-decoder-001",
		event_type: "TRANSACTION.SUCCESS",
		resource: {
			algorithm: "AEAD_AES_256_GCM",
			ciphertext: encrypted,
			nonce: resourceNonce,
			associated_data: associatedData,
		},
	});
	const headers = providerResponseHeaders(body);
	const decoder = createWechatPaymentNotificationDecoder({
		platformCertificateSerial: "platform-serial-001",
		platformPublicKey,
		apiV3Key,
		now: () => fixedNow,
		expectedAppId: "wx-app-001",
		expectedMchId: "mch-001",
	});

	const mapped = decoder({
		rawBody: new TextEncoder().encode(body),
		headers,
		receivedAt: "2026-08-15T00:00:01.000Z",
	});

	expect(mapped).toEqual({
		notificationId: "notification-decoder-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "order-decoder-001",
		tradeState: "SUCCESS",
		totalFen: 300,
		providerTransactionId: "4200000000000101",
		receivedAt: "2026-08-15T00:00:01.000Z",
	});
	expect(JSON.stringify(mapped)).not.toContain("must-not-leave-adapter");
});

test("微信支付通知签名被篡改时不进入解密流程", () => {
	const body = JSON.stringify({
		id: "notification-002",
		event_type: "TRANSACTION.SUCCESS",
		resource: {},
	});
	const headers = providerResponseHeaders(body);
	headers.set("Wechatpay-Signature", "tampered");

	expect(() =>
		verifyAndDecryptWechatPaymentNotification({
			rawBody: new TextEncoder().encode(body),
			headers,
			options: {
				platformCertificateSerial: "platform-serial-001",
				platformPublicKey,
				apiV3Key: "0123456789abcdef0123456789abcdef",
				now: () => fixedNow,
			},
		}),
	).toThrow(ProviderRequestError);
});
