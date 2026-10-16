import { expect, test } from "bun:test";
import type { RegistrationSelfPaySettlementContext } from "@hospital/domain";
import type { ProviderFetcher, ProviderRequestLogger } from "./http";
import {
	createYunhealthRegistrationPluginPaymentGateway,
	createYunhealthRegistrationSelfPayPreparationGateway,
	createYunhealthRegistrationSelfPayRefundNotificationGateway,
	createYunhealthRegistrationSettlementGateway,
} from "./yunhealth-registration-settlement";

const context = {
	traceId: "registration-self-pay-trace-001",
	idempotencyKey: "registration-self-pay-request-001",
};

const yunhealthMd5Result = {
	appId: "wx1234567890abcdef",
	timeStamp: "1789000000",
	nonceStr: "0123456789abcdef0123456789abcdef",
	package: "prepay_id=wx-provider-prepay-001",
	signType: "MD5",
	sign: "0123456789abcdef0123456789abcdef",
};

const registrationContext = {
	businessId: "settlement-business-001",
	payingId: "260650000000001",
	tradingId: "260650000000002",
	hospitalId: "10389001",
	patientId: "100001",
	certNo: "11010519900101007X",
	psnCertType: "01",
	psnName: "测试患者",
	psnNo: "P000001",
	patInHosId: "0",
	outTradeNo: "payment-order-001",
	recordCode: "0123456789abcdef0123456789abcdef",
	payTypeId: "5027",
	payType: "CREDIT" as const,
	platformOrderId: "medical-order-001",
};

function gateway(fetcher: ProviderFetcher, workStationId = "") {
	return createYunhealthRegistrationSettlementGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId,
		fetcher,
	});
}

test("云健康插件版第二次 .2 使用旧服务的支付上下文并只返回插件流水号", async () => {
	let request:
		| {
				url: string;
				body: Record<string, unknown>;
				headers: Headers;
		  }
		| undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "registration-machine-01",
		fetcher: async (input, init) => {
			request = {
				url: String(input),
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
				headers: new Headers(init?.headers),
			};
			return new Response(
				JSON.stringify({
					success: true,
					data: { payingId: 500001, tradingId: 500002 },
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-plugin-2" } },
			);
		},
	});

	const result = await gatewayInstance.createPreOrder(
		{
			orderId: "medical-order-001",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 1234,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "5033",
			payModel: "H5",
			payType: "CREDIT",
			workStationId: "registration-machine-01",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(request?.url).toBe(
		"https://yunhealth.example.test/msun-middle-open-settlepay/api/v2/open/payment/pre-order",
	);
	expect(request?.headers.get("authorization")).toBe("Bearer server-token");
	expect(request?.body).toMatchObject({
		appCode: "WeChatSmallProg",
		authSysCode: "thirdSelfMachine",
		autoSettle: 3,
		body: "支付",
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		payModel: "H5",
		payTypeId: 5033,
		recordCode: "0123456789abcdef0123456789abcdef",
		requestId: "0123456789abcdef0123456789abcdef",
		sceneCode: "WeChatSmallProgram",
		total: 12.34,
		tradeCode: "REGISTRATION-001",
		tradeTypeCode: "10",
		workStationId: "registration-machine-01",
	});
	expect(request?.body.payTypeParams).toEqual([
		{
			payTypeId: 5033,
			amount: 12.34,
			paymentSystemUserId: "",
			spbillCreateIp: "",
		},
	]);
	expect(result).toMatchObject({
		payingId: "500001",
		tradingId: "500002",
		payTypeId: "5033",
		payType: "CREDIT",
		workStationId: "registration-machine-01",
		tradeTypeCode: "10",
		trace: {
			operation: "registration-self-pay.2.6.65.2.plugin",
			requestId: "yunhealth-plugin-2",
		},
	});
});

test("历史 5031 云健康 .2 将 result 的 MD5 sign 安全投影为小程序 paySign", async () => {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		miniProgramAppId: yunhealthMd5Result.appId,
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: {
						payingId: 500001,
						tradingId: 500002,
						payRecord: {
							outTradeNo: "REGISTRATION-001",
							tradeNo: "LEGACY-HIS-REFERENCE-001",
						},
						result: JSON.stringify(yunhealthMd5Result),
					},
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-md5-2" } },
			),
	});

	const result = await gatewayInstance.createPreOrder(
		{
			orderId: "self-pay-order-md5",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 1234,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "5031",
			payModel: "MINI_PROGRAM",
			paymentSystemUserId: "openid-md5-001",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(result.payParams).toEqual({
		appId: yunhealthMd5Result.appId,
		timeStamp: yunhealthMd5Result.timeStamp,
		nonceStr: yunhealthMd5Result.nonceStr,
		package: yunhealthMd5Result.package,
		signType: "MD5",
		paySign: yunhealthMd5Result.sign,
	});
	expect(result.outTradeNo).toBe("REGISTRATION-001");
});

async function manualSelfPayPreOrder(data: Record<string, unknown>) {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		miniProgramAppId: yunhealthMd5Result.appId,
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: {
						payingId: "9007199254740993",
						tradingId: "9007199254740994",
						result: JSON.stringify(yunhealthMd5Result),
						...data,
					},
				}),
				{ status: 200, headers: { "x-request-id": "manual-wechat-5032" } },
			),
	});
	return gatewayInstance.createPreOrder(
		{
			orderId: "manual-payment-001",
			businessId: "settlement-business-001",
			tradeCode: "HIS-BUSINESS-001",
			totalFen: 1000,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "5032",
			payModel: "MINI_PROGRAM",
			paymentSystemUserId: "openid-manual-001",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);
}

const manualWechatPayRecord = {
	payTypeId: "5032",
	payModel: "MINI_PROGRAM",
	payTypeCode: "WECHAT",
	tradeNo: "wx-merchant-order-001",
	outTradeNo: "HIS-BUSINESS-001",
	tradeCode: "HIS-BUSINESS-001",
};

test("普通微信 5032 使用支付记录 tradeNo，忽略根字段和其他支付腿的单号", async () => {
	const result = await manualSelfPayPreOrder({
		outTradeNo: "ROOT-HIS-BUSINESS-001",
		tradeNo: "ROOT-HIS-REFERENCE-001",
		payRecord: manualWechatPayRecord,
		payRecords: [
			{ payTypeId: "5", tradeNo: "OTHER-PAYMENT-LEG-001" },
			{ ...manualWechatPayRecord, payTypeId: 5032 },
		],
	});
	expect(result.outTradeNo).toBe("wx-merchant-order-001");
});

test.each([
	{
		data: { payRecords: [manualWechatPayRecord] },
		expected: "wx-merchant-order-001",
	},
	{
		data: { payRecord: { payTypeId: "5032", trade_no: "merchant-alias-001" } },
		expected: "merchant-alias-001",
	},
	{
		data: { payRecord: { ...manualWechatPayRecord, tradeNo: "a".repeat(32) } },
		expected: "a".repeat(32),
	},
])(
	"普通微信 5032 读取明确支付记录并接受 32 位以内商户单号 %j",
	async ({ data, expected }) => {
		const result = await manualSelfPayPreOrder(data);
		expect(result.outTradeNo).toBe(expected);
	},
);

test.each([
	{ payRecord: { outTradeNo: "legacy-wechat-order-001" } },
	{ out_trade_no: "legacy-wechat-order-001" },
])("普通微信 5032 兼容没有渠道结构的历史商户单号 %j", async (data) => {
	const result = await manualSelfPayPreOrder(data);
	expect(result.outTradeNo).toBe("legacy-wechat-order-001");
});

