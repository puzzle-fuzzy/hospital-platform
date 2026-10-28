import {
	ApiError,
	requestIntelligentCustomerMessage,
} from "../../services/api-client";
import { errorMessageWithCode } from "../../services/error-presentation";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	getPageLifecycle,
} from "../../services/page-instance-state";
import {
	SMART_CUSTOMER_FAQ_GROUPS,
	smartCustomerFaqActionUrl,
	type SmartCustomerFaqGroup,
} from "../../services/smart-customer-faq";
import type {
	IntelligentCustomerMessageResponse,
	SmartCustomerMessage,
} from "../../types";

/**
 * 原生智能客服会话页：与就医助手共用聊天视觉，但走独立的服务端编排——
 * 只回答医院服务问题（位置、流程、时间等），资料未覆盖时如实说明；
 * 模型返回 redirect=ai_guide 时引导前往就医助手选择科室。
 * 本页不承载旧通用 webview 的任意 URL、患者绑定/解绑或旧 ticket 链路。
 */

let messageSequence = 0;

function nextMessageId(): string {
	messageSequence += 1;
	return `customer-message-${messageSequence}`;
}

function assistantMessage(
	content: string,
	input: Partial<
		Omit<SmartCustomerMessage, "id" | "role" | "content">
	> = {},
): SmartCustomerMessage {
	return {
		id: nextMessageId(),
		role: "assistant",
		content,
		redirect: input.redirect ?? "",
		pending: input.pending ?? false,
		isError: input.isError ?? false,
		errorCode: input.errorCode ?? "",
	};
}

function customerErrorMessage(error: unknown): {
	message: string;
	displayText: string;
	errorCode: string;
} {
	let message: string;
	if (
		error instanceof ApiError &&
		error.code === "intelligent-customer-conversation-expired"
	) {
		message = "本次客服会话已失效，请点击“重新开始”后再试";
	} else if (
		error instanceof ApiError &&
		error.code === "intelligent-customer-rate-limited"
	) {
		message = "客服请求较频繁，请稍后再试";
	} else if (
		error instanceof ApiError &&
		error.code === "dependency-not-configured"
	) {
		message = "智能客服服务暂未配置完成，请稍后再试";
	} else {
		message = "智能客服暂时无法回复，请稍后再试";
	}
	const displayText = errorMessageWithCode(error, message);
	const errorCode = displayText.match(/错误码\s+(\d+)/)?.[1] ?? "";
	return { message, displayText, errorCode };
}

type SmartCustomerPageData = {
	messages: SmartCustomerMessage[];
	inputValue: string;
	conversationReference: string;
	sending: boolean;
	error: string;
	scrollIntoView: string;
	keyboardHeight: number;
	/** 键盘弹起时写入内联滚动区高度；收起时为空串交回 WXSS 默认 calc。 */
	scrollAreaStyle: string;
	faqGroups: ReadonlyArray<SmartCustomerFaqGroup>;
	expandedFaqId: string;
};


type SmartCustomerPageMethods = {
	onLoad(): void;
	onFaqToggle(event: WechatMiniprogram.TouchEvent): void;
	onFaqAction(event: WechatMiniprogram.TouchEvent): void;
	onInput(event: WechatMiniprogram.Input): void;
	onInputFocus(event: WechatMiniprogram.InputFocus): void;
	onKeyboardHeightChange(
		event: WechatMiniprogram.InputKeyboardHeightChange,
	): void;
	updateKeyboardHeight(height: number): void;
	onHide(): void;
	onSend(): void;
	sendMessage(): Promise<void>;
	onRedirectTap(event: WechatMiniprogram.TouchEvent): void;
	onRestart(): void;
	onUnload(): void;
};

