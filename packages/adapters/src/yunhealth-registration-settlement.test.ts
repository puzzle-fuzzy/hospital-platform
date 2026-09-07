import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import type { ProviderFetcher } from "./http";
import { createYunhealthRegistrationSettlementGateway } from "./yunhealth-registration-settlement";

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

function gateway(fetcher: ProviderFetcher) {
	return createYunhealthRegistrationSettlementGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "server-token",
		paymentOrgId: "10756",
		pluginPayTypeId: "50",
		pluginPayType: "CREDIT",
		workStationId: "registration-machine-01",
		fetcher,
	});
}

test("云健康自费回写严格执行 .29 -> .15 -> .5 并要求最终结算确认", async () => {
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
		patId: 100001,
		patInHosId: 0,
		payFee: 12.34,
		payType: "CREDIT",
		payTypeId: 50,
		payingId: 260650000000001,
		settleId: "settlement-business-001",
		tradingId: 260650000000002,
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
				payingId: 260650000000001,
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
		workStationId: "registration-machine-01",
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
