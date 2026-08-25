import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_STATUS_CATALOG } from "../apps/miniprogram/src/services/feature-navigation.ts";
import { LEGACY_PAGE_MIGRATION_CATALOG } from "../apps/miniprogram/src/services/legacy-page-catalog.ts";
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
	const nativePageCount = Array.isArray(appConfig.pages)
		? appConfig.pages.length
		: 0;
	const featureStatusRegistered =
		Array.isArray(appConfig.pages) &&
		appConfig.pages.includes("pages/feature-status/feature-status");
	const structuralAuditPassed =
		legacy.passed && readOnly.passed && featureStatusRegistered;

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
		runtime,
		businessCompletion: {
			completedClaimableDomainCount: 0,
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
