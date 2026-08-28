import { describe, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { appointmentRecordsErrorMessage } from "./appointment-record-error";

describe("预约记录页面错误文案", () => {
	test("Provider 503 不暴露内部服务文案，也不误导为就诊人错误", () => {
		expect(
			appointmentRecordsErrorMessage(
				new ApiError("provider error", {
					code: "provider-temporarily-unavailable",
					statusCode: 503,
				}),
			),
		).toBe("挂号记录暂时无法获取，请稍后再试");
	});

	test("服务未配置时使用面向用户的业务提示", () => {
		expect(
			appointmentRecordsErrorMessage(
				new ApiError("not configured", {
					code: "dependency-not-configured",
				}),
			),
		).toBe("挂号记录服务暂时未开放，请稍后再试");
	});

	test("未知错误不展示内部异常原文", () => {
		expect(
			appointmentRecordsErrorMessage(
				new ApiError("secret provider stack", { code: "new-internal-code" }),
			),
		).toBe("挂号记录暂时无法获取，请稍后再试");
	});
});