const invalidManualWechatResponses: Record<string, unknown>[] = [
	{ payRecord: { ...manualWechatPayRecord, tradeNo: undefined } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: "" } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: "HIS-BUSINESS-001" } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: "a".repeat(33) } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: "merchant/order" } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: "merchant\norder" } },
	{ payRecord: { ...manualWechatPayRecord, tradeNo: 9007199254740992 } },
	{ payRecord: { ...manualWechatPayRecord, payModel: "H5" } },
	{ payRecord: { ...manualWechatPayRecord, payTypeCode: "ALIPAY" } },
	{
		payRecord: {
			...manualWechatPayRecord,
			trade_no: "conflicting-merchant-order",
		},
	},
	{
		payRecord: manualWechatPayRecord,
		payRecords: [
			{ ...manualWechatPayRecord, tradeNo: "second-merchant-order" },
		],
	},
	{
		outTradeNo: "legacy-wechat-order-001",
		payRecord: { outTradeNo: "different-legacy-order-001" },
	},
	{ payRecord: { outTradeNo: "HIS-BUSINESS-001" } },
	{ payRecord: { payTypeId: "5", tradeNo: "other-channel-order-001" } },
];
test.each(invalidManualWechatResponses)(
	"普通微信 5032 拒绝缺失、非法或冲突单号，不能回退成 HIS outTradeNo %j",
	async (data) => {
		await expect(manualSelfPayPreOrder(data)).rejects.toMatchObject({
			operation: "registration-self-pay.2.6.65.2.plugin",
			failureStage: "response",
			responseInvalid: true,
			requestOutcome: "unknown",
		});
	},
);

test("微信退款确认成功后按原插件上下文回写云健康 .15 退款分支", async () => {
	let request:
		| {
				url: string;
				bodyText: string;
				body: Record<string, unknown>;
				headers: Headers;
		  }
		| undefined;
	const gatewayInstance =
		createYunhealthRegistrationSelfPayRefundNotificationGateway({
			baseUrl: "https://yunhealth.example.test",
			authorizationToken: "server-token",
			paymentOrgId: "10756",
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			workStationId: "registration-machine-01",
			paymentSource: "1",
			authSysCode: "thirdSelfMachine",
			tradeTypeCode: "10",
			fetcher: async (input, init) => {
				const bodyText = String(init?.body);
				request = {
					url: String(input),
					bodyText,
					body: JSON.parse(bodyText) as Record<string, unknown>,
					headers: new Headers(init?.headers),
				};
				return new Response(
					JSON.stringify({ success: true, data: "success" }),
					{
						status: 200,
						headers: { "x-request-id": "yunhealth-refund-notify-15" },
					},
				);
			},
		});

	const trace = await gatewayInstance.notifyRefund(
		{
			orderId: "payment-order-refund-001",
			merchantRefundNo: "RF-PO-registration-001",
			refundFen: 1234,
			registrationContext: {
				...registrationContext,
				tradeTypeCode: "10",
				payingId: "1952638941030000002",
				payTypeId: "5032",
				workStationId: "registration-machine-01",
				outTradeNo: "REGISTRATION-SELF-001",
				outTradeNoSource: "yunhealth_2_6_65_2",
				payParams: {
					appId: yunhealthMd5Result.appId,
					timeStamp: yunhealthMd5Result.timeStamp,
					nonceStr: yunhealthMd5Result.nonceStr,
					package: yunhealthMd5Result.package,
					signType: "MD5",
					paySign: yunhealthMd5Result.sign,
				},
			},
		},
		context,
	);

	expect(request?.url).toBe(
		"https://yunhealth.example.test/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
	);
	expect(request?.headers.get("authorization")).toBe("Bearer server-token");
	expect(request?.body).toMatchObject({
		authSysCode: "thirdSelfMachine",
		hospitalId: 10389001,
		orgId: 10756,
		tradeTypeCode: "10",
		workStationId: "registration-machine-01",
	});
	// 既要保持旧服务的 JSON number 类型，也要确保超过 Number.MAX_SAFE_INTEGER
	// 的雪花 ID 没有被 JSON.parse/Number 静默舍入。
	expect(request?.bodyText).toContain('"payingId":1952638941030000002');
	expect(String(request?.body.requestParam)).toContain(
		'"payingId":1952638941030000002',
	);
	expect(request?.body.nonce).toMatch(/^[A-Fa-f0-9]{32}$/u);
	expect(String(request?.body.requestParam)).toContain('"payTypeId":5032');
	expect(String(request?.body.requestParam)).toContain('"receiveAmount":12.34');
	expect(String(request?.body.requestParam)).toContain(
		'"recordCode":"0123456789abcdef0123456789abcdef"',
	);
	expect(trace).toMatchObject({
		provider: "yunhealth",
		operation: "registration-self-pay.2.6.65.15.refund",
		requestId: "yunhealth-refund-notify-15",
		providerOrderId: "settlement-business-001",
	});
});

test("云健康 .15 退款回写在缺少服务端授权时拒绝初始化", () => {
	expect(() =>
		createYunhealthRegistrationSelfPayRefundNotificationGateway({
			baseUrl: "https://yunhealth.example.test",
			authorizationToken: "",
			paymentOrgId: "10756",
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			workStationId: "",
			paymentSource: "1",
			authSysCode: "thirdSelfMachine",
			tradeTypeCode: "10",
		}),
	).toThrow("authorizationToken is invalid");
});

function refundNotificationGateway(fetcher: ProviderFetcher) {
	const gateway = createYunhealthRegistrationSelfPayRefundNotificationGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "registration-machine-01",
		paymentSource: "1",
		authSysCode: "thirdSelfMachine",
		tradeTypeCode: "10",
		fetcher,
	});
	if (!gateway.validateRefundContext)
		throw new Error("Missing refund preflight");
	return { ...gateway, validateRefundContext: gateway.validateRefundContext };
}

function refundRegistrationContext(): RegistrationSelfPaySettlementContext {
	return {
		...registrationContext,
		tradeTypeCode: "10",
		payingId: "1952638941030000002",
		payTypeId: "5032",
		workStationId: "registration-machine-01",
		outTradeNo: "REGISTRATION-SELF-001",
		outTradeNoSource: "yunhealth_2_6_65_2",
		payParams: {
			appId: yunhealthMd5Result.appId,
			timeStamp: yunhealthMd5Result.timeStamp,
			nonceStr: yunhealthMd5Result.nonceStr,
			package: yunhealthMd5Result.package,
			signType: "MD5",
			paySign: yunhealthMd5Result.sign,
		},
	};
}

test.each([
	{ success: true, code: "0000", data: "success" },
	{ success: true, code: "", data: "success" },
	{ code: "0000", data: " success " },
])("云健康 .15 仅业务 data 明确 success 才确认退款回写 %j", async (body) => {
	const notification = refundNotificationGateway(
		async () =>
			new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": "refund-business-success" },
			}),
	);
	await expect(
		notification.notifyRefund(
			{
				orderId: "payment-order-refund-001",
				merchantRefundNo: "RF-PO-registration-001",
				refundFen: 1000,
				registrationContext: refundRegistrationContext(),
			},
			context,
		),
	).resolves.toMatchObject({ requestId: "refund-business-success" });
});

const unconfirmedPaymentNotifyBodies = [
	{
		success: true,
		code: "0000",
		data: "Content is not allowed in prolog.，医院名称：测试医院",
	},
	{ success: true, code: "0000", data: "" },
	{ success: true, code: "0000", data: "   " },
	{ success: true, code: "0000" },
	{ success: true, code: "0000", data: null },
	{ success: true, code: "0000", data: {} },
	{ success: true, code: "0000", data: { success: true } },
	{ success: true, data: { success: true, code: "0000", data: "success" } },
	{ success: true, code: "0000", data: { data: "success" } },
	{ success: true, code: "0000", data: ["success"] },
	{ success: true, code: "0000", data: true },
	{ success: true, code: "0000", data: "SUCCESS" },
	{ success: true, code: "0000", data: "success: false" },
	{ success: true, code: "500", data: "success" },
	{ success: true, code: "0000", data: { code: "500", data: "success" } },
];

