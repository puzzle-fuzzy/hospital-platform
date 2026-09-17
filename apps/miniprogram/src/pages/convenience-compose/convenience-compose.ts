import {
	ApiError,
	createPatientFeedback,
	loadPatientFeedback,
} from "../../services/api-client";
import {
	loadAppointmentRecords,
	loadCurrentPatient,
} from "../../services/dashboard-service";
import { navigateToPatientSelector } from "../../services/patient-navigation";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "../../services/session-generation";
import type {
	AppointmentRecord,
	Patient,
	PatientFeedbackResponse,
} from "../../types";

type ConvenienceFeature = "gift-banner" | "health-praise";
type ConvenienceMode = "create" | "records";

type ConvenienceComposePageData = {
	feature: ConvenienceFeature;
	mode: ConvenienceMode;
	title: string;
	patient: Patient | null;
	loading: boolean;
	patientError: string;
	visitRecord: string;
	visitRecordId: string;
	visitRecords: ReadonlyArray<AppointmentRecord>;
	visitRecordLoading: boolean;
	records: ReadonlyArray<PatientFeedbackResponse["data"]>;
	recordsPageNo: number;
	recordsHasMore: boolean;
	recordsLoadingMore: boolean;
	showVisitPicker: boolean;
	department: string;
	medicalStaff: string;
	content: string;
	displayPublic: boolean;
	donateDate: string;
	templates: ReadonlyArray<string>;
	message: string;
	submitting: boolean;
};

type ConvenienceComposePageMethods = {
	loadPatient(): Promise<void>;
	onChangePatient(): void;
	onVisitRecordTap(): void;
	onVisitRecordSelect(event: WechatMiniprogram.TouchEvent): void;
	onCloseVisitPicker(): void;
	onInput(event: WechatMiniprogram.Input): void;
	onTemplateTap(event: WechatMiniprogram.TouchEvent): void;
	onDisplayTap(event: WechatMiniprogram.TouchEvent): void;
	onSubmit(): void;
	onBack(): void;
	onBackToSurface(): void;
	onRecordsScrollToLower(): void;
};

const GIFT_TEMPLATES = Object.freeze([
	"仁心仁术，德艺双馨",
	"医德高尚，医术精湛",
	"医者仁心，妙手回春",
	"治病救人，视患如亲",
	"护理精心，专业温馨",
]);

const PRAISE_TEMPLATES = GIFT_TEMPLATES;

function queryValue(value: unknown): string {
	if (Array.isArray(value)) return String(value[0] ?? "");
	return String(value ?? "");
}

function featureFromQuery(value: unknown): ConvenienceFeature {
	return queryValue(value) === "health-praise"
		? "health-praise"
		: "gift-banner";
}

function modeFromQuery(value: unknown): ConvenienceMode {
	return queryValue(value) === "records" ? "records" : "create";
}

function today(): string {
	const date = new Date();
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
	if (
		error instanceof ApiError &&
		error.code === "patient-selection-required"
	) {
		return "请先选择就诊人";
	}
	return "就诊人信息暂时无法获取，请稍后重试";
}

function pageCopy(
	feature: ConvenienceFeature,
	mode: ConvenienceMode,
): { title: string; templates: ReadonlyArray<string> } {
	if (feature === "health-praise") {
		return {
			title: mode === "records" ? "我的表扬信" : "我要表扬",
			templates: PRAISE_TEMPLATES,
		};
	}
	return {
		title: mode === "records" ? "我的电子锦旗" : "我要赠送锦旗",
		templates: GIFT_TEMPLATES,
	};
}

