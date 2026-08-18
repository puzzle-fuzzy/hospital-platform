import { expect, test } from "bun:test";
import { shouldContinueAfterLogin } from "./patient-bootstrap";

test("患者范围页面只有同步成功且确认出患者后才能继续", () => {
	expect(shouldContinueAfterLogin("succeeded", true, true)).toBe(true);
	expect(shouldContinueAfterLogin("succeeded", true, false)).toBe(false);
	expect(shouldContinueAfterLogin("failed", true, true)).toBe(false);
	expect(shouldContinueAfterLogin("superseded", true, true)).toBe(false);
});

test("会自行读取患者目录的页面可以跳过首页同步", () => {
	expect(shouldContinueAfterLogin("skipped", false, false)).toBe(true);
	expect(shouldContinueAfterLogin("skipped", true, true)).toBe(false);
});