test.each(unconfirmedPaymentNotifyBodies)(
	"云健康 .15 外层成功但业务未确认时不能返回退款成功 trace %j",
	async (body) => {
		let calls = 0;
		const notification = refundNotificationGateway(async () => {
			calls += 1;
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": "refund-business-unconfirmed" },
			});
		});
		await expect(
			notification.notifyRefund(
				{
					orderId: "payment-order-refund-001",
					merchantRefundNo: "RF-PO-registration-001",
					refundFen: 1000,
					registrationContext: refundRegistrationContext(),
				},
				context,
			),
		).rejects.toMatchObject({
			operation: "registration-self-pay.2.6.65.15.refund",
			requestId: "refund-business-unconfirmed",
			failureStage: "response",
			responseInvalid: true,
			requestOutcome: "unknown",
			...(typeof body.data === "string" && body.data.trim()
				? { providerErrorMessage: body.data }
				: {}),
		});
		expect(calls).toBe(1);
	},
);

test.each([
	{ success: false, code: "500", data: "success" },
	{ success: true, data: { success: false, code: "500", data: "success" } },
])("云健康 .15 明确业务拒绝时不被 success 字符串覆盖 %j", async (body) => {
	const notification = refundNotificationGateway(
		async () => new Response(JSON.stringify(body), { status: 200 }),
	);
	await expect(
		notification.notifyRefund(
			{
				orderId: "payment-order-refund-001",
				merchantRefundNo: "RF-PO-registration-001",
				refundFen: 1000,
				registrationContext: refundRegistrationContext(),
			},
			context,
		),
	).rejects.toMatchObject({ requestOutcome: "rejected" });
});

test.each(unconfirmedPaymentNotifyBodies)(
	"收款 .15 同样验证业务结果，未确认时不保存完成标记也不调用 .5 %j",
	async (body) => {
		const paths: string[] = [];
		let markedCompleted = false;
		let attemptedComplete = false;
		const settlementGateway = gateway(async (input) => {
			paths.push(new URL(String(input)).pathname);
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": "payment-business-unconfirmed" },
			});
		});
		await expect(
			settlementGateway.writeBack(
				{
					orderId: "payment-order-001",
					settlementFlow: "medical-mixed-cash",
					settlement: {
						orderId: "payment-order-001",
						state: "cash_paid",
						totalFen: 1000,
						insuranceFen: 0,
						cashFen: 1000,
						trace: [],
					},
					registrationContext: {
						...registrationContext,
						thirdPartPayRecordId: "9007199254740993",
					},
					onPaymentNotifyResponse() {
						markedCompleted = true;
					},
					onCompleteSettlementAttempt() {
						attemptedComplete = true;
					},
				},
				context,
			),
		).rejects.toMatchObject({
			operation: "registration-self-pay.2.6.65.15",
			responseInvalid: true,
			requestOutcome: "unknown",
		});
		expect(paths).toEqual([
			"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
		]);
		expect(markedCompleted).toBeFalse();
		expect(attemptedComplete).toBeFalse();
	},
);

test.each([
	{ baseUrl: "https://gpsrmyy.meiyi.pro", authorizationToken: undefined },
	{
		baseUrl: "https://gpsrmyy.meiyi.pro/",
		authorizationToken: "must-not-forward",
	},
])(
	"云健康 .15 显式 signed-relay 复用原回写路径且不发送 Bearer %j",
	async (config) => {
		let request: { url: string; headers: Headers; body: string } | undefined;
		const notification =
			createYunhealthRegistrationSelfPayRefundNotificationGateway({
				baseUrl: config.baseUrl,
				refundAuthorizationMode: "signed-relay",
				...(config.authorizationToken
					? { authorizationToken: config.authorizationToken }
					: {}),
				paymentOrgId: "10756",
				pluginPayTypeId: "5033",
				pluginPayType: "CREDIT",
				workStationId: "registration-machine-01",
				paymentSource: "1",
				fetcher: async (input, init) => {
					expect(init?.redirect).toBe("error");
					request = {
						url: String(input),
						headers: new Headers(init?.headers),
						body: String(init?.body),
					};
					return new Response(
						JSON.stringify({ success: true, data: "success" }),
						{
							status: 200,
							headers: { "x-request-id": "signed-relay-refund-notify-15" },
						},
					);
				},
			});
		const input = {
			orderId: "payment-order-refund-001",
			merchantRefundNo: "RF-PO-registration-001",
			refundFen: 1234,
			registrationContext: refundRegistrationContext(),
		};
		if (!notification.validateRefundContext)
			throw new Error("Missing refund preflight");
		notification.validateRefundContext(input);
		expect(request).toBeUndefined();
		const trace = await notification.notifyRefund(input, context);
		expect(request?.url).toBe(
			"https://gpsrmyy.meiyi.pro/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
		);
		expect(request?.headers.has("authorization")).toBe(false);
		expect(request?.body).not.toContain("must-not-forward");
		expect(request?.body).toContain('"payingId":1952638941030000002');
		const wireBody = JSON.parse(request?.body ?? "{}") as {
			requestParam: string;
		};
		expect(JSON.parse(wireBody.requestParam)).toMatchObject({
			payingType: "3",
		});
		expect(trace.requestId).toBe("signed-relay-refund-notify-15");
	},
);

test.each([
	"http://gpsrmyy.meiyi.pro",
	"https://gpsrmyy.meiyi.pro:443",
	"https://gpsrmyy.meiyi.pro:8443",
	"https://yunhealth.example.test",
	"https://gpsrmyy.meiyi.pro.attacker.test",
	"https://GPSRMYY.meiyi.pro",
	"https://user@gpsrmyy.meiyi.pro",
	"https://gpsrmyy.meiyi.pro/path",
	"https://gpsrmyy.meiyi.pro/path/..",
	"https://gpsrmyy.meiyi.pro//",
	"https://gpsrmyy.meiyi.pro?mode=signed-relay",
	"https://gpsrmyy.meiyi.pro/#fragment",
	"https://%67psrmyy.meiyi.pro",
])("云健康 .15 signed-relay 拒绝不匹配的受信地址 %s", (baseUrl) => {
	let calls = 0;
	expect(() =>
		createYunhealthRegistrationSelfPayRefundNotificationGateway({
			baseUrl,
			refundAuthorizationMode: "signed-relay",
			paymentOrgId: "10756",
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			workStationId: "registration-machine-01",
			paymentSource: "1",
			fetcher: async () => {
				calls++;
				throw new Error("untrusted relay must not send HTTP");
			},
		}),
	).toThrow();
	expect(calls).toBe(0);
});

test("云健康 .15 不支持的显式授权模式在请求前失败", () => {
	expect(() =>
		createYunhealthRegistrationSelfPayRefundNotificationGateway({
			baseUrl: "https://gpsrmyy.meiyi.pro",
			refundAuthorizationMode: "unsupported" as "signed-relay",
			paymentOrgId: "10756",
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			workStationId: "registration-machine-01",
			paymentSource: "1",
		}),
	).toThrow("refundAuthorizationMode is invalid");
});

test("云健康 .15 退款前预检验证完整插件上下文且不发送 HTTP", () => {
	let calls = 0;
	const notification = refundNotificationGateway(async () => {
		calls++;
		throw new Error("preflight must not send HTTP");
	});
	expect(notification.validateRefundContext).toBeDefined();
	expect(() =>
		notification.validateRefundContext({
			orderId: "payment-order-refund-001",
			refundFen: 1234,
			registrationContext: refundRegistrationContext(),
		}),
	).not.toThrow();
	expect(calls).toBe(0);
});

