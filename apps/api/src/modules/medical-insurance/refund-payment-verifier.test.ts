import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type { MedicalInsuranceOrder } from "@hospital/domain";
import { createInMemoryMedicalInsuranceCredentialRepository } from "@hospital/persistence";
import { MedicalInsuranceRefundPaymentVerifier } from "./refund-payment-verifier";

type Dependencies = ConstructorParameters<
	typeof MedicalInsuranceRefundPaymentVerifier
>[0];
type Mixed = Awaited<ReturnType<Dependencies["wechat"]["queryMixedOrder"]>>;
type Cash = Awaited<
	ReturnType<Dependencies["wechat"]["queryPaidOrderForRefund"]>
>;
type Medical = Awaited<ReturnType<Dependencies["medical"]["querySettlement"]>>;

function order(
	patch: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "refund-verification-order",
		ownerUserId: "fixture-user",
		patientId: "fixture-patient",
		authorizationId: "fixture-authorization",
		businessType: "outpatient",
		orderType: "DiagPay",
		idempotencyKey: "original-fixture-payment",
		medOrgOrd: "fixture-hospital-order",
		chrgBchno: "fixture-fee-batch",
		payOrdId: "fixture-medical-provider-order",
		payTokenHash: null,
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
		lastError: "his-writeback-failed",
		wechatMixTradeNo: "fixture-wechat-mixed",
		wechatOutTradeNo: "fixture-wechat-cash",
		wechatPaymentState: "cash_paid",
		version: 12,
		createdAt: "2026-10-14T00:00:00.000Z",
		updatedAt: "2026-10-15T00:00:00.000Z",
		...patch,
	};
}

async function fixture(original = order(), insuredAreaCode = "") {
	const amounts = original.amounts;
	if (!amounts) throw new Error("fixture needs original amounts");
	const credentials = createInMemoryMedicalInsuranceCredentialRepository();
	await credentials.put({
		credentialId: "fixture-expired-query",
		ownerUserId: original.ownerUserId,
		medicalOrderId: original.medicalOrderId,
		payOrdId: original.payOrdId ?? "fixture-provider-order",
		purpose: "query",
		payToken: "fixture-original-query-token",
		providerQueryIdentity: {
			orgCodg: "fixture-institution",
			idNo: "fixture-identity-document",
			userName: "测试退款用户",
			idType: "01",
		},
		createdAt: "2026-10-14T00:00:00.000Z",
		expiresAt: "2026-10-14T01:00:00.000Z",
	});
	const state: {
		current: MedicalInsuranceOrder | undefined;
		now: Date;
		mixed: Mixed;
		cash: Cash;
		medical: Medical;
		cashError?: Error;
		mixedError?: Error;
		afterMixed?: () => void;
		afterCash?: () => void;
		calls: { mixed: number; cash: number; medical: number; credential: number };
		medicalInput?: Record<string, unknown>;
		mixedExpectedCashFen?: number;
	} = {
		current: structuredClone(original),
		now: new Date("2026-10-15T01:00:00.000Z"),
		calls: { mixed: 0, cash: 0, medical: 0, credential: 0 },
		mixed: {
			mixState: "paid",
			cashState: "paid",
			insuranceState: "paid",
			medInsPayStatus: "MED_INS_PAY_SUCCESS",
			totalFen: amounts.totalFen,
			cashFen: amounts.cashFen,
			fundFen: amounts.fundFen,
			personalAccountFen: amounts.personalAccountFen,
			medicalCashFen: amounts.cashFen,
			otherPaymentFen: amounts.otherPaymentFen ?? 0,
			cashReduceDetails: [],
			providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
			trace: {
				provider: "wechat-pay",
				operation: "medical-mix-query",
				requestId: "fixture-mix-query",
			},
		},
		cash: {
			state: "cash_paid",
			providerState: "SUCCESS",
			totalFen: amounts.cashFen,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "fixture-cash-query",
			},
		},
		medical: {
			settlement: {
				payOrdId: original.payOrdId ?? "fixture-provider-order",
				ordStas: "6",
				setlType: "ALL",
				amounts: structuredClone(amounts),
			},
			statusClass: "settlement_candidate",
			trace: {
				provider: "legacy-fsi",
				operation: "6301",
				requestId: "fixture-medical-query",
			},
		},
	};
	const verifier = new MedicalInsuranceRefundPaymentVerifier({
		orders: {
			async findByMedicalOrderId(id) {
				expect(id).toBe(original.medicalOrderId);
				return state.current;
			},
			async getSettlementContext(owner, id) {
				expect([owner, id]).toEqual([
					original.ownerUserId,
					original.medicalOrderId,
				]);
				return {
					businessId: "fixture-business",
					hospitalId: "fixture-hospital",
					patientId: original.patientId,
					networkRegister: {},
					outNetworkSettleMain: {},
					nationalUpDetailList: [],
					upDetailList: [],
					tradeOrderIds: [],
					insuredAreaCode,
				};
			},
		},
		credentials: {
			...credentials,
			async getForRefund(input) {
				state.calls.credential += 1;
				return credentials.getForRefund?.(input);
			},
		},
		wechat: {
			async queryMixedOrder(input) {
				state.calls.mixed += 1;
				state.mixedExpectedCashFen = input.expectedCashFen;
				expect(input).toMatchObject({
					orderId: original.medicalOrderId,
					mixTradeNo: original.wechatMixTradeNo,
					expectedOutTradeNo: original.wechatOutTradeNo,
					expectedPayOrdId: original.payOrdId,
					expectedTotalFen: amounts.totalFen,
				});
				if (state.mixedError) throw state.mixedError;
				state.afterMixed?.();
				return state.mixed;
			},
			async queryPaidOrderForRefund(input) {
				state.calls.cash += 1;
				expect(input.orderId).toBe(original.wechatOutTradeNo ?? "");
				if (state.cashError) throw state.cashError;
				state.afterCash?.();
				return state.cash;
			},
		},
		medical: {
			async querySettlement(input) {
				state.calls.medical += 1;
				state.medicalInput = input;
				return state.medical;
			},
		},
		now: () => state.now,
	});
	return { original, verifier, state, credentials };
}

