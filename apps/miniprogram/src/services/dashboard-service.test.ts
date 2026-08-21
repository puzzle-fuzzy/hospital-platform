import { expect, test } from "bun:test";
import {
	createAppointmentRecordDateRange,
	createAppointmentRecordQuery,
	createPastDateRange,
	formatOutpatientAmountLabel,
	formatOutpatientBillDateLabel,
	loadAppointmentSchedules,
	loadCurrentPatientForOwner,
	loadOutpatientPaymentRecords,
	requireAppointmentDepartmentListData,
	requireAppointmentRecordListData,
	requireAppointmentScheduleListData,
	requireExactListData,
	requireOutpatientPaymentListData,
	requirePatientListData,
	syncPatientsFromHospital,
} from "./dashboard-service";
import { getSessionGeneration } from "./session-generation";

// 2026-08-15 00:00:00 Asia/Shanghai 对应 UTC 前一天 16:00。
const BEIJING_MIDNIGHT = new Date("2026-08-14T16:00:00.000Z");

test("预约历史查询使用中国标准时间前后各 90 天", () => {
	expect(
		createAppointmentRecordQuery("patient-internal-001", BEIJING_MIDNIGHT),
	).toEqual({
		patientId: "patient-internal-001",
		startDate: "2026-05-17",
		endDate: "2026-11-13",
	});
});

test("爽约查询只使用过去 90 天，不把未来预约混入派生视图", () => {
	expect(
		createAppointmentRecordQuery(
			"patient-internal-001",
			BEIJING_MIDNIGHT,
			"missed",
		),
	).toEqual({
		patientId: "patient-internal-001",
		...createPastDateRange(90, BEIJING_MIDNIGHT),
	});
});

test("预约查询先拒绝空患者标识，不允许生成跨患者请求", () => {
	expect(() => createAppointmentRecordQuery("", BEIJING_MIDNIGHT)).toThrow(
		"请先登录并选择就诊人",
	);
});

test("预约查询拒绝损坏的本地患者标识", () => {
	// 页面参数或本地缓存损坏时，空白、控制字符和超长值都必须在网络请求前
	// 收敛为患者上下文错误；服务端仍会执行最终 owner 校验，这里不是授权替代。
	for (const patientId of [
		" ",
		"\tpatient-internal-001",
		"patient-internal-001\n",
		"x".repeat(129),
	]) {
		expect(() =>
			createAppointmentRecordQuery(patientId, BEIJING_MIDNIGHT),
		).toThrow("请先登录并选择就诊人");
	}
});

test("预约记录查询拒绝未知窗口，不静默降级为历史", () => {
	// 联合类型只保护编译期；异常页面参数不能改变“爽约记录”和“我的挂号”
	// 的业务含义。必须返回稳定错误码，且在构造请求前结束。
	const error = (() => {
		try {
			createAppointmentRecordQuery(
				"patient-internal-001",
				BEIJING_MIDNIGHT,
				"unexpected" as never,
			);
		} catch (caught) {
			return caught;
		}
		return undefined;
	})();
	expect(error).toMatchObject({ code: "appointment-record-query-invalid" });
});

test("门诊费用查询先拒绝空患者标识，不把无效查询交给 API", () => {
	// 这里必须在 requestWithSession 之前失败；否则页面会把患者上下文问题
	// 误报成接口参数错误，且会产生一条没有业务意义的网络日志。
	expect(() => loadOutpatientPaymentRecords("", "unpaid")).toThrow(
		"请先登录并选择就诊人",
	);
});

test("门诊费用查询在网络请求前拒绝未知状态", async () => {
	// 联合类型只在编译期存在；运行时的旧页面或异常事件仍可能传入未知值。
	// 这里必须先返回稳定错误码，不能让未知状态进入 API 或被 Provider 解释成 paid。
	await expect(
		loadOutpatientPaymentRecords("patient-internal-001", "unexpected" as never),
	).rejects.toMatchObject({ code: "outpatient-payment-query-invalid" });
});

