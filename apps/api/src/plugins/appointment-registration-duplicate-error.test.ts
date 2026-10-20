import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "./error-handler";
import { safeErrorMetadata } from "./request-logging";

function duplicateError(
	overrides: Partial<
		ConstructorParameters<typeof ProviderRequestError>[0]
	> = {},
) {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-registration-create",
		message: "Duplicate appointment rejected",
		requestId: "duplicate-registration-request",
		reason: "appointment-registration-duplicate",
		providerErrorCode: "smcAppointment@1217",
		providerErrorMessage: "患者姓名和token=private必须不进入响应或日志",
		requestOutcome: "rejected",
		retryable: false,
		responseInvalid: false,
		failureStage: "response",
		...overrides,
	});
}

async function responseFor(error: ProviderRequestError) {
	const app = new Elysia().use(errorHandlerPlugin()).post("/probe", () => {
		throw error;
	});
	return app.handle(new Request("http://localhost/probe", { method: "POST" }));
}

test("明确的重复预约拒绝返回固定 409/30475，日志分类一致且不泄漏医院原文", async () => {
	const error = duplicateError();
	const response = await responseFor(error);
	expect(response.status).toBe(409);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "appointment-registration-duplicate",
			numericCode: 30475,
			message: "您当天已预约该医生，请先查看并处理原预约",
		},
	});
	const metadata = safeErrorMetadata(error, "UNKNOWN");
	expect(metadata).toMatchObject({
		errorCode: "appointment-registration-duplicate",
		providerFailureReason: "appointment-registration-duplicate",
		providerOperation: "appointment-registration-create",
		providerErrorCode: "smcAppointment@1217",
		providerRequestOutcome: "rejected",
	});
	expect(JSON.stringify(metadata)).not.toContain("token=private");
	expect(JSON.stringify(metadata)).not.toContain("患者姓名");
});

test("重复预约映射必须满足完整 Provider 操作错误码和明确拒绝边界", async () => {
	for (const overrides of [
		{ provider: "wechat-pay" as const },
		{ operation: "appointment-cancellation" },
		{ providerErrorCode: "1217" },
		{ providerErrorCode: "smcAppointment@12170" },
		{ requestOutcome: "unknown" as const },
		{ requestOutcome: "not_sent" as const },
		{ responseInvalid: true },
		{ retryable: true },
	]) {
		const error = duplicateError(overrides);
		const response = await responseFor(error);
		const body = await response.json();
		expect(body.error.code).not.toBe("appointment-registration-duplicate");
		expect(safeErrorMetadata(error, "UNKNOWN").errorCode).toBe(body.error.code);
		expect(safeErrorMetadata(error, "UNKNOWN")).not.toHaveProperty(
			"providerFailureReason",
		);
		expect(JSON.stringify(body)).not.toContain("token=private");
	}
});
