import { expect, test } from "bun:test";
import {
	constants,
	createCipheriv,
	createHash,
	createSign,
	createVerify,
	generateKeyPairSync,
	privateDecrypt,
} from "node:crypto";
import type { MedicalInsuranceWechatPaymentGateway } from "@hospital/domain";
import { ProviderRequestError } from "./errors";
import {
	createWechatMedicalInsuranceNotificationDecoder,
	createWechatPaymentNotificationDecoder,
	mapWechatPaymentNotification,
	verifyAndDecryptWechatPaymentNotification,
	WechatPaymentApiGateway,
} from "./wechat-pay";

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

function createMedicalGateway(
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
	nonces: string[] = ["medical-jsapi-nonce", "medical-mix-nonce"],
): WechatPaymentApiGateway {
	return new WechatPaymentApiGateway({
		appId: "wx-app-001",
		mchId: "mch-001",
		merchantCertificateSerial: "merchant-serial-001",
		merchantPrivateKey,
		platformCertificateSerial: "platform-serial-001",
		platformPublicKey,
		apiV3Key: "0123456789abcdef0123456789abcdef",
		notifyUrl: "https://hospital.example.test/api/v1/payments/wechat/notify",
		baseUrl: "https://pay.example.test",
		now: () => fixedNow,
		nonce: () => nonces.shift() ?? "fallback-nonce",
		fetcher,
		medicalInsurance: {
			appId: "wx-app-001",
			cityId: "140500",
			medicalInstitutionName: "高平市人民医院",
			medicalInstitutionNo: "H14058101270",
			callbackUrl:
				"https://hospital.example.test/api/v1/payments/medical-insurance/wechat-notifications",
			geoLocation: "112.9236,35.7981",
		},
	});
}

function medicalCreateInput(input: {
	outTradeNo: string;
	pure?: boolean;
}): Parameters<MedicalInsuranceWechatPaymentGateway["createMixedOrder"]>[0] {
	const pure = input.pure === true;
	return {
		orderId: `medical-${input.outTradeNo}`,
		outTradeNo: input.outTradeNo,
		openid: pure ? "openid-pure-001" : "openid-001",
		payOrdId: pure ? "pay-ord-pure-001" : "pay-ord-001",
		medOrgOrd: pure ? "med-org-pure-001" : "med-org-001",
		orderType: "RegPay",
		amounts: pure
			? {
					totalFen: 900,
					cashFen: 0,
					personalAccountFen: 300,
					fundFen: 600,
				}
			: {
					totalFen: 1100,
					cashFen: 200,
					personalAccountFen: 300,
					fundFen: 500,
					otherPaymentFen: 100,
				},
		authorization: {
			patient: { idNo: "140581199001010011", userName: "测试患者" },
			payAuthNo: "pay-auth-001",
		} as never,
		settlement: {} as never,
		paymentIdentity: pure
			? {
					payForRelatives: false,
					payer: { name: "测试患者", idNo: "140581199001010011" },
				}
			: {
					payForRelatives: true,
					payer: { name: "成年付款人", idNo: "140581198001010022" },
					relative: { name: "测试患者", idNo: "140581199001010011" },
				},
		medicalOrderCreateTime: "2026-08-14T12:00:00.000Z",
	};
}

