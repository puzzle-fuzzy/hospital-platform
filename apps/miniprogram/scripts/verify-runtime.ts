import { access } from "node:fs/promises";
import { join } from "node:path";
import { resolveMiniProgramSourceRevision } from "./runtime-provenance";
import {
	findForbiddenWorkspaceImports,
	findMissingRelativeImports,
	listRuntimeFiles,
} from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const repositoryRoot = join(root, "..", "..");
const source = join(root, "src");
const verifyPending = process.argv.includes("--pending");
const runtime = verifyPending
	? join(repositoryRoot, ".local", "hospital-miniprogram", "pending")
	: join(root, "dist");
const runtimeLabel = verifyPending ? "pending" : "dist";

/**
 * 保留 live 运行包既有的错误前缀，避免工具和验收测试只能因为 pending
 * 校验增加而失去稳定的诊断关键词；pending 模式只在前缀中明确候选范围。
 */
const runtimeTestScriptErrorPrefix =
	"Mini program runtime must not contain test scripts";
const runtimeMissingImportErrorPrefix =
	"Mini program runtime contains missing relative imports";
const runtimeWorkspaceImportErrorPrefix =
	"Mini program runtime must not import pnpm workspace modules";
const withRuntimeScope = (message: string): string =>
	verifyPending ? message.replace("runtime", "pending runtime") : message;

type MiniProgramAppConfig = {
	pages?: unknown;
};

type MiniProgramProjectConfig = {
	miniprogramRoot?: unknown;
	setting?: {
		compileHotReLoad?: unknown;
		ignoreDevUnusedFiles?: unknown;
	};
};

type MiniProgramBuildInfo = {
	schemaVersion?: unknown;
	sourceRevision?: unknown;
	pageCount?: unknown;
	generatedAt?: unknown;
};

/**
 * 真机调试最终应该打开构建产物 `dist/`，但当微信开发者工具锁住 `dist/`
 * 时，可以用 `--pending` 只读检查隔离的待发布候选。两种模式都不会重新
 * 编译、删除或修改运行包；pending 模式还必须显式传入候选完整来源指纹，
 * 防止把旧候选误当成当前源码的验证结果。
 */
async function assertFile(relativePath: string): Promise<void> {
	try {
		await access(join(runtime, relativePath));
	} catch {
		throw new Error(
			`Mini program ${runtimeLabel} file is missing: ${runtimeLabel}/${relativePath}. Run pnpm --filter @hospital/miniprogram build first.`,
		);
	}
}

const appConfig = JSON.parse(
	await Bun.file(join(source, "app.json")).text(),
) as MiniProgramAppConfig;
if (
	!Array.isArray(appConfig.pages) ||
	appConfig.pages.length === 0 ||
	appConfig.pages.some(
		(page) =>
			typeof page !== "string" ||
			page.trim().length === 0 ||
			page.startsWith("/") ||
			page.includes(".."),
	)
) {
	throw new Error(
		"Mini program src/app.json pages must be non-empty relative paths without parent traversal",
	);
}

if (!verifyPending) {
	const projectConfig = JSON.parse(
		await Bun.file(join(root, "project.config.json")).text(),
	) as MiniProgramProjectConfig;
	if (projectConfig.miniprogramRoot !== "dist/") {
		throw new Error(
			"Mini program project.config.json must point to the generated dist/ runtime",
		);
	}
}

await assertFile("app.json");
await assertFile("app.wxss");
await assertFile("sitemap.json");
await assertFile("build-info.json");
await assertFile("project.config.json");

/**
 * 运行包自身必须是独立工程，不能再依赖父目录的 `miniprogramRoot=dist/`
 * 做间接隔离；否则工具仍可能监听旁边的 src/。pending 和 live 都必须
 * 使用 `./`，这样候选工程可以在不替换 live 的情况下独立打开检查。
 */
const runtimeProjectConfig = JSON.parse(
	await Bun.file(join(runtime, "project.config.json")).text(),
) as MiniProgramProjectConfig;
if (runtimeProjectConfig.miniprogramRoot !== "./") {
	throw new Error(
		`Mini program ${runtimeLabel}/project.config.json must use miniprogramRoot=./ so the runtime is a standalone project`,
	);
}
if (
	runtimeProjectConfig.setting?.compileHotReLoad !== false ||
	runtimeProjectConfig.setting?.ignoreDevUnusedFiles !== false
) {
	throw new Error(
		`Mini program ${runtimeLabel}/project.config.json must disable hot reload and unused-file pruning`,
	);
}
// 预约历史页面通过 TypeScript 模块读取静态科室位置，运行包必须带上编译后的 JS。
await assertFile("data/department-location.js");
// 页面级请求守卫和患者同步依赖该生产模块；显式检查它，避免只检查页面入口而
// 漏掉间接依赖，导致开发者工具沿用旧增量索引去寻找不存在的测试脚本。
await assertFile("services/single-flight.js");

