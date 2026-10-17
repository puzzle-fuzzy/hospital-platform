import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsurancePostPaymentComponent,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import { createInMemoryMedicalInsuranceOrderRepository } from "@hospital/persistence";
import { MedicalInsurancePaymentCore } from "./payment-core";
import {
	loadMedicalInsurancePaymentPresentation,
	medicalInsurancePaymentPresentation,
} from "./payment-presentation";
import { MedicalInsuranceRegistrationService } from "./registration-service";

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "presentation-order",
		ownerUserId: "presentation-owner",
		patientId: "presentation-patient",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "presentation-appointment",
		appointmentId: "presentation-appointment",
		authorizationId: null,
		feeUploadId: null,
		idempotencyKey: "presentation-key",
		medOrgOrd: "presentation-medorg",
		chrgBchno: "presentation-batch",
		payOrdId: null,
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "cash_pending",
		ordStas: "1",
		amounts: {
			totalFen: 1000,
			fundFen: 800,
			personalAccountFen: 0,
			cashFen: 200,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: "2026-10-17T00:00:00.000Z",
		updatedAt: "2026-10-17T00:00:00.000Z",
		...overrides,
	};
}

function settlement(
	overrides: Partial<MedicalInsuranceSettlementContext> = {},
): MedicalInsuranceSettlementContext {
	return {
		businessId: "presentation-business",
		hospitalId: "presentation-hospital",
		patientId: "presentation-provider-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		insuredAreaCode: "140581",
		...overrides,
	};
}

function component(
	kind: "hospital_reduce" | "wechat_cash",
	amountFen: number,
): MedicalInsurancePostPaymentComponent {
	return {
		componentId: `presentation-${kind}`,
		kind,
		amountFen,
		totalFen: 1000,
		payModel: "MINI_PROGRAM",
		payTypeId: kind === "hospital_reduce" ? "50" : "5033",
		recordCode: `presentation-${kind}`,
		state: "succeeded",
		attempts: 1,
		updatedAt: "2026-10-17T00:00:00.000Z",
	};
}

test("挂号展示医院现金减免，原6202现金与订单状态不改写", () => {
	const original = order();
	const before = structuredClone(original);
	expect(medicalInsurancePaymentPresentation(original, settlement())).toEqual({
		hospitalPartFen: 0,
		hospitalReduceFen: 200,
		wechatCashFen: 0,
	});
	expect(original).toEqual(before);
	expect(
		medicalInsurancePaymentPresentation(
			order({ businessType: "outpatient", orderType: "DiagPay" }),
			settlement(),
		),
	).toEqual({ hospitalPartFen: 0, hospitalReduceFen: 0, wechatCashFen: 200 });
	expect(
		medicalInsurancePaymentPresentation(
			original,
			settlement({ insuredAreaCode: "140500" }),
		),
	).toEqual({ hospitalPartFen: 0, hospitalReduceFen: 0, wechatCashFen: 200 });
});

test("缺地区、业务矛盾、非法金额时省略新展示字段", () => {
	for (const context of [
		undefined,
		settlement({ insuredAreaCode: "" }),
		settlement({ insuredAreaCode: "bad" }),
	]) {
		expect(medicalInsurancePaymentPresentation(order(), context)).toEqual({});
	}
	expect(
		medicalInsurancePaymentPresentation(
			order({ orderType: "DiagPay" }),
			settlement(),
		),
	).toEqual({});
	expect(
		medicalInsurancePaymentPresentation(
			order({
				amounts: {
					totalFen: 1000,
					fundFen: 800,
					personalAccountFen: 0,
					cashFen: -200,
				},
			}),
			settlement(),
		),
	).toEqual({});
	expect(
		medicalInsurancePaymentPresentation(
			order({
				amounts: {
					totalFen: 1000,
					fundFen: 1000,
					personalAccountFen: 0,
					cashFen: 0,
				},
			}),
			settlement(),
		),
	).toEqual({ hospitalPartFen: 0, hospitalReduceFen: 0, wechatCashFen: 0 });
});

test("已记账payType50中的医院负担不重复从ownPayAmt抵扣", () => {
	const original = order({
		status: "insurance_settled",
		amounts: {
			totalFen: 1000,
			fundFen: 700,
			personalAccountFen: 0,
			cashFen: 200,
			otherPaymentFen: 100,
			hospitalPartFen: 100,
		},
	});
	expect(
		medicalInsurancePaymentPresentation(
			original,
			settlement({
				postPaymentComponents: [component("hospital_reduce", 300)],
			}),
		),
	).toEqual({ hospitalPartFen: 100, hospitalReduceFen: 200, wechatCashFen: 0 });
	expect(
		medicalInsurancePaymentPresentation(
			original,
			settlement({
				postPaymentComponents: [component("hospital_reduce", 200)],
			}),
		),
	).toEqual({});
});

