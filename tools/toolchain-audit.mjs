import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * 工具链版本是构建可复现性的组成部分，不应只存在于开发者本机说明中。
 * 本审计只读取仓库声明和 CI 配置，不安装依赖、不访问外部服务，也不修改文件。
 */
export const toolchainFiles = {
	package: "package.json",
	bun: ".bun-version",
	node: ".node-version",
	ci: ".github/workflows/ci.yml",
};

function normalizeVersion(value) {
	return value.trim().replace(/^v/u, "");
}

function readRequiredString(value, label, failures) {
	if (typeof value !== "string" || value.trim().length === 0) {
		failures.push(`${label} 必须是非空字符串`);
		return undefined;
	}
	return value.trim();
}

/** 校验 package.json、版本文件和 CI workflow 是否声明同一套工具链。 */
export function auditToolchainDeclarations({
	packageJson,
	bunVersion,
	nodeVersion,
	ciWorkflow,
}) {
	const failures = [];
	const declaredBun = normalizeVersion(
		readRequiredString(bunVersion, ".bun-version", failures) ?? "",
	);
	const declaredNode = normalizeVersion(
		readRequiredString(nodeVersion, ".node-version", failures) ?? "",
	);
	const packageManager = readRequiredString(
		packageJson?.packageManager,
		"package.json packageManager",
		failures,
	);
	const packageBun = readRequiredString(
		packageJson?.engines?.bun,
		"package.json engines.bun",
		failures,
	);
	const packageNode = readRequiredString(
		packageJson?.engines?.node,
		"package.json engines.node",
		failures,
	);
	const workflow =
		readRequiredString(ciWorkflow, "CI workflow", failures) ?? "";

	if (packageManager !== "pnpm@11.9.0") {
		failures.push("package.json packageManager 必须固定为 pnpm@11.9.0");
	}
	if (packageBun !== declaredBun) {
		failures.push("package.json engines.bun 与 .bun-version 不一致");
	}
	if (packageNode !== declaredNode) {
		failures.push("package.json engines.node 与 .node-version 不一致");
	}
	if (!workflow.includes("bun-version-file: .bun-version")) {
		failures.push("CI workflow 必须使用 .bun-version 安装 Bun");
	}
	if (!workflow.includes("node-version-file: .node-version")) {
		failures.push("CI workflow 必须使用 .node-version 安装 Node.js");
	}
	if (!workflow.includes("version: 11.9.0")) {
		failures.push("CI workflow 必须固定 pnpm 版本 11.9.0");
	}
	if (!workflow.includes("pnpm install --frozen-lockfile")) {
		failures.push("CI workflow 必须使用 pnpm install --frozen-lockfile");
	}
	if (!workflow.includes("pnpm check:candidate")) {
		failures.push("CI workflow 必须执行 pnpm check:candidate");
	}

	return {
		passed: failures.length === 0,
		failures,
		versions: {
			bun: declaredBun,
			node: declaredNode,
			pnpm: packageManager?.replace("pnpm@", "") ?? "",
		},
	};
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

/** 执行仓库工具链声明审计。 */
export async function auditToolchainFiles(rootDirectory = repositoryRoot) {
	const packageJson = await readJson(
		join(rootDirectory, toolchainFiles.package),
	);
	const [bunVersion, nodeVersion, ciWorkflow] = await Promise.all([
		readFile(join(rootDirectory, toolchainFiles.bun), "utf8"),
		readFile(join(rootDirectory, toolchainFiles.node), "utf8"),
		readFile(join(rootDirectory, toolchainFiles.ci), "utf8"),
	]);
	return auditToolchainDeclarations({
		packageJson,
		bunVersion,
		nodeVersion,
		ciWorkflow,
	});
}

if (import.meta.main) {
	try {
		const result = await auditToolchainFiles();
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`工具链声明审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
