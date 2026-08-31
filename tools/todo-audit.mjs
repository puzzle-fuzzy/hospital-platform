import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const PRIORITY_LEVELS = ["P0", "P1", "P2", "P3"];

/**
 * 解析 TODO 清单中的复选框和标题优先级。
 *
 * 未完成项按所属三级标题的最高优先级归类，例如“P1/P2”标题下的条目
 * 归入 P1；没有优先级标题的未完成项直接报错，避免统计时悄悄漏项。
 */
export function parseTodoFacts(content) {
	let currentHeading = "";
	const counts = {
		total: 0,
		done: 0,
		open: 0,
		byPriority: { P0: 0, P1: 0, P2: 0, P3: 0 },
	};
	const unscopedOpenItems = [];

	for (const line of content.split(/\r?\n/u)) {
		if (line.startsWith("# ") || line.startsWith("## ")) {
			currentHeading = "";
			continue;
		}
		if (line.startsWith("### ")) {
			currentHeading = line;
			continue;
		}

		const checkbox = line.match(/^- \[([ xX])\]\s+/u);
		if (!checkbox) continue;

		counts.total += 1;
		if (checkbox[1].toLowerCase() === "x") {
			counts.done += 1;
			continue;
		}

		counts.open += 1;
		const priority = PRIORITY_LEVELS.find((level) =>
			currentHeading.includes(level),
		);
		if (!priority) {
			unscopedOpenItems.push(line);
			continue;
		}
		counts.byPriority[priority] += 1;
	}

	return { counts, unscopedOpenItems };
}

/** 校验文档中手工维护的统计摘要，保证 TODO 不因增删条目而静默漂移。 */
export function auditTodoDocument(content) {
	const { counts, unscopedOpenItems } = parseTodoFacts(content);
	const failures = [];
	const summary = content.match(
		/复选框总数为 (\d+) 项，其中已完成 (\d+) 项、未完成 (\d+) 项/u,
	);
	if (!summary) {
		failures.push("TODO.md 缺少复选框统计摘要");
	} else {
		const declared = {
			total: Number(summary[1]),
			done: Number(summary[2]),
			open: Number(summary[3]),
		};
		for (const key of ["total", "done", "open"]) {
			if (declared[key] !== counts[key]) {
				failures.push(
					`TODO.md ${key} 统计为 ${declared[key]}，实际为 ${counts[key]}`,
				);
			}
		}
	}

	const prioritySummary = content.match(
		/另按标题优先级统计未完成项为：P0 (\d+)、P1 (\d+)、P2 (\d+)、P3 (\d+)/u,
	);
	if (!prioritySummary) {
		failures.push("TODO.md 缺少按标题优先级统计摘要");
	} else {
		for (const [index, priority] of PRIORITY_LEVELS.entries()) {
			const declared = Number(prioritySummary[index + 1]);
			const actual = counts.byPriority[priority];
			if (declared !== actual) {
				failures.push(
					`TODO.md ${priority} 未完成统计为 ${declared}，实际为 ${actual}`,
				);
			}
		}
	}

	if (unscopedOpenItems.length > 0) {
		failures.push(
			`TODO.md 存在未归类优先级的未完成项：${unscopedOpenItems.length} 条`,
		);
	}

	return {
		...counts,
		unscopedOpenItems,
		failures,
		passed: failures.length === 0,
	};
}

/** 执行 TODO 统计门禁；失败时只输出计数差异，不回显清单正文。 */
export async function auditTodo(root = repositoryRoot) {
	const content = await Bun.file(`${root}/TODO.md`).text();
	return auditTodoDocument(content);
}

if (import.meta.main) {
	const report = await auditTodo();
	console.log(
		JSON.stringify(
			{
				total: report.total,
				done: report.done,
				open: report.open,
				byPriority: report.byPriority,
				failures: report.failures,
				passed: report.passed,
			},
			null,
			2,
		),
	);
	if (!report.passed) process.exitCode = 1;
}
