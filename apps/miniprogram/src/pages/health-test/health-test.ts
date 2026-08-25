import {
	calculateBmi,
	recordBloodPressure,
} from "../../services/health-safe-calculators";

type HealthTestMode = "bmi" | "blood-pressure";

type HealthTestPageData = {
	mode: HealthTestMode;
	height: string;
	weight: string;
	systolic: string;
	diastolic: string;
	bmiDisplay: string;
	bloodPressureDisplay: string;
	message: string;
	hasBmiResult: boolean;
	hasBloodPressureResult: boolean;
};

type HealthTestPageMethods = {
	onModeTap(event: WechatMiniprogram.TouchEvent): void;
	onInput(event: WechatMiniprogram.Input): void;
	onCalculateBmi(): void;
	onRecordBloodPressure(): void;
	onOpenMigrationStatus(): void;
	onBackHome(): void;
};

function parseNumber(value: string): number {
	return Number(value.trim());
}

function resolveMode(value?: string): HealthTestMode {
	return value === "blood-pressure" ? "blood-pressure" : "bmi";
}

/**
 * 健康自测页面先落地“安全本地子集”：BMI 公式和血压读数校验。
 *
 * 页面不读取患者信息、不写入服务端，也不把本地结果保存成医疗记录；
 * 旧端题库、风险分级和临床建议仍由健康自测 contract 独立控制。
 */
Page<HealthTestPageData, HealthTestPageMethods>({
	data: {
		mode: "bmi",
		height: "",
		weight: "",
		systolic: "",
		diastolic: "",
		bmiDisplay: "",
		bloodPressureDisplay: "",
		message: "",
		hasBmiResult: false,
		hasBloodPressureResult: false,
	},

	onLoad(options: Record<string, string | undefined>) {
		this.setData({ mode: resolveMode(options?.mode) });
		wx.setNavigationBarTitle({ title: "健康自测" });
	},

	onModeTap(event) {
		const mode = resolveMode(String(event.currentTarget.dataset.mode ?? ""));
		this.setData({
			mode,
			message: "",
			hasBmiResult: false,
			hasBloodPressureResult: false,
		});
	},

	onInput(event) {
		const field = String(event.currentTarget.dataset.field ?? "");
		const value = String(event.detail.value ?? "");
		if (
			field !== "height" &&
			field !== "weight" &&
			field !== "systolic" &&
			field !== "diastolic"
		) {
			return;
		}
		this.setData({ [field]: value, message: "" });
	},

	onCalculateBmi() {
		const result = calculateBmi(
			parseNumber(this.data.height),
			parseNumber(this.data.weight),
		);
		if (!result) {
			this.setData({
				message: "请输入有效的身高和体重（身高 50–250 cm，体重 10–300 kg）",
				hasBmiResult: false,
			});
			return;
		}
		this.setData({
			bmiDisplay: result.display,
			message: "仅展示公式计算结果，不代表医学诊断或健康分级。",
			hasBmiResult: true,
		});
	},

	onRecordBloodPressure() {
		const result = recordBloodPressure(
			parseNumber(this.data.systolic),
			parseNumber(this.data.diastolic),
		);
		if (!result) {
			this.setData({
				message: "请输入有效的血压读数，并确保收缩压高于舒张压。",
				hasBloodPressureResult: false,
			});
			return;
		}
		this.setData({
			bloodPressureDisplay: result.display,
			message: "仅记录本次读数，不代表医学诊断或血压分级。",
			hasBloodPressureResult: true,
		});
	},

	onOpenMigrationStatus() {
		wx.navigateTo({
			url: "/pages/feature-status/feature-status?feature=health-test",
		});
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
