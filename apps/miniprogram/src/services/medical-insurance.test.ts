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
