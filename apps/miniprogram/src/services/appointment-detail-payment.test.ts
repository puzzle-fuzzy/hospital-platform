import { afterEach, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { notifySessionChanged } from "./session-events";

type DetailPage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	onLoad(options: Record<string, string>): void;
	loadDetail(patientId: string, appointmentId: string): Promise<void>;
	onViewOriginalPayment(): void;
	onCancel(): void;
	showError(error: unknown): void;
	onUnload(): void;
};

type RequestOptions = {
	url: string;
	method?: string;
	success(response: unknown): void;
};

const globals = new Map(
	["wx", "getApp", "Page", "fetch"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
const pages: DetailPage[] = [];
afterEach(() => {
	for (const page of pages.splice(0)) page.onUnload();
	for (const [name, descriptor] of globals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

const PATIENT_ID = "patient-detail-payment-fixture";
const APPOINTMENT_ID = "appointment-detail-payment-fixture";
const PAST_DEADLINE = "2000-01-01T00:15:00.000Z";
const FUTURE_DEADLINE = "2099-01-01T00:15:00.000Z";
const PAID_MESSAGE = "挂号费用已支付，可查看本次支付详情。";
let definition: DetailPage | undefined;

async function detailFixture(
	patch: Record<string, unknown> = {},
	sourceRecordStatus = "",
) {
	const requests: Array<{ method: string; path: string }> = [];
	const urls: string[] = [];
	let paymentCalls = 0;
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "detail-payment-fixture-session",
			sessionStatus: "signed_in",
			sessionGeneration: 9,
		},
	};
	const detail = {
		appointmentId: APPOINTMENT_ID,
		patientId: PATIENT_ID,
		patient: { displayName: "测试就诊人", cardNumberMasked: "123***45" },
		hospitalName: "测试医院",
		departmentName: "测试门诊",
		doctorName: "测试医生",
		workDate: "2026-10-16",
		shiftName: "下午",
		sourceSerialNumber: "1",
		totalFen: 1000,
		status: "scheduled",
		selfPayStatus: "cash_paid",
		paymentStatus: "paid",
		canPay: false,
		payExpiresAt: PAST_DEADLINE,
		...patch,
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (page: DetailPage) => {
			definition = page;
		},
		fetch: () => {
			throw new Error("Detail regression cannot access the network");
		},
		wx: {
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? PATIENT_ID : "",
			getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
			requestPayment: () => {
				paymentCalls += 1;
			},
			requestMedicalInsurancePay: () => {
				paymentCalls += 1;
			},
			navigateTo: (options: { url: string }) => urls.push(options.url),
			showToast: () => undefined,
			showModal: (options: {
				success?: (value: { confirm: boolean; cancel: boolean }) => void;
			}) => options.success?.({ confirm: true, cancel: false }),
			request: (options: RequestOptions) => {
				const path = new URL(options.url).pathname;
				const method = options.method ?? "GET";
				requests.push({ method, path });
				const respond = (data: unknown) =>
					options.success({
						statusCode: 200,
						header: {},
						data: { success: true, data },
					});
				if (method === "GET" && path === "/api/v2/me") {
					respond({ user: { id: "user-detail-payment-fixture" } });
					return;
				}
				if (method === "GET" && path === "/api/v2/patients") {
					respond({
						items: [
							{
								id: PATIENT_ID,
								displayName: "测试就诊人",
								relationship: "self",
								cardNumberMasked: "123***45",
								source: "hospital-his",
								clinicalAccess: "ready",
							},
						],
						total: 1,
					});
					return;
				}
				if (
					method === "GET" &&
					path === `/api/v2/appointments/registrations/${APPOINTMENT_ID}`
				) {
					respond(detail);
					return;
				}
				if (
					method === "POST" &&
					path === `/api/v2/appointments/registrations/${APPOINTMENT_ID}/cancel`
				) {
					respond({ appointmentId: APPOINTMENT_ID, status: "cancelled" });
					return;
				}
				throw new Error(
					`Unexpected detail regression request: ${method} ${path}`,
				);
			},
		},
	});
	if (!definition) {
		const modulePath = "../pages/appointment-detail/appointment-detail";
		await import(`${modulePath}.ts?detail-payment-regression`);
	}
	if (!definition)
		throw new Error("Appointment detail page was not registered");
	const page: DetailPage = {
		...definition,
		data: {
			...definition.data,
			sourceAppointmentId: APPOINTMENT_ID,
			sourcePatientId: PATIENT_ID,
			sourceRecordStatus,
		},
		setData(update) {
			Object.assign(this.data, update);
		},
	};
	pages.push(page);
	await page.loadDetail(PATIENT_ID, APPOINTMENT_ID);
	expect(page.data.error).toBe("");
	expect(page.data.localDetail).toBeTrue();
	expect(requests.map((request) => request.path)).toContain("/api/v2/me");
	expect(requests.map((request) => request.path)).toContain("/api/v2/patients");
	expect(requests.at(-1)?.path).toBe(
		`/api/v2/appointments/registrations/${APPOINTMENT_ID}`,
	);
	return { page, requests, urls, paymentCalls: () => paymentCalls };
}

function expectReadOnly(fixture: Awaited<ReturnType<typeof detailFixture>>) {
	expect(
		fixture.requests.every((request) => request.method === "GET"),
	).toBeTrue();
	expect(fixture.paymentCalls()).toBe(0);
}

test("已付款详情忽略旧支付截止，显示正向缴费信息且不开放付款", async () => {
	const fixture = await detailFixture();
	expect(fixture.page.data.paymentCompleted).toBeTrue();
	expect(fixture.page.data.paymentMessage).toBe(PAID_MESSAGE);
	expect(fixture.page.data.payDeadlineLabel).toBe("");
	expect(fixture.page.data.canPay).toBeFalse();
	expect(fixture.page.data.canCancel).toBeTrue();
	expect(fixture.page.data.canViewOriginalPayment).toBeTrue();
	expectReadOnly(fixture);
});

test("旧 API 的现金已付详情可展示缴费完成，显式确认中不能被现金状态覆盖", async () => {
	const legacy = await detailFixture({ paymentStatus: undefined });
	expect(legacy.page.data.paymentCompleted).toBeTrue();
	expect(legacy.page.data.paymentMessage).toBe(PAID_MESSAGE);
	expect(legacy.page.data.payDeadlineLabel).toBe("");
	expectReadOnly(legacy);
	const confirming = await detailFixture({
		paymentStatus: "confirming",
		payExpiresAt: FUTURE_DEADLINE,
	});
	expect(confirming.page.data.paymentCompleted).toBeFalse();
	expect(confirming.page.data.paymentMessage).not.toBe(PAID_MESSAGE);
	expect(confirming.page.data.paymentMessage).toContain("正在确认");
	expect(confirming.page.data.canPay).toBeFalse();
	expect(confirming.page.data.canViewOriginalPayment).toBeTrue();
	expectReadOnly(confirming);
});

test("医院及列表已取消或已过期时，旧已付字段不能展示缴费成功", async () => {
	for (const status of ["cancelled", "expired"]) {
		for (const fromList of [false, true]) {
			const fixture = await detailFixture(
				{ status: fromList ? "scheduled" : status },
				fromList ? status : "",
			);
			expect(fixture.page.data.status).toBe(status);
			expect(fixture.page.data.paymentCompleted).toBeFalse();
			expect(fixture.page.data.paymentMessage).not.toBe(PAID_MESSAGE);
			expect(fixture.page.data.canPay).toBeFalse();
			expect(fixture.page.data.canCancel).toBeFalse();
			expect(fixture.page.data.canViewOriginalPayment).toBeTrue();
			expectReadOnly(fixture);
		}
	}
});

test("原支付详情只导航原预约，错误状态清除已缴费展示与截止时间", async () => {
	const fixture = await detailFixture();
	const before = fixture.requests.length;
	fixture.page.onViewOriginalPayment();
	expect(fixture.urls).toEqual([
		`/pages/registration-payment/registration-payment?patientId=${PATIENT_ID}&appointmentId=${APPOINTMENT_ID}`,
	]);
	expect(fixture.urls[0]).not.toContain("mode=");
	expect(fixture.requests).toHaveLength(before);
	fixture.page.setData({ payDeadlineLabel: "old display deadline" });
	fixture.page.showError(new ApiError("fixture", { code: "session-changed" }));
	expect(fixture.page.data.paymentCompleted).toBeFalse();
	expect(fixture.page.data.payDeadlineLabel).toBe("");
	expect(fixture.page.data.canPay).toBeFalse();
	expect(fixture.page.data.canViewOriginalPayment).toBeFalse();
	expectReadOnly(fixture);
});

test("取消预约成功清除已缴费展示，不额外创建任何支付", async () => {
	const fixture = await detailFixture();
	fixture.page.setData({ payDeadlineLabel: "old display deadline" });
	fixture.page.onCancel();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(fixture.page.data.status).toBe("cancelled");
	expect(fixture.page.data.paymentCompleted).toBeFalse();
	expect(fixture.page.data.payDeadlineLabel).toBe("");
	expect(fixture.page.data.canCancel).toBeFalse();
	expect(fixture.page.data.canPay).toBeFalse();
	expect(
		fixture.requests.filter((request) => request.method !== "GET"),
	).toEqual([
		{
			method: "POST",
			path: `/api/v2/appointments/registrations/${APPOINTMENT_ID}/cancel`,
		},
	]);
	expect(fixture.paymentCalls()).toBe(0);
});

test("详情收到账号切换时清除旧缴费成功信息、截止时间和操作入口", async () => {
	const fixture = await detailFixture();
	fixture.page.onLoad({ patientId: PATIENT_ID, appointmentId: APPOINTMENT_ID });
	// 等待最新一次真实详情读取；onLoad 的旧请求由页面 guard 自动淘汰。
	await fixture.page.loadDetail(PATIENT_ID, APPOINTMENT_ID);
	expect(fixture.page.data.paymentCompleted).toBeTrue();
	fixture.page.setData({ payDeadlineLabel: "old display deadline" });
	const before = fixture.requests.length;
	notifySessionChanged("account-switched");
	expect(fixture.page.data.paymentCompleted).toBeFalse();
	expect(fixture.page.data.payDeadlineLabel).toBe("");
	expect(fixture.page.data.paymentMessage).toBe("");
	expect(fixture.page.data.canPay).toBeFalse();
	expect(fixture.page.data.canCancel).toBeFalse();
	expect(fixture.page.data.canViewOriginalPayment).toBeFalse();
	expect(fixture.requests).toHaveLength(before);
	expectReadOnly(fixture);
});
