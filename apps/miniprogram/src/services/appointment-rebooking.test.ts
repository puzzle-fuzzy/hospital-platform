import { afterEach, expect, test } from "bun:test";
import type { AppointmentSchedule, AppointmentScheduleSource } from "../types";

/** Exercise the real Page handlers and API response boundaries without any network. */
type TestPage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	onCancelAndRetry(): void;
	onConfirmTap(): void;
	onRefreshSources(): void;
	onSourceChoiceTap(event: {
		currentTarget: { dataset: { index: number } };
	}): void;
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
type Modal = {
	success?: (result: { confirm: boolean; cancel: boolean }) => void;
};

const OLD_SCHEDULE: AppointmentSchedule = {
	scheduleId: "schedule-old-opaque",
	departmentId: "department-001",
	departmentName: "内科",
	doctorId: "doctor-001",
	doctorName: "医生甲",
	registrationClassName: "普通门诊",
	hospitalAreaName: "本院区",
	workDate: "2026-10-16",
	shiftName: "上午",
	startTime: "08:00",
	endTime: "12:00",
	totalSlots: 20,
	availableSlots: 5,
	availabilityStatus: "open",
	timeGroup: "range",
};
const FRESH_SCHEDULE = {
	...OLD_SCHEDULE,
	scheduleId: "schedule-fresh-opaque",
};
const ORIGINAL_SOURCE: AppointmentScheduleSource = {
	serialNumber: "7",
	timeLabel: "09:00-09:30",
	timeGroup: "range",
};
const NEW_SOURCE: AppointmentScheduleSource = {
	serialNumber: "9",
	timeLabel: "10:00-10:30",
	timeGroup: "range",
};
const DUPLICATE = {
	appointmentId: "appointment-old",
	status: "duplicate",
	patientId: "patient-001",
	departmentName: OLD_SCHEDULE.departmentName,
	doctorName: OLD_SCHEDULE.doctorName,
	workDate: OLD_SCHEDULE.workDate,
	shiftName: OLD_SCHEDULE.shiftName,
	sourceSerialNumber: ORIGINAL_SOURCE.serialNumber,
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
function rejected(code: string, message = "服务暂不可用"): Response {
	return {
		statusCode: 409,
		data: { success: false, error: { code, message } },
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
	// All fixtures answer locally; macrotasks let the Page's detached async chain finish.
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

let fixtureNumber = 0;
async function fixture(
	options: {
		sources?: AppointmentScheduleSource[];
		schedules?: AppointmentSchedule[];
		handler?: Handler;
		deferModal?: boolean;
	} = {},
) {
	let definition: TestPage | undefined;
	const requests: Request[] = [];
	const modals: Modal[] = [];
	const redirects: string[] = [];
	let selectedPatientId = "patient-001";
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "rebooking-test-session",
			sessionStatus: "signed_in",
			sessionGeneration: 0,
		},
	};
	const defaults: Handler = (request) => {
		const requestPath = path(request);
		if (requestPath.endsWith("/cancel")) {
			return ok({
				appointmentId: DUPLICATE.appointmentId,
				status: "cancelled",
			});
		}
		if (requestPath === "/api/v2/appointments/schedules") {
			const items = options.schedules ?? [FRESH_SCHEDULE];
			return ok({ items, total: items.length });
		}
		if (requestPath.endsWith("/sources")) {
			const items = options.sources ?? [ORIGINAL_SOURCE];
			return ok({ schedule: FRESH_SCHEDULE, items, total: items.length });
		}
		if (requestPath.endsWith("/holds")) {
			return ok({
				holdId: "hold-fresh",
				status: "held",
				totalFen: 1000,
				expiresAt: "2026-10-16T12:00:00.000Z",
			});
		}
		if (requestPath.endsWith("/registrations")) {
			return ok({
				...DUPLICATE,
				appointmentId: "appointment-new",
				status: "booked",
			});
		}
		throw new Error(
			`Unexpected fixture request: ${request.method} ${requestPath}`,
		);
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
			showModal: (modal: Modal) => {
				modals.push(modal);
				if (!options.deferModal) {
					modal.success?.({ confirm: true, cancel: false });
				}
			},
			showToast: () => {},
			redirectTo: ({ url }: { url: string }) => redirects.push(url),
			navigateTo: ({ url }: { url: string }) => redirects.push(url),
		},
	});
	const modulePath = `../pages/confirm-registration/confirm-registration.ts?rebooking-test-${++fixtureNumber}`;
	await import(modulePath);
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
			duplicate: { ...DUPLICATE },
			holdId: "old-hold",
			holdIdempotencyKey: "old-hold-key",
			registrationIdempotencyKey: "old-registration-key",
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	return {
		page,
		app,
		requests,
		modals,
		redirects,
		defaults,
		selectPatient: (patientId: string) => {
			selectedPatientId = patientId;
		},
		writes: () => requests.filter((request) => request.method === "POST"),
	};
}

