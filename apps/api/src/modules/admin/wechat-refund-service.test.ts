import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	type MedicalInsuranceOrder,
	type MedicalInsuranceRefund,
	PatientReadModelValidationError,
	type PatientRecord,
	type PaymentOrder,
	type UserProfile,
	UserProfileReadModelValidationError,
	type WechatRefund,
	type WechatRefundProviderResult,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOperationsRepository,
	createInMemoryPaymentOperatorAuditRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { projectPaymentOrder } from "./payment-operations-projector";
import { AdminWechatRefundService } from "./wechat-refund-service";

const context = {
	traceId: "admin-refund-test-trace-001",
	idempotencyKey: "admin-refund-test-context-001",
};

function paidOrder(): PaymentOrder {
	return {
		orderId: "payment-order-refund-001",
		ownerUserId: "fixture-user-001",
		patientId: "fixture-patient-001",
		idempotencyKey: "payment-order-idempotency-001",
		amounts: { totalFen: 300, insuranceFen: 0, cashFen: 300 },
		state: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: "2026-09-18T01:01:00.000Z",
	};
}

function result(
	status: WechatRefundProviderResult["status"],
): WechatRefundProviderResult {
	return {
		status,
		merchantRefundNo: "RF-PO-refund001",
		providerRefundId: "wechat-refund-001",
		providerTransactionId: "wechat-transaction-001",
		outTradeNo: "payment-order-refund-001",
		totalFen: 300,
		refundFen: 100,
		trace: {
			provider: "wechat-pay",
			operation: "refund-request",
			requestId: "wechat-request-001",
		},
	};
}

function paidMedicalOrder(): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-order-refund-history-001",
		ownerUserId: "fixture-user-001",
		patientId: "fixture-patient-001",
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "outpatient-record-history-001",
		idempotencyKey: "medical-refund-history-001",
		medOrgOrd: "med-org-history-001",
		chrgBchno: "charge-history-001",
		payOrdId: null,
		payTokenHash: null,
		status: "cash_pending",
		ordStas: "1",
		amounts: {
			totalFen: 500,
			cashFen: 500,
			personalAccountFen: 0,
			fundFen: 0,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: "medical-wechat-out-history-001",
		wechatPaymentState: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: "2026-09-18T01:05:00.000Z",
	};
}

function medicalLedgerRefund(
	order: MedicalInsuranceOrder,
	patch: Partial<MedicalInsuranceRefund> = {},
): MedicalInsuranceRefund {
	return {
		refundId: `hi-${order.medicalOrderId}`,
		medicalOrderId: order.medicalOrderId,
		ownerUserId: order.ownerUserId,
		payOrdId: order.payOrdId ?? "query-order-001",
		refundNo: `RFMI-${order.medicalOrderId}`,
		idempotencyKey: `his-medical-leg:${order.medicalOrderId}`,
		refundType: "HI",
		totalFen:
			(order.amounts?.fundFen ?? 0) + (order.amounts?.personalAccountFen ?? 0),
		cashFen: 0,
		personalAccountFen: order.amounts?.personalAccountFen ?? 0,
		fundFen: order.amounts?.fundFen ?? 0,
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		medicalProviderRequestId: "6203-history-success",
		wechatStatus: "not_required",
		wechatMerchantRefundNo: null,
		status: "succeeded",
		lastErrorCode: null,
		version: 3,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
		...patch,
	};
}

async function medicalOptionsFixture(
	order: MedicalInsuranceOrder,
	medical: readonly MedicalInsuranceRefund[] = [],
	wechat: readonly WechatRefund[] = [],
) {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order);
	let providerCalls = 0;
	const service = new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository(wechat),
		paymentOrders: createInMemoryPaymentOrderRepository(),
		medicalInsuranceOrders: orders,
		medicalInsuranceRefunds:
			createInMemoryMedicalInsuranceRefundRepository(medical),
		gateway: {
			async requestRefund() {
				providerCalls += 1;
				throw new Error("unexpected provider write");
			},
			async queryRefund() {
				providerCalls += 1;
				throw new Error("unexpected provider query");
			},
		},
	});
	return { orders, service, providerCalls: () => providerCalls };
}

test("高平挂号现金减免不进入微信可退金额，历史读模型不调用提供商", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		orderType: "RegPay",
		businessType: "registration",
		payOrdId: "paid-discount-order",
		status: "manual_review",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 0,
			fundFen: 800,
		},
	};
	const fixture = await medicalOptionsFixture(order);
	await fixture.orders.saveSettlementContext(
		order.ownerUserId,
		order.medicalOrderId,
		{
			businessId: "registration-discount-001",
			hospitalId: "hospital-fixture",
			patientId: order.patientId,
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
			insuredAreaCode: "140581",
		},
	);
	const item = (await fixture.service.listPaymentHistory()).items[0];
	expect(item).toMatchObject({
		cashFen: 200,
		actualCashFen: 0,
		hospitalDiscountFen: 200,
		refundableFen: 0,
		medicalRefundableFen: 800,
		refundOptions: {
			ALL: { enabled: true, amountFen: 800 },
			HI: { enabled: true, amountFen: 800 },
			CASH: { enabled: false, amountFen: 0 },
		},
	});
	await expect(
		fixture.service.requestMedicalInsuranceCashByOrder(
			{ orderId: order.medicalOrderId },
			context,
		),
	).rejects.toThrow("没有可退的微信自费金额");
	expect(fixture.providerCalls()).toBe(0);
});

