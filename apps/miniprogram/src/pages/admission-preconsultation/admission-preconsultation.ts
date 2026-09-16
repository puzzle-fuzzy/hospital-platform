import { ApiError } from "../../services/api-client";
import { loadCurrentPatient } from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import type { Patient } from "../../types";

type QuestionType = "sex" | "number" | "relationship" | "choice" | "text";

type Question = {
	title: string;
	type: QuestionType;
	options?: ReadonlyArray<string>;
	hasInput?: boolean;
	placeholder?: string;
};

type AdmissionPageData = {
	patient: Patient | null;
	loading: boolean;
	answers: string[];
	details: string[];
	patientError: string;
	message: string;
	submitting: boolean;
	questions: ReadonlyArray<Question>;
};

type AdmissionPageMethods = {
	loadPatient(): Promise<void>;
	onChangePatient(): void;
	onInput(event: WechatMiniprogram.Input): void;
	onOptionTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBackHome(): void;
};

export const ADMISSION_PRECONSULTATION_QUESTIONS: ReadonlyArray<Question> = Object.freeze([
	{ title: "请选择患者的性别", type: "sex", options: ["男", "女"] },
	{ title: "请输入患者的年龄", type: "number", placeholder: "请输入年龄" },
	{ title: "请问您与患者的关系", type: "relationship", options: ["本人", "配偶", "父母", "子女", "其他"] },
	{ title: "请问患者有什么不舒服，持续多久了？", type: "text", placeholder: "请告知：主要症状、持续时间、检查和用药情况及疗效" },
	{ title: "请问患者是否有高血压？", type: "choice", options: ["无", "有"], hasInput: true, placeholder: "如有，请告知病程、最高血压、用药和控制范围" },
	{ title: "请问患者是否有糖尿病？", type: "choice", options: ["无", "有"], hasInput: true, placeholder: "如有，请告知病程、用药和血糖控制情况" },
	{ title: "请问患者是否有其他的慢性疾病？", type: "choice", options: ["无", "有"], hasInput: true, placeholder: "如有，请告知疾病、病程、用药和病情" },
	{ title: "请问患者是否有过传染病，比如结核、肝炎、疟疾等？", type: "choice", options: ["无", "有"], hasInput: true, placeholder: "如有，请告知传染病名称和患病时间" },
	{ title: "请问患者以前做过什么手术？", type: "choice", options: ["无", "有"], hasInput: true, placeholder: "如有，请告知手术时间、疾病、医院、结果和恢复情况" },
	{ title: "您还有其他信息要补充吗？", type: "text", placeholder: "请输入其他信息" },
]);

function errorMessage(error: unknown): string {
	if (error instanceof ApiError && error.code === "patient-selection-required") {
		return "请先选择就诊人";
	}
	return "就诊人信息暂时无法获取，请稍后重试";
}

function createEmptyAnswers(): string[] {
	return ADMISSION_PRECONSULTATION_QUESTIONS.map(() => "");
}

function isAnswerComplete(question: Question, answer: string): boolean {
	return Boolean(answer.trim());
}

Page<AdmissionPageData, AdmissionPageMethods>({
	data: {
		patient: null,
		loading: true,
		answers: createEmptyAnswers(),
		details: createEmptyAnswers(),
		patientError: "",
		message: "",
		submitting: false,
		questions: ADMISSION_PRECONSULTATION_QUESTIONS,
	},

	onLoad() {
		wx.setNavigationBarTitle({ title: "入院预问诊" });
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, patientError: "" });
		return loadCurrentPatient()
			.then((patient) => {
				this.setData({ patient, loading: false, patientError: "" });
			})
			.catch((error: unknown) => {
				this.setData({ patient: null, loading: false, patientError: errorMessage(error) });
			});
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onInput(event) {
		const index = Number(event.currentTarget.dataset.index);
		const field = String(event.currentTarget.dataset.field ?? "answer");
		if (!Number.isInteger(index) || index < 0 || index >= this.data.answers.length) return;
		if (field === "detail") {
			const details = this.data.details.slice();
			details[index] = String(event.detail.value ?? "");
			this.setData({ details, message: "" });
			return;
		}
		const answers = this.data.answers.slice();
		answers[index] = String(event.detail.value ?? "");
		this.setData({ answers, message: "" });
	},

	onOptionTap(event) {
		const index = Number(event.currentTarget.dataset.index);
		const value = String(event.currentTarget.dataset.value ?? "");
		if (!Number.isInteger(index) || !value) return;
		const answers = this.data.answers.slice();
		answers[index] = value;
		const details = this.data.details.slice();
		if (value === "无") details[index] = "";
		this.setData({ answers, details, message: "" });
	},

	onSubmit() {
		if (this.data.submitting) return;
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		const firstIncomplete = ADMISSION_PRECONSULTATION_QUESTIONS.findIndex((question, index) =>
			!isAnswerComplete(question, this.data.answers[index] ?? "") ||
			(question.type === "choice" && question.hasInput && this.data.answers[index] === "有" && !this.data.details[index]?.trim()),
		);
		if (firstIncomplete >= 0) {
			this.setData({ message: `请完成第${firstIncomplete + 1}项` });
			return;
		}
		// 旧服务的 submit contract 尚未进入当前 TS API；表单结构先完整迁移，
		// 这里明确告知未提交，避免把客户端填写当成医疗问诊已入库。
		this.setData({
			submitting: false,
			message: "入院预问诊提交接口正在接入中，本次未提交。",
		});
	},

	onBackHome() {
		wx.switchTab({ url: "/pages/index/index" });
	},
});