test("预约排班查询在网络请求前拒绝损坏的科室标识", async () => {
	// 科室 ID 是排班请求的归属边界；异常值必须在 requestWithSession 之前
	// 收敛为稳定错误码，不能先被 URL 编码后交给 Provider 再等待失败。
	await expect(
		loadAppointmentSchedules(" ", BEIJING_MIDNIGHT),
	).rejects.toMatchObject({ code: "appointment-query-invalid" });
	await expect(
		loadAppointmentSchedules("dept-001\n", BEIJING_MIDNIGHT),
	).rejects.toMatchObject({ code: "appointment-query-invalid" });
	await expect(
		loadAppointmentSchedules("x".repeat(129), BEIJING_MIDNIGHT),
	).rejects.toMatchObject({ code: "appointment-query-invalid" });
});

test("患者端列表响应要求 total 与完整 items 数量一致", () => {
	const items = [{ id: "patient-001" }];
	expect(requireExactListData<{ id: string }>({ items, total: 1 })).toEqual({
		items,
		total: 1,
	});
});

test("患者端列表响应 total 不一致时 fail-closed，不伪装成空列表", () => {
	for (const value of [
		{ items: [{ id: "patient-001" }], total: 0 },
		{ items: [], total: 1 },
		{ items: [{ id: "patient-001" }], total: 1.5 },
		{ items: [{ id: "patient-001" }], total: -1 },
		{ items: "not-an-array", total: 0 },
	]) {
		expect(() => requireExactListData(value)).toThrow("Patient list response");
	}
});

test("患者目录响应必须保持脱敏读模型和唯一患者标识", () => {
	const valid = {
		items: [
			{
				id: "patient-001",
				displayName: "患者甲",
				relationship: "self" as const,
				cardNumberMasked: "12345******1234",
				source: "hospital-his" as const,
				clinicalAccess: "ready" as const,
			},
		],
		total: 1,
	};

	expect(requirePatientListData(valid)).toEqual(valid);
	expect(
		requirePatientListData({
			...valid,
			items: [{ ...valid.items[0], relationship: "unknown" }],
		}).items[0]?.relationship,
	).toBe("unknown");

	for (const invalid of [
		{ ...valid, items: [{ ...valid.items[0], relationship: "friend" }] },
		{ ...valid, items: [{ ...valid.items[0], source: "provider" }] },
		{
			...valid,
			items: [{ ...valid.items[0], clinicalAccess: "ready-now" }],
		},
		{
			...valid,
			items: [{ ...valid.items[0], cardNumberMasked: "6217001234567890" }],
		},
		{ ...valid, items: [{ ...valid.items[0], displayName: " 患者甲" }] },
		{
			...valid,
			items: [valid.items[0], { ...valid.items[0] }],
			total: 2,
		},
		{ ...valid, items: [{ ...valid.items[0], id: "\tpatient-001" }] },
	]) {
		expect(() => requirePatientListData(invalid)).toThrow(
			"Patient response item",
		);
	}
});

