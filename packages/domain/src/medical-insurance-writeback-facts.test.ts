import { expect, test } from "bun:test";
import type { MedicalInsuranceSettlementContext } from "./medical-insurance-order";
import {
	MedicalInsuranceWritebackConflictError,
	preserveMedicalInsuranceThirdPartyWriteback,
} from "./medical-insurance-writeback-facts";

function context(): MedicalInsuranceSettlementContext {
	return {
		businessId: "business-1",
		hospitalId: "hospital-1",
		patientId: "patient-1",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		plugin: {
			paymentOrderId: "payment-1",
			outTradeNo: "out-1",
			payingId: "123",
			tradingId: "456",
			recordCode: "a".repeat(32),
			payTypeId: "5033",
			payType: "CREDIT",
			workStationId: "",
			tradeCode: "trade-1",
			tradeTypeCode: "2",
			state: "cash_paid",
		},
		postPaymentComponents: [
			{
				componentId: "medical-1:wechat_cash",
				kind: "wechat_cash",
				totalFen: 100,
				amountFen: 100,
				payModel: "H5",
				payTypeId: "5033",
				recordCode: "b".repeat(32),
				state: "succeeded",
				attempts: 1,
				payingId: "789",
				tradingId: "1011",
				updatedAt: "2026-10-15T00:00:00.000Z",
			},
		],
	};
}

test("late plugin prepay snapshot preserves unknown claim and unrelated requested data", () => {
	const previous = context();
	if (!previous.plugin) throw Error("fixture");
	previous.plugin.thirdPartPayAttempt = {
		attemptedAt: "2026-10-15T00:00:00.000Z",
		status: "unknown",
	};
	const incoming = context();
	if (!incoming.plugin) throw Error("fixture");
	incoming.plugin.state = "prepay_ready";
	incoming.plugin.prepayId = "late-prepay";
	incoming.networkRegister = { unrelated: "requested" };
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming),
	).toMatchObject({
		plugin: {
			state: "cash_paid",
			prepayId: "late-prepay",
			thirdPartPayAttempt: { status: "unknown" },
		},
		networkRegister: { unrelated: "requested" },
	});
});

test("plugin success receipt and raw response cannot regress or change", () => {
	const previous = context();
	if (!previous.plugin) throw Error("fixture");
	Object.assign(previous.plugin, {
		thirdPartPayRecordId: "1952638941030000004",
		thirdPartPayRawResponse: "original",
		thirdPartPayAttempt: {
			attemptedAt: "2026-10-15T00:00:00.000Z",
			status: "succeeded",
		},
		state: "29_succeeded",
	});
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, context()).plugin,
	).toMatchObject({
		thirdPartPayRecordId: "1952638941030000004",
		thirdPartPayRawResponse: "original",
		thirdPartPayAttempt: { status: "succeeded" },
		state: "29_succeeded",
	});
	const conflict = context();
	if (!conflict.plugin) throw Error("fixture");
	conflict.plugin.thirdPartPayRecordId = "1952638941030000005";
	expect(() =>
		preserveMedicalInsuranceThirdPartyWriteback(previous, conflict),
	).toThrow(MedicalInsuranceWritebackConflictError);
});

for (const key of [
	"paymentOrderId",
	"outTradeNo",
	"payingId",
	"tradingId",
	"recordCode",
] as const) {
	test(`attempted plugin cannot replace ${key}`, () => {
		const previous = context(),
			incoming = context();
		if (!previous.plugin || !incoming.plugin) throw Error("fixture");
		previous.plugin.thirdPartPayAttempt = {
			attemptedAt: "2026-10-15T00:00:00.000Z",
			status: "unknown",
		};
		incoming.plugin[key] = "replacement";
		expect(() =>
			preserveMedicalInsuranceThirdPartyWriteback(previous, incoming),
		).toThrow(MedicalInsuranceWritebackConflictError);
	});
}

test("cash unknown and successful receipt survive old snapshots", () => {
	const previous = context(),
		incoming = context();
	previous.selfPayThirdPartyWriteback = {
		attemptedAt: "2026-10-15T00:00:00.000Z",
		status: "unknown",
	};
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming)
			.selfPayThirdPartyWriteback?.status,
	).toBe("unknown");
	previous.selfPayThirdPartyWriteback = {
		...previous.selfPayThirdPartyWriteback,
		status: "succeeded",
		thirdPartPayRecordId: "1952638941030000004",
		rawResponse: "original",
	};
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming)
			.selfPayThirdPartyWriteback,
	).toEqual(previous.selfPayThirdPartyWriteback);
	incoming.selfPayThirdPartyWriteback = {
		attemptedAt: "2026-10-15T00:00:01.000Z",
		status: "unknown",
	};
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming)
			.selfPayThirdPartyWriteback?.status,
	).toBe("succeeded");
});

test("cash unknown may upgrade to same-scope success, but scope replacement and ambiguity fail closed", () => {
	const previous = context(),
		incoming = context();
	previous.selfPayThirdPartyWriteback = {
		attemptedAt: "2026-10-15T00:00:00.000Z",
		status: "unknown",
	};
	incoming.selfPayThirdPartyWriteback = {
		attemptedAt: "2026-10-15T00:00:01.000Z",
		status: "succeeded",
	};
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming)
			.selfPayThirdPartyWriteback?.status,
	).toBe("unknown");
	incoming.selfPayThirdPartyWriteback = {
		attemptedAt: "2026-10-15T00:00:01.000Z",
		status: "succeeded",
		thirdPartPayRecordId: "1952638941030000004",
	};
	expect(
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming)
			.selfPayThirdPartyWriteback,
	).toMatchObject({
		attemptedAt: previous.selfPayThirdPartyWriteback.attemptedAt,
		status: "succeeded",
	});
	const component = incoming.postPaymentComponents?.[0];
	if (!component) throw Error("fixture");
	incoming.postPaymentComponents = [
		{ ...component, componentId: "replacement" },
	];
	expect(() =>
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming),
	).toThrow(MedicalInsuranceWritebackConflictError);
	incoming.postPaymentComponents = [
		component,
		{ ...component, componentId: "ambiguous" },
	];
	expect(() =>
		preserveMedicalInsuranceThirdPartyWriteback(previous, incoming),
	).toThrow(MedicalInsuranceWritebackConflictError);
});