test.each([
	"payingId",
	"tradingId",
	"payTypeId",
	"recordCode",
	"tradeTypeCode",
	"workStationId",
	"hospitalId",
] as const)(
	"云健康 .15 退款前预检拒绝有 payParams 但缺少 %s 的上下文",
	(field) => {
		let calls = 0;
		const notification = refundNotificationGateway(async () => {
			calls++;
			throw new Error("invalid context must not send HTTP");
		});
		const missingContext = {
			...refundRegistrationContext(),
			[field]: undefined,
		} as unknown as RegistrationSelfPaySettlementContext;
		expect(missingContext.payParams).toBeDefined();
		expect(() =>
			notification.validateRefundContext({
				orderId: "payment-order-refund-001",
				refundFen: 1234,
				registrationContext: missingContext,
			}),
		).toThrow(`${field} is invalid`);
		expect(calls).toBe(0);
	},
);

test.each([
	{ tradeTypeCode: "2" },
	{ workStationId: "different-workstation" },
	{ recordCode: "not-the-original-record-code" },
	{ hospitalId: "0" },
	{ payTypeId: "not-an-integer" },
])("云健康 .15 退款前预检拒绝错误的关联事实或服务端配置不匹配 %j", (patch) => {
	let calls = 0;
	const notification = refundNotificationGateway(async () => {
		calls++;
		throw new Error("invalid context must not send HTTP");
	});
	expect(() =>
		notification.validateRefundContext({
			orderId: "payment-order-refund-001",
			refundFen: 1234,
			registrationContext: { ...refundRegistrationContext(), ...patch },
		}),
	).toThrow();
	expect(calls).toBe(0);
});

test("云健康 .15 真正回写前重新校验上下文，不复用旧预检结果", async () => {
	let calls = 0;
	const notification = refundNotificationGateway(async () => {
		calls++;
		throw new Error("changed context must not send HTTP");
	});
	const input = {
		orderId: "payment-order-refund-001",
		refundFen: 1234,
		registrationContext: refundRegistrationContext(),
	};
	notification.validateRefundContext(input);
	input.registrationContext.recordCode = "invalid-record-code";
	await expect(
		notification.notifyRefund(
			{ ...input, merchantRefundNo: "RF-PO-registration-001" },
			context,
		),
	).rejects.toMatchObject({
		failureStage: "validation",
		requestOutcome: "not_sent",
	});
	expect(calls).toBe(0);
});

test("历史 5031 医保合单 .2 有基金支付时外层使用 H5/2 并保留原支付腿", async () => {
	let body: Record<string, unknown> | undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "registration-machine-01",
		fetcher: async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						payingId: 600001,
						tradingId: 600002,
						payRecord: { outTradeNo: "REGISTRATION-001" },
						result: JSON.stringify(yunhealthMd5Result),
					},
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-component-2" } },
			);
		},
	});

	await gatewayInstance.createPreOrder(
		{
			orderId: "medical-order-001:combined",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 17_600,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "2",
			payModel: "H5",
			payTypeParams: [
				{ payTypeId: "2", amountFen: 3_588 },
				{ payTypeId: "5031", amountFen: 14_012 },
			],
			payType: "CREDIT",
			workStationId: "registration-machine-01",
			recordCode: "fedcba9876543210fedcba9876543210",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(body).toMatchObject({
		autoSettle: 3,
		total: 176,
		payModel: "H5",
		payTypeId: 2,
		paymentSystemUserId: "",
		spbillCreateIp: "",
		payTypeParams: [
			{
				payTypeId: 2,
				amount: 35.88,
				paymentSystemUserId: "",
				spbillCreateIp: "",
			},
			{
				payTypeId: 5031,
				amount: 140.12,
				paymentSystemUserId: "",
				spbillCreateIp: "",
			},
		],
	});
});

const medicalGroupInput = {
	orderId: "medical-order-group",
	businessId: "settlement-business-001",
	tradeCode: "REGISTRATION-001",
	totalFen: 1000,
	hospitalId: "10389001",
	patientId: "100001",
	payTypeId: "5",
	payModel: "H5" as const,
	payType: "CREDIT" as const,
	workStationId: "",
	recordCode: "0123456789abcdef0123456789abcdef",
	tradeTypeCode: "10",
};

function medicalGroupGateway(fetcher: ProviderFetcher) {
	return createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		fetcher,
	});
}

for (const scenario of [
	{
		name: "纯个人账户使用外层 5",
		payTypeId: "5",
		payTypeParams: [{ payTypeId: "5", amountFen: 1000 }],
	},
	{
		name: "个人账户加减免使用外层 5",
		payTypeId: "5",
		payTypeParams: [
			{ payTypeId: "5", amountFen: 800 },
			{ payTypeId: "50", amountFen: 200 },
		],
	},
	{
		name: "个人账户与基金并存时优先外层 2",
		payTypeId: "2",
		payTypeParams: [
			{ payTypeId: "5", amountFen: 800 },
			{ payTypeId: "2", amountFen: 200 },
		],
	},
]) {
	test(`医保合单 .2 ${scenario.name}，H5 SUCCESS 不要求微信参数`, async () => {
		let body: Record<string, unknown> | undefined;
		const gatewayInstance = medicalGroupGateway(async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						payingId: "600001",
						tradingId: "600002",
						result: "SUCCESS",
					},
				}),
				{ status: 200 },
			);
		});

		const result = await gatewayInstance.createPreOrder(
			{ ...medicalGroupInput, ...scenario },
			context,
		);

		expect(body).toMatchObject({
			payModel: "H5",
			payTypeId: Number(scenario.payTypeId),
			paymentSystemUserId: "",
			total: 10,
			payTypeParams: scenario.payTypeParams.map((item) => ({
				payTypeId: Number(item.payTypeId),
				amount: item.amountFen / 100,
				paymentSystemUserId: "",
				spbillCreateIp: "",
			})),
		});
		expect(result.payTypeId).toBe(scenario.payTypeId);
		expect(result.payParams).toBeUndefined();
	});
}

for (const scenario of [
	{
		name: "外层 2 没有基金支付腿",
		payTypeId: "2",
		payTypeParams: [{ payTypeId: "5", amountFen: 1000 }],
	},
	{
		name: "外层 5 含正金额基金支付腿",
		payTypeId: "5",
		payTypeParams: [
			{ payTypeId: "5", amountFen: 800 },
			{ payTypeId: "2", amountFen: 200 },
		],
	},
	{
		name: "只有减免",
		payTypeId: "5",
		payTypeParams: [{ payTypeId: "50", amountFen: 1000 }],
	},
	{
		name: "只有现金",
		payTypeId: "2",
		payTypeParams: [{ payTypeId: "5033", amountFen: 1000 }],
	},
	{
		name: "减免加现金没有医保支付腿",
		payTypeId: "2",
		payTypeParams: [
			{ payTypeId: "50", amountFen: 800 },
			{ payTypeId: "5033", amountFen: 200 },
		],
	},
	{
		name: "支付腿为空",
		payTypeId: "5",
		payTypeParams: [],
	},
	{
		name: "含零金额支付腿",
		payTypeId: "5",
		payTypeParams: [
			{ payTypeId: "2", amountFen: 0 },
			{ payTypeId: "5", amountFen: 1000 },
		],
	},
	{
		name: "含负金额支付腿",
		payTypeId: "2",
		payTypeParams: [
			{ payTypeId: "2", amountFen: 1000 },
			{ payTypeId: "5", amountFen: -1 },
		],
	},
	{
		name: "使用小程序模式",
		payTypeId: "5",
		payModel: "MINI_PROGRAM" as const,
		payTypeParams: [{ payTypeId: "5", amountFen: 1000 }],
	},
	{
		name: "外层携带 openid",
		payTypeId: "5",
		paymentSystemUserId: "openid-grouped-not-allowed",
		payTypeParams: [{ payTypeId: "5", amountFen: 1000 }],
	},
	{
		name: "支付腿总额不等于分项金额",
		payTypeId: "5",
		amountFen: 900,
		payTypeParams: [{ payTypeId: "5", amountFen: 1000 }],
	},
	{
		name: "支付腿总额超过结算总额",
		payTypeId: "5",
		payTypeParams: [{ payTypeId: "5", amountFen: 1001 }],
	},
]) {
	test(`医保合单 .2 在请求前拒绝${scenario.name}`, async () => {
		let calls = 0;
		const gatewayInstance = medicalGroupGateway(async () => {
			calls += 1;
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		});

		await expect(
			gatewayInstance.createPreOrder(
				{ ...medicalGroupInput, ...scenario },
				context,
			),
		).rejects.toMatchObject({
			provider: "yunhealth",
			failureStage: "validation",
			requestOutcome: "not_sent",
		});
		expect(calls).toBe(0);
	});
}

