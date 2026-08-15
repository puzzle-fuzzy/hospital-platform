import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const output = join(root, "dist");
const staticFiles = [
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
const runtimeTypescriptFiles = [
	"app.ts",
	"services/api-client.ts",
	"services/dashboard-service.ts",
	"services/session-service.ts",
	"pages/index/index.ts",
	"pages/report-detail/report-detail.ts",
];

// 每次构建先清理上次生成的 JS，防止 JS 改名为 TS 后残留旧入口，造成开发者工具加载到过期代码。
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of staticFiles) {
	const destination = join(output, file);
	await mkdir(join(destination, ".."), { recursive: true });
	await Bun.write(destination, Bun.file(join(source, file)));
}

// 类型检查由 package 的 typecheck 脚本负责；Bun 构建器只做逐入口的 TypeScript
// 转换和 CommonJS 输出，保留微信页面之间的原生模块边界，不把页面打成运行时框架。
for (const file of runtimeTypescriptFiles) {
	const destination = join(output, file.replace(/\.ts$/, ".js"));
	await mkdir(join(destination, ".."), { recursive: true });
	const result = await Bun.build({
		entrypoints: [join(source, file)],
		outdir: output,
		naming: file.replace(/\.ts$/, ".js"),
		target: "browser",
		format: "cjs",
		minify: false,
		sourcemap: "none",
	});
	if (!result.success) {
		throw new Error(`Mini program build failed for ${file}`);
	}
}

// 小程序页面使用的本地图片不经过网络请求；构建产物必须完整复制 assets，避免开发者工具或真机出现 404。
await cp(join(source, "assets"), join(output, "assets"), {
	recursive: true,
	force: true,
});

console.log(
	`Native mini program built from TypeScript to CommonJS at ${output}`,
);
