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
	"pages/report-detail/report-detail.json",
	"pages/report-detail/report-detail.wxml",
	"pages/report-detail/report-detail.wxss",
];
const requiredTypeScriptFiles = [
	"app.ts",
	"services/api-client.ts",
	"services/dashboard-service.ts",
	"services/session-service.ts",
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

for (const file of [...requiredStaticFiles, ...requiredTypeScriptFiles]) {
	await access(join(source, file));
}

for (const directory of requiredAssetDirectories) {
	await access(join(source, directory));
}

console.log(
	`Native mini program source is ready at ${source}; WeChat TypeScript compiler plugin is enabled`,
);