test("医保后置分项完成后使用非 HIS 收款 .5 并等待 .9 查询结果", async () => {
	let request:
		| { path: string; body: Record<string, unknown>; headers: Headers }
		| undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "registration-machine-01",
		fetcher: async (input, init) => {
			request = {
				path: new URL(String(input)).pathname,
				body: JSON.parse(String(init?.body)) as Record<string, unknown>,
				headers: new Headers(init?.headers),
			};
			return new Response(
				JSON.stringify({ success: true, data: { isSettle: 1 } }),
				{ status: 200, headers: { "x-request-id": "yunhealth-complete-5" } },
			);
		},
	});
	const completeSettlement = gatewayInstance.completeSettlement;
	if (!completeSettlement) throw new Error("completeSettlement is unavailable");

	await expect(
		completeSettlement(
			{
				businessId: "settlement-business-001",
				hospitalId: "10389001",
				workStationId: "registration-machine-01",
				tradeTypeCode: "10",
			},
			context,
		),
	).resolves.toMatchObject({
		operation: "registration-self-pay.2.6.65.5",
		requestId: "yunhealth-complete-5",
	});
	expect(request?.path).toBe(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);
	expect(request?.headers.get("authorization")).toBe("Bearer server-token");
	expect(request?.body).toEqual({
		appCode: "WeChatSmallProg",
		authSysCode: "WeChatSmallProg",
		autoSettle: 2,
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		sceneCode: "WeChatSmallProgram",
		thirdFlag: 1,
		tradeTypeCode: "10",
		workStationId: "registration-machine-01",
	});
});

test("云健康 .2 业务拒绝保留精确错误码并记录原始响应", async () => {
	const previousRawLogging = Bun.env.PROVIDER_RAW_LOGGING;
	const logs: Array<Record<string, unknown>> = [];
	const logger: ProviderRequestLogger = {
		info(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		warn(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		error(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
	};
	Bun.env.PROVIDER_RAW_LOGGING = "true";

	try {
		const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
			baseUrl: "https://yunhealth.example.test",
			authorizationToken: "server-token",
			paymentOrgId: "10756",
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			workStationId: "",
			logger,
			fetcher: async () =>
				new Response(
					JSON.stringify({
						success: false,
						code: "trade-payment@0008",
						message: "操作失败，请勿重复提交或操作过于频繁！",
						data: null,
					}),
					{ status: 200, headers: { "x-request-id": "yunhealth-reject-001" } },
				),
		});

		await expect(
			gatewayInstance.createPreOrder(
				{
					orderId: "medical-order-rejected",
					businessId: "settlement-business-001",
					tradeCode: "REGISTRATION-001",
					totalFen: 1234,
					hospitalId: "10389001",
					patientId: "100001",
					payTypeId: "5033",
					payModel: "H5",
					payType: "CREDIT",
					workStationId: "",
					recordCode: "0123456789abcdef0123456789abcdef",
					tradeTypeCode: "10",
				},
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			providerErrorCode: "trade-payment@0008",
			failureStage: "response",
			requestOutcome: "rejected",
		});

		const observed = logs.find(
			(entry) => entry.event === "provider.response.observed",
		);
		expect(observed).toMatchObject({
			operation: "registration-self-pay.2.6.65.2.plugin",
			providerResponseBusinessSuccess: false,
			providerResponseCode: "trade-payment@0008",
		});
		const rejected = logs.find(
			(entry) => entry.event === "provider.response.business_rejected",
		);
		expect(rejected).toMatchObject({
			providerErrorCode: "trade-payment@0008",
			providerResponseBodyText: expect.stringContaining("trade-payment@0008"),
		});
	} finally {
		if (previousRawLogging === undefined) {
			delete Bun.env.PROVIDER_RAW_LOGGING;
		} else {
			Bun.env.PROVIDER_RAW_LOGGING = previousRawLogging;
		}
	}
});

test("医保支付后置 .2 个人账户分项使用 payTypeId=5 和 H5", async () => {
	let body: Record<string, unknown> | undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		fetcher: async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(
				JSON.stringify({
					success: true,
					data: { payingId: 500003, tradingId: 500004 },
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-plugin-5" } },
			);
		},
	});

	const result = await gatewayInstance.createPreOrder(
		{
			orderId: "medical-order-account",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 1234,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "5",
			payModel: "H5",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(body).toMatchObject({
		payModel: "H5",
		payTypeId: 5,
		payTypeParams: [{ payTypeId: 5, amount: 12.34 }],
	});
	expect(result.payTypeId).toBe("5");
});

test("医保 H5 分项接受上游 result=SUCCESS 且不解析为小程序支付参数", async () => {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					code: "0000",
					message: "成功",
					data: {
						success: true,
						code: 3,
						result: "SUCCESS",
						payTypeId: null,
						payTypes: [],
						record: { tradingId: "8842387217352952448" },
						payRecord: { payingId: "8842387217360816775" },
					},
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-h5-success" } },
			),
	});

	const result = await gatewayInstance.createPreOrder(
		{
			orderId: "medical-order-fund",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 1000,
			amountFen: 800,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "2",
			payModel: "H5",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(result).toMatchObject({
		payingId: "8842387217360816775",
		tradingId: "8842387217352952448",
		payTypeId: "2",
		payType: "CREDIT",
	});
	expect(result.payParams).toBeUndefined();
	expect(result.outTradeNo).toBeUndefined();
});

test("历史 5031 MINI_PROGRAM 分项仍拒绝缺少 MD5 参数的 result=SUCCESS", async () => {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					code: "0000",
					data: {
						success: true,
						result: "SUCCESS",
						payRecord: { payingId: 500001, tradingId: 500002 },
					},
				}),
				{ status: 200, headers: { "x-request-id": "yunhealth-mp-invalid" } },
			),
	});

	await expect(
		gatewayInstance.createPreOrder(
			{
				orderId: "medical-order-wechat-cash",
				businessId: "settlement-business-001",
				tradeCode: "REGISTRATION-001",
				totalFen: 1000,
				amountFen: 200,
				hospitalId: "10389001",
				patientId: "100001",
				payTypeId: "5031",
				payModel: "MINI_PROGRAM",
				paymentSystemUserId: "openid-001",
				payType: "CREDIT",
				workStationId: "",
				recordCode: "0123456789abcdef0123456789abcdef",
				tradeTypeCode: "10",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		failureStage: "response",
		responseInvalid: true,
	});
});

