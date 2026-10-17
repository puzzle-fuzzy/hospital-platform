import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	HospitalSettlementGateway,
	MedicalInsuranceSettlementContext,
	PaymentOrder,
} from "@hospital/domain";
import {
	createInMemoryHisPaymentReferenceRepository,
	createInMemoryMedicalInsuranceOrderRepository,
} from "@hospital/persistence";
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
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});
}

test("医保支付在微信前只创建 medical .65.2，自费 5033 保持 pending", async () => {
	let currentSettlement: Record<string, unknown> = {
		...settlement(),
		insuredAreaCode: "140500",
	};
	const calls: Array<{
		totalFen: number;
		amountFen?: number;
		payModel: string;
		payTypeId: string;
		payTypeParams?: readonly { payTypeId: string; amountFen: number }[];
		tradeTypeCode: string;
	}> = [];
	const queryReferences: Array<{
		ownerUserId: string;
		medicalOrderId: string;
		componentId: string;
		recordCode: string;
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
			saveYunhealthPaymentQueryReference: async (
				reference: (typeof queryReferences)[number],
			) => {
				queryReferences.push(reference);
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
				totalFen: number;
				payModel: string;
				payTypeId: string;
				payTypeParams?: readonly { payTypeId: string; amountFen: number }[];
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
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: `provider-${calls.length}`,
					},
				};
			},
		},
		hospitalSettlement: {} as never,
		pluginPayTypeId: "5033",
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

	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		totalFen: 1000,
		amountFen: 800,
		payModel: "H5",
		payTypeId: "2",
		tradeTypeCode: "2",
		payTypeParams: [
			{ payTypeId: "2", amountFen: 500 },
			{ payTypeId: "5", amountFen: 300 },
		],
	});
	expect(
		calls[0]?.payTypeParams?.some(
			(parameter) => parameter.payTypeId === "5033",
		),
	).toBeFalse();
	const components = currentSettlement.postPaymentComponents as Array<{
		componentId: string;
		kind: string;
		recordCode: string;
		state: string;
		attempts: number;
		payTypeParams?: readonly { payTypeId: string; amountFen: number }[];
	}>;
	const medicalComponent = components.find(
		(component) => component.kind === "medical",
	);
	if (!medicalComponent) {
		throw new Error("expected medical post-payment component");
	}
	expect(currentSettlement.postPaymentPlanVersion).toBe("sequenced-v1");
	expect(components).toHaveLength(2);
	expect(currentSettlement.postPaymentComponents).toMatchObject([
		{
			componentId: "medical-order-001:medical",
			kind: "medical",
			amountFen: 800,
			payModel: "H5",
			payTypeId: "2",
			state: "succeeded",
			attempts: 1,
			payTypeParams: [
				{ payTypeId: "2", amountFen: 500 },
				{ payTypeId: "5", amountFen: 300 },
			],
		},
		{
			componentId: "medical-order-001:wechat_cash",
			kind: "wechat_cash",
			amountFen: 200,
			payModel: "H5",
			payTypeId: "5033",
			state: "pending",
			attempts: 0,
		},
	]);
	expect(components[0]?.componentId).not.toBe(components[1]?.componentId);
	expect(components[0]?.recordCode).not.toBe(components[1]?.recordCode);
	expect(currentSettlement).toMatchObject({
		payingId: "paying-1",
		tradingId: "trading-1",
	});
	expect(queryReferences.length).toBeGreaterThanOrEqual(1);
	expect(queryReferences).toEqual(
		queryReferences.map(() => ({
			ownerUserId: "user-001",
			medicalOrderId: "medical-order-001",
			componentId: "medical-order-001:medical",
			recordCode: medicalComponent.recordCode,
		})),
	);
});

test("仅将未创建交易的历史失败 5031 小程序流水安全迁移为 H5/5033", async () => {
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
			saveYunhealthPaymentQueryReference: async () => undefined,
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
					payTypeId: "5033" as const,
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
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	await service.prepareSplitPaymentsBeforeOfficialWechatPayment({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	});

	expect(calls).toEqual([{ payModel: "H5", payTypeId: "5033" }]);
	expect(currentSettlement.postPaymentComponents).toMatchObject([
		{ kind: "fund", state: "succeeded", attempts: 1 },
		{ kind: "personal_account", state: "succeeded", attempts: 1 },
		{
			kind: "wechat_cash",
			payModel: "H5",
			payTypeId: "5033",
			state: "succeeded",
			attempts: 2,
			payingId: "paying-wechat-cash",
			tradingId: "trading-wechat-cash",
		},
	]);
});

