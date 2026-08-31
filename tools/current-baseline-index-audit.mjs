import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");

/**
 * 当前发布基线的机器可读单一入口。
 *
 * 发布文档仍保留给人工阅读，但服务端 release、小程序 sourceRevision、
 * schema head 和真机证据清单不能只靠复制粘贴同步。这个门禁只读校验这些
 * 指纹之间的绑定关系，不访问数据库、Redis、微信或 Provider，也不会执行
 * migration、发布或服务重启。
 */
export const currentBaselineIndexPath = "docs/release/current-baseline.json";
export const currentCandidateDocumentPath =
	"docs/release/candidate-5738a71-server-release-2026-08-28.md";

const fullRevisionPattern = /^[0-9a-f]{40}$/u;
const shortRevisionPattern = /^[0-9a-f]{7,40}$/u;
const schemaHeadPattern = /^\d{4}_[a-z0-9_]+$/u;

function readString(value, label, failures) {
	if (typeof value !== "string" || value.length === 0) {
		failures.push(`${label} 必须是非空字符串`);
		return undefined;
	}
	return value;
}

/** 校验基线 JSON 的结构、格式和发布安全边界。 */
export function validateCurrentBaselineIndex(index) {
	const failures = [];
	if (!index || typeof index !== "object" || Array.isArray(index)) {
		return ["当前基线索引必须是 JSON 对象"];
	}

	if (index.schemaVersion !== 1) {
		failures.push("当前基线索引 schemaVersion 必须为 1");
	}
	const serverRelease = readString(
		index.server?.release,
		"当前基线索引 server.release",
		failures,
	);
	const miniProgramCommit = readString(
		index.miniProgram?.commit,
		"当前基线索引 miniProgram.commit",
		failures,
	);
	const sourceRevision = readString(
		index.miniProgram?.sourceRevision,
		"当前基线索引 miniProgram.sourceRevision",
		failures,
	);
	const schemaHead = readString(
		index.persistence?.schemaHead,
		"当前基线索引 persistence.schemaHead",
		failures,
	);
	const evidenceManifest = readString(
		index.realDeviceEvidence?.manifest,
		"当前基线索引 realDeviceEvidence.manifest",
		failures,
	);

	if (serverRelease && !fullRevisionPattern.test(serverRelease)) {
		failures.push("当前基线索引 server.release 必须是 40 位 Git revision");
	}
	if (miniProgramCommit && !shortRevisionPattern.test(miniProgramCommit)) {
		failures.push("当前基线索引 miniProgram.commit 格式无效");
	}
	if (sourceRevision && !fullRevisionPattern.test(sourceRevision)) {
		failures.push(
			"当前基线索引 miniProgram.sourceRevision 必须是 40 位 Git revision",
		);
	}
	if (
		miniProgramCommit &&
		sourceRevision &&
		!sourceRevision.startsWith(miniProgramCommit)
	) {
		failures.push("当前基线索引 miniProgram.sourceRevision 不是 commit 的前缀");
	}
	if (schemaHead && !schemaHeadPattern.test(schemaHead)) {
		failures.push("当前基线索引 persistence.schemaHead 格式无效");
	}
	if (evidenceManifest?.startsWith("/")) {
		failures.push("当前基线索引真机证据路径必须是仓库相对路径");
	}
	if (!Number.isInteger(index.miniProgram?.pageCount)) {
		failures.push("当前基线索引 miniProgram.pageCount 必须是整数");
	}
	if (
		index.realDeviceEvidence?.status !== "pending" &&
		index.realDeviceEvidence?.status !== "passed" &&
		index.realDeviceEvidence?.status !== "failed"
	) {
		failures.push("当前基线索引真机证据状态必须为 pending、passed 或 failed");
	}

	return failures;
}

function extractCandidateBaseline(candidateDocument) {
	return {
		serverRelease: candidateDocument.match(
			/^\| 服务端 release \| `([0-9a-f]{40})` \|/mu,
		)?.[1],
		miniProgramCommit: candidateDocument.match(
			/^\| 小程序客户端 \| `([0-9a-f]{7,40})` \|/mu,
		)?.[1],
		miniProgramSourceRevision: candidateDocument.match(
			/^\| 小程序构建来源 \| `([0-9a-f]{40})` \|/mu,
		)?.[1],
	};
}

