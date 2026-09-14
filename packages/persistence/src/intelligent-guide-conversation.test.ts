import { expect, test } from "bun:test";
import { createRedisIntelligentGuideConversationStore } from "./intelligent-guide-conversation";

test("智能导诊 Redis 映射按 owner 和平台引用隔离", async () => {
	const values = new Map<string, string>();
	const ttls = new Map<string, number>();
	const store = createRedisIntelligentGuideConversationStore({
		get: async (key) => values.get(key) ?? null,
		set: async (key, value, mode, ttl) => {
			expect(mode).toBe("EX");
			values.set(key, value);
			ttls.set(key, ttl);
			return "OK";
		},
	});

	await store.save({
		ownerUserId: "owner-001",
		conversationReference: "reference-001",
		providerConversationId: "provider-001",
		expiresInSeconds: 604_800,
	});

	expect(
		await store.findProviderConversationId({
			ownerUserId: "owner-001",
			conversationReference: "reference-001",
		}),
	).toBe("provider-001");
	expect(
		await store.findProviderConversationId({
			ownerUserId: "owner-002",
			conversationReference: "reference-001",
		}),
	).toBeUndefined();
	expect([...ttls.values()]).toEqual([604_800]);
});
