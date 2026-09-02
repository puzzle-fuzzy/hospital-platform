import { expect, test } from "bun:test";
import { MAX_APPOINTMENT_SCHEDULE_ITEMS } from "@hospital/domain";
import { ProviderRequestError } from "./errors";
import { createZhongyangAppointmentGateway } from "./zhongyang-appointments";

const context = {
	traceId: "appointment-trace-001",
	idempotencyKey: "appointment-key-001",
};

test("众阳预约目录只返回科室白名单并固定服务端渠道", async () => {
	let requestUrl = "";
	let requestHeaders: Headers | undefined;
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							deptId: "dept-001",
							deptCode: "internal-code",
							deptName: "心内科",
							roomAddress: "门诊楼二层",
							hisCreaterName: "internal-provider-field",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "provider-request-001" } },
			);
		},
	});

	const result = await gateway.listDepartments(
		{ startDate: "2026-08-15", endDate: "2026-08-22" },
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/schedulings/scheduling-depts?requestChannel=4&startDate=2026-08-15&endDate=2026-08-22",
	);
	expect(requestHeaders?.get("authorization")).toBe("Bearer server-token");
	expect(requestHeaders?.get("x-request-id")).toBe(context.traceId);
	expect(requestHeaders?.get("idempotency-key")).toBe(context.idempotencyKey);
	expect(result).toEqual({
		departments: [
			{
				departmentId: "dept-001",
				departmentCode: "internal-code",
				displayName: "心内科",
				location: "门诊楼二层",
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "appointment-departments",
			requestId: "provider-request-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("internal-provider-field");
});

test("众阳挂号目录树固定 first-depts 参数并只映射一二级白名单字段", async () => {
	let requestUrl = "";
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrl = String(input);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							firstDeptId: "first-internal",
							firstDeptName: "内科",
							orgId: "provider-org-secret",
							secondDeptList: [
								{
									deptId: "second-cardiology",
									deptName: "心血管内科",
									deptIntroduction: "provider-internal-description",
								},
							],
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "tree-request-001" } },
			);
		},
	});

	const result = await gateway.listDepartmentTree(context);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/first-depts?requestChannel=3&todayRegisterFlag=0&queryMode=0",
	);
	expect(result).toEqual({
		groups: [
			{
				groupId: "first-internal",
				displayName: "内科",
				departments: [
					{
						departmentId: "second-cardiology",
						displayName: "心血管内科",
					},
				],
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "appointment-department-tree",
			requestId: "tree-request-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("provider-org-secret");
	expect(JSON.stringify(result)).not.toContain("provider-internal-description");
});

test("众阳三级可预约科室只从受控二级 ID 解析名称后查询", async () => {
	const requestUrls: string[] = [];
	let requestCount = 0;
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrls.push(String(input));
			requestCount += 1;
			if (requestCount === 1) {
				return new Response(
					JSON.stringify({
						success: true,
						data: [
							{
								firstDeptId: "first-internal",
								firstDeptName: "内科",
								secondDeptList: [
									{
										deptId: "second-cardiology",
										deptName: "心血管内科",
									},
								],
							},
						],
					}),
					{ status: 200, headers: { "x-request-id": "tree-request-002" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							deptId: "clinic-cardiology",
							deptName: "心内科门诊",
							roomAddress: "门诊楼二层",
							hisCreaterName: "provider-creator-secret",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "clinic-request-002" } },
			);
		},
	});

	const result = await gateway.listClinicDepartments(
		{
			startDate: "2026-08-15",
			endDate: "2026-08-22",
			parentDepartmentId: "second-cardiology",
		},
		context,
	);

	expect(requestUrls).toHaveLength(2);
	expect(requestUrls[0]).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/first-depts?requestChannel=3&todayRegisterFlag=0&queryMode=0",
	);
	const clinicUrl = new URL(requestUrls[1] as string);
	expect(clinicUrl.pathname).toBe(
		"/msun-middle-business-amc-server/v1/schedulings/scheduling-depts",
	);
	expect(Object.fromEntries(clinicUrl.searchParams)).toEqual({
		requestChannel: "4",
		startDate: "2026-08-15",
		endDate: "2026-08-22",
		searchCondition: "心血管内科",
	});
	expect(result).toEqual({
		departments: [
			{
				departmentId: "clinic-cardiology",
				displayName: "心内科门诊",
				location: "门诊楼二层",
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "appointment-clinic-departments",
			requestId: "clinic-request-002",
			requestIds: ["tree-request-002", "clinic-request-002"],
		},
	});
	expect(JSON.stringify(result)).not.toContain("provider-creator-secret");
});

