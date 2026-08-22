import { expect, test } from "bun:test";
import { parseProfileAgeInput } from "./profile-form";

test("个人资料年龄解析只接受空值或 0 到 150 的十进制整数", () => {
	expect(parseProfileAgeInput("")).toEqual({ kind: "empty", value: null });
	expect(parseProfileAgeInput("  ")).toEqual({ kind: "empty", value: null });
	expect(parseProfileAgeInput("0")).toEqual({ kind: "valid", value: 0 });
	expect(parseProfileAgeInput("032")).toEqual({ kind: "valid", value: 32 });
	expect(parseProfileAgeInput("150")).toEqual({ kind: "valid", value: 150 });

	for (const value of ["-1", "1.5", "1e2", "abc", "151", "999999"]) {
		expect(parseProfileAgeInput(value)).toEqual({
			kind: "invalid",
			value: null,
		});
	}
});

test("年龄解析不会把非字符串事件值伪装成合法年龄", () => {
	expect(parseProfileAgeInput(32)).toEqual({ kind: "invalid", value: null });
	expect(parseProfileAgeInput(null)).toEqual({ kind: "invalid", value: null });
});
