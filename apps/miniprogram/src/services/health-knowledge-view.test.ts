import { describe, expect, test } from "bun:test";
import { resolveKnowledgePanelState } from "./health-knowledge-view";

describe("健康百科分类面板状态", () => {
	test("左侧仍有分类时保留导航，即使当前分类没有内容", () => {
		expect(resolveKnowledgePanelState(3)).toBe("ready");
		expect(resolveKnowledgePanelState(1)).toBe("ready");
	});

	test("左侧没有任何分类时才展示整体空状态", () => {
		expect(resolveKnowledgePanelState(0)).toBe("empty");
	});
});
