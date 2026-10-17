import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceRefund,
	PaymentOrder,
	WechatRefund,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryRefundReservationContext,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import {
	type MedicalInsuranceRefundPaymentVerification,
	MedicalInsuranceRefundService,
} from "../medical-insurance/refund-service";
import { RegistrationPaymentExitRefundSyncPendingError } from "../payments/registration-payment-exit-service";
import {
	AdminPaymentRefundService,
	type AdminPaymentRefundType,
} from "./payment-refund-service";
import { AdminWechatRefundService } from "./wechat-refund-service";

const now = new Date("2026-10-15T08:00:00.000Z");
const context = {
	traceId: "admin-refund-test",
	idempotencyKey: "admin-request-key",
};
const sourceOrder: MedicalInsuranceOrder & {
	amounts: NonNullable<MedicalInsuranceOrder["amounts"]>;
	payOrdId: string;
	authorizationId: string;
	wechatOutTradeNo: string;
} = {
	medicalOrderId: "medical-options-001",
	ownerUserId: "owner-options-001",
	patientId: "patient-options-001",
	orderType: "DiagPay",
	businessType: "outpatient",
	authorizationId: "authorization-options-001",
	feeUploadId: "fee-options-001",
	idempotencyKey: "order-options-001",
	medOrgOrd: "med-org-options-001",
	chrgBchno: "batch-options-001",
	payOrdId: "pay-options-001",
	payTokenHash: "a".repeat(64),
	status: "manual_review",
	ordStas: "6",
	amounts: {
		totalFen: 1000,
		cashFen: 300,
		personalAccountFen: 200,
		fundFen: 500,
	},
	setlType: "ALL",
	revsTokenHash: null,
	revsTokenExpiresAt: null,
	lastError: null,
	wechatOutTradeNo: "wx-options-001",
	wechatMixTradeNo: "mix-options-001",
	wechatPaymentState: "cash_paid",
	version: 12,
	createdAt: now.toISOString(),
	updatedAt: now.toISOString(),
};

async function fixture(
	options: {
		actualCashFen?: number;
		paidMedical?: boolean;
		paidCash?: boolean;
		medicalStatus?: "SUCC" | "FAIL" | "EXP";
		prior?: readonly MedicalInsuranceRefund[];
		priorCash?: readonly WechatRefund[];
		notifyFails?: boolean;
		verification?: Partial<MedicalInsuranceRefundPaymentVerification>;
		coreVerify?: boolean;
	} = {},
) {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert({
		...sourceOrder,
		...(options.actualCashFen === 0
			? { orderType: "RegPay", businessType: "registration" }
			: {}),
		amounts: { ...sourceOrder.amounts },
	});
	if (options.actualCashFen === 0)
		await orders.saveSettlementContext(
			sourceOrder.ownerUserId,
			sourceOrder.medicalOrderId,
			{
				businessId: "discount-appointment",
				hospitalId: "hospital-test",
				patientId: sourceOrder.patientId,
				networkRegister: {},
				outNetworkSettleMain: {},
				nationalUpDetailList: [],
				upDetailList: [],
				tradeOrderIds: [],
				insuredAreaCode: "140581",
			},
		);
	const shared = createInMemoryRefundReservationContext();
	const medicalRefunds = createInMemoryMedicalInsuranceRefundRepository(
		options.prior,
		shared,
	);
	const wechatRefunds = createInMemoryWechatRefundRepository(
		options.priorCash,
		shared,
	);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: sourceOrder.authorizationId,
		ownerUserId: sourceOrder.ownerUserId,
		medicalOrderId: sourceOrder.medicalOrderId,
		providerSubject: "subject-options",
		payAuthNo: "authorization-test-only",
		patient: { idNo: "test-id", userName: "测试就诊人", idType: "01" },
		psnNo: "test-psn",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "test-insu",
		expiresAt: "2026-10-15T07:59:00.000Z",
		createdAt: now.toISOString(),
	});
	const calls: {
		medical: Record<string, unknown>[];
		cash: Record<string, unknown>[];
		scopes: (AdminPaymentRefundType | undefined)[];
		notify: number;
	} = { medical: [], cash: [], scopes: [], notify: 0 };
	const proof = (
		order: Readonly<MedicalInsuranceOrder>,
	): MedicalInsuranceRefundPaymentVerification => {
		if (!order.payOrdId || !order.amounts)
			throw new Error("Test order requires settled identity and amounts");
		return {
			orderId: order.medicalOrderId,
			version: order.version,
			payOrdId: order.payOrdId,
			mixTradeNo: order.wechatMixTradeNo ?? null,
			outTradeNo: order.wechatOutTradeNo ?? null,
			amounts: { ...order.amounts },
			actualCashFen: options.actualCashFen ?? 300,
			paidMedical: options.paidMedical ?? true,
			paidCash: options.paidCash ?? true,
			queriedAt: now.toISOString(),
			...options.verification,
		};
	};
	const verify = async (
		order: Readonly<MedicalInsuranceOrder>,
		scope?: AdminPaymentRefundType,
	) => {
		calls.scopes.push(scope);
		return proof(order);
	};
	const wechatService = new AdminWechatRefundService({
		refunds: wechatRefunds,
		paymentOrders: {} as never,
		medicalInsuranceOrders: orders,
		medicalInsuranceRefunds: medicalRefunds,
		gateway: {
			requestRefund: async (input) => {
				calls.cash.push(input);
				return {
					...input,
					status: "SUCCESS",
					providerRefundId: "wx-refund-test",
					trace: {
						provider: "wechat-pay",
						operation: "refund",
						requestId: "wx-request-test",
					},
				};
			},
			queryRefund: async () => {
				throw new Error("terminal refund should not be queried");
			},
		},
		now: () => now,
	});
	const medicalService = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: medicalRefunds,
		wechatRefund: wechatService,
		...(options.coreVerify === false ? {} : { verifyPaymentForRefund: verify }),
		medicalInsuranceRefund: {
			refund: async (input) => {
				calls.medical.push(input);
				return {
					refStatus: options.medicalStatus ?? "SUCC",
					trace: {
						provider: "legacy-fsi",
						operation: "6203",
						requestId: "medical-request-test",
					},
				};
			},
		},
		now: () => now,
	});
	let notificationFails = options.notifyFails ?? false;
	const service = new AdminPaymentRefundService({
		orders,
		paymentOrders: {} as never,
		medicalRefunds,
		wechatRefunds,
		medicalService,
		wechatService,
		verifyPaymentForRefund: verify,
		notifyMedicalRefund: async () => {
			calls.notify += 1;
			if (notificationFails)
				throw new Error("notification temporarily unavailable");
		},
		now: () => now,
	});
	const request = (refundType: AdminPaymentRefundType) =>
		service.request({
			source: "medical_insurance",
			orderId: sourceOrder.medicalOrderId,
			refundType,
			context,
		});
	return {
		service,
		request,
		calls,
		medicalRefunds,
		wechatRefunds,
		medicalService,
		proof,
		orders,
		enableNotification: () => {
			notificationFails = false;
		},
	};
}

