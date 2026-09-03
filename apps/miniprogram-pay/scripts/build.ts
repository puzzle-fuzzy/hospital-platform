import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const dist = join(root, "dist");
const medicalCredentialPath = join(
	root,
	"../../.local/medical-insurance/test-environment-key-material.json",
);

let medicalOrgChannelCredential = "";
if (await Bun.file(medicalCredentialPath).exists()) {
	const localConfig = JSON.parse(await Bun.file(medicalCredentialPath).text()) as {
		identityVerificationFeedback?: { orgChannelAuthCode?: unknown };
	};
	medicalOrgChannelCredential = String(
		localConfig.identityVerificationFeedback?.orgChannelAuthCode || "",
	).trim();
}
const buildDefines = {
	MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: JSON.stringify(
		medicalOrgChannelCredential,
	),
};

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
	define: buildDefines,
	naming: "[dir]/[name].js",
	format: "cjs",
	target: "browser",
	minify: false,
});
if (!pageResult.success) throw new Error("小程序页面脚本构建失败");

const appResult = await Bun.build({
	entrypoints: [join(source, "app.ts")],
	outdir: dist,
	root: source,
	define: buildDefines,
	naming: "[name].js",
	format: "iife",
	target: "browser",
	minify: false,
});
if (!appResult.success) throw new Error("小程序 app.js 构建失败");

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

const required = [
	"app.js",
	"app.json",
	"pages/index/index.js",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
];
for (const file of required) {
	if (!(await Bun.file(join(dist, file)).exists()))
		throw new Error(`构建产物缺失：${file}`);
}
console.log(`miniprogram-pay built: ${relative(process.cwd(), dist)}`);
