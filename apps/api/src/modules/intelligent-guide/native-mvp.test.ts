import { expect, test } from "bun:test";
import type {
	IntelligentGuideConversationState,
	IntelligentGuideConversationStateStore,
	IntelligentGuideModelGateway,
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
	expect(first.progress).toBe(0);
	expect(first.departments).toEqual([]);
	expect(first.message).toContain("主要不适");
	expect(directoryCalls).toBe(1);

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
	expect(directoryCalls).toBe(2);
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

test("native TS guide rejects an invalid model response after loading the directory", async () => {
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
	expect(directoryCalls).toBe(1);
});

const guideContext = {
	traceId: "trace-guide-matching",
	idempotencyKey: "guide-matching",
};

function matchingService(input: {
	departments: { departmentId: string; displayName: string }[];
	model: IntelligentGuideModelGateway;
	conversations?: IntelligentGuideConversationStateStore;
}) {
	return new NativeIntelligentGuideService({
		conversations: input.conversations ?? createStateStore(),
		model: input.model,
		directory: {
			async listDepartments() {
				return {
					departments: input.departments,
					trace: {
						provider: "test",
						operation: "departments",
						requestId: "guide-directory",
					},
				};
			},
			listSchedules: noSchedules(),
		},
	});
}

test("native TS guide provides the live directory before the first model turn and projects only routing fields", async () => {
	const service = matchingService({
		departments: [
			{
				departmentId: "resp-main",
				displayName: "呼吸与危重症医学门诊",
				departmentCode: "provider-internal-code",
				location: "provider-location",
			} as { departmentId: string; displayName: string },
		],
		model: {
			async complete(input) {
				expect(input.history).toEqual([]);
				expect(input.availableDepartments).toEqual([
					{
						departmentId: "resp-main",
						displayName: "呼吸与危重症医学门诊",
					},
				]);
				return {
					message: "建议选择本院呼吸与危重症医学门诊。",
					departmentNames: ["呼吸与危重症医学门诊"],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-directory",
		{ message: "发烧伴咳嗽三天" },
		guideContext,
	);
	expect(reply.departments).toEqual([
		{ departmentId: "resp-main", displayName: "呼吸与危重症医学门诊" },
	]);
});

test("native TS guide keeps symptoms and patient corrections across turns", async () => {
	let calls = 0;
	const service = matchingService({
		departments: [
			{ departmentId: "resp-main", displayName: "呼吸与危重症医学门诊" },
		],
		model: {
			async complete(input) {
				calls += 1;
				if (calls === 1) {
					return {
						message: "体温多少，持续多久了？",
						departmentNames: [],
					};
				}
				expect(input.history).toEqual([
					{ role: "user", content: "我发烧了，还有咳嗽" },
					{ role: "assistant", content: "体温多少，持续多久了？" },
				]);
				expect(input.message).toBe("三天，38.2度，不是胸痛是全身酸痛");
				return {
					message: "已了解发热和咳嗽持续三天，并有全身酸痛。",
					departmentNames: ["呼吸与危重症医学门诊"],
				};
			},
		},
	});
	const first = await service.chatText(
		"owner-multi-turn",
		{ message: "我发烧了，还有咳嗽" },
		guideContext,
	);
	const second = await service.chatText(
		"owner-multi-turn",
		{
			conversationReference: first.conversationReference,
			message: "三天，38.2度，不是胸痛是全身酸痛",
		},
		guideContext,
	);
	expect(second.message).toContain("三天");
	expect(second.departments[0]?.departmentId).toBe("resp-main");
});

test("native TS guide continues beyond five turns with a bounded sliding history", async () => {
	const conversations = createStateStore();
	let calls = 0;
	const service = matchingService({
		departments: [],
		conversations,
		model: {
			async complete(input) {
				calls += 1;
				expect(input.history.length).toBe(Math.min((calls - 1) * 2, 18));
				if (calls === 12) {
					expect(input.history[0]).toEqual({
						role: "user",
						content: "第3轮补充",
					});
				}
				return { message: "请描述目前最主要的不适。", departmentNames: [] };
			},
		},
	});
	let reference: string | undefined;
	for (let turn = 1; turn <= 12; turn += 1) {
		const reply = await service.chatText(
			"owner-long-history",
			{
				message: `第${turn}轮补充`,
				...(reference ? { conversationReference: reference } : {}),
			},
			guideContext,
		);
		reference = reply.conversationReference;
		expect(reply.progress).toBe(0);
	}
	const state = await conversations.load({
		ownerUserId: "owner-long-history",
		conversationReference: reference ?? "",
	});
	expect(state?.messages.length).toBe(20);
	expect(state?.messages.at(-2)).toEqual({
		role: "user",
		content: "第12轮补充",
	});
});

for (const example of [
	{ actual: "心血管内科门诊", candidate: "心内科" },
	{ actual: "呼吸与危重症医学门诊", candidate: "呼吸内科" },
	{ actual: "普外科门诊", candidate: "普通外科" },
	{ actual: "神经内科门诊", candidate: " 神经 内科 " },
	{
		actual: "心血管内科门诊（神农院区）",
		candidate: "心血管内科门诊(神农院区)",
	},
]) {
	test(`native TS guide resolves a unique controlled department name: ${example.candidate}`, async () => {
		const service = matchingService({
			departments: [
				{ departmentId: "actual-dept", displayName: example.actual },
			],
			model: {
				async complete() {
					return {
						message: "建议选择以下科室。",
						departmentNames: [example.candidate],
					};
				},
			},
		});
		const reply = await service.chatText(
			"owner-alias",
			{ message: "咨询门诊" },
			guideContext,
		);
		expect(reply.departments).toEqual([
			{ departmentId: "actual-dept", displayName: example.actual },
		]);
	});
}

for (const example of [
	{ names: ["神经内科门诊"], candidate: "内科" },
	{ names: ["心血管内科门诊"], candidate: "外科" },
	{ names: ["消化内科门诊(肝病门诊)"], candidate: "消化内科" },
	{ names: ["神经内科门诊（神农院区）"], candidate: "神经内科" },
	{ names: ["妇产科门诊"], candidate: "妇科" },
	{ names: ["心血管内科门诊", "心血管内科"], candidate: "心内科" },
	{ names: ["儿科门诊", "儿科门诊"], candidate: "儿科" },
]) {
	test(`native TS guide refuses broad, qualified or ambiguous matches: ${example.candidate}/${example.names.join(",")}`, async () => {
		const service = matchingService({
			departments: example.names.map((displayName, index) => ({
				departmentId: `dept-${index}`,
				displayName,
			})),
			model: {
				async complete() {
					return {
						message: `建议挂${example.candidate}。`,
						departmentNames: [example.candidate],
					};
				},
			},
		});
		const reply = await service.chatText(
			"owner-unresolved",
			{ message: "咨询门诊" },
			guideContext,
		);
		expect(reply.departments).toEqual([]);
		expect(reply.message).toContain("门诊导诊台");
		expect(reply.message).not.toContain("请补充");
		expect(reply.message).not.toContain(`建议挂${example.candidate}`);
	});
}

test("native TS guide chooses an exact department ahead of aliases and removes duplicate recommendations", async () => {
	const service = matchingService({
		departments: [
			{ departmentId: "cardio-1", displayName: "心内科门诊" },
			{ departmentId: "cardio-2", displayName: "心血管内科门诊" },
		],
		model: {
			async complete() {
				return {
					message: "建议优先选择心内科门诊。",
					departmentNames: ["心内科", "心内科门诊"],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-exact",
		{ message: "咨询门诊" },
		guideContext,
	);
	expect(reply.departments).toEqual([
		{ departmentId: "cardio-1", displayName: "心内科门诊" },
	]);
});

test("native TS guide never repeats an unverified recommendation when only some candidates resolve", async () => {
	const service = matchingService({
		departments: [
			{ departmentId: "resp-main", displayName: "呼吸与危重症医学门诊" },
		],
		model: {
			async complete() {
				return {
					message: "建议挂呼吸内科或不存在专科。",
					departmentNames: ["呼吸内科", "不存在专科"],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-partial",
		{ message: "发热三天" },
		guideContext,
	);
	expect(reply.departments).toEqual([
		{ departmentId: "resp-main", displayName: "呼吸与危重症医学门诊" },
	]);
	expect(reply.message).not.toContain("不存在专科");
	expect(reply.progress).toBe(100);
});

test("native TS guide cannot load another owner's multi-turn history", async () => {
	let calls = 0;
	const service = matchingService({
		departments: [],
		model: {
			async complete() {
				calls += 1;
				return { message: "请描述主要不适。", departmentNames: [] };
			},
		},
	});
	const first = await service.chatText(
		"owner-one",
		{ message: "发热三天" },
		guideContext,
	);
	await expect(
		service.chatText(
			"owner-two",
			{
				message: "继续上次导诊",
				conversationReference: first.conversationReference,
			},
			guideContext,
		),
	).rejects.toBeInstanceOf(IntelligentGuideConversationExpiredError);
	expect(calls).toBe(1);
});

test("native TS guide accepts plain paragraph breaks from a model and persists the response", async () => {
	const conversations = createStateStore();
	const service = matchingService({
		departments: [],
		conversations,
		model: {
			async complete() {
				return {
					message: "已了解您发热三天。\n目前体温多少，是否伴有咳嗽？",
					departmentNames: [],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-paragraph",
		{ message: "发热三天" },
		guideContext,
	);
	expect(reply.message).toContain("\n");
	const state = await conversations.load({
		ownerUserId: "owner-paragraph",
		conversationReference: reply.conversationReference,
	});
	expect(state?.messages.at(-1)?.content).toBe(reply.message);
});

test("native TS guide excludes test and treatment-room entries even when the model recommends them", async () => {
	const service = matchingService({
		departments: [
			{ departmentId: "test-guide", displayName: "测试门诊" },
			{ departmentId: "test-guide-nested", displayName: "专科测试门诊" },
			{ departmentId: "treatment-room", displayName: "门诊治疗室" },
			{ departmentId: "oral-clinic", displayName: "口腔科门诊" },
			{ departmentId: "convenience-clinic", displayName: "方便门诊" },
		],
		model: {
			async complete(input) {
				expect(input.availableDepartments).toEqual([
					{ departmentId: "oral-clinic", displayName: "口腔科门诊" },
					{ departmentId: "convenience-clinic", displayName: "方便门诊" },
				]);
				return {
					message: "建议挂测试门诊或门诊治疗室。",
					departmentNames: ["测试门诊", "专科测试门诊", "门诊治疗室"],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-nonclinical",
		{ message: "咨询门诊" },
		guideContext,
	);
	expect(reply.departments).toEqual([]);
	expect(reply.message).toContain("门诊导诊台");
	expect(reply.message).not.toContain("测试门诊");
	expect(reply.message).not.toContain("门诊治疗室");
});

test("native TS guide keeps ordinary and convenience clinics eligible after excluding nonclinical entries", async () => {
	const service = matchingService({
		departments: [
			{ departmentId: "test-guide", displayName: "测试门诊" },
			{ departmentId: "treatment-room", displayName: "门诊治疗室" },
			{ departmentId: "oral-clinic", displayName: "口腔科门诊" },
			{ departmentId: "convenience-clinic", displayName: "方便门诊" },
		],
		model: {
			async complete() {
				return {
					message: "以下为本院当前可预约的门诊。",
					departmentNames: ["口腔科门诊", "方便门诊"],
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-clinical",
		{ message: "咨询门诊" },
		guideContext,
	);
	expect(reply.departments).toEqual([
		{ departmentId: "oral-clinic", displayName: "口腔科门诊" },
		{ departmentId: "convenience-clinic", displayName: "方便门诊" },
	]);
	expect(reply.progress).toBe(100);
});

for (const departmentNames of [[], ["急诊科"], ["急诊科", "心血管内科门诊"]]) {
	test(`native TS guide preserves emergency routing ahead of unmatched or partial ordinary matches: ${departmentNames.join(",")}`, async () => {
		const service = matchingService({
			departments: [
				{ departmentId: "cardio-clinic", displayName: "心血管内科门诊" },
			],
			model: {
				async complete() {
					return {
						message: "有急危重症表现，应立即到急诊，不要等待门诊。",
						departmentNames,
						urgent: true,
					};
				},
			},
		});
		const reply = await service.chatText(
			"owner-emergency",
			{ message: "胸痛伴呼吸困难，快要晕倒" },
			guideContext,
		);
		expect(reply.departments).toEqual([]);
		expect(reply.message).toBe(
			"根据您描述的情况，请立即前往急诊或拨打120，不要等待普通门诊挂号。",
		);
		expect(reply.message).not.toContain("门诊导诊台");
		expect(reply.message).not.toContain("暂未");
	});
}

test("native TS guide keeps ordinary department matching for explicit urgent false", async () => {
	const service = matchingService({
		departments: [{ departmentId: "oral-clinic", displayName: "口腔科门诊" }],
		model: {
			async complete() {
				return {
					message: "可以优先考虑本院口腔科门诊。",
					departmentNames: ["口腔科门诊"],
					urgent: false,
				};
			},
		},
	});
	const reply = await service.chatText(
		"owner-nonurgent",
		{ message: "牙疼两天，想咨询挂号科室" },
		guideContext,
	);
	expect(reply.departments).toEqual([
		{ departmentId: "oral-clinic", displayName: "口腔科门诊" },
	]);
	expect(reply.message).toBe("可以优先考虑本院口腔科门诊。");
});

test("native TS guide rejects a nonboolean urgency field instead of treating it as a routing flag", async () => {
	const service = matchingService({
		departments: [],
		model: {
			async complete() {
				return {
					message: "模型回复",
					departmentNames: [],
					urgent: "true",
				} as unknown as Awaited<
					ReturnType<IntelligentGuideModelGateway["complete"]>
				>;
			},
		},
	});
	await expect(
		service.chatText(
			"owner-invalid-urgency",
			{ message: "咨询门诊" },
			guideContext,
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
});
