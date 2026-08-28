import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import { createZhongyangMedicalRecordGateway } from "./zhongyang-medical-records";

const context = {
	traceId: "medical-record-trace-001",
	idempotencyKey: "medical-record-key-001",
};

test("众阳门诊病历使用旧端 out-visit-records 请求契约并只返回摘要", async () => {
	let requestUrl = "";
	let requestInit: RequestInit | undefined;
	const gateway = createZhongyangMedicalRecordGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestInit = init;
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							regId: "provider-registration-001",
							patId: "provider-patient-001",
							visitDate: "2026-08-28 09:30:00",
							deptName: "心内科",
							doctorName: "李医生",
							diagnosis: "高血压",
							hospitalName: "门诊楼",
							clinicTypeName: "普通门诊",
							chargeClassName: "自费",
							idCardNo: "不应返回",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "provider-medical-record-001" },
				},
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-001",
			query: { startDate: "2026-07-29", endDate: "2026-08-28" },
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-aggregate-clinic/v1/out-visit-records",
	);
	const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
	expect(body).toEqual({
		startDate: "2026-07-29 00:00:00",
		endDate: "2026-08-28 23:59:59",
		type: "5",
		patId: "provider-patient-001",
	});
	expect(new Headers(requestInit?.headers).get("authorization")).toBe(
		"Bearer server-token",
	);
	expect(result).toEqual({
		records: [
			{
				visitTime: "2026-08-28 09:30:00",
				departmentName: "心内科",
				doctorName: "李医生",
				hospitalName: "门诊楼",
				clinicTypeName: "普通门诊",
				chargeClassName: "自费",
				diagnosis: "高血压",
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "outpatient-medical-records",
			requestId: "provider-medical-record-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("provider-registration-001");
});

test("众阳门诊病历接受 code=0000 空结果，但不把业务拒绝伪装成空列表", async () => {
	const createGateway = (payload: unknown) =>
		createZhongyangMedicalRecordGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "x-request-id": "provider-medical-record-002" },
				}),
		});
	const input = {
		providerPatientId: "provider-patient-002",
		query: { startDate: "2026-08-01", endDate: "2026-08-28" },
	};

	await expect(
		createGateway({ success: true, code: "0000", data: [] }).listRecords(
			input,
			context,
		),
	).resolves.toMatchObject({ records: [] });

	await expect(
		createGateway({
			success: false,
			code: "PATIENT_NOT_FOUND",
			data: [],
		}).listRecords(input, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		responseInvalid: false,
	});
});

test("众阳门诊病历请求参数不完整时不触网", async () => {
	let fetchCalls = 0;
	const gateway = createZhongyangMedicalRecordGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			fetchCalls += 1;
			return new Response("[]", { status: 200 });
		},
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "",
				query: { startDate: "2026-08-01", endDate: "2026-08-28" },
			},
			context,
		),
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(fetchCalls).toBe(0);
});