test("退款核验允许 HIS 失败的 manual_review 已付订单，且不暴露原凭据", async () => {
	const { original, verifier, state } = await fixture();
	const proof = await verifier.verify(original);
	expect(proof).toMatchObject({
		orderId: original.medicalOrderId,
		version: 12,
		actualCashFen: 300,
		paidCash: true,
		paidMedical: true,
		queriedAt: "2026-10-15T01:00:00.000Z",
	});
	expect(state.calls).toEqual({ mixed: 1, cash: 1, medical: 1, credential: 1 });
	expect(JSON.stringify(proof)).not.toContain("fixture-original-query-token");
	expect(JSON.stringify(proof)).not.toContain("fixture-identity-document");
});

test("HI 已付而微信现金待付时，只核医保范围仍可退医保", async () => {
	const { original, verifier, state } = await fixture(
		order({
			status: "cash_pending",
			wechatPaymentState: "prepay_ready",
			ordStas: "4",
		}),
	);
	state.mixed.cashState = "pending";
	state.mixed.insuranceState = "pending";
	state.mixed.mixState = "pending";
	state.medical.settlement.ordStas = "4";
	expect(await verifier.verify(original, "HI")).toMatchObject({
		paidMedical: true,
		paidCash: false,
	});
	expect(state.calls.cash).toBe(0);
});

test("现金已付而医保未确认时 CASH 独立核验，不需要医保凭据", async () => {
	const { original, verifier, state, credentials } = await fixture(
		order({ status: "awaiting_confirmation" }),
	);
	state.mixed.insuranceState = "pending";
	await credentials.revoke({
		credentialId: "fixture-expired-query",
		ownerUserId: original.ownerUserId,
		medicalOrderId: original.medicalOrderId,
		now: state.now.toISOString(),
	});
	expect(await verifier.verify(original, "CASH")).toMatchObject({
		paidCash: true,
		paidMedical: false,
	});
	expect(state.calls.medical).toBe(0);
	expect(state.calls.credential).toBe(0);
});

