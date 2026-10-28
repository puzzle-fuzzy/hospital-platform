import {
	ApiError,
	requestIntelligentGuideAudio,
	requestIntelligentGuideMessage,
} from "../../services/api-client";
import { groupAppointmentDoctorCards } from "../../services/appointment-directory-view";
import { loadAppointmentDoctorSchedules } from "../../services/dashboard-service";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	getPageLifecycle,
} from "../../services/page-instance-state";
import type {
	AppointmentDoctorCard,
	IntelligentGuideMessageResponse,
} from "../../types";

type GuideDepartment =
	IntelligentGuideMessageResponse["data"]["departments"][number];

type GuideMessage = {
	id: string;
	role: "assistant" | "user";
	content: string;
	departments: GuideDepartment[];
	advice: string;
	summary: string;
	showDisclaimer: boolean;
	pending: boolean;
	isError: boolean;
	errorCode: string;
	/** 推荐后异步加载的真实坐诊医生；仅服务端排班数据，不由模型生成。 */
	doctors: AppointmentDoctorCard[];
	doctorsDepartmentId: string;
	doctorsDepartmentName: string;
	doctorsLoading: boolean;
};

type SmartGuidePageData = {
	messages: GuideMessage[];
	inputValue: string;
	conversationReference: string;
	progress: number;
	sending: boolean;
	recording: boolean;
	error: string;
	disclaimer: string;
	scrollIntoView: string;
	keyboardHeight: number;
};

type SmartGuidePageMethods = {
	onLoad(): void;
	onInput(event: WechatMiniprogram.Input): void;
	onInputFocus(event: WechatMiniprogram.InputFocus): void;
	onKeyboardHeightChange(
		event: WechatMiniprogram.InputKeyboardHeightChange,
	): void;
	updateKeyboardHeight(height: number): void;
	onHide(): void;
	onSend(): void;
	sendMessage(): Promise<void>;
	onVoiceTouchStart(): void;
	onVoiceTouchEnd(): void;
	sendAudio(
		filePath: string,
		duration: number,
		fileSize: number,
	): Promise<void>;
	onDepartmentTap(event: WechatMiniprogram.TouchEvent): void;
	loadRecommendedDoctors(
		messageId: string,
		departmentId: string,
		departmentName: string,
	): void;
	onDoctorTap(event: WechatMiniprogram.TouchEvent): void;
	onRestart(): void;
	onUnload(): void;
};

type SmartGuidePageInstance = WechatMiniprogram.Page.Instance<
	SmartGuidePageData,
	SmartGuidePageMethods
>;

let messageSequence = 0;
let guideRecorderManager: WechatMiniprogram.RecorderManager | undefined;
let activeRecorderPage: SmartGuidePageInstance | undefined;

function nextMessageId(): string {
	messageSequence += 1;
	return `guide-message-${messageSequence}`;
}

function assistantMessage(
	content: string,
	input: Partial<Omit<GuideMessage, "id" | "role" | "content">> = {},
): GuideMessage {
	return {
		id: nextMessageId(),
		role: "assistant",
		content,
		departments: input.departments ?? [],
		advice: input.advice ?? "",
		summary: input.summary ?? "",
		showDisclaimer: input.showDisclaimer ?? false,
		pending: input.pending ?? false,
		isError: input.isError ?? false,
		errorCode: input.errorCode ?? "",
		doctors: input.doctors ?? [],
		doctorsDepartmentId: input.doctorsDepartmentId ?? "",
		doctorsDepartmentName: input.doctorsDepartmentName ?? "",
		doctorsLoading: input.doctorsLoading ?? false,
	};
}

function guideErrorMessage(error: unknown): {
	message: string;
	displayText: string;
	errorCode: string;
} {
	let message: string;
	if (
		error instanceof ApiError &&
		error.code === "intelligent-guide-conversation-expired"
	) {
		message = "本次导诊会话已失效，请点击“重新开始”后再试";
	} else if (
		error instanceof ApiError &&
		error.code === "dependency-not-configured"
	) {
		message = "就医助手服务暂未配置完成，请稍后再试";
	} else {
		message = "就医助手暂时无法回复，请稍后再试";
	}
	const displayText = errorMessageWithCode(error, message);
	const errorCode = displayText.match(/错误码\s+(\d+)/)?.[1] ?? "";
	return { message, displayText, errorCode };
}

