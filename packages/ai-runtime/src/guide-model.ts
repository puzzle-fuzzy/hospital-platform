import type {
	AdapterCallContext,
	IntelligentGuideConversationMessage,
	IntelligentGuideModelGateway,
} from "@hospital/domain";

type CandidateRule = {
	pattern: RegExp;
	departments: readonly string[];
};

const CANDIDATE_RULES: readonly CandidateRule[] = [
	{ pattern: /头痛|头晕|眩晕|麻木|失眠/u, departments: ["神经内科"] },
	{
		pattern: /腹痛|肚子疼|胃痛|恶心|呕吐|腹泻/u,
		departments: ["消化内科", "普外科"],
	},
	{ pattern: /胸痛|心慌|心悸|血压/u, departments: ["心内科"] },
	{ pattern: /咳嗽|咳痰|发热|气短|呼吸困难|咽痛/u, departments: ["呼吸内科"] },
	{ pattern: /儿童|小孩|孩子|婴儿/u, departments: ["儿科"] },
	{ pattern: /月经|怀孕|妊娠|妇科/u, departments: ["妇科"] },
	{ pattern: /牙痛|牙龈|口腔/u, departments: ["口腔科"] },
	{ pattern: /皮肤|湿疹|痘痘|皮疹|瘙痒/u, departments: ["皮肤科"] },
];

/**
 * TS AI Runtime 的第一版导诊模型。
 *
 * 这是可替换的 MVP 实现：先用受控规则跑通端到端架构，后续把 GGUF
 * 推理放到同一端口即可，不改 API、会话和 HIS 科室目录边界。
 */
export class MvpIntelligentGuideModel implements IntelligentGuideModelGateway {
	async complete(
		input: {
			message: string;
			history: readonly IntelligentGuideConversationMessage[];
		},
		_context: AdapterCallContext,
	): Promise<{
		message: string;
		departmentNames: readonly string[];
	}> {
		const hasAssistantTurn = input.history.some(
			(item) => item.role === "assistant",
		);
		if (!hasAssistantTurn) {
			return {
				message: "请描述您目前的主要不适、持续时间或具体就诊需求。",
				departmentNames: [],
			};
		}

		const rule = CANDIDATE_RULES.find(({ pattern }) =>
			pattern.test(input.message),
		);
		if (!rule) {
			return {
				message:
					"请补充不适的具体部位、持续时间，以及是否伴有发热、疼痛加重等情况。",
				departmentNames: [],
			};
		}
		return {
			message: "根据您目前的描述，建议优先选择以下相关科室。",
			departmentNames: rule.departments,
		};
	}
}
