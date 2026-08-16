import { fileURLToPath } from "node:url";

/**
 * 原生小程序迁移台账审计。
 *
 * app.json 是微信运行时真正读取的页面注册表，不能只靠人工记忆维护迁移状态。
 * 本审计只做静态一致性检查：它不调用 API、不读取生产数据、不执行 migration，
 * 也不把“页面存在”解释成“业务已经真实验收”。真实 provider、生产、公网和真机
 * 证据仍必须按对应 release 文档分别保存。
 */

const repositoryRoot = new URL("../", import.meta.url);
const readText = (relativePath) =>
	Bun.file(new URL(relativePath, repositoryRoot)).text();

const appConfig = JSON.parse(await readText("apps/miniprogram/src/app.json"));
const pagePaths = appConfig.pages;
if (
	!Array.isArray(pagePaths) ||
	pagePaths.length === 0 ||
	pagePaths.some((page) => typeof page !== "string" || page.length === 0)
) {
	throw new Error(
		"apps/miniprogram/src/app.json must contain non-empty page paths",
	);
}

const ledger = await readText("docs/migration/native-page-migration-status.md");
const missingPages = pagePaths.filter(
	(pagePath) => !ledger.includes(`| \`${pagePath}\` |`),
);

if (missingPages.length > 0) {
	console.error("Native page migration ledger is missing:");
	for (const pagePath of missingPages) console.error(`- ${pagePath}`);
	process.exitCode = 1;
} else {
	console.log(
		`Native page migration ledger passed: ${pagePaths.length} registered page(s) documented`,
	);
}

/**
 * 反向检查台账中的路径是否仍然注册，防止删除页面后遗留一行“已迁移”状态，
 * 让路线图继续暗示一个实际上不存在的入口。只读取台账中的机器可识别表格行。
 */
const ledgerPagePaths = [...ledger.matchAll(/^\| `([^`]+)` \|/gmu)]
	.map((match) => match[1])
	.filter((pagePath) => pagePath.startsWith("pages/"));
const stalePages = ledgerPagePaths.filter(
	(pagePath) => !pagePaths.includes(pagePath),
);
if (stalePages.length > 0) {
	console.error("Native page migration ledger contains unregistered page(s):");
	for (const pagePath of stalePages) console.error(`- ${pagePath}`);
	process.exitCode = 1;
}

if (missingPages.length === 0 && stalePages.length === 0) {
	console.log(
		"Native page migration ledger has no stale registered-page entries",
	);
}

// 保留仓库根目录引用，避免从仓库外运行时被当前工作目录影响。
void fileURLToPath(repositoryRoot);