function recoveredMedicalOrderBody(input: {
	mixTradeNo: string;
	outTradeNo: string;
	pure?: boolean;
}): string {
	const pure = input.pure === true;
	return JSON.stringify({
		mix_trade_no: input.mixTradeNo,
		mix_pay_status: "MIX_PAY_CREATED",
		self_pay_status: pure ? "NO_SELF_PAY" : "SELF_PAY_CREATED",
		med_ins_pay_status: "MED_INS_PAY_CREATED",
		mix_pay_type: pure ? "INSURANCE_ONLY" : "CASH_AND_INSURANCE",
		order_type: "REG_PAY",
		appid: "wx-app-001",
		openid: pure ? "openid-pure-001" : "openid-001",
		pay_for_relatives: !pure,
		out_trade_no: input.outTradeNo,
		serial_no: pure ? "med-org-pure-001" : "med-org-001",
		pay_order_id: pure ? "pay-ord-pure-001" : "pay-ord-001",
		med_inst_no: "H14058101270",
		total_fee: pure ? 900 : 1100,
		med_ins_gov_fee: pure ? 600 : 500,
		med_ins_self_fee: 300,
		med_ins_other_fee: pure ? 0 : 100,
		med_ins_cash_fee: pure ? 0 : 200,
		...(pure
			? {}
			: {
					wechat_pay_cash_fee: 200,
					prepay_id: "wx-medical-prepay-recovery-001",
				}),
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

test("医保混合下单使用 APIv3 JSAPI 预下单和官方医保混合下单", async () => {
	const requests: Array<{ path: string; body: string }> = [];
	const responses = [
		JSON.stringify({ prepay_id: "wx-medical-prepay-001" }),
		JSON.stringify({ mix_trade_no: "mix-trade-001" }),
	];
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = String(_input);
		const path = new URL(url).pathname;
		const body = typeof init?.body === "string" ? init.body : "";
		requests.push({ path, body });
		verifyRequestAuthorization(init, "POST", path, body);
		if (path === "/v3/med-ins/orders") {
			expect(new Headers(init?.headers).get("Wechatpay-Serial")).toBe(
				"platform-serial-001",
			);
		}
		const responseBody = responses.shift();
		if (!responseBody) throw new Error("unexpected provider request");
		return new Response(responseBody, {
			status: 200,
			headers: providerResponseHeaders(responseBody),
		});
	});

	const result = await gateway.createMixedOrder(
		{
			orderId: "medical-order-001",
			outTradeNo: "medical-out-001",
			openid: "openid-001",
			payOrdId: "pay-ord-001",
			medOrgOrd: "med-org-001",
			orderType: "RegPay",
			amounts: {
				totalFen: 1100,
				cashFen: 200,
				personalAccountFen: 300,
				fundFen: 500,
				otherPaymentFen: 100,
			},
			authorization: {
				patient: { idNo: "140581199001010011", userName: "测试患者" },
				payAuthNo: "pay-auth-001",
			} as never,
			settlement: {} as never,
			paymentIdentity: {
				payForRelatives: true,
				payer: { name: "成年付款人", idNo: "140581198001010022" },
				relative: { name: "测试患者", idNo: "140581199001010011" },
			},
			medicalOrderCreateTime: "2026-08-14T12:00:00.000Z",
		},
		context,
	);

	const mixedBody = JSON.parse(requests[1]?.body ?? "{}") as Record<
		string,
		unknown
	>;
	const jsapiBody = JSON.parse(requests[0]?.body ?? "{}") as Record<
		string,
		unknown
	>;
	expect(requests.map((request) => request.path)).toEqual([
		"/v3/pay/transactions/jsapi",
		"/v3/med-ins/orders",
	]);
	expect(mixedBody).toMatchObject({
		mix_pay_type: "CASH_AND_INSURANCE",
		order_type: "REG_PAY",
		out_trade_no: "medical-out-001",
		serial_no: "med-org-001",
		med_inst_name: "高平市人民医院",
		med_inst_no: "H14058101270",
		total_fee: 1100,
		appid: "wx-app-001",
		openid: "openid-001",
		city_id: "140500",
		pay_order_id: "pay-ord-001",
		pay_auth_no: "pay-auth-001",
		geo_location: "112.9236,35.7981",
		med_ins_gov_fee: 500,
		med_ins_self_fee: 300,
		med_ins_other_fee: 100,
		med_ins_cash_fee: 200,
		wechat_pay_cash_fee: 200,
		med_ins_order_create_time: "2026-08-14T12:00:00.000Z",
		callback_url:
			"https://hospital.example.test/api/v1/payments/medical-insurance/wechat-notifications",
		prepay_id: "wx-medical-prepay-001",
		pay_for_relatives: true,
	});
	expect(jsapiBody).toMatchObject({
		appid: "wx-app-001",
		mchid: "mch-001",
		out_trade_no: "medical-out-001",
	});
	for (const requestBody of [jsapiBody, mixedBody]) {
		expect(requestBody).not.toHaveProperty("sp_mchid");
		expect(requestBody).not.toHaveProperty("sub_mchid");
		expect(requestBody).not.toHaveProperty("sub_appid");
		expect(requestBody).not.toHaveProperty("sub_openid");
	}
	expect(mixedBody).not.toHaveProperty("cash_reduce_detail");
	const payer = mixedBody.payer as Record<string, unknown>;
	expect(payer.name).not.toBe("测试患者");
	expect(payer.id_digest).not.toBe("140581199001010011");
	const relative = mixedBody.relative as Record<string, unknown>;
	expect(relative.name).not.toBe("测试患者");
	expect(relative.id_digest).not.toBe("140581199001010011");
	expect(result).toMatchObject({
		mixTradeNo: "mix-trade-001",
		prepayId: "wx-medical-prepay-001",
		cashFen: 200,
		payParams: {
			timeStamp: "1786752000",
			package: "prepay_id=wx-medical-prepay-001",
			signType: "RSA",
			mixTradeNo: "mix-trade-001",
		},
	});
	expect(result.payParams).not.toHaveProperty("appId");
});

test("纯医保直接创建官方 INSURANCE_ONLY 订单且不创建 JSAPI 预支付", async () => {
	const requests: Array<{ path: string; body: string }> = [];
	const responseBody = JSON.stringify({ mix_trade_no: "mix-pure-001" });
	const gateway = createMedicalGateway(async (_input, init) => {
		const path = new URL(String(_input)).pathname;
		const body = typeof init?.body === "string" ? init.body : "";
		requests.push({ path, body });
		verifyRequestAuthorization(init, "POST", path, body);
		return new Response(responseBody, {
			status: 200,
			headers: providerResponseHeaders(responseBody),
		});
	});

	const result = await gateway.createMixedOrder(
		{
			orderId: "medical-pure-001",
			outTradeNo: "medical-pure-out-001",
			openid: "openid-pure-001",
			payOrdId: "pay-pure-001",
			medOrgOrd: "med-org-pure-001",
			orderType: "RegPay",
			amounts: {
				totalFen: 900,
				cashFen: 0,
				personalAccountFen: 300,
				fundFen: 600,
			},
			authorization: {
				patient: { idNo: "130503670401001", userName: "测试患者" },
				payAuthNo: "pay-auth-pure-001",
			} as never,
			settlement: {} as never,
			paymentIdentity: {
				payForRelatives: false,
				payer: { name: "测试患者", idNo: "130503670401001" },
			},
		},
		context,
	);

	expect(requests.map((request) => request.path)).toEqual([
		"/v3/med-ins/orders",
	]);
	const body = JSON.parse(requests[0]?.body ?? "{}") as Record<string, unknown>;
	expect(body).toMatchObject({
		mix_pay_type: "INSURANCE_ONLY",
		med_ins_cash_fee: 0,
		geo_location: "112.9236,35.7981",
		pay_for_relatives: false,
	});
	expect(body).not.toHaveProperty("wechat_pay_cash_fee");
	expect(body).not.toHaveProperty("prepay_id");
	expect(body).not.toHaveProperty("sub_mchid");
	expect(body).not.toHaveProperty("sub_appid");
	expect(body).not.toHaveProperty("sub_openid");
	const payer = body.payer as Record<string, unknown>;
	const decryptedDigest = privateDecrypt(
		{
			key: platformPrivateKey,
			padding: constants.RSA_PKCS1_OAEP_PADDING,
			oaepHash: "sha1",
		},
		Buffer.from(String(payer.id_digest), "base64"),
	).toString("utf8");
	expect(decryptedDigest).toBe(
		createHash("md5").update("130503196704010016", "utf8").digest("hex"),
	);
	expect(result).toMatchObject({
		mixTradeNo: "mix-pure-001",
		cashFen: 0,
		payParams: { mixTradeNo: "mix-pure-001" },
		trace: { requestIds: ["provider-request-001"] },
	});
	expect(result).not.toHaveProperty("prepayId");
});

test("医保混合下单响应丢失后按 out_trade_no 恢复同一订单", async () => {
	const paths: string[] = [];
	const recoveredBody = recoveredMedicalOrderBody({
		mixTradeNo: "mix-recovered-001",
		outTradeNo: "medical-recovered-out-001",
	});
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		const requestBody = typeof init?.body === "string" ? init.body : "";
		verifyRequestAuthorization(
			init,
			init?.method ?? "GET",
			url.pathname,
			requestBody,
		);
		if (url.pathname === "/v3/pay/transactions/jsapi") {
			const responseBody = JSON.stringify({
				prepay_id: "wx-medical-prepay-recovery-001",
			});
			return new Response(responseBody, {
				status: 200,
				headers: providerResponseHeaders(responseBody),
			});
		}
		if (url.pathname === "/v3/med-ins/orders" && init?.method === "POST") {
			throw new TypeError("simulated response loss after dispatch");
		}
		return new Response(recoveredBody, {
			status: 200,
			headers: providerResponseHeaders(recoveredBody),
		});
	});

	const result = await gateway.createMixedOrder(
		medicalCreateInput({ outTradeNo: "medical-recovered-out-001" }),
		context,
	);

	expect(paths).toEqual([
		"POST /v3/pay/transactions/jsapi",
		"POST /v3/med-ins/orders",
		"GET /v3/med-ins/orders/out-trade-no/medical-recovered-out-001",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-recovered-001",
		prepayId: "wx-medical-prepay-recovery-001",
		cashFen: 200,
		payParams: {
			package: "prepay_id=wx-medical-prepay-recovery-001",
			mixTradeNo: "mix-recovered-001",
		},
		trace: {
			operation: "medical-mix-create-recovered",
			requestId: "provider-request-001",
			providerOrderId: "mix-recovered-001",
		},
	});
});

