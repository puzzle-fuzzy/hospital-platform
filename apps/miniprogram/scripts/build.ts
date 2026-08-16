import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const runtime = join(root, "dist");
const projectConfigPath = join(root, "project.config.json");
const buildConfigPath = join(root, "tsconfig.build.json");
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
	"pages/hospital-list/hospital-list.json",
	"pages/hospital-list/hospital-list.wxml",
	"pages/hospital-list/hospital-list.wxss",
	"pages/appointment-directory/appointment-directory.json",
	"pages/appointment-directory/appointment-directory.wxml",
	"pages/appointment-directory/appointment-directory.wxss",
	"pages/appointment-records/appointment-records.json",
	"pages/appointment-records/appointment-records.wxml",
	"pages/appointment-records/appointment-records.wxss",
	"pages/report-directory/report-directory.json",
	"pages/report-directory/report-directory.wxml",
	"pages/report-directory/report-directory.wxss",
	"pages/report-detail/report-detail.json",
	"pages/report-detail/report-detail.wxml",
	"pages/report-detail/report-detail.wxss",
	"pages/outpatient-payment/outpatient-payment.json",
	"pages/outpatient-payment/outpatient-payment.wxml",
	"pages/outpatient-payment/outpatient-payment.wxss",
	"pages/hospital-navigation/hospital-navigation.json",
	"pages/hospital-navigation/hospital-navigation.wxml",
	"pages/hospital-navigation/hospital-navigation.wxss",
	"pages/my/my.json",
	"pages/my/my.wxml",
	"pages/my/my.wxss",
];
const requiredTypeScriptFiles = [
	"app.ts",
	"services/api-client.ts",
	"services/dashboard-service.ts",
	"services/session-service.ts",
	"services/patient-selection-service.ts",
	"pages/patient-select/patient-select.ts",
	"pages/hospital-list/hospital-list.ts",
	"pages/appointment-directory/appointment-directory.ts",
	"pages/appointment-records/appointment-records.ts",
	"pages/report-directory/report-directory.ts",
	"pages/index/index.ts",
	"pages/report-detail/report-detail.ts",
	"pages/outpatient-payment/outpatient-payment.ts",
	"pages/hospital-navigation/hospital-navigation.ts",
	"pages/my/my.ts",
];
const requiredAssetDirectories = ["assets"];

/**
 * 原生小程序的业务源代码仍然全部使用 TypeScript，但运行目录必须提供真实的
 * JavaScript 页面文件。这样真机上传不依赖开发者工具是否成功执行隐式 TS 插件，
 * 也不会再因为缺少 `pages/report-directory/report-directory.js` 而在运行时失败。
 */
const projectConfig = JSON.parse(await Bun.file(projectConfigPath).text()) as {
	miniprogramRoot?: unknown;
	setting?: { useCompilerPlugins?: unknown };
};

if (projectConfig.miniprogramRoot !== "dist/") {
	throw new Error(
		"Mini program project.config.json must point to the generated dist/ runtime",
	);
}

if (
	!Array.isArray(projectConfig.setting?.useCompilerPlugins) ||
	!projectConfig.setting.useCompilerPlugins.includes("typescript")
) {
	throw new Error(
		"Mini program project.config.json must keep the TypeScript compiler plugin enabled",
	);
}

for (const file of [...requiredStaticFiles, ...requiredTypeScriptFiles]) {
	await access(join(source, file));
}

for (const directory of requiredAssetDirectories) {
	await access(join(source, directory));
}

/** 只把非 TypeScript 资源复制到运行目录，避免把源码配置副本带入上传包。 */
async function copyStaticFiles(currentSource: string): Promise<void> {
	const entries = await readdir(currentSource, { withFileTypes: true });
	for (const entry of entries) {
		if (
			entry.name === "project.config.json" ||
			entry.name === "project.private.config.json"
		)
			continue;

		const sourcePath = join(currentSource, entry.name);
		const relativePath = relative(source, sourcePath);
		const targetPath = join(runtime, relativePath);
		if (entry.isDirectory()) {
			await copyStaticFiles(sourcePath);
			continue;
		}
		if (extname(entry.name) === ".ts") continue;
		await mkdir(dirname(targetPath), { recursive: true });
		await cp(sourcePath, targetPath);
	}
}

/**
 * 使用项目锁定的 TypeScript 编译器输出 CommonJS 页面脚本；小程序只消费 dist，
 * src 仍是唯一业务源码，删除页面时不会留下旧的运行时 JavaScript 文件。
 */
await rm(runtime, { recursive: true, force: true });
await mkdir(runtime, { recursive: true });
const compile = Bun.spawnSync(["pnpm", "exec", "tsc", "-p", buildConfigPath], {
	cwd: root,
	stdout: "inherit",
	stderr: "inherit",
});
if (!compile.success) {
	throw new Error(
		`Mini program TypeScript emit failed with code ${compile.exitCode}`,
	);
}
await copyStaticFiles(source);

for (const file of requiredStaticFiles) {
	await access(join(runtime, file));
}
for (const file of requiredTypeScriptFiles) {
	await access(join(runtime, file.replace(/\.ts$/, ".js")));
}

console.log(
	`Native mini program runtime generated at ${runtime}; required page scripts are present`,
);
