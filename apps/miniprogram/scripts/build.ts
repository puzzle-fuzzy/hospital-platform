import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const runtime = join(root, "dist");
const projectConfigPath = join(root, "project.config.json");
const privateProjectConfigPath = join(root, "project.private.config.json");
const buildConfigPath = join(root, "tsconfig.build.json");
const requiredStaticFiles = [
	"app.json",
	"app.wxss",
	"sitemap.json",
	"pages/index/index.json",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
	"pages/official-account/official-account.json",
	"pages/official-account/official-account.wxml",
	"pages/official-account/official-account.wxss",
	"pages/feedback/feedback.json",
	"pages/feedback/feedback.wxml",
	"pages/feedback/feedback.wxss",
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
	"pages/profile/profile.json",
	"pages/profile/profile.wxml",
	"pages/profile/profile.wxss",
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
	"pages/official-account/official-account.ts",
	"pages/feedback/feedback.ts",
	"pages/hospital-list/hospital-list.ts",
	"pages/appointment-directory/appointment-directory.ts",
	"pages/appointment-records/appointment-records.ts",
	"pages/report-directory/report-directory.ts",
	"pages/index/index.ts",
	"pages/report-detail/report-detail.ts",
	"pages/outpatient-payment/outpatient-payment.ts",
	"pages/profile/profile.ts",
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

/**
 * CommonJS 页面脚本的间接依赖不能交给开发者工具的“未使用文件”推断。
 * private 配置不纳入 Git，但只要本机存在，就必须关闭该优化，否则真实存在的
 * `services/*.js` 可能不会进入调试模块图，最终在模拟器/真机报模块未定义。
 */
let privateProjectConfigExists = true;
try {
	await access(privateProjectConfigPath);
} catch {
	// CI 或新机器可能还没有开发者工具生成的 private 配置，此时不阻断构建。
	privateProjectConfigExists = false;
}
if (privateProjectConfigExists) {
	const privateProjectConfig = JSON.parse(
		await Bun.file(privateProjectConfigPath).text(),
	) as { setting?: { ignoreDevUnusedFiles?: unknown } };
	if (privateProjectConfig.setting?.ignoreDevUnusedFiles !== false) {
		throw new Error(
			"Mini program project.private.config.json must keep setting.ignoreDevUnusedFiles=false",
		);
	}
}

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

const appConfig = JSON.parse(
	await Bun.file(join(source, "app.json")).text(),
) as { pages?: unknown };
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
		"Mini program app.json pages must be non-empty, relative paths without parent traversal",
	);
}

/**
 * app.json 是小程序真正的页面入口，不能只依赖下面手工维护的“重点文件”列表。
 * 每个入口必须同时拥有页面配置、模板、样式和 TypeScript 源码，构建完成后还
 * 必须拥有同名 JavaScript 运行文件，从源代码到真机上传包形成闭环门禁。
 */
const appPagePaths = appConfig.pages as string[];

/** 对正则字面量中的页面方法名做最小转义，避免特殊字符影响门禁表达式。 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 检查原生页面的模板、样式和跳转边界。
 *
 * 微信开发者工具对 WXML 事件、页面路径和本地资源的校验并不总是在构建阶段
 * 给出阻断错误：页面可能成功编译，但真机点击后才发现方法不存在、目标页面
 * 未注册，或 WXSS 尝试读取本地图片。把这些检查放在源码到 dist 的必经构建
 * 阶段，可以让“能上传”与“运行时入口完整”保持同一条证据链。
 */
async function validatePageRuntimeBoundaries(
	pagePaths: readonly string[],
): Promise<void> {
	const registeredPages = new Set(pagePaths);
	const bindingPattern = /(?:bind|catch)[a-z]+="([A-Za-z_$][\w$]*)"/g;
	const localAssetPattern = /\/assets\/[A-Za-z0-9._/-]+/g;
	const pageNavigationPattern = /url:\s*["'](\/pages\/[^"']+)["']/g;

	for (const pagePath of pagePaths) {
		const templatePath = join(source, `${pagePath}.wxml`);
		const stylePath = join(source, `${pagePath}.wxss`);
		const scriptPath = join(source, `${pagePath}.ts`);
		const [template, style, script] = await Promise.all([
			Bun.file(templatePath).text(),
			Bun.file(stylePath).text(),
			Bun.file(scriptPath).text(),
		]);

		if (/url\s*\(\s*["']?\/assets\//.test(style)) {
			throw new Error(
				`${pagePath}.wxss cannot load local assets with background-image; use WXML image or base64`,
			);
		}

		const assetReferences = new Set([
			...(template.match(localAssetPattern) ?? []),
			...(style.match(localAssetPattern) ?? []),
		]);
		for (const assetReference of assetReferences) {
			await access(join(source, assetReference.replace(/^\//, "")));
		}

		const pageEntryIndex = script.indexOf("Page<");
		if (pageEntryIndex < 0) {
			throw new Error(`${pagePath}.ts must contain a Page implementation`);
		}
		const pageImplementation = script.slice(pageEntryIndex);
		for (const match of template.matchAll(bindingPattern)) {
			const handler = match[1];
			if (!handler) continue;
			const handlerPattern = new RegExp(
				`(?:^|\\n)\\s*${escapeRegExp(handler)}\\s*(?::\\s*)?\\(`,
			);
			if (!handlerPattern.test(pageImplementation)) {
				throw new Error(
					`${pagePath}.wxml binds ${handler}, but the Page implementation does not define it`,
				);
			}
		}

		for (const match of script.matchAll(pageNavigationPattern)) {
			const target = match[1]?.replace(/^\//, "");
			if (target && !registeredPages.has(target)) {
				throw new Error(
					`${pagePath}.ts navigates to unregistered mini-program page ${target}`,
				);
			}
		}
	}
}

for (const pagePath of appPagePaths) {
	for (const extension of [".json", ".wxml", ".wxss", ".ts"]) {
		await access(join(source, `${pagePath}${extension}`));
	}
}

await validatePageRuntimeBoundaries(appPagePaths);

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
for (const pagePath of appPagePaths) {
	await access(join(runtime, `${pagePath}.js`));
}

console.log(
	`Native mini program runtime generated at ${runtime}; ${appPagePaths.length} app.json page scripts are present`,
);