test("医保下单已验签响应缺少 mix_trade_no 时仍先按 out_trade_no 恢复", async () => {
	const paths: string[] = [];
	const recoveredBody = recoveredMedicalOrderBody({
		mixTradeNo: "mix-incomplete-recovered-001",
		outTradeNo: "medical-incomplete-out-001",
		pure: true,
	});
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		const requestBody = typeof init?.body === "string" ? init.body : "";
		verifyRequestAuthorization(
			init,
			init?.method ?? "GET",
			url.pathname,
			requestBody,
		);
		const responseBody = init?.method === "POST" ? "{}" : recoveredBody;
		return new Response(responseBody, {
			status: 200,
			headers: providerResponseHeaders(responseBody),
		});
	});

	const result = await gateway.createMixedOrder(
		medicalCreateInput({
			outTradeNo: "medical-incomplete-out-001",
			pure: true,
		}),
		context,
	);

	expect(paths).toEqual([
		"POST /v3/med-ins/orders",
		"GET /v3/med-ins/orders/out-trade-no/medical-incomplete-out-001",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-incomplete-recovered-001",
		trace: { operation: "medical-mix-create-recovered" },
	});
});

test("本地创建状态未知时先恢复混合订单且不重复创建 JSAPI 预支付", async () => {
	const paths: string[] = [];
	const recoveredBody = recoveredMedicalOrderBody({
		mixTradeNo: "mix-restart-recovered-001",
		outTradeNo: "medical-restart-out-001",
	});
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		verifyRequestAuthorization(init, "GET", url.pathname, "");
		return new Response(recoveredBody, {
			status: 200,
			headers: providerResponseHeaders(recoveredBody),
		});
	});
	const createInput = medicalCreateInput({
		outTradeNo: "medical-restart-out-001",
	});

	const result = await gateway.createMixedOrder(
		{ ...createInput, recoverFirst: true },
		context,
	);

	expect(paths).toEqual([
		"GET /v3/med-ins/orders/out-trade-no/medical-restart-out-001",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-restart-recovered-001",
		prepayId: "wx-medical-prepay-recovery-001",
		payParams: {
			package: "prepay_id=wx-medical-prepay-recovery-001",
			mixTradeNo: "mix-restart-recovered-001",
		},
		trace: { operation: "medical-mix-create-recovered" },
	});
});

