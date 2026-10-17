import { afterEach, expect, test } from "bun:test";
import { ApiError, requireAppointmentDetailResponse } from "./api-client";
import {
	appointmentPaymentStatusLabel,
	canContinueAppointmentPayment,
	readAppointmentPaymentFields,
} from "./appointment-payment-view";
import { requireAppointmentRecordListData } from "./dashboard-service";

const detail = {
	appointmentId: "appointment-payment-view-001",
	patientId: "patient-payment-view-001",
	patient: { displayName: "测试就诊人", cardNumberMasked: "123***45" },
	hospitalName: "测试医院",
	departmentName: "测试门诊",
	doctorName: "测试医生",
	workDate: "2026-10-13",
	shiftName: "下午",
	sourceSerialNumber: "1",
	totalFen: 1000,
	status: "scheduled",
	selfPayStatus: "not_started",
	paymentStatus: "pending",
	canPay: true,
	payExpiresAt: "2099-01-01T00:15:00.000Z",
};

test("列表和详情校验保留支付能力与截止时间，同时拒绝损坏字段", () => {
	const payment = {
		paymentStatus: "pending",
		canPay: true,
		payExpiresAt: detail.payExpiresAt,
	};
	expect(
		requireAppointmentDetailResponse(
			{ success: true, data: detail },
			detail.appointmentId,
			detail.patientId,
		).data,
	).toMatchObject(payment);
	expect(
		requireAppointmentRecordListData({
			items: [{ ...detail, privateProviderField: "drop" }],
			total: 1,
		}).items[0],
	).toMatchObject(payment);
	expect(
		requireAppointmentRecordListData({
			items: [{ ...detail, privateProviderField: "drop" }],
			total: 1,
		}).items[0],
	).not.toHaveProperty("privateProviderField");
	for (const invalid of [
		{ paymentStatus: "untrusted" },
		{ canPay: "true" },
		{ payExpiresAt: "2026-10-13 15:00" },
		{ payExpiresAt: "invalid" },
	]) {
		expect(readAppointmentPaymentFields(invalid)).toBeNull();
		expect(() =>
			requireAppointmentDetailResponse(
				{ success: true, data: { ...detail, ...invalid } },
				detail.appointmentId,
				detail.patientId,
			),
		).toThrow();
		expect(() =>
			requireAppointmentRecordListData({
				items: [{ ...detail, ...invalid }],
				total: 1,
			}),
		).toThrow();
	}
});

test("医院终态、明确禁止、确认中和到期时间都阻止新付款", () => {
	expect(
		canContinueAppointmentPayment({ ...detail, paymentStatus: "pending" }),
	).toBeTrue();
	for (const status of [
		"cancelled",
		"expired",
		"completed",
		"missed",
		"unknown",
	]) {
		expect(
			canContinueAppointmentPayment({
				...detail,
				status,
				paymentStatus: "pending",
			}),
		).toBeFalse();
	}
	expect(
		canContinueAppointmentPayment({
			...detail,
			paymentStatus: "pending",
			canPay: false,
		}),
	).toBeFalse();
	expect(
		canContinueAppointmentPayment({ ...detail, paymentStatus: "confirming" }),
	).toBeFalse();
	expect(
		canContinueAppointmentPayment({ ...detail, paymentStatus: "paid" }),
	).toBeFalse();
	expect(
		canContinueAppointmentPayment(
			{
				...detail,
				paymentStatus: "pending",
				payExpiresAt: "2026-10-13T07:00:00.000Z",
			},
			Date.parse("2026-10-13T07:00:00.000Z"),
		),
	).toBeFalse();
	expect(
		canContinueAppointmentPayment({
			status: "scheduled",
			selfPayStatus: "not_started",
		}),
	).toBeTrue();
	expect(
		canContinueAppointmentPayment({
			status: "scheduled",
			selfPayStatus: "cash_paid",
		}),
	).toBeFalse();
	expect(
		appointmentPaymentStatusLabel(
			{ status: "cancelled", paymentStatus: "pending" },
			"已预约",
		),
	).toBe("已取消");
});

