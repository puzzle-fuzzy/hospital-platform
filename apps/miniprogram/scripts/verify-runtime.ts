import { access } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const runtime = join(root, "dist");

type MiniProgramAppConfig = {
	pages?: unknown;
};

type MiniProgramProjectConfig = {
	miniprogramRoot?: unknown;
};

/**
 * 真机调试只应该打开构建产物 `dist/`，而不是直接打开 TypeScript 源目录。
 * 这个脚本只读检查现有运行包，不会重新编译、删除或修改任何文件，适合在
 * 微信开发者工具点击“编译/真机调试”前执行。
 */
async function assertFile(relativePath: string): Promise<void> {
	try {
		await access(join(runtime, relativePath));
	} catch {
		throw new Error(
			`Mini program runtime file is missing: dist/${relativePath}. Run pnpm --filter @hospital/miniprogram build first.`,
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

const projectConfig = JSON.parse(
	await Bun.file(join(root, "project.config.json")).text(),
) as MiniProgramProjectConfig;
if (projectConfig.miniprogramRoot !== "dist/") {
	throw new Error(
		"Mini program project.config.json must point to the generated dist/ runtime",
	);
}

await assertFile("app.json");
await assertFile("app.wxss");
await assertFile("sitemap.json");

/**
 * 每个 app.json 入口都必须形成完整的微信页面文件集合。只检查源码会漏掉
 * “源码存在但 dist 没有 JS”的部署错误；只检查 JS 又会漏掉模板或样式缺失。
 */
for (const page of appConfig.pages as string[]) {
	for (const extension of [".js", ".json", ".wxml", ".wxss"] as const) {
		await assertFile(`${page}${extension}`);
	}
}

console.log(
	`Mini program runtime verified: ${appConfig.pages.length} pages and required root files are present in dist/`,
);
