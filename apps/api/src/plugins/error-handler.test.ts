import { expect, test } from "bun:test";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "./error-handler";

test("persistence connection failures return a safe 503 contract", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new PersistenceUnavailableError("read");
	});

	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "persistence-temporarily-unavailable",
			message: "数据服务暂时不可用，请稍后重试",
		},
	});
});