test("医保已退仍允许未退微信腿；两腿均已退时三个选项都禁用", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		payOrdId: "paid-mixed-order",
		status: "manual_review",
		amounts: {
			totalFen: 8000,
			cashFen: 6680,
			personalAccountFen: 0,
			fundFen: 1320,
		},
	};
	const hi = medicalLedgerRefund(order);
	const cashPending = await medicalOptionsFixture(order, [hi]);
	expect(
		(await cashPending.service.listPaymentHistory()).items[0],
	).toMatchObject({
		actualCashFen: 6680,
		medicalRefundableFen: 0,
		refundableFen: 6680,
		refundOptions: {
			ALL: { enabled: true, amountFen: 6680 },
			HI: { enabled: false, amountFen: 0 },
			CASH: { enabled: true, amountFen: 6680 },
		},
	});
	const cash = ledgerRefund({
		refundRecordId: "cash-mixed-success",
		merchantRefundNo: "RF-WX-mixed-success",
		source: "medical_insurance",
		sourceOrderId: order.medicalOrderId,
		refundFen: 6680,
		status: "success",
		updatedAt: order.updatedAt,
	});
	const completed = await medicalOptionsFixture(order, [hi], [cash]);
	const options = (await completed.service.listPaymentHistory()).items[0]
		?.refundOptions;
	for (const option of Object.values(options ?? {}))
		expect(option).toMatchObject({ enabled: false, amountFen: 0 });
	expect(completed.providerCalls()).toBe(0);
});

test("失败旧 ALL 记录和未知医保记录保留占用，不允许换入口再次退款", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		payOrdId: "paid-legacy-all",
		status: "manual_review",
		amounts: {
			totalFen: 8000,
			cashFen: 6680,
			personalAccountFen: 0,
			fundFen: 1320,
		},
	};
	const legacy = medicalLedgerRefund(order, {
		refundType: "ALL",
		totalFen: 8000,
		cashFen: 6680,
		medicalStatus: "failed",
		medicalRefStatus: null,
		wechatStatus: "requested",
		wechatMerchantRefundNo: "RFMI-old52",
		status: "failed",
		lastErrorCode: "360221",
	});
	const fixture = await medicalOptionsFixture(order, [legacy]);
	const item = (await fixture.service.listPaymentHistory()).items[0];
	expect(item).toMatchObject({
		refundableFen: 0,
		medicalRefundableFen: 0,
		refundRoute: "unavailable",
	});
	for (const option of Object.values(item?.refundOptions ?? {}))
		expect(option.enabled).toBe(false);
	const unknown = await medicalOptionsFixture(order, [
		medicalLedgerRefund(order, {
			medicalStatus: "unknown",
			medicalRefStatus: null,
			status: "manual_review",
		}),
	]);
	expect(
		(await unknown.service.listPaymentHistory()).items[0]?.refundOptions.HI
			.enabled,
	).toBe(false);
});

test("只确认医保付款时只开放医保金额；缺失挂号区域或订单类型时保守禁用", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		payOrdId: "paid-hi-only",
		ordStas: "4",
		wechatPaymentState: "unknown",
		amounts: {
			totalFen: 8000,
			cashFen: 6680,
			personalAccountFen: 0,
			fundFen: 1320,
		},
	};
	const fixture = await medicalOptionsFixture(order);
	expect((await fixture.service.listPaymentHistory()).items[0]).toMatchObject({
		refundableFen: 0,
		medicalRefundableFen: 1320,
		refundOptions: {
			ALL: { enabled: true, amountFen: 1320 },
			HI: { enabled: true, amountFen: 1320 },
			CASH: { enabled: false, amountFen: 0 },
		},
	});
	const missingType = { ...order };
	delete missingType.orderType;
	for (const incompleteOrder of [
		{ ...order, orderType: "RegPay" as const },
		missingType,
	]) {
		const incomplete = await medicalOptionsFixture(incompleteOrder);
		const item = (await incomplete.service.listPaymentHistory()).items[0];
		for (const option of Object.values(item?.refundOptions ?? {})) {
			expect(option.enabled).toBe(false);
			expect(option.reason).toContain("支付上下文不完整");
		}
	}
});

