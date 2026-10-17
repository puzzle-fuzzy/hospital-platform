import { expect, test } from "bun:test";
import { INTELLIGENT_GUIDE_HISTORY_MAX_MESSAGES } from "@hospital/domain";
import { createRedisIntelligentGuideConversationStateStore } from "./intelligent-guide-state";

test("原生 TS 导诊会话按 owner 隔离并保留 TTL", async () => {
	const values = new Map<string, string>();
	const ttls = new Map<string, number>();
	const store = createRedisIntelligentGuideConversationStateStore({
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
		state: {
			messages: [
				{ role: "user", content: "我有点不舒服" },
				{ role: "assistant", content: "请描述主要不适和持续时间" },
			],
		},
		expiresInSeconds: 604_800,
	});

	expect(
		await store.load({
			ownerUserId: "owner-001",
			conversationReference: "reference-001",
		}),
	).toEqual({
		messages: [
			{ role: "user", content: "我有点不舒服" },
			{ role: "assistant", content: "请描述主要不适和持续时间" },
		],
	});
	expect(
		await store.load({
			ownerUserId: "owner-002",
			conversationReference: "reference-001",
		}),
	).toBeUndefined();
	expect([...ttls.values()]).toEqual([604_800]);
});

test("原生 TS 导诊会话拒绝过长或非法状态", async () => {
	const store = createRedisIntelligentGuideConversationStateStore({
		get: async () => null,
		set: async () => "OK",
	});

	await expect(
		store.save({
			ownerUserId: "owner-001",
			conversationReference: "reference-001",
			state: {
				messages: Array.from(
					{ length: INTELLIGENT_GUIDE_HISTORY_MAX_MESSAGES + 1 },
					() => ({
						role: "user" as const,
						content: "x",
					}),
				),
			},
			expiresInSeconds: 60,
		}),
	).rejects.toThrow("conversation messages are invalid");
});

test("原生 TS 导诊可保存十轮上下文并读取升级前的五轮会话", async () => {
	let serialized: string | null = null;
	const store = createRedisIntelligentGuideConversationStateStore({
		get: async () => serialized,
		set: async (_key, value) => {
			serialized = value;
			return "OK";
		},
	});
	const messages = Array.from(
		{ length: INTELLIGENT_GUIDE_HISTORY_MAX_MESSAGES },
		(_, index) => ({
			role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
			content: `合成上下文 ${index}`,
		}),
	);
	await store.save({
		ownerUserId: "synthetic-owner",
		conversationReference: "synthetic-reference",
		state: { messages },
		expiresInSeconds: 60,
	});
	expect(
		await store.load({
			ownerUserId: "synthetic-owner",
			conversationReference: "synthetic-reference",
		}),
	).toEqual({ messages });
	serialized = JSON.stringify({ messages: messages.slice(0, 10) });
	expect(
		await store.load({
			ownerUserId: "synthetic-owner",
			conversationReference: "synthetic-reference",
		}),
	).toEqual({ messages: messages.slice(0, 10) });
});
