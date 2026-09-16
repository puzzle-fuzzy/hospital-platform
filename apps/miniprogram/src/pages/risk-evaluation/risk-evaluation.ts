import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import type { Patient } from "../../types";

type RiskFormKey = "fall" | "pressure" | "pain";

type RiskOption = { value: string; label: string };
type RiskGroup = { key: string; title: string; multiple?: boolean; options: ReadonlyArray<RiskOption> };

type RiskPageData = {
	patient: Patient | null;
	loading: boolean;
	patientError: string;
	selectedForm: RiskFormKey | "";
	message: string;
	formItems: ReadonlyArray<{ key: RiskFormKey; title: string; subtitle: string }>;
	fallGroups: ReadonlyArray<RiskGroup>;
	pressureGroups: ReadonlyArray<RiskGroup>;
	painGroups: ReadonlyArray<RiskGroup>;
	selections: Record<string, string[]>;
};

type RiskPageMethods = {
	loadPatient(): Promise<void>;
	onChangePatient(): void;
	onFormTap(event: WechatMiniprogram.TouchEvent): void;
	onOptionTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBackHome(): void;
};

const FALL_GROUPS: ReadonlyArray<RiskGroup> = Object.freeze([
	{ key: "fall_history", title: "跌倒史", options: [{ value: "yes", label: "最近6个月曾有不明原因跌倒经历" }] },
	{ key: "excretion", title: "排泄", options: [
		{ value: "1", label: "失禁" },
		{ value: "2", label: "频繁或紧迫的排泄" },
		{ value: "3", label: "失禁且频繁和紧迫的排泄" },
	] },
	{ key: "drug", title: "是否有使用高风险跌倒的药物", options: [
		{ value: "1", label: "使用一种高跌倒风险的药物" },
		{ value: "2", label: "使用2种或2种以上的高跌倒风险药物" },
		{ value: "3", label: "过去24小时内曾有手术镇静史" },
	] },
	{ key: "catheter", title: "是否有与身体相连的导管携带", options: [
		{ value: "1", label: "携带1种导管" },
		{ value: "2", label: "携带2种导管" },
		{ value: "3", label: "携带3种或以上导管" },
	] },
	{ key: "activity", title: "活动能力（多选）", multiple: true, options: [
		{ value: "1", label: "移动、转运或行走时需要辅助或监管" },
		{ value: "2", label: "步态不稳定" },
		{ value: "3", label: "因视觉或听觉障碍而影响移动" },
	] },
	{ key: "cognition", title: "认知（多选）", multiple: true, options: [
		{ value: "1", label: "定向力障碍" },
		{ value: "2", label: "烦躁" },
		{ value: "3", label: "认知限制或障碍" },
	] },
]);

const PRESSURE_GROUPS: ReadonlyArray<RiskGroup> = Object.freeze([{
	key: "activity",
	title: "活动方式",
	options: [
		{ value: "1", label: "限制在床上" },
		{ value: "2", label: "行动能力严重受限或没有行走能力" },
		{ value: "3", label: "在帮助或无需帮助的情况下偶尔可以走一段路，每天大部分时间在床上或椅子上度过" },
		{ value: "4", label: "每天至少2次室外行走，白天醒着时至少每2小时行走一次" },
	],
}]);

const PAIN_GROUPS: ReadonlyArray<RiskGroup> = Object.freeze([{
	key: "pain_score",
	title: "请参考NRS疼痛评分标准选择您的疼痛程度（分数越高代表越痛）",
	options: Array.from({ length: 11 }, (_, index) => ({ value: String(index), label: String(index) })),
}]);

const FORM_ITEMS = Object.freeze([
	{ key: "fall" as const, title: "跌倒风险评估量表", subtitle: "评估跌倒相关风险因素" },
	{ key: "pressure" as const, title: "压力性损伤评估量表", subtitle: "评估活动方式相关风险" },
	{ key: "pain" as const, title: "疼痛评估量表", subtitle: "使用NRS 0—10分进行评估" },
]);

function emptySelections(): Record<string, string[]> {
	return Object.fromEntries([...FALL_GROUPS, ...PRESSURE_GROUPS, ...PAIN_GROUPS].map((group) => [group.key, []]));
}

Page<RiskPageData, RiskPageMethods>({
	data: {
		patient: null,
		loading: true,
		patientError: "",
		selectedForm: "",
		message: "",
		formItems: FORM_ITEMS,
		fallGroups: FALL_GROUPS,
		pressureGroups: PRESSURE_GROUPS,
		painGroups: PAIN_GROUPS,
		selections: emptySelections(),
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "风险评估" });
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, patientError: "" });
		return loadCurrentPatient()
			.then((patient) => this.setData({ patient, loading: false }))
			.catch(() => this.setData({ patient: null, loading: false, patientError: "请先选择就诊人" }));
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onFormTap(event) {
		const key = String(event.currentTarget.dataset.key ?? "") as RiskFormKey;
		if (!["fall", "pressure", "pain"].includes(key)) return;
		this.setData({ selectedForm: key, message: "" });
	},

	onOptionTap(event) {
		const groupKey = String(event.currentTarget.dataset.groupKey ?? "");
		const value = String(event.currentTarget.dataset.value ?? "");
		if (!groupKey || !value) return;
		const groups = [...this.data.fallGroups, ...this.data.pressureGroups, ...this.data.painGroups];
		const group = groups.find((candidate) => candidate.key === groupKey);
		if (!group) return;
		const selections = { ...this.data.selections };
		const current = [...(selections[groupKey] ?? [])];
		selections[groupKey] = group.multiple
			? current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
			: [value];
		this.setData({ selections, message: "" });
	},

	onSubmit() {
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		if (!this.data.selectedForm) {
			this.setData({ message: "请选择评估量表" });
			return;
		}
		const groups = this.data.selectedForm === "fall" ? this.data.fallGroups : this.data.selectedForm === "pressure" ? this.data.pressureGroups : this.data.painGroups;
		const incomplete = groups.find((group) => (this.data.selections[group.key] ?? []).length === 0);
		if (incomplete) {
			this.setData({ message: `请完成“${incomplete.title}”` });
			return;
		}
		this.setData({ message: "风险评估提交接口正在接入中，本次未提交。" });
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
