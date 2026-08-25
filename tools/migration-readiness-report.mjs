import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_STATUS_CATALOG } from "../apps/miniprogram/src/services/feature-navigation.ts";
import { LEGACY_PAGE_MIGRATION_CATALOG } from "../apps/miniprogram/src/services/legacy-page-catalog.ts";
import { buildClinicalContractAudit } from "./clinical-contract-audit.mjs";
import { READ_ONLY_DOMAIN_CATALOG } from "./read-only-domain-catalog.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

/** 读取 JSON 文件；缺失的运行包元数据必须进入报告，而不是被默认为当前候选。 */
async function readJsonIfExists(filePath) {
	const file = Bun.file(filePath);
	if (!(await file.exists())) return null;
	try {
		return await file.json();
	} catch {
		return { invalid: true };
	}
}

/** 判断仓库内文件是否真实存在，避免只根据文档文字生成“已闭环”结论。 */
async function missingFiles(relativePaths, root) {
	const missing = [];
	for (const relativePath of relativePaths) {
		if (!(await Bun.file(resolve(root, relativePath)).exists())) {
			missing.push(relativePath);
		}
	}
	return missing;
}

function countByStatus(entries) {
	return entries.reduce((counts, entry) => {
		counts[entry.status] = (counts[entry.status] ?? 0) + 1;
		return counts;
	}, {});
}

function legacyCoverage() {
	const blockedEntries = LEGACY_PAGE_MIGRATION_CATALOG.filter((entry) =>
		entry.status.startsWith("blocked-"),
	);
	const knownFeatureKeys = new Set(Object.keys(FEATURE_STATUS_CATALOG));
	const invalidBlockedEntries = blockedEntries
		.filter(
			(entry) => !entry.featureKey || !knownFeatureKeys.has(entry.featureKey),
		)
		.map((entry) => entry.legacyPath);

	return {
		legacyPageCount: LEGACY_PAGE_MIGRATION_CATALOG.length,
		statusCounts: countByStatus(LEGACY_PAGE_MIGRATION_CATALOG),
		blockedPageCount: blockedEntries.length,
		featureStatusKeyCount: knownFeatureKeys.size,
		invalidBlockedEntries,
		passed: invalidBlockedEntries.length === 0,
	};
}

async function readOnlyCoverage(root) {
	const domains = [];
	for (const domain of READ_ONLY_DOMAIN_CATALOG) {
		const pageFiles = domain.pages.flatMap((page) =>
			["ts", "json", "wxml", "wxss"].map(
				(extension) => `apps/miniprogram/src/${page}.${extension}`,
			),
		);
		const requiredFiles = [
			...pageFiles,
			domain.apiModule,
			...domain.serviceFiles,
			...domain.domainFiles,
			...domain.adapterFiles,
			...domain.documentation,
		];
		const missing = await missingFiles(requiredFiles, root);
		const loggingSource = await Bun.file(
			resolve(root, "docs/logging.md"),
		).text();
		const missingLogEvents = domain.logEvents.filter(
			(event) => !loggingSource.includes(`\`${event}\``),
		);
		domains.push({
			id: domain.id,
			name: domain.name,
			pages: domain.pages,
			publicRoutes: domain.publicRoutes,
			boundary: domain.boundary,
			missingFiles: missing,
			missingLogEvents,
			passed: missing.length === 0 && missingLogEvents.length === 0,
		});
	}
	return {
		domainCount: domains.length,
		passed: domains.every((domain) => domain.passed),
		domains,
	};
}

/**
 * 汇总 Provider contract 的接收状态。
 *
 * `normalized` 只代表材料已经登记、脱敏和结构化，不能等价于接口已经
 * 确认，更不能直接打开挂号写入、支付或医保流程。这里把状态显式放入
 * readiness 报告，避免后续会话只看到“有文档”就误判为“业务可用”。
 */
