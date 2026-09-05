import { describe, expect, test } from "bun:test";
import { auditTodo, auditTodoDocument } from "./todo-audit.mjs";

describe("TODO 统计门禁", () => {
	test("当前清单的总数和标题优先级统计一致", async () => {
		const report = await auditTodo();

		expect(report).toMatchObject({
			total: 144,
			done: 89,
			open: 55,
			byPriority: { P0: 4, P1: 26, P2: 19, P3: 6 },
			failures: [],
			passed: true,
		});
	});

	test("混合优先级标题按最高优先级归类", () => {
		const content = [
			"复选框总数为 2 项，其中已完成 1 项、未完成 1 项。",
			"另按标题优先级统计未完成项为：P0 0、P1 1、P2 0、P3 0",
			"### P1/P2 示例",
			"- [ ] 一个待处理项",
			"- [x] 一个已完成项",
		].join("\n");

		expect(auditTodoDocument(content)).toMatchObject({
			byPriority: { P0: 0, P1: 1, P2: 0, P3: 0 },
			passed: true,
		});
	});

	test("统计摘要漂移时门禁失败", () => {
		const content = [
			"复选框总数为 1 项，其中已完成 0 项、未完成 1 项。",
			"另按标题优先级统计未完成项为：P0 0、P1 0、P2 0、P3 1",
			"### P1：示例",
			"- [ ] 一个待处理项",
		].join("\n");

		const report = auditTodoDocument(content);
		expect(report.passed).toBe(false);
		expect(report.failures).toContain("TODO.md P1 未完成统计为 0，实际为 1");
	});
});
