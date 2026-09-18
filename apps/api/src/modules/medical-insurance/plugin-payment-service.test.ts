import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
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
		pluginPayment: {
			createPreOrder: async () => {
				throw new Error("unexpected split pre-order creation");
			},
		} as never,
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5031",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});
}

test("临时联调在微信支付前按 6202 分项完成全部 2.6.65.2 且重试不重复", async () => {
	let currentSettlement: Record<string, unknown> = {
		...settlement(),
		insuredAreaCode: "140500",
	};
	const calls: Array<{
		amountFen?: number;
		payModel: string;
		payTypeId: string;
		paymentSystemUserId?: string;
		tradeTypeCode: string;
	}> = [];
	const service = new MedicalInsurancePluginPaymentService({
		orders: {
			findByMedicalOrderId: async () => ({
				...medicalOrder(),
				businessType: "outpatient" as const,
			}),
			getSettlementContext: async () => currentSettlement,
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				value: unknown,
			) => {
				currentSettlement = value as Record<string, unknown>;
			},
		} as never,
		authorizations: { get: async () => ({}) } as never,
		identityUsers: {
			findByUserId: async () => ({ providerSubject: "openid-001" }),
		} as never,
		paymentOrders: {} as never,
		wechatPrepay: {} as never,
		pluginPayment: {
			createPreOrder: async (input: {
				amountFen?: number;
				payModel: string;
				payTypeId: string;
				paymentSystemUserId?: string;
				tradeTypeCode: string;
			}) => {
				calls.push(input);
				return {
					payingId: `paying-${calls.length}`,
					tradingId: `trading-${calls.length}`,
					payTypeId: input.payTypeId,
					payType: "CREDIT" as const,
					workStationId: "",
					tradeTypeCode: "10",
					...(input.payModel === "MINI_PROGRAM"
						? {
								outTradeNo: "wechat-cash-out-trade-001",
								payParams: {
									appId: "wx1234567890abcdef",
									timeStamp: "1789000000",
									nonceStr: "0123456789abcdef0123456789abcdef",
									package: "prepay_id=wx-provider-prepay-001",
									signType: "MD5" as const,
									paySign: "0123456789abcdef0123456789abcdef",
								},
							}
						: {}),
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: `provider-${calls.length}`,
					},
				};
			},
		},
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5031",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	const request = {
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	};
	await service.prepareSplitPaymentsBeforeOfficialWechatPayment(request);
	await service.prepareSplitPaymentsBeforeOfficialWechatPayment(request);

	expect(
		calls.map(
			({
				amountFen,
				payModel,
				payTypeId,
				paymentSystemUserId,
				tradeTypeCode,
			}) => ({
				amountFen,
				payModel,
				payTypeId,
				tradeTypeCode,
				...(paymentSystemUserId ? { paymentSystemUserId } : {}),
			}),
		),
	).toEqual([
		{
			amountFen: 500,
			payModel: "H5",
			payTypeId: "2",
			tradeTypeCode: "2",
		},
		{
			amountFen: 300,
			payModel: "H5",
			payTypeId: "5",
			tradeTypeCode: "2",
		},
		{
			amountFen: 200,
			payModel: "H5",
			payTypeId: "5031",
			tradeTypeCode: "2",
		},
	]);
	expect(
		(
			currentSettlement.postPaymentComponents as Array<{
				state: string;
			}>
		).every((component) => component.state === "succeeded"),
	).toBeTrue();
	expect(currentSettlement).toMatchObject({
		payingId: "paying-1",
		tradingId: "trading-1",
	});
});

