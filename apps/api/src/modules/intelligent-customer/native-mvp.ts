import type { IntelligentCustomerMessageRequestPayload } from "@hospital/contracts";
import type {
	AdapterCallContext,
	IntelligentCustomerApplicationService,
	IntelligentCustomerConversationMessage,
	IntelligentCustomerConversationStateStore,
	IntelligentCustomerModelGateway,
	IntelligentGuideSpeechGateway,
	KnowledgeSearchGateway,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	INTELLIGENT_CUSTOMER_CONVERSATION_TTL_SECONDS,
	INTELLIGENT_CUSTOMER_MESSAGE_MAX_CODE_POINTS,
	INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES,
	INTELLIGENT_GUIDE_AUDIO_MAX_BYTES,
	INTELLIGENT_GUIDE_AUDIO_MIN_BYTES,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

const MAX_CUSTOMER_TURNS = 5;
const MAX_MODEL_MESSAGE_CODE_POINTS = 4_000;
const CONVERSATION_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export class IntelligentCustomerConversationExpiredError extends Error {
	readonly code = "intelligent-customer-conversation-expired" as const;

	constructor() {
		super("Intelligent customer conversation has expired");
		this.name = "IntelligentCustomerConversationExpiredError";
	}
}

export class IntelligentCustomerInputError extends Error {
	readonly code = "intelligent-customer-invalid" as const;

	constructor() {
		super("Intelligent customer input is invalid");
		this.name = "IntelligentCustomerInputError";
	}
}

function safeContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) throw new IntelligentCustomerInputError();
	return context;
}

function requireOwner(ownerUserId: string): string {
	if (!isBoundedOpaqueIdentifier(ownerUserId)) {
		throw new IntelligentCustomerInputError();
	}
	return ownerUserId;
}

function requireReference(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (
		typeof value !== "string" ||
		!isBoundedOpaqueIdentifier(value) ||
		!CONVERSATION_REFERENCE_PATTERN.test(value)
	) {
		throw new IntelligentCustomerInputError();
	}
	return value;
}

function requireMessage(value: unknown): string {
	if (typeof value !== "string") throw new IntelligentCustomerInputError();
	const message = value.trim();
	if (
		!message ||
		Array.from(message).length > INTELLIGENT_CUSTOMER_MESSAGE_MAX_CODE_POINTS ||
		Array.from(message).some((character) => {
			const code = character.charCodeAt(0);
			return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
		})
	) {
		throw new IntelligentCustomerInputError();
	}
	return message;
}

function hasControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const code = character.charCodeAt(0);
		return code <= 0x1f || code === 0x7f;
	});
}

function normalizeReply(value: unknown): {
	message: string;
	redirect: "" | "ai_guide";
} {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new DependencyNotConfiguredError("intelligent-customer-model");
	}
	const reply = value as Record<string, unknown>;
	const message = reply.message;
	const redirect = reply.redirect;
	if (
		typeof message !== "string" ||
		!message.trim() ||
		Array.from(message).length > MAX_MODEL_MESSAGE_CODE_POINTS ||
		hasControlCharacter(message) ||
		(redirect !== "" && redirect !== "ai_guide")
	) {
		throw new DependencyNotConfiguredError("intelligent-customer-model");
	}
	return { message: message.trim(), redirect };
}

export type NativeIntelligentCustomerServiceDependencies = {
	conversations: IntelligentCustomerConversationStateStore;
	knowledge: KnowledgeSearchGateway;
	model: IntelligentCustomerModelGateway;
	speech?: IntelligentGuideSpeechGateway;
	logger?: AppLogger;
};

/**
 * 客服文本 MVP：owner 会话、知识检索和模型调用均由 TS 编排。
 * Python 只接收临时的审核资料和对话历史，不拥有患者身份或会话存储。
 */
export class NativeIntelligentCustomerService
	implements IntelligentCustomerApplicationService
{
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: NativeIntelligentCustomerServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async loadHistory(
		owner: string,
		reference: string | undefined,
	): Promise<IntelligentCustomerConversationMessage[]> {
		if (!reference) return [];
		const state = await this.dependencies.conversations.load({
			ownerUserId: owner,
			conversationReference: reference,
		});
		if (!state) throw new IntelligentCustomerConversationExpiredError();
		return [...state.messages];
	}

	private async completeMessage(
		owner: string,
		message: string,
		reference: string | undefined,
		traceContext: AdapterCallContext,
		channel: "text" | "audio",
	): Promise<{
		conversationReference: string;
		userInput: string;
		message: string;
		redirect: "" | "ai_guide";
	}> {
		const history = await this.loadHistory(owner, reference);
		const turns = history.filter((item) => item.role === "user").length + 1;
		if (turns > MAX_CUSTOMER_TURNS) throw new IntelligentCustomerInputError();

		const searchResult = await this.dependencies.knowledge.search(
			message,
			traceContext,
		);
		const modelReply = normalizeReply(
			await this.dependencies.model.complete(
				{
					message,
					history,
					knowledge: searchResult.matches.slice(0, 4),
				},
				traceContext,
			),
		);
		const nextHistory: IntelligentCustomerConversationMessage[] = [
			...history,
			{ role: "user", content: message },
			{ role: "assistant", content: modelReply.message },
		];
		const conversationReference = reference ?? crypto.randomUUID();
		await this.dependencies.conversations.save({
			ownerUserId: owner,
			conversationReference,
			state: { messages: nextHistory },
			expiresInSeconds: INTELLIGENT_CUSTOMER_CONVERSATION_TTL_SECONDS,
		});

		this.logger.info(
			{
				event: "intelligent-customer.native-mvp.completed",
				traceId: adapterContextTraceId(traceContext),
				conversationReference,
				channel,
				turns,
				knowledgeMatches: Math.min(searchResult.matches.length, 4),
				inputCodePoints: Array.from(message).length,
				redirect: modelReply.redirect,
			},
			"intelligent customer completed",
		);

		return {
			conversationReference,
			userInput: message,
			message: modelReply.message,
			redirect: modelReply.redirect,
		};
	}

	async chatText(
		ownerUserId: string,
		input: IntelligentCustomerMessageRequestPayload,
		context: AdapterCallContext,
	): Promise<{
		conversationReference: string;
		userInput: string;
		message: string;
		redirect: "" | "ai_guide";
	}> {
		const owner = requireOwner(ownerUserId);
		const traceContext = safeContext(context);
		const message = requireMessage(input.message);
		const reference = requireReference(input.conversationReference);
		return this.completeMessage(
			owner,
			message,
			reference,
			traceContext,
			"text",
		);
	}

	async chatAudio(
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
	}> {
		const owner = requireOwner(ownerUserId);
		const traceContext = safeContext(context);
		if (
			!(input.audio instanceof Uint8Array) ||
			input.audio.byteLength < INTELLIGENT_GUIDE_AUDIO_MIN_BYTES ||
			input.audio.byteLength > INTELLIGENT_GUIDE_AUDIO_MAX_BYTES ||
			typeof input.contentType !== "string" ||
			!INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES.includes(
				input.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number],
			)
		) {
			throw new IntelligentCustomerInputError();
		}
		if (!this.dependencies.speech) {
			throw new DependencyNotConfiguredError("intelligent-guide-audio");
		}
		const transcription = await this.dependencies.speech.transcribe(
			{
				audio: input.audio,
				contentType:
					input.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number],
			},
			traceContext,
		);
		const message = requireMessage(transcription.text);
		const reference = requireReference(input.conversationReference);
		return this.completeMessage(
			owner,
			message,
			reference,
			traceContext,
			"audio",
		);
	}
}