async function providerIntakeCoverage(root) {
	const intakeDirectory = resolve(root, "docs/provider-intake");
	const glob = new Bun.Glob("*.md");
	const documentFiles = [];
	for await (const file of glob.scan({
		cwd: intakeDirectory,
		onlyFiles: true,
	})) {
		documentFiles.push(file);
	}

	const statusCounts = {};
	let documentIdCount = 0;
	for (const fileName of documentFiles.sort()) {
		const content = await Bun.file(resolve(intakeDirectory, fileName)).text();
		const status = content.match(/^> 当前状态：`([^`]+)`/mu)?.[1] ?? "unknown";
		statusCounts[status] = (statusCounts[status] ?? 0) + 1;
		// 与 provider-intake-audit.mjs 保持同一口径：只有同时带完整
		// SHA-256 指纹的来源表格行才算 documentId，避免把接口字段表误算进去。
		documentIdCount += content.split("\n").filter((line) => {
			return (
				/^\|\s*`([^`]+)`\s*\|/u.test(line) && /`[a-f0-9]{64}`/iu.test(line)
			);
		}).length;
	}

	const confirmedDocumentCount = statusCounts.confirmed ?? 0;
	return {
		documentCount: documentFiles.length,
		documentIdCount,
		statusCounts,
		confirmedDocumentCount,
		passed: documentFiles.length > 0 && documentIdCount > 0,
		businessReady: false,
		reason:
			confirmedDocumentCount === 0
				? "当前材料均为 normalized，Provider contract 尚未确认"
				: "Provider contract 仍需公网、真机、幂等和回滚证据，不能仅凭文档放开高风险业务",
	};
}

async function runtimeProvenance(root) {
	const live = await readJsonIfExists(
		resolve(root, "apps/miniprogram/dist/build-info.json"),
	);
	const pending = await readJsonIfExists(
		resolve(root, ".local/hospital-miniprogram/pending/build-info.json"),
	);
	const liveRevision =
		live && typeof live.sourceRevision === "string"
			? live.sourceRevision
			: null;
	const pendingRevision =
		pending && typeof pending.sourceRevision === "string"
			? pending.sourceRevision
			: null;
	return {
		live: liveRevision
			? { sourceRevision: liveRevision, pageCount: live.pageCount ?? null }
			: null,
		pending: pendingRevision
			? {
					sourceRevision: pendingRevision,
					pageCount: pending.pageCount ?? null,
				}
			: null,
		candidateRuntimeAligned: Boolean(
			liveRevision && pendingRevision && liveRevision === pendingRevision,
		),
		publicationRequired: Boolean(
			pendingRevision && liveRevision !== pendingRevision,
		),
	};
}

/**
 * 汇总健康内容的发布前事实。
 *
 * 健康百科的路由已经存在，但“路由存在”与“审核内容可读”是两件事。
 * 只检查约定的本机审核 bundle 是否到位，不读取或输出正文；即使 bundle
 * 到位，仍需 staging 导入、发布/撤回演练和真机证据才能进入业务完成态。
 */
async function healthContentCoverage(root) {
	const reviewedBundlePath = ".local/health-knowledge/reviewed-bundle.json";
	const absolutePath = resolve(root, reviewedBundlePath);
	const file = Bun.file(absolutePath);
	const present = await file.exists();
	const bundle = present ? await readJsonIfExists(absolutePath) : null;
	const jsonValid = present && bundle !== null && bundle.invalid !== true;
	const publication =
		jsonValid && bundle.publication && typeof bundle.publication === "object"
			? bundle.publication
			: null;
	const publicationStatus =
		publication && typeof publication.status === "string"
			? publication.status
			: null;

	return {
		routeRegistered: true,
		codeReady: true,
		reviewedBundlePath,
		reviewedBundlePresent: present,
		reviewedBundleJsonValid: jsonValid,
		publicationStatus,
		businessReady: false,
		reason: present
			? "审核 bundle 已进入本机证据目录，但仍需 bundle 校验、staging 导入、发布/撤回演练和真机证据"
			: "当前未发现正式审核 bundle；健康知识路由保持 fail-closed",
	};
}

/**
 * 汇总当前候选的真机三层证据清单。
 *
 * 清单中的 `pending` 只表示验收尚未开始或尚未留下证据，不能被当成失败；
 * 但在所有域仍为 pending 时，也绝不能把代码测试或 HTTP smoke 升级成真实
 * 业务完成。这里仅汇总状态和候选指纹，不写入页面截图、患者标识或请求正文。
 */
