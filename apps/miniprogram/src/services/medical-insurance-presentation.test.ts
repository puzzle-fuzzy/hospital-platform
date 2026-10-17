import { afterEach, expect, test } from "bun:test";
import {
	medicalPaymentAmountView,
	needsMedicalBusinessAuthorization,
	readMedicalWechatPayment,
} from "./medical-insurance";

test("费用上传前的原主单授权过期可重新授权，已发送及冲突订单禁止重开", () => {
	const recovery = {
		orderId: "existing-original-his-order",
		status: "fee_upload_pending" as const,
		authorizationReady: false,
		authorizationPending: false,
		recoveryAllowed: true,
	};
	expect(needsMedicalBusinessAuthorization(recovery)).toBeTrue();
	expect(needsMedicalBusinessAuthorization(null)).toBeTrue();
	expect(
		needsMedicalBusinessAuthorization({
			...recovery,
			authorizationReady: true,
		}),
	).toBeFalse();
	expect(
		needsMedicalBusinessAuthorization({
			...recovery,
			authorizationPending: true,
		}),
	).toBeFalse();
	expect(
		needsMedicalBusinessAuthorization({ ...recovery, recoveryAllowed: false }),
	).toBeFalse();
	for (const status of [
		"fee_uploaded",
		"order_placed",
		"cash_pending",
		"manual_review",
		"insurance_settled",
	] as const) {
		expect(
			needsMedicalBusinessAuthorization({ ...recovery, status }),
		).toBeFalse();
	}
});

const originalPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
afterEach(() => {
	if (originalPage) Object.defineProperty(globalThis, "Page", originalPage);
	else Reflect.deleteProperty(globalThis, "Page");
});

test("完整服务端拆分显示医院优惠及零现金，6202原金额保留", () => {
	const amounts = {
		totalFen: 1000,
		insuranceFen: 800,
		cashFen: 200,
		hospitalPartFen: 0,
		hospitalReduceFen: 200,
		wechatCashFen: 0,
	};
	expect(medicalPaymentAmountView(amounts)).toMatchObject({
		insuranceAmountLabel: "8.00元",
		cashAmountLabel: "0.00元",
		cashAmountValue: "0.00",
		cashAmountCaption: "微信实付",
		hasActualCashAmount: true,
		hasHospitalDiscount: true,
		hospitalDiscountAmountLabel: "2.00元",
	});
	expect(amounts.cashFen).toBe(200);
	const payment = readMedicalWechatPayment({
		success: true,
		data: {
			orderId: "discount-order",
			status: "insurance_settled",
			paymentState: "cash_paid",
			cashFen: 200,
			hospitalPartFen: 0,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		},
	});
	expect(payment).toMatchObject({
		status: "insurance_settled",
		cashFen: 200,
		hospitalReduceFen: 200,
		wechatCashFen: 0,
	});
});

test("医院负担从医保展示中移出，优惠两来源只计一次并与总费用守恒", () => {
	const amounts = {
		totalFen: 1000,
		insuranceFen: 800,
		cashFen: 200,
		hospitalPartFen: 100,
		hospitalReduceFen: 200,
		wechatCashFen: 0,
	};
	const view = medicalPaymentAmountView(amounts);
	expect(view).toMatchObject({
		insuranceAmountLabel: "7.00元",
		hospitalDiscountAmountLabel: "3.00元",
		cashAmountLabel: "0.00元",
	});
	expect(
		amounts.insuranceFen -
			amounts.hospitalPartFen +
			amounts.hospitalPartFen +
			amounts.hospitalReduceFen +
			amounts.wechatCashFen,
	).toBe(amounts.totalFen);
	expect(
		medicalPaymentAmountView({
			totalFen: 1000,
			insuranceFen: 1000,
			cashFen: 0,
			hospitalPartFen: 200,
			hospitalReduceFen: 0,
			wechatCashFen: 0,
		}),
	).toMatchObject({
		insuranceAmountLabel: "8.00元",
		hospitalDiscountAmountLabel: "2.00元",
		hasHospitalDiscount: true,
		cashAmountLabel: "0.00元",
	});
});

test("旧API或非法展示字段不会把6202原自费称为实际还需付款", () => {
	for (const extra of [
		{},
		{ hospitalReduceFen: 200, wechatCashFen: 0 },
		{ hospitalPartFen: 0, hospitalReduceFen: -1, wechatCashFen: 201 },
		{ hospitalPartFen: 0, hospitalReduceFen: 100, wechatCashFen: 0 },
		{ hospitalPartFen: 900, hospitalReduceFen: 200, wechatCashFen: 0 },
		{
			hospitalPartFen: 0,
			hospitalReduceFen: Number.MAX_SAFE_INTEGER + 1,
			wechatCashFen: 0,
		},
	]) {
		const view = medicalPaymentAmountView({
			totalFen: 1000,
			insuranceFen: 800,
			cashFen: 200,
			...extra,
		});
		expect(view).toMatchObject({
			insuranceAmountLabel: "8.00元",
			cashAmountLabel: "2.00元",
			cashAmountValue: "",
			cashAmountCaption: "医保结算后自费",
			hasActualCashAmount: false,
			hasHospitalDiscount: false,
		});
	}
});

test("门诊结算页使用展示拆分；旧API降级隐藏最终需付数字", async () => {
	let page:
		| { renderRecovery(recovery: unknown): void; renderExternalPayment(): void }
		| undefined;
	Object.defineProperty(globalThis, "Page", {
		configurable: true,
		value: (value: typeof page) => {
			page = value;
		},
	});
	await import(
		"../pages/outpatient-medical-settlement/outpatient-medical-settlement"
	);
	const snapshots: Record<string, unknown>[] = [];
	const host = {
		setData(value: Record<string, unknown>) {
			snapshots.push(value);
		},
	};
	const amounts = { totalFen: 1000, insuranceFen: 800, cashFen: 200 };
	page?.renderRecovery.call(host, {
		amounts: {
			...amounts,
			hospitalPartFen: 0,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		},
	});
	expect(snapshots.at(-1)).toMatchObject({
		cashAmountLabel: "0.00元",
		cashAmountValue: "0.00",
		hasHospitalDiscount: true,
		hospitalDiscountAmountLabel: "2.00元",
	});
	page?.renderRecovery.call(host, { amounts });
	expect(snapshots.at(-1)).toMatchObject({
		cashAmountLabel: "2.00元",
		cashAmountCaption: "医保结算后自费",
		hasActualCashAmount: false,
		cashAmountValue: "",
	});
	page?.renderExternalPayment.call(host);
	expect(snapshots.at(-1)).toMatchObject({
		loading: false,
		hasPending: false,
		externalPaymentConfirmed: true,
		paymentBusy: false,
		canRetrySettlement: false,
		error: "",
	});
});
