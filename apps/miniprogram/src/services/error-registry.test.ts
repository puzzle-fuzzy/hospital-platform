import { describe, expect, test } from "bun:test";
import { ApiError } from "./api-client";
import { errorMessageWithCode, presentClientError } from "./error-presentation";
import {
	CLIENT_ERROR_NUMERIC_CODES,
	CLIENT_ERROR_SURFACE_COPY,
	CLIENT_NUMERIC_CODE_RANGE,
	resolveErrorNumericCode,
	SERVER_ERROR_NUMERIC_CODES,
	UNKNOWN_NUMERIC_CODE,
} from "./error-registry";

describe("错误数字码注册表", () => {
	test("服务端与客户端两张表的数字码全局唯一，无段位冲突", () => {
		const seen = new Map<number, string>();
		for (const [table, label] of [
			[SERVER_ERROR_NUMERIC_CODES, "server"],
			[CLIENT_ERROR_NUMERIC_CODES, "client"],
		] as const) {
			for (const [code, numeric] of Object.entries(table)) {
				const existing = seen.get(numeric);
				if (existing !== undefined) {
					throw new Error(
						`numeric ${numeric} duplicated: ${existing} / ${label}:${code}`,
					);
				}
				seen.set(numeric, `${label}:${code}`);
			}
		}
		expect(seen.size).toBe(
			Object.keys(SERVER_ERROR_NUMERIC_CODES).length +
				Object.keys(CLIENT_ERROR_NUMERIC_CODES).length,
		);
	});

	test("客户端本地码全部落在 80xxx 保留段", () => {
		for (const numeric of Object.values(CLIENT_ERROR_NUMERIC_CODES)) {
			expect(numeric).toBeGreaterThanOrEqual(CLIENT_NUMERIC_CODE_RANGE.min);
			expect(numeric).toBeLessThan(CLIENT_NUMERIC_CODE_RANGE.maxExclusive);
		}
	});

	test("服务端镜像不使用 80xxx 段", () => {
		for (const numeric of Object.values(SERVER_ERROR_NUMERIC_CODES)) {
			const inClientRange =
				numeric >= CLIENT_NUMERIC_CODE_RANGE.min &&
				numeric < CLIENT_NUMERIC_CODE_RANGE.maxExclusive;
			expect(inClientRange).toBe(false);
		}
	});

	test("解析规则：已知码命中，未知或空码回落 unknown", () => {
		expect(resolveErrorNumericCode("unauthorized")).toBe(10200);
		expect(resolveErrorNumericCode("patient-sync-stale")).toBe(20300);
		expect(resolveErrorNumericCode("network-failed")).toBe(80100);
		expect(resolveErrorNumericCode("totally-new-code")).toBe(
			UNKNOWN_NUMERIC_CODE,
		);
		expect(resolveErrorNumericCode(undefined)).toBe(UNKNOWN_NUMERIC_CODE);
		expect(resolveErrorNumericCode("")).toBe(UNKNOWN_NUMERIC_CODE);
	});

	test("每个 surface 都有标题和非空兜底文案", () => {
		for (const [surface, copy] of Object.entries(CLIENT_ERROR_SURFACE_COPY)) {
			expect(copy.title.length).toBeGreaterThan(0);
			expect(copy.defaultMessage.length).toBeGreaterThan(0);
			expect(surface.length).toBeGreaterThan(0);
		}
	});
});

describe("错误展示组合层", () => {
	test("errorMessageWithCode 在既有文案后追加数字码", () => {
		const error = new ApiError("挂号记录暂时无法获取", {
			code: "provider-temporarily-unavailable",
			numericCode: 10810,
		});
		expect(
			errorMessageWithCode(error, "挂号记录暂时无法获取，请稍后重试"),
		).toBe("挂号记录暂时无法获取，请稍后重试（错误码 10810）");
	});

	test("响应缺少 numericCode 时按镜像表回退", () => {
		const error = new ApiError("登录已过期", { code: "unauthorized" });
		expect(error.numericCode).toBe(10200);
		expect(errorMessageWithCode(error, "登录已过期，请重新登录")).toBe(
			"登录已过期，请重新登录（错误码 10200）",
		);
	});

	test("非 ApiError 的意外异常回落 unknown 数字码", () => {
		expect(
			errorMessageWithCode(new TypeError("x"), "读取失败，请稍后重试"),
		).toBe("读取失败，请稍后重试（错误码 10900）");
	});

	test("presentClientError 输出标题、原因与错误码的组合", () => {
		const presented = presentClientError(
			new ApiError("外部服务暂时不可用", {
				code: "provider-temporarily-unavailable",
			}),
			"appointment-records",
		);
		expect(presented.title).toBe("挂号记录");
		expect(presented.numeric).toBe(10810);
		expect(presented.code).toBe("provider-temporarily-unavailable");
		expect(presented.displayText).toContain("（错误码 10810）");
		expect(presented.displayText).toContain(presented.message);
	});

	test("surface 级原因覆盖优先于通用映射", () => {
		const presented = presentClientError(
			new ApiError("该服务暂未配置完成", {
				code: "dependency-not-configured",
			}),
			"knowledge",
		);
		expect(presented.message).toBe("健康内容正在完善中，暂时无法使用");
		expect(presented.numeric).toBe(10500);
	});

	test("无专用映射的 surface 使用兜底文案与 contextual 映射", () => {
		const presented = presentClientError(
			new ApiError("暂时无法查询", { code: "appointment-query-invalid" }),
			"appointment-schedule",
		);
		// contextualApiErrorMessage 对该码返回 CLIENT_ERROR_MESSAGES 的注册文案。
		expect(presented.message.length).toBeGreaterThan(0);
		expect(
			presented.displayText.endsWith(`（错误码 ${presented.numeric}）`),
		).toBe(true);
	});
});