test("manual_review 的 ALL 使用 HI 6203 与实际微信现金，重复和跨模式沿用 HIS 单腿身份", async () => {
	const f = await fixture();
	expect((await f.request("ALL")).status).toBe("succeeded");
	expect((await f.request("HI")).status).toBe("succeeded");
	expect((await f.request("CASH")).status).toBe("succeeded");
	expect((await f.request("ALL")).status).toBe("succeeded");
	expect(f.calls.medical).toHaveLength(1);
	expect(f.calls.cash).toHaveLength(1);
	expect(f.calls.medical[0]).toMatchObject({
		refdType: "HI",
		totlRefdAmt: "7.00",
		cashRefdAmt: "0.00",
	});
	expect(f.calls.cash[0]).toMatchObject({ refundFen: 300, totalFen: 300 });
	expect(
		(await f.medicalRefunds.listByMedicalOrderId(sourceOrder.medicalOrderId))[0]
			?.idempotencyKey,
	).toBe(`his-medical-leg:${sourceOrder.medicalOrderId}`);
});

test("HI 与 CASH 任意顺序和同时请求均只各发一次，单腿验证不要求另一腿 paid", async () => {
	for (const first of ["HI", "CASH"] as const) {
		const f = await fixture();
		await f.request(first);
		await f.request(first === "HI" ? "CASH" : "HI");
		expect(f.calls.medical).toHaveLength(1);
		expect(f.calls.cash).toHaveLength(1);
	}
	const f = await fixture();
	await Promise.all([f.request("ALL"), f.request("HI"), f.request("CASH")]);
	expect(f.calls.medical).toHaveLength(1);
	expect(f.calls.cash).toHaveLength(1);
	const medicalOnly = await fixture({ paidCash: false });
	expect((await medicalOnly.request("HI")).status).toBe("succeeded");
	expect(medicalOnly.calls.cash).toHaveLength(0);
	const cashOnly = await fixture({ paidMedical: false });
	expect((await cashOnly.request("CASH")).status).toBe("succeeded");
	expect(cashOnly.calls.medical).toHaveLength(0);
	expect(cashOnly.calls.scopes).toEqual(["CASH"]);
});

