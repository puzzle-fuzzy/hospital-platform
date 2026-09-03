import { access } from "node:fs/promises";
import { join } from "node:path";
import {
	resolveDevelopmentMiniProgramRuntimeSnapshot,
	resolveMiniProgramSourceRevision,
} from "./runtime-provenance";
import {
	findForbiddenWorkspaceImports,
	findMissingRelativeImports,
	getMiniProgramDevelopmentRuntimePath,
	getMiniProgramPendingRuntimePath,
	listRuntimeFiles,
	type MiniProgramRuntimeBuildMode,
} from "./runtime-publisher";

const root = join(import.meta.dir, "..");
const repositoryRoot = join(root, "..", "..");
const source = join(root, "src");

function resolveVerificationOptions(): Readonly<{
	buildMode: MiniProgramRuntimeBuildMode;
	verifyPending: boolean;
}> {
	const argumentsAfterScript = process.argv.slice(2);
	let buildMode: MiniProgramRuntimeBuildMode = "release";
	let verifyPending = false;

	for (const argument of argumentsAfterScript) {
		if (argument === "--mode=release") continue;
		if (argument === "--mode=development") {
			buildMode = "development";
			continue;
		}
		if (argument === "--pending") {
			verifyPending = true;
			continue;
		}
		throw new Error(
			"Mini program runtime verification only accepts --pending, --mode=release, or --mode=development",
		);
	}

	return { buildMode, verifyPending };
}

const { buildMode, verifyPending } = resolveVerificationOptions();
const runtime = verifyPending
	? getMiniProgramPendingRuntimePath(root, buildMode)
	: buildMode === "development"
		? getMiniProgramDevelopmentRuntimePath(root)
		: join(root, "dist");
const runtimeLabel = verifyPending
	? `${buildMode} pending runtime`
	: buildMode === "development"
		? "development runtime"
		: "dist";
const buildCommand =
	buildMode === "development"
		? "pnpm --filter @hospital/miniprogram build:dev"
		: "pnpm --filter @hospital/miniprogram build";

/**
 * 保留正式运行包既有的错误前缀；development 模式只扩展范围说明，不能把
 * 脏工作树预览误写成正式候选。
 */
const runtimeTestScriptErrorPrefix =
	"Mini program runtime must not contain test scripts";
const runtimeMissingImportErrorPrefix =
	"Mini program runtime contains missing relative imports";
const runtimeWorkspaceImportErrorPrefix =
	"Mini program runtime must not import pnpm workspace modules";
const withRuntimeScope = (message: string): string =>
	verifyPending || buildMode === "development"
		? message.replace("runtime", runtimeLabel)
		: message;

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
	buildMode?: unknown;
	sourceRevision?: unknown;
	sourceRevisionKind?: unknown;
	baseSourceRevision?: unknown;
	pageCount?: unknown;
	generatedAt?: unknown;
};

async function assertFile(relativePath: string): Promise<void> {
	try {
		await access(join(runtime, relativePath));
	} catch {
		throw new Error(
			`Mini program ${runtimeLabel} file is missing: ${runtimeLabel}/${relativePath}. Run ${buildCommand} first.`,
		);
	}
}

function isGitRevision(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function isDevelopmentSnapshot(value: unknown): value is string {
	return (
		typeof value === "string" && /^workspace-sha256:[0-9a-f]{64}$/u.test(value)
	);
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

if (buildMode === "release" && !verifyPending) {
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
 * 正式与开发运行包都必须作为独立工程打开，不能依赖父目录的
 * `miniprogramRoot=dist/`，否则工具仍可能监听旁边的 src/。
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

const isLegacyReleaseBuild =
	buildInfo.schemaVersion === 1 && buildInfo.buildMode === undefined;
if (buildMode === "development") {
	if (
		buildInfo.schemaVersion !== 2 ||
		buildInfo.buildMode !== "development" ||
		buildInfo.sourceRevisionKind !== "runtime-input-snapshot" ||
		!isDevelopmentSnapshot(buildInfo.sourceRevision) ||
		!isGitRevision(buildInfo.baseSourceRevision)
	) {
		throw new Error(
			`Mini program ${runtimeLabel}/build-info.json must contain development workspace-snapshot provenance`,
		);
	}
} else if (
	(!isLegacyReleaseBuild && buildInfo.schemaVersion !== 1) ||
	buildInfo.buildMode === "development" ||
	!isGitRevision(buildInfo.sourceRevision)
) {
	throw new Error(
		`Mini program ${runtimeLabel}/build-info.json must contain release Git-commit provenance`,
	);
}

/** 启动日志必须与 build-info 一致，避免真机只显示静态标记。 */
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
if (!isLegacyReleaseBuild) {
	const expectedBuildMode =
		buildMode === "development" ? "development" : "release";
	const expectedSourceKind =
		buildMode === "development" ? "runtime-input-snapshot" : "git-commit";
	if (
		!runtimeApp.includes(`MINI_PROGRAM_BUILD_MODE = "${expectedBuildMode}"`) ||
		!runtimeApp.includes(
			`MINI_PROGRAM_BUILD_SOURCE_KIND = "${expectedSourceKind}"`,
		)
	) {
		throw new Error(
			`Mini program ${runtimeLabel}/app.js build mode does not match ${runtimeLabel}/build-info.json`,
		);
	}
}

if (buildMode === "development") {
	const expectedSnapshot =
		resolveDevelopmentMiniProgramRuntimeSnapshot(repositoryRoot);
	if (
		buildInfo.sourceRevision !== expectedSnapshot.sourceRevision ||
		buildInfo.baseSourceRevision !== expectedSnapshot.baseSourceRevision
	) {
		throw new Error(
			`Mini program development runtime snapshot mismatch: ${runtimeLabel} no longer matches current runtime inputs. Run ${buildCommand}.`,
		);
	}
} else {
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
}

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
	`Mini program ${runtimeLabel} verified: mode=${buildMode}; source=${String(buildInfo.sourceRevision).slice(0, 24)}; ${appConfig.pages.length} pages and required root files are present`,
);