Page<ConvenienceComposePageData, ConvenienceComposePageMethods>({
	data: {
		feature: "gift-banner",
		mode: "create",
		title: "我要赠送锦旗",
		patient: null,
		loading: true,
		patientError: "",
		visitRecord: "",
		visitRecordId: "",
		visitRecords: [],
		visitRecordLoading: false,
		records: [],
		recordsPageNo: 1,
		recordsHasMore: false,
		recordsLoadingMore: false,
		showVisitPicker: false,
		department: "",
		medicalStaff: "",
		content: "",
		displayPublic: true,
		donateDate: today(),
		templates: GIFT_TEMPLATES,
		message: "",
		submitting: false,
	},

	onLoad(options) {
		const feature = featureFromQuery(options?.feature);
		const mode = modeFromQuery(options?.mode);
		const copy = pageCopy(feature, mode);
		this.setData({
			feature,
			mode,
			title: copy.title,
			templates: copy.templates,
		});
		wx.setNavigationBarTitle({ title: copy.title });
		void this.loadPatient();
	},

	onShow() {
		if (!this.data.loading) void this.loadPatient();
	},

	loadPatient() {
		this.setData({ loading: true, patientError: "", message: "" });
		return loadCurrentPatient()
			.then((patient) => {
				this.setData({
					patient,
					loading: false,
					patientError: "",
					visitRecord: "",
					visitRecordId: "",
					visitRecords: [],
					visitRecordLoading: false,
					showVisitPicker: false,
					records: [],
					recordsPageNo: 1,
					recordsHasMore: false,
					recordsLoadingMore: false,
				});
				if (this.data.mode !== "records") return;
				return loadPatientFeedback(
					patient.id,
					this.data.feature,
					undefined,
					undefined,
					1,
					50,
				)
					.then((data) =>
						this.setData({
							records: data.items,
							recordsPageNo: data.pageNo,
							recordsHasMore: data.hasMore,
							recordsLoadingMore: false,
						}),
					)
					.catch(() =>
						this.setData({
							message: "我的记录暂时无法获取，请稍后重试",
							recordsHasMore: false,
						}),
					);
			})
			.catch((error: unknown) =>
				this.setData({
					patient: null,
					loading: false,
					patientError: errorMessage(error),
					records: [],
					recordsPageNo: 1,
					recordsHasMore: false,
					recordsLoadingMore: false,
				}),
			);
	},

	onChangePatient() {
		navigateToPatientSelector("valid");
	},

	onVisitRecordTap() {
		if (this.data.loading || this.data.visitRecordLoading) return;
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		if (this.data.visitRecords.length) {
			this.setData({ showVisitPicker: true, message: "" });
			return;
		}
		this.setData({ visitRecordLoading: true, message: "" });
		const patient = this.data.patient;
		const generation = getSessionGeneration();
		loadAppointmentRecords(patient.id, new Date(), "history", generation, "all")
			.then((records) => {
				if (
					!isCurrentSessionGeneration(generation) ||
					this.data.patient?.id !== patient.id
				) {
					return;
				}
				if (!records.length) {
					this.setData({
						message: "当前就诊人暂无可关联的就诊记录",
						visitRecords: [],
					});
					return;
				}
				this.setData({ visitRecords: records, showVisitPicker: true });
			})
			.catch(() => {
				if (isCurrentSessionGeneration(generation)) {
					this.setData({ message: "就诊记录暂时无法获取，请稍后重试" });
				}
			})
			.finally(() => {
				if (isCurrentSessionGeneration(generation)) {
					this.setData({ visitRecordLoading: false });
				}
			});
	},

	onVisitRecordSelect(event) {
		const index = Number(event.currentTarget.dataset.index);
		const record = Number.isInteger(index)
			? this.data.visitRecords[index]
			: undefined;
		if (!record) return;
		this.setData({
			visitRecordId: record.appointmentId ?? "",
			visitRecord: `${record.workDate}${record.workTime ? ` ${record.workTime}` : ""}`,
			department: record.departmentName ?? "",
			medicalStaff: record.doctorName ?? "",
			showVisitPicker: false,
			message: "",
		});
	},

	onCloseVisitPicker() {
		this.setData({ showVisitPicker: false });
	},

	onInput(event) {
		const field = String(event.currentTarget.dataset.field ?? "");
		if (field !== "content") return;
		this.setData({ content: String(event.detail.value ?? ""), message: "" });
	},

	onTemplateTap(event) {
		const value = String(event.currentTarget.dataset.value ?? "");
		if (!value) return;
		this.setData({ content: value, message: "" });
	},

	onDisplayTap(event) {
		this.setData({
			displayPublic:
				String(event.currentTarget.dataset.value ?? "") === "public",
		});
	},

	onSubmit() {
		if (this.data.submitting) return;
		if (!this.data.patient) {
			this.setData({ message: "请先选择就诊人" });
			return;
		}
		if (!this.data.visitRecord || !this.data.visitRecordId) {
			this.setData({ message: "请选择就诊记录" });
			return;
		}
		const content = this.data.content.trim();
		const maxLength = this.data.feature === "gift-banner" ? 10 : 1000;
		if (!content) {
			this.setData({
				message:
					this.data.feature === "gift-banner"
						? "请填写感谢文案"
						: "请填写表扬信内容",
			});
			return;
		}
		if (content.length > maxLength) {
			this.setData({ message: `内容不能超过${maxLength}个字` });
			return;
		}
		this.setData({
			submitting: true,
			message: "",
		});
		void createPatientFeedback({
			patientId: this.data.patient.id,
			appointmentId: this.data.visitRecordId,
			kind: this.data.feature,
			content,
			displayPublic: this.data.displayPublic,
			donateDate: this.data.donateDate,
		})
			.then(() =>
				this.setData({
					message: "已提交审核，审核通过后才会公开展示。",
					content: "",
				}),
			)
			.catch((error: unknown) => this.setData({ message: errorMessage(error) }))
			.finally(() => this.setData({ submitting: false }));
	},

	onBack() {
		wx.navigateBack({ delta: 1 });
	},

	onBackToSurface() {
		wx.navigateBack({ delta: 1 });
	},

	onRecordsScrollToLower() {
		if (
			this.data.mode !== "records" ||
			!this.data.recordsHasMore ||
			this.data.recordsLoadingMore ||
			!this.data.patient
		)
			return;
		const patient = this.data.patient;
		const generation = getSessionGeneration();
		const nextPage = this.data.recordsPageNo + 1;
		this.setData({ recordsLoadingMore: true });
		void loadPatientFeedback(
			patient.id,
			this.data.feature,
			undefined,
			undefined,
			nextPage,
			50,
		)
			.then((data) => {
				if (
					!isCurrentSessionGeneration(generation) ||
					this.data.patient?.id !== patient.id
				)
					return;
				this.setData({
					records: [...this.data.records, ...data.items],
					recordsPageNo: data.pageNo,
					recordsHasMore: data.hasMore,
					message: "",
				});
			})
			.catch(() => {
				if (isCurrentSessionGeneration(generation)) {
					this.setData({ message: "更多记录暂时无法获取，请稍后重试" });
				}
			})
			.finally(() => {
				if (isCurrentSessionGeneration(generation)) {
					this.setData({ recordsLoadingMore: false });
				}
			});
	},
});