test("高平普通挂号授权过期后只创建 medical .2，不创建 wechat_cash", async () => {
	let currentSettlement: Record<string, unknown> = {
		...settlement(),
		insuredAreaCode: "140581",
	};
	const calls: Array<{
		amountFen?: number;
		totalFen?: number;
		payModel: string;
		payTypeId: string;
		payTypeParams?: readonly { payTypeId: string; amountFen: number }[];
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
			saveYunhealthPaymentQueryReference: async () => undefined,
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
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});

	await service.prepareSplitPaymentsBeforeOfficialWechatPayment({
		ownerUserId: "user-001",
		orderId: "medical-order-001",
		context,
	});

	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		totalFen: 1000,
		amountFen: 1000,
		payModel: "H5",
		payTypeId: "2",
		payTypeParams: [
			{ payTypeId: "2", amountFen: 800 },
			{ payTypeId: "50", amountFen: 200 },
		],
	});
	expect(currentSettlement.postPaymentPlanVersion).toBe("sequenced-v1");
	expect(currentSettlement.postPaymentComponents).toMatchObject([
		{
			componentId: "medical-order-001:medical",
			kind: "medical",
			amountFen: 1000,
			state: "succeeded",
			payTypeParams: [
				{ kind: "fund", payTypeId: "2", amountFen: 800 },
				{ kind: "hospital_reduce", payTypeId: "50", amountFen: 200 },
			],
		},
	]);
	expect(
		(
			currentSettlement.postPaymentComponents as Array<{
				kind: string;
			}>
		).some((component) => component.kind === "wechat_cash"),
	).toBeFalse();
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

function completionFixture(
	options: {
		receipt?: string;
		completed?: boolean;
		failAfterAttempt?: boolean;
		withoutReferences?: boolean;
	} = {},
) {
	const references = createInMemoryHisPaymentReferenceRepository();
	let allocations = 0;
	const allocate = references.allocate.bind(references);
	references.allocate = async (scope) => {
		allocations++;
		return allocate(scope);
	};
	let currentMedicalOrder = { ...medicalOrder(), version: 1 };
	let currentSettlement: MedicalInsuranceSettlementContext = {
		...settlement(),
		plugin: {
			paymentOrderId: "payment-order-001",
			payingId: "500001",
			tradingId: "500002",
			payTypeId: "5033",
			payType: "CREDIT",
			workStationId: "",
			tradeCode: "REGISTRATION-001",
			tradeTypeCode: "10",
			outTradeNo: "payment-order-001",
			recordCode: "12345678901234567890123456789012",
			state: options.receipt ? "settled" : "cash_paid",
			...(options.receipt ? { thirdPartPayRecordId: options.receipt } : {}),
		},
	};
	let currentPaymentOrder: PaymentOrder = {
		orderId: "payment-order-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		idempotencyKey: "registration-medical-plugin-self-pay:medical-order-001",
		amounts: { totalFen: 1000, insuranceFen: 800, cashFen: 200 },
		state: options.completed ? "completed" : "cash_paid",
		version: 1,
		createdAt: "2026-09-29T00:00:00.000Z",
		updatedAt: "2026-09-29T00:00:00.000Z",
	};
	let submissions = 0;
	const hospitalSettlement: HospitalSettlementGateway = {
		writeBack: async (input) => {
			expect(input.orderId).toBe("payment-order-001");
			if (!input.registrationContext?.thirdPartPayRecordId) {
				expect(input.registrationContext?.hisPaymentReferenceId).toBe("1");
				expect(await references.findByReferenceId("1")).toMatchObject({
					status: "allocated",
					paymentScopeId: "payment-order-001",
				});
				await input.onThirdPartPayAttempt?.();
				expect(currentSettlement.plugin?.thirdPartPayAttempt?.status).toBe(
					"unknown",
				);
				submissions++;
				if (options.failAfterAttempt)
					throw new Error("simulated .29 connection lost");
				await input.onThirdPartPayResponse?.({
					rawResponse:
						'{"success":true,"data":{"thirdPartPayRecordId":"1952638941030000004"}}',
					thirdPartPayRecordId: "1952638941030000004",
					requestId: "yunhealth-.29-api-001",
				});
			}
			return {
				provider: "yunhealth",
				operation: "registration-self-pay.2.6.65.5",
				requestId: "yunhealth-.5-api-001",
			};
		},
	};
	const service = new MedicalInsurancePluginPaymentService({
		...(options.withoutReferences ? {} : { hisPaymentReferences: references }),
		orders: {
			findByMedicalOrderId: async () => currentMedicalOrder,
			getSettlementContext: async () => currentSettlement,
			claimPluginThirdPartPayAttempt: async (input: {
				paymentOrderId: string;
				outTradeNo: string;
				attemptedAt: string;
			}) => {
				const plugin = currentSettlement.plugin;
				if (
					!plugin ||
					plugin.paymentOrderId !== input.paymentOrderId ||
					plugin.outTradeNo !== input.outTradeNo ||
					plugin.thirdPartPayRecordId ||
					plugin.thirdPartPayAttempt
				)
					return false;
				currentSettlement = {
					...currentSettlement,
					plugin: {
						...plugin,
						thirdPartPayAttempt: {
							attemptedAt: input.attemptedAt,
							status: "unknown",
						},
					},
				};
				return true;
			},
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				currentSettlement = next;
			},
			applySettlement: async () => {
				currentMedicalOrder = {
					...currentMedicalOrder,
					status: "insurance_settled",
					version: currentMedicalOrder.version + 1,
				};
				return currentMedicalOrder;
			},
		} as never,
		authorizations: {} as never,
		identityUsers: {} as never,
		paymentOrders: {
			get: async () => currentPaymentOrder,
			transition: async (
				_owner: string,
				_order: string,
				state: PaymentOrder["state"],
			) => {
				currentPaymentOrder = {
					...currentPaymentOrder,
					state,
					version: currentPaymentOrder.version + 1,
				};
				return currentPaymentOrder;
			},
		} as never,
		wechatPrepay: {} as never,
		pluginPayment: {} as never,
		hospitalSettlement,
		pluginPayTypeId: "5033",
		pluginPayType: "CREDIT",
		pluginWorkStationId: "",
		pluginTradeTypeCode: "10",
	});
	return {
		service,
		references,
		complete: () =>
			service.completeOfficialWechatPayment({
				ownerUserId: "user-001",
				orderId: "medical-order-001",
				context,
			}),
		settlement: () => currentSettlement,
		submissions: () => submissions,
		allocations: () => allocations,
	};
}

