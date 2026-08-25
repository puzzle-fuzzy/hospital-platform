import { fileURLToPath } from "node:url";

/**
 * 小程序页面落点与主 Tab 导航审计。
 *
 * 迁移期间页面会持续增加，最容易被忽略的不是业务 schema，而是把一个
 * 已注册页面写成了 404，或者把四个主 Tab 用 navigateTo/reLaunch 当成普通
 * 页面压入页面栈。前者会直接阻断用户，后者会破坏微信原生 tabBar 的共享
 * 生命周期、选中态和底部固定布局。
 *
 * 本工具只读取原生小程序源代码和 app.json，不访问旧服务、数据库、Redis
 * 或 Provider；它检查的是“入口落点正确”，不是对应业务已经完成。
 */

const repositoryRoot = new URL("../", import.meta.url);
const repositoryPath = fileURLToPath(repositoryRoot);

const normalizePagePath = (value) =>
	value.replace(/^\//u, "").split(/[?#]/u, 1)[0];

const fileExists = async (url) => Bun.file(url).exists();

function lineNumber(source, offset) {
	return source.slice(0, offset).split("\n").length;
}

/**
 * 只审计带字面量 URL 的调用；动态 URL 由具体导航服务的单元测试负责。
 * 这样既能抓到真正的固定错误，又不会把参数拼接误判成不存在页面。
 */
const NAVIGATION_CALL_PATTERN =
	/\b(navigateTo|redirectTo|reLaunch|switchTab)\s*\(\s*\{\s*url\s*:\s*["']([^"']+)["']/gu;

/**
 * 执行导航审计并返回结构化结果，供 CLI 和 Bun 测试共同使用。
 */
export async function auditMiniprogramNavigation(root = repositoryPath) {
	const sourceRoot = `${root}/apps/miniprogram/src`;
	const sourcePath = (pagePath, suffix) => `${sourceRoot}/${pagePath}${suffix}`;
	const appConfig = JSON.parse(await Bun.file(`${sourceRoot}/app.json`).text());
	const registeredPages = new Set(appConfig.pages);
	const tabBarItems = appConfig.tabBar?.list ?? [];
	const tabBarPages = new Set(tabBarItems.map((item) => item.pagePath));
	const failures = [];
	const pageFileChecks = [];

	if (appConfig.tabBar?.custom === true) {
		failures.push(
			"app.json 不应启用 custom tabBar；本项目使用微信原生共享底栏",
		);
	}

	if (tabBarItems.length !== 4) {
		failures.push(`app.json 主 Tab 数量应为 4，实际为 ${tabBarItems.length}`);
	}

	const uniqueTabBarPages = new Set(tabBarItems.map((item) => item.pagePath));
	if (uniqueTabBarPages.size !== tabBarItems.length) {
		failures.push("app.json 主 Tab 存在重复 pagePath");
	}

	for (const pagePath of registeredPages) {
		if (!pagePath.startsWith("pages/")) {
			failures.push(`app.json 页面路径必须以 pages/ 开头：${pagePath}`);
			continue;
		}
		for (const suffix of [".json", ".ts", ".wxml", ".wxss"]) {
			const exists = await fileExists(sourcePath(pagePath, suffix));
			pageFileChecks.push({ pagePath, suffix, exists });
			if (!exists) {
				failures.push(`注册页面缺少源文件：${pagePath}${suffix}`);
			}
		}
	}

	for (const item of tabBarItems) {
		if (!registeredPages.has(item.pagePath)) {
			failures.push(`主 Tab 指向未注册页面：${item.pagePath}`);
		}
		for (const assetPath of [item.iconPath, item.selectedIconPath]) {
			if (typeof assetPath !== "string" || assetPath.length === 0) {
				failures.push(`主 Tab 图标路径为空：${item.pagePath}`);
				continue;
			}
			if (!(await fileExists(`${sourceRoot}/${assetPath}`))) {
				failures.push(`主 Tab 图标不存在：${assetPath}`);
			}
		}
	}

	const sourceFiles = [];
	const glob = new Bun.Glob("apps/miniprogram/src/**/*.ts");
	for await (const relativeFile of glob.scan({ cwd: root, onlyFiles: true })) {
		if (/(?:\.test|\.spec)\.ts$/u.test(relativeFile)) continue;
		sourceFiles.push(relativeFile);
	}

	const navigationCalls = [];
	for (const relativeFile of sourceFiles) {
		const source = await Bun.file(`${root}/${relativeFile}`).text();
		for (const match of source.matchAll(NAVIGATION_CALL_PATTERN)) {
			const [, method, rawUrl] = match;
			const target = normalizePagePath(rawUrl);
			const location = `${relativeFile}:${lineNumber(source, match.index ?? 0)}`;
			navigationCalls.push({ location, method, rawUrl, target });

			if (!target.startsWith("pages/")) continue;
			if (!registeredPages.has(target)) {
				failures.push(`${location} 导航到未注册页面：${rawUrl}`);
			}
			if (tabBarPages.has(target) && method !== "switchTab") {
				failures.push(
					`${location} 主 Tab 必须使用 switchTab，实际为 ${method}：${rawUrl}`,
				);
			}
			if (!tabBarPages.has(target) && method === "switchTab") {
				failures.push(
					`${location} switchTab 只能指向四个主 Tab，实际为：${rawUrl}`,
				);
			}
		}
	}

	return {
		registeredPageCount: registeredPages.size,
		tabBarPageCount: tabBarPages.size,
		pageFileChecks,
		navigationCalls,
		failures,
		passed: failures.length === 0,
	};
}

if (import.meta.main) {
	const result = await auditMiniprogramNavigation();
	if (!result.passed) {
		console.error(
			`Mini program navigation audit failed: ${result.failures.length} rule(s)`,
		);
		for (const failure of result.failures) console.error(`- ${failure}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Mini program navigation audit passed: ${result.registeredPageCount} pages, ${result.tabBarPageCount} primary tabs, ${result.navigationCalls.length} literal navigation call(s)`,
		);
	}
}
