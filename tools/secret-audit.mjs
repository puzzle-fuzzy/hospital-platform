import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * 这是仓库边界扫描，不是完整的凭据管理平台：它只报告文件路径、行号和提交号，
 * 绝不把匹配到的秘密原文打印出来。真实凭据仍必须由服务器密钥管理和轮换流程负责。
 */
export const secretAuditPatterns = [
	{
		name: "private-key-marker",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/gu,
		historyPattern:
			"-----BEGIN (RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----",
	},
	{
		name: "credential-assignment",
		pattern:
			/^(?:WECHAT_APP_SECRET|WECHAT_PAY_API_V3_KEY|WECHAT_PAY_MERCHANT_PRIVATE_KEY|ZHONGYANG_AUTHORIZATION_TOKEN|DATABASE_URL|REDIS_URL)=([^\r\n#]*)$/gmu,
		historyPattern:
			"^(WECHAT_APP_SECRET|WECHAT_PAY_API_V3_KEY|WECHAT_PAY_MERCHANT_PRIVATE_KEY|ZHONGYANG_AUTHORIZATION_TOKEN|DATABASE_URL|REDIS_URL)=",
	},
];

const sensitivePathPattern =
	/(^|\/)(?:\.env(?:\.[^/]+)?|[^/]+\.(?:pem|key))$/iu;
const allowedExamplePathPattern = /\.example$/iu;

function decode(bytes) {
	return new TextDecoder().decode(bytes);
}

function lineNumberAt(content, index) {
	return content.slice(0, index).split("\n").length;
}

/** 扫描单个文本内容；返回安全定位信息，不返回匹配原文。 */
export function auditSecretContent(path, content) {
	const findings = [];
	for (const { name, pattern } of secretAuditPatterns) {
		pattern.lastIndex = 0;
		for (const match of content.matchAll(pattern)) {
			const assignedValue = match[1]?.trim() ?? "";
			if (
				name === "credential-assignment" &&
				(!assignedValue || assignedValue.includes("<"))
			) {
				continue;
			}
			findings.push({
				reason: name,
				path,
				line: lineNumberAt(content, match.index ?? 0),
			});
		}
	}
	return findings;
}

/** 扫描仓库路径名，禁止把真实 env、PEM 或 key 文件纳入版本库。 */
export function auditSensitivePaths(paths, source = "worktree") {
	return paths
		.filter(
			(path) =>
				sensitivePathPattern.test(path) &&
				!allowedExamplePathPattern.test(path),
		)
		.map((path) => ({
			reason: "sensitive-file-name",
			path,
			source,
		}));
}

function runGit(rootDirectory, args) {
	const result = Bun.spawnSync(["git", ...args], {
		cwd: rootDirectory,
		stderr: "pipe",
		stdout: "pipe",
	});
	if (result.exitCode !== 0) {
		throw new Error(`git ${args[0]} 执行失败`);
	}
	return decode(result.stdout);
}

function splitNullSeparated(value) {
	return value.split("\0").filter(Boolean);
}

async function auditCurrentTrackedFiles(rootDirectory) {
	const trackedPaths = splitNullSeparated(
		runGit(rootDirectory, ["ls-files", "-z"]),
	);
	const findings = [...auditSensitivePaths(trackedPaths)];
	for (const path of trackedPaths) {
		const bytes = await readFile(join(rootDirectory, path));
		if (bytes.includes(0)) continue;
		findings.push(...auditSecretContent(path, decode(bytes)));
	}
	return findings;
}

function auditHistory(rootDirectory) {
	const findings = auditSensitivePaths(
		runGit(rootDirectory, ["rev-list", "--objects", "--all"])
			.split(/\r?\n/u)
			.map((line) => line.slice(line.indexOf(" ") + 1))
			.filter((path) => path !== lineSentinel(path)),
		"history-path",
	);
	for (const { name, pattern, historyPattern } of secretAuditPatterns) {
		const commits = runGit(rootDirectory, [
			"log",
			"--all",
			"--format=%H",
			`-G${historyPattern ?? pattern.source}`,
			"--",
			".",
		]);
		for (const commit of commits.split(/\r?\n/u).filter(Boolean)) {
			const diffLines = runGit(rootDirectory, [
				"show",
				"--format=",
				"--unified=0",
				commit,
				"--",
				".",
			]).split(/\r?\n/u);
			let currentPath = "";
			let nextAddedLine = 0;
			for (const diffLine of diffLines) {
				if (diffLine.startsWith("+++ b/")) {
					currentPath = diffLine.slice("+++ b/".length);
					continue;
				}
				const hunk = diffLine.match(/^@@ .* \+(\d+)/u);
				if (hunk) {
					nextAddedLine = Number(hunk[1]);
					continue;
				}
				if (!diffLine.startsWith("+") || diffLine.startsWith("+++")) {
					continue;
				}
				// 测试夹具中的 marker 是扫描器自身的输入，不是仓库凭据；
				// 按文件边界跳过它，仍保留其它测试和业务文件的历史告警。
				if (currentPath === "tools/secret-audit.test.mjs") {
					nextAddedLine += 1;
					continue;
				}
				const lineFindings = auditSecretContent(
					`commit:${commit}`,
					diffLine.slice(1),
				);
				for (const finding of lineFindings) {
					if (finding.reason !== name) continue;
					findings.push({
						reason: `history-${name}`,
						commit,
						line: nextAddedLine,
					});
				}
				nextAddedLine += 1;
			}
		}
	}
	return findings;
}

// `rev-list --objects` 中没有路径的行只包含 object id；这些不是文件路径。
function lineSentinel(path) {
	return path.length === 40 && /^[0-9a-f]+$/iu.test(path) ? path : "";
}

/** 执行工作树扫描，按需追加 Git 可达历史扫描。 */
export async function auditSecretRepository(
	rootDirectory = repositoryRoot,
	{ includeHistory = false } = {},
) {
	const findings = await auditCurrentTrackedFiles(rootDirectory);
	if (includeHistory) findings.push(...auditHistory(rootDirectory));
	return {
		passed: findings.length === 0,
		findings,
		includeHistory,
	};
}

if (import.meta.main) {
	try {
		const includeHistory = Bun.argv.includes("--history");
		const result = await auditSecretRepository(repositoryRoot, {
			includeHistory,
		});
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`secret scan 执行失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