test("微信单腿只申请历史部分退费后的剩余额，重复调用复用同一退款", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		amounts: {
			totalFen: 8000,
			cashFen: 6680,
			personalAccountFen: 0,
			fundFen: 1320,
		},
	};
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order);
	const previous = ledgerRefund({
		refundRecordId: "previous-partial-cash",
		merchantRefundNo: "RF-previous-partial-cash",
		source: "medical_insurance",
		sourceOrderId: order.medicalOrderId,
		refundFen: 100,
		status: "success",
		updatedAt: order.updatedAt,
	});
	let calls = 0;
	const service = new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository([
			{
				...previous,
				totalFen: 6680,
				outTradeNo: "medical-wechat-out-history-001",
			},
		]),
		paymentOrders: createInMemoryPaymentOrderRepository(),
		medicalInsuranceOrders: orders,
		medicalInsuranceRefunds: createInMemoryMedicalInsuranceRefundRepository(),
		gateway: {
			async requestRefund(input) {
				calls += 1;
				expect(input).toMatchObject({
					totalFen: 6680,
					refundFen: 6580,
					outTradeNo: order.wechatOutTradeNo,
				});
				return { ...result("PROCESSING"), ...input };
			},
			async queryRefund() {
				throw new Error("processing record must not reapply");
			},
		},
	});
	const first = await service.requestMedicalInsuranceCashByOrder(
		{ orderId: order.medicalOrderId },
		context,
	);
	const repeated = await service.requestMedicalInsuranceCashByOrder(
		{ orderId: order.medicalOrderId },
		context,
	);
	expect(first.refundFen).toBe(6580);
	expect(repeated.merchantRefundNo).toBe(first.merchantRefundNo);
	expect(calls).toBe(1);
});

test("微信单腿检查全部医保退费历史，较新的 HI 不能遮盖旧 ALL 占用", async () => {
	const order: MedicalInsuranceOrder = {
		...paidMedicalOrder(),
		payOrdId: "old-all-history",
		amounts: {
			totalFen: 8000,
			cashFen: 6680,
			personalAccountFen: 0,
			fundFen: 1320,
		},
	};
	const oldAll = medicalLedgerRefund(order, {
		refundId: "old-all-record",
		refundNo: "RFMI-old-all",
		refundType: "ALL",
		totalFen: 8000,
		cashFen: 6680,
		updatedAt: "2026-09-18T01:00:00.000Z",
	});
	const latestHi = medicalLedgerRefund(order);
	const fixture = await medicalOptionsFixture(order, [oldAll, latestHi]);
	await expect(
		fixture.service.requestMedicalInsuranceCashByOrder(
			{ orderId: order.medicalOrderId },
			context,
		),
	).rejects.toThrow("已有整笔聚合退费记录");
	expect(fixture.providerCalls()).toBe(0);
});

test("普通挂号只在医院已完成且配置取消编排时开放退款并取消能力", async () => {
	for (const state of ["completed", "cash_paid"] as const) {
		const order: PaymentOrder = {
			...paidOrder(),
			idempotencyKey: "registration-self-pay:appointment-cancel-options",
			state,
		};
		const service = new AdminWechatRefundService({
			refunds: createInMemoryWechatRefundRepository(),
			paymentOrders: createInMemoryPaymentOrderRepository([order]),
			medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
			registrationRefundEnabled: true,
			gateway: {
				async requestRefund() {
					throw new Error("history must not refund");
				},
				async queryRefund() {
					throw new Error("history must not query provider");
				},
			},
		});
		const item = (await service.listPaymentHistory()).items[0];
		expect(item?.refundRoute).toBe("appointment_cancel");
		expect(item?.refundOptions.ALL.enabled).toBe(state === "completed");
		expect(item?.refundOptions.CASH.enabled).toBe(state === "completed");
		expect(item?.refundOptions.HI.enabled).toBe(false);
	}
});

function ledgerRefund(input: {
	refundRecordId: string;
	merchantRefundNo: string;
	source: WechatRefund["source"];
	sourceOrderId: string;
	refundFen: number;
	status: WechatRefund["status"];
	updatedAt: string;
}): WechatRefund {
	return {
		refundRecordId: input.refundRecordId,
		merchantRefundNo: input.merchantRefundNo,
		idempotencyKey: `history-refund:${input.refundRecordId}`,
		source: input.source,
		sourceOrderId: input.sourceOrderId,
		outTradeNo: `out-trade-${input.refundRecordId}`,
		totalFen: input.source === "medical_insurance" ? 500 : 300,
		refundFen: input.refundFen,
		reason: null,
		status: input.status,
		providerStatus: input.status === "success" ? "SUCCESS" : "PROCESSING",
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: null,
		successTime: input.status === "success" ? input.updatedAt : null,
		lastErrorCode: null,
		version: 1,
		createdAt: input.updatedAt,
		updatedAt: input.updatedAt,
	};
}