test("后台恢复入口只按 out_trade_no 查单且重建小程序调起参数", async () => {
	const paths: string[] = [];
	const recoveredBody = recoveredMedicalOrderBody({
		mixTradeNo: "mix-worker-recovered-001",
		outTradeNo: "medical-worker-recovery-out-001",
	});
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		verifyRequestAuthorization(init, "GET", url.pathname, "");
		return new Response(recoveredBody, {
			status: 200,
			headers: providerResponseHeaders(recoveredBody),
		});
	});
	const createInput = medicalCreateInput({
		outTradeNo: "medical-worker-recovery-out-001",
	});

	const result = await gateway.recoverMixedOrder(
		{
			orderId: createInput.orderId,
			outTradeNo: createInput.outTradeNo,
			openid: createInput.openid,
			payOrdId: createInput.payOrdId,
			medOrgOrd: createInput.medOrgOrd,
			orderType: createInput.orderType,
			amounts: createInput.amounts,
			expectedPayForRelatives: true,
		},
		context,
	);

	expect(paths).toEqual([
		"GET /v3/med-ins/orders/out-trade-no/medical-worker-recovery-out-001",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-worker-recovered-001",
		prepayId: "wx-medical-prepay-recovery-001",
		payParams: {
			package: "prepay_id=wx-medical-prepay-recovery-001",
			mixTradeNo: "mix-worker-recovered-001",
		},
		trace: { operation: "medical-mix-create-recovered" },
	});
});