function recorderManager(): WechatMiniprogram.RecorderManager {
	if (guideRecorderManager) return guideRecorderManager;
	const manager = wx.getRecorderManager();
	manager.onStop((result) => {
		const page = activeRecorderPage;
		activeRecorderPage = undefined;
		if (!page) return;
		page.setData({ recording: false });
		void page.sendAudio(result.tempFilePath, result.duration, result.fileSize);
	});
	manager.onError(() => {
		const page = activeRecorderPage;
		activeRecorderPage = undefined;
		page?.setData({ recording: false });
		wx.showModal({
			title: "需要麦克风权限",
			content: "请在微信权限设置中允许使用麦克风，再长按录音。",
			confirmText: "去设置",
			success: (result) => {
				if (result.confirm) wx.openSetting({});
			},
		});
	});
	guideRecorderManager = manager;
	return manager;
}

Page<SmartGuidePageData, SmartGuidePageMethods>({
	data: {
		messages: [],
		inputValue: "",
		conversationReference: "",
		progress: 0,
		sending: false,
		recording: false,
		error: "",
		disclaimer:
			"就医助手仅用于推荐可能合适的门诊科室，不能替代医生诊断；如有急危重症，请立即就医或拨打 120。",
		scrollIntoView: "",
		keyboardHeight: 0,
	},

	onLoad() {
		void recorderManager();
	},

	onInput(event) {
		const value =
			typeof event.detail?.value === "string" ? event.detail.value : "";
		this.setData({
			inputValue: Array.from(value).slice(0, 50).join(""),
			error: "",
		});
	},

	onInputFocus(event) {
		this.updateKeyboardHeight(event.detail.height);
	},

	onKeyboardHeightChange(event) {
		this.updateKeyboardHeight(event.detail.height);
	},

	updateKeyboardHeight(height) {
		if (
			!getPageLifecycle(this).isActive() ||
			!Number.isFinite(height) ||
			height < 0 ||
			height === this.data.keyboardHeight
		) {
			return;
		}
		// 禁用原生整页上推，由根容器统一给键盘留出空间；输入栏参与 flex 布局，
		// 消息区随之缩短，避免 fixed 输入栏与整页位移叠加。
		this.setData({ keyboardHeight: height, scrollIntoView: "" }, () => {
			if (
				getPageLifecycle(this).isActive() &&
				this.data.keyboardHeight === height &&
				this.data.messages.length > 0
			) {
				this.setData({ scrollIntoView: "guide-message-end" });
			}
		});
	},

	onHide() {
		this.setData({ keyboardHeight: 0 });
	},

	onSend() {
		void this.sendMessage();
	},

	async sendMessage() {
		if (this.data.sending) return;
		const message = this.data.inputValue.trim();
		if (!message) {
			wx.showToast({ title: "请先描述您的症状", icon: "none" });
			return;
		}
		const guard = getPageLatestRequestGuard(this, "intelligent-guide-message");
		const token = guard.begin();
		const userMessage: GuideMessage = {
			id: nextMessageId(),
			role: "user",
			content: message,
			departments: [],
			advice: "",
			summary: "",
			showDisclaimer: false,
			pending: false,
			isError: false,
			errorCode: "",
			doctors: [],
			doctorsDepartmentId: "",
			doctorsDepartmentName: "",
			doctorsLoading: false,
		};
		const pendingMessage = assistantMessage("正在分析，请稍候…", {
			pending: true,
		});
		this.setData({
			messages: [...this.data.messages, userMessage, pendingMessage],
			inputValue: "",
			sending: true,
			error: "",
			scrollIntoView: pendingMessage.id,
		});

		try {
			const response = await requestIntelligentGuideMessage({
				message,
				...(this.data.conversationReference
					? { conversationReference: this.data.conversationReference }
					: {}),
			});
			if (!guard.isCurrent(token)) return;
			const reply = response.data;
			const content =
				reply.message ||
				reply.summary ||
				(reply.departments.length > 0
					? "已根据您的描述推荐以下科室"
					: "已完成本次分析");
			const completedMessage = assistantMessage(content, {
				departments: [...reply.departments],
				advice: reply.advice ?? "",
				summary: reply.summary ?? "",
				showDisclaimer: !this.data.messages.some(
					(item) => item.role === "assistant" && !item.pending,
				),
			});
			this.setData({
				messages: this.data.messages
					.filter((item) => item.id !== pendingMessage.id)
					.concat(completedMessage),
				conversationReference: reply.conversationReference,
				progress: reply.progress,
				disclaimer: reply.disclaimer,
				sending: false,
				error: "",
				scrollIntoView: completedMessage.id,
			});
			const firstDepartment = reply.departments[0];
			if (firstDepartment)
				this.loadRecommendedDoctors(
					completedMessage.id,
					firstDepartment.departmentId,
					firstDepartment.displayName,
				);
		} catch (error) {
			if (!guard.isCurrent(token)) return;
			const errorMessage = guideErrorMessage(error);
			const failedMessage = assistantMessage(errorMessage.message, {
				isError: true,
				errorCode: errorMessage.errorCode,
			});
			this.setData({
				messages: this.data.messages
					.filter((item) => item.id !== pendingMessage.id)
					.concat(failedMessage),
				sending: false,
				error: errorMessage.displayText,
				scrollIntoView: failedMessage.id,
			});
		}
	},

	onVoiceTouchStart() {
		if (this.data.sending || this.data.recording) return;
		activeRecorderPage = this;
		this.setData({ recording: true, error: "" });
		recorderManager().start({
			duration: 60_000,
			sampleRate: 16_000,
			numberOfChannels: 1,
			encodeBitRate: 48_000,
			format: "mp3",
		});
	},

	onVoiceTouchEnd() {
		if (activeRecorderPage !== this || !this.data.recording) return;
		recorderManager().stop();
	},

	async sendAudio(filePath, duration, fileSize) {
		if (this.data.sending) return;
		if (duration < 500 || fileSize < 128) {
			wx.showToast({ title: "录音时间太短，请重试", icon: "none" });
			return;
		}
		if (fileSize > 2 * 1024 * 1024) {
			wx.showToast({ title: "录音文件过大，请缩短后重试", icon: "none" });
			return;
		}
		const guard = getPageLatestRequestGuard(this, "intelligent-guide-audio");
		const token = guard.begin();
		const userMessage: GuideMessage = {
			id: nextMessageId(),
			role: "user",
			content: "语音识别中…",
			departments: [],
			advice: "",
			summary: "",
			showDisclaimer: false,
			pending: true,
			isError: false,
			errorCode: "",
			doctors: [],
			doctorsDepartmentId: "",
			doctorsDepartmentName: "",
			doctorsLoading: false,
		};
		const pendingMessage = assistantMessage("正在分析语音内容，请稍候…", {
			pending: true,
		});
		this.setData({
			messages: [...this.data.messages, userMessage, pendingMessage],
			sending: true,
			error: "",
			scrollIntoView: pendingMessage.id,
		});

		try {
			const response = await requestIntelligentGuideAudio({
				filePath,
				...(this.data.conversationReference
					? { conversationReference: this.data.conversationReference }
					: {}),
			});
			if (!guard.isCurrent(token)) return;
			const reply = response.data;
			const completedMessage = assistantMessage(
				reply.message ||
					reply.summary ||
					(reply.departments.length > 0
						? "已根据您的描述推荐以下科室"
						: "已完成本次分析"),
				{
					departments: [...reply.departments],
					advice: reply.advice ?? "",
					summary: reply.summary ?? "",
					showDisclaimer: !this.data.messages.some(
						(item) => item.role === "assistant" && !item.pending,
					),
				},
			);
			this.setData({
				messages: this.data.messages
					.filter(
						(item) =>
							item.id !== pendingMessage.id && item.id !== userMessage.id,
					)
					.concat({
						...userMessage,
						content: reply.userInput ? `语音：${reply.userInput}` : "语音消息",
						pending: false,
					})
					.concat(completedMessage),
				conversationReference: reply.conversationReference,
				progress: reply.progress,
				disclaimer: reply.disclaimer,
				sending: false,
				error: "",
				scrollIntoView: completedMessage.id,
			});
			const firstDepartment = reply.departments[0];
			if (firstDepartment)
				this.loadRecommendedDoctors(
					completedMessage.id,
					firstDepartment.departmentId,
					firstDepartment.displayName,
				);
		} catch (error) {
			if (!guard.isCurrent(token)) return;
			const errorMessage = guideErrorMessage(error);
			const failedMessage = assistantMessage(errorMessage.message, {
				isError: true,
				errorCode: errorMessage.errorCode,
			});
			this.setData({
				messages: this.data.messages
					.filter((item) => item.id !== pendingMessage.id)
					.map((item) =>
						item.id === userMessage.id
							? { ...item, content: "语音消息", pending: false }
							: item,
					)
					.concat(failedMessage),
				sending: false,
				error: errorMessage.displayText,
				scrollIntoView: failedMessage.id,
			});
		}
	},

	onDepartmentTap(event) {
		const departmentId = String(event.currentTarget.dataset.departmentId ?? "");
		const displayName = String(event.currentTarget.dataset.displayName ?? "");
		const exists = this.data.messages.some((message) =>
			message.departments.some(
				(department) =>
					department.departmentId === departmentId &&
					department.displayName === displayName,
			),
		);
		if (!exists) return;
		wx.navigateTo({
			url: `/pages/appointment-schedule/appointment-schedule?departmentId=${encodeURIComponent(
				departmentId,
			)}&departmentName=${encodeURIComponent(displayName)}`,
		});
	},

	/**
	 * 推荐科室后异步补齐该科室真实坐诊医生卡片。
	 * 医生与余号只来自服务端排班读模型，不由模型生成；加载失败静默收起，
	 * 科室挂号入口不受影响。
	 */
	loadRecommendedDoctors(messageId, departmentId, departmentName) {
		const guard = getPageLatestRequestGuard(this, "intelligent-guide-doctors");
		const token = guard.begin();
		const patchMessage = (
			patch: Partial<
				Pick<
					GuideMessage,
					| "doctors"
					| "doctorsLoading"
					| "doctorsDepartmentId"
					| "doctorsDepartmentName"
				>
			>,
		) => {
			this.setData({
				messages: this.data.messages.map((item) =>
					item.id === messageId ? { ...item, ...patch } : item,
				),
			});
		};
		patchMessage({
			doctors: [],
			doctorsLoading: true,
			doctorsDepartmentId: departmentId,
			doctorsDepartmentName: departmentName,
		});
		loadAppointmentDoctorSchedules(departmentId)
			.then((schedules) => {
				if (!guard.isCurrent(token)) return;
				patchMessage({
					doctors: groupAppointmentDoctorCards(schedules, {
						includeUnknownAvailableSlots: true,
					}).slice(0, 6),
					doctorsLoading: false,
				});
			})
			.catch(() => {
				if (!guard.isCurrent(token)) return;
				patchMessage({ doctors: [], doctorsLoading: false });
			});
	},

	/** 医生卡片直达该医生的排班号源；数据集必须来自当前消息内已加载卡片。 */
	onDoctorTap(event) {
		const departmentId = String(
			event.currentTarget?.dataset?.departmentId ?? "",
		);
		const departmentName = String(
			event.currentTarget?.dataset?.departmentName ?? "",
		);
		const doctorId = String(event.currentTarget?.dataset?.doctorId ?? "");
		const doctorName = String(event.currentTarget?.dataset?.doctorName ?? "");
		const exists = this.data.messages.some(
			(message) =>
				message.doctorsDepartmentId === departmentId &&
				message.doctors.some((doctor) => doctor.doctorId === doctorId),
		);
		if (!exists || !doctorName) return;
		wx.navigateTo({
			url: `/pages/appointment-schedule/appointment-schedule?departmentId=${encodeURIComponent(
				departmentId,
			)}&departmentName=${encodeURIComponent(
				departmentName,
			)}&doctorId=${encodeURIComponent(doctorId)}&doctorName=${encodeURIComponent(doctorName)}`,
		});
	},

	onRestart() {
		if (this.data.sending || this.data.recording) return;
		this.setData({
			messages: [],
			inputValue: "",
			conversationReference: "",
			progress: 0,
			error: "",
			scrollIntoView: "",
		});
	},

	onUnload() {
		if (activeRecorderPage === this) {
			activeRecorderPage = undefined;
			if (this.data.recording) recorderManager().stop();
		}
		disposePageInstance(this);
	},
});