test("患者同步先建立会话证明，再进入 POST 协调器", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	type RequestOptions = {
		url: string;
		success: (response: unknown) => void;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	const requestPaths: string[] = [];
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "",
		sessionStatus: "signed_out",
	};
	const patient = {
		id: "patient-sync-session-001",
		displayName: "同步患者",
		relationship: "self" as const,
		cardNumberMasked: "12345******0001",
		source: "hospital-his" as const,
		clinicalAccess: "ready" as const,
	};

	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "access_token" ? globalData.accessToken : "",
		setStorageSync: (key: string, value: string) => {
			if (key === "access_token") globalData.accessToken = value;
		},
		removeStorageSync: (key: string) => {
			if (key === "access_token") globalData.accessToken = "";
		},
		login: (options: { success: (value: { code: string }) => void }) =>
			options.success({ code: "wechat-code-for-sync" }),
		request: (options: RequestOptions) => {
			const path = new URL(options.url).pathname;
			requestPaths.push(path);
			if (path.endsWith("/auth/wechat")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: {
							accessToken: "session-for-sync",
							tokenType: "Bearer",
							expiresInSeconds: 3600,
							user: { id: "user-sync" },
						},
					},
				});
				return;
			}
			if (path.endsWith("/me")) {
				options.success({
					statusCode: 200,
					data: { success: true, data: { user: { id: "user-sync" } } },
				});
				return;
			}
			if (path.endsWith("/patients/sync")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: { items: [patient], total: 1 },
					},
				});
				return;
			}
			throw new Error(`unexpected request: ${path}`);
		},
	};

	try {
		expect(await syncPatientsFromHospital("sync-session-proof")).toEqual([
			patient,
		]);
		expect(requestPaths).toEqual([
			"/api/v2/auth/wechat",
			"/api/v2/me",
			"/api/v2/patients/sync",
		]);
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});

test("患者目录读取在同一 owner 的 GET 会话恢复后继续使用最新代际", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	type RequestOptions = {
		url: string;
		method?: string;
		success: (response: unknown) => void;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	const requestPaths: string[] = [];
	const storage: Record<string, unknown> = {
		selected_patient_id: "patient-read-owner-001",
		access_token: "session-read-owner-old",
	};
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "session-read-owner-old",
		sessionStatus: "signed_in",
	};
	const patient = {
		id: "patient-read-owner-001",
		displayName: "目录患者",
		relationship: "self" as const,
		cardNumberMasked: "12345******0001",
		source: "hospital-his" as const,
		clinicalAccess: "ready" as const,
	};
	let patientRequestCount = 0;

	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) => storage[key] ?? "",
		setStorageSync: (key: string, value: unknown) => {
			storage[key] = value;
			if (key === "access_token") globalData.accessToken = String(value);
		},
		removeStorageSync: (key: string) => {
			delete storage[key];
			if (key === "access_token") globalData.accessToken = "";
		},
		login: (options: { success: (value: { code: string }) => void }) =>
			options.success({ code: "wechat-code-read-owner" }),
		request: (options: RequestOptions) => {
			const path = new URL(options.url).pathname;
			requestPaths.push(path);
			if (path.endsWith("/auth/wechat")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: {
							accessToken: "session-read-owner-new",
							tokenType: "Bearer",
							expiresInSeconds: 3600,
							user: { id: "user-read-owner" },
						},
					},
				});
				return;
			}
			if (path.endsWith("/me")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: { user: { id: "user-read-owner" } },
					},
				});
				return;
			}
			if (path.endsWith("/patients")) {
				patientRequestCount += 1;
				if (patientRequestCount === 1) {
					options.success({
						statusCode: 401,
						data: {
							success: false,
							error: {
								code: "unauthorized",
								message: "expired",
							},
						},
					});
					return;
				}
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: { items: [patient], total: 1 },
					},
				});
				return;
			}
			throw new Error(`unexpected request: ${path}`);
		},
	};

	try {
		const startingGeneration = getSessionGeneration();
		const context = await loadCurrentPatientForOwner("user-read-owner");
		expect(context.patient).toEqual(patient);
		expect(context.sessionGeneration).toBeGreaterThan(startingGeneration);
		expect(requestPaths).toEqual([
			"/api/v2/patients",
			"/api/v2/auth/wechat",
			"/api/v2/patients",
			"/api/v2/me",
		]);
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});

