import { expect, test } from "bun:test";
import type {
	IntelligentCustomerConversationState,
	IntelligentCustomerModelGateway,
	IntelligentGuideSpeechGateway,
	KnowledgeSearchGateway,
	KnowledgeSearchMatch,
} from "@hospital/domain";
import { type AppLogger, createLogger } from "@hospital/observability";
import {
	IntelligentCustomerConversationExpiredError,
	NativeIntelligentCustomerService,
} from "./native-mvp";

const context = {
	traceId: "trace-customer-001",
	idempotencyKey: "customer-001",
};

const match = (chunk: number): KnowledgeSearchMatch => ({
	documentId: "hospital-guide",
	title: "医院指南",
	source: "审核资料",
	chunk,
	content: `医院资料片段 ${chunk}`,
	score: 1,
});

function service(options?: {
	model?: IntelligentCustomerModelGateway;
	knowledge?: KnowledgeSearchGateway;
	speech?: IntelligentGuideSpeechGateway;
	logger?: AppLogger;
}) {
	const states = new Map<string, IntelligentCustomerConversationState>();
	const searched: string[] = [];
	const modelInputs: Array<{
		message: string;
		historyLength: number;
		knowledgeLength: number;
	}> = [];
	const customer = new NativeIntelligentCustomerService({
		conversations: {
			load: async ({ ownerUserId, conversationReference }) =>
				states.get(`${ownerUserId}:${conversationReference}`),
			save: async ({ ownerUserId, conversationReference, state }) => {
				states.set(`${ownerUserId}:${conversationReference}`, state);
			},
		},
		knowledge:
			options?.knowledge ??
			({
				search: async (query) => {
					searched.push(query);
					return { matches: [0, 1, 2, 3, 4].map(match) };
				},
			} satisfies KnowledgeSearchGateway),
		model:
			options?.model ??
			({
				complete: async ({ message, history, knowledge }) => {
					modelInputs.push({
						message,
						historyLength: history.length,
						knowledgeLength: knowledge.length,
					});
					return { message: "请通过医院官方渠道办理。", redirect: "" };
				},
			} satisfies IntelligentCustomerModelGateway),
		...(options?.speech ? { speech: options.speech } : {}),
		...(options?.logger ? { logger: options.logger } : {}),
	});
	return { customer, modelInputs, searched, states };
}

test("客服应用服务先检索审核资料，再调用模型并保存 owner 会话", async () => {
	const fixture = service();

	await expect(
		fixture.customer.chatText(
			"owner-001",
			{ message: "医院怎么预约挂号" },
			context,
		),
	).resolves.toMatchObject({
		userInput: "医院怎么预约挂号",
		message: "请通过医院官方渠道办理。",
		redirect: "",
	});

	expect(fixture.searched).toEqual(["医院怎么预约挂号"]);
	expect(fixture.modelInputs).toEqual([
		{
			message: "医院怎么预约挂号",
			historyLength: 0,
			knowledgeLength: 4,
		},
	]);
});

test("客服应用服务恢复同一 owner 会话并保留导诊跳转白名单", async () => {
	const fixture = service({
		model: {
			complete: async ({ history }) => ({
				message: `已有 ${history.length} 条会话记录，请使用智能导诊。`,
				redirect: "ai_guide",
			}),
		},
	});

	const first = await fixture.customer.chatText(
		"owner-001",
		{ message: "我想咨询挂号" },
		context,
	);
	await expect(
		fixture.customer.chatText(
			"owner-001",
			{
				message: "我有症状应该去哪",
				conversationReference: first.conversationReference,
			},
			context,
		),
	).resolves.toMatchObject({ redirect: "ai_guide" });
});

test("客服应用服务不跨 owner 恢复会话", async () => {
	const fixture = service();
	const first = await fixture.customer.chatText(
		"owner-001",
		{ message: "医院怎么预约" },
		context,
	);

	await expect(
		fixture.customer.chatText(
			"owner-002",
			{
				message: "继续",
				conversationReference: first.conversationReference,
			},
			context,
		),
	).rejects.toBeInstanceOf(IntelligentCustomerConversationExpiredError);
});

test("客服音频先复用 ASR，再进入同一套检索和模型链路", async () => {
	let transcribeCount = 0;
	const fixture = service({
		speech: {
			transcribe: async ({ audio, contentType }) => {
				transcribeCount += 1;
				expect(audio.byteLength).toBe(128);
				expect(contentType).toBe("audio/mpeg");
				return { text: "医院怎么预约挂号" };
			},
		},
	});

	await expect(
		fixture.customer.chatAudio(
			"owner-001",
			{
				audio: new Uint8Array(128),
				contentType: "audio/mpeg",
			},
			context,
		),
	).resolves.toMatchObject({ userInput: "医院怎么预约挂号" });
	expect(transcribeCount).toBe(1);
});

test("客服音频未配置 ASR 或音频越界时 fail-closed", async () => {
	const fixture = service();
	await expect(
		fixture.customer.chatAudio(
			"owner-001",
			{ audio: new Uint8Array(128), contentType: "audio/mpeg" },
			context,
		),
	).rejects.toThrow("intelligent-guide-audio");

	const withSpeech = service({
		speech: {
			transcribe: async () => ({ text: "不会调用" }),
		},
	});
	await expect(
		withSpeech.customer.chatAudio(
			"owner-001",
			{ audio: new Uint8Array(127), contentType: "audio/mpeg" },
			context,
		),
	).rejects.toThrow("Intelligent customer input is invalid");
});

test("客服完成事件只记录审计元数据，不记录用户原文或模型回答", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "intelligent-customer-test",
		environment: "test",
		level: "info",
		destination: { write: (chunk: string) => lines.push(chunk) },
	});
	const fixture = service({ logger });
	const userInput = "用户原文不应进入日志-预约时间 2026-09-16";

	await fixture.customer.chatText("owner-001", { message: userInput }, context);
	const record = JSON.parse(lines.at(-1) ?? "{}") as Record<string, unknown>;

	expect(record).toMatchObject({
		event: "intelligent-customer.native-mvp.completed",
		channel: "text",
		knowledgeMatches: 4,
		inputCodePoints: Array.from(userInput).length,
	});
	expect(JSON.stringify(record)).not.toContain(userInput);
	expect(record).not.toHaveProperty("userInput");
	expect(record).not.toHaveProperty("knowledge");
});