test("重复纯医保下单返回 ALREADY_EXISTS 时恢复既有订单", async () => {
	const paths: string[] = [];
	const recoveredBody = recoveredMedicalOrderBody({
		mixTradeNo: "mix-pure-recovered-001",
		outTradeNo: "medical-pure-recovered-out-001",
		pure: true,
	});
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		const requestBody = typeof init?.body === "string" ? init.body : "";
		verifyRequestAuthorization(
			init,
			init?.method ?? "GET",
			url.pathname,
			requestBody,
		);
		if (init?.method === "POST") {
			const errorBody = JSON.stringify({
				code: "ALREADY_EXISTS",
				message: "order already exists",
			});
			return new Response(errorBody, {
				status: 400,
				headers: providerResponseHeaders(errorBody),
			});
		}
		return new Response(recoveredBody, {
			status: 200,
			headers: providerResponseHeaders(recoveredBody),
		});
	});

	const result = await gateway.createMixedOrder(
		medicalCreateInput({
			outTradeNo: "medical-pure-recovered-out-001",
			pure: true,
		}),
		context,
	);

	expect(paths).toEqual([
		"POST /v3/med-ins/orders",
		"GET /v3/med-ins/orders/out-trade-no/medical-pure-recovered-out-001",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-pure-recovered-001",
		cashFen: 0,
		payParams: { mixTradeNo: "mix-pure-recovered-001" },
		trace: { operation: "medical-mix-create-recovered" },
	});
	expect(result).not.toHaveProperty("prepayId");
});

