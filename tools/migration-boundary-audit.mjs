import { fileURLToPath } from "node:url";
import {
	FROZEN_DOMAIN_GATE_CATALOG,
	MIGRATION_BATCH_IDS,
} from "./migration-boundary-catalog.mjs";
import { auditMigrationBreadth } from "./migration-breadth-audit.mjs";

/**
 * 广度迁移边界审计。
 *
 * 旧端页面必须先全部有明确落点，但临床、患者绑定、外部会话和支付入口
 * 不能为了增加“已迁移”数量而猜测 Provider 协议。这个工具把当前已经
 * 识别出的高风险页面逐一绑定到 feature-status、固定 FeatureKey 或明确的
 * `surface-only` 页面外壳，后续若有人新增路由或把占位页改成半成品，提交门禁会立即提醒。
 *
 * 本工具只读源代码和静态配置，不访问旧服务、数据库、Redis 或 Provider。
 */

const repositoryRoot = new URL("../", import.meta.url);
const readSource = (relativePath) =>
	Bun.file(new URL(relativePath, repositoryRoot)).text();

const appConfig = JSON.parse(await readSource("apps/miniprogram/src/app.json"));
const catalog = await import(
	"../apps/miniprogram/src/services/legacy-page-catalog.ts"
);
const featureNavigation = await import(
	"../apps/miniprogram/src/services/feature-navigation.ts"
);

/**
 * 这些入口虽然已经纳入导航，但真实 contract 尚未冻结。
 * 同一业务域中的多个入口可以共享状态页，但不能共享旧端内部标识或响应。
 */
const FROZEN_DOMAIN_GATES = FROZEN_DOMAIN_GATE_CATALOG;

const expectedStatusPage = "pages/feature-status/feature-status";
const failures = [];
const gateFailureCounts = new Map();
const seenGateIds = new Set();
const allowedContractFamilies = new Set([
	"provider-read-only",
	"payment-write",
	"external-session",
	"patient-write",
	"clinical-content-write",
	"external-content",
]);
const requiredSemanticStates = new Set([
	"requesting",
	"success-non-empty",
	"success-empty",
	"unauthorized",
	"invalid-input",
	"temporary-failure",
	"contract-invalid",
]);
const requiredCommonMaterials = new Set([
	"request",
	"response",
	"success-empty",
	"rejected",
	"timeout",
	"owner-mapping",
	"field-allowlist",
	"redaction",
	"logging",
	"rollback",
]);
const legacyStatusByReadiness = new Map([
	["待 provider contract", "blocked-provider"],
	["待临床审核", "blocked-clinical"],
	["全量替换进行中", "partial"],
	["待患者绑定 contract", "blocked-patient-contract"],
	["待外部入口 contract", "blocked-external"],
]);

// 首页/“我的”中的 action-only 能力不一定对应旧端 Vue 页面，但同样会
// 触发状态页。先读取入口广度审计结果，再检查它们是否拥有独立 gate，
// 避免“页面有提示、准入目录却没有业务边界”的漏网情况。
const migrationBreadth = await auditMigrationBreadth();
const actionPages = new Map(
	migrationBreadth.pages.map((page) => [page.id, page]),
);
const actionFeatureKeys = new Set(
	migrationBreadth.pages.flatMap((page) => page.featureKeys),
);
const featureStatusActions = new Set(migrationBreadth.featureStatusActions);

function fail(message) {
	failures.push(message);
}

if (!appConfig.pages.includes(expectedStatusPage)) {
	fail(`app.json 未注册统一状态页：${expectedStatusPage}`);
}

