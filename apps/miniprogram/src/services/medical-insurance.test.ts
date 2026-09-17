import { expect, test } from "bun:test";

test("正式小程序支付异常后清除本地支付上下文", async () => {
	const storage = new Map<string, unknown>();
	Object.assign(globalThis, {
		wx: {
			getStorageSync: (key: string) => storage.get(key),
			setStorageSync: (key: string, value: unknown) => storage.set(key, value),
			removeStorageSync: (key: string) => storage.delete(key),
		},
	});
	const { readPendingPayment } = await import("./medical-insurance");
	storage.set("hospital-platform.pending-medical-payment.v1", {
		appointmentId: "appointment-formal-recovery-001",
		patientId: "patient-formal-recovery-001",
		createdAt: Date.now(),
		orderId: "medical-formal-recovery-001",
		authorizeIdempotencyKey: "medical-authorize-formal-recovery-001",
		feesIdempotencyKey: "medical-fees-formal-recovery-001",
		settleIdempotencyKey: "medical-settle-formal-recovery-001",
		mode: "mixed",
		phase: "cash_payment",
		wechatPayIdempotencyKey: "medical-wechat-pay-formal-recovery-001",
		wechatQueryIdempotencyKey: "medical-wechat-query-formal-recovery-001",
		recoveryState: "awaiting_confirmation",
	});

	expect(readPendingPayment()).toBeNull();
});

test("门诊医保支付上下文保留 recordId 并通过本地恢复校验", async () => {
	const storage = new Map<string, unknown>();
	Object.assign(globalThis, {
		wx: {
			getStorageSync: (key: string) => storage.get(key),
			setStorageSync: (key: string, value: unknown) => storage.set(key, value),
			removeStorageSync: (key: string) => storage.delete(key),
		},
	});
	const { readPendingPayment } = await import("./medical-insurance");
	storage.set("hospital-platform.pending-medical-payment.v1", {
		businessType: "outpatient",
		appointmentId: "outpatient-record-local-001",
		recordId: "outpatient-record-local-001",
		patientId: "patient-local-001",
		createdAt: Date.now(),
		authorizeIdempotencyKey: "medical-authorize-outpatient-local-001",
		feesIdempotencyKey: "medical-fees-outpatient-local-001",
		settleIdempotencyKey: "medical-settle-outpatient-local-001",
		mode: "mixed",
		phase: "authorization",
	});

	expect(readPendingPayment()).toMatchObject({
		businessType: "outpatient",
		recordId: "outpatient-record-local-001",
		patientId: "patient-local-001",
	});
});

test("已完成支付记录保留医保与自费金额拆分", async () => {
	const storage = new Map<string, unknown>();
	Object.assign(globalThis, {
		wx: {
			getStorageSync: (key: string) => storage.get(key),
			setStorageSync: (key: string, value: unknown) => storage.set(key, value),
			removeStorageSync: (key: string) => storage.delete(key),
		},
	});
	const { readLastMedicalPaymentResult } = await import("./medical-insurance");
	storage.set("hospital-platform.last-medical-payment-result", {
		businessType: "outpatient",
		appointmentId: "outpatient-record-result-001",
		recordId: "outpatient-record-result-001",
		orderId: "medical-order-result-001",
		amounts: { totalFen: 10000, insuranceFen: 7000, cashFen: 3000 },
		completedAt: Date.now(),
	});

	expect(readLastMedicalPaymentResult()).toMatchObject({
		orderId: "medical-order-result-001",
		amounts: { totalFen: 10000, insuranceFen: 7000, cashFen: 3000 },
	});
});