Page<SmartCustomerPageData, SmartCustomerPageMethods>({
	data: {
		messages: [],
		inputValue: "",
		conversationReference: "",
		sending: false,
		error: "",
		scrollIntoView: "",
		keyboardHeight: 0,
		scrollAreaStyle: "",
		faqGroups: SMART_CUSTOMER_FAQ_GROUPS,
		expandedFaqId: "",
	},

	onLoad() {
		// 首条固定欢迎语只做引导，不携带会话引用；真实会话在首次发送后建立。
		this.setData({
			messages: [
				assistantMessage(
					"您好，我是高平市人民医院智能客服，可以帮您解答挂号、退费、科室位置、就诊时间等就医服务问题。",
				),
			],
		});
	},

	onFaqToggle(event) {
		const id = String(event.currentTarget?.dataset?.id ?? "");
		const exists = SMART_CUSTOMER_FAQ_GROUPS.some((group) =>
			group.items.some((item) => item.id === id),
		);
		if (!exists) return;
		this.setData({
			expandedFaqId: this.data.expandedFaqId === id ? "" : id,
		});
	},

	onFaqAction(event) {
		const id = String(event.currentTarget?.dataset?.id ?? "");
		const url = smartCustomerFaqActionUrl(id);
		if (!url) return;
		// catchtap 阻止冒泡触发展开/收起；路径只来自服务目录白名单。
		wx.navigateTo({ url });
	},

	onInput(event) {
		const value =
			typeof event.detail?.value === "string" ? event.detail.value : "";
		this.setData({
			// 服务端客服消息上限 100 个码点，超出部分先在端上截断。
			inputValue: Array.from(value).slice(0, 100).join(""),
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
		// 输入栏 fixed 在窗口底部并随键盘抬高；滚动区高度由内联 calc 同步缩短，
		// 不使用原生整页上推，避免 fixed 输入栏与页面位移叠加。样式在 JS 侧
		// 预拼成纯字符串，保证 WXML 根标签不含插值比较符。
		this.setData({
			keyboardHeight: height,
			scrollAreaStyle:
				height > 0
					? `height: calc(100vh - 124rpx - ${height}px);`
					: "",
			scrollIntoView: "",
		}, () => {
			if (
				getPageLifecycle(this).isActive() &&
				this.data.keyboardHeight === height &&
				this.data.messages.length > 0
			) {
				this.setData({ scrollIntoView: "customer-message-end" });
			}
		});
	},

	onHide() {
		this.setData({ keyboardHeight: 0, scrollAreaStyle: "" });
	},

	onSend() {
		void this.sendMessage();
	},

	async sendMessage() {
		if (this.data.sending) return;
		const message = this.data.inputValue.trim();
		if (!message) {
			wx.showToast({ title: "请先描述您的问题", icon: "none" });
			return;
		}
		const guard = getPageLatestRequestGuard(this, "intelligent-customer");
		const token = guard.begin();
		const userMessage: SmartCustomerMessage = {
			id: nextMessageId(),
			role: "user",
			content: message,
			redirect: "",
			pending: false,
			isError: false,
			errorCode: "",
		};
		const pendingMessage = assistantMessage("正在查询，请稍候…", {
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
			const response: IntelligentCustomerMessageResponse =
				await requestIntelligentCustomerMessage({
					message,
					...(this.data.conversationReference
						? {
								conversationReference:
									this.data.conversationReference,
							}
						: {}),
				});
			if (!guard.isCurrent(token)) return;
			const reply = response.data;
			const completedMessage = assistantMessage(reply.message, {
				redirect: reply.redirect,
			});
			this.setData({
				messages: this.data.messages
					.filter((item) => item.id !== pendingMessage.id)
					.concat(completedMessage),
				conversationReference: reply.conversationReference,
				sending: false,
				error: "",
				scrollIntoView: completedMessage.id,
			});
		} catch (error) {
			if (!guard.isCurrent(token)) return;
			const errorMessage = customerErrorMessage(error);
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

	onRedirectTap(event) {
		const messageId = String(event.currentTarget?.dataset?.messageId ?? "");
		const exists = this.data.messages.some(
			(item) =>
				item.id === messageId &&
				item.role === "assistant" &&
				item.redirect === "ai_guide",
		);
		if (!exists) return;
		wx.navigateTo({ url: "/pages/smart-guide/smart-guide" });
	},

	onRestart() {
		if (this.data.sending) return;
		this.setData({
			messages: [
				assistantMessage(
					"您好，我是高平市人民医院智能客服，可以帮您解答挂号、退费、科室位置、就诊时间等就医服务问题。",
				),
			],
			inputValue: "",
			conversationReference: "",
			error: "",
			scrollIntoView: "",
		});
	},

	onUnload() {
		disposePageInstance(this);
	},
});