for (const gate of FROZEN_DOMAIN_GATES) {
	const failureCountBeforeGate = failures.length;
	if (seenGateIds.has(gate.id)) {
		fail(`${gate.name} 使用了重复的冻结域 id：${gate.id}`);
	}
	seenGateIds.add(gate.id);
	if (!allowedContractFamilies.has(gate.contractFamily)) {
		fail(`${gate.name} 的 contractFamily 无效：${gate.contractFamily}`);
	}
	if (!MIGRATION_BATCH_IDS.includes(gate.migrationBatch)) {
		fail(`${gate.name} 的迁移批次无效：${gate.migrationBatch}`);
	}
	for (const state of requiredSemanticStates) {
		if (!gate.semanticStates?.includes(state)) {
			fail(`${gate.name} 缺少统一业务语义状态：${state}`);
		}
	}
	for (const material of requiredCommonMaterials) {
		if (!gate.commonMaterials?.includes(material)) {
			fail(`${gate.name} 缺少通用 contract 材料：${material}`);
		}
	}
	if (
		!Array.isArray(gate.requiredMaterials) ||
		gate.requiredMaterials.length === 0
	) {
		fail(`${gate.name} 缺少该域特有的 contract 材料`);
	}
	if (
		!Array.isArray(gate.forbiddenCapabilities) ||
		gate.forbiddenCapabilities.length === 0
	) {
		fail(`${gate.name} 缺少明确关闭能力`);
	}
	const legacyPaths = Array.isArray(gate.legacyPaths) ? gate.legacyPaths : [];
	const legacyActions = Array.isArray(gate.legacyActions)
		? gate.legacyActions
		: [];
	if (legacyPaths.length === 0 && legacyActions.length === 0) {
		fail(`${gate.name} 缺少旧页面或 action-only 入口来源`);
	}
	const feature = featureNavigation.FEATURE_STATUS_CATALOG[gate.featureKey];
	if (!feature) {
		fail(`${gate.name} 缺少 FeatureKey 目录项：${gate.featureKey}`);
		gateFailureCounts.set(gate.name, failures.length - failureCountBeforeGate);
		continue;
	}
	if (feature.readiness !== gate.readiness) {
		fail(
			`${gate.name} 的状态类型不一致：期望 ${gate.readiness}，实际 ${feature.readiness}`,
		);
	}

	for (const legacyPath of gate.legacyPaths) {
		const entry = catalog.LEGACY_PAGE_MIGRATION_CATALOG.find(
			(item) => item.legacyPath === legacyPath,
		);
		if (!entry) {
			fail(`${gate.name} 未登记旧页面：${legacyPath}`);
			continue;
		}
		const expectedTarget =
			gate.safeReadOnlyTarget ?? gate.safeSurfaceTarget ?? expectedStatusPage;
		if (entry.nativeTarget !== expectedTarget) {
			fail(
				`${gate.name} 的 ${legacyPath} 落点不符合 contract 边界：期望 ${expectedTarget}，实际 ${entry.nativeTarget}`,
			);
		}
		// 只读或只读为主的安全页面可以在独立写入 contract 之前上线，
		// 但必须是明确的 replaced 页面；它仍保留 contract FeatureKey
		// 用于迁移追踪，不能因此把独立写入能力解释成已开放。
		if (gate.safeReadOnlyTarget) {
			if (entry.status !== "replaced") {
				fail(
					`${gate.name} 的 ${legacyPath} 静态只读落点必须是 replaced，实际 ${entry.status}`,
				);
			}
			if (entry.featureKey !== gate.featureKey) {
				fail(
					`${gate.name} 的 ${legacyPath} 静态只读页契约 FeatureKey 不一致：期望 ${gate.featureKey}，实际 ${entry.featureKey}`,
				);
			}
			continue;
		}
		// 页面外壳已经迁移，但真实读取仍关闭。它必须明确标记为
		// surface-only；只有 gate 显式列出的安全子集才允许是 partial，
		// 不能因为同一页面还存在未确认能力就整体宣称已完成。
		if (gate.safeSurfaceTarget) {
			const isSafePartial =
				gate.safePartialPaths?.includes(legacyPath) === true;
			const expectedStatus = isSafePartial ? "partial" : "surface-only";
			if (entry.status !== expectedStatus) {
				fail(
					`${gate.name} 的 ${legacyPath} 页面落点必须是 ${expectedStatus}，实际 ${entry.status}`,
				);
			}
			if (entry.featureKey !== gate.featureKey) {
				fail(
					`${gate.name} 的 ${legacyPath} 页面外壳 FeatureKey 不一致：期望 ${gate.featureKey}，实际 ${entry.featureKey}`,
				);
			}
			continue;
		}
		if (entry.featureKey !== gate.featureKey) {
			fail(
				`${gate.name} 的 ${legacyPath} FeatureKey 不一致：期望 ${gate.featureKey}，实际 ${entry.featureKey}`,
			);
		}
		if (entry.status !== legacyStatusByReadiness.get(gate.readiness)) {
			fail(
				`${gate.name} 的 ${legacyPath} 状态类型不一致：期望 ${legacyStatusByReadiness.get(gate.readiness)}，实际 ${entry.status}`,
			);
		}
	}
	for (const actionReference of legacyActions) {
		if (typeof actionReference !== "string") {
			fail(`${gate.name} 的 action-only 入口必须是“页面:action”字符串`);
			continue;
		}
		const [pageId, action, ...extraParts] = actionReference.split(":");
		const calledFeatureKey = actionReference.slice(
			actionReference.indexOf(":") + 1,
		);
		if (featureStatusActions.has(actionReference)) {
			if (calledFeatureKey !== gate.featureKey) {
				fail(
					`${gate.name} 的状态页调用未指向对应 FeatureKey：${actionReference} -> ${gate.featureKey}`,
				);
			}
			continue;
		}
		const page = actionPages.get(pageId);
		if (!pageId || !action || extraParts.length > 0 || !page) {
			fail(`${gate.name} 的 action-only 入口无效：${actionReference}`);
			continue;
		}
		if (!page.actions.includes(action)) {
			fail(`${gate.name} 引用了不存在的 action：${actionReference}`);
		}
		if (!page.featureKeys.includes(gate.featureKey)) {
			fail(
				`${gate.name} 的 action 未指向对应 FeatureKey：${actionReference} -> ${gate.featureKey}`,
			);
		}
	}
	gateFailureCounts.set(gate.name, failures.length - failureCountBeforeGate);
}