test("优惠只退实际现金，现金全减免 ALL 只退医保，CASH 无实付拒绝", async () => {
	const standard = await fixture();
	expect((await standard.request("ALL")).amounts).toMatchObject({
		totalFen: 1000,
		cashFen: 300,
	});
	expect(standard.calls.cash[0]).toMatchObject({
		refundFen: 300,
		totalFen: 300,
	});
	const waived = await fixture({ actualCashFen: 0, paidCash: false });
	expect((await waived.request("ALL")).status).toBe("succeeded");
	expect(waived.calls.cash).toHaveLength(0);
	await expect(waived.request("CASH")).rejects.toThrow("实际微信现金");
});

test("医保 EXP 阻止 ALL 现金，CASH 明确单项仍可处理且不会再次 6203", async () => {
	const f = await fixture({ medicalStatus: "EXP" });
	expect((await f.request("ALL")).status).toBe("manual_review");
	expect(f.calls.cash).toHaveLength(0);
	expect((await f.request("CASH")).status).toBe("succeeded");
	expect(f.calls.cash).toHaveLength(1);
	expect(f.calls.medical).toHaveLength(1);
});

test("医保成功后通知失败保留成功腿，query 只补通知并继续使用原退款身份", async () => {
	const f = await fixture({ notifyFails: true });
	expect((await f.request("ALL")).status).toBe("manual_review");
	expect(f.calls.cash).toHaveLength(1);
	const [record] = await f.medicalRefunds.listByMedicalOrderId(
		sourceOrder.medicalOrderId,
	);
	expect(record).toMatchObject({
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		lastErrorCode: "medical-refund-notify-pending",
	});
	f.enableNotification();
	expect(
		(
			await f.service.query({
				source: "medical_insurance",
				orderId: sourceOrder.medicalOrderId,
				refundType: "HI",
				context,
			})
		).status,
	).toBe("succeeded");
	expect(f.calls.medical).toHaveLength(1);
	expect((await f.request("ALL")).status).toBe("succeeded");
	expect(f.calls.cash).toHaveLength(1);
	const separated = await fixture({ notifyFails: true });
	expect((await separated.request("HI")).status).toBe("manual_review");
	expect((await separated.request("CASH")).status).toBe("succeeded");
	expect(separated.calls.medical).toHaveLength(1);
	expect(separated.calls.cash).toHaveLength(1);
});