test("众阳三级可预约科室拒绝未知二级 ID 且不发名称检索", async () => {
	let providerCalls = 0;
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			providerCalls += 1;
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							firstDeptId: "first-internal",
							firstDeptName: "内科",
							secondDeptList: [],
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "tree-request-unknown" } },
			);
		},
	});

	await expect(
		gateway.listClinicDepartments(
			{
				startDate: "2026-08-15",
				endDate: "2026-08-22",
				parentDepartmentId: "second-unknown",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-clinic-departments",
		responseInvalid: false,
	});
	expect(providerCalls).toBe(1);
});

test("众阳排班目录固定请求渠道并只返回已验证的号源读模型", async () => {
	let requestUrl = "";
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrl = String(input);
			return new Response(
				JSON.stringify([
					{
						hisScheduleId: 1001,
						deptId: 10,
						deptName: "心内科",
						docId: 20,
						docName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						startTime: "08:00",
						endTime: "12:00",
						totalNum: 30,
						remainingNumber: null,
						usableNum: 7,
						usableSourceNum: 12,
						timeGroupFlag: "1",
						registrationFee: 99,
						doctorTelephone: "13800000000",
					},
				]),
				{ status: 200, headers: { "x-request-id": "provider-request-002" } },
			);
		},
	});

	const result = await gateway.listSchedules(
		{
			startDate: "2026-08-20",
			endDate: "2026-08-21",
			departmentId: "dept-001",
			doctorId: "doctor-001",
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/schedulings?requestChannel=4&startDate=2026-08-20&endDate=2026-08-21&deptId=dept-001&docId=doctor-001",
	);
	expect(result.schedules).toEqual([
		{
			providerScheduleId: "1001",
			departmentId: "10",
			departmentName: "心内科",
			doctorId: "20",
			doctorName: "李医生",
			workDate: "2026-08-20",
			shiftName: "上午",
			startTime: "08:00",
			endTime: "12:00",
			totalSlots: 30,
			availableSlots: 12,
			timeGroup: "range",
		},
	]);
	expect(JSON.stringify(result)).not.toContain("13800000000");
	expect(JSON.stringify(result)).not.toContain("registrationFee");
});

test("众阳预约目录和排班 adapter 在触网前拒绝畸形查询", async () => {
	let providerCalls = 0;
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			providerCalls += 1;
			return new Response(JSON.stringify([]), { status: 200 });
		},
	});

	const invalidCalls = [
		gateway.listDepartments(null as never, context),
		gateway.listDepartments(
			{
				startDate: "2026-02-30",
				endDate: "2026-03-01",
			},
			context,
		),
		gateway.listSchedules(
			{
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				departmentId: " ",
				unexpected: true,
			} as never,
			context,
		),
	];

	for (const call of invalidCalls) {
		await expect(call).rejects.toMatchObject({
			name: "ProviderRequestError",
			responseInvalid: false,
		});
	}
	// 日期和筛选标识是 Provider 请求语义的一部分；任何畸形输入都必须
	// 在本地结束，不能让上游按默认日期或默认科室解释它。
	expect(providerCalls).toBe(0);
});

test("众阳排班以 usableSourceNum 为真实号源字段并拒绝重复排班号", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{
						hisScheduleId: "schedule-duplicate",
						deptId: "dept-001",
						deptName: "心内科",
						docId: "doctor-001",
						docName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						totalNum: 10,
						remainingNumber: 1,
						usableNum: 2,
						usableSourceNum: 3,
					},
					{
						hisScheduleId: "schedule-duplicate",
						deptId: "dept-001",
						deptName: "心内科",
						docId: "doctor-001",
						docName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						totalNum: 10,
						remainingNumber: 1,
						usableNum: 2,
						usableSourceNum: 3,
					},
				]),
				{ status: 200, headers: { "x-request-id": "duplicate-schedule" } },
			),
	});

	await expect(
		gateway.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-schedules",
		requestId: "duplicate-schedule",
		retryable: false,
	});
});

test("众阳排班缺少 usableSourceNum 时不使用旧号源别名兜底", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{
						hisScheduleId: "schedule-legacy-source-field",
						deptId: "dept-001",
						deptName: "心内科",
						docId: "doctor-001",
						docName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						totalNum: 10,
						usableNum: 3,
						remainingNumber: 3,
					},
				]),
				{ status: 200, headers: { "x-request-id": "missing-usable-source" } },
			),
	});

	await expect(
		gateway.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-schedules",
		requestId: "missing-usable-source",
		retryable: false,
	});
});

