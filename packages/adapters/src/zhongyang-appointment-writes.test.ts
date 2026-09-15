import { expect, test } from "bun:test";
import {
	createZhongyangAppointmentPatientProfileGateway,
	createZhongyangAppointmentWriteGateway,
} from "./zhongyang-appointment-writes";

const context = {
	traceId: "appointment-write-trace-001",
	idempotencyKey: "appointment-write-key-001",
};

function jsonResponse(body: unknown, requestId: string): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			"content-type": "application/json",
			"x-request-id": requestId,
		},
	});
}

test("预约锁号保留 19 位 Provider ID，并对相等时间点不发送时间范围", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	let callCount = 0;
	const gateway = createZhongyangAppointmentWriteGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			calls.push({ url: String(input), init: init ?? {} });
			callCount += 1;
			if (callCount === 1) {
				return jsonResponse(
					[
						{
							sourceId: "9007199254740993123",
							serialNumber: 7,
							groupStart: "09:00",
							groupEnd: "09:00",
						},
					],
					"source-request-001",
				);
			}
			return jsonResponse(
				{ success: true, data: { sourceId: "9007199254740993123" } },
				"lock-request-001",
			);
		},
	});

	const result = await gateway.resolveSource(
		{
			providerScheduleId: "9007199254740993001",
			providerPatientId: "9007199254740993002",
			sourceSerialNumber: "7",
		},
		context,
	);

	const lockBody = JSON.parse(String(calls[1]?.init.body));
	expect(calls[0]?.url).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/sources/9007199254740993001?requestChannel=3",
	);
	expect(calls[1]?.url).toBe(
		"https://zhongyang.example.test/msun-middle-business-amc-server/v1/sources/locked-sources",
	);
	expect(lockBody).toEqual({
		requestChannel: "3",
		hisScheduleId: "9007199254740993001",
		sourceId: "9007199254740993123",
		patId: "9007199254740993002",
	});
	expect(lockBody).not.toHaveProperty("groupStart");
	expect(lockBody).not.toHaveProperty("groupEnd");
	expect(new Headers(calls[1]?.init.headers).get("authorization")).toBe(
		"Bearer server-token",
	);
	expect(new Headers(calls[1]?.init.headers).get("x-request-id")).toBe(
		context.traceId,
	);
	expect(result).toEqual({
		providerSourceId: "9007199254740993123",
		sourceSerialNumber: "7",
		trace: {
			provider: "zhongyang",
			operation: "appointment-source-resolve",
			requestId: "source-request-001",
			requestIds: ["source-request-001", "lock-request-001"],
		},
	});
});

test("预约创建映射服务端患者资料、非支付预约字段和大整数 Provider ID", async () => {
	let requestUrl = "";
	let requestBody: unknown;
	const gateway = createZhongyangAppointmentWriteGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestBody = JSON.parse(String(init?.body));
			return jsonResponse(
				{
					success: true,
					data: {
						appointmentInfoId: "9007199254740993999",
						hisRegisterId: "9007199254740994000",
					},
				},
				"create-request-001",
			);
		},
	});

	const result = await gateway.create(
		{
			patient: {
				providerPatientId: "9007199254740993002",
				name: "测试患者",
				cardNo: "CARD-001",
				idNo: "11010519900101007X",
				phone: "13800000000",
			},
			target: {
				scheduleId: "schedule-001",
				providerScheduleId: "9007199254740993001",
				departmentId: "department-001",
				departmentName: "测试科室",
				doctorId: "doctor-001",
				doctorName: "测试医生",
				providerSourceId: "9007199254740993123",
				workDate: "2026-09-16",
				shiftName: "上午",
				sourceSerialNumber: "7",
			},
			totalFen: 1234,
			recordId: "appointment-record-001",
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-appointment-server/v1/appointment-infos",
	);
	expect(requestBody).toEqual({
		patId: "9007199254740993002",
		patName: "测试患者",
		patCardNo: "CARD-001",
		idcardNo: "11010519900101007X",
		registrationFee: 12.34,
		workDate: "2026-09-16",
		telephone: "13800000000",
		hisScheduleId: "9007199254740993001",
		sourceId: "9007199254740993123",
		isPay: "0",
		requestChannel: "3",
		recordId: "appointment-record-001",
	});
	expect(result).toEqual({
		providerAppointmentId: "9007199254740993999",
		providerHisRegisterId: "9007199254740994000",
		trace: {
			provider: "zhongyang",
			operation: "appointment-registration-create",
			requestId: "create-request-001",
		},
	});
});

test("预约取消只向 Provider 发送服务端映射后的标识并返回关联号", async () => {
	let requestUrl = "";
	let requestBody: unknown;
	const gateway = createZhongyangAppointmentWriteGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestBody = JSON.parse(String(init?.body));
			return jsonResponse({ success: true }, "cancel-request-001");
		},
	});

	const result = await gateway.cancel(
		{
			providerPatientId: "9007199254740993002",
			providerAppointmentId: "9007199254740993999",
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-appointment-server/v1/appointment-infos/d",
	);
	expect(requestBody).toEqual({
		requestChannel: "3",
		appointmentInfoId: "9007199254740993999",
		patId: "9007199254740993002",
	});
	expect(result).toEqual({
		trace: {
			provider: "zhongyang",
			operation: "appointment-cancellation",
			requestId: "cancel-request-001",
		},
	});
});

test("预约患者资料先按 unionId 绑定再查档，并保留长患者号关联", async () => {
	const requestUrls: string[] = [];
	let callCount = 0;
	const gateway = createZhongyangAppointmentPatientProfileGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrls.push(String(input));
			callCount += 1;
			if (callCount === 1) {
				return jsonResponse(
					{
						success: true,
						data: [
							{
								thirdPatientId: "9007199254740993002",
								patientName: "测试患者",
								medicalCardNo: "CARD-001",
								mobile: "13800000000",
							},
						],
					},
					"binding-request-001",
				);
			}
			return jsonResponse(
				{
					success: true,
					data: {
						patId: "9007199254740993555",
						idCardNo: "11010519900101007X",
					},
				},
				"archive-request-001",
			);
		},
	});

	const result = await gateway.resolve(
		{
			unionId: "union-001",
			providerPatientId: "9007199254740993002",
		},
		context,
	);

	expect(requestUrls).toEqual([
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
		"https://zhongyang.example.test/msun-middle-aggregate-patient/v1/patInfosFind?type=3&cardNo=CARD-001&patName=%E6%B5%8B%E8%AF%95%E6%82%A3%E8%80%85",
	]);
	expect(result).toEqual({
		patient: {
			providerPatientId: "9007199254740993555",
			name: "测试患者",
			cardNo: "CARD-001",
			idNo: "11010519900101007X",
			phone: "13800000000",
		},
		trace: {
			provider: "zhongyang",
			operation: "appointment-patient-profile",
			requestId: "archive-request-001",
			requestIds: ["binding-request-001", "archive-request-001"],
		},
	});
});
