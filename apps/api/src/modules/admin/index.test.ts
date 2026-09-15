import { expect, test } from "bun:test";
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
