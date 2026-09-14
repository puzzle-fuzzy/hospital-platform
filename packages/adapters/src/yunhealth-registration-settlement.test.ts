import { expect, test } from "bun:test";
import type { ProviderFetcher, ProviderRequestLogger } from "./http";
import {
	createYunhealthRegistrationPluginPaymentGateway,
	createYunhealthRegistrationSelfPayPreparationGateway,
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
};

function gateway(fetcher: ProviderFetcher, workStationId = "") {
	return createYunhealthRegistrationSettlementGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "31",
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
		pluginPayTypeId: "31",
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
			payTypeId: "31",
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
		body: "自费支付",
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		payModel: "H5",
		payTypeId: 31,
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
			payTypeId: 31,
			amount: 12.34,
			paymentSystemUserId: "",
			spbillCreateIp: "",
		},
	]);
	expect(result).toMatchObject({
		payingId: "500001",
		tradingId: "500002",
		payTypeId: "31",
		payType: "CREDIT",
		workStationId: "registration-machine-01",
		tradeTypeCode: "10",
		trace: {
			operation: "registration-self-pay.2.6.65.2.plugin",
			requestId: "yunhealth-plugin-2",
		},
	});
});

test("云健康 .2 将 result 的 MD5 sign 安全投影为小程序 paySign", async () => {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "31",
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
						payRecord: { outTradeNo: "REGISTRATION-001" },
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
			payTypeId: "31",
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

test("医保支付后置 .2 保持整单 total 并按当次分项写 amount", async () => {
	let body: Record<string, unknown> | undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "31",
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
			orderId: "medical-order-001:wechat_cash",
			businessId: "settlement-business-001",
			tradeCode: "REGISTRATION-001",
			totalFen: 10_000,
			amountFen: 3_000,
			hospitalId: "10389001",
			patientId: "100001",
			payTypeId: "31",
			payModel: "MINI_PROGRAM",
			paymentSystemUserId: "openid-component-001",
			payType: "CREDIT",
			workStationId: "registration-machine-01",
			recordCode: "fedcba9876543210fedcba9876543210",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(body).toMatchObject({
		autoSettle: 3,
		total: 100,
		payModel: "MINI_PROGRAM",
		payTypeId: 31,
		payTypeParams: [{ payTypeId: 31, amount: 30 }],
	});
});

test("医保后置分项完成后使用非 HIS 收款 .5 并等待 .9 查询结果", async () => {
	let request:
		| { path: string; body: Record<string, unknown>; headers: Headers }
		| undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "31",
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

	await expect(
		gatewayInstance.completeSettlement!(
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
		authSysCode: "thirdSelfMachine",
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
			pluginPayTypeId: "31",
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
					payTypeId: "31",
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
		pluginPayTypeId: "31",
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
		pluginPayTypeId: "31",
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

test("微信现金 MINI_PROGRAM 分项仍拒绝缺少 MD5 参数的 result=SUCCESS", async () => {
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "31",
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
				payTypeId: "31",
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
		pluginPayTypeId: "31",
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
			payTypeId: "31",
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

test("云健康非 HIS 收款只调用 .5 并要求最终结算确认", async () => {
	const requests: Array<{
		path: string;
		body: Record<string, unknown>;
		headers: Headers;
	}> = [];
	let call = 0;
	const gatewayInstance = gateway(async (input, init) => {
		requests.push({
			path: new URL(String(input)).pathname,
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			headers: new Headers(init?.headers),
		});
		call += 1;
		const body = { success: true, data: { isSettle: 1 } };
		return new Response(JSON.stringify(body), {
			status: 200,
			headers: { "x-request-id": `yunhealth-request-${call}` },
		});
	});

	const trace = await gatewayInstance.writeBack(
		{
			orderId: "payment-order-001",
			settlement: {
				orderId: "payment-order-001",
				state: "cash_paid",
				totalFen: 1234,
				insuranceFen: 0,
				cashFen: 1234,
				trace: [],
			},
			registrationContext,
		},
		context,
	);

	expect(requests.map((request) => request.path)).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(
		requests.every(
			(request) =>
				request.headers.get("authorization") === "Bearer server-token",
		),
	).toBeTrue();
	expect(requests[0]?.body).toEqual({
		appCode: "WeChatSmallProg",
		authSysCode: "thirdSelfMachine",
		autoSettle: 2,
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		sceneCode: "WeChatSmallProgram",
		thirdFlag: 1,
		tradeTypeCode: "10",
		workStationId: "",
	});
	expect(trace).toEqual({
		provider: "yunhealth",
		operation: "registration-self-pay.2.6.65.5",
		requestId: "yunhealth-request-1",
		requestIds: ["yunhealth-request-1"],
		providerOrderId: "settlement-business-001",
	});
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
					outTradeNo: "REGISTRATION-SELF-001",
				},
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
		pluginPayTypeId: "31",
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
		payTypeId: 31,
		paymentSystemUserId: "openid-self-001",
		payTypeParams: [{ payTypeId: 31, paymentSystemUserId: "openid-self-001" }],
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
		outTradeNo: "payment-order-prepare-001",
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
				settlement: {
					orderId: "payment-order-not-settled",
					state: "cash_paid",
					totalFen: 100,
					insuranceFen: 0,
					cashFen: 100,
					trace: [],
				},
				registrationContext,
			},
			context,
		),
	).rejects.toMatchObject({ requestOutcome: "unknown" });
	expect(calls).toBe(1);
});
