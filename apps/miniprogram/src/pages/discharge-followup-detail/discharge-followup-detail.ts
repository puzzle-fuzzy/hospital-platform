import { ApiError } from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	createDischargeFormValues,
	getDischargeFollowupFormDefinition,
	type DischargeFormDefinition,
	type DischargeFormField,
} from "../../services/discharge-followup-form-catalog";
import type { Patient } from "../../types";

type DischargeDetailPageData = {
	patient: Patient | null;
	loading: boolean;
	patientError: string;
	title: string;
	tableName: string;
	form: DischargeFormDefinition;
	values: Record<string, string | string[]>;
	message: string;
	submitting: boolean;
};

type DischargeDetailPageMethods = {
	loadPatient(): Promise<void>;
	onChangePatient(): void;
	onInput(event: WechatMiniprogram.Input): void;
	onOptionTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBack(): void;
};

function errorMessage(error: unknown): string {
	if (
		error instanceof ApiError &&
		error.code === "patient-selection-required"
	) {
		return "请先选择就诊人";
	}
	return "就诊人信息暂时无法获取，请稍后重试";
}

function optionValues(
	values: Record<string, string | string[]>,
	key: string,
): string[] {
	const value = values[key];
	return Array.isArray(value) ? value : value ? [value] : [];
}

function parseQueryValue(value: unknown): string {
	if (Array.isArray(value)) return String(value[0] ?? "");
	return String(value ?? "");
}

const DEFAULT_FORM = getDischargeFollowupFormDefinition("");
const DEFAULT_VALUES = createDischargeFormValues(DEFAULT_FORM);

Page<DischargeDetailPageData, DischargeDetailPageMethods>({
	data: {
		patient: null,
		loading: true,
		patientError: "",
		title: "出院随访",
		tableName: "",
		form: DEFAULT_FORM,
		values: DEFAULT_VALUES,
		message: "",
		submitting: false,
	},

	onLoad(options) {
		const tableName = parseQueryValue(options?.tableName);
		const title =
			parseQueryValue(options?.displayTitle) || tableName || "出院随访";
		const form = getDischargeFollowupFormDefinition(tableName);
		wx.setNavigationBarTitle({ title: "出院随访" });
		this.setData({
			title,
			tableName: form.tableName,
			form,
			values: createDischargeFormValues(form),
		});
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, patientError: "", message: "" });
		return loadCurrentPatient()
			.then((patient) => {
				const values = { ...this.data.values };
				const nameField = this.data.form.sections
					.flatMap((section) => section.fields)
					.find((field) => field.key === "patientName");
				if (nameField && !String(values.patientName ?? "").trim())
					values.patientName = patient.displayName;
				this.setData({ patient, values, loading: false, patientError: "" });
			})
			.catch((error: unknown) => {
				this.setData({
					patient: null,
					loading: false,
					patientError: errorMessage(error),
				});
			});
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onInput(event) {
		const key = String(event.currentTarget.dataset.key ?? "");
		if (!key) return;
		const values = {
			...this.data.values,
			[key]: String(event.detail.value ?? ""),
		};
		this.setData({ values, message: "" });
	},

	onOptionTap(event) {
		const key = String(event.currentTarget.dataset.key ?? "");
		const option = String(event.currentTarget.dataset.option ?? "");
		if (!key || !option) return;
		const field = this.data.form.sections
			.flatMap((section) => section.fields)
			.find((candidate) => candidate.key === key);
		if (!field) return;
		const selected = optionValues(this.data.values, key);
		const next = field.multiple
			? selected.includes(option)
				? selected.filter((item) => item !== option)
				: [...selected, option]
			: [option];
		this.setData({ values: { ...this.data.values, [key]: next }, message: "" });
	},

	onSubmit() {
		if (this.data.submitting) return;
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		const fields = this.data.form.sections.flatMap((section) => section.fields);
		const hasAnswer = fields.some((field: DischargeFormField) =>
			optionValues(this.data.values, field.key).some((item) => item.trim()),
		);
		if (!hasAnswer) {
			this.setData({ message: "请至少填写一项随访内容" });
			return;
		}
		this.setData({
			message: "随访表单已完成本地校验，但当前提交接口尚未开放，本次未提交。",
		});
	},

	onBack() {
		wx.navigateBack({ delta: 1 });
	},
});