test("admin refund reserves a partial refund and preserves idempotency", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const orders = createInMemoryPaymentOrderRepository([paidOrder()]);
	const operations = createInMemoryPaymentOperationsRepository();
	await projectPaymentOrder(operations, paidOrder());
	const audits = createInMemoryPaymentOperatorAuditRepository();
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		paymentOperations: operations,
		operatorAudits: audits,
		gateway: {
			async requestRefund(input) {
				requestCount += 1;
				expect(input.outTradeNo).toBe("payment-order-refund-001");
				return result("PROCESSING");
			},
			async queryRefund() {
				return result("SUCCESS");
			},
		},
		createId: () => "refund001",
		now: () => new Date("2026-09-18T01:02:00.000Z"),
	});

	const first = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-001",
		},
		context,
	);
	expect(first.status).toBe("processing");
	expect(requestCount).toBe(1);

	const replay = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-001",
		},
		context,
	);
	expect(replay.merchantRefundNo).toBe(first.merchantRefundNo);
	expect(requestCount).toBe(1);

	const queried = await service.query(first.merchantRefundNo, context);
	expect(queried.status).toBe("success");
	const aggregate = await operations.findAggregateByBusinessKey(
		`payment_order:${paidOrder().orderId}`,
	);
	expect(aggregate).toBeDefined();
	const auditItems = await audits.listByAggregate(aggregate?.aggregateId ?? "");
	expect(auditItems).toHaveLength(2);
	expect(auditItems.map((item) => item.action).sort()).toEqual([
		"refund_query",
		"refund_request",
	]);
});

test("HIS 微信单腿从医保订单读取完整现金段并复用稳定退款号", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	await medicalOrders.insert(paidMedicalOrder());
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: {} as never,
		medicalInsuranceOrders: medicalOrders,
		gateway: {
			async requestRefund(input) {
				requestCount += 1;
				return {
					...input,
					status: "SUCCESS" as const,
					providerRefundId: "wechat-his-refund-001",
					trace: {
						provider: "wechat-pay",
						operation: "refund-request",
						requestId: "wechat-his-request-001",
					},
				};
			},
			async queryRefund() {
				throw new Error("query should not be needed after success");
			},
		},
	});

	const first = await service.requestMedicalInsuranceCashByOrder(
		{ orderId: paidMedicalOrder().medicalOrderId, reason: "HIS微信退费" },
		context,
	);
	const replay = await service.requestMedicalInsuranceCashByOrder(
		{ orderId: paidMedicalOrder().medicalOrderId, reason: "HIS微信退费" },
		context,
	);

	expect(first.status).toBe("success");
	expect(first.refundFen).toBe(500);
	expect(first.merchantRefundNo).toMatch(/^RFHIS[0-9a-f]{56}$/u);
	expect(replay.merchantRefundNo).toBe(first.merchantRefundNo);
	expect(requestCount).toBe(1);
});

test("HIS 微信单腿可按 outTradeNo 反查医保订单并复用平台退款身份", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	const order = paidMedicalOrder();
	const outTradeNo = order.wechatOutTradeNo;
	if (!outTradeNo) throw new Error("test order must include wechatOutTradeNo");
	await medicalOrders.insert(order);
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: {} as never,
		medicalInsuranceOrders: medicalOrders,
		gateway: {
			async requestRefund(input) {
				requestCount += 1;
				expect(input.outTradeNo).toBe(outTradeNo);
				return {
					...input,
					status: "SUCCESS" as const,
					providerRefundId: "wechat-his-out-trade-no-refund-001",
					trace: {
						provider: "wechat-pay",
						operation: "refund-request",
						requestId: "wechat-his-out-trade-no-request-001",
					},
				};
			},
			async queryRefund() {
				throw new Error("query should not be needed after success");
			},
		},
	});

	const byOutTradeNo = await service.requestMedicalInsuranceCashByOutTradeNo(
		{ outTradeNo, reason: "HIS微信退费" },
		context,
	);
	const byOrder = await service.requestMedicalInsuranceCashByOrder(
		{ orderId: order.medicalOrderId, reason: "HIS微信退费" },
		context,
	);

	expect(byOutTradeNo).toMatchObject({
		source: "medical_insurance",
		sourceOrderId: order.medicalOrderId,
		outTradeNo: order.wechatOutTradeNo,
		refundFen: order.amounts?.cashFen,
		status: "success",
	});
	expect(byOrder.merchantRefundNo).toBe(byOutTradeNo.merchantRefundNo);
	expect(requestCount).toBe(1);
});

test("HIS 微信单腿按不存在的 outTradeNo 查单时返回退款未找到", async () => {
	const service = new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository(),
		paymentOrders: {} as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		gateway: {
			async requestRefund() {
				throw new Error("refund must not be requested");
			},
			async queryRefund() {
				throw new Error("refund must not be queried");
			},
		},
	});

	await expect(
		service.requestMedicalInsuranceCashByOutTradeNo(
			{ outTradeNo: "medical-wechat-out-missing-001" },
			context,
		),
	).rejects.toThrow("Wechat refund record was not found");
});

