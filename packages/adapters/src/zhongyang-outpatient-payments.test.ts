import { expect, test } from "bun:test";
import { createZhongyangOutpatientPaymentGateway } from "./zhongyang-outpatient-payments";

const context = {
	traceId: "outpatient-payment-trace-001",
	idempotencyKey: "outpatient-payment-key-001",
};

test("众阳门诊费用 adapter 只返回脱敏读模型并把元转换为分", async () => {
	let requestUrl = "";
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer server-token",
			);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							outTradeOrderId: "provider-order-secret",
							amount: "12.30",
							waitPayAmount: "3.50",
							billDeptName: "心内科",
							registerDoctor: "李医生",
							billDate: "2026-08-16 09:00:00",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "provider-payment-001" } },
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-secret",
			startTime: "2026-07-17 00:00:00",
			endTime: "2026-08-16 23:59:59",
			status: "unpaid",
			authSysCode: "thirdSelfMachine",
		},
		context,
	);

	expect(requestUrl).toContain(
		"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records?",
	);
	expect(requestUrl).toContain("tradeStatus=1");
	expect(requestUrl).toContain("authSysCode=thirdSelfMachine");
	expect(result.records).toEqual([
		{
			recordId: expect.any(String),
			status: "unpaid",
			departmentName: "心内科",
			doctorName: "李医生",
			billDate: "2026-08-16 09:00:00",
			amountFen: 350,
		},
	]);
	expect(JSON.stringify(result)).not.toContain("provider-order-secret");
});
