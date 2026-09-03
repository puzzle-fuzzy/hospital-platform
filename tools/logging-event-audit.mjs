import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

/**
 * 业务日志只能从这些生产源码目录收集。测试文件、构建产物和文档中的
 * 示例事件不能参与审计，否则测试用事件会被误认为线上事件已经登记。
 */
export const LOGGING_SOURCE_ROOTS = Object.freeze([
	"apps/api/src",
	"apps/worker/src",
	"packages",
]);

const EXCLUDED_FILE_PATTERN = /(?:\.test|\.spec)\.(?:ts|tsx|mjs)$/u;
const STATIC_EVENT_PATTERN = /\bevent\s*:\s*(?:"([^"]+)"|'([^']+)')/gu;

/** 递归读取生产源码，并跳过测试文件。 */
async function listSourceFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listSourceFiles(path)));
			continue;
		}
		if (!entry.isFile() || EXCLUDED_FILE_PATTERN.test(entry.name)) continue;
		if (!/\.(?:ts|tsx|mjs)$/u.test(entry.name)) continue;
		files.push(path);
	}
	return files;
}

/**
 * 提取静态 event 字面量；插值模板属于有限动态事件，不能在这里猜出名称，
 * 必须由日志文档用稳定前缀或明确的事件表说明。变量 event 也不会被误收集。
 */
export function extractStaticEventNames(source) {
	const events = new Set();
	for (const match of source.matchAll(STATIC_EVENT_PATTERN)) {
		const event = match[1] ?? match[2];
		if (event) events.add(event);
	}
	return [...events].sort();
}

/**
 * 检查代码中的静态事件是否在日志规范中登记。
 * 返回值只包含事件名和文档缺口，不回显日志正文或业务字段。
 */
export function auditLoggingEventDocumentation({ sourceFiles, documentation }) {
	const discoveredEvents = new Set();
	for (const source of sourceFiles) {
		for (const event of extractStaticEventNames(source)) {
			discoveredEvents.add(event);
		}
	}

	const undocumentedEvents = [...discoveredEvents]
		.filter((event) => !documentation.includes(`\`${event}\``))
		.sort();

	return {
		passed: undocumentedEvents.length === 0,
		discoveredEvents: [...discoveredEvents].sort(),
		undocumentedEvents,
	};
}

/** 执行当前仓库的日志事件登记审计。 */
export async function auditCurrentLoggingEventDocumentation(
	rootDirectory = repositoryRoot,
) {
	const sourceFiles = [];
	for (const sourceRoot of LOGGING_SOURCE_ROOTS) {
		const files = await listSourceFiles(join(rootDirectory, sourceRoot));
		for (const file of files) sourceFiles.push(await readFile(file, "utf8"));
	}
	const documentation = await readFile(
		join(rootDirectory, "docs/日志规范.md"),
		"utf8",
	);
	return auditLoggingEventDocumentation({ sourceFiles, documentation });
}

if (import.meta.main) {
	try {
		const result = await auditCurrentLoggingEventDocumentation();
		if (!result.passed) {
			console.error(
				`日志事件文档审计失败：未登记 ${result.undocumentedEvents.join(", ")}`,
			);
			process.exitCode = 1;
		} else {
			console.log(
				`日志事件文档审计通过：${result.discoveredEvents.length} 个静态事件均已登记`,
			);
		}
	} catch (error) {
		console.error(
			`日志事件文档审计无法执行：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
