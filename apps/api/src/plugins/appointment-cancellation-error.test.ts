import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "./error-handler";
import { safeErrorMetadata } from "./request-logging";

function cancellationError(
	message: string,
	overrides: Partial<
		ConstructorParameters<typeof ProviderRequestError>[0]
	> = {},
) {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-cancellation",
		message: "Appointment cancellation rejected",
		reason: "appointment-cancellation-rejected",
		providerErrorCode: "smcAppointment@2001",
		providerErrorMessage: message,
		retryable: false,
		responseInvalid: false,
		failureStage: "response",
		requestOutcome: "rejected",
		...overrides,
	});
}

async function responseFor(error: ProviderRequestError) {
	const app = new Elysia().use(errorHandlerPlugin()).post("/probe", () => {
		throw error;
	});
	return app.handle(new Request("http://localhost/probe", { method: "POST" }));
}

test("取消业务拒绝返回真实 HIS 原因，临近就诊明确引导门诊窗口", async () => {
	for (const message of [
		"临近就诊时间，不能取消预约，请去门诊窗口处理",
		"预约已完成就诊，不能取消，请到门诊窗口核实",
	]) {
		const error = cancellationError(message);
		const response = await responseFor(error);
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			success: false,
			error: {
				code: "appointment-cancellation-rejected",
				numericCode: 30485,
				message,
			},
		});
		const metadata = safeErrorMetadata(error, "UNKNOWN");
		expect(metadata.errorCode).toBe("appointment-cancellation-rejected");
		expect(JSON.stringify(metadata)).not.toContain(message);
	}
});

test("取消错误边界再次拒绝患者资料和内部异常，使用安全兜底", async () => {
	for (const message of [
		"预约取消失败，身份证11010519900101007X",
		"预约取消失败，SQL exception password=secret",
		"<script>预约取消失败</script>",
		"预约取消失败\n内部错误",
		"取消预约失败：Connection refused 10.0.0.1:5432",
		"取消预约失败：数据库连接错误",
		"取消预约失败，ECONNREFUSED",
	]) {
		const response = await responseFor(cancellationError(message));
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.error.message).toBe("预约取消失败，请联系医院核实原因");
		expect(JSON.stringify(body)).not.toContain(message);
	}
});

test("其它 Provider、其它操作和响应异常仍沿用通用错误契约", async () => {
	for (const overrides of [
		{ operation: "appointment-registration-create" },
		{ provider: "wechat-pay" as const },
		{ responseInvalid: true },
		{ retryable: true },
	]) {
		const error = cancellationError(
			"临近就诊时间，不能取消预约，请去门诊窗口处理",
			overrides,
		);
		const response = await responseFor(error);
		const body = await response.json();
		expect(body.error.code).not.toBe("appointment-cancellation-rejected");
		expect(safeErrorMetadata(error, "UNKNOWN").errorCode).toBe(body.error.code);
		expect(JSON.stringify(body)).not.toContain("临近就诊时间");
	}
});
