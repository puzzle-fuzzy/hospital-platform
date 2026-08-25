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

/**
 * 入口的业务契约族。
 *
 * 批次表示迁移执行顺序，契约族表示这个入口最终要遵守的业务边界；
 * 两者不能互相替代。例如报告云影像属于 E 批次，但仍然是 Provider
 * 只读资源，不应因为进入外部队列就被当作普通 WebView 会话。
 */
export type MigrationContractFamily =
	| "provider-read-only"
	| "health-content"
	| "patient-write"
	| "clinical-content-write"
	| "external-content"
	| "external-session"
	| "payment-write";

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
	contractFamily: MigrationContractFamily;
	contractFamilyLabel: string;
	migrationBatch: MigrationBatchInfo;
};

const STAGE_LABELS: Readonly<Record<MigrationCoverageStage, string>> =
	Object.freeze({
		"new-entry": "新端入口已接入",
		replaced: "已接入原生页面",
		partial: "已接入安全子集",
		"surface-only": "页面外壳已迁移，业务仍关闭",
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
		"surface-only":
			"先完成对应 contract、adapter、API 和低敏日志，再把关闭态替换为真实数据状态机。",
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

/**
 * 逐入口契约族必须显式列出，不能从 readiness 文案或迁移批次推断。
 *
 * 这里的完整 Record 让新增 FeatureKey 在 TypeScript 编译期就暴露缺失
 * 归属，防止页面出现“有状态、无边界”的泛化迁移提示。
 */
const MIGRATION_CONTRACT_FAMILY_BY_FEATURE_KEY: Readonly<
	Record<FeatureKey, MigrationContractFamily>
> = Object.freeze({
	"admission-preconsultation": "clinical-content-write",
	"appointment-detail": "provider-read-only",
	"appointment-write": "payment-write",
	"blood-appointment": "provider-read-only",
	cashier: "payment-write",
	companion: "external-session",
	consultation: "external-session",
	"discharge-followup": "clinical-content-write",
	doctor: "provider-read-only",
	"doctor-directory": "provider-read-only",
	"electronic-consultation": "provider-read-only",
	"electronic-bill": "payment-write",
	"patient-agreement": "patient-write",
	"patient-address": "patient-write",
	"patient-qr": "patient-write",
	"patient-signature": "patient-write",
	"patient-subscription": "external-session",
	"gift-banner": "external-content",
	guide: "external-session",
	"health-encyclopedia": "health-content",
	"health-praise": "external-content",
	"health-test": "clinical-content-write",
	"inpatient-center": "provider-read-only",
	"inpatient-payment": "payment-write",
	insurance: "payment-write",
	"medical-record": "provider-read-only",
	"outpatient-payment-detail": "payment-write",
	"outpatient-payment-write": "payment-write",
	"patient-binding": "patient-write",
	"pre-visit": "clinical-content-write",
	"report-cloud-image": "provider-read-only",
	"report-detail": "provider-read-only",
	"report-peis": "provider-read-only",
	"report-follow-up": "provider-read-only",
	"report-share": "external-session",
	"risk-evaluation": "clinical-content-write",
	"smart-customer": "external-session",
});

const CONTRACT_FAMILY_LABELS: Readonly<
	Record<MigrationContractFamily, string>
> = Object.freeze({
	"provider-read-only": "Provider 只读",
	"health-content": "健康内容审核",
	"patient-write": "患者写入",
	"clinical-content-write": "临床内容与写入",
	"external-content": "外部内容审核",
	"external-session": "外部会话",
	"payment-write": "支付与回写",
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

/**
 * 旧端页面的迁移批次结果。
 *
 * `excluded` 是明确排除的开发辅助页面，不属于任何业务批次；其余页面
 * 必须进入 A–F 中的一条队列。这里的归属描述“当前安全子集或下一步证据
 * 应由哪条队列负责”，不是把页面标记成已经可用。
 */
export type LegacyPageMigrationBatch = MigrationBatchId | "excluded";

/**
 * 健康百科的四个只读入口由审核 bundle 队列负责。
 *
 * 不能仅按 `domain === 健康` 推断 B：同一业务域里的病历、支付、问卷和
 * 锦旗分别属于 C、F、D。只列出已经存在安全内容子集的旧页面，其他健康
 * 页面仍必须通过自己的 featureKey 进入对应阻断批次。
 */
const HEALTH_CONTENT_LEGACY_PATHS: ReadonlySet<string> = new Set([
	"pagesB/health/disease_detail.vue",
	"pagesB/health/drug_detail.vue",
	"pagesB/health/health_encyclopedia.vue",
	"pagesB/health/search_result.vue",
]);

/**
 * 为逐页迁移台账解析唯一批次。
 *
 * 优先使用 featureKey，因为阻断入口的 contract 家族已经在状态目录中
 * 冻结；没有 featureKey 的安全页面才按“已确认的当前子集”归入 A/B。
 * 任何未覆盖的新页面都抛错，让测试和 readiness 在新增入口的同一轮失败，
 * 不能悄悄把它归入一个看似合理但未审计的批次。
 */
export function getLegacyPageMigrationBatch(
	entry: LegacyPageMigration,
): LegacyPageMigrationBatch {
	if (entry.status === "excluded") return "excluded";

	if (entry.featureKey) {
		const batch = MIGRATION_BATCH_BY_FEATURE_KEY[entry.featureKey];
		if (batch) return batch;
	}

	if (HEALTH_CONTENT_LEGACY_PATHS.has(entry.legacyPath)) {
		return "B-health-content";
	}

	// 旧端互联网医院页面的当前安全子集只是主 Tab 壳，下一步仍由外部
	// 会话/域名队列负责；不能把它当作普通静态页面纳入 A 的真机证据。
	if (entry.domain === "互联网医院") return "E-external-entry";

	// 其余没有 featureKey 的 replaced/partial 页面都已有静态或只读安全
	// 子集，统一由 A 批次完成页面、请求链和四方证据；它们的未迁移扩展仍
	// 记录在 entry.note 中，不能因此升级为“业务完成”。
	if (entry.status === "replaced" || entry.status === "partial") {
		return "A-readonly-evidence";
	}

	throw new Error(`旧页面缺少迁移批次：${entry.legacyPath}`);
}

function mergeStage(
	entries: ReadonlyArray<LegacyPageMigration>,
): MigrationCoverageStage {
	if (entries.length === 0) return "new-entry";
	const stages = new Set(entries.map((entry) => entry.status));
	if (stages.size === 1) return entries[0]?.status ?? "new-entry";
	// 一个 feature key 可能覆盖旧端的安全子集和未完成扩展；展示“部分迁移”
	// 比选择某一个阻塞类型更准确，避免把已经接入的页面误标成完全关闭。
	if (stages.has("partial") || stages.has("replaced")) return "partial";
	if (stages.has("surface-only")) return "surface-only";
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
	const contractFamily = MIGRATION_CONTRACT_FAMILY_BY_FEATURE_KEY[featureKey];
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
		contractFamily,
		contractFamilyLabel: CONTRACT_FAMILY_LABELS[contractFamily],
		migrationBatch: MIGRATION_BATCH_INFO[migrationBatchId],
	});
}
