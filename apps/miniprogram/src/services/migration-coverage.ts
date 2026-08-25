import {
	FEATURE_STATUS_CATALOG,
	type FeatureKey,
	type FeatureStatus,
} from "./feature-navigation";
import {
	LEGACY_PAGE_MIGRATION_CATALOG,
	type LegacyPageMigration,
	type LegacyPageMigrationStatus,
} from "./legacy-page-catalog";

/**
 * 统一状态页展示的迁移阶段。
 *
 * `new-entry` 表示这是新端新增入口，旧端台账没有对应页面；它不等价于
 * 真实业务已经完成。页面只使用这里的安全展示文案，真正的发布准入仍
 * 由 contract、服务端和真机证据决定。
 */
export type MigrationCoverageStage = LegacyPageMigrationStatus | "new-entry";

export type MigrationCoverage = {
	featureKey: FeatureKey;
	feature: FeatureStatus;
	stage: MigrationCoverageStage;
	stageLabel: string;
	coverageLabel: string;
	nextStep: string;
	domains: ReadonlyArray<LegacyPageMigration["domain"]>;
	legacyPaths: ReadonlyArray<string>;
	notes: ReadonlyArray<string>;
	nativeTarget: string;
};

const STAGE_LABELS: Readonly<Record<MigrationCoverageStage, string>> =
	Object.freeze({
		"new-entry": "新端入口已接入",
		replaced: "已接入原生页面",
		partial: "已接入安全子集",
		"blocked-provider": "等待 provider contract",
		"blocked-clinical": "等待临床审核",
		"blocked-payment": "等待支付与回写 contract",
		"blocked-patient-contract": "等待患者绑定 contract",
		"blocked-external": "等待外部入口 contract",
		excluded: "不进入生产小程序",
	});

const NEXT_STEPS: Readonly<Record<MigrationCoverageStage, string>> =
	Object.freeze({
		"new-entry": "先完成该新入口自身的业务 contract，再进入真实链路验收。",
		replaced: "继续完成服务端、公网和真机证据；代码页面不单独代表业务完成。",
		partial: "补齐旧页面尚未接入的详情、写入、实时或外部链路，并单独验收。",
		"blocked-provider":
			"登记正式 provider/HIS 请求、响应、错误和脱敏字段样例。",
		"blocked-clinical": "确认版本化内容、题库或规则，并取得临床审核记录。",
		"blocked-payment": "冻结金额、订单、查单、回调和 HIS 回写状态机后再实现。",
		"blocked-patient-contract":
			"冻结 owner、同意、幂等、撤回和患者字段白名单。",
		"blocked-external": "冻结域名 allowlist、短期会话、受众、退出和回跳规则。",
		excluded: "该入口是旧端开发辅助能力，不纳入生产迁移范围。",
	});

function mergeStage(
	entries: ReadonlyArray<LegacyPageMigration>,
): MigrationCoverageStage {
	if (entries.length === 0) return "new-entry";
	const stages = new Set(entries.map((entry) => entry.status));
	if (stages.size === 1) return entries[0]?.status ?? "new-entry";
	// 一个 feature key 可能覆盖旧端的安全子集和未完成扩展；展示“部分迁移”
	// 比选择某一个阻塞类型更准确，避免把已经接入的页面误标成完全关闭。
	if (stages.has("partial") || stages.has("replaced")) return "partial";
	return entries[0]?.status ?? "new-entry";
}

/**
 * 将状态页 feature key 连接到 64 个旧页面的迁移台账。
 *
 * 这是展示层的聚合，不是新的业务事实源：旧页面、业务域和阻塞原因仍
 * 只在 `legacy-page-catalog.ts` 中维护，避免页面再复制一份容易漂移的计数。
 */
export function getFeatureMigrationCoverage(
	featureKey: FeatureKey,
): MigrationCoverage {
	const feature = FEATURE_STATUS_CATALOG[featureKey];
	const entries = LEGACY_PAGE_MIGRATION_CATALOG.filter(
		(entry) => entry.featureKey === featureKey,
	);
	const stage = mergeStage(entries);
	const domains = [...new Set(entries.map((entry) => entry.domain))];
	const legacyPaths = entries.map((entry) => entry.legacyPath);
	const notes = entries.map((entry) => entry.note);
	return Object.freeze({
		featureKey,
		feature,
		stage,
		stageLabel: STAGE_LABELS[stage],
		coverageLabel:
			entries.length > 0
				? `覆盖旧端 ${entries.length} 个入口`
				: "新端新增入口，暂无旧端对应页面",
		nextStep: NEXT_STEPS[stage],
		domains: Object.freeze(domains),
		legacyPaths: Object.freeze(legacyPaths),
		notes: Object.freeze(notes),
		nativeTarget:
			entries[0]?.nativeTarget ?? "pages/feature-status/feature-status",
	});
}
