import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	MedicalInsuranceOrder,
} from "@hospital/domain";
import { createLegacyFsiMedicalInsuranceGateway } from "./legacy-fsi-medical-insurance";

const order = {
	medicalOrderId: "medical-order-context-missing-001",
	ownerUserId: "user-context-missing-001",
	businessType: "registration",
} as MedicalInsuranceOrder;

const context: AdapterCallContext = {
	traceId: "trace-context-missing-001",
	idempotencyKey: "idempotency-context-missing-001",
};

test("缺少关单上下文时在 Provider 边界前返回可识别错误", async () => {
	let providerCalled = false;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => order,
			getSettlementContext: async () => undefined,
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async () => {
			providerCalled = true;
			throw new Error("provider must not be called");
		},
	});

	await expect(
		gateway.cancel(
			{
				orderId: order.medicalOrderId,
				ownerUserId: order.ownerUserId,
				reason: "payment_in_progress",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		reason: "medical-insurance-cancellation-context-missing",
		failureStage: "validation",
		responseInvalid: false,
		requestOutcome: "not_sent",
		operation: "medical-insurance.2.6.65.6",
	});

	expect(providerCalled).toBe(false);
});

test("纯医保零元订单必须经过 cashier-confirm 后才执行最终结算", async () => {
	const providerPaths: string[] = [];
	const medicalOrder = {
		medicalOrderId: "medical-order-zero-cash-001",
		ownerUserId: "user-zero-cash-001",
		authorizationId: "authorization-zero-cash-001",
		payOrdId: "pay-order-zero-cash-001",
		amounts: {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 40,
			fundFen: 60,
		},
	} as MedicalInsuranceOrder;
	const settlementContext = {
		businessId: "10001",
		hospitalId: "10389001",
		patientId: "20001",
		networkRegister: { memberNo: "30001" },
		outNetworkSettleMain: { transId: "40001" },
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "50001" }],
		tradeOrderIds: ["60001"],
		payingId: "40001",
		tradingId: "70001",
		cashierUrl: "https://cashier.example/zero-cash",
	};
	const settlement = {
		payOrdId: medicalOrder.payOrdId,
		ordStas: "6",
		totalFen: 100,
		cashFen: 0,
		personalAccountFen: 40,
		fundFen: 60,
	};
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {
			createPaymentOrder: async () => ({
				settlement,
				statusClass: "settlement_candidate",
				trace: {
					provider: "medical-insurance",
					operation: "medical-insurance.6202",
					requestId: "fsi-6202-zero-cash",
				},
			}),
			querySettlement: async () => ({
				settlement: {
					payOrdId: medicalOrder.payOrdId,
					ordStas: "6",
					amounts: settlement,
				},
				statusClass: "settlement_candidate",
				trace: {
					provider: "medical-insurance",
					operation: "medical-insurance.6301",
					requestId: "fsi-6301-zero-cash",
				},
			}),
		} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
		} as never,
		authorizations: {
			get: async () => ({ payAuthNo: "AUTH-ZERO-CASH" }),
		} as never,
		credentials: {
			get: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-zero-cash",
			}),
			getActiveForOrder: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-zero-cash",
				providerQueryIdentity: {},
			}),
		} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input) => {
			const url = new URL(String(input));
			providerPaths.push(url.pathname);
			const data = url.pathname.endsWith("/complete-settle")
				? { success: true, data: { isSettle: 1 } }
				: { success: true, data: { insur: "SUCCESS", settle: "SUCCESS" } };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const pending = await gateway.settle(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			authorizationId: medicalOrder.authorizationId as string,
			feeUploadId: "fee-upload-zero-cash-001",
			mdtrtId: "medical-treatment-zero-cash-001",
			acctUsedFlag: "1",
		},
		context,
	);
	expect(pending.state).toBe("cash_pending");
	expect(pending.providerStatus).toBe(
		"notify_success_zero_cash_cashier_pending",
	);
	expect(providerPaths).not.toContain(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);

	const completed = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(completed.state).toBe("insurance_settled");
	expect(providerPaths).toContain(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);
});