test("历史 ALL 处理中只核查原台账，不另起 HI/CASH", async () => {
	const record: MedicalInsuranceRefund = {
		refundId: "historical-refund",
		medicalOrderId: sourceOrder.medicalOrderId,
		ownerUserId: sourceOrder.ownerUserId,
		payOrdId: sourceOrder.payOrdId,
		refundNo: "historical-refund-no",
		idempotencyKey: "historical-key",
		refundType: "ALL",
		totalFen: 1000,
		cashFen: 300,
		personalAccountFen: 200,
		fundFen: 500,
		medicalStatus: "unknown",
		medicalRefStatus: "EXP",
		medicalProviderRequestId: null,
		wechatStatus: "requested",
		wechatMerchantRefundNo: "historical-refund-no",
		status: "manual_review",
		lastErrorCode: "EXP",
		version: 2,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	const f = await fixture({ prior: [record] });
	expect((await f.request("ALL")).status).toBe("manual_review");
	expect((await f.request("CASH")).status).toBe("manual_review");
	expect(f.calls.medical).toHaveLength(0);
	expect(f.calls.cash).toHaveLength(0);
});

test("普通挂号只委托退款并取消流程，医院同步 pending 返回 processing", async () => {
	const order: PaymentOrder = {
		orderId: "ordinary-registration",
		ownerUserId: "owner-test",
		patientId: "patient-test",
		idempotencyKey: "registration-self-pay:appointment-test",
		amounts: { totalFen: 100, cashFen: 100, insuranceFen: 0 },
		state: "completed",
		version: 3,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	let delegated = 0;
	let direct = 0;
	const service = new AdminPaymentRefundService({
		orders: {} as never,
		paymentOrders: { findById: async () => order },
		medicalRefunds: {} as never,
		wechatRefunds: { findBySourceAndSourceOrder: async () => [] },
		medicalService: {} as never,
		wechatService: {
			request: async () => {
				direct += 1;
				throw new Error("must not directly refund registration");
			},
		} as never,
		verifyPaymentForRefund: async () => {
			throw new Error("not medical");
		},
		verifyPaymentOrder: async () => {},
		refundRegistrationPayment: async () => {
			delegated += 1;
			throw new RegistrationPaymentExitRefundSyncPendingError();
		},
		now: () => now,
	});
	expect(
		await service.request({
			source: "payment_order",
			orderId: order.orderId,
			refundType: "ALL",
			context,
		}),
	).toMatchObject({
		status: "processing",
		registrationCancellationPending: true,
	});
	expect(delegated).toBe(1);
	expect(direct).toBe(0);
});

test("已完成部分退款时 ALL 只申请各分量余额，并保留所有既有成功事实", async () => {
	const prior: MedicalInsuranceRefund = {
		refundId: "prior-partial",
		medicalOrderId: sourceOrder.medicalOrderId,
		ownerUserId: sourceOrder.ownerUserId,
		payOrdId: sourceOrder.payOrdId,
		refundNo: "prior-partial-no",
		idempotencyKey: "patient-partial-key",
		refundType: "HI",
		totalFen: 250,
		cashFen: 0,
		personalAccountFen: 50,
		fundFen: 200,
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		medicalProviderRequestId: "prior-6203",
		wechatStatus: "not_required",
		wechatMerchantRefundNo: null,
		status: "succeeded",
		lastErrorCode: null,
		version: 3,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	const priorCash: WechatRefund = {
		refundRecordId: "prior-cash",
		merchantRefundNo: "prior-cash-no",
		idempotencyKey: "prior-cash-key",
		source: "medical_insurance",
		sourceOrderId: sourceOrder.medicalOrderId,
		outTradeNo: sourceOrder.wechatOutTradeNo,
		totalFen: 300,
		refundFen: 100,
		reason: null,
		status: "success",
		providerStatus: "SUCCESS",
		providerRefundId: "prior-wx",
		providerTransactionId: null,
		providerRequestId: "prior-wx-request",
		successTime: now.toISOString(),
		lastErrorCode: null,
		version: 3,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
	const f = await fixture({ prior: [prior], priorCash: [priorCash] });
	expect((await f.request("ALL")).status).toBe("succeeded");
	expect(f.calls.medical[0]).toMatchObject({
		totlRefdAmt: "4.50",
		psnAcctRefdAmt: "1.50",
		fundRefdAmt: "3.00",
	});
	expect(f.calls.cash[0]).toMatchObject({ refundFen: 200, totalFen: 300 });
	expect(
		await f.medicalRefunds.listByMedicalOrderId(sourceOrder.medicalOrderId),
	).toHaveLength(2);
});

test("支付查证须新鲜并匹配订单、版本、全部原始金额与交易身份，拒绝时无渠道调用", async () => {
	for (const verification of [
		{ orderId: "another-order" },
		{ version: 11 },
		{ payOrdId: "another-pay-order" },
		{ mixTradeNo: "another-mix" },
		{ outTradeNo: "another-out" },
		{ queriedAt: "2026-10-15T07:58:59.999Z" },
		{ queriedAt: "2026-10-15T08:00:00.001Z" },
		{ amounts: { ...sourceOrder.amounts, fundFen: 499 } },
		{ amounts: { ...sourceOrder.amounts, hospitalPartFen: 1 } },
		{ actualCashFen: 301 },
		{ actualCashFen: -1 },
	]) {
		const f = await fixture({ verification });
		await expect(f.request("HI")).rejects.toThrow("支付核验");
		expect(f.calls.medical).toHaveLength(0);
		expect(f.calls.cash).toHaveLength(0);
	}
	const unsupportedCash = await fixture({ actualCashFen: 120 });
	await expect(unsupportedCash.request("CASH")).rejects.toThrow("实付金额");
	expect(unsupportedCash.calls.cash).toHaveLength(0);
	const noMedical = await fixture({ paidMedical: false });
	await expect(noMedical.request("HI")).rejects.toThrow("医保可退金额");
	expect(noMedical.calls.medical).toHaveLength(0);
});

test("核心医保入口默认仍拒绝 manual_review；选择 HI 的新鲜查证只要求医保腿已支付", async () => {
	const legacy = await fixture({ coreVerify: false });
	await expect(
		legacy.medicalService.requestMedicalOnlyByOrder({
			orderId: sourceOrder.medicalOrderId,
			context,
		}),
	).rejects.toThrow("尚未完成支付");
	const verified = await fixture({ paidCash: false });
	expect(
		(
			await verified.medicalService.requestMedicalOnlyByOrder({
				orderId: sourceOrder.medicalOrderId,
				context,
			})
		).status,
	).toBe("succeeded");
	expect(verified.calls.scopes).toEqual(["HI"]);
	const repeated = await verified.medicalService.requestMedicalOnlyByOrder({
		orderId: sourceOrder.medicalOrderId,
		context,
	});
	expect(repeated.status).toBe("succeeded");
	expect(verified.calls.medical).toHaveLength(1);
	expect(verified.calls.scopes).toHaveLength(1);
});
