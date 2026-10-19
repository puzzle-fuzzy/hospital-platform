import { afterEach, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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

type SettlementFixturePage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	payment(): Promise<void>;
	onPay(): void;
	onLoad(options: Record<string, string>): void;
	onRetrySettlement(): void;
	resumeAuthorizedPayment(force?: boolean): Promise<void>;
};

const settlementSources = Promise.all(
	[
		"./medical-insurance.ts",
		"../pages/outpatient-medical-settlement/outpatient-medical-settlement.ts",
	].map(async (relative) => {
		const build = await Bun.build({
			entrypoints: [fileURLToPath(new URL(relative, import.meta.url))],
			format: "cjs",
			target: "node",
			external: ["*"],
		});
		if (!build.success || !build.outputs[0])
			throw new Error("Fixture build failed");
		return build.outputs[0].text();
	}),
);

async function settlementFixture(
	patch: Record<string, unknown> = {},
	options: {
		cancel?: boolean;
		deferNavigation?: boolean;
		handoff?: boolean;
	} = {},
) {
	const [serviceSource, pageSource] = await settlementSources;
	if (!serviceSource || !pageSource) throw new Error("Fixture source missing");
	const calls: { url: string; data?: unknown }[] = [];
	const native: string[] = [];
	const recovery = {
		orderId: "synthetic-original-order",
		status: "fee_upload_pending",
		authorizationReady: false,
		authorizationPending: false,
		recoveryAllowed: true,
		...patch,
	};
	class FixtureApiError extends Error {
		constructor(message: string, properties: Record<string, unknown> = {}) {
			super(message);
			Object.assign(this, properties);
		}
	}
	const denied = () => {
		throw new Error("Unexpected external IO in settlement fixture");
	};
	let navigation: { success(): void; fail(error: unknown): void } | undefined;
	let markNavigationStarted: () => void = () => undefined;
	const navigationStarted = new Promise<void>((resolve) => {
		markNavigationStarted = resolve;
	});
	const api = {
		ApiError: FixtureApiError,
		createIdempotencyKey: (prefix: string) => `${prefix}-synthetic`,
		requireSuccessDataResponse: (value: unknown) => value,
		requestWithSession: async (input: { url: string; data?: unknown }) => {
			calls.push(input);
			if (input.url.endsWith("/business-recovery"))
				return { success: true, data: recovery };
			if (input.url.includes("/authorization-context?"))
				return {
					success: true,
					data: {
						payForRelatives: false,
						medicalInsurancePaymentEligibility: "supported",
					},
				};
			if (input.url.endsWith("/fees"))
				return {
					success: true,
					data: {
						orderId: recovery.orderId,
						status: "cash_pending",
						amounts: { totalFen: 1000, insuranceFen: 1000, cashFen: 0 },
					},
				};
			throw new FixtureApiError("Synthetic command stop", {
				code: "payment-prepay-in-progress",
			});
		},
	};
	let handoffAvailable = Boolean(options.handoff);
	const handoff = {
		consumeMedicalInsuranceAuthReturn: () => {
			if (!handoffAvailable) return undefined;
			handoffAvailable = false;
			return "synthetic-handoff";
		},
		beginMedicalInsuranceAuthHandoff: (business: unknown) =>
			native.push(JSON.stringify(business)),
		clearMedicalInsuranceAuthHandoff: () => undefined,
	};
	const wx = new Proxy(
		{
			navigateToMiniProgram: (input: {
				success(): void;
				fail(error: unknown): void;
			}) => {
				native.push("authorize");
				navigation = input;
				markNavigationStarted();
				if (options.deferNavigation) return;
				if (options.cancel)
					input.fail({ errMsg: "navigateToMiniProgram:fail cancel" });
				else input.success();
			},
			redirectTo: () => native.push("completed"),
		},
		{ get: (target, name) => Reflect.get(target, name) ?? denied },
	);
	function load(
		source: string,
		require: (name: string) => unknown,
		extra = {},
	) {
		const module = { exports: {} };
		runInNewContext(source, {
			module,
			exports: module.exports,
			require,
			wx,
			fetch: denied,
			setTimeout: denied,
			...extra,
		});
		return module.exports;
	}
	const service = load(serviceSource, (name) => {
		if (name === "./api-client") return api;
		if (name === "./medical-insurance-auth-handoff") return handoff;
		if (name === "../config")
			return {
				MEDICAL_INSURANCE_CONFIG: {
					medicalAppId: "synthetic-app",
					medicalCityCode: "synthetic-city",
					medicalChannel: "synthetic-channel",
					medicalOrgCode: "synthetic-org",
					medicalOrgAppId: "synthetic-org-app",
					medicalOrgChannelCredential: "synthetic-credential",
					insurancePollDelaysMs: [],
				},
			};
		return denied();
	});
	let definition: SettlementFixturePage | undefined;
	load(
		pageSource,
		(name) => {
			if (name.endsWith("/api-client")) return api;
			if (name.endsWith("/medical-insurance")) return service;
			if (name.endsWith("/medical-insurance-auth-handoff")) return handoff;
			if (name.endsWith("/error-presentation"))
				return {
					errorMessageWithCode: (_error: unknown, fallback: string) => fallback,
				};
			if (name.endsWith("/session-events"))
				return { registerPageSessionResetListener: () => undefined };
			if (name.endsWith("/patient-navigation")) return {};
			return denied();
		},
		{
			Page: (value: SettlementFixturePage) => {
				definition = value;
			},
		},
	);
	if (!definition) throw new Error("Settlement page missing");
	const page: SettlementFixturePage = {
		...definition,
		data: {
			...definition.data,
			patientId: "synthetic-patient",
			recordId: "synthetic-record",
			hasPending: true,
			loading: false,
		},
		setData(value: Record<string, unknown>) {
			Object.assign(this.data, value);
		},
	};
	let operation: Promise<void> | undefined;
	const payment = page.payment;
	page.payment = () => {
		operation = payment.call(page);
		return operation;
	};
	const resume = page.resumeAuthorizedPayment;
	page.resumeAuthorizedPayment = (force) => {
		operation = resume.call(page, force);
		return operation;
	};
	return {
		page,
		calls,
		native,
		recovery,
		navigationStarted,
		finishNavigation: () => navigation?.success(),
		operation: () => operation,
	};
}