test("admin refund does not send a second refund when the first request is unknown", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const orders = createInMemoryPaymentOrderRepository([paidOrder()]);
	let requestCount = 0;
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		gateway: {
			async requestRefund() {
				requestCount += 1;
				throw new ProviderRequestError({
					provider: "wechat-pay",
					operation: "refund-request",
					message: "timeout",
					retryable: true,
					failureStage: "transport",
					requestOutcome: "unknown",
				});
			},
			async queryRefund() {
				return result("PROCESSING");
			},
		},
		createId: () => "refund001",
	});

	const first = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-002",
		},
		context,
	);
	expect(first.status).toBe("unknown");
	expect(requestCount).toBe(1);

	const recovered = await service.request(
		{
			source: "payment_order",
			orderId: paidOrder().orderId,
			refundFen: 100,
			idempotencyKey: "admin-refund-idempotency-002",
		},
		context,
	);
	expect(recovered.status).toBe("processing");
	expect(requestCount).toBe(1);
});

test("refund audit failure never downgrades a confirmed WeChat refund", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: createInMemoryPaymentOrderRepository([paidOrder()]),
		medicalInsuranceOrders: {} as never,
		operatorAudits: {
			async append() {
				throw new Error("audit unavailable");
			},
			async listByAggregate() {
				return [];
			},
		},
		gateway: {
			async requestRefund() {
				return result("SUCCESS");
			},
			async queryRefund() {
				throw new Error("query should not be needed");
			},
		},
		createId: () => "refund001",
	});

	await expect(
		service.request(
			{
				source: "payment_order",
				orderId: paidOrder().orderId,
				refundFen: 100,
				idempotencyKey: "refund-audit-failure-001",
			},
			context,
		),
	).rejects.toThrow("audit unavailable");
	const findRefunds = refunds.findBySourceAndSourceOrder;
	if (!findRefunds) throw new Error("refund lookup is not configured");
	const records = await findRefunds("payment_order", paidOrder().orderId);
	expect(records[0]?.status).toBe("success");
});

test("trusted registration refund uses the Provider-saved out_trade_no", async () => {
	const refunds = createInMemoryWechatRefundRepository();
	const registrationOrder: PaymentOrder = {
		...paidOrder(),
		idempotencyKey: "registration-self-pay:appointment-trusted-001",
	};
	const orders = createInMemoryPaymentOrderRepository([registrationOrder]);
	let requestedOutTradeNo = "";
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: {} as never,
		gateway: {
			async requestRefund(input) {
				requestedOutTradeNo = input.outTradeNo;
				return {
					status: "SUCCESS",
					merchantRefundNo: input.merchantRefundNo,
					providerRefundId: "wechat-refund-trusted-001",
					providerTransactionId: "wechat-transaction-trusted-001",
					outTradeNo: input.outTradeNo,
					totalFen: input.totalFen,
					refundFen: input.refundFen,
					trace: {
						provider: "wechat-pay",
						operation: "refund-request",
						requestId: "wechat-request-trusted-001",
					},
				};
			},
			async queryRefund() {
				throw new Error("confirmed refund must not be queried");
			},
		},
		createId: () => "refundtrusted001",
		now: () => new Date("2026-09-18T01:02:00.000Z"),
	});

	const refund = await service.requestTrustedPaymentOrder(
		{
			orderId: registrationOrder.orderId,
			outTradeNo: "YUNHEALTH-WX-OUT-001",
			refundFen: 300,
			idempotencyKey: "registration-self-pay-refund:appointment-001",
		},
		context,
	);

	expect(requestedOutTradeNo).toBe("YUNHEALTH-WX-OUT-001");
	expect(refund).toMatchObject({
		source: "payment_order",
		sourceOrderId: registrationOrder.orderId,
		outTradeNo: "YUNHEALTH-WX-OUT-001",
		status: "success",
	});
});