test("ALL 不能把缺失医保核验当作未付款，但 CASH 可单独操作", async () => {
	const { original, verifier, state, credentials } = await fixture();
	state.mixed.insuranceState = "pending";
	await credentials.revoke({
		credentialId: "fixture-expired-query",
		ownerUserId: original.ownerUserId,
		medicalOrderId: original.medicalOrderId,
		now: state.now.toISOString(),
	});
	await expect(verifier.verify(original, "ALL")).rejects.toThrow(
		"原医保查单凭证不可用",
	);
	expect(await verifier.verify(original, "CASH")).toMatchObject({
		paidCash: true,
		paidMedical: false,
	});
});

test("医保已退导致混合查询失败标记，不妨碍独立核验原微信实付", async () => {
	const { original, verifier, state } = await fixture();
	state.mixed.insuranceState = "failed";
	state.mixed.medInsPayStatus = "MED_INS_PAY_REFUND";
	state.mixed.mixState = "failed";
	state.cash.providerState = "REFUND";
	expect(await verifier.verify(original, "CASH")).toMatchObject({
		paidCash: true,
		paidMedical: false,
		actualCashFen: 300,
	});
	expect(state.calls.credential).toBe(0);
});

test("独立现金查询仍未支付或医保明确失败时，不制造已付腿", async () => {
	const cash = await fixture();
	cash.state.cash.state = "cash_pending";
	expect((await cash.verifier.verify(cash.original, "CASH")).paidCash).toBe(
		false,
	);
	const medical = await fixture();
	medical.state.mixed.insuranceState = "failed";
	medical.state.mixed.medInsPayStatus = "MED_INS_PAY_FAIL";
	expect(
		(await medical.verifier.verify(medical.original, "HI")).paidMedical,
	).toBe(false);
	expect(medical.state.calls.medical).toBe(0);
	expect(medical.state.calls.credential).toBe(0);
});

test("高平挂号医院现金减免是优惠，实际微信为零且不查现金原单", async () => {
	const { original, verifier, state } = await fixture(
		order({
			orderType: "RegPay",
			amounts: {
				totalFen: 1000,
				cashFen: 200,
				personalAccountFen: 0,
				fundFen: 800,
			},
		}),
		"140581",
	);
	state.mixed.cashFen = 0;
	state.mixed.cashReduceDetails = [
		{ cashReduceFen: 200, cashReduceType: "HOSPITAL_REDUCE" },
	];
	expect(await verifier.verify(original)).toMatchObject({
		paidMedical: true,
		paidCash: false,
		actualCashFen: 0,
	});
	expect(state.calls.cash).toBe(0);
	expect(state.mixedExpectedCashFen).toBe(0);
});

test("明确 DiagPay 可以缺省参保区域；RegPay 空白区域禁止猜测现金减免", async () => {
	const diagnostic = await fixture(order(), "");
	expect(
		(await diagnostic.verifier.verify(diagnostic.original)).actualCashFen,
	).toBe(300);
	for (const area of ["", "   "]) {
		const registration = await fixture(order({ orderType: "RegPay" }), area);
		await expect(
			registration.verifier.verify(registration.original),
		).rejects.toThrow("地区信息不完整");
		expect(registration.state.calls.mixed).toBe(0);
	}
});

for (const field of [
	"totalFen",
	"cashFen",
	"fundFen",
	"personalAccountFen",
	"medicalCashFen",
	"otherPaymentFen",
] as const) {
	test(`混合查单 ${field} 金额变化拒绝，不继续其它提供商查询`, async () => {
		const { original, verifier, state } = await fixture();
		state.mixed[field] = (state.mixed[field] ?? 0) + 1;
		await expect(verifier.verify(original)).rejects.toThrow("实时支付金额");
		expect(state.calls.cash).toBe(0);
		expect(state.calls.medical).toBe(0);
	});
}