test("取消成功先读同一排班的最新号源，再用新 opaqueId 锁定原时段并进入支付", async () => {
	const f = await fixture();
	f.page.onCancelAndRetry();
	await settle();
	expect(
		f.requests.map((request) => `${request.method} ${path(request)}`),
	).toEqual([
		"POST /api/v2/appointments/registrations/appointment-old/cancel",
		"GET /api/v2/appointments/schedules",
		"GET /api/v2/appointments/schedules/schedule-fresh-opaque/sources",
		"POST /api/v2/appointments/holds",
		"POST /api/v2/appointments/registrations",
	]);
	const catalogUrl = new URL(f.requests[1]?.url ?? "");
	expect(Object.fromEntries(catalogUrl.searchParams)).toEqual({
		departmentId: OLD_SCHEDULE.departmentId,
		doctorId: OLD_SCHEDULE.doctorId,
		startDate: OLD_SCHEDULE.workDate,
		endDate: "2026-10-17",
	});
	expect(f.requests[3]?.data).toEqual({
		patientId: "patient-001",
		scheduleId: FRESH_SCHEDULE.scheduleId,
		sourceSerialNumber: ORIGINAL_SOURCE.serialNumber,
	});
	expect(f.requests[3]?.header["idempotency-key"]).not.toBe("old-hold-key");
	expect(f.requests[4]?.header["idempotency-key"]).not.toBe(
		"old-registration-key",
	);
	expect(f.page.data.duplicate).toBeNull();
	expect(f.redirects).toEqual([
		"/pages/registration-payment/registration-payment?patientId=patient-001&appointmentId=appointment-new",
	]);
});

for (const [name, sources] of [
	["原序号消失", [NEW_SOURCE]],
	["原序号对应时间改变", [{ ...ORIGINAL_SOURCE, timeLabel: "09:30-10:00" }]],
	[
		"原序号时段类型改变",
		[{ ...ORIGINAL_SOURCE, timeGroup: "point", timeLabel: "09:00" }],
	],
] as const) {
	test(`${name}时保留当前页供重新选号，确认前不占号或挂号`, async () => {
		const f = await fixture({ sources: [...sources] });
		f.page.onCancelAndRetry();
		await settle();
		expect(f.page.data.duplicate).toBeNull();
		expect(f.page.data.sourceSelectionRequired).toBeTrue();
		expect(f.page.data.sourceChoices).toEqual(sources);
		expect(f.writes().map(path)).toEqual([
			"/api/v2/appointments/registrations/appointment-old/cancel",
		]);
		f.page.onConfirmTap();
		await settle();
		expect(f.writes()).toHaveLength(1);
		f.page.onSourceChoiceTap({ currentTarget: { dataset: { index: 0 } } });
		expect(f.page.data.serialNumber).toBe(sources[0]?.serialNumber);
		expect(f.page.data.timeLabel).toBe(sources[0]?.timeLabel);
		expect(f.writes()).toHaveLength(1);
		f.page.onConfirmTap();
		await settle();
		expect(f.writes().map(path)).toEqual([
			"/api/v2/appointments/registrations/appointment-old/cancel",
			"/api/v2/appointments/holds",
			"/api/v2/appointments/registrations",
		]);
	});
}

