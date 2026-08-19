import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import { createZhongyangPatientGateway } from "./zhongyang-patients";

const context = {
	traceId: "zhongyang-patient-trace-001",
	idempotencyKey: "zhongyang-patient-key-001",
};

test("众阳患者目录只返回白名单字段并脱敏卡号", async () => {
	const requestUrls: string[] = [];
	let requestHeaders: Headers | undefined;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input, init) => {
			const requestUrl = String(input);
			requestUrls.push(requestUrl);
			requestHeaders = new Headers(init?.headers);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: { patId: "his-patient-001" },
					}),
					{ status: 200, headers: { "x-request-id": "archive-request-001" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: 1001,
							patientName: "张三",
							cardNo: "card-no-ignored",
							medicalCardNo: "1234567890",
							relation: "本人",
							mobile: "13800000000",
							idCardNo: "sensitive-id-card",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "zhongyang-request-001" } },
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-001" },
		context,
	);

	expect(requestUrls).toEqual([
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
		"https://zhongyang.example.test/msun-middle-aggregate-patient/v1/patInfosFind?type=3&cardNo=1234567890&patName=%E5%BC%A0%E4%B8%89",
	]);
	expect(requestHeaders?.get("x-request-id")).toBe(context.traceId);
	expect(requestHeaders?.get("idempotency-key")).toBe(context.idempotencyKey);
	expect(result).toEqual({
		complete: true,
		patients: [
			{
				providerPatientId: "1001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "12345*7890",
				providerReferences: { "his-patient": "his-patient-001" },
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "patient-list",
			requestId: "zhongyang-request-001",
		},
	});
	const serialized = JSON.stringify(result);
	expect(serialized).not.toContain("1234567890");
	expect(serialized).not.toContain("sensitive-id-card");
	expect(serialized).not.toContain("13800000000");
});

test("众阳患者目录对 18 位卡号保留前五位和后四位", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: { patId: "his-patient-018" },
					}),
					{ status: 200, headers: { "x-request-id": "archive-request-018" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "1002",
							patientName: "李四",
							medicalCardNo: "123456789012345678",
							relation: "本人",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "zhongyang-request-018" } },
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-018" },
		context,
	);

	// 18 位卡号仍只暴露最小可核对信息，防止把完整医疗卡号返回给小程序。
	expect(result.patients[0]?.cardNumberMasked).toBe("12345*********5678");
	expect(JSON.stringify(result)).not.toContain("123456789012345678");
});

test("众阳患者目录拒绝业务失败响应", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({ success: false, message: "provider failure" }),
				{
					status: 200,
					headers: { "x-request-id": "zhongyang-request-002" },
				},
			),
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "zhongyang-request-002",
		retryable: false,
	});
});

test("众阳档案请求失败时只保留状态和请求号，不泄露查询参数或原始响应", async () => {
	const card = "fixture-archive-card-secret";
	const name = "fixture-archive-name-secret";
	const requestUrls: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			requestUrls.push(requestUrl);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(JSON.stringify({ message: `${card}:${name}` }), {
					status: 502,
					headers: { "x-request-id": "archive-http-failed" },
				});
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-archive-failure",
							patientName: name,
							medicalCardNo: card,
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "patient-list-ok" } },
			);
		},
	});

	const failure = await gateway
		.listByIdentity({ unionId: "union-archive-failure" }, context)
		.catch((error: unknown) => error);

	expect(failure).toBeInstanceOf(ProviderRequestError);
	expect(failure).toMatchObject({
		operation: "patient-archive",
		requestId: "archive-http-failed",
		statusCode: 502,
		retryable: true,
	});
	expect(String(failure)).not.toContain(card);
	expect(String(failure)).not.toContain(name);
	expect(JSON.stringify(failure)).not.toContain(card);
	expect(JSON.stringify(failure)).not.toContain(name);
	// 只有 Provider 边界允许构造查询 URL；该 URL 不得再被错误对象或日志复制。
	expect(requestUrls[1]).toContain("patInfosFind");
});