test("患者目录读取期间 owner 变化必须在业务请求前 fail-closed", async () => {
	type TestGlobal = typeof globalThis & {
		getApp: (() => unknown) | undefined;
		wx: unknown;
	};
	type RequestOptions = {
		url: string;
		success: (response: unknown) => void;
	};
	const testGlobal = globalThis as TestGlobal;
	const previousGetApp = testGlobal.getApp;
	const previousWx = testGlobal.wx;
	const requestPaths: string[] = [];
	const globalData = {
		apiBaseUrl: "https://test-hp.meiyi.pro",
		apiPrefix: "/api/v2",
		accessToken: "session-owner-switch",
		sessionStatus: "signed_in",
	};
	const patient = {
		id: "patient-owner-switch-001",
		displayName: "切换患者",
		relationship: "self" as const,
		cardNumberMasked: "12345******0002",
		source: "hospital-his" as const,
		clinicalAccess: "ready" as const,
	};
	testGlobal.getApp = () => ({ globalData });
	testGlobal.wx = {
		getStorageSync: (key: string) =>
			key === "selected_patient_id" ? patient.id : globalData.accessToken,
		setStorageSync: () => undefined,
		removeStorageSync: () => undefined,
		request: (options: RequestOptions) => {
			const path = new URL(options.url).pathname;
			requestPaths.push(path);
			if (path.endsWith("/patients")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: { items: [patient], total: 1 },
					},
				});
				return;
			}
			if (path.endsWith("/me")) {
				options.success({
					statusCode: 200,
					data: {
						success: true,
						data: {
							user: { id: "user-owner-after-switch" },
						},
					},
				});
				return;
			}
			throw new Error(`unexpected request: ${path}`);
		},
	};

	try {
		await expect(
			loadCurrentPatientForOwner("user-owner-before-switch"),
		).rejects.toMatchObject({ code: "session-changed" });
		expect(requestPaths).toEqual(["/api/v2/patients", "/api/v2/me"]);
	} finally {
		testGlobal.getApp = previousGetApp;
		testGlobal.wx = previousWx;
	}
});

test("预约科室目录响应必须保持唯一标识和公开展示字段", () => {
	const valid = {
		items: [
			{
				departmentId: "dept-001",
				departmentCode: "内科",
				displayName: "内科",
				location: "门诊二楼",
			},
		],
		total: 1,
	};

	expect(requireAppointmentDepartmentListData(valid)).toEqual(valid);

	for (const invalid of [
		{ ...valid, items: [{ ...valid.items[0], departmentId: "" }] },
		{ ...valid, items: [{ ...valid.items[0], displayName: " 内科" }] },
		{ ...valid, items: [{ ...valid.items[0], location: null }] },
		{
			...valid,
			items: [valid.items[0], { ...valid.items[0] }],
			total: 2,
		},
	]) {
		expect(() => requireAppointmentDepartmentListData(invalid)).toThrow(
			"Appointment",
		);
	}
});

test("预约排班响应必须绑定请求科室并保持号源语义", () => {
	const valid = {
		items: [
			{
				scheduleId: "schedule-001",
				departmentId: "dept-001",
				departmentName: "内科",
				doctorId: "doctor-001",
				doctorName: "医生甲",
				workDate: "2026-08-20",
				shiftName: "上午",
				startTime: "08:00",
				endTime: "12:00",
				totalSlots: 20,
				availableSlots: 8,
				timeGroup: "range" as const,
			},
		],
		total: 1,
	};

	expect(requireAppointmentScheduleListData(valid, "dept-001")).toEqual(valid);

	for (const invalid of [
		{
			...valid,
			items: [{ ...valid.items[0], departmentId: "dept-002" }],
		},
		{
			...valid,
			items: [{ ...valid.items[0], workDate: "2026-02-31" }],
		},
		{
			...valid,
			items: [{ ...valid.items[0], availableSlots: 21 }],
		},
		{
			...valid,
			items: [{ ...valid.items[0], timeGroup: "unknown-value" }],
		},
		{
			...valid,
			items: [valid.items[0], { ...valid.items[0] }],
			total: 2,
		},
	]) {
		expect(() =>
			requireAppointmentScheduleListData(invalid, "dept-001"),
		).toThrow("Appointment");
	}
});

