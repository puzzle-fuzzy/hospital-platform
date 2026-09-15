import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import { createZhongyangInpatientEpisodeGateway } from "./zhongyang-inpatient";

const context = {
	traceId: "inpatient-trace-001",
	idempotencyKey: "inpatient-key-001",
};

const providerEpisode = {
	patId: "provider-patient-001",
	patName: "张三",
	patInHosCode: "ZY-001",
	patCardNo: "A123456789",
	sexName: "男",
	patAge: "42岁",
	patInTime: "2026-08-28 09:30:00",
	patOutTime: null,
	inHosWayName: "急诊入院",
	patInStatus: 1,
	patInBedStatus: 1,
	patWardName: "一病区",
	patInWardName: "一病区",
	patClinicName: "心内科",
	bedShowNo: "01床",
	roomNo: "101",
	patInChargeDocName: "主治医生",
	attendingDocName: "李医生",
	durNurseName: "王护士",
	outDocName: "赵医生",
	inHosDiagnosisName: "胸痛",
	outHosDiagnosisName: null,
	nursingClassName: "一级护理",
	patCondition: "稳定",
	patDiagnosisInfos: [
		{ diagnosisName: "胸痛", mainDiagnoseFlag: "1" },
		{ diagnosisName: "高血压", mainDiagnoseFlag: "0" },
	],
	inPatBabyList: [
		{
			babyName: "张小三",
			babyInHosCode: "BABY-001",
			sexName: "女",
			birthDate: "2026-08-28",
			babyHeight: 48.5,
			babyWeight: 3.2,
		},
	],
	providerSecretField: "must-not-leak",
};

test("众阳住院接口按旧端路径查询 patId 并只返回脱敏公共模型", async () => {
	let requestUrl = "";
	let requestInit: RequestInit | undefined;
	const gateway = createZhongyangInpatientEpisodeGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestInit = init;
			return new Response(
				JSON.stringify({
					success: true,
					code: "0000",
					data: [providerEpisode],
				}),
				{
					status: 200,
					headers: { "x-request-id": "provider-inpatient-001" },
				},
			);
		},
	});

	const result = await gateway.listEpisodes(
		{ providerPatientId: "9007199254740993002" },
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-aggregate-hsz/v1/patients?patId=9007199254740993002",
	);
	expect(new Headers(requestInit?.headers).get("authorization")).toBe(
		"Bearer server-token",
	);
	expect(result).toEqual({
		episodes: [
			{
				patientName: "张三",
				inpatientNumber: "ZY-001",
				cardNumberMasked: "A1234*6789",
				sex: "男",
				age: "42岁",
				admittedAt: "2026-08-28 09:30:00",
				admissionType: "急诊入院",
				status: "inpatient",
				bedStatus: "in_bed",
				wardName: "一病区",
				admissionWardName: "一病区",
				departmentName: "心内科",
				bedNumber: "01床",
				roomNumber: "101",
				primaryDoctorName: "主治医生",
				attendingDoctorName: "李医生",
				responsibleNurseName: "王护士",
				outpatientDoctorName: "赵医生",
				admissionDiagnosis: "胸痛",
				diagnoses: [
					{ name: "胸痛", isPrimary: true },
					{ name: "高血压", isPrimary: false },
				],
				nursingLevel: "一级护理",
				condition: "稳定",
				babies: [
					{
						name: "张小三",
						inpatientNumber: "BABY-001",
						sex: "女",
						birthDate: "2026-08-28",
						heightCm: 48.5,
						weightKg: 3.2,
					},
				],
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "inpatient-episodes",
			requestId: "provider-inpatient-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("provider-patient-001");
	expect(JSON.stringify(result)).not.toContain("providerSecretField");
});

test("众阳住院接口不把业务拒绝伪装成空列表，并拒绝缺少患者号的请求", async () => {
	const createGateway = (payload: unknown) =>
		createZhongyangInpatientEpisodeGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "x-request-id": "provider-inpatient-002" },
				}),
		});

	await expect(
		createGateway({ success: true, code: "0000", data: [] }).listEpisodes(
			{ providerPatientId: "provider-patient-002" },
			context,
		),
	).resolves.toMatchObject({ episodes: [] });

	await expect(
		createGateway({
			success: false,
			code: "PATIENT_NOT_FOUND",
			data: [],
		}).listEpisodes({ providerPatientId: "provider-patient-002" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "inpatient-episodes",
		responseInvalid: false,
	});

	let fetchCalls = 0;
	const gateway = createZhongyangInpatientEpisodeGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			fetchCalls += 1;
			return new Response("[]", { status: 200 });
		},
	});
	await expect(
		gateway.listEpisodes({ providerPatientId: "" }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(fetchCalls).toBe(0);
});

test("众阳住院接口拒绝未知状态而不是猜成在院", async () => {
	const gateway = createZhongyangInpatientEpisodeGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [{ ...providerEpisode, patInStatus: 99 }],
				}),
				{
					status: 200,
					headers: { "x-request-id": "provider-inpatient-003" },
				},
			),
	});

	await expect(
		gateway.listEpisodes(
			{ providerPatientId: "provider-patient-003" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "inpatient-episodes",
		responseInvalid: true,
	});
});
