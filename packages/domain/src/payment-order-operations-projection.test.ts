import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "./medical-insurance-order";
import { buildMedicalInsuranceOrderOperationsProjection } from "./payment-order-operations-projection";

const order: MedicalInsuranceOrder = {
	medicalOrderId: "fixture-ledger-medical",
	ownerUserId: "fixture-owner",
	patientId: "fixture-patient",
	businessType: "registration",
	orderType: "RegPay",
	businessId: "fixture-appointment",
	idempotencyKey: "fixture-ledger",
	medOrgOrd: "fixture-main",
	chrgBchno: "fixture-batch",
	payOrdId: "fixture-insurance-payment",
	payTokenHash: null,
	status: "insurance_settled",
	ordStas: "4",
	amounts: {
		totalFen: 1000,
		cashFen: 200,
		personalAccountFen: 0,
		fundFen: 800,
	},
	setlType: "ALL",
	revsTokenHash: null,
	revsTokenExpiresAt: null,
	lastError: null,
	wechatPaymentState: "cash_paid",
	version: 9,
	createdAt: "2026-10-17T01:00:00.000Z",
	updatedAt: "2026-10-17T01:01:00.000Z",
};

function context(cash = 0, hospital = 200): MedicalInsuranceSettlementContext {
	return {
		businessId: "fixture-appointment",
		hospitalId: "fixture-hospital",
		patientId: "fixture-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		insuredAreaCode: "140581",
		postPaymentComponents: [
			{
				componentId: "fixture-ledger-medical:combined",
				kind: "combined",
				totalFen: 1000,
				amountFen: 1000,
				payModel: "H5",
				payTypeId: "2",
				recordCode: "fixture-record",
				state: "succeeded",
				attempts: 1,
				updatedAt: "2026-10-17T01:00:30.000Z",
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 800 },
					...(hospital
						? [
								{
									kind: "hospital_reduce" as const,
									payTypeId: "50" as const,
									amountFen: hospital,
								},
							]
						: []),
					...(cash
						? [
								{
									kind: "wechat_cash" as const,
									payTypeId: "5033" as const,
									amountFen: cash,
								},
							]
						: []),
				],
			},
		],
	};
}

function projected(
	input = order,
	evidence?: MedicalInsuranceSettlementContext,
) {
	const result = buildMedicalInsuranceOrderOperationsProjection(
		input,
		undefined,
		evidence,
	);
	if (!result) throw new Error("Missing projection");
	expect(result.legs.reduce((sum, leg) => sum + leg.amountFen, 0)).toBe(
		result.aggregate.totalFen,
	);
	return result;
}

test("saved successful hospital reduction is not WeChat cash even with legacy cash_paid", () => {
	const result = projected(order, context());
	expect(result.aggregate).toMatchObject({
		insuranceFen: 800,
		cashFen: 0,
		status: "paid",
	});
	expect(
		result.legs.find((leg) => leg.legType === "hospital_reduce"),
	).toMatchObject({ amountFen: 200, status: "confirmed" });
	expect(
		result.legs.find((leg) => leg.legType === "wechat_cash"),
	).toMatchObject({ amountFen: 0, status: "not_started" });
	expect(result.legs.every((leg) => leg.confirmedAt === undefined)).toBe(true);
});

test("old real cash is not rewritten by today's region discount rule", () => {
	const result = projected(order, context(200, 0));
	expect(result.aggregate.cashFen).toBe(200);
	expect(
		result.legs.find((leg) => leg.legType === "wechat_cash"),
	).toMatchObject({ amountFen: 200, status: "confirmed" });
});

test("preorder success alone never confirms a WeChat debit", () => {
	const result = projected(
		{ ...order, wechatPaymentState: "prepay_ready" },
		context(200, 0),
	);
	expect(result.aggregate.status).toBe("pending");
	expect(result.legs.find((leg) => leg.legType === "wechat_cash")?.status).toBe(
		"pending",
	);
});

test.each([
	"missing",
	"pending",
	"failed",
	"mismatch",
	"duplicate",
	"wrong_type",
	"fractional",
	"negative",
])("unproven historical allocation stays unknown: %s", (reason) => {
	let evidence: MedicalInsuranceSettlementContext | undefined = context();
	const first = evidence.postPaymentComponents?.[0];
	if (!first) throw new Error("Missing fixture component");
	if (reason === "missing") evidence = undefined;
	else if (reason === "pending" || reason === "failed")
		evidence.postPaymentComponents = [{ ...first, state: reason }];
	else if (reason === "duplicate")
		evidence.postPaymentComponents = [first, first];
	else
		evidence.postPaymentComponents = [
			{
				...first,
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 800 },
					{
						kind: "hospital_reduce",
						payTypeId: reason === "wrong_type" ? "5" : "50",
						amountFen:
							reason === "fractional"
								? 199.5
								: reason === "negative"
									? -200
									: 201,
					},
				],
			},
		];
	const result = projected(order, evidence);
	expect(result.aggregate).toMatchObject({
		insuranceFen: 800,
		cashFen: 0,
		status: "manual_review",
	});
	expect(
		result.legs.find((leg) => leg.legType === "unallocated"),
	).toMatchObject({ amountFen: 200, status: "manual_review" });
	expect(
		result.legs.find((leg) => leg.legType === "wechat_cash")?.status,
	).not.toBe("confirmed");
});