test("旧服务允许 Token 为空时云健康请求不发送授权头", async () => {
	let headers: Headers | undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "",
		paymentOrgId: "10756",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		fetcher: async (_input, init) => {
			headers = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					success: true,
					data: { payingId: 500001, tradingId: 500002 },
				}),
				{
					status: 200,
					headers: { "x-request-id": "yunhealth-plugin-no-auth" },
				},
			);
		},
	});

	await gatewayInstance.createPreOrder(
		{
			orderId: "medical-order-no-auth",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 1234,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "5033",
			payModel: "H5",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(headers?.get("authorization")).toBeNull();
});

test("普通微信自费回写只执行 .5，不调用 .29/.15", async () => {
	const paths: string[] = [];
	let call = 0;
	const gatewayInstance = gateway(async (input, init) => {
		paths.push(new URL(String(input)).pathname);
		call += 1;
		expect(String(init?.body)).toContain(
			'"businessId":"settlement-business-001"',
		);
		return new Response(
			JSON.stringify({ success: true, data: { isSettle: 1 } }),
			{
				status: 200,
				headers: { "x-request-id": `ordinary-self-pay-${call}` },
			},
		);
	});
	let legacyCallbackCalled = false;

	const trace = await gatewayInstance.writeBack(
		{
			orderId: "ordinary-self-pay-001",
			settlementFlow: "ordinary-self-pay",
			settlement: {
				orderId: "ordinary-self-pay-001",
				state: "cash_paid",
				totalFen: 1234,
				insuranceFen: 0,
				cashFen: 1234,
				trace: [],
			},
			registrationContext: {
				...registrationContext,
				businessId: "settlement-business-001",
				tradeTypeCode: "2",
				payTypeId: "5032",
			},
			onThirdPartPayAttempt() {
				legacyCallbackCalled = true;
			},
			onPaymentNotifyAttempt() {
				legacyCallbackCalled = true;
			},
		},
		context,
	);

	expect(paths).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(legacyCallbackCalled).toBeFalse();
	expect(trace).toEqual({
		provider: "yunhealth",
		operation: "registration-self-pay.2.6.65.5",
		requestId: "ordinary-self-pay-1",
		requestIds: ["ordinary-self-pay-1"],
		providerOrderId: "settlement-business-001",
	});
});

test.each(["10", "2"])(
	"医保现金回写业务 %s 的 .29 不发送三方记录 ID，仍执行 .29 -> .15 -> .5",
	async (tradeTypeCode) => {
		const requests: Array<{
			path: string;
			bodyText: string;
			body: Record<string, unknown>;
			headers: Headers;
		}> = [];
		const events: string[] = [];
		let savedThirdPart:
			| {
					rawResponse: string;
					thirdPartPayRecordId: string;
					requestId?: string;
			  }
			| undefined;
		let call = 0;
		const gatewayInstance = gateway(async (input, init) => {
			const path = new URL(String(input)).pathname;
			const bodyText = String(init?.body);
			events.push(`request:${path}`);
			requests.push({
				path,
				bodyText,
				body: JSON.parse(bodyText) as Record<string, unknown>,
				headers: new Headers(init?.headers),
			});
			call += 1;
			const body = path.endsWith("/thirdPartPay/start")
				? { success: true, data: { thirdPartPayRecordId: "9007199254740995" } }
				: path.endsWith("/complete-settle")
					? { success: true, data: { isSettle: 1 } }
					: { success: true, data: "success" };
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": `yunhealth-request-${call}` },
			});
		});

		const trace = await gatewayInstance.writeBack(
			{
				orderId: "payment-order-001",
				settlementFlow: "medical-mixed-cash",
				settlement: {
					orderId: "payment-order-001",
					state: "cash_paid",
					totalFen: 1234,
					insuranceFen: 0,
					cashFen: 1234,
					trace: [],
				},
				registrationContext: {
					...registrationContext,
					tradeTypeCode,
					payingId: "1952638941030000002",
					tradingId: "1952638941030000003",
					payTypeId: "5033",
				},
				onThirdPartPayAttempt() {
					events.push("attempt:.29");
				},
				onThirdPartPayResponse(response) {
					events.push("response:.29");
					savedThirdPart = response;
				},
				onPaymentNotifyAttempt() {
					events.push("attempt:.15");
				},
				onPaymentNotifyResponse({ requestId }) {
					events.push(`response:.15:${requestId}`);
				},
				onCompleteSettlementAttempt() {
					events.push("attempt:.5");
				},
			},
			context,
		);

		expect(requests.map((request) => request.path)).toEqual([
			"/msun-yb-app-miop/thirdPartPay/start",
			"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
			"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
		]);
		expect(
			requests.every(
				(request) =>
					request.headers.get("authorization") === "Bearer server-token",
			),
		).toBeTrue();
		expect(requests[0]?.body).toMatchObject({
			agreementNo: "payment-order-001",
			payFee: 12.34,
			payType: "CREDIT",
			payTypeId: 5033,
			payingId: "1952638941030000002",
			settleId: "settlement-business-001",
			tradingId: "1952638941030000003",
			transStatus: "0",
		});
		expect(requests[0]?.body).not.toHaveProperty("thirdPartPayRecordId");
		expect(savedThirdPart).toEqual({
			rawResponse: JSON.stringify({
				success: true,
				data: { thirdPartPayRecordId: "9007199254740995" },
			}),
			thirdPartPayRecordId: "9007199254740995",
			requestId: "yunhealth-request-1",
		});
		expect(requests[1]?.bodyText).toContain('"payingId":1952638941030000002');
		expect(String(requests[1]?.body.requestParam)).toContain(
			'"payingType":"1"',
		);
		expect(String(requests[1]?.body.requestParam)).toContain(
			'"payingId":1952638941030000002',
		);
		expect(String(requests[1]?.body.requestParam)).toContain(
			'"payTypeId":5033',
		);
		expect(String(requests[1]?.body.requestParam)).toContain(
			'"receiveAmount":12.34',
		);
		expect(requests[2]?.body).toEqual({
			appCode: "WeChatSmallProg",
			authSysCode: "WeChatSmallProg",
			autoSettle: 2,
			businessId: "settlement-business-001",
			hospitalId: 10389001,
			sceneCode: "WeChatSmallProgram",
			thirdFlag: 1,
			tradeTypeCode,
			workStationId: "",
		});
		expect(trace).toEqual({
			provider: "yunhealth",
			operation: "registration-self-pay.2.6.65.5",
			requestId: "yunhealth-request-3",
			requestIds: [
				"yunhealth-request-1",
				"yunhealth-request-2",
				"yunhealth-request-3",
			],
			providerOrderId: "settlement-business-001",
		});
		expect(events).toEqual([
			"attempt:.29",
			"request:/msun-yb-app-miop/thirdPartPay/start",
			"response:.29",
			"attempt:.15",
			"request:/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
			"response:.15:yunhealth-request-2",
			"attempt:.5",
			"request:/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
		]);
	},
);