test("admin refund history shows prior payments and only enables the safe refund route", async () => {
	const registrationOrder: PaymentOrder = {
		...paidOrder(),
		orderId: "registration-payment-history-001",
		idempotencyKey: "registration-self-pay:appointment-history-001",
		state: "completed",
		amounts: { totalFen: 200, insuranceFen: 0, cashFen: 200 },
		updatedAt: "2026-09-18T01:04:00.000Z",
	};
	const unconfirmedOrder: PaymentOrder = {
		...paidOrder(),
		orderId: "payment-history-unconfirmed-001",
		idempotencyKey: "outpatient-self-pay:record-unconfirmed-001",
		state: "cash_pending",
		updatedAt: "2026-09-18T01:03:00.000Z",
	};
	const paymentOrders = createInMemoryPaymentOrderRepository([
		paidOrder(),
		registrationOrder,
		unconfirmedOrder,
	]);
	const medicalInsuranceOrders =
		createInMemoryMedicalInsuranceOrderRepository();
	await medicalInsuranceOrders.insert(paidMedicalOrder());
	const refunds = createInMemoryWechatRefundRepository([
		ledgerRefund({
			refundRecordId: "refund-history-normal-001",
			merchantRefundNo: "RF-PO-history-normal-001",
			source: "payment_order",
			sourceOrderId: paidOrder().orderId,
			refundFen: 100,
			status: "success",
			updatedAt: "2026-09-18T01:02:00.000Z",
		}),
		ledgerRefund({
			refundRecordId: "refund-history-medical-001",
			merchantRefundNo: "RF-MI-history-medical-001",
			source: "medical_insurance",
			sourceOrderId: paidMedicalOrder().medicalOrderId,
			refundFen: 80,
			status: "processing",
			updatedAt: "2026-09-18T01:06:00.000Z",
		}),
	]);
	const medicalRefunds = createInMemoryMedicalInsuranceRefundRepository([
		{
			refundId: "medical-aggregate-history-001",
			medicalOrderId: paidMedicalOrder().medicalOrderId,
			ownerUserId: paidMedicalOrder().ownerUserId,
			payOrdId: "pay-ord-history-001",
			refundNo: "RFMIhistory001",
			idempotencyKey: "admin-medical-full:medical-order-refund-history-001",
			refundType: "ALL",
			totalFen: 500,
			cashFen: 500,
			personalAccountFen: 0,
			fundFen: 0,
			medicalStatus: "success",
			medicalRefStatus: "SUCC",
			medicalProviderRequestId: "6203-history-001",
			wechatStatus: "success",
			wechatMerchantRefundNo: "RFMIhistory001",
			status: "succeeded",
			lastErrorCode: null,
			version: 3,
			createdAt: "2026-09-18T01:06:00.000Z",
			updatedAt: "2026-09-18T01:07:00.000Z",
		} satisfies MedicalInsuranceRefund,
	]);
	const service = new AdminWechatRefundService({
		refunds,
		paymentOrders,
		medicalInsuranceOrders,
		medicalInsuranceRefunds: medicalRefunds,
		gateway: {
			async requestRefund() {
				throw new Error("history query must not request a refund");
			},
			async queryRefund() {
				throw new Error("history query must not call Wechat");
			},
		},
	});

	const historyPage = await service.listPaymentHistory({ limit: 10 });
	const history = historyPage.items;
	expect(historyPage).toMatchObject({
		total: 4,
		page: 1,
		pageSize: 10,
	});
	const normal = history.find(
		(record) => record.orderId === paidOrder().orderId,
	);
	const registration = history.find(
		(record) => record.orderId === registrationOrder.orderId,
	);
	const medical = history.find(
		(record) => record.orderId === paidMedicalOrder().medicalOrderId,
	);
	const unconfirmed = history.find(
		(record) => record.orderId === unconfirmedOrder.orderId,
	);

	expect(normal).toMatchObject({
		source: "payment_order",
		business: "other",
		totalFen: paidOrder().amounts.totalFen,
		insuranceFen: paidOrder().amounts.insuranceFen,
		cashPaymentConfirmed: true,
		cashFen: 300,
		refundReservedFen: 100,
		refundableFen: 200,
		refundRoute: "admin",
		latestRefund: {
			merchantRefundNo: "RF-PO-history-normal-001",
			status: "success",
		},
	});
	expect(normal).not.toHaveProperty("ownerUserId");
	expect(normal).not.toHaveProperty("outTradeNo");
	expect(registration).toMatchObject({
		business: "registration",
		refundRoute: "appointment_cancel",
	});
	expect(medical).toMatchObject({
		source: "medical_insurance",
		business: "outpatient",
		totalFen: paidMedicalOrder().amounts?.totalFen,
		personalAccountFen: paidMedicalOrder().amounts?.personalAccountFen,
		fundFen: paidMedicalOrder().amounts?.fundFen,
		cashPaymentConfirmed: true,
		refundReservedFen: 580,
		refundableFen: 0,
		refundRoute: "unavailable",
		latestMedicalRefund: {
			refundNo: "RFMIhistory001",
			status: "succeeded",
			medicalStatus: "success",
			wechatStatus: "success",
			totalFen: 500,
		},
	});
	expect(unconfirmed).toMatchObject({
		cashPaymentConfirmed: false,
		refundableFen: 0,
		refundRoute: "unavailable",
	});

	const secondPage = await service.listPaymentHistory({ page: 2, pageSize: 2 });
	expect(secondPage).toMatchObject({ total: 4, page: 2, pageSize: 2 });
	expect(secondPage.items.map((record) => record.orderId)).toEqual([
		unconfirmedOrder.orderId,
		paidOrder().orderId,
	]);

	const registrationPage = await service.listPaymentHistory({
		business: "registration",
		pageSize: 10,
	});
	expect(registrationPage).toMatchObject({ total: 1, page: 1, pageSize: 10 });
	expect(registrationPage.items.map((record) => record.orderId)).toEqual([
		registrationOrder.orderId,
	]);

	const paidOnBusinessDay = await service.listPaymentHistory({
		businessDay: "2026-09-18",
		status: "paid",
		pageSize: 10,
	});
	expect(paidOnBusinessDay.total).toBe(2);
	expect(paidOnBusinessDay.items.map((record) => record.orderId)).toEqual([
		registrationOrder.orderId,
		paidOrder().orderId,
	]);
	await expect(
		service.listPaymentHistory({ businessDay: "2026-02-30" }),
	).rejects.toThrow("业务日必须是有效的 YYYY-MM-DD 日期");

	await expect(
		service.request(
			{
				source: "payment_order",
				orderId: registrationOrder.orderId,
				refundFen: 100,
				idempotencyKey: "admin-registration-refund-blocked-001",
			},
			context,
		),
	).rejects.toThrow("挂号自费退款必须从预约取消流程发起");
});

