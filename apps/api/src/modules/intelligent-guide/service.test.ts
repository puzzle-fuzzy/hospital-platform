import { expect, test } from "bun:test";
import { IntelligentGuideService } from "./service";

test("智能导诊匹配新旧微信身份并只返回 owner-scoped 平台会话引用", async () => {
	const mappings = new Map<string, string>();
	let providerAuthorization = "";
	const service = new IntelligentGuideService({
		identityUsers: {
			findOrCreateByWechat: async () => ({
				userId: "owner-001",
				providerSubject: "openid-001",
				unionId: "union-001",
			}),
			findByUserId: async () => ({
				userId: "owner-001",
				providerSubject: "openid-001",
				unionId: "union-001",
			}),
		},
		providerAuthorizationGateway: {
			exchangeWechatCode: async () => ({
				authorizationToken: "legacy-jwt-001",
				unionId: "union-001",
				trace: {
					provider: "hospital-his",
					operation: "legacy-wechat-login",
					requestId: "legacy-login-001",
				},
			}),
		},
		guideGateway: {
			chatText: async (input, _context, providerContext) => {
				providerAuthorization = providerContext.authorizationToken;
				expect(input.providerConversationId).toBeUndefined();
				return {
					providerConversationId: "provider-conversation-001",
					progress: 100,
					departments: [{ departmentId: "201134", displayName: "普外科" }],
					trace: {
						provider: "ai",
						operation: "intelligent-guide-chat-text",
						requestId: "guide-provider-001",
					},
				};
			},
			chatAudio: async (input, _context, providerContext) => {
				providerAuthorization = providerContext.authorizationToken;
				expect(input.providerConversationId).toBe("provider-conversation-001");
				expect(input.contentType).toBe("audio/mpeg");
				return {
					providerConversationId: "provider-conversation-002",
					progress: 40,
					message: "还伴随其他不适吗？",
					userInput: "头痛两天",
					departments: [],
					trace: {
						provider: "ai",
						operation: "intelligent-guide-chat-audio",
						requestId: "guide-provider-002",
					},
				};
			},
		},
		conversations: {
			findProviderConversationId: async ({
				ownerUserId,
				conversationReference,
			}) => mappings.get(`${ownerUserId}:${conversationReference}`),
			save: async ({
				ownerUserId,
				conversationReference,
				providerConversationId,
			}) => {
				mappings.set(
					`${ownerUserId}:${conversationReference}`,
					providerConversationId,
				);
			},
		},
	});

	const result = await service.chatText(
		"owner-001",
		{ legacyLoginCode: "wechat-code-001", message: "右下腹疼痛" },
		{ traceId: "trace-guide-001", idempotencyKey: "guide-message-001" },
	);

	expect(providerAuthorization).toBe("legacy-jwt-001");
	expect(result.conversationReference).toMatch(/^[0-9a-f-]{36}$/u);
	expect(result.departments).toEqual([
		{ departmentId: "201134", displayName: "普外科" },
	]);
	expect(mappings.get(`owner-001:${result.conversationReference}`)).toBe(
		"provider-conversation-001",
	);
	expect(JSON.stringify(result)).not.toContain("provider-conversation-001");
	expect(JSON.stringify(result)).not.toContain("legacy-jwt-001");

	const audioResult = await service.chatAudio(
		"owner-001",
		{
			legacyLoginCode: "wechat-code-002",
			conversationReference: result.conversationReference,
			audio: new Uint8Array(256).fill(1),
			contentType: "audio/mpeg",
		},
		{ traceId: "trace-guide-002", idempotencyKey: "guide-audio-001" },
	);
	expect(audioResult.userInput).toBe("头痛两天");
	expect(audioResult.conversationReference).toBe(result.conversationReference);
	expect(mappings.get(`owner-001:${result.conversationReference}`)).toBe(
		"provider-conversation-002",
	);
});
