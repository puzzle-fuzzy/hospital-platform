import { expect, test } from "bun:test";
import type {
	IntelligentGuideConversationState,
	IntelligentGuideConversationStateStore,
} from "@hospital/domain";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { NativeIntelligentGuideService } from "./native-mvp";
import { IntelligentGuideConversationExpiredError } from "./service";

function createStateStore(): IntelligentGuideConversationStateStore {
	const states = new Map<string, IntelligentGuideConversationState>();
	return {
		async load({ ownerUserId, conversationReference }) {
			return states.get(`${ownerUserId}:${conversationReference}`);
		},
		async save({ ownerUserId, conversationReference, state }) {
			states.set(`${ownerUserId}:${conversationReference}`, state);
		},
	};
}

function noSchedules() {
	return async () => {
		throw new Error("not used by native guide MVP");
	};
}

test("native TS guide asks first and recommends only a live HIS department", async () => {
	const stateStore = createStateStore();
	let directoryCalls = 0;
	const service = new NativeIntelligentGuideService({
		conversations: stateStore,
		now: () => new Date("2026-09-16T00:00:00.000Z"),
		directory: {
			async listDepartments(input) {
				directoryCalls += 1;
				expect(input.startDate).toBe("2026-09-16");
				expect(input.endDate).toBe("2026-10-16");
				return {
					departments: [
						{ departmentId: "dept-neuro", displayName: "神经内科" },
						{ departmentId: "dept-cardio", displayName: "心内科" },
					],
					trace: {
						provider: "zhongyang",
						operation: "appointment-departments",
						requestId: "directory-001",
					},
				};
			},
			listSchedules: noSchedules(),
		},
	});
	const context = {
		traceId: "trace-guide-mvp-001",
		idempotencyKey: "guide-mvp-001",
	};

	const first = await service.chatText(
		"owner-001",
		{ message: "我有点不舒服" },
		context,
	);
	expect(first.progress).toBe(20);
	expect(first.departments).toEqual([]);
	expect(first.message).toContain("主要不适");
	expect(directoryCalls).toBe(0);

	const second = await service.chatText(
		"owner-001",
		{
			conversationReference: first.conversationReference,
			message: "头痛两天",
		},
		{
			...context,
			traceId: "trace-guide-mvp-002",
			idempotencyKey: "guide-mvp-002",
		},
	);
	expect(second.progress).toBe(100);
	expect(second.departments).toEqual([
		{ departmentId: "dept-neuro", displayName: "神经内科" },
	]);
	expect(directoryCalls).toBe(1);
});

test("native TS guide does not revive a missing owner-scoped conversation", async () => {
	const service = new NativeIntelligentGuideService({
		conversations: createStateStore(),
		directory: {
			async listDepartments() {
				return {
					departments: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-departments",
						requestId: "directory-002",
					},
				};
			},
			listSchedules: noSchedules(),
		},
	});

	await expect(
		service.chatText(
			"owner-001",
			{ conversationReference: "expired-reference", message: "头痛" },
			{ traceId: "trace-guide-mvp-003", idempotencyKey: "guide-mvp-003" },
		),
	).rejects.toBeInstanceOf(IntelligentGuideConversationExpiredError);
});

test("native TS guide keeps audio fail-closed until an ASR runtime is configured", async () => {
	const service = new NativeIntelligentGuideService({
		conversations: createStateStore(),
		directory: {
			async listDepartments() {
				return {
					departments: [],
					trace: { provider: "test", operation: "test", requestId: "test" },
				};
			},
			listSchedules: noSchedules(),
		},
	});

	await expect(
		service.chatAudio(
			"owner-001",
			{ audio: new Uint8Array(128), contentType: "audio/mpeg" },
			{ traceId: "trace-guide-mvp-004", idempotencyKey: "guide-mvp-004" },
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});

test("native TS guide sends Python ASR text through the same guide flow", async () => {
	const stateStore = createStateStore();
	let transcribeCalls = 0;
	let directoryCalls = 0;
	const service = new NativeIntelligentGuideService({
		conversations: stateStore,
		model: {
			async complete(input) {
				expect(input.message).toBe("头痛两天");
				return {
					message: "建议优先选择相关科室",
					departmentNames: ["神经内科"],
				};
			},
		},
		speech: {
			async transcribe(input) {
				transcribeCalls += 1;
				expect(input.contentType).toBe("audio/mpeg");
				expect(input.audio.byteLength).toBe(128);
				return { text: "头痛两天" };
			},
		},
		directory: {
			async listDepartments() {
				directoryCalls += 1;
				return {
					departments: [
						{ departmentId: "dept-neuro", displayName: "神经内科" },
					],
					trace: {
						provider: "test",
						operation: "departments",
						requestId: "directory-audio-001",
					},
				};
			},
			listSchedules: noSchedules(),
		},
	});

	const reply = await service.chatAudio(
		"owner-audio-001",
		{ audio: new Uint8Array(128), contentType: "audio/mpeg" },
		{ traceId: "trace-audio-001", idempotencyKey: "audio-001" },
	);

	expect(reply.userInput).toBe("头痛两天");
	expect(reply.departments).toEqual([
		{ departmentId: "dept-neuro", displayName: "神经内科" },
	]);
	expect(transcribeCalls).toBe(1);
	expect(directoryCalls).toBe(1);
});

test("native TS guide rejects an invalid model response before directory lookup", async () => {
	let directoryCalls = 0;
	const service = new NativeIntelligentGuideService({
		conversations: createStateStore(),
		model: {
			async complete() {
				return {
					message: "模型返回了\u0000不可展示内容",
					departmentNames: ["神经内科"],
				};
			},
		},
		directory: {
			async listDepartments() {
				directoryCalls += 1;
				return {
					departments: [],
					trace: {
						provider: "test",
						operation: "test",
						requestId: "test",
					},
				};
			},
			listSchedules: noSchedules(),
		},
	});

	await expect(
		service.chatText(
			"owner-001",
			{ message: "头痛" },
			{ traceId: "trace-guide-mvp-005", idempotencyKey: "guide-mvp-005" },
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	expect(directoryCalls).toBe(0);
});