for (const [name, changed] of [
	["科室", { departmentId: "department-002" }],
	["医生", { doctorId: "doctor-002" }],
	["日期", { workDate: "2026-10-17" }],
	["班次", { shiftName: "下午" }],
	["院区", { hospitalAreaName: "另一院区" }],
	["号别", { registrationClassName: "专家门诊" }],
] as const) {
	test(`排班引用过期后不会自动切换${name}`, async () => {
		const f = await fixture({ schedules: [{ ...FRESH_SCHEDULE, ...changed }] });
		f.page.onCancelAndRetry();
		await settle();
		expect(f.writes()).toHaveLength(1);
		expect(f.redirects).toHaveLength(0);
		expect(f.page.data.submitting).toBeFalse();
		expect(f.page.data.error || f.page.data.sourceNotice).toBeTruthy();
	});
}

test("匹配排班不唯一时不猜测新引用或占号", async () => {
	const f = await fixture({
		schedules: [
			FRESH_SCHEDULE,
			{ ...FRESH_SCHEDULE, scheduleId: "other-opaque" },
		],
	});
	f.page.onCancelAndRetry();
	await settle();
	expect(f.writes()).toHaveLength(1);
	expect(
		f.requests.some((request) => path(request).endsWith("/sources")),
	).toBeFalse();
});

test("取消被医院拒绝时保留原预约，完全不读取或写入新号源", async () => {
	const f = await fixture({
		handler: () =>
			rejected(
				"appointment-cancellation-rejected",
				"预约已取号，请到门诊窗口办理取消",
			),
	});
	const originalDuplicate = f.page.data.duplicate;
	f.page.onCancelAndRetry();
	await settle();
	expect(f.page.data.duplicate).toBe(originalDuplicate);
	expect(f.page.data.submitting).toBeFalse();
	expect(f.requests).toHaveLength(1);
	expect(f.page.data.error).toContain("预约已取号");
});

test("取消按钮连点和重复 modal 回调最多发送一次取消", async () => {
	const pending = deferred<Response>();
	const f = await fixture({ deferModal: true, handler: () => pending.promise });
	f.page.onCancelAndRetry();
	f.page.onCancelAndRetry();
	expect(f.modals).toHaveLength(1);
	f.modals[0]?.success?.({ confirm: true, cancel: false });
	f.modals[0]?.success?.({ confirm: true, cancel: false });
	await settle();
	expect(f.requests).toHaveLength(1);
	pending.resolve(rejected("appointment-cancellation-rejected"));
	await settle();
	expect(f.page.data.submitting).toBeFalse();
});

test("取消确认框选择返回不会取消预约，按钮可再次使用", async () => {
	const f = await fixture({ deferModal: true });
	f.page.onCancelAndRetry();
	f.modals[0]?.success?.({ confirm: false, cancel: true });
	expect(f.requests).toHaveLength(0);
	expect(f.page.data.submitting).toBeFalse();
	f.page.onCancelAndRetry();
	expect(f.modals).toHaveLength(2);
});

test("取消结果网络未知时保留原预约，不自动取消重试或重新挂号", async () => {
	const f = await fixture({
		handler: () => {
			throw new Error("simulated cancellation timeout");
		},
	});
	const duplicate = f.page.data.duplicate;
	f.page.onCancelAndRetry();
	await settle();
	expect(f.page.data.duplicate).toBe(duplicate);
	expect(f.requests).toHaveLength(1);
	expect(f.redirects).toHaveLength(0);
	expect(f.page.data.error).toBeTruthy();
});

test("取消后无号源可原地刷新，用户明确选择并确认后才挂号", async () => {
	const sources: AppointmentScheduleSource[] = [];
	const f = await fixture({ sources });
	f.page.onCancelAndRetry();
	await settle();
	expect(f.page.data.duplicate).toBeNull();
	expect(f.page.data.sourceChoices).toEqual([]);
	expect(f.writes()).toHaveLength(1);
	expect(f.page.data.error || f.page.data.sourceNotice).toBeTruthy();
	sources.push(NEW_SOURCE);
	f.page.onRefreshSources();
	await settle();
	expect(f.page.data.sourceChoices).toEqual([NEW_SOURCE]);
	expect(f.writes()).toHaveLength(1);
	f.page.onSourceChoiceTap({ currentTarget: { dataset: { index: 0 } } });
	f.page.onConfirmTap();
	await settle();
	expect(f.writes().map(path)).toEqual([
		"/api/v2/appointments/registrations/appointment-old/cancel",
		"/api/v2/appointments/holds",
		"/api/v2/appointments/registrations",
	]);
});

