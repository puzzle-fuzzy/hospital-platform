import {
	ApiError,
	requestIntelligentGuideAudio,
	requestIntelligentGuideMessage,
} from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
} from "../../services/page-instance-state";
import type { IntelligentGuideMessageResponse } from "../../types";

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
};

type SmartGuidePageMethods = {
	onLoad(): void;
	onInput(event: WechatMiniprogram.Input): void;
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
	};
}

function guideErrorMessage(error: unknown): string {
	if (
		error instanceof ApiError &&
		error.code === "intelligent-guide-conversation-expired"
	) {
		return "本次导诊会话已失效，请点击“重新开始”后再试";
	}
	if (error instanceof ApiError && error.code === "dependency-not-configured") {
		return "智能导诊服务暂未配置完成，请稍后再试";
	}
	return errorMessageWithCode(error, "智能导诊暂时无法回复，请稍后再试");
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
			"智能导诊仅用于推荐可能合适的门诊科室，不能替代医生诊断；如有急危重症，请立即就医或拨打 120。",
		scrollIntoView: "",
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
		} catch (error) {
			if (!guard.isCurrent(token)) return;
			const errorMessage = guideErrorMessage(error);
			const failedMessage = assistantMessage(errorMessage);
			this.setData({
				messages: this.data.messages
					.filter((item) => item.id !== pendingMessage.id)
					.concat(failedMessage),
				sending: false,
				error: errorMessage,
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
		} catch (error) {
			if (!guard.isCurrent(token)) return;
			const errorMessage = guideErrorMessage(error);
			const failedMessage = assistantMessage(errorMessage);
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
				error: errorMessage,
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
