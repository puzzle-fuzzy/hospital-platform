import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const dist = join(root, "dist");

async function listFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(path)));
		else files.push(path);
	}
	return files;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const sourceFiles = await listFiles(source);
const pagesRoot = join(source, "pages");
const pageEntries = sourceFiles.filter(
	(file) =>
		file.startsWith(`${pagesRoot}/`) &&
		file.endsWith(".ts") &&
		!file.endsWith(".test.ts") &&
		!file.endsWith("/app.ts"),
);

const pageResult = await Bun.build({
	entrypoints: pageEntries,
	outdir: dist,
	root: source,
	naming: "[dir]/[name].js",
	format: "cjs",
	target: "browser",
	minify: false,
});
if (!pageResult.success) throw new Error("门诊缴费小程序页面脚本构建失败");

const appResult = await Bun.build({
	entrypoints: [join(source, "app.ts")],
	outdir: dist,
	root: source,
	naming: "[name].js",
	format: "iife",
	target: "browser",
	minify: false,
});
if (!appResult.success) throw new Error("门诊缴费小程序 app.js 构建失败");

for (const file of sourceFiles.filter((item) => !item.endsWith(".ts"))) {
	const output = join(dist, relative(source, file));
	await mkdir(join(output, ".."), { recursive: true });
	await Bun.write(output, Bun.file(file));
}

const config = JSON.parse(
	await Bun.file(join(root, "project.config.json")).text(),
) as Record<string, unknown>;
config.miniprogramRoot = "./";
await Bun.write(
	join(dist, "project.config.json"),
	JSON.stringify(config, null, 2),
);

for (const file of [
	"app.js",
	"app.json",
	"pages/index/index.js",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
]) {
	if (!(await Bun.file(join(dist, file)).exists()))
		throw new Error(`构建产物缺失：${file}`);
}

console.log(
	`miniprogram-outpatient-pay built: ${relative(process.cwd(), dist)}`,
);
