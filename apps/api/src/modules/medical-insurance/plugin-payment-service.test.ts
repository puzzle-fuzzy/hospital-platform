import { expect, test } from "bun:test";
import { MedicalInsurancePluginPaymentService } from "./plugin-payment-service";

function medicalOrder(personalAccountFen: number) {
	return {
		medicalOrderId: "medical-order-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		status: "cash_pending",
		authorizationId: "authorization-001",
		payOrdId: "medical-pay-001",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen,
			fundFen: 800 - personalAccountFen,
		},
	};
}

function settlement() {
	return {
		businessId: "settlement-business-001",
		businessCode: "REGISTRATION-001",
		hospitalId: "10389001",
		patientId: "100001",
		payingId: "260650000000001",
		tradingId: "260650000000002",
		networkRegister: {
			idNo: "11010519900101007X",
			netPatName: "测试患者",
			memberNo: "P000001",
		},
	};
}

test("6202 的 psnAcctPay 有实际金额时第二次 .2 使用 payTypeId=5", async () => {
	let requestPayTypeId: string | undefined;
	let savedContext: Record<string, unknown> | undefined;
	const paymentOrder = {
		orderId: "payment-order-001",
		state: "pending",
	};
	const service = new MedicalInsurancePluginPaymentService({
		orders: {
			findByMedicalOrderId: async () => medicalOrder(300),
			getSettlementContext: async () => settlement(),
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				value: unknown,
			) => {
				savedContext = value as Record<string, unknown>;
			},
		} as never,
		authorizations: { get: async () => ({}) } as never,
		identityUsers: {
			findByUserId: async () => ({ providerSubject: "openid-001" }),
		} as never,
		paymentOrders: {
			findByOwnerAndIdempotencyKey: async () => null,
			createCashPending: async () => paymentOrder,
		} as never,
		wechatPrepay: {} as never,
		pluginPayment: {
			createPreOrder: async (input: { payTypeId: string }) => {
				requestPayTypeId = input.payTypeId;
				return {
					payingId: "500001",
					tradingId: "500002",
					payTypeId: input.payTypeId,
					payType: "CREDIT" as const,
					workStationId: "",
					tradeTypeCode: "10",
					trace: {
						provider: "yunhealth",
						operation: "plugin",
						requestId: "plugin-1",
					},
				};
			},
		} as never,
		hospitalSettlement: {} as never,
		pluginPayTypeId: "50",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	await service.prepareForOfficialWechatPayment({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		outTradeNo: "wechat-order-001",
		context: { traceId: "trace-001", idempotencyKey: "idempotency-001" },
	});

	expect(requestPayTypeId).toBe("5");
	expect(savedContext?.plugin).toMatchObject({ payTypeId: "5" });
});