test("医保现金回写无需平台订单号作为 .29 参数", async () => {
	const {
		platformOrderId: _platformOrderId,
		...contextWithoutPlatformOrderId
	} = registrationContext;
	const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
	const gatewayInstance = gateway(async (input, init) => {
		const path = new URL(String(input)).pathname;
		requests.push({ path, body: JSON.parse(String(init?.body)) });
		const body = path.endsWith("/thirdPartPay/start")
			? { success: true, data: { thirdPartPayRecordId: "9007199254740995" } }
			: path.endsWith("/complete-settle")
				? { success: true, data: { isSettle: 1 } }
				: { success: true, data: "success" };
		return new Response(JSON.stringify(body), {
			status: 200,
		});
	});

	await expect(
		gatewayInstance.writeBack(
			{
				orderId: "payment-order-no-platform-id-001",
				settlementFlow: "medical-mixed-cash",
				settlement: {
					orderId: "payment-order-no-platform-id-001",
					state: "cash_paid",
					totalFen: 100,
					insuranceFen: 0,
					cashFen: 100,
					trace: [],
				},
				registrationContext: contextWithoutPlatformOrderId,
			},
			context,
		),
	).resolves.toMatchObject({ providerOrderId: "settlement-business-001" });
	expect(requests.map((request) => request.path)).toEqual([
		"/msun-yb-app-miop/thirdPartPay/start",
		"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(requests[0]?.body).not.toHaveProperty("thirdPartPayRecordId");
});

test("历史 5031 自费回写可跳过 .5 但仍严格执行 .29 -> .15", async () => {
	const requestPaths: string[] = [];
	const requestBodies: Record<string, unknown>[] = [];
	const events: string[] = [];
	let completeSettlementAttempted = false;
	let call = 0;
	const gatewayInstance = gateway(async (input, init) => {
		const path = new URL(String(input)).pathname;
		requestPaths.push(path);
		requestBodies.push(
			JSON.parse(String(init?.body)) as Record<string, unknown>,
		);
		if (path.endsWith("/complete-settle")) {
			throw new Error("skipCompleteSettlement must not request .5");
		}
		call += 1;
		return new Response(
			JSON.stringify(
				path.endsWith("/thirdPartPay/start")
					? {
							success: true,
							data: { thirdPartPayRecordId: "9007199254740994" },
						}
					: { success: true, data: "success" },
			),
			{
				status: 200,
				headers: { "x-request-id": `yunhealth-skip-complete-${call}` },
			},
		);
	});

	const trace = await gatewayInstance.writeBack(
		{
			orderId: "payment-order-skip-complete-001",
			settlementFlow: "medical-mixed-cash",
			settlement: {
				orderId: "payment-order-skip-complete-001",
				state: "cash_paid",
				totalFen: 1234,
				insuranceFen: 0,
				cashFen: 1234,
				trace: [],
			},
			registrationContext: {
				...registrationContext,
				outTradeNo: "payment-order-skip-complete-001",
				payingId: "1952638941030000012",
				tradingId: "1952638941030000013",
				payTypeId: "5031",
			},
			skipCompleteSettlement: true,
			onThirdPartPayAttempt() {
				events.push("attempt:.29");
			},
			onThirdPartPayResponse() {
				events.push("response:.29");
			},
			onPaymentNotifyAttempt() {
				events.push("attempt:.15");
			},
			onPaymentNotifyResponse({ requestId }) {
				events.push(`response:.15:${requestId}`);
			},
			onCompleteSettlementAttempt() {
				completeSettlementAttempted = true;
			},
		},
		context,
	);

	expect(requestPaths).toEqual([
		"/msun-yb-app-miop/thirdPartPay/start",
		"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
	]);
	expect(requestBodies[0]).toMatchObject({ payTypeId: 5031 });
	expect(String(requestBodies[1]?.requestParam)).toContain('"payTypeId":5031');
	expect(events).toEqual([
		"attempt:.29",
		"response:.29",
		"attempt:.15",
		"response:.15:yunhealth-skip-complete-2",
	]);
	expect(completeSettlementAttempted).toBeFalse();
	expect(trace).toEqual({
		provider: "yunhealth",
		operation: "registration-self-pay.2.6.65.15",
		requestId: "yunhealth-skip-complete-2",
		requestIds: ["yunhealth-skip-complete-1", "yunhealth-skip-complete-2"],
		providerOrderId: "settlement-business-001",
	});
});

test("云健康自费回写复用已保存 .29 并以精确 64 位数字 token 发送 .15", async () => {
	const requests: Array<{ path: string; bodyText: string }> = [];
	let thirdPartAttempted = false;
	const gatewayInstance = gateway(async (input, init) => {
		const path = new URL(String(input)).pathname;
		requests.push({ path, bodyText: String(init?.body) });
		return new Response(
			JSON.stringify(
				path.endsWith("/complete-settle")
					? { success: true, data: { isSettle: 1 } }
					: { success: true, data: "success" },
			),
			{
				status: 200,
				headers: { "x-request-id": `resume-${requests.length}` },
			},
		);
	});

	await gatewayInstance.writeBack(
		{
			orderId: "payment-order-resume-001",
			settlementFlow: "medical-mixed-cash",
			settlement: {
				orderId: "payment-order-resume-001",
				state: "cash_paid",
				totalFen: 100,
				insuranceFen: 0,
				cashFen: 100,
				trace: [],
			},
			registrationContext: {
				...registrationContext,
				payingId: "1952638941030000002",
				payTypeId: "1952638941030000003",
				thirdPartPayRecordId: "1952638941030000004",
			},
			onThirdPartPayAttempt() {
				thirdPartAttempted = true;
			},
		},
		context,
	);

	expect(thirdPartAttempted).toBeFalse();
	expect(requests.map((request) => request.path)).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/payment/pay-notify",
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(requests[0]?.bodyText).toContain('"payingId":1952638941030000002');
	const paymentNotifyBody = JSON.parse(requests[0]?.bodyText ?? "{}") as Record<
		string,
		unknown
	>;
	expect(String(paymentNotifyBody.requestParam)).toContain(
		'"payTypeId":1952638941030000003',
	);
});

test("门诊自费在 .29/.15 已完成后只续跑 .5 并沿用 tradeTypeCode=2", async () => {
	let body: Record<string, unknown> | undefined;
	let path: string | undefined;
	let completeAttempted = false;
	const gatewayInstance = gateway(async (_input, init) => {
		path = new URL(String(_input)).pathname;
		body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		return new Response(
			JSON.stringify({ success: true, data: { isSettle: 1 } }),
			{
				status: 200,
				headers: { "x-request-id": "outpatient-settlement-001" },
			},
		);
	});

	await gatewayInstance.writeBack(
		{
			orderId: "outpatient-order-001",
			settlementFlow: "medical-mixed-cash",
			settlement: {
				orderId: "outpatient-order-001",
				state: "cash_paid",
				totalFen: 1000,
				insuranceFen: 0,
				cashFen: 1000,
				trace: [],
			},
			registrationContext: {
				...registrationContext,
				tradeTypeCode: "2",
				thirdPartPayRecordId: "9007199254740993",
				paymentNotifyCompleted: true,
			},
			onThirdPartPayAttempt() {
				throw new Error("completed .29 must not be replayed");
			},
			onPaymentNotifyAttempt() {
				throw new Error("completed .15 must not be replayed");
			},
			onCompleteSettlementAttempt() {
				completeAttempted = true;
			},
		},
		context,
	);

	expect(path).toBe(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);
	expect(completeAttempted).toBeTrue();
	expect(body).toMatchObject({ autoSettle: 2, tradeTypeCode: "2" });
});

test("普通挂号自费在微信前严格执行 .1 -> .27 -> .2 并保留大整数流水", async () => {
	const requests: Array<{
		path: string;
		method: string;
		url: string;
		body?: Record<string, unknown>;
	}> = [];
	const responses = [
		{
			success: true,
			data: {
				businessId: "1952638941030000001",
				businessCode: "REG-20260907-001",
				getAmount: 10,
				outSettle: {
					hisCreateTime: "2026-09-07 20:23:00",
					outSettleDetailList: [
						{
							amount: 10,
							chargeId: "101",
							itemName: "挂号费",
							outSettleDetailSubId: "201",
							outTradeOrderId: "301",
							price: 10,
							quantity: 1,
							selfBurdenRatio: 1,
						},
					],
				},
			},
		},
		{
			success: true,
			data: {
				outNetworkSettleMain: null,
				outSettleDetailList: [{ amount: 10 }],
			},
		},
		{
			success: true,
			data: {
				payRecord: {
					payingId: "1952638941030000002",
					tradingId: "1952638941030000003",
					payTypeId: "5032",
					payModel: "MINI_PROGRAM",
					payTypeCode: "WECHAT",
					tradeNo: "wx-registration-self-001",
					outTradeNo: "REG-20260907-001",
					tradeCode: "REG-20260907-001",
				},
				payRecords: [
					{
						payTypeId: "5032",
						payModel: "MINI_PROGRAM",
						tradeNo: "wx-registration-self-001",
						outTradeNo: "REG-20260907-001",
					},
				],
				result: JSON.stringify(yunhealthMd5Result),
			},
		},
	];
	let call = 0;
	const preparation = createYunhealthRegistrationSelfPayPreparationGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "",
		paymentOrgId: "10756",
		hospitalId: "10389001",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		tradeTypeCode: "10",
		miniProgramAppId: yunhealthMd5Result.appId,
		fetcher: async (request, init) => {
			const bodyText = String(init?.body ?? "");
			requests.push({
				path: new URL(String(request)).pathname,
				method: String(init?.method ?? "GET"),
				url: String(request),
				...(bodyText
					? { body: JSON.parse(bodyText) as Record<string, unknown> }
					: {}),
			});
			const body = responses[call];
			call += 1;
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": `prepare-${call}` },
			});
		},
	});

	const result = await preparation.prepare(
		{
			orderId: "payment-order-prepare-001",
			totalFen: 1000,
			providerRegisterId: "1952638941030000100",
			providerPatientId: "1952638941030000200",
			paymentSystemUserId: "openid-self-001",
			patient: {
				name: "测试患者",
				cardNo: "P000001",
				idNo: "11010519900101007X",
			},
		},
		context,
	);

	expect(requests.map((request) => request.path)).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle",
		"/msun-yb-app-miop/v1/out-insur-settle-infos",
		"/msun-middle-open-settlepay/api/v2/open/payment/pre-order",
	]);
	expect(requests[0]?.body).toMatchObject({
		patId: "1952638941030000200",
		requestParam: {
			registerId: "1952638941030000100",
			registerSource: 15,
			settleWay: 6,
		},
	});
	expect(requests[2]?.body).toMatchObject({
		payModel: "MINI_PROGRAM",
		payTypeId: 5032,
		paymentSystemUserId: "openid-self-001",
		payTypeParams: [
			{ payTypeId: 5032, paymentSystemUserId: "openid-self-001" },
		],
	});
	expect(requests[1]?.method).toBe("GET");
	expect(requests[1]?.url).toBe(
		"https://yunhealth.example.test/msun-yb-app-miop/v1/out-insur-settle-infos?patId=1952638941030000200&outSettleMainId=1952638941030000001",
	);
	expect(requests[1]?.body).toBeUndefined();
	expect(result.registrationContext).toMatchObject({
		businessId: "1952638941030000001",
		businessCode: "REG-20260907-001",
		payingId: "1952638941030000002",
		tradingId: "1952638941030000003",
		patientId: "1952638941030000200",
		outTradeNo: "wx-registration-self-001",
		outTradeNoSource: "yunhealth_2_6_65_2",
		payParams: {
			appId: yunhealthMd5Result.appId,
			timeStamp: yunhealthMd5Result.timeStamp,
			nonceStr: yunhealthMd5Result.nonceStr,
			package: yunhealthMd5Result.package,
			signType: "MD5",
			paySign: yunhealthMd5Result.sign,
		},
	});
	expect(result.trace.requestIds).toEqual([
		"prepare-1",
		"prepare-2",
		"prepare-3",
	]);
});