async function deviceEvidenceCoverage(root, pendingRuntime) {
	const evidence = await readJsonIfExists(
		resolve(root, "docs/release/device-evidence-296516a5-pending.json"),
	);
	const domains =
		evidence &&
		typeof evidence.domains === "object" &&
		evidence.domains !== null
			? Object.entries(evidence.domains)
			: [];
	const resultCounts = {};
	for (const [, value] of domains) {
		const result =
			value && typeof value.result === "string" ? value.result : "unknown";
		resultCounts[result] = (resultCounts[result] ?? 0) + 1;
	}
	const pendingSourceRevision = pendingRuntime?.sourceRevision ?? null;
	const evidenceSourceRevision =
		evidence?.candidate && typeof evidence.candidate.sourceRevision === "string"
			? evidence.candidate.sourceRevision
			: null;
	return {
		present: domains.length > 0,
		domainCount: domains.length,
		resultCounts,
		allPending:
			domains.length > 0 &&
			domains.every(([, value]) => value?.result === "pending"),
		passed:
			domains.length > 0 &&
			domains.every(([, value]) => value?.result === "passed"),
		candidate: evidence?.candidate ?? null,
		candidateMatchesPendingRuntime: Boolean(
			pendingSourceRevision &&
				evidenceSourceRevision &&
				pendingSourceRevision === evidenceSourceRevision,
		),
	};
}

/**
 * 把全量迁移拆成可以并行推进的业务批次。
 *
 * 这部分不是“把状态页改成完成”的快捷路径，而是给后续会话一个机器可读
 * 的执行队列：每个批次都明确当前停在哪个证据或 contract 门槛，以及在门槛
 * 未满足时什么事情不能做。这样 readiness 既能回答“覆盖到哪里”，也能回答
 * “下一步做什么”，避免继续围绕某一个页面重复加固。
 */
function breadthMigrationQueue({
	legacy,
	readOnly,
	clinicalContract,
	runtime,
	deviceEvidence,
	healthContent,
}) {
	const statusCounts = legacy.statusCounts;
	const runtimeReady = runtime.candidateRuntimeAligned;
	return [
		{
			id: "A-readonly-evidence",
			name: "安全只读真实取证",
			stage: deviceEvidence.passed ? "evidence-passed" : "awaiting-evidence",
			scope: readOnly.domains.map((domain) => domain.id),
			codeReady: readOnly.passed,
			nextAction: runtimeReady
				? "按九个真机域采集页面、客户端 requestId 和服务端同链日志"
				: "先释放 dist 锁并原子发布 pending 候选，再开始九个真机域取证",
			stopCondition:
				"没有候选来源一致性、页面截图、客户端 requestId 和服务端同链事件时，不得宣称只读业务完成",
		},
		{
			id: "B-health-content",
			name: "健康内容发布",
			stage: healthContent.reviewedBundlePresent
				? "awaiting-staging-and-device-evidence"
				: "awaiting-reviewed-bundle",
			scope: [
				"health-encyclopedia",
				"health-knowledge-search",
				"health-knowledge-detail",
			],
			codeReady: healthContent.codeReady,
			businessReady: healthContent.businessReady,
			reviewedBundlePresent: healthContent.reviewedBundlePresent,
			nextAction: healthContent.reviewedBundlePresent
				? "先运行 bundle check，再完成 staging 导入、发布/撤回演练和真机证据"
				: "取得脱敏审核 bundle，放入约定证据目录后完成 bundle check 和 staging 导入",
			stopCondition:
				"没有内容责任人、审核元数据和撤回证据时，不开放疾病/药品内容，也不新增自测或临床结论",
		},
		{
			id: "C-clinical-readonly-contracts",
			name: "临床只读契约",
			stage: clinicalContract.passed
				? "awaiting-provider-confirmation"
				: "contract-audit-failed",
			scope: clinicalContract.domains.map((domain) => domain.id),
			codeReady: false,
			nextAction:
				"分别收集请求、响应、空、拒绝、超时、owner 映射和字段白名单材料",
			stopCondition:
				"未确认 Provider contract 前，不注册病历、住院、医生关系或问诊通用 API",
		},
		{
			id: "D-patient-and-convenience-write",
			name: "患者与便民写入",
			stage: "awaiting-patient-contract",
			scope: [
				"patient-binding",
				"patient-agreement",
				"patient-address",
				"patient-signature",
			],
			blockedPageCount: statusCounts["blocked-patient-contract"] ?? 0,
			codeReady: false,
			nextAction: "冻结 owner、同意、幂等、撤回、文件安全和医护读取规则",
			stopCondition:
				"没有上述规则时，不新增建档、绑卡、地址、签名或问卷提交接口",
		},
		{
			id: "E-external-entry",
			name: "外部入口与实时能力",
			stage: "awaiting-external-contract",
			scope: [
				"smart-customer",
				"consultation",
				"patient-subscription",
				"cloud-image",
				"report-share",
			],
			blockedPageCount: statusCounts["blocked-external"] ?? 0,
			codeReady: false,
			nextAction: "确认 allowlist、短期会话、受众、退出、回跳和撤回协议",
			stopCondition:
				"没有外部主体和短期会话契约时，不恢复任意 WebView、长期 ticket 或本地订阅开关",
		},
		{
			id: "F-payment-and-writeback",
			name: "支付、医保与 HIS 回写",
			stage: "last-batch",
			scope: [
				"appointment-write",
				"outpatient-payment-detail",
				"insurance",
				"inpatient-payment",
				"cashier",
			],
			blockedPageCount: statusCounts["blocked-payment"] ?? 0,
			codeReady: false,
			nextAction:
				"最后冻结金额单位、订单状态机、查单/回调、幂等、补偿和真实环境验收",
			stopCondition:
				"支付和医保必须与只读费用列表隔离，未完成状态机前不创建订单、不调起支付、不改旧 FSI 转发",
		},
	];
}

