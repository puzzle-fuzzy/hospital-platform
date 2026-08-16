import { expect, test } from "bun:test";
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
	});
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
