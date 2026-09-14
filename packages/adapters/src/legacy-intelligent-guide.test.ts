import { expect, test } from "bun:test";
import { LegacyIntelligentGuideApiGateway } from "./legacy-intelligent-guide";

test("旧智能导诊只在服务端请求头携带用户凭证并投影科室推荐", async () => {
	let observedAuthorization = "";
	let observedBody: unknown;
	const gateway = new LegacyIntelligentGuideApiGateway({
		baseUrl: "https://legacy.example/api/v1",
		fetcher: async (input, init) => {
			observedAuthorization =
				new Headers(init?.headers).get("authorization") ?? "";
			observedBody = JSON.parse(String(init?.body));
			expect(String(input)).toBe(
				"https://legacy.example/api/v1/intelligent/outpatient_recommend/chat_text",
			);
			return new Response(
				JSON.stringify({
					code: 0,
					message: "success",
					data: {
						conversation_id: "provider-conversation-001",
						progress: 100,
						message: "",
						departments: [
							{ deptId: "201134", deptName: "普外科", deptCode: "201134" },
						],
						advice: "请及时就医",
					},
				}),
				{ status: 200, headers: { "x-request-id": "legacy-guide-001" } },
			);
		},
	});

	const result = await gateway.chatText(
		{ message: "右下腹疼痛", providerConversationId: "provider-old-001" },
		{ traceId: "trace-guide-001", idempotencyKey: "guide-message-001" },
		{ authorizationToken: "legacy-user-jwt" },
	);

	expect(observedAuthorization).toBe("Bearer legacy-user-jwt");
	expect(observedBody).toEqual({
		message: "右下腹疼痛",
		conversation_id: "provider-old-001",
	});
	expect(result).toEqual({
		providerConversationId: "provider-conversation-001",
		progress: 100,
		departments: [{ departmentId: "201134", displayName: "普外科" }],
		advice: "请及时就医",
		trace: {
			provider: "ai",
			operation: "intelligent-guide-chat-text",
			requestId: "legacy-guide-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("legacy-user-jwt");
});

test("语音导诊使用 multipart 且识别文本只通过受控响应返回", async () => {
	let observedRequest: Request | undefined;
	const gateway = new LegacyIntelligentGuideApiGateway({
		baseUrl: "https://legacy.example/api/v1",
		fetcher: async (input, init) => {
			observedRequest = new Request(input, init);
			return new Response(
				JSON.stringify({
					code: 0,
					data: {
						progress: 40,
						message: "还伴随其他不适吗？",
						user_input: "头痛两天",
						conversation_id: "guide-audio-1",
						departments: [],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	});

	const reply = await gateway.chatAudio(
		{
			audio: new Uint8Array(256).fill(1),
			contentType: "audio/mpeg",
			filename: "voice.mp3",
		},
		{ traceId: "trace-audio", idempotencyKey: "idem-audio" },
		{ authorizationToken: "legacy-token" },
	);

	expect(observedRequest?.headers.get("content-type")).toContain(
		"multipart/form-data; boundary=",
	);
	expect(observedRequest?.headers.get("authorization")).toBe(
		"Bearer legacy-token",
	);
	expect(reply.userInput).toBe("头痛两天");
	expect(reply.trace.operation).toBe("intelligent-guide-chat-audio");
});
