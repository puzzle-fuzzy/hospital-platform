import { expect, test } from "bun:test";
import { MAX_PATIENT_DIRECTORY_ITEMS } from "@hospital/domain";
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

test("众阳关系缺失与明确其他必须保持不同语义", async () => {
	let archiveRequestCount = 0;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				archiveRequestCount += 1;
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patId: `his-patient-relationship-${archiveRequestCount}`,
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "relationship-archive-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "relationship-unknown-001",
							patientName: "关系缺失患者",
							medicalCardNo: "card-unknown-001",
							relation: null,
						},
						{
							thirdPatientId: "relationship-other-001",
							patientName: "明确其他患者",
							medicalCardNo: "card-other-001",
							relation: "其他",
						},
						{
							thirdPatientId: "relationship-other-en-001",
							patientName: "英文其他患者",
							medicalCardNo: "card-other-en-001",
							relation: "other",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "relationship-list-001" } },
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-relationship-001" },
		context,
	);

	expect(result.patients.map((patient) => patient.relationship)).toEqual([
		"unknown",
		"other",
		"other",
	]);
});

test("众阳患者目录超过资源上限时整批拒绝且不发起档案查询", async () => {
	let archiveRequestCount = 0;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				archiveRequestCount += 1;
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: Array.from(
						{ length: MAX_PATIENT_DIRECTORY_ITEMS + 1 },
						(_, index) => ({
							thirdPatientId: `directory-too-large-${index}`,
							patientName: `合成患者${index}`,
							medicalCardNo: `card-${index}`,
						}),
					),
				}),
				{ status: 200, headers: { "x-request-id": "directory-too-large-001" } },
			);
		},
	});

	await expect(
		gateway.listByIdentity(
			{ unionId: "union-directory-too-large-001" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		responseInvalid: true,
	});
	expect(archiveRequestCount).toBe(0);
});

test("众阳患者档案查询保持目录顺序且不超过固定并发度", async () => {
	let activeArchiveRequests = 0;
	let maximumArchiveRequests = 0;
	const requestedArchiveNames: string[] = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = new URL(String(input));
			if (requestUrl.pathname.endsWith("patInfosFind")) {
				activeArchiveRequests += 1;
				maximumArchiveRequests = Math.max(
					maximumArchiveRequests,
					activeArchiveRequests,
				);
				const name = requestUrl.searchParams.get("patName") ?? "";
				requestedArchiveNames.push(name);
				await new Promise((resolve) => setTimeout(resolve, 5));
				activeArchiveRequests -= 1;
				return new Response(
					JSON.stringify({
						success: true,
						data: { patName: name, patId: `his-${name}` },
					}),
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: Array.from({ length: 8 }, (_, index) => ({
						thirdPatientId: `directory-concurrency-${index}`,
						patientName: `患者${index}`,
						medicalCardNo: `card-${index}`,
					})),
				}),
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-directory-concurrency-001" },
		context,
	);

	expect(maximumArchiveRequests).toBe(4);
	expect(requestedArchiveNames).toEqual(
		Array.from({ length: 8 }, (_, index) => `患者${index}`),
	);
	expect(result.patients.map((patient) => patient.displayName)).toEqual(
		Array.from({ length: 8 }, (_, index) => `患者${index}`),
	);
});

test("众阳患者目录拒绝 JSON 数字卡号，避免查询卡号丢失前导零", async () => {
	let archiveRequested = false;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) archiveRequested = true;
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-card-number-001",
							patientName: "合成测试患者",
							// JSON 数字无法保留医院卡号可能存在的前导零。
							medicalCardNo: 987654321001,
						},
					],
				}),
				{ status: 200 },
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-card-number-001" }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(archiveRequested).toBe(false);
});

test("patInfosFind 返回数字卡号时拒绝写入 HIS 映射", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "合成测试患者",
							// 返回数字会让带前导零的原卡号无法恢复。
							cardNo: 987654321001,
							patId: "his-card-number-001",
						},
					}),
					{ status: 200 },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-card-number-002",
							patientName: "合成测试患者",
							medicalCardNo: "000000000000001",
						},
					],
				}),
				{ status: 200 },
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-card-number-002" }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
});

