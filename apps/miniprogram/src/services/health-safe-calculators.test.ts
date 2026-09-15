import { describe, expect, test } from "bun:test";
import {
	calculateBmi,
	HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
	recordBloodPressure,
} from "./health-safe-calculators";

describe("健康自测安全数值工具", () => {
	test("BMI 只返回公式数值，不附带临床分级", () => {
		const result = calculateBmi(170, 68);

		expect(result).toEqual({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			heightCm: 170,
			weightKg: 68,
			bmi: 68 / 1.7 ** 2,
			display: "23.5",
		});
		expect(result).not.toHaveProperty("category");
		expect(result).not.toHaveProperty("risk");
	});

	test("BMI 拒绝明显不合理的输入", () => {
		expect(calculateBmi(0, 68)).toBeNull();
		expect(calculateBmi(170, 0)).toBeNull();
		expect(calculateBmi(20, 68)).toBeNull();
		expect(calculateBmi(170, 301)).toBeNull();
	});

	test("BMI 工程范围边界保持可复核的公式结果", () => {
		expect(calculateBmi(50, 10)).toMatchObject({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			bmi: 40,
			display: "40.0",
		});
		expect(calculateBmi(250, 300)).toMatchObject({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			bmi: 48,
			display: "48.0",
		});
	});

	test("血压只记录有效读数，不推断正常或异常", () => {
		const result = recordBloodPressure(120, 80);

		expect(result).toEqual({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			systolic: 120,
			diastolic: 80,
			display: "120/80 mmHg",
		});
		expect(result).not.toHaveProperty("status");
	});

	test("血压拒绝反向和越界读数", () => {
		expect(recordBloodPressure(80, 120)).toBeNull();
		expect(recordBloodPressure(49, 30)).toBeNull();
		expect(recordBloodPressure(301, 80)).toBeNull();
		expect(recordBloodPressure(120, 120)).toBeNull();
	});

	test("血压工程范围边界只返回读数和规则版本", () => {
		expect(recordBloodPressure(50, 30)).toMatchObject({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			display: "50/30 mmHg",
		});
		expect(recordBloodPressure(300, 200)).toMatchObject({
			ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
			display: "300/200 mmHg",
		});
	});
});
