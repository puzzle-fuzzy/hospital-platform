import { expect, test } from "bun:test";
import { auditToolchainDeclarations } from "./toolchain-audit.mjs";

const validInput = {
	packageJson: {
		packageManager: "pnpm@11.9.0",
		engines: {
			bun: "1.4.0",
			node: "24.12.0",
		},
	},
	bunVersion: "1.4.0\n",
	nodeVersion: "v24.12.0\n",
	ciWorkflow: [
		"bun-version-file: .bun-version",
		"node-version-file: .node-version",
		"version: 11.9.0",
		"pnpm install --frozen-lockfile",
		"pnpm check:candidate",
	].join("\n"),
};

test("工具链声明必须保持一致", () => {
	const result = auditToolchainDeclarations(validInput);

	expect(result.passed).toBe(true);
	expect(result.failures).toEqual([]);
	expect(result.versions).toEqual({
		bun: "1.4.0",
		node: "24.12.0",
		pnpm: "11.9.0",
	});
});

test("工具链声明拒绝漂移的 Node、pnpm 和 frozen lockfile 门禁", () => {
	const result = auditToolchainDeclarations({
		...validInput,
		packageJson: {
			...validInput.packageJson,
			packageManager: "pnpm@11.19.0",
		},
		nodeVersion: "24.12.1",
		ciWorkflow: "pnpm install",
	});

	expect(result.passed).toBe(false);
	expect(result.failures).toEqual([
		"package.json packageManager 必须固定为 pnpm@11.9.0",
		"package.json engines.node 与 .node-version 不一致",
		"CI workflow 必须使用 .bun-version 安装 Bun",
		"CI workflow 必须使用 .node-version 安装 Node.js",
		"CI workflow 必须固定 pnpm 版本 11.9.0",
		"CI workflow 必须使用 pnpm install --frozen-lockfile",
		"CI workflow 必须执行 pnpm check:candidate",
	]);
});
