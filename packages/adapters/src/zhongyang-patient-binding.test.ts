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
	const calls: Array<{
		url: string;
		method: string;
		body?: unknown;
		headers?: Headers;
	}> = [];
	const gateway = createZhongyangPatientBindingGateway({
		baseUrl: "https://zhongyang.example.test",
		orgId: 10756,
		hospitalId: 10389001,
		cardTypeId: 3,
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			calls.push({
				url: String(input),
				method: String(init?.method),
				headers: new Headers(init?.headers),
				...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
			});
			return calls.length === 1
				? response(
						{ success: true, data: { patId: "1001", cardNo: "VISIT-001" } },
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
	expect(calls[0]?.headers?.get("org-id")).toBe("10756");
	expect(calls[0]?.headers?.get("authorization")).toBe("Bearer server-token");
	expect(calls[1]?.body).toEqual({
		patId: 1001,
		cardNo: "VISIT-001",
	});
});

test("众阳患者绑定仅在明确无档案时建档再绑卡", async () => {
	const bodies: unknown[] = [];
	const gateway = createZhongyangPatientBindingGateway({
		baseUrl: "https://zhongyang.example.test",
		orgId: 10756,
		hospitalId: 10389001,
		cardTypeId: 3,
		fetcher: async (_input, init) => {
			if (init?.body) bodies.push(JSON.parse(String(init.body)));
			if (bodies.length === 0) {
				return response({ success: true, data: null }, "archive-002");
			}
			if (bodies.length === 1) {
				return response(
					{ success: true, data: { patId: 1002, cardNo: "VISIT-002" } },
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
		idCardType: 0,
		birthday: "1990-01-01 00:00:00",
		sex: 1,
		cardType: 3,
		hospitalId: 10389001,
		orgId: 10756,
	});
	expect(bodies[1]).toEqual({
		patId: 1002,
		cardNo: "VISIT-002",
	});
});