/**
 * 生成全项目迁移 readiness 报告。
 *
 * `structuralAuditPassed` 只代表台账、状态页、只读域清单和仓库文件没有
 * 断链；它故意不把 pending/live 一致或 Provider/真机证据当作已完成。这样
 * 新会话可以一次看到“入口覆盖了什么”和“真实业务还缺什么”，不会用绿色
 * 的结构审计结果替代医疗业务验收。
 */
export async function buildMigrationReadinessReport(
	root = repositoryRoot,
	generatedAt = new Date().toISOString(),
) {
	const appConfig = await Bun.file(
		resolve(root, "apps/miniprogram/src/app.json"),
	).json();
	const legacy = legacyCoverage();
	const readOnly = await readOnlyCoverage(root);
	const providerIntake = await providerIntakeCoverage(root);
	const runtime = await runtimeProvenance(root);
	const deviceEvidence = await deviceEvidenceCoverage(root, runtime.pending);
	const healthContent = await healthContentCoverage(root);
	const clinicalContract = await buildClinicalContractAudit(root);
	const nativePageCount = Array.isArray(appConfig.pages)
		? appConfig.pages.length
		: 0;
	const featureStatusRegistered =
		Array.isArray(appConfig.pages) &&
		appConfig.pages.includes("pages/feature-status/feature-status");
	const structuralAuditPassed =
		legacy.passed &&
		readOnly.passed &&
		providerIntake.passed &&
		clinicalContract.passed &&
		featureStatusRegistered;
	const migrationQueue = breadthMigrationQueue({
		legacy,
		readOnly,
		clinicalContract,
		healthContent,
		runtime,
		deviceEvidence,
	});

	return {
		schemaVersion: 1,
		generatedAt,
		entryCoverage: {
			legacy,
			nativePageCount,
			featureStatusRegistered,
			passed: legacy.passed && featureStatusRegistered,
		},
		readOnly,
		providerIntake,
		clinicalContract,
		healthContent,
		runtime,
		deviceEvidence,
		migrationQueue,
		businessCompletion: {
			completedClaimableDomainCount: 0,
			codeReadyDomainCount: readOnly.domains.filter((domain) => domain.passed)
				.length,
			realEvidenceReadyDomainCount: deviceEvidence.passed
				? deviceEvidence.domainCount
				: 0,
			blockedPageCount: legacy.blockedPageCount,
			passed: false,
			reason:
				"结构清单通过不等于 Provider、生产、公网、真机和高风险写入业务已经验收",
		},
		structuralAuditPassed,
	};
}

if (import.meta.main) {
	const report = await buildMigrationReadinessReport();
	console.log(JSON.stringify(report, null, 2));
	const strict = process.argv.includes("--strict");
	if (
		!report.structuralAuditPassed ||
		(strict && !report.runtime.candidateRuntimeAligned)
	) {
		if (strict && !report.runtime.candidateRuntimeAligned) {
			console.error(
				"Migration readiness strict check failed: pending and live mini program runtimes are not aligned",
			);
		}
		process.exitCode = 1;
	}
}