test("门诊费用列表必须保持查询状态和公共记录字段一致", () => {
	const valid = {
		status: "unpaid" as const,
		items: [
			{
				recordId: "fee-001",
				status: "unpaid" as const,
				billDate: "2026-08-15 10:20:30",
				amountFen: 1234,
			},
		],
		total: 1,
	};
	expect(requireOutpatientPaymentListData(valid, "unpaid")).toEqual({
		items: valid.items,
		total: valid.total,
	});
	expect(
		requireOutpatientPaymentListData(
			{
				...valid,
				items: [{ ...valid.items[0], providerRecordId: "must-drop" }],
			},
			"unpaid",
		),
	).toEqual({ items: valid.items, total: valid.total });

	for (const invalid of [
		{ ...valid, status: "paid" },
		{ ...valid, items: [{ ...valid.items[0], status: "paid" }] },
		{ ...valid, items: [{ ...valid.items[0], amountFen: 12.5 }] },
		{ ...valid, items: [{ ...valid.items[0], recordId: "" }] },
		{ ...valid, items: [{ ...valid.items[0], billDate: null }] },
		{
			...valid,
			items: [{ ...valid.items[0], billDate: "2026-02-31 10:20:30" }],
		},
		{
			...valid,
			items: [valid.items[0], { ...valid.items[0] }],
			total: 2,
		},
	]) {
		expect(() => requireOutpatientPaymentListData(invalid, "unpaid")).toThrow(
			"Outpatient payment response",
		);
	}
});

test("门诊费用列表展示旧端日期粒度但保留完整账单事实", () => {
	const billDate = "2026-08-15 10:20:30";
	// 这里只验证渲染投影；服务端 contract 仍在上面的读模型测试中保留完整时间。
	expect(formatOutpatientBillDateLabel(billDate)).toBe("2026-08-15");
	expect(formatOutpatientAmountLabel(1234)).toBe("¥12.34");
	expect(formatOutpatientAmountLabel(0)).toBe("¥0.00");
	expect(formatOutpatientAmountLabel(Number.MAX_SAFE_INTEGER)).toBe(
		"¥90071992547409.91",
	);
	expect(() => formatOutpatientAmountLabel(12.5)).toThrow("门诊金额不合法");
});

test("我的挂号列表必须保持公共状态、日期和展示字段一致", () => {
	const valid = {
		items: [
			{
				status: "scheduled" as const,
				workDate: "2026-08-15",
				departmentName: "内科",
				workTime: "09:00-09:30",
			},
		],
		total: 1,
	};
	expect(requireAppointmentRecordListData(valid)).toEqual(valid);
	expect(
		requireAppointmentRecordListData({
			...valid,
			items: [{ ...valid.items[0], providerAppointmentId: "must-drop" }],
		}),
	).toEqual(valid);

	for (const invalid of [
		{ items: [{ ...valid.items[0], status: "not-a-status" }], total: 1 },
		{ items: [{ ...valid.items[0], workDate: "2026-02-31" }], total: 1 },
		{ items: [{ ...valid.items[0], departmentName: null }], total: 1 },
		{ items: [{ ...valid.items[0], serialNumber: "" }], total: 1 },
	]) {
		expect(() => requireAppointmentRecordListData(invalid)).toThrow(
			"Appointment record response",
		);
	}
});

test("历史和爽约窗口使用同一中国标准时间自然日基准", () => {
	const history = createAppointmentRecordDateRange(BEIJING_MIDNIGHT);
	const missed = createAppointmentRecordQuery(
		"patient-internal-001",
		BEIJING_MIDNIGHT,
		"missed",
	);

	// 两个查询都必须以 2026-08-15 为今天；区别只能是业务窗口长度，
	// 不能因为调用页面不同而落回设备或服务器本地时区。
	expect(history.startDate).toBe("2026-05-17");
	expect(history.endDate).toBe("2026-11-13");
	expect(missed.endDate).toBe("2026-08-15");
});
