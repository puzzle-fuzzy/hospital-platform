import { cp, mkdir } from "node:fs/promises";
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
	"services/dashboard-service.js",
	"services/session-service.js",
	"pages/index/index.js",
	"pages/index/index.json",
	"pages/index/index.wxml",
	"pages/index/index.wxss",
	"pages/report-detail/report-detail.js",
	"pages/report-detail/report-detail.json",
	"pages/report-detail/report-detail.wxml",
	"pages/report-detail/report-detail.wxss",
];

for (const file of files) {
	const destination = join(output, file);
	await mkdir(join(destination, ".."), { recursive: true });
	await Bun.write(destination, Bun.file(join(source, file)));
}

// 小程序页面使用的本地图片不经过网络请求；构建产物必须完整复制 assets，避免开发者工具或真机出现 404。
await cp(join(source, "assets"), join(output, "assets"), {
	recursive: true,
	force: true,
});

console.log(`Native mini program copied to ${output}`);