test("历史真实微信现金腿优先，不追溯套用优惠；未知历史保守省略", () => {
	const original = order({
		status: "insurance_settled",
		wechatOutTradeNo: "historical-cash",
	});
	expect(
		medicalInsurancePaymentPresentation(
			original,
			settlement({ postPaymentComponents: [component("wechat_cash", 200)] }),
		),
	).toEqual({ hospitalPartFen: 0, hospitalReduceFen: 0, wechatCashFen: 200 });
	expect(medicalInsurancePaymentPresentation(original, settlement())).toEqual(
		{},
	);
	expect(
		medicalInsurancePaymentPresentation(
			{ ...original, wechatMixTradeNo: "historical-mix" },
			settlement({ postPaymentComponents: [] }),
		),
	).toEqual({});
});

test("已完成医保合单中的医院优惠按实际payTypeParams展示", () => {
	const paid: MedicalInsurancePostPaymentComponent = {
		...component("hospital_reduce", 1000),
		kind: "medical",
		payTypeId: "2",
		payTypeParams: [
			{ kind: "fund", payTypeId: "2", amountFen: 800 },
			{ kind: "hospital_reduce", payTypeId: "50", amountFen: 200 },
		],
	};
	expect(
		medicalInsurancePaymentPresentation(
			order({ status: "insurance_settled" }),
			settlement({ postPaymentComponents: [paid] }),
		),
	).toEqual({ hospitalPartFen: 0, hospitalReduceFen: 200, wechatCashFen: 0 });
	expect(
		medicalInsurancePaymentPresentation(
			order({
				amounts: {
					totalFen: 1000,
					fundFen: 800,
					personalAccountFen: 0,
					cashFen: 0,
					hospitalPartFen: 200,
					otherPaymentFen: 200,
				},
			}),
			settlement(),
		),
	).toEqual({ hospitalPartFen: 200, hospitalReduceFen: 0, wechatCashFen: 0 });
});

test("终态查单只读本地上下文并返回展示拆分，不重新请求上游", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const original = order({
		status: "insurance_settled",
		wechatMixTradeNo: "presentation-mix",
	});
	await orders.insert(original);
	const repository = {
		...orders,
		getSettlementContext: async () =>
			settlement({
				postPaymentComponents: [component("hospital_reduce", 200)],
			}),
	};
	const core = new MedicalInsurancePaymentCore({
		orders: repository,
		medicalInsurance: {
			query: async () => {
				throw new Error("must not query provider");
			},
		} as never,
	});
	expect(
		await core.query({
			ownerUserId: original.ownerUserId,
			orderId: original.medicalOrderId,
			context: {
				traceId: "presentation-trace",
				idempotencyKey: "presentation-read",
			},
		}),
	).toMatchObject({
		status: "insurance_settled",
		amounts: {
			totalFen: 1000,
			insuranceFen: 800,
			cashFen: 200,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		},
	});
	expect(
		(await orders.findByMedicalOrderId(original.medicalOrderId))?.amounts
			?.cashFen,
	).toBe(200);
	expect(
		await loadMedicalInsurancePaymentPresentation(original, {
			...orders,
			getSettlementContext: async () => {
				throw new Error("context unavailable");
			},
		}),
	).toEqual({});
});

test("结算页业务恢复也返回三字段，展示读取不推进支付状态", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const original = order();
	await orders.insert(original);
	const service = new MedicalInsuranceRegistrationService({
		orders: { ...orders, getSettlementContext: async () => settlement() },
		authorizations: {} as never,
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {} as never,
	});
	expect(
		await service.recoverBusinessOrder({
			ownerUserId: original.ownerUserId,
			businessType: "registration",
			businessId: original.businessId ?? "",
			patientId: original.patientId,
			context: {
				traceId: "presentation-recovery",
				idempotencyKey: "presentation-read",
			},
		}),
	).toMatchObject({
		status: "cash_pending",
		amounts: {
			cashFen: 200,
			hospitalPartFen: 0,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		},
	});
	expect(
		(await orders.findByMedicalOrderId(original.medicalOrderId))?.status,
	).toBe("cash_pending");
});
