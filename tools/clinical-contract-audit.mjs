import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLINICAL_DOMAIN_CATALOG } from "./clinical-domain-catalog.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

/** 读取新仓库文件；该审计不访问旧项目、数据库、Redis 或 Provider。 */
async function readText(root, relativePath) {
	const file = Bun.file(resolve(root, relativePath));
	if (!(await file.exists())) return null;
	return file.text();
}

function findLegacyEntry(catalog, path) {
	return catalog.LEGACY_PAGE_MIGRATION_CATALOG.find(
		(entry) => entry.legacyPath === path,
	);
}

/**
 * 检查四个临床域当前是否仍停留在“材料已登记、业务未注册”状态。
 *
 * 这不是 Provider contract 解析器：正式材料到达后，域应进入独立的
 * contracts/adapter/domain/API 实现流程，并同步更新本目录和测试，而不是
 * 删除门禁或把旧页面声明直接当作新端契约。
 */
export async function buildClinicalContractAudit(root = repositoryRoot) {
	const catalog = await import(
		"../apps/miniprogram/src/services/legacy-page-catalog.ts"
	);
	const featureNavigation = await import(
		"../apps/miniprogram/src/services/feature-navigation.ts"
	);
	const intakeDocument = await readText(
		root,
		"docs/provider-intake/clinical-read-models-2026-08-25.md",
	);
	const failures = [];
	const domains = [];

	if (!intakeDocument) {
		failures.push("缺少临床 Provider 接收记录");
	} else {
		const status = intakeDocument.match(/^> 当前状态：`([^`]+)`/mu)?.[1];
		if (status !== "normalized") {
			failures.push(
				`临床 Provider 接收记录必须保持 normalized，当前为 ${JSON.stringify(status)}`,
			);
		}
		if (
			!/Provider contract 未确认|接口未注册|业务未开放/u.test(intakeDocument)
		) {
			failures.push("临床 Provider 接收记录缺少未确认/未注册边界");
		}
	}

	for (const domain of CLINICAL_DOMAIN_CATALOG) {
		const domainFailures = [];
		const documentContents = [];
		for (const document of domain.documents) {
			const content = await readText(root, document);
			if (!content) {
				domainFailures.push(`缺少文档：${document}`);
				continue;
			}
			documentContents.push(content);
		}
		// 准入事实通常拆在“来源接收记录、域合同草案、统一边界文档”
		// 三处。检查合并后的事实集，避免要求每一份文档重复全部规则，
		// 同时仍要求整个域的材料集合覆盖每个关键边界。
		const combinedDocuments = documentContents.join("\n");
		for (const marker of domain.requiredMarkers) {
			if (!combinedDocuments.includes(marker)) {
				domainFailures.push(`材料集合缺少边界标记：${marker}`);
			}
		}

		for (const expected of domain.legacyEntries) {
			const entry = findLegacyEntry(catalog, expected.path);
			if (!entry) {
				domainFailures.push(`未登记旧页面：${expected.path}`);
				continue;
			}
			if (entry.status !== expected.status) {
				domainFailures.push(
					`${expected.path} 状态漂移：期望 ${expected.status}，实际 ${entry.status}`,
				);
			}
			if (entry.nativeTarget !== "pages/feature-status/feature-status") {
				domainFailures.push(
					`${expected.path} 越过状态页进入了未确认业务页：${entry.nativeTarget}`,
				);
			}
			if (entry.featureKey !== expected.featureKey) {
				domainFailures.push(
					`${expected.path} FeatureKey 漂移：期望 ${expected.featureKey}，实际 ${entry.featureKey}`,
				);
			}
		}

		for (const featureKey of domain.legacyEntries.map(
			(entry) => entry.featureKey,
		)) {
			const feature = featureNavigation.FEATURE_STATUS_CATALOG[featureKey];
			if (!feature) {
				domainFailures.push(`缺少 FeatureKey：${featureKey}`);
			} else if (
				feature.readiness !==
				(domain.legacyEntries.find((entry) => entry.featureKey === featureKey)
					?.readiness ?? domain.expectedReadiness)
			) {
				const expectedReadiness =
					domain.legacyEntries.find((entry) => entry.featureKey === featureKey)
						?.readiness ?? domain.expectedReadiness;
				domainFailures.push(
					`${featureKey} readiness 漂移：期望 ${expectedReadiness}，实际 ${feature.readiness}`,
				);
			}
		}

		domains.push({
			id: domain.id,
			name: domain.name,
			status: "normalized / unregistered",
			forbiddenApiTokens: domain.forbiddenApiTokens,
			passed: domainFailures.length === 0,
			failures: domainFailures,
		});
		failures.push(
			...domainFailures.map((failure) => `${domain.name}：${failure}`),
		);
	}

	const forbiddenRuntimeEntries = [];
	const apiGlob = new Bun.Glob("apps/api/src/**/*.{ts,tsx,js,mjs}");
	for await (const file of apiGlob.scan({ cwd: root, onlyFiles: true })) {
		if (/(?:\.test|\.spec)\.(?:ts|tsx|js|mjs)$/u.test(file)) continue;
		const source = await Bun.file(resolve(root, file)).text();
		for (const domain of CLINICAL_DOMAIN_CATALOG) {
			for (const token of domain.forbiddenApiTokens) {
				if (source.includes(token)) {
					forbiddenRuntimeEntries.push({ file, token, domain: domain.id });
				}
			}
		}
	}
	if (forbiddenRuntimeEntries.length > 0) {
		failures.push(
			`API 运行时代码出现未注册临床路由标记：${forbiddenRuntimeEntries.map((item) => `${item.file}:${item.token}`).join("、")}`,
		);
	}

	return {
		schemaVersion: 1,
		domainCount: CLINICAL_DOMAIN_CATALOG.length,
		intakeStatus: intakeDocument ? "normalized" : "missing",
		domains,
		forbiddenRuntimeEntries,
		passed: failures.length === 0,
		failures,
	};
}

if (import.meta.main) {
	const report = await buildClinicalContractAudit();
	for (const domain of report.domains) {
		console.log(
			`[${domain.passed ? "PASS" : "FAIL"}] ${domain.name}：${domain.status}`,
		);
	}
	if (!report.passed) {
		console.error(
			`Clinical contract audit failed: ${report.failures.length} rule(s)`,
		);
		for (const failure of report.failures) console.error(`- ${failure}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Clinical contract audit passed: ${report.domainCount} domain(s) remain unregistered until formal Provider contract arrives`,
		);
	}
}
