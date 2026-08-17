import { access, readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const docsRoot = join(repositoryRoot, "docs");

/**
 * 文档链接是迁移知识的导航边界：断链会让新会话错过 contract、验收或回滚规则。
 * 该审计只检查仓库内相对链接，不访问互联网，也不把外部网站可用性误判为本地
 * 文档证据。所有目标必须留在仓库根目录内，避免文档引用开发机私有路径。
 */
async function markdownFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await markdownFiles(entryPath)));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(entryPath);
		}
	}
	return files.sort();
}

/** 去掉 Markdown 链接的 fragment、query、尖括号和可选标题。 */
function normalizeTarget(rawTarget) {
	let target = rawTarget.trim();
	if (target.startsWith("<")) {
		const closing = target.indexOf(">");
		target = closing >= 0 ? target.slice(1, closing) : target.slice(1);
	} else {
		target = target.split(/\s+/u, 1)[0] ?? "";
	}
	const fragmentIndex = target.search(/[?#]/u);
	if (fragmentIndex >= 0) target = target.slice(0, fragmentIndex);
	return decodeURIComponent(target);
}

function isExternalTarget(target) {
	return (
		target.startsWith("#") ||
		target.startsWith("mailto:") ||
		target.startsWith("tel:") ||
		/^[a-z][a-z\d+.-]*:\/\//iu.test(target)
	);
}

const files = await markdownFiles(docsRoot);
const failures = [];
const linkPattern = /\]\(([^)]+)\)/gu;

for (const filePath of files) {
	const content = await readFile(filePath, "utf8");
	for (const match of content.matchAll(linkPattern)) {
		const rawTarget = match[1] ?? "";
		const target = normalizeTarget(rawTarget);
		if (!target || isExternalTarget(target)) continue;

		const resolvedTarget = resolve(dirname(filePath), target);
		const relativeTarget = relative(repositoryRoot, resolvedTarget);
		if (
			isAbsolute(relativeTarget) ||
			relativeTarget === ".." ||
			relativeTarget.startsWith("..\\") ||
			relativeTarget.startsWith("../")
		) {
			failures.push(
				`${relative(repositoryRoot, filePath)}: link escapes repository: ${target}`,
			);
			continue;
		}

		try {
			await access(resolvedTarget);
		} catch {
			failures.push(
				`${relative(repositoryRoot, filePath)}: missing local link target: ${target}`,
			);
		}
	}
}

if (failures.length > 0) {
	console.error("Markdown 文档链接审计失败：");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`Markdown 文档链接审计通过：${files.length} 个文档，无断链`);