test("医保下单结果未知且查单确认不存在时才安全重试原订单", async () => {
	const paths: string[] = [];
	let createAttempts = 0;
	const gateway = createMedicalGateway(async (_input, init) => {
		const url = new URL(String(_input));
		paths.push(`${init?.method ?? "GET"} ${url.pathname}`);
		const requestBody = typeof init?.body === "string" ? init.body : "";
		verifyRequestAuthorization(
			init,
			init?.method ?? "GET",
			url.pathname,
			requestBody,
		);
		if (init?.method === "GET") {
			const errorBody = JSON.stringify({
				code: "NOT_FOUND",
				message: "order not found",
			});
			return new Response(errorBody, {
				status: 404,
				headers: providerResponseHeaders(errorBody),
			});
		}
		createAttempts += 1;
		if (createAttempts === 1) {
			throw new TypeError("simulated first create timeout");
		}
		const responseBody = JSON.stringify({ mix_trade_no: "mix-safe-retry-001" });
		return new Response(responseBody, {
			status: 200,
			headers: providerResponseHeaders(responseBody),
		});
	});

	const result = await gateway.createMixedOrder(
		medicalCreateInput({
			outTradeNo: "medical-safe-retry-out-001",
			pure: true,
		}),
		context,
	);

	expect(paths).toEqual([
		"POST /v3/med-ins/orders",
		"GET /v3/med-ins/orders/out-trade-no/medical-safe-retry-out-001",
		"POST /v3/med-ins/orders",
	]);
	expect(result).toMatchObject({
		mixTradeNo: "mix-safe-retry-001",
		trace: { operation: "medical-mix-create-retried" },
	});
});

test("纯医保查单接受 NO_SELF_PAY 且不要求现金字段", async () => {
	const body = JSON.stringify({
		mix_trade_no: "mix-pure-query-001",
		mix_pay_type: "INSURANCE_ONLY",
		appid: "wx-app-001",
		out_trade_no: "out-pure-query-001",
		pay_order_id: "pay-pure-query-001",
		mix_pay_status: "MIX_PAY_SUCCESS",
		self_pay_status: "NO_SELF_PAY",
		med_ins_pay_status: "MED_INS_PAY_SUCCESS",
		total_fee: 900,
	});
	const gateway = createMedicalGateway(
		async (_input, init) => {
			const url = new URL(String(_input));
			verifyRequestAuthorization(init, "GET", url.pathname, "");
			return new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body),
			});
		},
		["medical-pure-query-nonce"],
	);

	await expect(
		gateway.queryMixedOrder(
			{
				orderId: "medical-pure-query-001",
				mixTradeNo: "mix-pure-query-001",
				expectedOutTradeNo: "out-pure-query-001",
				expectedPayOrdId: "pay-pure-query-001",
				expectedTotalFen: 900,
				expectedCashFen: 0,
			},
			context,
		),
	).resolves.toMatchObject({
		mixState: "paid",
		cashState: "paid",
		insuranceState: "paid",
		cashFen: 0,
		totalFen: 900,
		medInsPayStatus: "MED_INS_PAY_SUCCESS",
	});
});

