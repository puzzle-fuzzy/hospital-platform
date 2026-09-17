import { ApiError } from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import type { Patient } from "../../types";

type Question = {
	title: string;
	type: "choice" | "text";
	key: string;
	hasInput?: boolean;
	placeholder: string;
};

type PreVisitPageData = {
	patient: Patient | null;
	appointmentId: string;
	loading: boolean;
	patientError: string;
	answers: string[];
	inputValues: string[];
	message: string;
	submitting: boolean;
	questions: ReadonlyArray<Question>;
};

type PreVisitPageMethods = {
	loadPatient(): Promise<void>;
	onChangePatient(): void;
	onInput(event: WechatMiniprogram.Input): void;
	onOptionTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBackHome(): void;
};

/**
 * 旧 pre_visit.vue 的六项问卷原生化：只迁移题目和交互，不复制旧患者
 * 参数，也不调用旧 /saveBeforeVisitRecord。提交 contract 完成前始终关闭。
 */
export const PRE_VISIT_QUESTIONS: ReadonlyArray<Question> = Object.freeze([
	{
		title: "症状描述",
		type: "text",
		key: "symptomDescription",
		placeholder: "请输入具体情况",
	},
	{
		title: "患病时长",
		type: "text",
		key: "illTime",
		placeholder: "请输入患病时长",
	},
	{
		title: "您是否有药物或食物过敏?",
		type: "choice",
		key: "allergyHistory",
		hasInput: true,
		placeholder: "如有,请填写过敏的药物或食物名称",
	},
	{
		title: "您是否有抽烟或喝酒史?",
		type: "choice",
		key: "pastHistory",
		hasInput: true,
		placeholder: "如有,请填写抽烟或喝酒史",
	},
	{
		title: "您是否曾患有传染性疾病?",
		type: "choice",
		key: "presentHistory",
		hasInput: true,
		placeholder: "如有,请填写疾病名称",
	},
	{
		title: "家族遗传病史?",
		type: "choice",
		key: "familyHistory",
		hasInput: true,
		placeholder: "如有,请填写具体疾病",
	},
]);

function errorMessage(error: unknown): string {
	if (
		error instanceof ApiError &&
		error.code === "patient-selection-required"
	) {
		return "请先选择就诊人";
	}
	return "就诊人信息暂时无法获取，请稍后重试";
}

function emptyValues(): string[] {
	return PRE_VISIT_QUESTIONS.map(() => "");
}

function validAppointmentId(value: unknown): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(normalized)
		? normalized
		: "";
}

function complete(
	question: Question,
	answer: string,
	inputValue: string,
): boolean {
	if (question.type === "text") return Boolean(inputValue.trim());
	if (!answer) return false;
	return answer !== "yes" || Boolean(inputValue.trim());
}

Page<PreVisitPageData, PreVisitPageMethods>({
	data: {
		patient: null,
		appointmentId: "",
		loading: true,
		patientError: "",
		answers: emptyValues(),
		inputValues: emptyValues(),
		message: "",
		submitting: false,
		questions: PRE_VISIT_QUESTIONS,
	},

	onLoad(options) {
		wx.setNavigationBarTitle({ title: "预问诊问卷" });
		this.setData({ appointmentId: validAppointmentId(options?.appointmentId) });
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, patientError: "" });
		return loadCurrentPatient()
			.then((patient) => this.setData({ patient, loading: false }))
			.catch((error: unknown) =>
				this.setData({
					patient: null,
					loading: false,
					patientError: errorMessage(error),
				}),
			);
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onInput(event) {
		const index = Number(event.currentTarget.dataset.index);
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= this.data.inputValues.length
		)
			return;
		const inputValues = this.data.inputValues.slice();
		inputValues[index] = String(event.detail.value ?? "");
		const question = this.data.questions[index];
		const answers = this.data.answers.slice();
		if (question?.type === "choice" && inputValues[index].trim())
			answers[index] = "yes";
		this.setData({ inputValues, answers, message: "" });
	},

	onOptionTap(event) {
		const index = Number(event.currentTarget.dataset.index);
		const value = String(event.currentTarget.dataset.value ?? "");
		if (!Number.isInteger(index) || !["no", "yes"].includes(value)) return;
		const answers = this.data.answers.slice();
		answers[index] = value;
		const inputValues = this.data.inputValues.slice();
		if (value === "no") inputValues[index] = "";
		this.setData({ answers, inputValues, message: "" });
	},

	onSubmit() {
		if (this.data.submitting) return;
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		if (!this.data.appointmentId) {
			this.setData({ message: "请从有预约上下文的记录进入预问诊" });
			return;
		}
		const incomplete = this.data.questions.findIndex(
			(question, index) =>
				!complete(
					question,
					this.data.answers[index] ?? "",
					this.data.inputValues[index] ?? "",
				),
		);
		if (incomplete >= 0) {
			this.setData({ message: `请完成第${incomplete + 1}项` });
			return;
		}
		this.setData({ message: "预问诊提交接口正在接入中，本次未提交。" });
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