// 每个当前可见的状态页 action 都必须有 gate；已经进入正式原生页面的
// action 则由 FEATURE_SURFACE_TARGETS 负责闭环，不能继续占用旧的冻结 gate。
const gateFeatureKeys = new Set(
	FROZEN_DOMAIN_GATES.map((gate) => gate.featureKey),
);
const surfacedFeatureKeys = new Set(
	Object.keys(featureNavigation.FEATURE_SURFACE_TARGETS ?? {}),
);
for (const featureKey of actionFeatureKeys) {
	if (
		!gateFeatureKeys.has(featureKey) &&
		!surfacedFeatureKeys.has(featureKey)
	) {
		fail(`可见 action FeatureKey 缺少冻结域准入门禁：${featureKey}`);
	}
}

// 二级页面的状态页调用也必须拥有冻结 gate；否则入口虽然有提示，
// 但其 contract 家族、禁止能力和后续放行条件仍然没有纳入总目录。
for (const actionReference of featureStatusActions) {
	const featureKey = actionReference.slice(actionReference.indexOf(":") + 1);
	if (!gateFeatureKeys.has(featureKey)) {
		fail(`状态页调用 FeatureKey 缺少冻结域准入门禁：${actionReference}`);
	}
}

/**
 * 重点冻结域之外的 blocked 页面也不能绕过统一状态页。
 * FROZEN_DOMAIN_GATES 记录的是需要逐域检查的业务语义；这里检查全部
 * 台账状态，防止后续新增一个支付、患者或外部入口时只更新台账，却把
 * 它错误地指向半成品真实页面。
 */
for (const entry of catalog.LEGACY_PAGE_MIGRATION_CATALOG) {
	if (!entry.status.startsWith("blocked-")) continue;
	if (entry.nativeTarget !== expectedStatusPage) {
		fail(
			`blocked 页面 ${entry.legacyPath} 必须进入统一状态页：${entry.nativeTarget}`,
		);
	}
	if (!entry.featureKey) {
		fail(`blocked 页面 ${entry.legacyPath} 缺少 FeatureKey`);
		continue;
	}
	if (!gateFeatureKeys.has(entry.featureKey)) {
		fail(
			`blocked 页面 ${entry.legacyPath} FeatureKey 缺少冻结域准入门禁：${entry.featureKey}`,
		);
	}
	if (
		!Object.hasOwn(featureNavigation.FEATURE_STATUS_CATALOG, entry.featureKey)
	) {
		fail(
			`blocked 页面 ${entry.legacyPath} 引用了未知 FeatureKey：${entry.featureKey}`,
		);
	}
}

/**
 * 这里重复声明最容易被误带回小程序的内部字段，作为广度迁移的最后一道
 * 防线。详细实现边界仍由 architecture:audit 负责，本工具只关注冻结域。
 */
const miniprogramGlob = new Bun.Glob(
	"apps/miniprogram/src/**/*.{ts,js,wxml,wxss,json,jsonc}",
);
for await (const file of miniprogramGlob.scan({
	cwd: fileURLToPath(repositoryRoot),
	onlyFiles: true,
})) {
	if (/(?:\.test|\.spec)\.(?:ts|js)$/u.test(file)) continue;
	const source = await Bun.file(
		new URL(file.replaceAll("\\", "/"), repositoryRoot),
	).text();
	for (const forbidden of [
		"patId",
		"patInHosId",
		"thirdPatientId",
		"out-visit-record-id",
	]) {
		if (source.includes(forbidden)) {
			fail(`小程序生产文件 ${file} 仍包含冻结内部字段：${forbidden}`);
		}
	}
}

for (const gate of FROZEN_DOMAIN_GATES) {
	const failureCount = gateFailureCounts.get(gate.name) ?? 1;
	const targetDescription = gate.safeReadOnlyTarget
		? `${gate.safeReadOnlyTarget}（安全只读入口已迁移，独立写入能力仍按 contract 管理）`
		: gate.safeSurfaceTarget
			? `${gate.safeSurfaceTarget}（页面外壳/安全子集已迁移，真实 contract 仍关闭）`
			: `${expectedStatusPage}?feature=${gate.featureKey}（${gate.readiness}）`;
	console.log(
		`[${failureCount === 0 ? "PASS" : "FAIL"}] ${gate.name}：${gate.legacyPaths.length} 个旧页面 + ${(gate.legacyActions ?? []).length} 个 action-only 入口 -> ${targetDescription}`,
	);
}

if (failures.length > 0) {
	console.error(`Migration boundary audit failed: ${failures.length} rule(s)`);
	for (const failure of failures) console.error(`- ${failure}`);
	process.exitCode = 1;
} else {
	console.log(
		`Migration boundary audit passed: ${FROZEN_DOMAIN_GATES.length} frozen entry gate(s)`,
	);
}