test("payment operation detail omits patient identity and records a read audit", async () => {
	const operations = createInMemoryPaymentOperationsRepository();
	const audits = createInMemoryPaymentOperatorAuditRepository();
	const order = paidOrder();
	const projection = await projectPaymentOrder(operations, order);
	const service = new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository(),
		paymentOrders: createInMemoryPaymentOrderRepository([order]),
		medicalInsuranceOrders: {} as never,
		paymentOperations: operations,
		operatorAudits: audits,
		gateway: {} as never,
		createId: () => "audit001",
		now: () => new Date("2026-09-18T01:02:00.000Z"),
	});

	const detail = await service.getPaymentOperationDetail(
		projection.aggregate.aggregateId,
		{ requestId: "admin-request-001" },
	);
	expect(detail.aggregate).not.toHaveProperty("ownerUserId");
	expect(detail.aggregate).not.toHaveProperty("patientId");
	expect(
		await audits.listByAggregate(projection.aggregate.aggregateId),
	).toEqual([
		{
			auditId: "audit-audit001",
			operatorRef: null,
			action: "payment_detail_read",
			aggregateId: projection.aggregate.aggregateId,
			requestId: "admin-request-001",
			outcome: "succeeded",
			occurredAt: "2026-09-18T01:02:00.000Z",
		},
	]);
});

function historyPatient(overrides: Partial<PatientRecord> = {}): PatientRecord {
	return {
		id: paidOrder().patientId,
		ownerUserId: paidOrder().ownerUserId,
		displayName: "测试就诊人甲",
		relationship: "self",
		cardNumberMasked: "12345*********7890",
		source: "hospital-his",
		clinicalAccess: "ready",
		...overrides,
	};
}

function historyUserProfile(overrides: Partial<UserProfile> = {}): UserProfile {
	return {
		userId: paidOrder().ownerUserId,
		displayName: "测试下单用户",
		gender: "unknown",
		age: null,
		email: null,
		version: 1,
		...overrides,
	};
}

async function participantHistoryService(
	lookups: Pick<
		ConstructorParameters<typeof AdminWechatRefundService>[0],
		"patients" | "userProfiles"
	> = {},
	paymentOrders: readonly PaymentOrder[] = [paidOrder()],
	medicalOrders: readonly MedicalInsuranceOrder[] = [paidMedicalOrder()],
) {
	const medicalInsuranceOrders =
		createInMemoryMedicalInsuranceOrderRepository();
	for (const order of medicalOrders) await medicalInsuranceOrders.insert(order);
	return new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository(),
		paymentOrders: createInMemoryPaymentOrderRepository(paymentOrders),
		medicalInsuranceOrders,
		...lookups,
		gateway: {
			async requestRefund() {
				throw new Error("participant history must not request a refund");
			},
			async queryRefund() {
				throw new Error("participant history must not call Wechat");
			},
		},
	});
}

test("payment history matches each source to its own patient and caches names only within the request", async () => {
	let patientReads = 0;
	let userReads = 0;
	let userName = "测试下单用户";
	const medicalOrder = {
		...paidMedicalOrder(),
		patientId: "fixture-patient-002",
	};
	const service = await participantHistoryService(
		{
			patients: {
				async listByOwner(ownerUserId) {
					patientReads += 1;
					expect(ownerUserId).toBe(paidOrder().ownerUserId);
					return [
						{
							...historyPatient(),
							providerPatientId: "sensitive-provider-patient",
							idNo: "sensitive-patient-id-number",
							phone: "sensitive-patient-phone",
						},
						historyPatient({
							id: medicalOrder.patientId,
							displayName: "测试就诊人乙",
							relationship: "child",
						}),
					];
				},
			},
			userProfiles: {
				async findByUserId(userId) {
					userReads += 1;
					expect(userId).toBe(paidOrder().ownerUserId);
					return {
						...historyUserProfile({ displayName: userName }),
						email: "sensitive-email@example.com",
						openid: "sensitive-openid",
						unionId: "sensitive-union-id",
					};
				},
			},
		},
		[paidOrder()],
		[medicalOrder],
	);
	const first = await service.listPaymentHistory();
	expect(first.items).toHaveLength(2);
	expect(
		first.items.find((record) => record.source === "payment_order"),
	).toMatchObject({
		patientDisplayName: "测试就诊人甲",
		orderUserDisplayName: "测试下单用户",
	});
	expect(
		first.items.find((record) => record.source === "medical_insurance"),
	).toMatchObject({
		patientDisplayName: "测试就诊人乙",
		orderUserDisplayName: "测试下单用户",
	});
	expect(patientReads).toBe(1);
	expect(userReads).toBe(1);
	for (const record of first.items) {
		for (const field of [
			"patientId",
			"ownerUserId",
			"cardNumberMasked",
			"relationship",
			"email",
			"openid",
			"unionId",
			"providerPatientId",
			"idNo",
			"phone",
			"payer",
		]) {
			expect(record).not.toHaveProperty(field);
		}
	}
	expect(JSON.stringify(first)).not.toContain("sensitive-");
	userName = "更新后的下单用户";
	const second = await service.listPaymentHistory();
	expect(
		second.items.every((record) => record.orderUserDisplayName === userName),
	).toBe(true);
	expect(patientReads).toBe(2);
	expect(userReads).toBe(2);
});