function compareField(failures, label, expected, actual) {
	if (expected !== actual) {
		failures.push(`${label} 与当前基线索引不一致`);
	}
}

/**
 * 比较索引和候选文档、真机清单、live build-info 及迁移源码。
 *
 * `activeMiniProgramSourceRevision` 在 dist 不存在时可以省略；这允许干净
 * checkout 先做候选审计，但只要本地存在 live 运行包，就必须与索引一致。
 */
export function auditCurrentBaselineIndex(index, options = {}) {
	const failures = [...validateCurrentBaselineIndex(index)];
	const candidate = options.candidateDocument
		? extractCandidateBaseline(options.candidateDocument)
		: undefined;
	if (candidate) {
		compareField(
			failures,
			"候选文档 server release",
			index.server?.release,
			candidate.serverRelease,
		);
		compareField(
			failures,
			"候选文档小程序提交",
			index.miniProgram?.commit,
			candidate.miniProgramCommit,
		);
		compareField(
			failures,
			"候选文档小程序 sourceRevision",
			index.miniProgram?.sourceRevision,
			candidate.miniProgramSourceRevision,
		);
	}

	const evidenceCandidate = options.evidenceManifest?.candidate;
	if (evidenceCandidate) {
		compareField(
			failures,
			"真机清单 server release",
			index.server?.release,
			evidenceCandidate.serverRelease,
		);
		compareField(
			failures,
			"真机清单小程序提交",
			index.miniProgram?.commit,
			evidenceCandidate.miniProgramCommit,
		);
		compareField(
			failures,
			"真机清单小程序 sourceRevision",
			index.miniProgram?.sourceRevision,
			evidenceCandidate.sourceRevision,
		);
	}

	if (
		options.activeMiniProgramSourceRevision !== undefined &&
		options.activeMiniProgramSourceRevision !==
			index.miniProgram?.sourceRevision
	) {
		failures.push("live build-info.json sourceRevision 与当前基线索引不一致");
	}
	if (
		options.migrationSource &&
		!options.migrationSource.includes(`id: "${index.persistence?.schemaHead}"`)
	) {
		failures.push("持久化 migration 源码未包含当前 schema head");
	}

	return {
		passed: failures.length === 0,
		failures,
	};
}

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalLiveRevision(rootDirectory) {
	try {
		const buildInfo = await readJson(
			join(rootDirectory, "apps/miniprogram/dist/build-info.json"),
		);
		return buildInfo.sourceRevision;
	} catch (error) {
		if (error?.code === "ENOENT") return undefined;
		throw error;
	}
}

/** 执行当前仓库的索引审计；只读，不连接外部服务。 */
export async function auditCurrentBaselineIndexFile(
	rootDirectory = repositoryRoot,
) {
	const index = await readJson(join(rootDirectory, currentBaselineIndexPath));
	const candidateDocument = await readFile(
		join(rootDirectory, currentCandidateDocumentPath),
		"utf8",
	);
	const evidencePath = index.realDeviceEvidence?.manifest;
	const evidenceManifest = evidencePath
		? await readJson(join(rootDirectory, evidencePath))
		: undefined;
	const migrationSource = await readFile(
		join(rootDirectory, index.persistence?.migrationSource ?? ""),
		"utf8",
	);
	const result = auditCurrentBaselineIndex(index, {
		candidateDocument,
		evidenceManifest,
		activeMiniProgramSourceRevision:
			await readOptionalLiveRevision(rootDirectory),
		migrationSource,
	});
	return {
		...result,
		indexPath: currentBaselineIndexPath,
		serverRelease: index.server?.release,
		miniProgramSourceRevision: index.miniProgram?.sourceRevision,
		schemaHead: index.persistence?.schemaHead,
	};
}

if (import.meta.main) {
	try {
		const result = await auditCurrentBaselineIndexFile();
		console.log(JSON.stringify(result, null, 2));
		if (!result.passed) process.exitCode = 1;
	} catch (error) {
		console.error(
			`当前基线索引审计失败：${error instanceof Error ? error.message : "未知错误"}`,
		);
		process.exitCode = 2;
	}
}