type PageUnderTest = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	startOrResumePayment(mode: "self" | "mixed"): Promise<void>;
	handlePaymentError(error: unknown): Promise<void>;
	refreshPaymentAvailability(): Promise<boolean>;
	onQueryOriginalPayment(): Promise<void>;
};
let pageDefinition: PageUnderTest | undefined;
const originalGlobals = new Map(
	["wx", "getApp", "Page"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
afterEach(() => {
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

async function paymentPage(
	response: Record<string, unknown>,
	switchPatient = false,
	options: {
		medical?: boolean;
		medicalSettled?: boolean;
		selfMissing?: boolean;
	} = {},
) {
	const calls: string[] = [];
	const methods: string[] = [];
	let nativeCalls = 0;
	let selectedPatient = detail.patientId;
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "payment-test-session",
			sessionStatus: "signed_in",
			sessionGeneration: 9,
		},
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (value: PageUnderTest) => {
			pageDefinition = value;
		},
		wx: {
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? selectedPatient : undefined,
			requestPayment: () => {
				nativeCalls += 1;
			},
			redirectTo: () => undefined,
			request: (requestOptions: {
				url: string;
				method?: string;
				success(response: unknown): void;
			}) => {
				calls.push(new URL(requestOptions.url).pathname);
				methods.push(requestOptions.method ?? "GET");
				if (requestOptions.url.includes("/appointments/registrations/")) {
					if (switchPatient) selectedPatient = "other-patient";
					requestOptions.success({
						statusCode: 200,
						header: {},
						data: { success: true, data: response },
					});
				} else if (requestOptions.url.endsWith("/business-recovery")) {
					if (options.medical) {
						requestOptions.success({
							statusCode: 200,
							header: {},
							data: {
								success: true,
								data: {
									orderId: "medical-original-001",
									status: "cash_pending",
									authorizationReady: true,
									authorizationPending: false,
									recoveryAllowed: true,
								},
							},
						});
						return;
					}
					requestOptions.success({
						statusCode: 404,
						header: {},
						data: {
							error: {
								code: "medical-insurance-order-not-found",
								message: "No active medical order",
							},
						},
					});
				} else if (
					requestOptions.url.endsWith(
						"/medical-insurance/orders/medical-original-001",
					)
				) {
					requestOptions.success({
						statusCode: 200,
						header: {},
						data: {
							success: true,
							data: {
								orderId: "medical-original-001",
								status: options.medicalSettled
									? "insurance_settled"
									: "cash_pending",
								amounts: { totalFen: 1000, insuranceFen: 500, cashFen: 500 },
							},
						},
					});
				} else if (requestOptions.url.endsWith("/self-pay")) {
					if (options.selfMissing) {
						requestOptions.success({
							statusCode: 400,
							header: {},
							data: {
								error: {
									code: "payment-order-invalid",
									message: "No original self-pay order",
								},
							},
						});
						return;
					}
					requestOptions.success({
						statusCode: 200,
						header: {},
						data: {
							success: true,
							data: {
								appointmentId: detail.appointmentId,
								orderId: "self-order-001",
								status: "cash_paid",
								paymentState: "completed",
								totalFen: 1000,
							},
						},
					});
				} else throw new Error("Unexpected request in payment regression");
			},
		},
	});
	if (!pageDefinition)
		await import("../pages/registration-payment/registration-payment");
	if (!pageDefinition) throw new Error("Payment page was not registered");
	const page: PageUnderTest = {
		...pageDefinition,
		data: {
			...pageDefinition.data,
			appointmentId: detail.appointmentId,
			patientId: detail.patientId,
			sessionGeneration: 9,
			ready: true,
			canPay: true,
			busy: false,
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	return { page, calls, methods, nativeCalls: () => nativeCalls };
}

test("支付页点击时重新读详情，已过期或不可付款不创建订单也不调用微信", async () => {
	for (const patch of [
		{ status: "expired", paymentStatus: "expired", canPay: false },
		{ status: "cancelled" },
		{ canPay: false },
		{ paymentStatus: "confirming", canPay: false },
		{ payExpiresAt: "2026-01-01T00:00:00.000Z" },
	]) {
		const { page, calls, nativeCalls } = await paymentPage({
			...detail,
			...patch,
		});
		await page.startOrResumePayment("self");
		expect(calls[0]).toBe(
			`/api/v2/appointments/registrations/${detail.appointmentId}`,
		);
		expect(
			calls.every(
				(path) =>
					path.includes("/appointments/registrations/") ||
					path.endsWith("/business-recovery"),
			),
		).toBeTrue();
		expect(nativeCalls()).toBe(0);
		expect(page.data.canPay).toBeFalse();
		expect(page.data.busy).toBeFalse();
		expect(page.data.message).not.toBe("");
	}
});

test("有效预约仍按同一个预约引用恢复原支付，详情读后换患者则不继续", async () => {
	const eligible = await paymentPage(detail);
	await eligible.page.startOrResumePayment("self");
	expect(eligible.calls).toEqual([
		`/api/v2/appointments/registrations/${detail.appointmentId}`,
		"/api/v2/payments/medical-insurance/business-recovery",
		"/api/v2/payments/medical-insurance/business-recovery",
		`/api/v2/payments/appointments/${detail.appointmentId}/self-pay`,
	]);
	expect(eligible.page.data.completed).toBeTrue();
	const switched = await paymentPage(detail, true);
	await switched.page.startOrResumePayment("self");
	expect(switched.calls).toHaveLength(1);
	expect(switched.nativeCalls()).toBe(0);
});

test("服务端在付款前拒绝预约时刷新详情并关闭收银台入口，原资金提示保留", async () => {
	const { page, calls, nativeCalls } = await paymentPage({
		...detail,
		status: "expired",
		paymentStatus: "expired",
		canPay: false,
	});
	await page.handlePaymentError(
		new ApiError("预约暂不可支付", {
			code: "appointment-payment-unavailable",
			statusCode: 409,
		}),
	);
	expect(calls).toHaveLength(2);
	expect(nativeCalls()).toBe(0);
	expect(page.data.canPay).toBeFalse();
	expect(page.data.message).toContain("如已扣款");
});

test("确认中和已过期的原自费单只查单并刷新详情，不创建或调起收银台", async () => {
	for (const patch of [
		{
			paymentStatus: "confirming",
			canPay: false,
			selfPayStatus: "awaiting_confirmation",
		},
		{
			status: "expired",
			paymentStatus: "expired",
			canPay: false,
			selfPayStatus: "awaiting_confirmation",
		},
	]) {
		const fixture = await paymentPage({ ...detail, ...patch });
		await fixture.page.refreshPaymentAvailability();
		expect(fixture.page.data.canQueryOriginalPayment).toBeTrue();
		await fixture.page.onQueryOriginalPayment();
		const selfQueryIndex = fixture.calls.findIndex((path) =>
			path.endsWith("/self-pay"),
		);
		expect(selfQueryIndex).toBeGreaterThan(-1);
		expect(fixture.methods[selfQueryIndex]).toBe("GET");
		expect(fixture.calls.slice(-2)).toEqual([
			`/api/v2/appointments/registrations/${detail.appointmentId}`,
			"/api/v2/payments/medical-insurance/business-recovery",
		]);
		expect(fixture.page.data.canPay).toBeFalse();
		expect(fixture.nativeCalls()).toBe(0);
	}
});

test("过期医保单经业务恢复确认存在后可查询原单，只有读取路径", async () => {
	const fixture = await paymentPage(
		{ ...detail, status: "expired", paymentStatus: "expired", canPay: false },
		false,
		{ medical: true },
	);
	await fixture.page.refreshPaymentAvailability();
	expect(fixture.page.data.canQueryOriginalPayment).toBeTrue();
	await fixture.page.onQueryOriginalPayment();
	expect(fixture.calls).toContain(
		"/api/v2/payments/medical-insurance/orders/medical-original-001",
	);
	expect(
		fixture.calls.every(
			(path, index) =>
				fixture.methods[index] === "GET" || path.endsWith("/business-recovery"),
		),
	).toBeTrue();
	expect(
		fixture.calls.some((path) =>
			/\/(?:self-pay|authorize|fees|settle|wechat-pay)$/.test(path),
		),
	).toBeFalse();
	expect(fixture.nativeCalls()).toBe(0);
	expect(fixture.page.data.canPay).toBeFalse();
});

test("没有旧单不展示查单按钮，自费无单错误不能显示支付成功", async () => {
	const noOrder = await paymentPage({
		...detail,
		status: "expired",
		paymentStatus: "expired",
		canPay: false,
	});
	await noOrder.page.refreshPaymentAvailability();
	expect(noOrder.page.data.canQueryOriginalPayment).toBeFalse();
	const noOrderCalls = noOrder.calls.length;
	await noOrder.page.onQueryOriginalPayment();
	expect(noOrder.calls).toHaveLength(noOrderCalls);
	const missingSelf = await paymentPage(
		{ ...detail, paymentStatus: "confirming", canPay: false },
		false,
		{ selfMissing: true },
	);
	await missingSelf.page.refreshPaymentAvailability();
	await missingSelf.page.onQueryOriginalPayment();
	expect(missingSelf.page.data.message).toContain("暂时无法确认");
	expect(missingSelf.page.data.message).not.toContain("支付已确认");
	expect(missingSelf.nativeCalls()).toBe(0);
});

test("医保结算已返回但现金段未确认时不宣告整单付款成功", async () => {
	const fixture = await paymentPage(
		{ ...detail, status: "expired", paymentStatus: "expired", canPay: false },
		false,
		{ medical: true, medicalSettled: true },
	);
	await fixture.page.refreshPaymentAvailability();
	await fixture.page.onQueryOriginalPayment();
	expect(fixture.page.data.message).toContain("现金支付结果请在挂号详情核对");
	expect(fixture.page.data.message).not.toContain("原医保支付已确认");
	expect(fixture.page.data.completed).toBeFalse();
	expect(fixture.nativeCalls()).toBe(0);
});

test("过期详情的原支付状态入口仅导航原预约，拒绝换患者和旧会话", async () => {
	const fixture = await paymentPage(detail);
	type DetailPage = {
		data: Record<string, unknown>;
		setData(patch: Record<string, unknown>): void;
		onViewOriginalPayment(): void;
	};
	let definition: DetailPage | undefined;
	const urls: string[] = [];
	Object.assign(globalThis, {
		Page: (value: DetailPage) => {
			definition = value;
		},
	});
	Object.assign(wx, {
		navigateTo: (options: { url: string }) => {
			urls.push(options.url);
		},
		showToast: () => undefined,
	});
	await import("../pages/appointment-detail/appointment-detail");
	if (!definition)
		throw new Error("Appointment detail page was not registered");
	const config = definition as DetailPage;
	const page: DetailPage = {
		...config,
		data: {
			...config.data,
			loading: false,
			localDetail: true,
			canViewOriginalPayment: true,
			canPay: false,
			status: "expired",
			appointmentId: detail.appointmentId,
			patientId: detail.patientId,
			sessionGeneration: 9,
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	page.onViewOriginalPayment();
	expect(urls).toEqual([
		`/pages/registration-payment/registration-payment?patientId=${detail.patientId}&appointmentId=${detail.appointmentId}`,
	]);
	expect(urls[0]).not.toContain("mode=");
	expect(fixture.calls).toHaveLength(0);
	expect(fixture.nativeCalls()).toBe(0);
	page.data.sessionGeneration = 8;
	page.onViewOriginalPayment();
	expect(urls).toHaveLength(1);
	Object.assign(page.data, {
		appointmentId: detail.appointmentId,
		canViewOriginalPayment: true,
		sessionGeneration: 9,
	});
	Object.assign(wx, { getStorageSync: () => "other-patient" });
	page.onViewOriginalPayment();
	expect(urls).toHaveLength(1);
});
