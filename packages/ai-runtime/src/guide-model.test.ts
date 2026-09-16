import { expect, test } from "bun:test";
import { MvpIntelligentGuideModel } from "./guide-model";

const context = {
	traceId: "trace-ai-runtime-001",
	idempotencyKey: "ai-runtime-001",
};

test("MVP guide model asks for symptoms on the first turn", async () => {
	const model = new MvpIntelligentGuideModel();

	await expect(
		model.complete({ message: "我不舒服", history: [] }, context),
	).resolves.toEqual({
		message: "请描述您目前的主要不适、持续时间或具体就诊需求。",
		departmentNames: [],
	});
});

test("MVP guide model returns controlled department candidates", async () => {
	const model = new MvpIntelligentGuideModel();

	await expect(
		model.complete(
			{
				message: "头痛两天",
				history: [
					{ role: "user", content: "我不舒服" },
					{ role: "assistant", content: "请补充主要不适" },
				],
			},
			context,
		),
	).resolves.toEqual({
		message: "根据您目前的描述，建议优先选择以下相关科室。",
		departmentNames: ["神经内科"],
	});
});

test("MVP guide model keeps unknown symptoms in the clarification path", async () => {
	const model = new MvpIntelligentGuideModel();

	await expect(
		model.complete(
			{
				message: "最近总觉得不太对劲",
				history: [{ role: "assistant", content: "请补充信息" }],
			},
			context,
		),
	).resolves.toEqual({
		message:
			"请补充不适的具体部位、持续时间，以及是否伴有发热、疼痛加重等情况。",
		departmentNames: [],
	});
});
