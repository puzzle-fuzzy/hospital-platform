import { expect, test } from "bun:test";
import { createZhongyangPatientBindingGateway } from "./zhongyang-patient-binding";

const context = {
	traceId: "patient-binding-trace-001",
	idempotencyKey: "patient-binding-key-001",
};

function response(body: unknown, requestId: string): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "x-request-id": requestId },
	});
}

test("众阳患者绑定已存在档案时只查档并绑卡", async () => {
	const calls: Array<{ url: string; method: string; body?: unknown }> = [];
	const gateway = createZhongyangPatientBindingGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			calls.push({
				url: String(input),
				method: String(init?.method),
				...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
			});
			return calls.length === 1
				? response(
						{ success: true, data: { patId: "his-patient-001" } },
						"archive-001",
					)
				: response({ success: true, data: {} }, "bind-001");
		},
	});

	await expect(
		gateway.bind(
			{
				displayName: "张三",
				mobile: "13812345678",
				identityNumber: "11010519491231002X",
				birthDate: "1949-12-31",
				sex: "2",
			},
			context,
		),
	).resolves.toMatchObject({
		created: false,
		trace: {
			provider: "zhongyang",
			operation: "patient-binding",
			requestId: "bind-001",
		},
	});
	expect(calls).toHaveLength(2);
	expect(calls[0]?.url).toContain("type=2");
	expect(calls[0]?.url).toContain("idCardNo=11010519491231002X");
	expect(calls[1]?.body).toEqual({
		patId: "his-patient-001",
		cardNo: "11010519491231002X",
	});
});

test("众阳患者绑定仅在明确无档案时建档再绑卡", async () => {
	const bodies: unknown[] = [];
	const gateway = createZhongyangPatientBindingGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (_input, init) => {
			if (init?.body) bodies.push(JSON.parse(String(init.body)));
			if (bodies.length === 0) {
				return response({ success: true, data: null }, "archive-002");
			}
			if (bodies.length === 1) {
				return response(
					{ success: true, data: { patId: "his-patient-002" } },
					"create-002",
				);
			}
			return response({ success: true, data: {} }, "bind-002");
		},
	});

	await expect(
		gateway.bind(
			{
				displayName: "李四",
				mobile: "13912345678",
				identityNumber: "11010519900101007X",
				birthDate: "1990-01-01",
				sex: "1",
			},
			context,
		),
	).resolves.toMatchObject({ created: true });
	expect(bodies[0]).toEqual({
		patName: "李四",
		phone: "13912345678",
		idCardNo: "11010519900101007X",
		idCardType: "0",
		birthday: "1990-01-01 00:00:00",
		sex: "1",
		cardNo: "11010519900101007X",
		cardType: "3",
	});
	expect(bodies[1]).toEqual({
		patId: "his-patient-002",
		cardNo: "11010519900101007X",
	});
});