test("取消成功但读号失败保留重选入口，原地刷新不再次取消或自动提交", async () => {
	let defaults!: Handler;
	let sourceReads = 0;
	const f = await fixture({
		handler: (request) => {
			if (path(request).endsWith("/sources") && ++sourceReads === 1) {
				throw new Error("simulated source read timeout");
			}
			return defaults(request);
		},
	});
	defaults = f.defaults;
	f.page.onCancelAndRetry();
	await settle();
	expect(f.page.data.duplicate).toBeNull();
	expect(f.page.data.submitting).toBeFalse();
	expect(f.writes()).toHaveLength(1);
	expect(f.page.data.error || f.page.data.sourceNotice).toBeTruthy();
	f.page.onRefreshSources();
	await settle();
	expect(f.page.data.sourceChoices).toEqual([ORIGINAL_SOURCE]);
	expect(f.writes()).toHaveLength(1);
	f.page.onSourceChoiceTap({ currentTarget: { dataset: { index: 0 } } });
	f.page.onConfirmTap();
	await settle();
	expect(f.writes()).toHaveLength(3);
});

test("取消后的新号源再次变化时停止自动重试，释放失败键并保留本页刷新入口", async () => {
	let defaults!: Handler;
	let holds = 0;
	const f = await fixture({
		handler: (request) => {
			if (path(request).endsWith("/holds") && ++holds === 1) {
				return rejected("appointment-source-unavailable");
			}
			return defaults(request);
		},
	});
	defaults = f.defaults;
	f.page.onCancelAndRetry();
	await settle();
	expect(f.requests).toHaveLength(4);
	expect(f.page.data.holdIdempotencyKey).toBe("");
	expect(f.page.data.registrationIdempotencyKey).toBe("");
	expect(f.page.data.sourceSelectionRequired).toBeTrue();
	const rejectedHoldKey = f.requests[3]?.header["idempotency-key"];
	f.page.onRefreshSources();
	await settle();
	expect(f.requests).toHaveLength(6);
	f.page.onSourceChoiceTap({ currentTarget: { dataset: { index: 0 } } });
	f.page.onConfirmTap();
	await settle();
	const holdRequests = f.requests.filter((request) =>
		path(request).endsWith("/holds"),
	);
	expect(holdRequests).toHaveLength(2);
	expect(holdRequests[1]?.header["idempotency-key"]).not.toBe(rejectedHoldKey);
	expect(f.redirects).toHaveLength(1);
});

