import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_STATUS_CATALOG } from "../apps/miniprogram/src/services/feature-navigation.ts";
import { LEGACY_PAGE_MIGRATION_CATALOG } from "../apps/miniprogram/src/services/legacy-page-catalog.ts";
import { buildClinicalContractAudit } from "./clinical-contract-audit.mjs";
import { buildHealthKnowledgeReviewQueue } from "./health-knowledge-review-queue.mjs";
import { auditLegacyHealthKnowledgeSourceFile } from "./health-knowledge-source-audit.mjs";
import { auditMigrationBreadth } from "./migration-breadth-audit.mjs";
import { auditMigrationContractIntake } from "./migration-contract-intake-catalog.mjs";
import { auditReadOnlyDomains } from "./read-only-domain-audit.mjs";
import {
	FROZEN_DOMAIN_GATE_CATALOG,
	MIGRATION_BATCH_IDS,
} from "./migration-boundary-catalog.mjs";
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

/**
 * 按旧端业务域汇总迁移面，而不是只看全局总数。
 *
 * 全局的 64/64 很容易让人误以为所有业务都已经完成；按域拆开后，
 * 可以同时看到哪些页面只是安全子集、哪些页面仍被 contract 阻断，
 * 后续会话就不会围绕一个页面反复加固而漏掉其它业务域。
 */
function legacyDomainCoverage() {
	const grouped = new Map();
	for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
		const current = grouped.get(entry.domain) ?? {
			domain: entry.domain,
			pageCount: 0,
			statusCounts: {},
			blockedPageCount: 0,
			featureKeys: new Set(),
			nativeTargets: new Set(),
		};
		current.pageCount += 1;
		current.statusCounts[entry.status] =
			(current.statusCounts[entry.status] ?? 0) + 1;
		if (entry.status.startsWith("blocked-")) current.blockedPageCount += 1;
		if (entry.featureKey) current.featureKeys.add(entry.featureKey);
		if (entry.nativeTarget) current.nativeTargets.add(entry.nativeTarget);
		grouped.set(entry.domain, current);
	}

	return [...grouped.values()]
		.sort((left, right) => left.domain.localeCompare(right.domain, "zh-CN"))
		.map((domain) => ({
			domain: domain.domain,
			pageCount: domain.pageCount,
			statusCounts: domain.statusCounts,
			blockedPageCount: domain.blockedPageCount,
			featureKeys: [...domain.featureKeys].sort(),
			nativeTargets: [...domain.nativeTargets].sort(),
			stage: domain.blockedPageCount > 0 ? "并行补齐 contract" : "进入验收",
		}));
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
		domainCoverage: legacyDomainCoverage(),
		blockedPageCount: blockedEntries.length,
		featureStatusKeyCount: knownFeatureKeys.size,
		invalidBlockedEntries,
		passed: invalidBlockedEntries.length === 0,
	};
}

/**
 * 汇总所有阻断入口的准入目录，包括首页/“我的” action 和二级页面中
 * 直接进入状态页的调用。入口台账只说明页面去了哪里；这里进一步检查
 * 冻结入口的 FeatureKey、状态页落点、旧页面映射和 action-only 映射是否
 * 仍然一致，并把 contract 家族和材料数量放进 readiness。
 * 这样总报告不会只显示“有状态页”，却漏掉某个可见或二级 action 没有
 * 业务准入边界。
 */
