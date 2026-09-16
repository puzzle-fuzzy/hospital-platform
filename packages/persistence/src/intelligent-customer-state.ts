import type {
	IntelligentCustomerConversationMessage,
	IntelligentCustomerConversationState,
	IntelligentCustomerConversationStateStore,
} from "@hospital/domain";
import {
	INTELLIGENT_CUSTOMER_CONVERSATION_TTL_SECONDS,
	isBoundedOpaqueIdentifier,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "./errors";
import type { RedisSessionClient } from "./redis-session";

const CUSTOMER_STATE_KEY_PREFIX = "hospital:intelligent-customer:native-state:";
const CONVERSATION_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/u;
const MAX_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 4_000;

function key(ownerUserId: string, conversationReference: string): string {
	if (
		!isBoundedOpaqueIdentifier(ownerUserId) ||
		!isBoundedOpaqueIdentifier(conversationReference) ||
		!CONVERSATION_REFERENCE_PATTERN.test(conversationReference)
	) {
		throw new Error("Intelligent customer conversation key is invalid");
	}
	return `${CUSTOMER_STATE_KEY_PREFIX}${ownerUserId}:${conversationReference}`;
}

function normalizeMessage(
	value: unknown,
): IntelligentCustomerConversationMessage {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Intelligent customer conversation message is invalid");
	}
	const record = value as Record<string, unknown>;
	if (record.role !== "user" && record.role !== "assistant") {
		throw new Error("Intelligent customer conversation role is invalid");
	}
	if (
		typeof record.content !== "string" ||
		!record.content ||
		record.content.length > MAX_MESSAGE_LENGTH ||
		Array.from(record.content).some((character) => {
			const code = character.charCodeAt(0);
			return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
		})
	) {
		throw new Error("Intelligent customer conversation content is invalid");
	}
	return { role: record.role, content: record.content };
}

function normalizeState(value: unknown): IntelligentCustomerConversationState {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Intelligent customer conversation state is invalid");
	}
	const messages = (value as Record<string, unknown>).messages;
	if (!Array.isArray(messages) || messages.length > MAX_MESSAGES) {
		throw new Error("Intelligent customer conversation messages are invalid");
	}
	return { messages: messages.map(normalizeMessage) };
}

/** 客服会话使用独立 Redis key，避免与导诊上下文或旧 provider 映射互相读取。 */
export function createRedisIntelligentCustomerConversationStateStore(
	client: RedisSessionClient,
): IntelligentCustomerConversationStateStore {
	return {
		async load(input) {
			try {
				const raw = await client.get(
					key(input.ownerUserId, input.conversationReference),
				);
				return raw ? normalizeState(JSON.parse(raw)) : undefined;
			} catch (error) {
				if (error instanceof Error && error.message.includes("conversation")) {
					throw error;
				}
				if (error instanceof PersistenceUnavailableError) throw error;
				throw new PersistenceUnavailableError("read", error, "redis");
			}
		},
		async save(input) {
			if (
				!Number.isSafeInteger(input.expiresInSeconds) ||
				input.expiresInSeconds < 1 ||
				input.expiresInSeconds > INTELLIGENT_CUSTOMER_CONVERSATION_TTL_SECONDS
			) {
				throw new Error("Intelligent customer conversation TTL is invalid");
			}
			const state = normalizeState(input.state);
			try {
				await client.set(
					key(input.ownerUserId, input.conversationReference),
					JSON.stringify(state),
					"EX",
					input.expiresInSeconds,
				);
			} catch (error) {
				if (error instanceof Error && error.message.includes("conversation")) {
					throw error;
				}
				if (error instanceof PersistenceUnavailableError) throw error;
				throw new PersistenceUnavailableError("write", error, "redis");
			}
		},
	};
}
