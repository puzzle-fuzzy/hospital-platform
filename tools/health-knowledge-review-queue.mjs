import { resolve } from "node:path";
import { auditLegacyHealthKnowledgeSourceFile } from "./health-knowledge-source-audit.mjs";
import { HEALTH_KNOWLEDGE_REVIEW_GATE_IDS } from "./health-knowledge-review-gates.mjs";

/** 默认只读取被 .gitignore 排除的旧健康知识源快照。 */
export const DEFAULT_SOURCE_PATH =
	".local/health-knowledge/legacy-source-snapshot.json";

/**
 * 健康知识迁移必须先经过内容审核，再进入发布链。
 *
 * 这里把审核过程拆成固定门，而不是用一个布尔值表示“健康百科已迁移”。
 * 每个门只输出状态、数量和下一项输入，不输出疾病名称、药品正文或任何
 * 患者字段；这样新会话可以快速接手，也不会因为报告而扩大敏感数据暴露面。
 */
const REVIEW_GATE_IDS = HEALTH_KNOWLEDGE_REVIEW_GATE_IDS;

function qualityWarningCount(qualityWarnings) {
	return Object.values(qualityWarnings ?? {}).reduce(
		(total, value) => (typeof value === "number" ? total + value : total),
		0,
	);
}

function createGate(id, label, status, reason, nextInput, details = {}) {
	return { id, label, status, reason, nextInput, ...details };
}

/**
 * 根据源快照审计结果生成不含正文的人工审核队列。
 *
 * `ready` 只表示当前门已有足够的工程输入；`blocked` 表示必须先处理，
 * `pending-input` 表示需要责任人或运维提供材料。无论所有工程门是否 ready，
 * 返回值的 `publishable` 都固定为 false，避免审核队列被误当成发布授权。
 */
export function buildHealthKnowledgeReviewQueue(
	sourceAudit,
	{ reviewedBundlePresent = false } = {},
) {
	if (sourceAudit?.sourceValid !== true) {
		throw new Error(
			"health source audit must pass before building review queue",
		);
	}

	const warningCount = qualityWarningCount(sourceAudit.qualityWarnings);
	const sourceQualityStatus = warningCount === 0 ? "ready" : "blocked";
	const sourcePublicationState = sourceAudit.source?.publicationState ?? null;
	const clinicalReviewStatus =
		sourcePublicationState === "approved" ? "ready" : "blocked";
	const bundleMetadataStatus = reviewedBundlePresent
		? "pending-validation"
		: "pending-input";

	const gates = [
		createGate(
			REVIEW_GATE_IDS.sourceQuality,
			"源快照质量",
			sourceQualityStatus,
			warningCount === 0
				? "当前没有聚合质量告警"
				: "源快照仍有需要人工确认的质量告警",
			"处理重复关系、控制字符、清理字段和未定义来源后重新执行源审计",
			{ warningCount },
		),
		createGate(
			REVIEW_GATE_IDS.clinicalReview,
			"临床内容审核",
			clinicalReviewStatus,
			sourcePublicationState === "approved"
				? "源快照已标记为审核通过"
				: "旧源快照明确保持 not-approved，不能由工具推断医学内容正确",
			"由内容责任人提供独立的脱敏审核 bundle 和审核责任信息",
			{ sourcePublicationState },
		),
		createGate(
			REVIEW_GATE_IDS.bundleMetadata,
			"版本与发布元数据",
			bundleMetadataStatus,
			reviewedBundlePresent
				? "审核 bundle 已出现，但尚未通过 domain bundle validator"
				: "尚未收到正式审核 bundle",
			"补齐 contentVersion、reviewedAt、reviewerRef、生效窗口和固定免责声明",
			{ reviewedBundlePresent },
		),
		createGate(
			REVIEW_GATE_IDS.stagingImport,
			"staging 事务导入",
			"pending-input",
			"没有经过 bundle 校验和内容责任人确认，不允许连接 staging 数据库",
			"先执行只读 bundle 校验，再使用 DEPLOY_ENV=staging 和显式确认导入",
		),
		createGate(
			REVIEW_GATE_IDS.publicationDrill,
			"发布与撤回演练",
			"pending-input",
			"尚未验证同版本读取、重叠生效窗口、撤回和患者端 fail-closed 行为",
			"在 staging 完成发布、撤回、重复导入和查询一致性演练",
		),
		createGate(
			REVIEW_GATE_IDS.deviceAcceptance,
			"真机只读验收",
			"pending-input",
			"页面、客户端 requestId、服务端日志和内容版本尚未形成同链证据",
			"发布配套运行包后采集目录、搜索、详情和无内容空态的真机证据",
		),
	];

	const unresolvedGateCount = gates.filter(
		(gate) => gate.status !== "ready",
	).length;

	return {
		schemaVersion: 1,
		publishable: false,
		sourceValid: sourceAudit.sourceValid,
		source: sourceAudit.source,
		counts: sourceAudit.counts,
		qualityWarnings: sourceAudit.qualityWarnings,
		gates,
		unresolvedGateCount,
		passed: false,
		nextAction:
			sourceQualityStatus === "blocked"
				? "先处理源快照质量告警，再交给内容责任人生成独立审核 bundle"
				: "等待内容责任人提供独立审核 bundle；未收到前保持健康百科 fail-closed",
	};
}

function parseArguments(argv) {
	const options = { filePath: DEFAULT_SOURCE_PATH, strict: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--strict") {
			options.strict = true;
			continue;
		}
		if (argument === "--bundle" || argument === "--file") {
			const next = argv[index + 1];
			if (!next || next.startsWith("--")) {
				throw new Error(`${argument} requires a path`);
			}
			if (argument === "--bundle") options.reviewedBundlePath = next;
			else options.filePath = next;
			index += 1;
			continue;
		}
		throw new Error(`unknown argument: ${argument}`);
	}
	return options;
}

if (import.meta.main) {
	try {
		const options = parseArguments(process.argv.slice(2));
		const sourceAudit = await auditLegacyHealthKnowledgeSourceFile(
			process.cwd(),
			options.filePath,
			{ strict: options.strict },
		);
		const reviewedBundlePresent = options.reviewedBundlePath
			? await Bun.file(
					resolve(process.cwd(), options.reviewedBundlePath),
				).exists()
			: false;
		const report = buildHealthKnowledgeReviewQueue(sourceAudit, {
			reviewedBundlePresent,
		});
		console.log(JSON.stringify(report, null, 2));
		if (options.strict && !sourceAudit.strictPassed) process.exitCode = 1;
	} catch (error) {
		console.error(
			error instanceof Error
				? error.message
				: "health knowledge review queue failed",
		);
		process.exitCode = 1;
	}
}