test("医保混合现金在 .29 前分配数字编号，成功后登记19位回执双别名", async () => {
	const fixture = completionFixture();
	await expect(fixture.complete()).resolves.toMatchObject({
		orderId: "medical-order-001",
		status: "insurance_settled",
	});
	expect(fixture.settlement().plugin).toMatchObject({
		thirdPartPayRecordId: "1952638941030000004",
		state: "settled",
		thirdPartPayAttempt: { status: "succeeded" },
	});
	expect(
		await fixture.references.findByReferenceId("1952638941030000004"),
	).toMatchObject({
		status: "confirmed",
		referenceId: "1",
		receiptId: "1952638941030000004",
		medicalOrderId: "medical-order-001",
		paymentScopeId: "payment-order-001",
		source: "plugin",
	});
	expect(fixture.submissions()).toBe(1);
});

test("历史已成功数字回执恢复时只导入映射，不重新分配或提交 .29", async () => {
	const fixture = completionFixture({
		receipt: "1952638941030000004",
		completed: true,
	});
	await fixture.complete();
	expect(fixture.allocations()).toBe(0);
	expect(fixture.submissions()).toBe(0);
	expect(
		await fixture.references.findByReferenceId("1952638941030000004"),
	).toMatchObject({ status: "confirmed", source: "plugin" });
});

test("历史UUID回执保持原完成语义，不强转整数或生成新编号", async () => {
	const fixture = completionFixture({
		receipt: "historical-opaque-receipt",
		completed: true,
	});
	await fixture.complete();
	expect(fixture.allocations()).toBe(0);
	expect(fixture.submissions()).toBe(0);
	expect(await fixture.references.findByReferenceId("1")).toBeUndefined();
});

test(".29 断线后保留unknown并拒绝第二次发送，allocated不升级成功", async () => {
	const fixture = completionFixture({ failAfterAttempt: true });
	await expect(fixture.complete()).rejects.toThrow(
		"simulated .29 connection lost",
	);
	await expect(fixture.complete()).rejects.toThrow("result is unknown");
	expect(fixture.submissions()).toBe(1);
	expect(fixture.allocations()).toBe(1);
	expect(await fixture.references.findByReferenceId("1")).toMatchObject({
		status: "allocated",
	});
});

test("API并发完成同一plugin时原子claim只允许一次 .29 发送", async () => {
	const fixture = completionFixture();
	const results = await Promise.allSettled([
		fixture.complete(),
		fixture.complete(),
	]);
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	expect(fixture.submissions()).toBe(1);
});

