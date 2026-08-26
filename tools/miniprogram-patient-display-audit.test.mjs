import { describe, expect, test } from "bun:test";
import {
	auditMiniprogramPatientDisplay,
	auditPatientDisplaySource,
} from "./miniprogram-patient-display-audit.mjs";

describe("小程序患者可见字段审计", () => {
	test("当前页面不把内部患者 ID 直接渲染给用户", async () => {
		const result = await auditMiniprogramPatientDisplay();

		expect(result.passed).toBe(true);
		expect(result.findings).toEqual([]);
	});

	test("WXML 和 TypeScript 的明显 ID 展示拼接会被发现", () => {
		const templateTick = String.fromCharCode(96);
		expect(
			auditPatientDisplaySource(
				"<text>就诊ID：{{selectedPatient.id}}</text>",
				"apps/miniprogram/src/pages/example/example.wxml",
			),
		).toEqual([
			{
				file: "apps/miniprogram/src/pages/example/example.wxml",
				line: 1,
				rule: "wxml-labelled-patient-id",
			},
			{
				file: "apps/miniprogram/src/pages/example/example.wxml",
				line: 1,
				rule: "wxml-direct-patient-id",
			},
		]);

		expect(
			auditPatientDisplaySource(
				`const label = ${templateTick}ID：\${patient.id}${templateTick};`,
				"apps/miniprogram/src/pages/example/example.ts",
			),
		).toEqual([
			{
				file: "apps/miniprogram/src/pages/example/example.ts",
				line: 1,
				rule: "typescript-labelled-patient-id",
			},
		]);
	});
});
