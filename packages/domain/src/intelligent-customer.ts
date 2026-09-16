import type { KnowledgeSearchMatch } from "./knowledge-search";
import type { AdapterCallContext } from "./ports";

export const INTELLIGENT_CUSTOMER_MESSAGE_MAX_CODE_POINTS = 50;
export const INTELLIGENT_CUSTOMER_CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type IntelligentCustomerConversationMessage = {
	role: "user" | "assistant";
	content: string;
};

export type IntelligentCustomerConversationState = {
	messages: readonly IntelligentCustomerConversationMessage[];
};

export interface IntelligentCustomerConversationStateStore {
	load(input: {
		ownerUserId: string;
		conversationReference: string;
	}): Promise<IntelligentCustomerConversationState | undefined>;
	save(input: {
		ownerUserId: string;
		conversationReference: string;
		state: IntelligentCustomerConversationState;
		expiresInSeconds: number;
	}): Promise<void>;
}

export type IntelligentCustomerReply = {
	message: string;
	redirect: "" | "ai_guide";
};

/**
 * 智能客服模型端口与导诊模型端口分开，避免客服 prompt、跳转意图和科室
 * 推荐结构互相污染。知识分块只在本次调用中提供，不由模型层持久化。
 */
export interface IntelligentCustomerModelGateway {
	complete(
		input: {
			message: string;
			history: readonly IntelligentCustomerConversationMessage[];
			knowledge: readonly KnowledgeSearchMatch[];
		},
		context: AdapterCallContext,
	): Promise<IntelligentCustomerReply>;
}

export interface IntelligentCustomerApplicationService {
	chatText(
		ownerUserId: string,
		input: {
			message: string;
			conversationReference?: string;
		},
		context: AdapterCallContext,
	): Promise<{
		conversationReference: string;
		userInput: string;
		message: string;
		redirect: "" | "ai_guide";
	}>;
	chatAudio(
		ownerUserId: string,
		input: {
			audio: Uint8Array;
			contentType: string;
			conversationReference?: string;
		},
		context: AdapterCallContext,
	): Promise<{
		conversationReference: string;
		userInput: string;
		message: string;
		redirect: "" | "ai_guide";
	}>;
}
