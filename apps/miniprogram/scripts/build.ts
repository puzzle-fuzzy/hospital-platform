import { access } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const projectConfigPath = join(root, "project.config.json");
const requiredStaticFiles = [
	"app.json",
	"app.wxss",
	"sitemap.json",
	"pages/index/index.json",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
	"pages/patient-select/patient-select.json",
	"pages/patient-select/patient-select.wxml",
	"pages/patient-select/patient-select.wxss",
	"pages/appointment-directory/appointment-directory.json",
	"pages/appointment-directory/appointment-directory.wxml",
	"pages/appointment-directory/appointment-directory.wxss",
	"pages/appointment-records/appointment-records.json",
	"pages/appointment-records/appointment-records.wxml",
	"pages/appointment-records/appointment-records.wxss",
	"pages/report-detail/report-detail.json",
	"pages/report-detail/report-detail.wxml",
	"pages/report-detail/report-detail.wxss",
];
const requiredTypeScriptFiles = [
	"app.ts",
	"services/api-client.ts",
	"services/dashboard-service.ts",
	"services/session-service.ts",
	"services/patient-selection-service.ts",
	"pages/patient-select/patient-select.ts",
	"pages/appointment-directory/appointment-directory.ts",
	"pages/appointment-records/appointment-records.ts",
	"pages/index/index.ts",
	"pages/report-detail/report-detail.ts",
];
const requiredAssetDirectories = ["assets"];

/**
 * 原生小程序不再生成第二套 dist 运行目录。
 *
 * 微信开发者工具通过仓库内公共 project.config.json 直接打开 src/，
 * TypeScript 由官方编译插件处理，Bun 只负责仓库级类型检查与测试。
 * 这样可以避免源码、Bun bundle 和开发者工具之间出现三套运行语义。
 */
const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text()) as {
	miniprogramRoot?: unknown;
	setting?: { useCompilerPlugins?: unknown };
};

if (projectConfig.miniprogramRoot !== "src/") {
	throw new Error("Mini program project.config.json must point to src/");
}

if (
	!Array.isArray(projectConfig.setting?.useCompilerPlugins) ||
	!projectConfig.setting.useCompilerPlugins.includes("typescript")
) {
	throw new Error(
		"Mini program project.config.json must enable the TypeScript compiler plugin",
	);
}

/**
 * 开发者工具有时会在 src/ 下生成一个本机项目配置副本。
 * 如果用户直接把 src/ 当作项目根目录打开，这个副本会覆盖上层配置；
 * 因此存在时也必须开启 TypeScript 插件，否则真机会按纯 JS 查找 .js 文件。
 */
const nestedProjectConfigPath = join(source, "project.config.json");
let nestedProjectConfigExists = false;
try {
	await access(nestedProjectConfigPath);
	nestedProjectConfigExists = true;
} catch {
	// 没有本机配置副本时，直接使用仓库公共配置即可。
}

if (nestedProjectConfigExists) {
	const nestedProjectConfig = JSON.parse(
		await Bun.file(nestedProjectConfigPath).text(),
	) as { setting?: { useCompilerPlugins?: unknown } };
	if (
		!Array.isArray(nestedProjectConfig.setting?.useCompilerPlugins) ||
		!nestedProjectConfig.setting.useCompilerPlugins.includes("typescript")
	) {
		throw new Error(
			"src/project.config.json exists but does not enable the TypeScript compiler plugin; reload the DevTools project configuration",
		);
	}
}

for (const file of [...requiredStaticFiles, ...requiredTypeScriptFiles]) {
	await access(join(source, file));
}

for (const directory of requiredAssetDirectories) {
	await access(join(source, directory));
}

console.log(
	`Native mini program source is ready at ${source}; WeChat TypeScript compiler plugin is enabled`,
);