test("patInfosFind 使用 GET 查询参数和服务端授权，不发送 GET 请求体", async () => {
	const requests: Array<{
		url: string;
		method: string;
		authorization: string | null;
		contentType: string | null;
		body: BodyInit | null | undefined;
	}> = [];
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "provider-server-token",
		fetcher: async (input, init) => {
			const requestUrl = String(input);
			const headers = new Headers(init?.headers);
			requests.push({
				url: requestUrl,
				method: init?.method ?? "GET",
				authorization: headers.get("authorization"),
				contentType: headers.get("content-type"),
				body: init?.body,
			});
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							cardNo: "archive-card-001",
							patId: "his-archive-001",
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-http-shape-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-http-shape-001",
							patientName: "张三",
							medicalCardNo: "archive-card-001",
							relation: "本人",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-http-shape-001" },
				},
			);
		},
	});

	await gateway.listByIdentity({ unionId: "union-http-shape-001" }, context);

	const archiveRequest = requests.find((request) =>
		request.url.includes("patInfosFind"),
	);
	expect(archiveRequest).toMatchObject({
		method: "GET",
		authorization: "Bearer provider-server-token",
		contentType: null,
		body: undefined,
	});
	if (!archiveRequest) throw new Error("archive request was not captured");
	const archiveUrl = new URL(archiveRequest.url);
	// 旧端虽然曾把 JSON body 挂在 GET 上，新端必须使用 Provider 实际读取的
	// 查询参数；这样代理、缓存和服务端框架不会因为 GET body 被丢弃而改变患者。
	expect(archiveUrl.pathname).toBe(
		"/msun-middle-aggregate-patient/v1/patInfosFind",
	);
	expect(Object.fromEntries(archiveUrl.searchParams)).toEqual({
		type: "3",
		cardNo: "archive-card-001",
		patName: "张三",
	});
});

test("众阳档案响应保留 19 位字符串 patId 并丢弃额外身份字段", async () => {
	const hisPatientId = "9000000000000000001";
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						code: "0000",
						message: "成功",
						data: {
							patName: "合成测试患者",
							patId: hisPatientId,
							idCardNo: "000000199001010000",
							phone: "00011122233",
							invalidFlag: "0",
							deadLockFlag: "0",
							hospitalId: "10389001",
							orgId: "10389",
							patCardVOList: [
								{
									patCardNo: "777777777777777",
									cardStatus: "0",
									cardStatusName: "正常",
								},
							],
						},
					}),
					{ status: 200, headers: { "x-request-id": "archive-full-001" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-full-001",
							patientName: "合成测试患者",
							medicalCardNo: "777777777777777",
							relation: "本人",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "directory-full-001" } },
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-full-001" },
		context,
	);

	expect(result.patients[0]?.providerReferences).toEqual({
		"his-patient": hisPatientId,
	});
	const serialized = JSON.stringify(result);
	expect(serialized).not.toContain("000000199001010000");
	expect(serialized).not.toContain("00011122233");
	expect(serialized).not.toContain("777777777777777");
});

test("众阳档案响应的姓名或卡号与查询对象不一致时拒绝绑定", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "另一位患者",
							cardNo: "other-card",
							patId: "his-patient-wrong-person",
						},
					}),
					{ status: 200, headers: { "x-request-id": "archive-mismatch-001" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-mismatch-001",
							patientName: "张三",
							medicalCardNo: "requested-card-001",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "directory-mismatch-001" } },
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-mismatch-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-mismatch-001",
		responseInvalid: true,
	});
});

test("众阳档案卡片列表存在时必须包含本次查询卡号", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							patId: "his-patient-wrong-card",
							patCardVOList: [{ patCardNo: "different-card-001" }],
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-card-mismatch-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-card-mismatch-001",
							patientName: "张三",
							medicalCardNo: "requested-card-002",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-card-mismatch-001" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-card-mismatch-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-card-mismatch-001",
		responseInvalid: true,
	});
});

test("众阳档案返回空卡片列表时拒绝绑定临床 patId", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							patId: "his-patient-empty-card-list",
							// 即使顶层卡号看起来匹配，显式空卡片列表也不能证明
							// 本次查询卡号属于该档案。
							cardNo: "requested-card-empty-list-001",
							patCardVOList: [],
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-empty-card-list-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-empty-card-list-001",
							patientName: "张三",
							medicalCardNo: "requested-card-empty-list-001",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-empty-card-list-001" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-empty-card-list-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-empty-card-list-001",
		responseInvalid: true,
	});
});