function frozenBoundaryCoverage(migrationBreadth) {
	const legacyByPath = new Map(
		LEGACY_PAGE_MIGRATION_CATALOG.map((entry) => [entry.legacyPath, entry]),
	);
	const failures = [];
	const contractFamilyCounts = {};
	const batchCoverage = new Map(
		MIGRATION_BATCH_IDS.map((batchId) => [
			batchId,
			{
				batchId,
				gateCount: 0,
				legacyEntryCount: 0,
				legacyActionCount: 0,
				featureKeys: [],
			},
		]),
	);
	let legacyEntryCount = 0;
	let legacyActionCount = 0;
	const actionFeatureKeys = new Set(
		migrationBreadth.pages.flatMap((page) => page.featureKeys),
	);
	const gateFeatureKeys = new Set(
		FROZEN_DOMAIN_GATE_CATALOG.map((gate) => gate.featureKey),
	);
	const uncoveredActionFeatureKeys = [...actionFeatureKeys].filter(
		(featureKey) => !gateFeatureKeys.has(featureKey),
	);
	const actionPages = new Map(
		migrationBreadth.pages.map((page) => [page.id, page]),
	);
	const featureStatusActions = new Set(
		migrationBreadth.featureStatusActions ?? [],
	);
	const featureStatusFeatureKeys = new Set(
		[...featureStatusActions].map((reference) =>
			reference.slice(reference.indexOf(":") + 1),
		),
	);
	const uncoveredFeatureStatusKeys = [...featureStatusFeatureKeys].filter(
		(featureKey) => !gateFeatureKeys.has(featureKey),
	);

	for (const featureKey of uncoveredActionFeatureKeys) {
		failures.push(`可见 action FeatureKey 缺少冻结域准入门禁：${featureKey}`);
	}
	for (const featureKey of uncoveredFeatureStatusKeys) {
		failures.push(`状态页调用 FeatureKey 缺少冻结域准入门禁：${featureKey}`);
	}

	for (const gate of FROZEN_DOMAIN_GATE_CATALOG) {
		const batch = batchCoverage.get(gate.migrationBatch);
		if (!batch) {
			failures.push(`${gate.id}: 迁移批次未登记：${gate.migrationBatch}`);
		} else {
			batch.gateCount += 1;
			batch.featureKeys.push(gate.featureKey);
		}
		contractFamilyCounts[gate.contractFamily] =
			(contractFamilyCounts[gate.contractFamily] ?? 0) + 1;
		for (const legacyPath of gate.legacyPaths) {
			legacyEntryCount += 1;
			if (batch) batch.legacyEntryCount += 1;
			const entry = legacyByPath.get(legacyPath);
			if (!entry) {
				failures.push(`${gate.id}: 旧页面未登记：${legacyPath}`);
				continue;
			}
			if (entry.nativeTarget !== "pages/feature-status/feature-status") {
				failures.push(`${gate.id}: 旧页面越过统一状态页：${legacyPath}`);
			}
			if (entry.featureKey !== gate.featureKey) {
				failures.push(`${gate.id}: FeatureKey 不一致：${legacyPath}`);
			}
			if (!entry.status.startsWith("blocked-")) {
				failures.push(`${gate.id}: 旧页面不是 blocked 状态：${legacyPath}`);
			}
		}
		for (const actionReference of gate.legacyActions ?? []) {
			legacyActionCount += 1;
			if (batch) batch.legacyActionCount += 1;
			if (typeof actionReference !== "string") {
				failures.push(`${gate.id}: action-only 入口必须是字符串`);
				continue;
			}
			if (featureStatusActions.has(actionReference)) {
				const calledFeatureKey = actionReference.slice(
					actionReference.indexOf(":") + 1,
				);
				if (calledFeatureKey !== gate.featureKey) {
					failures.push(
						`${gate.id}: 状态页调用未指向 FeatureKey：${actionReference}`,
					);
				}
				continue;
			}
			const [pageId, action, ...extraParts] = actionReference.split(":");
			const page = actionPages.get(pageId);
			if (!pageId || !action || extraParts.length > 0 || !page) {
				failures.push(`${gate.id}: action-only 入口无效：${actionReference}`);
				continue;
			}
			if (!page.actions.includes(action)) {
				failures.push(`${gate.id}: action-only 入口不存在：${actionReference}`);
			}
			if (!page.featureKeys.includes(gate.featureKey)) {
				failures.push(
					`${gate.id}: action-only 入口未指向 FeatureKey：${actionReference}`,
				);
			}
		}
		if (!Object.hasOwn(FEATURE_STATUS_CATALOG, gate.featureKey)) {
			failures.push(`${gate.id}: FeatureKey 不存在：${gate.featureKey}`);
		}
	}

	return {
		domainCount: FROZEN_DOMAIN_GATE_CATALOG.length,
		legacyEntryCount,
		legacyActionCount,
		coveredEntryCount: legacyEntryCount + legacyActionCount,
		batchCoverage: [...batchCoverage.values()].map((batch) => ({
			...batch,
			featureKeys: [...new Set(batch.featureKeys)].sort(),
		})),
		actionFeatureKeyCount: actionFeatureKeys.size,
		uncoveredActionFeatureKeys,
		featureStatusCallCount: featureStatusActions.size,
		featureStatusFeatureKeyCount: featureStatusFeatureKeys.size,
		uncoveredFeatureStatusKeys,
		contractFamilyCounts,
		requiredMaterialCount: FROZEN_DOMAIN_GATE_CATALOG.reduce(
			(total, gate) =>
				total + gate.commonMaterials.length + gate.requiredMaterials.length,
			0,
		),
		failures,
		passed: failures.length === 0,
	};
}

