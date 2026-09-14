import type { IntelligentGuideConversationStore } from "@hospital/domain";
import { isBoundedOpaqueIdentifier } from "@hospital/domain";
import { PersistenceUnavailableError } from "./errors";
import type { RedisSessionClient } from "./redis-session";

const GUIDE_CONVERSATION_KEY_PREFIX =
	"hospital:intelligent-guide:conversation:";
const PROVIDER_CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/u;

function requireIdentifier(value: string, field: string): string {
	if (!isBoundedOpaqueIdentifier(value)) {
		throw new Error(`Intelligent guide ${field} is invalid`);
	}
	return value;
}

function requireProviderConversationId(value: string): string {
	if (
		!value ||
		value !== value.trim() ||
		value.length > 128 ||
		!PROVIDER_CONVERSATION_ID_PATTERN.test(value)
	) {
		throw new Error("Intelligent guide provider conversation id is invalid");
	}
	return value;
}

function key(ownerUserId: string, conversationReference: string): string {
	return `${GUIDE_CONVERSATION_KEY_PREFIX}${requireIdentifier(ownerUserId, "owner")}:${requireIdentifier(conversationReference, "reference")}`;
}

/**
 * Redis 只保存 owner-scoped 的平台引用到旧会话 ID 映射，不保存聊天内容、
 * 微信 code、JWT、患者资料或 AI 回复。
 */
export function createRedisIntelligentGuideConversationStore(
	client: RedisSessionClient,
): IntelligentGuideConversationStore {
	return {
		async findProviderConversationId(input) {
			try {
				const value = await client.get(
					key(input.ownerUserId, input.conversationReference),
				);
				return value ? requireProviderConversationId(value) : undefined;
			} catch (error) {
				if (error instanceof PersistenceUnavailableError) throw error;
				if (error instanceof Error && error.message.includes("is invalid")) {
					throw error;
				}
				throw new PersistenceUnavailableError("read", error, "redis");
			}
		},
		async save(input) {
			if (
				!Number.isSafeInteger(input.expiresInSeconds) ||
				input.expiresInSeconds < 1
			) {
				throw new Error("Intelligent guide conversation TTL is invalid");
			}
			try {
				await client.set(
					key(input.ownerUserId, input.conversationReference),
					requireProviderConversationId(input.providerConversationId),
					"EX",
					input.expiresInSeconds,
				);
			} catch (error) {
				if (error instanceof PersistenceUnavailableError) throw error;
				if (error instanceof Error && error.message.includes("is invalid")) {
					throw error;
				}
				throw new PersistenceUnavailableError("write", error, "redis");
			}
		},
	};
}
