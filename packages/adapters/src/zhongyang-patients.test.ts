import { expect, test } from "bun:test";
import { ProviderRequestError } from "./errors";
import { createZhongyangPatientGateway } from "./zhongyang-patients";

const context = {
	traceId: "zhongyang-patient-trace-001",
	idempotencyKey: "zhongyang-patient-key-001",
};

test("众阳患者目录只返回白名单字段并脱敏卡号", async () => {
	let requestUrl = "";
	let requestHeaders: Headers | undefined;
	const gateway = createZhongyangPatientGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestHeaders = new Headers(init?.headers);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							thirdPatientId: 1001,
							patientName: "张三",
							cardNo: "1234567890",
							medicalCardNo: "medical-should-not-win",
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

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/api/public/patientInfoByUnionId?unionId=union-001",
	);
	expect(requestHeaders?.get("x-request-id")).toBe(context.traceId);
	expect(requestHeaders?.get("idempotency-key")).toBe(context.idempotencyKey);
	expect(result).toEqual({
		patients: [
			{
				providerPatientId: "1001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "******7890",
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