test("众阳预约目录拒绝无法形成安全读模型的响应", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({ success: false, message: "provider error" }),
				{
					status: 200,
					headers: { "x-request-id": "provider-request-003" },
				},
			),
	});

	await expect(
		gateway.listDepartments(
			{ startDate: "2026-08-15", endDate: "2026-08-22" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "appointment-departments",
		requestId: "provider-request-003",
		retryable: false,
		responseInvalid: false,
	});
});

test("众阳预约记录拒绝 HTTP 200 下的业务失败空列表", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					code: "5000",
					message: "provider rejected",
					data: [],
				}),
				{ status: 200, headers: { "x-request-id": "record-business-failure" } },
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-001",
				query: { startDate: "2026-08-20", endDate: "2026-08-21" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-records",
		requestId: "record-business-failure",
		retryable: false,
		responseInvalid: false,
	});
});

test("众阳预约记录不会把错误类型的 success 字段误判为业务拒绝", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: "false",
					code: "5000",
					data: [],
				}),
				{ status: 200, headers: { "x-request-id": "record-invalid-success" } },
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-001",
				query: { startDate: "2026-08-20", endDate: "2026-08-21" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-records",
		requestId: "record-invalid-success",
		responseInvalid: true,
	});
});

test("众阳预约记录接受已确认的旧 code=0000 空结果", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(JSON.stringify({ code: "0000", data: [] }), {
				status: 200,
				headers: { "x-request-id": "record-code-0000" },
			}),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-001",
				query: { startDate: "2026-08-20", endDate: "2026-08-21" },
			},
			context,
		),
	).resolves.toMatchObject({ records: [] });
});

test("众阳预约 adapter 拒绝不存在的日历日期", async () => {
	const scheduleGateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{
						hisScheduleId: "schedule-invalid-date",
						deptId: "dept-001",
						deptName: "心内科",
						docId: "doctor-001",
						docName: "李医生",
						workDate: "2026-02-30",
						shiftName: "上午",
						totalNum: 10,
						remainingNumber: 5,
					},
				]),
				{ status: 200, headers: { "x-request-id": "invalid-date-schedule" } },
			),
	});

	await expect(
		scheduleGateway.listSchedules(
			{ startDate: "2026-02-20", endDate: "2026-02-21" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-schedules",
	});

	const recordsGateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							workDate: "2026-02-30",
							status: 0,
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "invalid-date-record" } },
			),
	});

	await expect(
		recordsGateway.listRecords(
			{
				providerPatientId: "provider-patient-001",
				query: { startDate: "2026-02-20", endDate: "2026-02-21" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-records",
		responseInvalid: true,
	});
});

test("众阳预约记录只固定微信查询参数并移除患者和支付字段", async () => {
	let requestUrl = "";
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrl = String(input);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							appointmentInfoId: "provider-record-001",
							patId: "provider-patient-001",
							patName: "张三",
							telephone: "13800000000",
							deptName: "心内科",
							deptAddr: "门诊楼二层",
							docName: "李医生",
							workDate: "2026-08-20",
							workTime: "08:00",
							serialNumber: 12,
							status: 0,
							registFree: 99,
							isPay: "0",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "provider-record-request" } },
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-001",
			query: { startDate: "2026-08-01", endDate: "2026-08-31" },
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-appointment-server/v1/appointment-infos/provider-patient-001?requestChannel=3&startDate=2026-08-01&endDate=2026-08-31&isMzFlag=1&dateFlag=1",
	);
	expect(result.records).toEqual([
		{
			departmentName: "心内科",
			location: "门诊楼二层",
			doctorName: "李医生",
			workDate: "2026-08-20",
			workTime: "08:00",
			serialNumber: "12",
			status: "scheduled",
		},
	]);
	expect(JSON.stringify(result)).not.toContain("provider-record-001");
	expect(JSON.stringify(result)).not.toContain("provider-patient-001");
	expect(JSON.stringify(result)).not.toContain("13800000000");
	expect(JSON.stringify(result)).not.toContain("registFree");
});

test("众阳全部预约记录使用渠道 4 且不附带日期窗口", async () => {
	let requestUrl = "";
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrl = String(input);
			return new Response(
				JSON.stringify({
					success: true,
					data: [{ workDate: "2026-01-05", status: 1 }],
				}),
				{ status: 200, headers: { "x-request-id": "all-record-request" } },
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-001",
			query: { scope: "all" },
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-appointment-server/v1/appointment-infos/provider-patient-001?requestChannel=4&isMzFlag=1&dateFlag=1",
	);
	expect(result.records).toEqual([
		{ workDate: "2026-01-05", status: "cancelled" },
	]);
});