/**
 * 运行包只允许承载微信页面运行时脚本；测试文件即使不是页面入口，
 * 也可能被开发者工具的增量编译器索引，导致真机出现“找不到 .test.js”。
 * 因此这里对已经存在的 dist 做只读扫描，发现测试脚本立即停止验收。
 */
const forbiddenTestRuntimeFiles = (await listRuntimeFiles(runtime)).filter(
	(file) => /(?:\.test|\.spec)\.js$/u.test(file),
);
if (forbiddenTestRuntimeFiles.length > 0) {
	throw new Error(
		`${withRuntimeScope(runtimeTestScriptErrorPrefix)}: ${forbiddenTestRuntimeFiles.join(", ")}`,
	);
}

const missingRelativeImports = await findMissingRelativeImports(runtime);
if (missingRelativeImports.length > 0) {
	throw new Error(
		`${withRuntimeScope(runtimeMissingImportErrorPrefix)}: ${missingRelativeImports.join(", ")}`,
	);
}

const forbiddenWorkspaceImports = await findForbiddenWorkspaceImports(runtime);
if (forbiddenWorkspaceImports.length > 0) {
	throw new Error(
		`${withRuntimeScope(runtimeWorkspaceImportErrorPrefix)}: ${forbiddenWorkspaceImports.join(", ")}`,
	);
}

const buildInfo = JSON.parse(
	await Bun.file(join(runtime, "build-info.json")).text(),
) as MiniProgramBuildInfo;
if (
	buildInfo.schemaVersion !== 1 ||
	typeof buildInfo.sourceRevision !== "string" ||
	!/^[0-9a-f]{40}$/.test(buildInfo.sourceRevision) ||
	typeof buildInfo.pageCount !== "number" ||
	!Number.isInteger(buildInfo.pageCount) ||
	buildInfo.pageCount < 1 ||
	typeof buildInfo.generatedAt !== "string" ||
	buildInfo.generatedAt.trim().length === 0
) {
	throw new Error(
		`Mini program ${runtimeLabel}/build-info.json has an invalid build provenance record`,
	);
}

/** 启动日志中的来源必须与独立 build-info.json 一致，避免真机只显示静态标记。 */
const runtimeApp = await Bun.file(join(runtime, "app.js")).text();
if (
	!runtimeApp.includes(
		`MINI_PROGRAM_BUILD_REVISION = "${String(buildInfo.sourceRevision)}"`,
	)
) {
	throw new Error(
		`Mini program ${runtimeLabel}/app.js build revision does not match ${runtimeLabel}/build-info.json`,
	);
}

const expectedSourceRevision = resolveMiniProgramSourceRevision(
	repositoryRoot,
	process.env.HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION,
	"HOSPITAL_MINIPROGRAM_EXPECTED_SOURCE_REVISION",
);
if (buildInfo.sourceRevision !== expectedSourceRevision) {
	throw new Error(
		`Mini program build provenance mismatch: ${runtimeLabel}=${buildInfo.sourceRevision}, expected=${expectedSourceRevision}`,
	);
}

/**
 * 每个 app.json 入口都必须形成完整的微信页面文件集合。只检查源码会漏掉
 * “源码存在但 dist 没有 JS”的部署错误；只检查 JS 又会漏掉模板或样式缺失。
 */
for (const page of appConfig.pages as string[]) {
	for (const extension of [".js", ".json", ".wxml", ".wxss"] as const) {
		await assertFile(`${page}${extension}`);
	}
}
if (buildInfo.pageCount !== appConfig.pages.length) {
	throw new Error(
		`Mini program build provenance page count ${buildInfo.pageCount} does not match src/app.json page count ${appConfig.pages.length}`,
	);
}

console.log(
	`Mini program ${runtimeLabel} verified: revision=${buildInfo.sourceRevision.slice(0, 7)}; ${appConfig.pages.length} pages and required root files are present`,
);
