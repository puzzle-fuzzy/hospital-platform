import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 只盘点 Git 跟踪文件，不递归遍历本机数据或跟随符号链接。 */
export async function inventoryRepository(root = repositoryRoot) {
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, encoding: "utf8" });
	const index = new Map(
		git("ls-files", "--stage", "-z")
			.split("\0")
			.filter(Boolean)
			.map((entry) => {
				const separator = entry.indexOf("\t");
				return [
					entry.slice(separator + 1),
					entry.slice(0, separator).split(" ")[0],
				];
			}),
	);
	const paths = [...index.keys()].sort();
	const ignoredTracked = git("ls-files", "-z", "-i", "-c", "--exclude-standard")
		.split("\0")
		.filter(Boolean)
		.sort();
	const ignored = new Set(ignoredTracked);
	const directories = new Map();
	const documentCategories = new Map();
	const hashes = new Map();
	const sources = [];
	const manifests = [];
	const missing = [];
	const symlinks = [];
	let totalBytes = 0;
	let markdownCount = 0;
	let documentCount = 0;
	for (const path of paths) {
		const absolute = join(root, path);
		// Git 的 120000 模式同时覆盖 Windows 上以普通文本检出的链接。
		if (index.get(path) === "120000") {
			symlinks.push(path);
			continue;
		}
		const parentParts = path.split("/").slice(0, -1);
		let linkedParent = false;
		let parent = root;
		for (const part of parentParts) {
			parent = join(parent, part);
			try {
				if ((await lstat(parent)).isSymbolicLink()) {
					linkedParent = true;
					break;
				}
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		}
		if (linkedParent) {
			symlinks.push(path);
			continue;
		}
		let stat;
		try {
			stat = await lstat(absolute);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			missing.push(path);
			continue;
		}
		if (stat.isSymbolicLink() || !stat.isFile()) {
			symlinks.push(path);
			continue;
		}
		const directory = path.includes("/") ? path.split("/")[0] : "(root)";
		const group = directories.get(directory) ?? {
			path: directory,
			files: 0,
			bytes: 0,
		};
		group.files += 1;
		group.bytes += stat.size;
		directories.set(directory, group);
		totalBytes += stat.size;
		if (path.startsWith("docs/")) {
			documentCount += 1;
			if (path.endsWith(".md")) markdownCount += 1;
			const category =
				path.split("/").length === 2 ? "(root)" : path.split("/")[1];
			documentCategories.set(
				category,
				(documentCategories.get(category) ?? 0) + 1,
			);
		}
		// 已忽略却仍跟踪的本机资料只报告路径，不读取正文或生成内容指纹。
		if (ignored.has(path)) continue;
		const data = await readFile(absolute);
		const hash = createHash("sha256").update(data).digest("hex");
		const duplicates = hashes.get(hash) ?? {
			sha256: hash,
			bytes: data.length,
			paths: [],
		};
		duplicates.paths.push(path);
		hashes.set(hash, duplicates);
		if (/\.(?:ts|tsx|mjs)$/u.test(path) && !/\.(?:test|spec)\./u.test(path)) {
			sources.push({
				path,
				lines: data.toString("utf8").trimEnd().split("\n").length,
			});
		}
		if (path.endsWith("package.json")) {
			const manifest = JSON.parse(data.toString("utf8"));
			manifests.push({
				path,
				name: manifest.name,
				packageManager: manifest.packageManager,
				dependencies: Object.entries(manifest.dependencies ?? {})
					.filter(([name]) => name.startsWith("@hospital/"))
					.map(([name]) => name)
					.sort(),
			});
		}
	}
	return {
		schemaVersion: 1,
		sourceRevision: git("rev-parse", "HEAD").trim(),
		scope:
			"tracked-working-tree; excludes untracked and ignored content; no deletion decisions",
		trackedFiles: paths.length,
		totalBytes,
		ignoredTracked,
		missing,
		symlinks,
		directories: [...directories.values()].sort((a, b) =>
			a.path.localeCompare(b.path, "en"),
		),
		documents: {
			files: documentCount,
			markdown: markdownCount,
			categories: Object.fromEntries(
				[...documentCategories].sort(([a], [b]) => a.localeCompare(b, "en")),
			),
		},
		manifests,
		largestSourceFiles: sources
			.sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path, "en"))
			.slice(0, 20),
		duplicateGroups: [...hashes.values()]
			.filter((group) => group.paths.length > 1)
			.sort((a, b) => a.paths[0].localeCompare(b.paths[0], "en")),
	};
}

if (
	process.argv[1] &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	console.log(JSON.stringify(await inventoryRepository(), null, 2));
}
