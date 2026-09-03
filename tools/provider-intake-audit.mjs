import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const intakeDirectory = join(repositoryRoot, "docs", "提供商接入");
const docsReadmePath = join(repositoryRoot, "docs", "README.md");

const allowedStatuses = new Set([
	"received",
	"normalized",
	"confirmed",
	"rejected",
	"expired",
]);

/**
 * Provider 文档是业务 contract 的输入，不是普通说明文档。
 * 这里故意只做结构性审计，不解析接口字段，以免脚本替代人工判断
 * HTTP 200、业务成功、幂等和最终状态等高风险业务事实。
 */
const requiredSections = [
	{ pattern: /^#\s+/m, label: "文档标题" },
	{ pattern: /SHA-256/i, label: "来源内容指纹" },
	{ pattern: /脱敏/, label: "敏感数据脱敏边界" },
	{ pattern: /冻结|不开放|未开放/, label: "当前冻结或未开放边界" },
	{ pattern: /下一步|执行顺序/, label: "下一步执行顺序" },
];

async function readIntakeDocuments() {
	const entries = await readdir(intakeDirectory, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
		.map((entry) => entry.name)
		.sort();
}

function getStatus(content) {
	const match = content.match(/^> 当前状态：`([^`]+)`/mu);
	return match?.[1] ?? null;
}

/**
 * 每一份原始材料都必须有稳定 documentId；同一份接收记录可以包含多个原始文件，
 * 但每个 ID 只能在仓库中出现一次。只从同时包含完整 SHA-256 的来源表格行提取，
 * 避免把接口参数或错误码中的反引号误判成来源 ID。
 */
function getDocumentIds(content) {
	return content.split("\n").flatMap((line) => {
		const match = line.match(/^\|\s*`([^`]+)`\s*\|/u);
		return match && /`[a-f0-9]{64}`/iu.test(line) ? [match[1]] : [];
	});
}

/** 来源指纹必须是完整 SHA-256，不能用短 hash 或文件大小替代内容指纹。 */
function getSha256Fingerprints(content) {
	return [...content.matchAll(/`([a-f0-9]{64})`/giu)].map((match) =>
		match[1].toLowerCase(),
	);
}

function validateDocument(fileName, content, docsReadme) {
	const errors = [];
	const status = getStatus(content);
	const documentIds = getDocumentIds(content);
	const fingerprints = getSha256Fingerprints(content);

	if (!status) {
		errors.push("缺少 `> 当前状态：` 状态声明");
	} else if (!allowedStatuses.has(status)) {
		errors.push(`状态 ${JSON.stringify(status)} 不在允许集合内`);
	}

	for (const section of requiredSections) {
		if (!section.pattern.test(content)) {
			errors.push(`缺少${section.label}`);
		}
	}

	if (documentIds.length === 0) {
		errors.push("缺少来源表格中的稳定 `documentId`");
	} else {
		for (const documentId of documentIds) {
			if (!/^[a-z][a-z0-9.]*(?:-[a-z0-9.]+){2,}$/iu.test(documentId)) {
				errors.push(`documentId 格式不稳定：${JSON.stringify(documentId)}`);
			}
		}
		if (new Set(documentIds).size !== documentIds.length) {
			errors.push("同一接收记录内存在重复 documentId");
		}
	}

	if (fingerprints.length < documentIds.length) {
		errors.push(
			`SHA-256 指纹数量不足：documentId=${documentIds.length}，指纹=${fingerprints.length}`,
		);
	}
	if (!/版本|更新时间|发布日期|version/iu.test(content))
		errors.push("缺少版本、更新时间或发布日期字段");
	if (!/环境|environment/iu.test(content)) errors.push("缺少适用环境字段");

	// `confirmed` 只能表示有真实证据，不允许仅凭文档解析结果升级。
	if (status === "confirmed") {
		const confirmationEvidence = [
			/provider\s*request\s*id|providerRequestId/i,
			/公网/,
			/真机/,
			/回滚/,
		];
		for (const pattern of confirmationEvidence) {
			if (!pattern.test(content)) {
				errors.push(`confirmed 文档缺少证据字段：${pattern}`);
			}
		}
	}

	if (!docsReadme.includes(`提供商接入/${fileName}`)) {
		errors.push("未在 docs/README.md 登记入口");
	}

	return { errors, documentIds };
}

const fileNames = await readIntakeDocuments();
const docsReadme = await readFile(docsReadmePath, "utf8");
const failures = [];
const documentOwners = new Map();

if (fileNames.length === 0) {
	failures.push("docs/提供商接入 目录没有可审计的 Markdown 文档");
}

for (const fileName of fileNames) {
	const content = await readFile(join(intakeDirectory, fileName), "utf8");
	const result = validateDocument(fileName, content, docsReadme);
	if (result.errors.length > 0)
		failures.push(`${fileName}: ${result.errors.join("；")}`);
	for (const documentId of result.documentIds) {
		const previousOwner = documentOwners.get(documentId);
		if (previousOwner) {
			failures.push(
				`${fileName}: documentId ${JSON.stringify(documentId)} 已在 ${previousOwner} 登记`,
			);
		} else {
			documentOwners.set(documentId, fileName);
		}
	}
}

if (failures.length > 0) {
	console.error("Provider 文档接收审计失败：");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	`Provider 文档接收审计通过：${fileNames.length} 份接收记录、${documentOwners.size} 个 documentId，状态、版本环境、来源指纹、冻结边界、脱敏规则和证据入口均已登记`,
);
