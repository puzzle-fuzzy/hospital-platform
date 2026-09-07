import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import type { ProviderFetcher } from "./http";
import {
	createYunhealthRegistrationPluginPaymentGateway,
	createYunhealthRegistrationSelfPayPreparationGateway,
	createYunhealthRegistrationSettlementGateway,
} from "./yunhealth-registration-settlement";

const context = {
	traceId: "registration-self-pay-trace-001",
	idempotencyKey: "registration-self-pay-request-001",
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
};

function gateway(fetcher: ProviderFetcher, workStationId = "") {
	return createYunhealthRegistrationSettlementGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "50",
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
		pluginPayTypeId: "50",
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
			payTypeId: "50",
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
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		payModel: "H5",
		payTypeId: 50,
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
			payTypeId: 50,
			amount: 12.34,
			paymentSystemUserId: "",
			spbillCreateIp: "",
		},
	]);
	expect(result).toMatchObject({
		payingId: "500001",
		tradingId: "500002",
		payTypeId: "50",
		payType: "CREDIT",
		workStationId: "registration-machine-01",
		tradeTypeCode: "10",
		trace: {
			operation: "registration-self-pay.2.6.65.2.plugin",
			requestId: "yunhealth-plugin-2",
		},
	});
});

test("旧服务允许 Token 为空时云健康请求不发送授权头", async () => {
	let headers: Headers | undefined;
	const gatewayInstance = createYunhealthRegistrationPluginPaymentGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "",
		paymentOrgId: "10756",
		pluginPayTypeId: "50",
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
			payTypeId: "50",
			payType: "CREDIT",
			workStationId: "",
			recordCode: "0123456789abcdef0123456789abcdef",
			tradeTypeCode: "10",
		},
		context,
	);

	expect(headers?.get("authorization")).toBeNull();
});

test("云健康自费回写严格执行 .29 -> .15 -> .5 并要求最终结算确认", async () => {
	const requests: Array<{
		path: string;
		body: Record<string, unknown>;
		headers: Headers;
	}> = [];
	let call = 0;
	let savedThirdPartResponse:
		| { rawResponse: string; thirdPartPayRecordId: string }
		| undefined;
	const gatewayInstance = gateway(async (input, init) => {
		requests.push({
			path: new URL(String(input)).pathname,
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			headers: new Headers(init?.headers),
		});
		call += 1;
		const body =
			call === 1
				? { success: true, data: { thirdPartPayRecordId: 900001 } }
				: call === 2
					? { success: true, data: { accepted: true } }
					: { success: true, data: { isSettle: 1 } };
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
			onThirdPartPayResponse: async (response) => {
				savedThirdPartResponse = response;
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
		patId: "100001",
		patInHosId: 0,
		payFee: 12.34,
		payType: "CREDIT",
		payTypeId: 50,
		payingId: "260650000000001",
		settleId: "settlement-business-001",
		tradingId: "260650000000002",
	});
	const notifyBody = requests[1]?.body;
	const requestParam = JSON.parse(String(notifyBody?.requestParam)) as {
		payingType: string;
		recordList: Array<Record<string, unknown>>;
	};
	expect(requestParam).toEqual({
		payingType: "1",
		recordList: [
			{
				payingId: "260650000000001",
				payTypeId: 50,
				receiveAmount: 12.34,
				recordCode: expect.stringMatching(/^[a-f0-9]{32}$/u),
				status: "3",
				source: "1",
			},
		],
	});
	expect(requests[2]?.body).toEqual({
		authSysCode: "thirdSelfMachine",
		autoSettle: 2,
		businessId: "settlement-business-001",
		hospitalId: 10389001,
		thirdFlag: 1,
		tradeTypeCode: "10",
		workStationId: "",
	});
	expect(savedThirdPartResponse).toEqual({
		rawResponse: JSON.stringify({
			success: true,
			data: { thirdPartPayRecordId: 900001 },
		}),
		thirdPartPayRecordId: "900001",
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
				outNetworkSettleMain: { amount: 10, medAmountBz: 0 },
				outSettleDetailList: [{ amount: 10 }],
			},
		},
		{
			success: true,
			data: {
				payRecord: {
					payingId: "1952638941030000002",
					tradingId: "1952638941030000003",
				},
			},
		},
	];
	let call = 0;
	const preparation = createYunhealthRegistrationSelfPayPreparationGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "",
		paymentOrgId: "10756",
		hospitalId: "10389001",
		pluginPayTypeId: "50",
		pluginPayType: "CREDIT",
		workStationId: "",
		tradeTypeCode: "10",
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
	});
	expect(result.trace.requestIds).toEqual([
		"prepare-1",
		"prepare-2",
		"prepare-3",
	]);
});

test("云健康 .29 缺少 thirdPartPayRecordId 时停止后续 HIS 回写", async () => {
	let calls = 0;
	const gatewayInstance = gateway(async () => {
		calls += 1;
		return new Response(JSON.stringify({ success: true, data: {} }), {
			status: 200,
			headers: { "x-request-id": "yunhealth-invalid-29" },
		});
	});

	await expect(
		gatewayInstance.writeBack(
			{
				orderId: "payment-order-missing-record-id",
				settlement: {
					orderId: "payment-order-missing-record-id",
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
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(calls).toBe(1);
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
		const body =
			calls === 1
				? { success: true, data: { thirdPartPayRecordId: 900001 } }
				: calls === 2
					? { success: true, data: { accepted: true } }
					: { success: true, data: { isSettle: 0 } };
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
	expect(calls).toBe(3);
});