test("仅将未创建交易的失败 5031 小程序流水迁移为 H5 后重试", async () => {
	const component = (
		kind: "fund" | "personal_account" | "wechat_cash",
		amountFen: number,
		payModel: "H5" | "MINI_PROGRAM",
		payTypeId: "2" | "5" | "5031",
		state: "succeeded" | "failed",
	) => ({
		componentId: `medical-order-001:${kind}`,
		kind,
		totalFen: 1000,
		amountFen,
		payModel,
		payTypeId,
		recordCode: createHash("sha256")
			.update(`medical-post-payment:medical-order-001:${kind}`)
			.digest("hex")
			.slice(0, 32),
		state,
		attempts: 1,
		...(state === "succeeded"
			? { payingId: `paying-${kind}`, tradingId: `trading-${kind}` }
			: { lastErrorCode: "5" }),
		updatedAt: "2026-09-18T08:22:56.000Z",
	});
	let currentSettlement: Record<string, unknown> = {
		...settlement(),
		insuredAreaCode: "140500",
		postPaymentComponents: [
			component("fund", 500, "H5", "2", "succeeded"),
			component("personal_account", 300, "H5", "5", "succeeded"),
			component("wechat_cash", 200, "MINI_PROGRAM", "5031", "failed"),
		],
	};
	const calls: Array<{
		payModel: string;
		payTypeId: string;
		paymentSystemUserId?: string;
	}> = [];
	const service = new MedicalInsurancePluginPaymentService({
		orders: {
			findByMedicalOrderId: async () => medicalOrder(),
			getSettlementContext: async () => currentSettlement,
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				value: unknown,
			) => {
				currentSettlement = value as Record<string, unknown>;
			},
		} as never,
		authorizations: { get: async () => ({}) } as never,
		identityUsers: {
			findByUserId: async () => ({ providerSubject: "openid-001" }),
		} as never,
		paymentOrders: {} as never,
		wechatPrepay: {} as never,
		pluginPayment: {
			createPreOrder: async (input: {
				payModel: string;
				payTypeId: string;
				paymentSystemUserId?: string;
			}) => {
				calls.push({
					payModel: input.payModel,
					payTypeId: input.payTypeId,
					...(input.paymentSystemUserId
						? { paymentSystemUserId: input.paymentSystemUserId }
						: {}),
				});
				return {
					payingId: "paying-wechat-cash",
					tradingId: "trading-wechat-cash",
					payTypeId: "5031" as const,
					payType: "CREDIT" as const,
					workStationId: "",
					tradeTypeCode: "10",
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: "provider-wechat-cash",
					},
				};
			},
		} as never,
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5031",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	await service.prepareSplitPaymentsBeforeOfficialWechatPayment({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	});

	expect(calls).toEqual([{ payModel: "H5", payTypeId: "5031" }]);
	expect(currentSettlement.postPaymentComponents).toMatchObject([
		{ kind: "fund", state: "succeeded", attempts: 1 },
		{ kind: "personal_account", state: "succeeded", attempts: 1 },
		{
			kind: "wechat_cash",
			payModel: "H5",
			payTypeId: "5031",
			state: "succeeded",
			attempts: 2,
			payingId: "paying-wechat-cash",
			tradingId: "trading-wechat-cash",
		},
	]);
});

test("高平普通挂号授权过期后仍可补交医院优惠H5/50且不创建微信现金分项", async () => {
	let currentSettlement: Record<string, unknown> = {
		...settlement(),
		insuredAreaCode: "140581",
	};
	const calls: Array<{
		amountFen?: number;
		payModel: string;
		payTypeId: string;
		paymentSystemUserId?: string;
	}> = [];
	const service = new MedicalInsurancePluginPaymentService({
		orders: {
			findByMedicalOrderId: async () => ({
				...medicalOrder(),
				orderType: "RegPay",
				amounts: {
					totalFen: 1000,
					cashFen: 200,
					personalAccountFen: 0,
					fundFen: 800,
				},
			}),
			getSettlementContext: async () => currentSettlement,
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				value: unknown,
			) => {
				currentSettlement = value as Record<string, unknown>;
			},
		} as never,
		authorizations: {
			get: async () => {
				throw new Error(
					"expired authorization must not be read by .2 recovery",
				);
			},
		} as never,
		identityUsers: {
			findByUserId: async () => ({ providerSubject: "openid-001" }),
		} as never,
		paymentOrders: {} as never,
		wechatPrepay: {} as never,
		pluginPayment: {
			createPreOrder: async (input) => {
				calls.push(input);
				return {
					payingId: `paying-${calls.length}`,
					tradingId: `trading-${calls.length}`,
					payTypeId: input.payTypeId,
					payType: "CREDIT" as const,
					workStationId: "",
					tradeTypeCode: "10",
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: `provider-${calls.length}`,
					},
				};
			},
		},
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5031",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	await service.prepareSplitPaymentsBeforeOfficialWechatPayment({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	});

	expect(
		calls.map(({ amountFen, payModel, payTypeId, paymentSystemUserId }) => ({
			amountFen,
			payModel,
			payTypeId,
			...(paymentSystemUserId ? { paymentSystemUserId } : {}),
		})),
	).toEqual([
		{ amountFen: 800, payModel: "H5", payTypeId: "2" },
		{ amountFen: 200, payModel: "H5", payTypeId: "50" },
	]);
	expect(
		(
			currentSettlement.postPaymentComponents as Array<{
				state: string;
			}>
		).every((component) => component.state === "succeeded"),
	).toBeTrue();
});

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