test("减免分项类型或金额不一致拒绝，不将名义现金当作实付", async () => {
	const { original, verifier, state } = await fixture();
	state.mixed.cashReduceDetails = [
		{ cashReduceFen: 1, cashReduceType: "HOSPITAL_REDUCE" },
	];
	await expect(verifier.verify(original)).rejects.toThrow("医院减免不一致");
});

test("微信独立现金金额不一致或身份校验异常不能解释成未付款", async () => {
	const wrongAmount = await fixture();
	wrongAmount.state.cash.totalFen = 301;
	await expect(
		wrongAmount.verifier.verify(wrongAmount.original, "CASH"),
	).rejects.toThrow("微信原支付金额不一致");
	const wrongIdentity = await fixture();
	wrongIdentity.state.cashError = new ProviderRequestError({
		provider: "wechat-pay",
		operation: "order-query",
		message: "fixture identity mismatch",
		retryable: false,
		responseInvalid: true,
		requestOutcome: "unknown",
	});
	await expect(
		wrongIdentity.verifier.verify(wrongIdentity.original, "CASH"),
	).rejects.toBe(wrongIdentity.state.cashError);
});

test("ALL 遇明确微信原单不存在仍核验并保留已付医保；未知错误必须中止", async () => {
	const known = await fixture();
	known.state.cashError = new ProviderRequestError({
		provider: "wechat-pay",
		operation: "order-query",
		message: "fixture payment absent",
		retryable: false,
		statusCode: 404,
		providerErrorCode: "ORDER_NOT_EXIST",
		requestOutcome: "rejected",
	});
	expect(await known.verifier.verify(known.original)).toMatchObject({
		paidCash: false,
		paidMedical: true,
	});
	const unknown = await fixture();
	unknown.state.cashError = new ProviderRequestError({
		provider: "wechat-pay",
		operation: "order-query",
		message: "fixture timeout",
		retryable: true,
		requestOutcome: "unknown",
	});
	await expect(unknown.verifier.verify(unknown.original)).rejects.toBe(
		unknown.state.cashError,
	);
	expect(unknown.state.calls.medical).toBe(0);
});

test("6301 自费完成不作为医保已付；医保已付状态必须原单和金额一致", async () => {
	const cashOnly = await fixture();
	cashOnly.state.medical.settlement.ordStas = "3";
	expect(await cashOnly.verifier.verify(cashOnly.original)).toMatchObject({
		paidMedical: false,
		paidCash: true,
	});
	const wrongOrder = await fixture();
	wrongOrder.state.medical.settlement.payOrdId = "different-provider-order";
	await expect(
		wrongOrder.verifier.verify(wrongOrder.original, "HI"),
	).rejects.toThrow("医保查单引用");
	const wrongAmount = await fixture();
	if (!wrongAmount.state.medical.settlement.amounts)
		throw new Error("fixture missing amounts");
	wrongAmount.state.medical.settlement.amounts.fundFen += 1;
	await expect(
		wrongAmount.verifier.verify(wrongAmount.original, "HI"),
	).rejects.toThrow("医保实时结算金额");
});

test("6301 可选扩展金额零值可规范化，非零差异必须拒绝", async () => {
	const { original, verifier, state } = await fixture();
	if (!state.medical.settlement.amounts)
		throw new Error("fixture missing amounts");
	state.medical.settlement.amounts.personalAccountMutualAidFen = 0;
	state.medical.settlement.amounts.personalAccountSelfFen = 0;
	expect((await verifier.verify(original, "HI")).paidMedical).toBe(true);
	state.medical.settlement.amounts.personalAccountMutualAidFen = 1;
	await expect(verifier.verify(original, "HI")).rejects.toThrow(
		"医保实时结算金额",
	);
});

