import { expect, test } from "bun:test";
import { createZhongyangPatientBindingGateway } from "./zhongyang-patient-binding";

const context = {
	traceId: "patient-binding-trace-001",
	idempotencyKey: "patient-binding-key-001",
};

const syntheticPatient = {
	displayName: "合成患者",
	mobile: "13000000000",
	identityNumber: "000000000000000000",
	birthDate: "2000-01-01",
	sex: "1",
} as const;

function response(body: unknown, requestId: string): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "x-request-id": requestId },
	});
}

function gatewayWithPatientId(branch: "archive" | "create", patId: unknown) {
	const calls: Array<{ url: string; bodyText: string | undefined }> = [];
	const gateway = createZhongyangPatientBindingGateway({
		baseUrl: "https://zhongyang.example.test",
		orgId: 10756,
		hospitalId: 10389001,
		cardTypeId: 3,
		fetcher: async (input, init) => {
			const url = String(input);
			calls.push({
				url,
				bodyText: init?.body === undefined ? undefined : String(init.body),
			});
			if (url.includes("/patInfosFind")) {
				return response(
					{
						success: true,
						data:
							branch === "archive" ? { patId, cardNo: "SYNTHETIC-CARD" } : null,
					},
					"archive-synthetic",
				);
			}
			if (url.endsWith("/patients")) {
				return response(
					{
						success: true,
						code: "0000",
						data: { patId, cardNo: "SYNTHETIC-CARD" },
					},
					"create-synthetic",
				);
			}
			return response({ success: true, data: {} }, "bind-synthetic");
		},
	});
	return { gateway, calls };
}

for (const branch of ["archive", "create"] as const) {
	test.each([
		"9007199254740993",
		"1234567890123456789",
		"9223372036854775807",
		"0000000000000000001",
		Number.MAX_SAFE_INTEGER,
	])(`众阳患者绑定 ${branch} 保留精确 patId %s`, async (patId) => {
		const { gateway, calls } = gatewayWithPatientId(branch, patId);
		await expect(
			gateway.bind(syntheticPatient, context),
		).resolves.toMatchObject({
			created: branch === "create",
			providerPatientId: String(patId),
		});
		expect(calls).toHaveLength(branch === "create" ? 3 : 2);
		expect(calls.at(-1)?.url).toEndWith("/patCards");
		expect(calls.at(-1)?.bodyText).toBe(
			JSON.stringify({ patId, cardNo: "SYNTHETIC-CARD" }),
		);
	});

	test(`众阳患者绑定 ${branch} 只修剪编号两侧普通空格`, async () => {
		const { gateway, calls } = gatewayWithPatientId(
			branch,
			" 9007199254740993 ",
		);
		await expect(
			gateway.bind(syntheticPatient, context),
		).resolves.toMatchObject({
			providerPatientId: "9007199254740993",
		});
		expect(calls.at(-1)?.bodyText).toBe(
			'{"patId":"9007199254740993","cardNo":"SYNTHETIC-CARD"}',
		);
	});

	test.each([
		{ label: "unsafe number", patId: Number.MAX_SAFE_INTEGER + 1 },
		{ label: "rounded Long number", patId: Number("9223372036854775807") },
		{ label: "zero number", patId: 0 },
		{ label: "negative number", patId: -1 },
		{ label: "fraction number", patId: 1.5 },
		{ label: "empty string", patId: "" },
		{ label: "all zero digits", patId: "000" },
		{ label: "negative string", patId: "-1" },
		{ label: "positive sign", patId: "+1" },
		{ label: "exponent", patId: "1e3" },
		{ label: "fraction string", patId: "1.5" },
		{ label: "hexadecimal", patId: "0x10" },
		{ label: "Long overflow", patId: "9223372036854775808" },
		{ label: "overlong digits", patId: "1".repeat(100_000) },
		{ label: "control prefix", patId: "\u00001001" },
		{ label: "control whitespace", patId: "\t1001\n" },
		{ label: "null", patId: null },
		{ label: "missing", patId: undefined },
		{ label: "boolean", patId: true },
	])(
		`众阳患者绑定 ${branch} 拒绝非法或已丢精度编号 $label`,
		async ({ patId }) => {
			const { gateway, calls } = gatewayWithPatientId(branch, patId);
			await expect(
				gateway.bind(syntheticPatient, context),
			).rejects.toMatchObject({
				name: "ProviderRequestError",
				requestId: `${branch}-synthetic`,
				responseInvalid: true,
				retryable: false,
			});
			expect(calls).toHaveLength(branch === "create" ? 2 : 1);
			expect(calls.some(({ url }) => url.endsWith("/patCards"))).toBe(false);
		},
	);
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
	expect(calls[0]?.headers?.get("idempotency-key")).toBe(
		context.idempotencyKey,
	);
	expect(calls[1]?.body).toEqual({
		patId: "1001",
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