test("payment history never shares participant names between order owners", async () => {
	const otherOrder = {
		...paidMedicalOrder(),
		ownerUserId: "fixture-other-owner",
	};
	const ownersRead: string[] = [];
	const service = await participantHistoryService(
		{
			patients: {
				async listByOwner(ownerUserId) {
					ownersRead.push(ownerUserId);
					return [
						historyPatient({
							ownerUserId,
							displayName: `就诊人-${ownerUserId}`,
						}),
					];
				},
			},
			userProfiles: {
				async findByUserId(userId) {
					return historyUserProfile({
						userId,
						displayName: `下单用户-${userId}`,
					});
				},
			},
		},
		[paidOrder()],
		[otherOrder],
	);
	const page = await service.listPaymentHistory();
	expect(ownersRead.sort()).toEqual(
		[paidOrder().ownerUserId, otherOrder.ownerUserId].sort(),
	);
	for (const record of page.items) {
		const owner =
			record.source === "payment_order"
				? paidOrder().ownerUserId
				: otherOrder.ownerUserId;
		expect(record).toMatchObject({
			patientDisplayName: `就诊人-${owner}`,
			orderUserDisplayName: `下单用户-${owner}`,
		});
	}
});

for (const scenario of [
	{
		name: "another owner in the patient directory",
		patient: historyPatient({ ownerUserId: "other-owner" }),
		profile: historyUserProfile(),
		patientVisible: false,
		userVisible: true,
	},
	{
		name: "another user's profile",
		patient: historyPatient(),
		profile: historyUserProfile({ userId: "other-owner" }),
		patientVisible: true,
		userVisible: false,
	},
	{
		name: "a patient display name containing a control character",
		patient: historyPatient({ displayName: "不合法\n姓名" }),
		profile: historyUserProfile(),
		patientVisible: false,
		userVisible: true,
	},
	{
		name: "a user display name containing a control character",
		patient: historyPatient(),
		profile: historyUserProfile({ displayName: "不合法\n昵称" }),
		patientVisible: true,
		userVisible: false,
	},
]) {
	test(`payment history omits invalid participant data: ${scenario.name}`, async () => {
		const service = await participantHistoryService({
			patients: {
				async listByOwner() {
					return [scenario.patient];
				},
			},
			userProfiles: {
				async findByUserId() {
					return scenario.profile;
				},
			},
		});
		for (const record of (await service.listPaymentHistory()).items) {
			if (scenario.patientVisible) {
				expect(record.patientDisplayName).toBe(scenario.patient.displayName);
			} else {
				expect(record).not.toHaveProperty("patientDisplayName");
			}
			if (scenario.userVisible) {
				expect(record.orderUserDisplayName).toBe(scenario.profile.displayName);
			} else {
				expect(record).not.toHaveProperty("orderUserDisplayName");
			}
		}
	});
}

test("payment history leaves names absent for missing lookups or missing linked records", async () => {
	for (const lookups of [
		{},
		{
			patients: {
				async listByOwner() {
					return [historyPatient({ id: "unrelated-patient" })];
				},
			},
			userProfiles: {
				async findByUserId() {
					return undefined;
				},
			},
		},
	]) {
		const service = await participantHistoryService(lookups);
		for (const record of (await service.listPaymentHistory()).items) {
			expect(record).not.toHaveProperty("patientDisplayName");
			expect(record).not.toHaveProperty("orderUserDisplayName");
		}
	}
});

test("payment history omits names when a repository rejects an invalid domain read model", async () => {
	const service = await participantHistoryService({
		patients: {
			async listByOwner() {
				throw new PatientReadModelValidationError("patient-owner-mismatch");
			},
		},
		userProfiles: {
			async findByUserId() {
				throw new UserProfileReadModelValidationError("profile-user-mismatch");
			},
		},
	});
	for (const record of (await service.listPaymentHistory()).items) {
		expect(record).not.toHaveProperty("patientDisplayName");
		expect(record).not.toHaveProperty("orderUserDisplayName");
	}
});

for (const lookup of ["patients", "userProfiles"] as const) {
	test(`payment history propagates ${lookup} repository failures`, async () => {
		const failure = new Error("participant repository unavailable");
		const service = await participantHistoryService({
			...(lookup === "patients"
				? {
						patients: {
							async listByOwner() {
								throw failure;
							},
						},
					}
				: {
						userProfiles: {
							async findByUserId() {
								throw failure;
							},
						},
					}),
		});
		await expect(service.listPaymentHistory()).rejects.toBe(failure);
	});
}
