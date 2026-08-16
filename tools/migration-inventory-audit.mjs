import { fileURLToPath } from "node:url";
import { join } from "node:path";

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

/**
 * 旧端页面清单是迁移范围的事实输入。旧仓库通常与新仓库并列存在，
 * 但不会被提交到新仓库，因此这里使用可选的外部根目录做交叉核对：
 * - 当前机器存在旧仓库时，实际 `.vue` 文件必须全部出现在迁移矩阵；
 * - CI 或新会话没有旧仓库时，只跳过这项外部检查，不伪造“已核对”。
 */
const legacyRoot =
	process.env.LEGACY_HOSPITAL_ROOT?.trim() || "G:\\fuck\\hospital";
const legacySourceRoot = join(legacyRoot, "hospital-app", "src");
const legacySentinel = join(legacySourceRoot, "pages", "index", "index.vue");

if (!(await Bun.file(legacySentinel).exists())) {
	console.log(
		`Legacy page inventory skipped: old repository is not available at ${legacyRoot}`,
	);
} else {
	const legacyMatrix = await readText("docs/migration/legacy-page-matrix.md");
	const documentedLegacyPages = new Set();
	for (const line of legacyMatrix.split("\n")) {
		const row = line.match(/^\| `([^`]+\/)` \| (.+?) \|/u);
		if (!row) continue;
		for (const pageMatch of row[2].matchAll(/`([^`]+\.vue)`/gu)) {
			documentedLegacyPages.add(`${row[1]}${pageMatch[1]}`);
		}
	}

	const actualLegacyPages = new Set();
	for (const pattern of ["pages/**/*.vue", "pagesB/**/*.vue"]) {
		const glob = new Bun.Glob(pattern);
		for await (const pagePath of glob.scan({
			cwd: legacySourceRoot,
			onlyFiles: true,
		})) {
			actualLegacyPages.add(pagePath.replaceAll("\\", "/"));
		}
	}

	const undocumentedLegacyPages = [...actualLegacyPages]
		.filter((pagePath) => !documentedLegacyPages.has(pagePath))
		.sort();
	const staleLegacyPages = [...documentedLegacyPages]
		.filter((pagePath) => !actualLegacyPages.has(pagePath))
		.sort();

	if (undocumentedLegacyPages.length > 0 || staleLegacyPages.length > 0) {
		if (undocumentedLegacyPages.length > 0) {
			console.error("Legacy page matrix is missing actual page(s):");
			for (const pagePath of undocumentedLegacyPages)
				console.error(`- ${pagePath}`);
		}
		if (staleLegacyPages.length > 0) {
			console.error("Legacy page matrix contains stale page(s):");
			for (const pagePath of staleLegacyPages) console.error(`- ${pagePath}`);
		}
		process.exitCode = 1;
	} else {
		console.log(
			`Legacy page inventory passed: ${actualLegacyPages.size} old page(s) match the migration matrix`,
		);
	}
}

// 保留仓库根目录引用，避免从仓库外运行时被当前工作目录影响。
void fileURLToPath(repositoryRoot);
