import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const intakeDirectory = join(repositoryRoot, "docs", "provider-intake");
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

function validateDocument(fileName, content, docsReadme) {
	const errors = [];
	const status = getStatus(content);

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

	if (!docsReadme.includes(`provider-intake/${fileName}`)) {
		errors.push("未在 docs/README.md 登记入口");
	}

	return errors;
}

const fileNames = await readIntakeDocuments();
const docsReadme = await readFile(docsReadmePath, "utf8");
const failures = [];

if (fileNames.length === 0) {
	failures.push("docs/provider-intake 目录没有可审计的 Markdown 文档");
}

for (const fileName of fileNames) {
	const content = await readFile(join(intakeDirectory, fileName), "utf8");
	const errors = validateDocument(fileName, content, docsReadme);
	if (errors.length > 0) failures.push(`${fileName}: ${errors.join("；")}`);
}

if (failures.length > 0) {
	console.error("Provider 文档接收审计失败：");
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(
	`Provider 文档接收审计通过：${fileNames.length} 份文档，状态、来源指纹、冻结边界、脱敏规则和证据入口均已登记`,
);