test("众阳预约记录 adapter 在触网前拒绝未知范围和混合日期", async () => {
	let providerCalls = 0;
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			providerCalls += 1;
			return new Response(JSON.stringify({ success: true, data: [] }), {
				status: 200,
			});
		},
	});

	const cases = [
		{ scope: "provider-4" },
		{ scope: "all", startDate: "2026-08-01" },
		{ scope: "online", startDate: "2026-08-31", endDate: "2026-08-01" },
	] as const;

	for (const query of cases) {
		await expect(
			gateway.listRecords(
				{
					providerPatientId: "provider-patient-001",
					query: query as never,
				},
				context,
			),
		).rejects.toBeInstanceOf(ProviderRequestError);
	}
	// 任何不明确的范围都必须在 Provider 请求之前失败，不能依赖上游返回错误。
	expect(providerCalls).toBe(0);
});

test("众阳预约记录从 group 时间段归一化 workTime，不透传原始日期时间", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							workDate: "2026-08-20",
							groupStart: "2026-08-20 08:00:00",
							groupEnd: "2026-08-20 12:00:00",
							status: 0,
						},
						{
							workDate: "2026-08-20",
							workTime: "09:30",
							groupStart: "invalid-time",
							groupEnd: "2026-08-20 10:00:00",
							status: 0,
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "record-time-range" } },
			),
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-001",
			query: { startDate: "2026-08-20", endDate: "2026-08-21" },
		},
		context,
	);

	expect(result.records[0]).toMatchObject({
		workDate: "2026-08-20",
		workTime: "08:00-12:00",
		status: "scheduled",
	});
	expect(result.records[1]).toMatchObject({ workTime: "09:30" });
	expect(JSON.stringify(result)).not.toContain("groupStart");
	expect(JSON.stringify(result)).not.toContain("2026-08-20 08:00:00");
});

test("众阳预约记录保留已确认的停诊、替诊和已登记状态", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{ workDate: "2026-08-20", status: 5 },
						{ workDate: "2026-08-21", status: "6" },
						{ workDate: "2026-08-22", status: 7 },
					],
				}),
				{ status: 200, headers: { "x-request-id": "known-record-statuses" } },
			),
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-001",
			query: { startDate: "2026-08-20", endDate: "2026-08-22" },
		},
		context,
	);

	expect(result.records.map((record) => record.status)).toEqual([
		"stopped",
		"substituted",
		"registered",
	]);
});

test("众阳预约记录拒绝重复的 provider 预约号", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							appointmentInfoId: "appointment-duplicate",
							workDate: "2026-08-20",
							status: 0,
						},
						{
							appointmentInfoId: "appointment-duplicate",
							workDate: "2026-08-21",
							status: 3,
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "duplicate-record" } },
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-001",
				query: { startDate: "2026-08-20", endDate: "2026-08-21" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-records",
		requestId: "duplicate-record",
		retryable: false,
	});
});

test("众阳预约 adapter 拒绝带控制字符的展示文本", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{
						deptId: "dept-control",
						deptName: "心\n内科",
					},
				]),
				{ status: 200, headers: { "x-request-id": "control-department" } },
			),
	});

	await expect(
		gateway.listDepartments(
			{ startDate: "2026-08-20", endDate: "2026-08-27" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-departments",
		requestId: "control-department",
		retryable: false,
		responseInvalid: true,
	});
});

test("众阳预约科室 adapter 拒绝重复的科室主键", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{ deptId: "dept-duplicate", deptName: "心内科" },
					{ deptId: "dept-duplicate", deptName: "心内科（重复）" },
				]),
				{ status: 200, headers: { "x-request-id": "duplicate-department" } },
			),
	});

	await expect(
		gateway.listDepartments(
			{ startDate: "2026-08-20", endDate: "2026-08-27" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-departments",
		requestId: "duplicate-department",
		retryable: false,
	});
});

test("众阳预约目录超过资源上限时在字段映射前整批拒绝", async () => {
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			const data = Array.from(
				{ length: MAX_APPOINTMENT_SCHEDULE_ITEMS + 1 },
				(_, index) => ({
					hisScheduleId: `schedule-too-many-${index}`,
					deptId: "dept-001",
					deptName: "心内科",
					docId: "doctor-001",
					docName: "李医生",
					workDate: "2026-08-20",
					shiftName: "上午",
					totalNum: 30,
					usableSourceNum: 12,
				}),
			);
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "x-request-id": "schedule-too-many" },
			});
		},
	});

	await expect(
		gateway.listSchedules(
			{
				startDate: "2026-08-20",
				endDate: "2026-08-21",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "appointment-schedules",
		requestId: "schedule-too-many",
		responseInvalid: true,
	});
});
