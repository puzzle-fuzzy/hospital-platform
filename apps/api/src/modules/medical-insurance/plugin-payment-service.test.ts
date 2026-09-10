import { expect, test } from "bun:test";
import { MedicalInsurancePluginPaymentService } from "./plugin-payment-service";

const context = { traceId: "trace-001", idempotencyKey: "idempotency-001" };

function medicalOrder() {
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
			personalAccountFen: 300,
			fundFen: 500,
		},
	};
}

function settlement() {
	return {
		businessId: "settlement-business-001",
		businessCode: "REGISTRATION-001",
		hospitalId: "10389001",
		patientId: "100001",
		networkRegister: {
			idNo: "11010519900101007X",
			netPatName: "测试患者",
			memberNo: "P000001",
		},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
	};
}

function serviceWith(input: {
	getSettlement: () => Record<string, unknown>;
	findPaymentOrder: () => unknown;
	saveSettlement?: (value: unknown) => void;
	applySettlement?: () => unknown;
	createPrepay?: () => unknown;
	onCreatePaymentOrder?: () => void;
}) {
	return new MedicalInsurancePluginPaymentService({
		orders: {
			findByMedicalOrderId: async () => medicalOrder(),
			getSettlementContext: async () => input.getSettlement(),
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				value: unknown,
			) => input.saveSettlement?.(value),
			applySettlement: async () => input.applySettlement?.() ?? medicalOrder(),
		} as never,
		authorizations: { get: async () => ({}) } as never,
		identityUsers: {
			findByUserId: async () => ({ providerSubject: "openid-001" }),
		} as never,
		paymentOrders: {
			findByOwnerAndIdempotencyKey: async () => input.findPaymentOrder(),
			createCashPending: async () => {
				input.onCreatePaymentOrder?.();
				throw new Error("unexpected payment order creation");
			},
		} as never,
		wechatPrepay: {
			create: async () =>
				input.createPrepay?.() ?? {
					paymentState: "cash_pending",
					payParams: {
						appId: "wx-app-001",
						timeStamp: "1788998400",
						nonceStr: "nonce-001",
						package: "prepay_id=prepay-001",
						signType: "RSA",
						paySign: "signature-001",
					},
				},
		} as never,
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5027",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});
}

test("fresh旧插件入口在付款和2.6.65.2前拒绝", async () => {
	let paymentOrders = 0;
	let wechatPrepays = 0;
	const service = serviceWith({
		getSettlement: settlement,
		findPaymentOrder: () => undefined,
		onCreatePaymentOrder: () => {
			paymentOrders += 1;
		},
		createPrepay: () => {
			wechatPrepays += 1;
		},
	});

	await expect(
		service.create({
			ownerUserId: "user-001",
			orderId: "medical-order-001",
			context,
		}),
	).rejects.toThrow("Fresh medical insurance plugin pre-order is disabled");
	expect(paymentOrders).toBe(0);
	expect(wechatPrepays).toBe(0);
});

test("发布前已存在的plugin上下文仍可恢复且不会再次提交2.6.65.2", async () => {
	let wechatPrepays = 0;
	let stored = {
		...settlement(),
		plugin: {
			paymentOrderId: "payment-order-001",
			payingId: "500001",
			tradingId: "500002",
			payTypeId: "5027",
			payType: "CREDIT",
			workStationId: "",
			tradeCode: "REGISTRATION-001",
			tradeTypeCode: "10",
			outTradeNo: "payment-order-001",
			recordCode: "12345678901234567890123456789012",
			state: "preorder_created",
		},
	};
	const paymentOrder = { orderId: "payment-order-001", state: "cash_pending" };
	const service = serviceWith({
		getSettlement: () => stored,
		findPaymentOrder: () => paymentOrder,
		saveSettlement: (value) => {
			stored = value as typeof stored;
		},
		createPrepay: () => {
			wechatPrepays += 1;
			return {
				paymentState: "cash_pending",
				payParams: {
					appId: "wx-app-001",
					timeStamp: "1788998400",
					nonceStr: "nonce-001",
					package: "prepay_id=prepay-001",
					signType: "RSA",
					paySign: "signature-001",
				},
			};
		},
	});

	const result = await service.create({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	});

	expect(wechatPrepays).toBe(1);
	expect(stored.plugin).toMatchObject({
		paymentOrderId: "payment-order-001",
		payingId: "500001",
		state: "prepay_ready",
		prepayId: "prepay-001",
	});
	expect(result.payParams?.package).toBe("prepay_id=prepay-001");
});