test("众阳患者目录和档案包络缺少明确 success=true 时拒绝空映射", async () => {
	const listGateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { "x-request-id": "patient-missing-success" },
			}),
	});

	await expect(
		listGateway.listByIdentity({ unionId: "union-envelope" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-list",
		requestId: "patient-missing-success",
		retryable: false,
		responseInvalid: true,
	});

	const archiveGateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						data: { patId: "patient-archive-missing-success" },
					}),
					{
						status: 200,
						headers: { "x-request-id": "patient-archive-missing-success" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "patient-envelope",
							patientName: "张三",
							medicalCardNo: "card-envelope",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "patient-list-ok" } },
			);
		},
	});

	await expect(
		archiveGateway.listByIdentity({ unionId: "union-envelope" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "patient-archive-missing-success",
		retryable: false,
		responseInvalid: true,
	});
});

test("众阳患者目录拒绝重复 provider 患者号且不继续查询档案", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			requestUrls.push(requestUrl);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "patient-duplicate",
							patientName: "张三",
							medicalCardNo: "card-001",
						},
						{
							thirdPatientId: "patient-duplicate",
							patientName: "李四",
							medicalCardNo: "card-002",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "duplicate-patient-request" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "duplicate-patient-request",
		retryable: false,
	});
	expect(requestUrls).toEqual([
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
	]);
});

test("众阳患者目录拒绝重复 HIS 患者引用", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			requestUrls.push(requestUrl);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: { patId: "his-patient-duplicate" },
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-request-duplicate" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-001",
							patientName: "张三",
							medicalCardNo: "",
							cardNo: "fallback-card-001",
						},
						{
							thirdPatientId: "directory-patient-002",
							patientName: "李四",
							medicalCardNo: "card-002",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "duplicate-his-request" } },
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "duplicate-his-request",
		retryable: false,
	});
	// 空的 medicalCardNo 必须允许旧端约定的 cardNo 兜底；本用例同时确认
	// 该目录在映射冲突时不会进入成功响应或持久化层。
	expect(requestUrls).toHaveLength(3);
});

test("众阳患者目录缺少服务端身份时不会调用 provider", async () => {
	let called = false;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			called = true;
			return new Response("[]");
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "" }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(called).toBe(false);
});

test("众阳患者目录拒绝带控制字符的 unionId", async () => {
	let called = false;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			called = true;
			return new Response("[]");
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-\u0000-001" }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
	// unionId 会进入目录查询 URL；在构造 URL 前拒绝，避免把编码后的脏身份
	// 交给 Provider，且不产生看似成功的空目录。
	expect(called).toBe(false);
});

test("众阳患者目录拒绝控制字符并且不继续查询档案", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrls.push(String(input));
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-valid",
							patientName: "张三",
							medicalCardNo: "card-valid",
						},
						{
							thirdPatientId: "directory-patient-control",
							patientName: "李\n四",
							medicalCardNo: "card-control",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "control-character-request" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "control-character-request",
		retryable: false,
	});
	// 目录字段在 adapter 边界即被拒绝；不能继续调用档案接口并把污染字段
	// 编码后写入 HIS 映射或后续日志关联。
	expect(requestUrls).toEqual([
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
	]);
});

test("众阳患者目录拒绝非法数组元素并且不继续查询档案", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrls.push(String(input));
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "patient-valid",
							patientName: "张三",
							medicalCardNo: "1234567890",
						},
						null,
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "invalid-item-request" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		provider: "zhongyang",
		operation: "patient-list",
		requestId: "invalid-item-request",
		retryable: false,
		responseInvalid: true,
	});
	// 非对象元素必须在第一条档案查询之前被拒绝，避免坏响应造成部分
	// Provider 查询和不完整的业务日志链路。
	expect(requestUrls).toEqual([
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
	]);
});
