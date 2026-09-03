import { expect, test } from "bun:test";
import {
	INSURANCE_VOUCHER_APP_ID,
	navigateToInsuranceVoucher,
} from "./insurance-voucher-navigation";

const runtime = globalThis as typeof globalThis & { wx?: typeof wx };

test("医保电子凭证入口使用旧端固定目标且不携带业务参数", () => {
	const originalWx = runtime.wx;
	const calls: unknown[] = [];
	runtime.wx = {
		navigateToMiniProgram: (options: unknown) => calls.push(options),
	} as unknown as typeof wx;

	try {
		navigateToInsuranceVoucher();

		expect(calls).toEqual([
			{
				appId: INSURANCE_VOUCHER_APP_ID,
				path: "",
				extraData: {},
				fail: expect.any(Function),
			},
		]);
	} finally {
		if (originalWx) runtime.wx = originalWx;
		else delete runtime.wx;
	}
});

test("医保电子凭证跳转失败时显示用户可理解的错误", () => {
	const originalWx = runtime.wx;
	const originalConsoleError = console.error;
	const toasts: unknown[] = [];
	console.error = () => undefined;
	runtime.wx = {
		navigateToMiniProgram: ({ fail }: { fail: (error: unknown) => void }) =>
			fail(new Error("target unavailable")),
		showToast: (options: unknown) => toasts.push(options),
	} as unknown as typeof wx;

	try {
		navigateToInsuranceVoucher();

		expect(toasts).toEqual([{ title: "跳转失败", icon: "none" }]);
	} finally {
		console.error = originalConsoleError;
		if (originalWx) runtime.wx = originalWx;
		else delete runtime.wx;
	}
});
