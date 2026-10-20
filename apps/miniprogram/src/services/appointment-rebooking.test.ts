import { afterEach, expect, test } from "bun:test";
import type { AppointmentSchedule, AppointmentScheduleSource } from "../types";
import { notifySessionChanged } from "./session-events";

/** Real Page handlers and API validators; every response is synthetic and local. */
type TestPage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	onLoad(options: Record<string, string>): void;
	onShow(): void;
	loadPatient(): void;
	onViewExistingAppointment(): void;
	onConfirmTap(): void;
	submitRegistration(): void;
	onRefreshSources(): void;
	onUnload(): void;
};
type Request = {
	url: string;
	method: string;
	data?: unknown;
	header: Record<string, string>;
	success(result: { statusCode: number; data: unknown }): void;
	fail(result: { errMsg: string }): void;
};
type Response = { statusCode: number; data: unknown };
type Handler = (request: Request) => Response | Promise<Response>;
type Navigation = { url: string; fail?(): void };

const OLD_SCHEDULE: AppointmentSchedule = {
	scheduleId: "schedule-old-opaque",
	departmentId: "department-001",
	departmentName: "测试科室",
	doctorId: "doctor-001",
	doctorName: "测试医生",
	registrationClassName: "普通门诊",
	hospitalAreaName: "本院区",
	workDate: "2026-10-20",
	shiftName: "上午",
	startTime: "08:00",
	endTime: "12:00",
	totalSlots: 20,
	availableSlots: 5,
	availabilityStatus: "open",
	timeGroup: "range",
};
const FRESH_SCHEDULE = { ...OLD_SCHEDULE, scheduleId: "schedule-fresh-opaque" };
const ORIGINAL_SOURCE: AppointmentScheduleSource = {
	serialNumber: "7",
	timeLabel: "09:00-09:30",
	timeGroup: "range",
};
const DUPLICATE = {
	appointmentId: "original/opaque?appointment&=1",
	status: "duplicate",
	patientId: "patient-001",
	departmentName: OLD_SCHEDULE.departmentName,
	doctorName: OLD_SCHEDULE.doctorName,
	workDate: OLD_SCHEDULE.workDate,
	shiftName: OLD_SCHEDULE.shiftName,
	sourceSerialNumber: "3",
	totalFen: 1000,
};
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
function ok(data: unknown): Response {
	return { statusCode: 200, data: { success: true, data } };
}
function rejected(
	code: string,
	message = "internal patientName=不可展示",
	numericCode?: number,
): Response {
	return {
		statusCode: 409,
		data: { success: false, error: { code, message, numericCode } },
	};
}
function path(request: Request): string {
	return new URL(request.url).pathname;
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}
let fixtureNumber = 0;
async function fixture(
	options: { handler?: Handler; existing?: boolean } = {},
) {
	let definition: TestPage | undefined;
	const requests: Request[] = [];
	const redirects: Navigation[] = [];
	const navigations: Navigation[] = [];
	const modals: unknown[] = [];
	const toasts: unknown[] = [];
	let selectedPatientId = "patient-001";
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "synthetic-existing-appointment-session",
			sessionStatus: "signed_in",
			sessionGeneration: 0,
		},
	};
	const defaults: Handler = (request) => {
		if (path(request) === "/api/v2/appointments/schedules")
			return ok({ items: [FRESH_SCHEDULE], total: 1 });
		if (path(request).endsWith("/sources"))
			return ok({
				schedule: FRESH_SCHEDULE,
				items: [ORIGINAL_SOURCE],
				total: 1,
			});
		if (path(request).endsWith("/holds"))
			return ok({
				holdId: "current-attempt-hold",
				status: "held",
				totalFen: 1000,
				expiresAt: "2026-10-20T12:00:00.000Z",
			});
		if (path(request).endsWith("/registrations"))
			return ok({
				...DUPLICATE,
				appointmentId: "appointment-new",
				status: "booked",
			});
		return rejected("provider-temporarily-unavailable");
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (page: TestPage) => {
			definition = page;
		},
		wx: {
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? selectedPatientId : "",
			setStorageSync: () => {},
			getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
			request: (request: Request) => {
				requests.push(request);
				void Promise.resolve()
					.then(() => (options.handler ?? defaults)(request))
					.then(request.success)
					.catch(() => request.fail({ errMsg: "request:fail timeout" }));
			},
			showModal: (modal: unknown) => modals.push(modal),
			showToast: (toast: unknown) => toasts.push(toast),
			redirectTo: (navigation: Navigation) => redirects.push(navigation),
			navigateTo: (navigation: Navigation) => navigations.push(navigation),
		},
	});
	await import(
		`../pages/confirm-registration/confirm-registration.ts?existing-test-${++fixtureNumber}`
	);
	if (!definition)
		throw new Error("confirm-registration Page was not registered");
	const page: TestPage = {
		...definition,
		data: {
			...definition.data,
			...OLD_SCHEDULE,
			serialNumber: ORIGINAL_SOURCE.serialNumber,
			timeLabel: ORIGINAL_SOURCE.timeLabel,
			sourceTimeGroup: ORIGINAL_SOURCE.timeGroup,
			sourceSchedule: { ...OLD_SCHEDULE },
			patientId: "patient-001",
			patientName: "测试就诊人",
			patientLoading: false,
			agreed: true,
			...(options.existing
				? {
						duplicate: { ...DUPLICATE },
						duplicateDetected: true,
						duplicatePatientId: "patient-001",
						duplicateSessionGeneration: 0,
					}
				: {}),
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	return {
		page,
		app,
		requests,
		redirects,
		navigations,
		modals,
		toasts,
		defaults,
		selectPatient: (patientId: string) => {
			selectedPatientId = patientId;
		},
		writes: () => requests.filter((request) => request.method === "POST"),
	};
}

test("服务器返回唯一原预约后只展示原日期医生号序，查看按钮只导航原详情且业务写入为零", async () => {
	let defaults!: Handler;
	const f = await fixture({
		handler: (request) =>
			path(request).endsWith("/registrations")
				? ok(DUPLICATE)
				: defaults(request),
	});
	defaults = f.defaults;
	f.page.onConfirmTap();
	await settle();
	expect(f.page.data.duplicateDetected).toBeTrue();
	expect(f.page.data.duplicate).toMatchObject(DUPLICATE);
	expect(f.page.data.holdId).toBe("");
	expect(f.redirects).toHaveLength(0);
	const before = f.requests.length;
	f.page.onViewExistingAppointment();
	f.page.onViewExistingAppointment();
	f.page.onConfirmTap();
	f.page.submitRegistration();
	f.page.onRefreshSources();
	await settle();
	expect(f.requests).toHaveLength(before);
	expect(f.modals).toHaveLength(0);
	expect(f.redirects).toHaveLength(1);
	const target = new URL(
		f.redirects[0]?.url ?? "",
		"https://mini.example.test",
	);
	expect(target.pathname).toBe("/pages/appointment-detail/appointment-detail");
	expect(Object.fromEntries(target.searchParams)).toEqual({
		patientId: "patient-001",
		appointmentId: DUPLICATE.appointmentId,
	});
	expect(target.searchParams.get("appointmentId")).not.toBe(
		"current-attempt-hold",
	);
	expect(
		f.requests.some((request) =>
			/cancel|refund|payment|prepay/u.test(path(request)),
		),
	).toBeFalse();
});
test("精确30475拒绝显示重复预约状态，仅携当前就诊人前往我的挂号，原hold不可冒充预约", async () => {
	let defaults!: Handler;
	const f = await fixture({
		handler: (request) =>
			path(request).endsWith("/registrations")
				? rejected(
						"appointment-registration-duplicate",
						"任意内部诊断 patientName=不可展示",
						30475,
					)
				: defaults(request),
	});
	defaults = f.defaults;
	f.page.onConfirmTap();
	await settle();
	expect(f.page.data.duplicateDetected).toBeTrue();
	expect(f.page.data.duplicate).toBeNull();
	expect(f.page.data.error).toBe("");
	expect(f.page.data.holdId).toBe("");
	const before = f.requests.length;
	f.page.onViewExistingAppointment();
	f.page.onConfirmTap();
	await settle();
	expect(f.requests).toHaveLength(before);
	expect(f.redirects.map((item) => item.url)).toEqual([
		"/pages/appointment-records/appointment-records?patientId=patient-001",
	]);
});
test("一般10800或上游原文含重复预约不能触发duplicate或兜底入口", async () => {
	let defaults!: Handler;
	const f = await fixture({
		handler: (request) =>
			path(request).endsWith("/registrations")
				? rejected(
						"provider-request-rejected",
						"1217 当天已预约 doctor=内部 patientName=不可展示",
						10800,
					)
				: defaults(request),
	});
	defaults = f.defaults;
	f.page.onConfirmTap();
	await settle();
	expect(f.page.data.duplicateDetected).toBeFalse();
	expect(f.page.data.duplicate).toBeNull();
	expect(f.page.data.error).toBe(
		"预约暂时无法完成，请稍后重试（错误码 10800）",
	);
	f.page.onViewExistingAppointment();
	expect(f.redirects).toHaveLength(0);
});
test("duplicate响应的patient不匹配由API边界拒绝，不展示也不跳转其他人预约", async () => {
	let defaults!: Handler;
	const f = await fixture({
		handler: (request) =>
			path(request).endsWith("/registrations")
				? ok({ ...DUPLICATE, patientId: "patient-other" })
				: defaults(request),
	});
	defaults = f.defaults;
	f.page.onConfirmTap();
	await settle();
	expect(f.page.data.duplicateDetected).toBeFalse();
	expect(f.page.data.duplicate).toBeNull();
	f.page.onViewExistingAppointment();
	expect(f.redirects).toHaveLength(0);
});
test("残留duplicate字段患者不符时只允许当前患者挂号列表，不直达错误详情", async () => {
	const f = await fixture({ existing: true });
	f.page.data.duplicate = { ...DUPLICATE, patientId: "patient-other" };
	f.page.onViewExistingAppointment();
	expect(f.redirects[0]?.url).toBe(
		"/pages/appointment-records/appointment-records?patientId=patient-001",
	);
	expect(f.requests).toHaveLength(0);
});

test("即使会话代际尚未变化，没有平台凭据也不能打开原预约或列表", async () => {
	const f = await fixture({ existing: true });
	f.app.globalData.accessToken = "";
	f.page.onViewExistingAppointment();
	expect(f.redirects).toHaveLength(0);
	expect(f.requests).toHaveLength(0);
});
test("redirect失败仅以相同原预约路由navigateTo兜底，不发业务请求", async () => {
	const f = await fixture({ existing: true });
	f.page.onViewExistingAppointment();
	f.redirects[0]?.fail?.();
	f.redirects[0]?.fail?.();
	expect(f.navigations).toHaveLength(1);
	expect(f.navigations.map((item) => item.url)).toEqual(
		f.redirects.map((item) => item.url),
	);
	expect(f.requests).toHaveLength(0);
	f.navigations[0]?.fail?.();
	expect(f.page.data.duplicateNavigating).toBeFalse();
	expect(f.toasts).toHaveLength(1);
});

test("navigateTo兜底后返回确认页可再次查看原预约，旧失败回调已作废", async () => {
	const f = await fixture({ existing: true });
	f.page.onViewExistingAppointment();
	f.redirects[0]?.fail?.();
	expect(f.navigations).toHaveLength(1);
	f.page.loadPatient = () => {};
	f.page.onShow();
	expect(f.page.data.duplicateNavigating).toBeFalse();
	expect(f.page.data.duplicate).toMatchObject(DUPLICATE);
	f.navigations[0]?.fail?.();
	expect(f.toasts).toHaveLength(0);
	f.page.onViewExistingAppointment();
	expect(f.redirects).toHaveLength(2);
	expect(f.requests).toHaveLength(0);
});
for (const change of [
	"patient",
	"selected-patient",
	"session",
	"unload",
] as const) {
	test(`导航前${change}变化时不打开旧预约也不写入`, async () => {
		const f = await fixture({ existing: true });
		if (change === "patient") f.page.data.patientId = "patient-002";
		if (change === "selected-patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "unload") f.page.onUnload();
		f.page.onViewExistingAppointment();
		expect(f.redirects).toHaveLength(0);
		expect(f.requests).toHaveLength(0);
	});
	test(`redirect失败回调前${change}变化时不得跨上下文navigateTo`, async () => {
		const f = await fixture({ existing: true });
		f.page.onViewExistingAppointment();
		if (change === "patient") f.page.data.patientId = "patient-002";
		if (change === "selected-patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "unload") f.page.onUnload();
		f.redirects[0]?.fail?.();
		expect(f.navigations).toHaveLength(0);
		expect(f.requests).toHaveLength(0);
	});
	for (const result of ["duplicate", "fallback"] as const) {
		test(`${result}响应在途时${change}变化，不回填旧卡片或导航`, async () => {
			const pending = deferred<Response>();
			let defaults!: Handler;
			const f = await fixture({
				handler: (request) =>
					path(request).endsWith("/registrations")
						? pending.promise
						: defaults(request),
			});
			defaults = f.defaults;
			f.page.onConfirmTap();
			await settle();
			if (change === "patient") f.page.data.patientId = "patient-002";
			if (change === "selected-patient") f.selectPatient("patient-002");
			if (change === "session") f.app.globalData.sessionGeneration++;
			if (change === "unload") f.page.onUnload();
			pending.resolve(
				result === "duplicate"
					? ok(DUPLICATE)
					: rejected("appointment-registration-duplicate", "safe", 30475),
			);
			await settle();
			expect(f.page.data.duplicateDetected).toBeFalse();
			expect(f.page.data.duplicate).toBeNull();
			expect(f.redirects).toHaveLength(0);
			expect(f.writes()).toHaveLength(2);
		});
	}
}
test("同页切换就诊人立即清空重复卡片和原幂等键，不保留旧患者入口", async () => {
	const f = await fixture({ existing: true });
	Object.assign(f.page.data, {
		holdId: "old-hold",
		holdIdempotencyKey: "old-hold-key",
		registrationIdempotencyKey: "old-register-key",
	});
	f.selectPatient("patient-002");
	f.page.onShow();
	expect(f.page.data.duplicateDetected).toBeFalse();
	expect(f.page.data.duplicate).toBeNull();
	expect(f.page.data.duplicatePatientId).toBe("");
	expect(f.page.data.holdId).toBe("");
	f.page.onViewExistingAppointment();
	await settle();
	expect(f.redirects).toHaveLength(0);
	expect(f.writes()).toHaveLength(0);
});
test("会话切换监听清空duplicate并使旧导航兜底失效", async () => {
	const f = await fixture({ existing: true });
	const loadPatient = f.page.loadPatient;
	f.page.loadPatient = () => {};
	f.page.onLoad(
		Object.fromEntries(
			Object.entries({
				...OLD_SCHEDULE,
				timeLabel: ORIGINAL_SOURCE.timeLabel,
			}).map(([key, value]) => [key, String(value)]),
		),
	);
	f.page.onViewExistingAppointment();
	f.app.globalData.sessionGeneration++;
	notifySessionChanged("account-switched");
	expect(f.page.data.duplicateDetected).toBeFalse();
	expect(f.page.data.duplicate).toBeNull();
	f.redirects[0]?.fail?.();
	expect(f.navigations).toHaveLength(0);
	f.page.onUnload();
	f.page.loadPatient = loadPatient;
});
test("正常预约仍由用户确定后真实提交hold及register，并进入新订单支付页", async () => {
	const f = await fixture();
	f.page.onConfirmTap();
	await settle();
	expect(f.writes().map(path)).toEqual([
		"/api/v2/appointments/holds",
		"/api/v2/appointments/registrations",
	]);
	expect(f.redirects[0]?.url).toBe(
		"/pages/registration-payment/registration-payment?patientId=patient-001&appointmentId=appointment-new",
	);
});
test("首次锁号引用明确过期仍刷新同一排班且最多自动继续一次", async () => {
	let defaults!: Handler;
	let holds = 0;
	const f = await fixture({
		handler: (request) =>
			path(request).endsWith("/holds") && ++holds === 1
				? rejected("appointment-schedule-reference-expired")
				: defaults(request),
	});
	defaults = f.defaults;
	f.page.onConfirmTap();
	await settle();
	expect(
		f.requests.map((request) => `${request.method} ${path(request)}`),
	).toEqual([
		"POST /api/v2/appointments/holds",
		"GET /api/v2/appointments/schedules",
		"GET /api/v2/appointments/schedules/schedule-fresh-opaque/sources",
		"POST /api/v2/appointments/holds",
		"POST /api/v2/appointments/registrations",
	]);
	expect(f.requests[3]?.header["idempotency-key"]).not.toBe(
		f.requests[0]?.header["idempotency-key"],
	);
	expect(f.redirects).toHaveLength(1);
});
for (const stage of ["hold", "registration"] as const) {
	test(`${stage}网络未知时保留同一请求，只有用户再次确定才复用原key`, async () => {
		let defaults!: Handler;
		const f = await fixture({
			handler: (request) => {
				if (
					path(request).endsWith(stage === "hold" ? "/holds" : "/registrations")
				)
					throw new Error("synthetic timeout");
				return defaults(request);
			},
		});
		defaults = f.defaults;
		f.page.onConfirmTap();
		await settle();
		const keys = [
			f.page.data.holdIdempotencyKey,
			f.page.data.registrationIdempotencyKey,
		];
		const before = f.requests.length;
		f.page.onRefreshSources();
		await settle();
		expect(f.requests).toHaveLength(before);
		expect(f.page.data.duplicateDetected).toBeFalse();
		f.page.onConfirmTap();
		await settle();
		expect([
			f.page.data.holdIdempotencyKey,
			f.page.data.registrationIdempotencyKey,
		]).toEqual(keys);
		expect(f.redirects).toHaveLength(0);
		if (stage === "registration")
			expect(
				f.requests.filter((request) => path(request).endsWith("/holds")),
			).toHaveLength(1);
	});
}
test("WXML重复状态只保留明确导航，隐藏确定预约和旧结果继续确认提示", async () => {
	const template = await Bun.file(
		new URL(
			"../pages/confirm-registration/confirm-registration.wxml",
			import.meta.url,
		),
	).text();
	expect(template).toContain("当天已预约该医生");
	expect(template).toContain("如需重新预约，请先前往原预约详情取消");
	expect(template).toContain("查看原预约");
	expect(template).toContain("前往我的挂号");
	expect(template).toContain("{{duplicate.sourceSerialNumber}}号");
	expect(template).toMatch(
		/wx:if="\{\{!duplicateDetected\}\}" class="confirm-submit/u,
	);
	expect(template).toMatch(/wx:if="\{\{!duplicateDetected && !submitting/u);
	expect(template).not.toContain("onCancelAndRetry");
	expect(template).not.toContain("取消原预约并重新预约");
});
