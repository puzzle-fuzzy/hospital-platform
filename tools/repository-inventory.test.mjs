import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inventoryRepository } from "./repository-inventory.mjs";

test("盘点包括缺失跟踪文件和重复文件，忽略本机正文及未跟踪资料", {
	timeout: 15_000,
}, async () => {
	const root = await mkdtemp(join(tmpdir(), "hospital-inventory-"));
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, stdio: "pipe" });
	try {
		git("init", "--quiet");
		await mkdir(join(root, "docs"));
		await writeFile(join(root, ".gitignore"), ".local/\n");
		await writeFile(join(root, "docs/a.md"), "same\n");
		await writeFile(join(root, "docs/b.md"), "same\n");
		await writeFile(join(root, "missing.ts"), "export {};\n");
		git("add", ".");
		git(
			"-c",
			"user.name=Inventory Test",
			"-c",
			"user.email=inventory@example.invalid",
			"commit",
			"-qm",
			"fixture",
		);
		await mkdir(join(root, ".local"));
		// 故意是无效 JSON：若读取 ignored 正文作为 manifest，测试会失败。
		await writeFile(join(root, ".local/package.json"), "private-invalid-json");
		git("add", "-f", ".local/package.json");
		await writeFile(join(root, "untracked.md"), "untracked");
		await rm(join(root, "missing.ts"));
		const report = await inventoryRepository(root);
		expect(report.trackedFiles).toBe(5);
		expect(report.ignoredTracked).toEqual([".local/package.json"]);
		expect(report.missing).toEqual(["missing.ts"]);
		expect(report.documents).toMatchObject({ files: 2, markdown: 2 });
		expect(report.duplicateGroups).toHaveLength(1);
		expect(report.duplicateGroups[0].paths).toEqual(["docs/a.md", "docs/b.md"]);
		expect(report.manifests).toEqual([]);
	} finally {
		// 只清理本测试 mkdtemp 返回的隔离目录，不使用仓库路径。
		await rm(root, { recursive: true, force: true });
	}
});