test("门诊自费使用 tradeTypeCode=2、挂号相同 autoSettle 和 2.6.33 订单集合", async () => {
	const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
	const responses = [
		{
			success: true,
			data: {
				businessId: "1952638941030000101",
				businessCode: "DIAG-20260907-001",
				getAmount: 10,
			},
		},
		{
			success: true,
			data: {
				outNetworkSettleMain: null,
				outSettleDetailList: [{ amount: 10 }],
			},
		},
		{
			success: true,
			data: {
				payRecord: {
					payingId: "1952638941030000102",
					tradingId: "1952638941030000103",
					outTradeNo: "OUTPATIENT-SELF-001",
				},
				result: JSON.stringify(yunhealthMd5Result),
			},
		},
	];
	let call = 0;
	const preparation = createYunhealthRegistrationSelfPayPreparationGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		hospitalId: "10389001",
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		workStationId: "",
		tradeTypeCode: "10",
		miniProgramAppId: yunhealthMd5Result.appId,
		fetcher: async (input, init) => {
			const bodyText = String(init?.body ?? "");
			requests.push({
				path: new URL(String(input)).pathname,
				...(bodyText
					? { body: JSON.parse(bodyText) as Record<string, unknown> }
					: {}),
			});
			const body = responses[call++];
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { "x-request-id": `outpatient-prepare-${call}` },
			});
		},
	});

	const result = await preparation.prepare(
		{
			orderId: "outpatient-self-pay-001",
			totalFen: 1000,
			providerPatientId: "1952638941030000200",
			outTradeOrderIds: ["401", "402"],
			businessType: "outpatient",
			paymentSystemUserId: "openid-outpatient-001",
			patient: {
				name: "测试患者",
				cardNo: "P000001",
				idNo: "11010519900101007X",
			},
		},
		context,
	);

	expect(requests[0]?.body).toMatchObject({
		autoSettle: "2",
		patId: "1952638941030000200",
		tradeTypeCode: "2",
		requestParam: { outTradeOrderIds: ["401", "402"], settleWay: 6 },
	});
	expect(requests[2]?.body).toMatchObject({
		autoSettle: 3,
		tradeTypeCode: "2",
		payTypeId: 5032,
		payModel: "MINI_PROGRAM",
	});
	expect(result.registrationContext).toMatchObject({
		businessId: "1952638941030000101",
		tradeTypeCode: "2",
	});
});

test("云健康自费回写拒绝混合金额，不能发出任何请求", async () => {
	let calls = 0;
	const gatewayInstance = gateway(async () => {
		calls += 1;
		return new Response(JSON.stringify({ success: true }), { status: 200 });
	});

	await expect(
		gatewayInstance.writeBack(
			{
				orderId: "payment-order-mixed",
				settlementFlow: "ordinary-self-pay",
				settlement: {
					orderId: "payment-order-mixed",
					state: "cash_paid",
					totalFen: 100,
					insuranceFen: 1,
					cashFen: 99,
					trace: [],
				},
				registrationContext,
			},
			context,
		),
	).rejects.toMatchObject({ requestOutcome: "not_sent" });
	expect(calls).toBe(0);
});

test("云健康 .5 返回未结算时不返回成功 trace", async () => {
	let calls = 0;
	const gatewayInstance = gateway(async () => {
		calls += 1;
		const body = { success: true, data: { isSettle: 0 } };
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "x-request-id": `yunhealth-not-settled-${calls}` },
		});
	});

	await expect(
		gatewayInstance.writeBack(
			{
				orderId: "payment-order-not-settled",
				settlementFlow: "medical-mixed-cash",
				settlement: {
					orderId: "payment-order-not-settled",
					state: "cash_paid",
					totalFen: 100,
					insuranceFen: 0,
					cashFen: 100,
					trace: [],
				},
				registrationContext: {
					...registrationContext,
					thirdPartPayRecordId: "9007199254740993",
					paymentNotifyCompleted: true,
				},
			},
			context,
		),
	).rejects.toMatchObject({ requestOutcome: "unknown" });
	expect(calls).toBe(1);
});