test.each(
	(["onPay", "onLoad", "onRetrySettlement"] as const).flatMap((entry) =>
		["created", "fee_upload_pending"].map((status) => ({ entry, status })),
	),
)(
	"门诊 $entry 对 $status 过期授权复用原业务重新展码，禁止直接上传费用",
	async ({ entry, status }) => {
		const fixture = await settlementFixture({ status });
		if (entry === "onLoad")
			fixture.page.onLoad({
				patientId: "synthetic-patient",
				recordId: "synthetic-record",
				start: "1",
			});
		else fixture.page[entry]();
		await fixture.operation();
		expect(fixture.native).toContain("authorize");
		expect(fixture.native).toContain(
			JSON.stringify({
				businessType: "outpatient",
				businessId: "synthetic-record",
				patientId: "synthetic-patient",
			}),
		);
		expect(
			fixture.calls.every(
				(call) => !/\/(fees|settle|authorize|wechat-pay)$/.test(call.url),
			),
		).toBeTrue();
		expect(fixture.page.data.paymentBusy).toBeFalse();
	},
);

test.each(["onPay", "onLoad", "onRetrySettlement"] as const)(
	"%s 授权确认中即使残留handoff也不重授权或上传费用，解除后可重新查原单",
	async (entry) => {
		const fixture = await settlementFixture(
			{ authorizationPending: true },
			{ handoff: true },
		);
		if (entry === "onLoad")
			fixture.page.onLoad({
				patientId: "synthetic-patient",
				recordId: "synthetic-record",
				start: "1",
			});
		else fixture.page[entry]();
		await fixture.operation();
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.native).toEqual([]);
		expect(fixture.page.data).toMatchObject({
			paymentBusy: false,
			canRetrySettlement: true,
			hasPending: false,
		});
		expect(fixture.page.data.paymentMessage).toContain("授权正在确认");
		const template = await Bun.file(
			new URL(
				"../pages/outpatient-medical-settlement/outpatient-medical-settlement.wxml",
				import.meta.url,
			),
		).text();
		const waitingCard = [
			...template.matchAll(
				/<view[^>]*wx:elif="{{([^}]+)}}"[^>]*>([\s\S]*?)<\/view>/g,
			),
		].find((match) => match[2]?.includes('bindtap="onRetrySettlement"'));
		if (!waitingCard?.[1] || !waitingCard[2])
			throw new Error("Settlement retry card missing");
		expect(runInNewContext(waitingCard[1], fixture.page.data)).toBeTrue();
		for (const name of ["state-title", "state-message"]) {
			const expression = waitingCard[2].match(
				new RegExp(`<text class="${name}">{{([^}]+)}}</text>`),
			)?.[1];
			if (!expression) throw new Error("Settlement waiting text missing");
			expect(runInNewContext(expression, fixture.page.data)).toContain("授权");
		}
		fixture.recovery.authorizationPending = false;
		fixture.page.onRetrySettlement();
		await fixture.operation();
		if (entry === "onPay") {
			expect(
				fixture.calls.find((call) => call.url.endsWith("/authorize"))?.data,
			).toMatchObject({
				patientId: "synthetic-patient",
				recordId: "synthetic-record",
				authCode: "synthetic-handoff",
			});
		} else expect(fixture.native).toContain("authorize");
		expect(
			fixture.calls.some((call) => call.url.endsWith("/fees")),
		).toBeFalse();
	},
);

