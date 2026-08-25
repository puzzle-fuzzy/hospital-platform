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

/**
 * 全量迁移的六条执行队列。
 *
 * 这是迁移编排信息，不是业务开放开关：页面显示某个批次，只代表后续
 * 应该收集哪类 contract/证据，不能把状态页误当成已经可以调用的服务。
 */
export type MigrationBatchId =
	| "A-readonly-evidence"
	| "B-health-content"
	| "C-clinical-readonly-contracts"
	| "D-patient-and-convenience-write"
	| "E-external-entry"
	| "F-payment-and-writeback";

export type MigrationBatchInfo = {
	id: MigrationBatchId;
	label: string;
	nextInput: string;
};

export type MigrationCoverage = {
	featureKey: FeatureKey;
	feature: FeatureStatus;
	stage: MigrationCoverageStage;
	stageLabel: string;
	coverageLabel: string;
	nextStep: string;
	domains: ReadonlyArray<LegacyPageMigration["domain"]>;
	/** 预先生成展示文本，避免 WXML 调用 JS 方法导致真机渲染差异。 */
	domainsLabel: string;
	legacyPaths: ReadonlyArray<string>;
	notes: ReadonlyArray<string>;
	nativeTarget: string;
	migrationBatch: MigrationBatchInfo;
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

/**
 * 状态页所需的批次映射与工具侧 gate 目录保持同一顺序。
 *
 * `health-encyclopedia` 单独归入 B，是因为它的准入条件是审核 bundle，
 * 不能混入临床问卷/写入队列；其余入口按 provider、患者写入、外部会话
 * 和支付回写分别归队。缺少映射时宁可让测试失败，也不能默默落到错误批次。
 */
const MIGRATION_BATCH_BY_FEATURE_KEY: Readonly<
	Record<FeatureKey, MigrationBatchId>
> = Object.freeze({
	"health-encyclopedia": "B-health-content",
	"appointment-detail": "A-readonly-evidence",
	"blood-appointment": "A-readonly-evidence",
	"report-detail": "A-readonly-evidence",
	"report-peis": "A-readonly-evidence",
	"medical-record": "C-clinical-readonly-contracts",
	"inpatient-center": "C-clinical-readonly-contracts",
	doctor: "C-clinical-readonly-contracts",
	"doctor-directory": "C-clinical-readonly-contracts",
	"electronic-consultation": "C-clinical-readonly-contracts",
	"patient-binding": "D-patient-and-convenience-write",
	"patient-agreement": "D-patient-and-convenience-write",
	"patient-address": "D-patient-and-convenience-write",
	"patient-qr": "D-patient-and-convenience-write",
	"patient-signature": "D-patient-and-convenience-write",
	"admission-preconsultation": "D-patient-and-convenience-write",
	"discharge-followup": "D-patient-and-convenience-write",
	"risk-evaluation": "D-patient-and-convenience-write",
	"health-test": "D-patient-and-convenience-write",
	"pre-visit": "D-patient-and-convenience-write",
	"gift-banner": "D-patient-and-convenience-write",
	"health-praise": "D-patient-and-convenience-write",
	guide: "E-external-entry",
	companion: "E-external-entry",
	consultation: "E-external-entry",
	"smart-customer": "E-external-entry",
	"patient-subscription": "E-external-entry",
	"report-cloud-image": "E-external-entry",
	"report-share": "E-external-entry",
	"report-follow-up": "E-external-entry",
	"inpatient-payment": "F-payment-and-writeback",
	insurance: "F-payment-and-writeback",
	"appointment-write": "F-payment-and-writeback",
	cashier: "F-payment-and-writeback",
	"electronic-bill": "F-payment-and-writeback",
	"outpatient-payment-detail": "F-payment-and-writeback",
	"outpatient-payment-write": "F-payment-and-writeback",
});

const MIGRATION_BATCH_INFO: Readonly<
	Record<MigrationBatchId, MigrationBatchInfo>
> = Object.freeze({
	"A-readonly-evidence": {
		id: "A-readonly-evidence",
		label: "A · 安全只读真实取证",
		nextInput:
			"同一候选下收集客户端 requestId、服务端同链日志和 Provider 脱敏结果。",
	},
	"B-health-content": {
		id: "B-health-content",
		label: "B · 健康内容发布",
		nextInput:
			"取得审核 bundle，完成 bundle 校验、staging 导入、撤回演练和真机证据。",
	},
	"C-clinical-readonly-contracts": {
		id: "C-clinical-readonly-contracts",
		label: "C · 临床只读契约",
		nextInput:
			"分别确认 Provider 请求、空/拒绝/超时、患者映射、字段白名单和脱敏样例。",
	},
	"D-patient-and-convenience-write": {
		id: "D-patient-and-convenience-write",
		label: "D · 患者与便民写入",
		nextInput: "冻结 owner、同意、幂等、撤回、文件安全和医护读取规则。",
	},
	"E-external-entry": {
		id: "E-external-entry",
		label: "E · 外部入口与实时能力",
		nextInput: "确认域名 allowlist、短期会话、受众、退出、回跳和撤回协议。",
	},
	"F-payment-and-writeback": {
		id: "F-payment-and-writeback",
		label: "F · 支付、医保与 HIS 回写",
		nextInput: "最后冻结金额、订单状态机、回调查单、幂等补偿和 HIS 回写。",
	},
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
	const migrationBatchId = MIGRATION_BATCH_BY_FEATURE_KEY[featureKey];
	if (!migrationBatchId) {
		throw new Error(`迁移入口缺少批次映射：${featureKey}`);
	}
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
		domainsLabel: domains.join("、"),
		legacyPaths: Object.freeze(legacyPaths),
		notes: Object.freeze(notes),
		nativeTarget:
			entries[0]?.nativeTarget ?? "pages/feature-status/feature-status",
		migrationBatch: MIGRATION_BATCH_INFO[migrationBatchId],
	});
}
