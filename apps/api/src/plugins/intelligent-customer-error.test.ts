import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import {
	IntelligentCustomerConversationExpiredError,
	IntelligentCustomerInputError,
} from "../modules/intelligent-customer";
import { IntelligentCustomerRateLimitError } from "../modules/intelligent-customer/rate-limit";
import { errorHandlerPlugin } from "./error-handler";

test("客服错误统一映射为稳定错误码", async () => {
	const cases = [
		{
			error: new IntelligentCustomerInputError(),
			status: 400,
			code: "intelligent-customer-invalid",
			numericCode: 60420,
		},
		{
			error: new IntelligentCustomerConversationExpiredError(),
			status: 409,
			code: "intelligent-customer-conversation-expired",
			numericCode: 60430,
		},
	];

	for (const item of cases) {
		const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
			throw item.error;
		});
		const response = await app.handle(new Request("http://localhost/probe"));
		expect(response.status).toBe(item.status);
		expect(await response.json()).toMatchObject({
			success: false,
			error: { code: item.code, numericCode: item.numericCode },
		});
	}
});

test("客服限流错误返回 429 和 Retry-After", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new IntelligentCustomerRateLimitError(7);
	});
	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(429);
	expect(response.headers.get("retry-after")).toBe("7");
	expect(await response.json()).toMatchObject({
		success: false,
		error: {
			code: "intelligent-customer-rate-limited",
			numericCode: 60440,
		},
	});
});