test("重新授权期间拦住并发点击，取消后按钮恢复", async () => {
	const fixture = await settlementFixture({}, { deferNavigation: true });
	const first = fixture.page.payment();
	await fixture.navigationStarted;
	expect(fixture.native).toContain("authorize");
	const count = fixture.calls.length;
	await fixture.page.payment();
	expect(fixture.calls).toHaveLength(count);
	fixture.finishNavigation();
	await first;
	expect(fixture.page.data.paymentBusy).toBeFalse();
	const cancelled = await settlementFixture({}, { cancel: true });
	await cancelled.page.payment();
	expect(cancelled.page.data).toMatchObject({
		paymentBusy: false,
		canRetrySettlement: true,
	});
	expect(
		cancelled.calls.some((call) => call.url.endsWith("/fees")),
	).toBeFalse();
});

test.each([
	{ status: "insurance_settled", authorizationReady: false },
	{
		status: "manual_review",
		recoveryAllowed: false,
		externalPaymentConfirmed: true,
	},
])("已付或已确认其他渠道支付不重开：$status", async (recovery) => {
	const fixture = await settlementFixture(recovery);
	await fixture.page.payment();
	expect(fixture.calls).toHaveLength(1);
	expect(fixture.native).not.toContain("authorize");
	if (recovery.externalPaymentConfirmed)
		expect(fixture.page.data.externalPaymentConfirmed).toBeTrue();
	else expect(fixture.native).toContain("completed");
});

test("有效授权仍续传同一原单，现金待付与冲突订单不重授权", async () => {
	for (const recovery of [
		{ status: "created", authorizationReady: true },
		{ status: "fee_upload_pending", authorizationReady: true },
		{ status: "fee_uploaded", authorizationReady: false },
		{ status: "order_placed", authorizationReady: false },
	]) {
		const ready = await settlementFixture(recovery);
		await ready.page.payment();
		expect(
			ready.calls.some((call) =>
				call.url.endsWith("/orders/synthetic-original-order/fees"),
			),
		).toBeTrue();
		expect(ready.native).not.toContain("authorize");
	}
	for (const recovery of [
		{
			status: "cash_pending",
			amounts: { totalFen: 1000, insuranceFen: 1000, cashFen: 0 },
		},
		{ status: "manual_review", recoveryAllowed: false },
	]) {
		const fixture = await settlementFixture(recovery);
		await fixture.page.payment();
		expect(
			fixture.calls.some((call) => call.url.endsWith("/fees")),
		).toBeFalse();
		expect(fixture.native).not.toContain("authorize");
	}
});

test.each(["onLoad", "onRetrySettlement"] as const)(
	"%s 已结算原单优先于残留授权回跳码，不续传费用",
	async (entry) => {
		const fixture = await settlementFixture(
			{ status: "insurance_settled", authorizationReady: false },
			{ handoff: true },
		);
		if (entry === "onLoad")
			fixture.page.onLoad({
				patientId: "synthetic-patient",
				recordId: "synthetic-record",
				start: "1",
			});
		else fixture.page.onRetrySettlement();
		await fixture.operation();
		expect(fixture.calls).toHaveLength(1);
		expect(fixture.native).toEqual(["completed"]);
	},
);
