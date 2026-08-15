import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const source = join(root, "src");
const output = join(root, "dist");
const files = [
	"app.js",
	"app.json",
	"app.wxss",
	"sitemap.json",
	"services/api-client.js",
	"pages/index/index.js",
	"pages/index/index.json",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
];

for (const file of files) {
	const destination = join(output, file);
	await mkdir(join(destination, ".."), { recursive: true });
	await Bun.write(destination, Bun.file(join(source, file)));
}

console.log(`Native mini program copied to ${output}`);