test("医保混合查单仅在医保失败时提取医保局失败原因", async () => {
	const body = JSON.stringify({
		mix_trade_no: "mix-query-001",
		mix_pay_type: "CASH_AND_INSURANCE",
		appid: "wx-app-001",
		out_trade_no: "out-query-001",
		pay_order_id: "pay-query-001",
		mix_pay_status: "MIX_PAY_FAIL",
		self_pay_status: "SELF_PAY_SUCCESS",
		med_ins_pay_status: "MED_INS_PAY_FAIL",
		med_ins_fail_reason: "医保局返回的具体失败原因",
		total_fee: 1000,
		wechat_pay_cash_fee: 200,
	});
	const gateway = createMedicalGateway(
		async (_input, init) => {
			const url = new URL(String(_input));
			verifyRequestAuthorization(init, "GET", url.pathname, "");
			return new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body),
			});
		},
		["medical-query-nonce"],
	);

	await expect(
		gateway.queryMixedOrder(
			{
				orderId: "medical-query-001",
				mixTradeNo: "mix-query-001",
				expectedOutTradeNo: "out-query-001",
				expectedPayOrdId: "pay-query-001",
				expectedTotalFen: 1000,
				expectedCashFen: 200,
			},
			context,
		),
	).resolves.toMatchObject({
		mixState: "failed",
		cashState: "paid",
		insuranceState: "failed",
		medInsPayStatus: "MED_INS_PAY_FAIL",
		medInsFailReason: "医保局返回的具体失败原因",
	});
});

test("医保成功查单即使误带失败原因也不向业务层透传", async () => {
	const body = JSON.stringify({
		mix_trade_no: "mix-query-002",
		mix_pay_type: "CASH_AND_INSURANCE",
		appid: "wx-app-001",
		out_trade_no: "out-query-002",
		pay_order_id: "pay-query-002",
		mix_pay_status: "MIX_PAY_SUCCESS",
		self_pay_status: "SELF_PAY_SUCCESS",
		med_ins_pay_status: "MED_INS_PAY_SUCCESS",
		med_ins_fail_reason: "must-not-be-used",
		total_fee: 1000,
		wechat_pay_cash_fee: 200,
	});
	const gateway = createMedicalGateway(
		async (_input, init) => {
			const url = new URL(String(_input));
			verifyRequestAuthorization(init, "GET", url.pathname, "");
			return new Response(body, {
				status: 200,
				headers: providerResponseHeaders(body),
			});
		},
		["medical-query-nonce-success"],
	);

	const result = await gateway.queryMixedOrder(
		{
			orderId: "medical-query-002",
			mixTradeNo: "mix-query-002",
			expectedOutTradeNo: "out-query-002",
			expectedPayOrdId: "pay-query-002",
			expectedTotalFen: 1000,
			expectedCashFen: 200,
		},
		context,
	);
	expect(result.medInsPayStatus).toBe("MED_INS_PAY_SUCCESS");
	expect(result).not.toHaveProperty("medInsFailReason");
});

