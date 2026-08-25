import { describe, expect, test } from "bun:test";
import {
	resolveKnowledgePanelState,
	resolveKnowledgeTabSource,
} from "./health-knowledge-view";

describe("健康百科分类面板状态", () => {
	test("左侧仍有分类时保留导航，即使当前分类没有内容", () => {
		expect(resolveKnowledgePanelState(3)).toBe("ready");
		expect(resolveKnowledgePanelState(1)).toBe("ready");
	});

	test("左侧没有任何分类时才展示整体空状态", () => {
		expect(resolveKnowledgePanelState(0)).toBe("empty");
	});
});

describe("健康百科 Tab 目录来源", () => {
	test("已有部位目录时两个 Tab 都复用同一份已确认目录", () => {
		expect(resolveKnowledgeTabSource("symptom", 3)).toBe("cached-parts");
		expect(resolveKnowledgeTabSource("disease", 3)).toBe("cached-parts");
	});

	test("症状 Tab 没有目录时重新取得症状目录，而不是制造空态", () => {
		expect(resolveKnowledgeTabSource("symptom", 0)).toBe(
			"reload-symptom-catalog",
		);
	});

	test("疾病 Tab 没有目录时重新取得疾病关系目录，而不是制造空态", () => {
		expect(resolveKnowledgeTabSource("disease", 0)).toBe(
			"reload-disease-catalog",
		);
	});
});