async function readOnlyCoverage(root) {
	const domains = [];
	const semanticAudit = await auditReadOnlyDomains();
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
			operationClass: domain.operationClass,
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
		// readiness 必须复用 readonly:audit 的业务语义结果；否则单独审计
		// 已经阻止“错误伪装为空”，总报告却可能仍把结构标成通过。
		semanticStateCount: semanticAudit.semanticStateCount,
		semanticFailures: semanticAudit.failures,
		passed:
			domains.every((domain) => domain.passed) &&
			semanticAudit.failures.length === 0,
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
	const sourceSnapshotPath =
		".local/health-knowledge/legacy-source-snapshot.json";
	const absolutePath = resolve(root, reviewedBundlePath);
	const sourceSnapshotFile = Bun.file(resolve(root, sourceSnapshotPath));
	const file = Bun.file(absolutePath);
	const present = await file.exists();
	const sourceSnapshotPresent = await sourceSnapshotFile.exists();
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

	/**
	 * 源快照只用于审核盘点，不能因为它存在就进入患者端发布链。
	 * 审核失败时只输出稳定的 `invalid-source`，不把底层解析错误或正文带入
	 * readiness 报告；没有快照的 CI/新环境则明确标记为 `missing`。
	 */
	let sourceSnapshotAudit = null;
	let reviewQueue = null;
	let sourceSnapshotStatus = sourceSnapshotPresent
		? "pending-audit"
		: "missing";
	if (sourceSnapshotPresent) {
		try {
			sourceSnapshotAudit = await auditLegacyHealthKnowledgeSourceFile(
				root,
				sourceSnapshotPath,
			);
			reviewQueue = buildHealthKnowledgeReviewQueue(sourceSnapshotAudit);
			sourceSnapshotStatus = "audited";
		} catch {
			sourceSnapshotStatus = "invalid-source";
		}
	}

	return {
		routeRegistered: true,
		codeReady: true,
		sourceSnapshotPath,
		sourceSnapshotPresent,
		sourceSnapshotStatus,
		sourceSnapshotAudit,
		reviewQueue,
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
	// 真机证据必须与 pending 运行包一一对应。固定读取上一候选的清单会把
	// 新页面、旧二维码和旧 requestId 混成一条“当前证据”，因此这里按完整
	// 来源指纹的短前缀选择清单；没有匹配文件时宁可报告 evidence 缺失。
	const pendingSourceRevision = pendingRuntime?.sourceRevision ?? null;
	const evidenceFileName = pendingSourceRevision
		? `device-evidence-${pendingSourceRevision.slice(0, 7)}-pending.json`
		: "device-evidence-missing-pending.json";
	const evidencePath = `docs/release/${evidenceFileName}`;
	const evidence = await readJsonIfExists(resolve(root, evidencePath));
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
	const evidenceSourceRevision =
		evidence?.candidate && typeof evidence.candidate.sourceRevision === "string"
			? evidence.candidate.sourceRevision
			: null;
	return {
		manifestPath: evidencePath,
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
	frozenBoundary,
	contractIntake,
}) {
	const statusCounts = legacy.statusCounts;
	const runtimeReady = runtime.candidateRuntimeAligned;
	const batchCoverage = new Map(
		(frozenBoundary.batchCoverage ?? []).map((batch) => [batch.batchId, batch]),
	);
	const gateCoverageFor = (batchId) => {
		const coverage = batchCoverage.get(batchId);
		return {
			frozenGateCount: coverage?.gateCount ?? 0,
			frozenLegacyEntryCount: coverage?.legacyEntryCount ?? 0,
			frozenLegacyActionCount: coverage?.legacyActionCount ?? 0,
			frozenFeatureKeys: coverage?.featureKeys ?? [],
		};
	};
	const contractCoverageFor = (batchId) => {
		const lane = contractIntake.lanes.find((item) => item.batchId === batchId);
		return {
			contractIntakeStatus: lane?.status ?? null,
			contractBusinessReady: lane?.businessReady ?? false,
			contractRequiredEvidenceCount: lane?.requiredEvidence.length ?? 0,
			contractImplementationStepCount: lane?.implementationSequence.length ?? 0,
			contractNextInput: lane?.nextInput ?? null,
		};
	};
	return [
		{
			id: "A-readonly-evidence",
			name: "安全只读真实取证",
			...gateCoverageFor("A-readonly-evidence"),
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
			...gateCoverageFor("B-health-content"),
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
			...gateCoverageFor("C-clinical-readonly-contracts"),
			...contractCoverageFor("C-clinical-readonly-contracts"),
			stage: clinicalContract.passed
				? "awaiting-provider-confirmation"
				: "contract-audit-failed",
			scope: clinicalContract.domains.map((domain) => domain.id),
			codeReady: false,
			nextAction:
				"分别收集请求、响应、空、拒绝、超时、owner 映射和字段白名单材料",
			stopCondition:
				"未确认 Provider contract 前，不注册病历、住院、医生关系或电子导诊通用 API",
		},
		{
			id: "D-patient-and-convenience-write",
			name: "患者与便民写入",
			...gateCoverageFor("D-patient-and-convenience-write"),
			...contractCoverageFor("D-patient-and-convenience-write"),
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
			...gateCoverageFor("E-external-entry"),
			...contractCoverageFor("E-external-entry"),
			stage: "awaiting-external-contract",
			scope: [
				"guide",
				"companion",
				"smart-customer",
				"consultation",
				"patient-subscription",
				"report-cloud-image",
				"report-share",
				"report-follow-up",
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
			...gateCoverageFor("F-payment-and-writeback"),
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
	// 入口广度只执行一次，既供 readiness 展示，也供冻结域检查 action-only
	// 能力，防止两个报告各自读取源码后产生不一致的覆盖数字。
	const migrationBreadth = await auditMigrationBreadth(root);
	const frozenBoundary = frozenBoundaryCoverage(migrationBreadth);
	const readOnly = await readOnlyCoverage(root);
	const providerIntake = await providerIntakeCoverage(root);
	const runtime = await runtimeProvenance(root);
	const deviceEvidence = await deviceEvidenceCoverage(root, runtime.pending);
	const healthContent = await healthContentCoverage(root);
	const clinicalContract = await buildClinicalContractAudit(root);
	const contractIntake = auditMigrationContractIntake();
	// 入口广度必须进入总结构门禁：只登记了 action 而没有真实分发分支，
	// 会把“能看见入口”误报成“已经接入业务”，因此这里统一 fail-closed。
	const nativePageCount = Array.isArray(appConfig.pages)
		? appConfig.pages.length
		: 0;
	const featureStatusRegistered =
		Array.isArray(appConfig.pages) &&
		appConfig.pages.includes("pages/feature-status/feature-status");
	const structuralAuditPassed =
		legacy.passed &&
		frozenBoundary.passed &&
		readOnly.passed &&
		providerIntake.passed &&
		clinicalContract.passed &&
		contractIntake.passed &&
		migrationBreadth.passed &&
		featureStatusRegistered;
	const migrationQueue = breadthMigrationQueue({
		legacy,
		readOnly,
		clinicalContract,
		healthContent,
		runtime,
		deviceEvidence,
		frozenBoundary,
		contractIntake,
	});

	return {
		schemaVersion: 1,
		generatedAt,
		entryCoverage: {
			legacy,
			frozenBoundary,
			nativePageCount,
			featureStatusRegistered,
			passed: legacy.passed && frozenBoundary.passed && featureStatusRegistered,
		},
		readOnly,
		providerIntake,
		clinicalContract,
		contractIntake,
		migrationBreadth,
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