test("微信未支付订单可以由服务端查单后关闭", async () => {
	let requestBody = "";
	const gateway = createGateway(
		async (_input, init) => {
			requestBody = typeof init?.body === "string" ? init.body : "";
			verifyRequestAuthorization(
				init,
				"POST",
				"/v3/pay/transactions/out-trade-no/order-close-001/close",
				requestBody,
			);
			return new Response(null, {
				status: 204,
				headers: providerResponseHeaders(""),
			});
		},
		["close-nonce-001"],
	);

	await expect(
		gateway.close({ orderId: "order-close-001" }, context),
	).resolves.toMatchObject({
		trace: {
			operation: "order-close",
			providerOrderId: "order-close-001",
		},
	});
	expect(requestBody).toBe(JSON.stringify({ mchid: "mch-001" }));
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
			const errorBody = JSON.stringify({
				code: "ORDER_NOT_EXIST",
				message: "订单不存在",
			});
			return new Response(errorBody, {
				status: 404,
				headers: providerResponseHeaders(errorBody),
			});
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

test("微信医保混合成功通知使用 APIv3 验签解密并提取安全事实", () => {
	const apiV3Key = "0123456789abcdef0123456789abcdef";
	const resourceNonce = "123456789012";
	const associatedData = "medical-insurance";
	const plaintext = JSON.stringify({
		appid: "wx-app-001",
		mchid: "mch-001",
		mix_trade_no: "mix-trade-notification-001",
		out_trade_no: "medical-out-notification-001",
		mix_pay_type: "CASH_AND_INSURANCE",
		mix_pay_status: "MIX_PAY_SUCCESS",
		self_pay_status: "SELF_PAY_SUCCESS",
		med_ins_pay_status: "MED_INS_PAY_SUCCESS",
		total_fee: 1000,
		wechat_pay_cash_fee: 200,
		payer: { name: "must-not-cross-adapter-boundary" },
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
		id: "medical-notification-001",
		event_type: "MEDICAL_INSURANCE.SUCCESS",
		resource: {
			algorithm: "AEAD_AES_256_GCM",
			ciphertext: encrypted,
			nonce: resourceNonce,
			associated_data: associatedData,
		},
	});
	const decoder = createWechatMedicalInsuranceNotificationDecoder({
		platformCertificateSerial: "platform-serial-001",
		platformPublicKey,
		apiV3Key,
		now: () => fixedNow,
		expectedAppId: "wx-app-001",
		expectedMchId: "mch-001",
	});

	const mapped = decoder({
		rawBody: new TextEncoder().encode(body),
		headers: providerResponseHeaders(body),
		receivedAt: "2026-08-15T00:00:01.000Z",
	});

	expect(mapped).toEqual({
		notificationId: "medical-notification-001",
		eventType: "MEDICAL_INSURANCE.SUCCESS",
		mixTradeNo: "mix-trade-notification-001",
		outTradeNo: "medical-out-notification-001",
		totalFen: 1000,
		cashFen: 200,
		mixPayType: "CASH_AND_INSURANCE",
		selfPayStatus: "SELF_PAY_SUCCESS",
		medicalInsurancePayStatus: "MED_INS_PAY_SUCCESS",
		receivedAt: "2026-08-15T00:00:01.000Z",
	});
	expect(JSON.stringify(mapped)).not.toContain(
		"must-not-cross-adapter-boundary",
	);
});

test("微信纯医保成功通知接受 NO_SELF_PAY 和缺失现金字段", () => {
	const apiV3Key = "0123456789abcdef0123456789abcdef";
	const resourceNonce = "123456789012";
	const associatedData = "medical-insurance";
	const plaintext = JSON.stringify({
		appid: "wx-app-001",
		mix_trade_no: "mix-pure-notification-001",
		out_trade_no: "medical-pure-notification-001",
		mix_pay_type: "INSURANCE_ONLY",
		mix_pay_status: "MIX_PAY_SUCCESS",
		self_pay_status: "NO_SELF_PAY",
		med_ins_pay_status: "MED_INS_PAY_SUCCESS",
		total_fee: 900,
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
		id: "medical-pure-notification-001",
		event_type: "MEDICAL_INSURANCE.SUCCESS",
		resource: {
			algorithm: "AEAD_AES_256_GCM",
			ciphertext: encrypted,
			nonce: resourceNonce,
			associated_data: associatedData,
		},
	});
	const decoder = createWechatMedicalInsuranceNotificationDecoder({
		platformCertificateSerial: "platform-serial-001",
		platformPublicKey,
		apiV3Key,
		now: () => fixedNow,
		expectedAppId: "wx-app-001",
		expectedMchId: "mch-001",
	});

	expect(
		decoder({
			rawBody: new TextEncoder().encode(body),
			headers: providerResponseHeaders(body),
			receivedAt: "2026-08-15T00:00:01.000Z",
		}),
	).toEqual({
		notificationId: "medical-pure-notification-001",
		eventType: "MEDICAL_INSURANCE.SUCCESS",
		mixTradeNo: "mix-pure-notification-001",
		outTradeNo: "medical-pure-notification-001",
		totalFen: 900,
		cashFen: 0,
		mixPayType: "INSURANCE_ONLY",
		selfPayStatus: "NO_SELF_PAY",
		medicalInsurancePayStatus: "MED_INS_PAY_SUCCESS",
		receivedAt: "2026-08-15T00:00:01.000Z",
	});
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