test("首次锁号明确提示排班过期时自动刷新相同排班，最多继续一次", async () => {
	let defaults!: Handler;
	let holds = 0;
	const f = await fixture({
		handler: (request) => {
			if (path(request).endsWith("/holds") && ++holds === 1) {
				return rejected("appointment-schedule-reference-expired");
			}
			return defaults(request);
		},
	});
	defaults = f.defaults;
	Object.assign(f.page.data, {
		duplicate: null,
		holdId: "",
		holdIdempotencyKey: "",
		registrationIdempotencyKey: "",
	});
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

for (const stage of ["cancel", "sources", "hold"] as const) {
	for (const change of [
		"patient",
		"selected-patient",
		"session",
		"unload",
	] as const) {
		test(`${stage} 在途时${change}变化，中止所有后续预约写入`, async () => {
			const pending = deferred<Response>();
			let reached = false;
			let defaults!: Handler;
			const f = await fixture({
				handler: (request) => {
					const requestPath = path(request);
					if (
						(stage === "cancel" && requestPath.endsWith("/cancel")) ||
						(stage === "sources" && requestPath.endsWith("/sources")) ||
						(stage === "hold" && requestPath.endsWith("/holds"))
					) {
						reached = true;
						return pending.promise;
					}
					return defaults(request);
				},
			});
			defaults = f.defaults;
			f.page.onCancelAndRetry();
			await settle();
			expect(reached).toBeTrue();
			const writesBefore = f.writes().length;
			if (change === "patient") f.page.data.patientId = "patient-002";
			if (change === "selected-patient") f.selectPatient("patient-002");
			if (change === "session") f.app.globalData.sessionGeneration += 1;
			if (change === "unload") f.page.onUnload();
			pending.resolve(
				stage === "cancel"
					? ok({ appointmentId: DUPLICATE.appointmentId, status: "cancelled" })
					: stage === "sources"
						? ok({
								schedule: FRESH_SCHEDULE,
								items: [ORIGINAL_SOURCE],
								total: 1,
							})
						: ok({
								holdId: "hold-late",
								status: "held",
								totalFen: 1000,
								expiresAt: "2026-10-16T12:00:00.000Z",
							}),
			);
			await settle();
			expect(f.writes()).toHaveLength(writesBefore);
			expect(f.redirects).toHaveLength(0);
		});
	}
}

test("锁号结果网络未知时保留原请求，禁止刷新选号改变幂等键", async () => {
	let defaults!: Handler;
	const f = await fixture({
		handler: (request) => {
			if (path(request).endsWith("/holds")) {
				throw new Error("simulated hold timeout");
			}
			return defaults(request);
		},
	});
	defaults = f.defaults;
	f.page.onCancelAndRetry();
	await settle();
	const holdKey = f.page.data.holdIdempotencyKey;
	const registrationKey = f.page.data.registrationIdempotencyKey;
	expect(typeof holdKey).toBe("string");
	expect(holdKey).not.toBe("");
	expect(f.requests).toHaveLength(4);
	expect(f.page.data.holdId).toBe("");
	f.page.onRefreshSources();
	f.page.onSourceChoiceTap({ currentTarget: { dataset: { index: 0 } } });
	await settle();
	expect(f.requests).toHaveLength(4);
	expect(f.page.data.holdIdempotencyKey).toBe(holdKey);
	expect(f.page.data.registrationIdempotencyKey).toBe(registrationKey);
	f.page.onConfirmTap();
	await settle();
	const holds = f.requests.filter((request) =>
		path(request).endsWith("/holds"),
	);
	expect(holds).toHaveLength(2);
	expect(holds[1]?.header["idempotency-key"]).toBe(String(holdKey));
	expect(
		f.requests.some((request) => path(request).endsWith("/registrations")),
	).toBeFalse();
});

for (const failure of ["network", "rejected"] as const) {
	test(`注册${failure}失败保留同一 hold 和幂等键，不自动刷新或重复挂号`, async () => {
		let defaults!: Handler;
		const f = await fixture({
			handler: (request) => {
				if (path(request).endsWith("/registrations")) {
					if (failure === "network") throw new Error("simulated timeout");
					return rejected("dependency-temporarily-unavailable");
				}
				return defaults(request);
			},
		});
		defaults = f.defaults;
		f.page.onCancelAndRetry();
		await settle();
		expect(f.page.data.holdId).toBe("hold-fresh");
		const holdKey = f.page.data.holdIdempotencyKey;
		const registerKey = f.page.data.registrationIdempotencyKey;
		expect(typeof registerKey).toBe("string");
		expect(registerKey).not.toBe("");
		expect(
			f.requests.filter((request) => path(request).endsWith("/holds")),
		).toHaveLength(1);
		expect(
			f.requests.filter((request) => path(request).endsWith("/registrations")),
		).toHaveLength(1);
		expect(f.redirects).toHaveLength(0);
		await settle();
		expect(f.requests).toHaveLength(5);
		// An explicit user retry may query the same registration key; it must not re-hold.
		f.page.onConfirmTap();
		await settle();
		expect(f.page.data.holdIdempotencyKey).toBe(holdKey);
		expect(f.page.data.registrationIdempotencyKey).toBe(registerKey);
		expect(
			f.requests.filter((request) => path(request).endsWith("/holds")),
		).toHaveLength(1);
		const registrations = f.requests.filter((request) =>
			path(request).endsWith("/registrations"),
		);
		expect(registrations).toHaveLength(2);
		expect(registrations[1]?.header["idempotency-key"]).toBe(
			String(registerKey),
		);
	});
}