test("退款查证能读取过期前端凭据，但拒绝已撤销和错误原单绑定", async () => {
	const { original, verifier, state, credentials } = await fixture();
	expect(
		await credentials.getActiveForOrder({
			ownerUserId: original.ownerUserId,
			medicalOrderId: original.medicalOrderId,
			purpose: "query",
			now: state.now.toISOString(),
		}),
	).toBeUndefined();
	expect((await verifier.verify(original, "HI")).paidMedical).toBe(true);
	expect(state.medicalInput).toMatchObject({
		payOrdId: original.payOrdId,
		payToken: "fixture-original-query-token",
		orgCodg: "fixture-institution",
	});
	await credentials.revoke({
		credentialId: "fixture-expired-query",
		ownerUserId: original.ownerUserId,
		medicalOrderId: original.medicalOrderId,
		now: state.now.toISOString(),
	});
	await expect(verifier.verify(original, "HI")).rejects.toThrow(
		"原医保查单凭证不可用",
	);
	const wrongBinding = await fixture(
		order({ payOrdId: "fixture-new-provider-order" }),
	);
	const originalRead = wrongBinding.credentials.getForRefund;
	wrongBinding.credentials.getForRefund = async (input) => {
		const bound = await originalRead?.(input);
		return bound
			? { ...bound, payOrdId: "unmatched-provider-order" }
			: undefined;
	};
	await expect(
		wrongBinding.verifier.verify(wrongBinding.original, "HI"),
	).rejects.toThrow("原医保查单凭证不可用");
});

test("医保原凭据字段必须有效，额外属性不能覆盖原单与支付 token", async () => {
	const valid = await fixture();
	const read = valid.credentials.getForRefund;
	valid.credentials.getForRefund = async (input) => {
		const credential = await read?.(input);
		return credential
			? {
					...credential,
					providerQueryIdentity: {
						...credential.providerQueryIdentity,
						payOrdId: "injected-order",
						payToken: "injected-token",
					},
				}
			: undefined;
	};
	expect((await valid.verifier.verify(valid.original, "HI")).paidMedical).toBe(
		true,
	);
	expect(valid.state.medicalInput?.payOrdId).toBe(valid.original.payOrdId);
	expect(valid.state.medicalInput?.payToken).toBe(
		"fixture-original-query-token",
	);
	const invalid = await fixture();
	const originalRead = invalid.credentials.getForRefund;
	invalid.credentials.getForRefund = async (input) => {
		const credential = await originalRead?.(input);
		return credential
			? {
					...credential,
					providerQueryIdentity: {
						...credential.providerQueryIdentity,
						idNo: "",
					},
				}
			: undefined;
	};
	await expect(invalid.verifier.verify(invalid.original, "HI")).rejects.toThrow(
		"原医保查单凭证不完整",
	);
	expect(invalid.state.calls.medical).toBe(0);
});

for (const changed of [
	"version",
	"owner",
	"payment-reference",
	"amounts",
	"order-type",
] as const) {
	test(`查单后来源订单 ${changed} 变化会拒绝生成退款证据`, async () => {
		const { original, verifier, state } = await fixture();
		state.afterMixed = () => {
			const current = structuredClone(original);
			if (changed === "version") current.version += 1;
			if (changed === "owner") current.ownerUserId = "different-owner";
			if (changed === "payment-reference")
				current.wechatOutTradeNo = "different-cash-order";
			if (changed === "amounts" && current.amounts)
				current.amounts.cashFen += 1;
			if (changed === "order-type") current.orderType = "RegPay";
			state.current = current;
		};
		await expect(verifier.verify(original, "CASH")).rejects.toThrow(
			"原订单已变化",
		);
	});
}

test("支付核验不能把慢查单时间重新标记为新鲜证据", async () => {
	const { original, verifier, state } = await fixture();
	state.afterCash = () => {
		state.now = new Date(state.now.getTime() + 60_001);
	};
	await expect(verifier.verify(original, "CASH")).rejects.toThrow("核验已过期");
});
