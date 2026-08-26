/**
 * 健康自测中可以在客户端安全完成的“数值计算”边界。
 *
 * BMI 只做公式计算，血压只做输入校验和数值记录；这里故意不输出
 * “正常/异常”、风险等级、疾病建议或分诊结论。临床分级必须由经审核的
 * 规则版本和正式 contract 提供，不能把旧端写死的阈值直接搬到新端。
 */

/** BMI 身高输入的工程校验范围，不代表任何临床适用人群范围。 */
export const BMI_HEIGHT_LIMITS = Object.freeze({ min: 50, max: 250 });

/** BMI 体重输入的工程校验范围，不代表任何临床适用人群范围。 */
export const BMI_WEIGHT_LIMITS = Object.freeze({ min: 10, max: 300 });

/** 血压输入的工程校验范围，只用于防止明显错误的录入。 */
export const BLOOD_PRESSURE_LIMITS = Object.freeze({
	systolic: { min: 50, max: 300 },
	diastolic: { min: 30, max: 200 },
});

/**
 * 本地数值工具的固定规则版本。
 *
 * 这个版本只标识输入范围、公式和格式化方式，不代表临床指南版本；
 * 未来如果调整工程校验或展示规则，必须升级它并同步回归测试，避免
 * 真机或问题日志里出现“同一个结果却无法确认规则来源”的情况。
 */
export const HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION =
	"local-non-diagnostic-v1" as const;

export type BmiCalculation = Readonly<{
	ruleSetVersion: typeof HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION;
	heightCm: number;
	weightKg: number;
	bmi: number;
	display: string;
}>;

export type BloodPressureReading = Readonly<{
	ruleSetVersion: typeof HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION;
	systolic: number;
	diastolic: number;
	display: string;
}>;

function isFiniteNumber(value: number): boolean {
	return Number.isFinite(value);
}

function isInRange(
	value: number,
	limits: { min: number; max: number },
): boolean {
	return value >= limits.min && value <= limits.max;
}

/**
 * 计算 BMI 数值。
 *
 * 返回值只包含公式结果，不附带人群分类。调用方如果需要临床解释，
 * 必须等待审核后的规则 bundle，不能在页面上自行补一个阈值表。
 */
export function calculateBmi(
	heightCm: number,
	weightKg: number,
): BmiCalculation | null {
	if (
		!isFiniteNumber(heightCm) ||
		!isFiniteNumber(weightKg) ||
		!isInRange(heightCm, BMI_HEIGHT_LIMITS) ||
		!isInRange(weightKg, BMI_WEIGHT_LIMITS)
	) {
		return null;
	}

	const heightM = heightCm / 100;
	const bmi = weightKg / (heightM * heightM);
	if (!isFiniteNumber(bmi)) return null;

	return Object.freeze({
		ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
		heightCm,
		weightKg,
		bmi,
		display: bmi.toFixed(1),
	});
}

/**
 * 校验并格式化一次血压读数。
 *
 * 收缩压必须高于舒张压只是输入一致性校验，不代表本函数在判断血压
 * 是否正常；临床判断、连续测量和就医建议都不属于这个本地工具的职责。
 */
export function recordBloodPressure(
	systolic: number,
	diastolic: number,
): BloodPressureReading | null {
	if (
		!isFiniteNumber(systolic) ||
		!isFiniteNumber(diastolic) ||
		!isInRange(systolic, BLOOD_PRESSURE_LIMITS.systolic) ||
		!isInRange(diastolic, BLOOD_PRESSURE_LIMITS.diastolic) ||
		systolic <= diastolic
	) {
		return null;
	}

	return Object.freeze({
		ruleSetVersion: HEALTH_SAFE_CALCULATOR_RULE_SET_VERSION,
		systolic,
		diastolic,
		display: `${systolic}/${diastolic} mmHg`,
	});
}
