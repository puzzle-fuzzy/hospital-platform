import { expect, test } from "bun:test";
import { createRedisIntelligentCustomerConversationStateStore } from "./intelligent-customer-state";

test("客服会话使用独立 owner key 并保留 TTL", async () => {
	const values = new Map<string, string>();
	const ttls = new Map<string, number>();
	const store = createRedisIntelligentCustomerConversationStateStore({
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
				{ role: "user", content: "医院怎么预约挂号" },
				{ role: "assistant", content: "请通过医院官方渠道预约挂号。" },
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
			{ role: "user", content: "医院怎么预约挂号" },
			{ role: "assistant", content: "请通过医院官方渠道预约挂号。" },
		],
	});
	expect([...values.keys()]).toEqual([
		"hospital:intelligent-customer:native-state:owner-001:reference-001",
	]);
	expect([...ttls.values()]).toEqual([604_800]);
});

test("客服会话拒绝过长状态和超过七天的 TTL", async () => {
	const store = createRedisIntelligentCustomerConversationStateStore({
		get: async () => null,
		set: async () => "OK",
	});

	await expect(
		store.save({
			ownerUserId: "owner-001",
			conversationReference: "reference-001",
			state: {
				messages: Array.from({ length: 11 }, () => ({
					role: "user" as const,
					content: "x",
				})),
			},
			expiresInSeconds: 60,
		}),
	).rejects.toThrow("conversation messages are invalid");

	await expect(
		store.save({
			ownerUserId: "owner-001",
			conversationReference: "reference-001",
			state: { messages: [] },
			expiresInSeconds: 604_801,
		}),
	).rejects.toThrow("conversation TTL is invalid");
});
