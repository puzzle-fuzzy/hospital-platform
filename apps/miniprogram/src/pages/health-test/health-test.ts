import {
	calculateBmi,
	recordBloodPressure,
} from "../../services/health-safe-calculators";

type HealthTestMode = "bmi" | "blood-pressure";

type AssessmentItem = {
	key: string;
	name: string;
	available: boolean;
	icon: string;
};

type InterpretationItem = {
	name: string;
	content: string;
	icon: string;
};

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
	showTips: boolean;
	tipsTitle: string;
	tipsContent: string;
	assessmentItems: ReadonlyArray<AssessmentItem>;
	interpretationItems: ReadonlyArray<InterpretationItem>;
};

type HealthTestPageMethods = {
	onAssessmentTap(event: WechatMiniprogram.TouchEvent): void;
	onInterpretationTap(event: WechatMiniprogram.TouchEvent): void;
	onModeTap(event: WechatMiniprogram.TouchEvent): void;
	onInput(event: WechatMiniprogram.Input): void;
	onCalculateBmi(): void;
	onRecordBloodPressure(): void;
	onCloseTips(): void;
	onBackHome(): void;
};

const ASSESSMENT_ITEMS: ReadonlyArray<AssessmentItem> = Object.freeze([
	{ key: "artery", name: "动脉血管", available: false, icon: "动" },
	{ key: "diabetes", name: "2型糖尿病", available: false, icon: "糖" },
	{ key: "heart", name: "心脏功能", available: false, icon: "心" },
	{ key: "lung", name: "肺功能", available: false, icon: "肺" },
	{ key: "mental-age", name: "心理年龄", available: false, icon: "龄" },
	{ key: "dementia", name: "老年痴呆", available: false, icon: "脑" },
	{ key: "mental-stress", name: "心理压力", available: false, icon: "压" },
	{ key: "bmi", name: "肥胖指数", available: true, icon: "肥" },
	{ key: "blood-pressure", name: "血压指数", available: true, icon: "压" },
]);

const INTERPRETATION_ITEMS: ReadonlyArray<InterpretationItem> = Object.freeze([
	{
		name: "体温",
		icon: "温",
		content:
			"正常体温约37℃，日体温变化通常小于1℃。异常情况请结合症状及时就医。",
	},
	{
		name: "脉搏",
		icon: "脉",
		content:
			"成人静息脉搏通常每分钟60至100次，持续异常或伴随不适时请咨询医生。",
	},
	{
		name: "呼吸",
		icon: "呼",
		content:
			"正常成年人静息呼吸通常每分钟16至20次，呼吸困难或明显异常请及时就医。",
	},
	{
		name: "血压",
		icon: "压",
		content:
			"血压会受时间、情绪和测量方式影响。本提示仅作健康知识参考，不替代医生诊断。",
	},
	{
		name: "体重",
		icon: "重",
		content: "体重应结合身高、年龄和近期变化观察。短期明显波动建议咨询医生。",
	},
	{
		name: "进食量",
		icon: "食",
		content:
			"进食量应结合平时习惯和身体状态观察，持续明显减少或增加请咨询医生。",
	},
	{
		name: "大便",
		icon: "便",
		content: "排便频率存在个体差异，持续腹泻、便秘或伴随出血应及时就医。",
	},
	{
		name: "小便",
		icon: "尿",
		content:
			"尿量和颜色会受饮水、用药等影响，持续明显异常或伴随疼痛应及时就医。",
	},
	{
		name: "睡眠",
		icon: "眠",
		content:
			"规律作息有助于健康。长期失眠、嗜睡或影响日常生活时请寻求专业帮助。",
	},
	{
		name: "月经周期",
		icon: "经",
		content:
			"月经周期存在个体差异，持续明显改变、疼痛或异常出血请咨询妇科医生。",
	},
]);

function parseNumber(value: string): number {
	return Number(value.trim());
}

function resolveMode(value?: string): HealthTestMode {
	return value === "blood-pressure" ? "blood-pressure" : "bmi";
}

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
		showTips: false,
		tipsTitle: "健康贴士",
		tipsContent: "",
		assessmentItems: ASSESSMENT_ITEMS,
		interpretationItems: INTERPRETATION_ITEMS,
	},

	onLoad(options: Record<string, string | undefined>) {
		this.setData({ mode: resolveMode(options?.mode) });
		wx.setNavigationBarTitle({ title: "健康自测" });
	},

	onAssessmentTap(event) {
		const key = String(event.currentTarget.dataset.key ?? "");
		const item = ASSESSMENT_ITEMS.find((candidate) => candidate.key === key);
		if (!item) return;
		if (!item.available) {
			wx.navigateTo({
				url: `/pages/self-test-question/self-test-question?type=${item.key}`,
			});
			return;
		}
		this.setData({ mode: resolveMode(key), message: "" });
	},

	onInterpretationTap(event) {
		const name = String(event.currentTarget.dataset.name ?? "");
		const item = INTERPRETATION_ITEMS.find(
			(candidate) => candidate.name === name,
		);
		if (!item) return;
		this.setData({
			showTips: true,
			tipsTitle: `${item.name}健康贴士`,
			tipsContent: item.content,
		});
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
		if (!["height", "weight", "systolic", "diastolic"].includes(field)) return;
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

	onCloseTips() {
		this.setData({ showTips: false });
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
