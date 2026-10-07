import { expect, test } from "bun:test";
import {
	HIS_REFUND_LOCAL_FIXTURE_MARKER,
	runLocalHisRefundFixture,
} from "./his-refund-local-fixture";

test("local HIS refund fixture exercises both provider identifiers without persistence or network", async () => {
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	const blockedFetch = Object.assign(
		async (..._arguments: Parameters<typeof fetch>): Promise<Response> => {
			fetchCalls += 1;
			throw new Error("the local fixture must not use network fetch");
		},
		{ preconnect: originalFetch.preconnect },
	);
	globalThis.fetch = blockedFetch;
	const report = await (async () => {
		try {
			return await runLocalHisRefundFixture({ runId: "unit001" });
		} finally {
			globalThis.fetch = originalFetch;
		}
	})();

	expect(report).toMatchObject({
		marker: HIS_REFUND_LOCAL_FIXTURE_MARKER,
		fake: true,
		persistence: "in-memory-only",
		providerNetwork: "disabled",
		fixture: {
			medicalOrderId: "FAKE-HIS-MIX-unit001",
			payOrdId: "FAKE-MI-PAY-unit001",
			outTradeNo: "FAKE-WX-OUT-unit001",
			status: "insurance_settled",
			wechatPaymentState: "cash_paid",
			amounts: {
				totalFen: 1000,
				cashFen: 300,
				personalAccountFen: 200,
				fundFen: 500,
			},
		},
		mockGatewayCalls: {
			medicalInsurance6203: 1,
			wechatRefund: 1,
			wechatRefundQuery: 1,
		},
	});
	expect(report.endpoints.medicalInsuranceByPayOrdId).toMatchObject({
		orderId: report.fixture.medicalOrderId,
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "not_required",
		amounts: {
			totalFen: 700,
			cashFen: 0,
			personalAccountFen: 200,
			fundFen: 500,
		},
	});
	expect(report.endpoints.wechatByOutTradeNo).toMatchObject({
		orderId: report.fixture.medicalOrderId,
		status: "succeeded",
		wechatStatus: "success",
		amounts: {
			totalFen: 300,
			cashFen: 300,
		},
	});
	expect(report.endpoints.medicalInsuranceQuery.refundNo).toBe(
		report.endpoints.medicalInsuranceByPayOrdId.refundNo,
	);
	expect(report.endpoints.wechatQuery.refundNo).toBe(
		report.endpoints.wechatByOutTradeNo.refundNo,
	);
	expect(fetchCalls).toBe(0);
});

test("local HIS refund fixture rejects an unsafe run identifier before creating data", async () => {
	await expect(runLocalHisRefundFixture({ runId: "not safe" })).rejects.toThrow(
		"--run-id must contain 1-16 letters, numbers, or hyphens",
	);
});
