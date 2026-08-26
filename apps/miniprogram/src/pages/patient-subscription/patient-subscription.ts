import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToFeatureStatus } from "../../services/feature-navigation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import { patientScopedErrorMessage } from "../../services/patient-selection-service";
import type { DatasetEvent, Patient } from "../../types";
import {
	disposePageSessionResetListener,
	registerPageSessionResetListener,
} from "../../services/session-events";

type SubscriptionCategory =
	| "outpatient"
	| "inpatient"
	| "education"
	| "comprehensive";

type SubscriptionItem = {
	key: string;
	title: string;
	category: SubscriptionCategory;
	categoryName: string;
	enabled: false;
};

type SubscriptionSection = {
	key: SubscriptionCategory;
	title: string;
	expanded: boolean;
	visible: boolean;
	items: Array<SubscriptionItem>;
};

type SubscriptionPageData = {
	patient: Patient | null;
	loading: boolean;
	error: string;
	query: string;
	sections: Array<SubscriptionSection>;
	hasShown: boolean;
};

type SubscriptionPageMethods = {
	loadPatient(): Promise<void>;
	onSearch(event: { detail?: { value?: string } }): void;
	onToggleSection(event: DatasetEvent<{ sectionKey?: string }>): void;
	onOpenPatientSelector(): void;
	onOpenMigrationStatus(): void;
	onRetry(): void;
	onBackMy(): void;
	onUnload(): void;
};

const CATEGORY_TITLES: Readonly<Record<SubscriptionCategory, string>> = {
	outpatient: "门诊服务提醒",
	inpatient: "住院服务提醒",
	education: "宣教提醒",
	comprehensive: "综合服务提醒",
};

/**
 * 这些项目只来自旧页面的本地展示文案，不是已开通的微信模板。
 * `enabled` 固定为 false，避免把旧端内存默认值误显示成当前账号的授权事实。
 */
const SUBSCRIPTION_ITEMS: ReadonlyArray<SubscriptionItem> = [
	{
		key: "appointmentSuccess",
		title: "预约挂号成功提醒",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "appointmentCancel",
		title: "预约挂号取消提醒",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "preConsultation",
		title: "诊前提醒",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "nextDayExam",
		title: "次日检查检验项目提醒",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "hospitalSatisfaction",
		title: "门诊满意度调查",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "caregiverAppointment",
		title: "陪诊人员预约提醒",
		category: "outpatient",
		categoryName: CATEGORY_TITLES.outpatient,
		enabled: false,
	},
	{
		key: "hospitalization",
		title: "住院预约提醒",
		category: "inpatient",
		categoryName: CATEGORY_TITLES.inpatient,
		enabled: false,
	},
	{
		key: "education",
		title: "宣教提醒",
		category: "education",
		categoryName: CATEGORY_TITLES.education,
		enabled: false,
	},
	{
		key: "healthCheckIn",
		title: "健康打卡提醒",
		category: "comprehensive",
		categoryName: CATEGORY_TITLES.comprehensive,
		enabled: false,
	},
	{
		key: "wheelchairAppointment",
		title: "轮椅预约提醒",
		category: "comprehensive",
		categoryName: CATEGORY_TITLES.comprehensive,
		enabled: false,
	},
	{
		key: "invoiceReminder",
		title: "发票提醒",
		category: "comprehensive",
		categoryName: CATEGORY_TITLES.comprehensive,
		enabled: false,
	},
];

const DEFAULT_EXPANDED: Readonly<Record<SubscriptionCategory, boolean>> = {
	outpatient: true,
	inpatient: true,
	education: true,
	comprehensive: true,
};

function buildSections(
	query: string,
	expanded: Readonly<Record<SubscriptionCategory, boolean>> = DEFAULT_EXPANDED,
): Array<SubscriptionSection> {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	return (Object.keys(CATEGORY_TITLES) as Array<SubscriptionCategory>).map(
		(category) => {
			const items = SUBSCRIPTION_ITEMS.filter(
				(item) =>
					item.category === category &&
					(!normalizedQuery ||
						item.title.toLocaleLowerCase().includes(normalizedQuery) ||
						item.categoryName.toLocaleLowerCase().includes(normalizedQuery)),
			);
			return {
				key: category,
				title: CATEGORY_TITLES[category],
				expanded: expanded[category],
				visible: items.length > 0,
				items: [...items],
			};
		},
	);
}

/**
 * 旧端“确定修改”只修改内存变量并 Toast 成功，没有调用微信订阅 API 或
 * 服务端保存。本页保留搜索、折叠和患者切换等可验证交互，但将开关和保存
 * 动作明确设为只读，直到模板、授权回执、业务事件和撤销 contract 完整。
 */
Page<SubscriptionPageData, SubscriptionPageMethods>({
	data: {
		patient: null,
		loading: true,
		error: "",
		query: "",
		sections: buildSections(""),
		hasShown: false,
	},

	onLoad() {
		this.setData({ hasShown: false });
		registerPageSessionResetListener(this, () => {
			// 微信订阅开关仍是只读展示；会话变化只清理患者上下文。
			this.setData({
				patient: null,
				loading: false,
				error: "登录账号已切换，请重新读取就诊人",
			});
		});
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.hasShown) {
			this.setData({ hasShown: true });
			return;
		}
		void this.loadPatient();
	},

	loadPatient() {
		const guard = getPageLatestRequestGuard(this, "patient-subscription");
		const token = guard.begin();
		this.setData({ loading: true, error: "", patient: null });
		return loadCurrentPatient()
			.then((patient) => {
				if (guard.isCurrent(token)) this.setData({ patient });
			})
			.catch((error) => {
				if (guard.isCurrent(token)) {
					this.setData({
						patient: null,
						error: patientScopedErrorMessage(error),
					});
				}
			})
			.finally(() => {
				if (guard.isCurrent(token)) this.setData({ loading: false });
			});
	},

	onSearch(event) {
		const query = event.detail?.value ?? "";
		const expanded = Object.fromEntries(
			this.data.sections.map((section) => [section.key, section.expanded]),
		) as Record<SubscriptionCategory, boolean>;
		this.setData({ query, sections: buildSections(query, expanded) });
	},

	onToggleSection(event) {
		const sectionKey = event.currentTarget?.dataset?.sectionKey;
		if (!sectionKey || !(sectionKey in CATEGORY_TITLES)) return;
		const key = sectionKey as SubscriptionCategory;
		const expanded = Object.fromEntries(
			this.data.sections.map((section) => [section.key, section.expanded]),
		) as Record<SubscriptionCategory, boolean>;
		expanded[key] = !expanded[key];
		this.setData({ sections: buildSections(this.data.query, expanded) });
	},

	onOpenPatientSelector() {
		wx.navigateTo({ url: "/pages/patient-select/patient-select" });
	},

	onOpenMigrationStatus() {
		navigateToFeatureStatus("patient-subscription");
	},

	onRetry() {
		if (!this.data.loading) void this.loadPatient();
	},

	onBackMy() {
		wx.switchTab({ url: "/pages/my/my" });
	},

	onUnload() {
		disposePageSessionResetListener(this);
		disposePageInstance(this);
	},
});