test("众阳档案卡片列表不能被顶层卡号的并集结果绕过", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							patId: "his-patient-card-list-authority-001",
							// 旧实现会把这个顶层卡号与列表卡号合并，
							// 从而错误放行；卡片数组必须独立包含查询卡号。
							cardNo: "requested-card-list-authority-001",
							patCardVOList: [{ patCardNo: "different-card-002" }],
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-card-list-authority-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-card-list-authority-001",
							patientName: "张三",
							medicalCardNo: "requested-card-list-authority-001",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-card-list-authority-001" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity(
			{ unionId: "union-card-list-authority-001" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-card-list-authority-001",
		responseInvalid: true,
	});
});

test("众阳档案卡片列表没有可比较卡号时拒绝绑定临床 patId", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							patId: "his-patient-card-list-without-number-001",
							cardNo: "requested-card-without-number-001",
							patCardVOList: [{ cardStatus: "0" }],
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-card-list-without-number-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-card-list-without-number-001",
							patientName: "张三",
							medicalCardNo: "requested-card-without-number-001",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-card-list-without-number-001" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity(
			{ unionId: "union-card-list-without-number-001" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-card-list-without-number-001",
		responseInvalid: true,
	});
});

test("众阳档案卡片的患者引用与顶层 patId 不一致时拒绝绑定", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			if (String(input).includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: {
							patName: "张三",
							patId: "his-patient-card-owner-001",
							patCardVOList: [
								{
									patId: "his-patient-other-owner-001",
									patCardNo: "requested-card-003",
								},
							],
						},
					}),
					{
						status: 200,
						headers: { "x-request-id": "archive-card-owner-mismatch-001" },
					},
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-card-owner-001",
							patientName: "张三",
							medicalCardNo: "requested-card-003",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "directory-card-owner-mismatch-001" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity(
			{ unionId: "union-card-owner-mismatch-001" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-card-owner-mismatch-001",
		responseInvalid: true,
	});
});

test("众阳档案响应拒绝数字 patId，避免放宽临床引用 contract", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						// 即使数字没有超出安全整数，也不能把错误的 Provider
						// schema 转换成有效的临床档案引用。
						data: { patId: 12345678 },
					}),
					{ status: 200, headers: { "x-request-id": "archive-unsafe-001" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "directory-patient-unsafe-001",
							patientName: "测试患者",
							medicalCardNo: "card-unsafe-001",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "directory-unsafe-001" } },
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-unsafe-001" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		requestId: "archive-unsafe-001",
		responseInvalid: true,
	});
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

test("众阳患者目录对 15 位卡号保留前五位和后四位", async () => {
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: { patId: "his-patient-015" },
					}),
					{ status: 200, headers: { "x-request-id": "archive-request-015" } },
				);
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: "1003",
							patientName: "王五",
							medicalCardNo: "123456789012345",
							relation: "本人",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "zhongyang-request-015" },
				},
			);
		},
	});

	const result = await gateway.listByIdentity(
		{ unionId: "union-015" },
		context,
	);

	// 这是展示边界测试，不使用真实患者卡号；前五位必须保留，后四位也必须保留。
	expect(result.patients[0]?.cardNumberMasked).toBe("12345******2345");
	expect(JSON.stringify(result)).not.toContain("123456789012345");
});

test("众阳患者目录拒绝超长卡号而不是伪装成未绑定", async () => {
	let archiveCalls = 0;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("patInfosFind")) {
				archiveCalls += 1;
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: requestUrl.includes("patInfosFind")
						? { patId: "his-patient-overlong-card" }
						: [
								{
									thirdPatientId: "1004",
									patientName: "超长卡号患者",
									medicalCardNo: "1".repeat(65),
									relation: "本人",
								},
							],
				}),
				{
					status: 200,
					headers: { "x-request-id": "zhongyang-request-overlong-card" },
				},
			);
		},
	});

	await expect(
		gateway.listByIdentity({ unionId: "union-overlong-card" }, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "patient-archive",
		responseInvalid: true,
	});
	// 卡号在目录字段映射阶段就应被拒绝，不能先带着异常卡号调用 patInfosFind。
	expect(archiveCalls).toBe(0);
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