test("hospital liability inside otherPayment is separate from the ownPay cash concession", () => {
	const evidence = context();
	const first = evidence.postPaymentComponents?.[0];
	if (!first) throw new Error("Missing fixture component");
	evidence.postPaymentComponents = [
		{
			...first,
			payTypeParams: [
				{ kind: "fund", payTypeId: "2", amountFen: 700 },
				{ kind: "hospital_reduce", payTypeId: "50", amountFen: 300 },
			],
		},
	];
	const result = projected(
		{
			...order,
			amounts: {
				totalFen: 1000,
				fundFen: 700,
				personalAccountFen: 0,
				cashFen: 200,
				otherPaymentFen: 100,
				hospitalPartFen: 100,
			},
		},
		evidence,
	);
	expect(result.aggregate).toMatchObject({ insuranceFen: 700, cashFen: 0 });
	expect(
		result.legs.find((leg) => leg.legType === "hospital_part")?.amountFen,
	).toBe(100);
	expect(
		result.legs.find((leg) => leg.legType === "hospital_reduce")?.amountFen,
	).toBe(200);
});

test("invalid 6202 source amounts fail closed before a ledger can be produced", () => {
	expect(() =>
		projected(
			{
				...order,
				amounts: {
					cashFen: 200,
					fundFen: 800,
					personalAccountFen: 0,
					totalFen: 999,
				},
			},
			context(),
		),
	).toThrow();
});

const completionTime = "2026-10-17T01:00:59.000Z";
const succeededCompletion = {
	attemptedAt: completionTime,
	status: "succeeded" as const,
};

function mixedSplitContext(): MedicalInsuranceSettlementContext {
	const evidence = context(200, 0);
	const combined = evidence.postPaymentComponents?.[0];
	if (!combined) throw new Error("Missing combined fixture");
	return {
		...evidence,
		postPaymentCompletedAt: completionTime,
		postPaymentComponents: [
			{
				...combined,
				componentId: "fixture-medical",
				kind: "medical",
				amountFen: 800,
				payTypeParams: [{ kind: "fund", payTypeId: "2", amountFen: 800 }],
			},
			{
				componentId: "fixture-cash",
				kind: "wechat_cash",
				totalFen: 1000,
				amountFen: 200,
				payModel: "H5",
				payTypeId: "5033",
				recordCode: "fixture-cash-record",
				state: "succeeded",
				attempts: 1,
				updatedAt: completionTime,
			},
		],
	};
}

test.each(["failed", "unknown", undefined] as const)(
	"legacy split medical completion cannot hide self-pay completion %s",
	(status) => {
		const evidence = {
			...mixedSplitContext(),
			settlementCompletion: succeededCompletion,
			...(status
				? {
						selfPaySettlementCompletion: {
							attemptedAt: completionTime,
							status,
						},
					}
				: {}),
		};
		for (const sourceStatus of [
			"insurance_settled",
			"awaiting_confirmation",
		] as const)
			expect(
				projected({ ...order, status: sourceStatus }, evidence).aggregate
					.hisSyncStatus,
			).toBe("pending");
	},
);

test("legacy split requires both final completions", () => {
	const evidence = mixedSplitContext();
	evidence.selfPaySettlementCompletion = succeededCompletion;
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
	evidence.settlementCompletion = succeededCompletion;
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("succeeded");
});

test("sequenced mixed plan succeeds with its sole self-pay final completion", () => {
	const evidence = {
		...mixedSplitContext(),
		postPaymentPlanVersion: "sequenced-v1" as const,
		selfPaySettlementCompletion: succeededCompletion,
	};
	expect(evidence.settlementCompletion).toBeUndefined();
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("succeeded");
	expect(
		projected({ ...order, status: "awaiting_confirmation" }, evidence).aggregate
			.hisSyncStatus,
	).toBe("pending");
	expect(
		projected({ ...order, status: "cash_pending" }, evidence).aggregate
			.hisSyncStatus,
	).toBe("pending");
});

test("any saved unknown completion blocks sequenced success even when the other final leg succeeded", () => {
	const evidence = {
		...mixedSplitContext(),
		postPaymentPlanVersion: "sequenced-v1" as const,
		settlementCompletion: {
			attemptedAt: completionTime,
			status: "unknown" as const,
		},
		selfPaySettlementCompletion: succeededCompletion,
	};
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
});

test("sequenced reuse of an old medical final completion also requires .29 and .15", () => {
	const evidence: MedicalInsuranceSettlementContext = {
		...mixedSplitContext(),
		postPaymentPlanVersion: "sequenced-v1",
		settlementCompletion: succeededCompletion,
	};
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
	evidence.selfPayThirdPartyWriteback = succeededCompletion;
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
	evidence.selfPayPaymentNotify = succeededCompletion;
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("succeeded");
	evidence.selfPaySettlementCompletion = {
		attemptedAt: completionTime,
		status: "failed",
	};
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
});

test("the successful insurance plus hospital-reduction plan still requires only its medical final completion", () => {
	const evidence: MedicalInsuranceSettlementContext = {
		...context(),
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentCompletedAt: completionTime,
		settlementCompletion: succeededCompletion,
	};
	expect(projected(order, evidence).aggregate).toMatchObject({
		insuranceFen: 800,
		cashFen: 0,
		status: "paid",
		hisSyncStatus: "succeeded",
	});
	delete evidence.settlementCompletion;
	evidence.selfPaySettlementCompletion = succeededCompletion;
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
});

test("combined mixed plan uses one medical completion but still requires the completed marker", () => {
	const evidence = {
		...context(200, 0),
		settlementCompletion: succeededCompletion,
	};
	expect(projected(order, evidence).aggregate.hisSyncStatus).toBe("pending");
	expect(
		projected(order, { ...evidence, postPaymentCompletedAt: completionTime })
			.aggregate.hisSyncStatus,
	).toBe("succeeded");
});