test("没有数字映射仓储时停止 .29，不用UUID兜底", async () => {
	const fixture = completionFixture({ withoutReferences: true });
	await expect(fixture.complete()).rejects.toThrow("his-payment-references");
	expect(fixture.submissions()).toBe(0);
});

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

for (const successBeforeLatePrepay of [false, true]) {
	test(`过期prepay快照不能抹除真实仓储中的 .29 ${successBeforeLatePrepay ? "成功回执" : "unknown发送权"}`, async () => {
		const storage = createInMemoryMedicalInsuranceOrderRepository();
		const stamp = "2026-10-15T00:00:00.000Z";
		await storage.insert({
			...medicalOrder(),
			status: "cash_pending",
			businessType: "outpatient",
			ordStas: null,
			businessId: "business-1",
			idempotencyKey: "medical-1",
			medOrgOrd: "medical-1",
			chrgBchno: "charge-1",
			payTokenHash: null,
			setlType: "CASH",
			revsTokenHash: null,
			revsTokenExpiresAt: null,
			lastError: null,
			version: 1,
			createdAt: stamp,
			updatedAt: stamp,
		});
		await storage.saveSettlementContext("user-001", "medical-order-001", {
			...settlement(),
			plugin: {
				paymentOrderId: "payment-order-001",
				payingId: "500001",
				tradingId: "500002",
				payTypeId: "5033",
				payType: "CREDIT",
				workStationId: "",
				tradeCode: "trade-1",
				tradeTypeCode: "2",
				outTradeNo: "payment-order-001",
				recordCode: "12345678901234567890123456789012",
				state: "cash_paid",
			},
		});
		const staleSave = deferred(),
			releaseStale = deferred(),
			writebackStage = deferred(),
			abort = deferred();
		let submissions = 0;
		const service = new MedicalInsurancePluginPaymentService({
			orders: {
				...storage,
				saveSettlementContext: async (owner, id, next) => {
					if (
						next.plugin?.prepayId === "late-prepay" &&
						!next.plugin.thirdPartPayAttempt
					) {
						staleSave.resolve();
						await releaseStale.promise;
					}
					return storage.saveSettlementContext(owner, id, next);
				},
			},
			hisPaymentReferences: createInMemoryHisPaymentReferenceRepository(),
			authorizations: {} as never,
			identityUsers: {} as never,
			paymentOrders: {
				get: async () => ({
					orderId: "payment-order-001",
					ownerUserId: "user-001",
					state: "cash_paid",
					amounts: { totalFen: 1000, insuranceFen: 800, cashFen: 200 },
				}),
			} as never,
			wechatPrepay: {} as never,
			pluginPayment: {} as never,
			hospitalSettlement: {
				writeBack: async (input) => {
					await input.onThirdPartPayAttempt?.();
					submissions++;
					if (successBeforeLatePrepay)
						await input.onThirdPartPayResponse?.({
							rawResponse: "{}",
							thirdPartPayRecordId: "1952638941030000004",
						});
					writebackStage.resolve();
					await abort.promise;
					throw new Error("local simulated later transport interruption");
				},
			},
			pluginPayTypeId: "5033",
			pluginPayType: "CREDIT",
			pluginWorkStationId: "",
			pluginTradeTypeCode: "2",
		});
		const latePrepay = service.markOfficialWechatPrepayReady({
			ownerUserId: "user-001",
			orderId: "medical-order-001",
			outTradeNo: "payment-order-001",
			prepayId: "late-prepay",
			context,
		});
		await staleSave.promise;
		const complete = () =>
			service.completeOfficialWechatPayment({
				ownerUserId: "user-001",
				orderId: "medical-order-001",
				context,
			});
		const first = complete().catch((error) => error);
		try {
			await writebackStage.promise;
			releaseStale.resolve();
			await latePrepay;
			const saved = await storage.getSettlementContext(
				"user-001",
				"medical-order-001",
			);
			expect(saved?.plugin?.thirdPartPayAttempt?.status).toBe(
				successBeforeLatePrepay ? "succeeded" : "unknown",
			);
			expect(saved?.plugin?.prepayId).toBe("late-prepay");
			if (successBeforeLatePrepay) {
				expect(saved?.plugin?.thirdPartPayRecordId).toBe("1952638941030000004");
				expect(
					await storage.claimPluginThirdPartPayAttempt({
						ownerUserId: "user-001",
						medicalOrderId: "medical-order-001",
						paymentOrderId: "payment-order-001",
						outTradeNo: "payment-order-001",
						attemptedAt: stamp,
					}),
				).toBe(false);
			} else await expect(complete()).rejects.toThrow("result is unknown");
			expect(submissions).toBe(1);
		} finally {
			abort.resolve();
			await first;
		}
	});
}
