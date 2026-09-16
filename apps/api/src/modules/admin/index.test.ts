import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { adminInsuranceQueryModule } from "./index";

const service = {
	async query() {
		return { infcode: "0", baseinfo: {}, insuinfo: [] };
	},
};

const body = JSON.stringify({
	mode: "identity-card",
	identityNumber: "11010519900101007X",
	name: "测试人A",
});

test("Admin 查询令牌正确时返回新服务 1101 结果", async () => {
	const app = adminInsuranceQueryModule(service, "admin-query-token-001");
	const response = await app.handle(
		new Request("http://localhost/admin/insurance/1101", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-query-token": "admin-query-token-001",
			},
			body,
		}),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		success: true,
		data: { infcode: "0", baseinfo: {}, insuinfo: [] },
	});
});

test("Admin 查询令牌错误时拒绝请求", async () => {
	const app = new Elysia()
		.use(errorHandlerPlugin())
		.use(adminInsuranceQueryModule(service, "admin-query-token-001"));
	const response = await app.handle(
		new Request("http://localhost/admin/insurance/1101", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-query-token": "wrong-token",
			},
			body,
		}),
	);

	expect(response.status).toBe(401);
});

test("Admin 1101 上游拒绝时只返回可核验诊断，不回显医保原文", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminInsuranceQueryModule(
			{
				async query() {
					throw new ProviderRequestError({
						provider: "legacy-fsi",
						operation: "legacy-fsi.1101",
						message: "provider rejected",
						requestId: "provider-1101-拒绝",
						providerErrorCode: "-1",
						providerErrorMessage: "不应回显的医保原始错误",
						retryable: false,
						failureStage: "response",
						requestOutcome: "rejected",
					});
				},
			},
			"admin-query-token-001",
		),
	);
	const response = await app.handle(
		new Request("http://localhost/admin/insurance/1101", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-query-token": "admin-query-token-001",
			},
			body,
		}),
	);

	expect(response.status).toBe(502);
	const payload = (await response.json()) as {
		success: boolean;
		error?: { code?: string; numericCode?: number; message?: string };
	};
	expect(payload).toMatchObject({
		success: false,
		error: {
			code: "provider-request-rejected",
			numericCode: 10800,
		},
	});
	expect(payload.error?.message).toContain("医保错误码 -1");
	expect(payload.error?.message).toContain("请求号 provider-1101-");
	expect(payload.error?.message).not.toContain("不应回显的医保原始错误");
});
