import { FROZEN_DOMAIN_GATE_CATALOG } from "./migration-boundary-catalog.mjs";

/**
 * C/D/E 批次的契约材料入口。
 *
 * 这里不登记 Provider 地址、账号或真实报文，只登记“收到什么材料后才能
 * 进入实现”的机器约束。材料未确认前，audit 仍然可以通过结构检查，但
 * `businessReady` 必须保持 false，避免把台账完整误当成业务已经开放。
 */
export const MIGRATION_CONTRACT_INTAKE_CATALOG = Object.freeze(
	[
		{
			batchId: "C-clinical-readonly-contracts",
			name: "临床只读契约",
			status: "awaiting-formal-contract",
			owner: "Provider/HIS 业务责任人",
			requiredEvidence: Object.freeze([
				"provider-identity-and-version",
				"success-empty-rejected-timeout-samples",
				"patient-owner-mapping",
				"field-allowlist-and-forbidden-fields",
				"permission-and-retention",
				"provider-request-id-and-redaction",
			]),
			implementationSequence: Object.freeze([
				"contract-document",
				"adapter",
				"domain-invariants",
				"persistence-if-required",
				"elysia-api",
				"miniprogram-state-machine",
				"pino-and-device-evidence",
			]),
			forbiddenUntilConfirmed: Object.freeze([
				"复用预约、报告或门诊费用模型",
				"把 provider 患者号直接交给小程序",
				"用成功空数组替代未确认的 Provider 响应",
			]),
			nextInput:
				"分别提供门诊记录、住院 episode、医生关系和电子导诊的脱敏 contract；外部我的问诊另由 E 批次确认，不能用一份通用接口材料覆盖不同主体。",
		},
		{
			batchId: "D-patient-and-convenience-write",
			name: "患者与便民写入",
			status: "awaiting-formal-contract",
			owner: "患者服务、临床内容和平台安全责任人",
			requiredEvidence: Object.freeze([
				"owner-and-patient-scope",
				"versioned-consent-and-withdrawal",
				"idempotency-and-final-state-query",
				"field-and-file-security-allowlist",
				"clinical-review-where-content-or-rule-is-involved",
				"staff-read-and-audit-scope",
			]),
			implementationSequence: Object.freeze([
				"contract-document",
				"command-state-machine",
				"adapter",
				"domain-invariants",
				"persistence-and-reconciliation",
				"elysia-command-and-query-api",
				"miniprogram-confirmation-and-retry-ui",
				"pino-and-device-evidence",
			]),
			forbiddenUntilConfirmed: Object.freeze([
				"查档异常降级为建档",
				"把客户端勾选当作版本化同意",
				"把建档成功当作绑定成功",
				"把身份证、卡号或签名文件写入普通日志和长期缓存",
			]),
			nextInput:
				"先确认患者绑定/协议/地址/签名，再分别确认预问诊、随访、风险自评、自测、锦旗和表扬信的内容与医护读取规则。",
		},
		{
			batchId: "E-external-entry",
			name: "外部入口与实时能力",
			status: "awaiting-formal-contract",
			owner: "外部业务主体、平台安全和小程序运营责任人",
			requiredEvidence: Object.freeze([
				"external-subject-and-domain-allowlist",
				"short-lived-audience-bound-session",
				"callback-exit-and-failure-fallback",
				"token-and-referrer-isolation",
				"revocation-and-retention",
				"share-or-message-redaction-and-audit",
			]),
			implementationSequence: Object.freeze([
				"external-contract-and-allowlist",
				"short-session-issuer",
				"server-side-audience-check",
				"elysia-entry-and-callback",
				"miniprogram-escape-and-error-state",
				"pino-and-device-evidence",
			]),
			forbiddenUntilConfirmed: Object.freeze([
				"恢复任意 WebView 或长期 ticket",
				"把平台 token 交给第三方页面",
				"用本地订阅开关代表微信授权成功",
				"根据报告或预约摘要自动创建外部问诊/复诊会话",
			]),
			nextInput:
				"分别确认智能导诊、陪诊、客服、问诊、订阅消息和报告分享/资源入口的外部主体、受众、生命周期与撤回语义。",
		},
	].map((item) => Object.freeze(item)),
);

function collectBatchGates(batchId) {
	return FROZEN_DOMAIN_GATE_CATALOG.filter(
		(gate) => gate.migrationBatch === batchId,
	);
}

/** 材料清单中的值必须是可供人工核对的非空文本。 */
function nonEmptyText(value) {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * 把批次级材料要求展开到每个 FeatureKey。
 *
 * C/D/E 的入口数量较多，只看批次摘要容易让“已有一份材料”被误认为
 * “同批次所有功能都具备契约”。这里明确保留每个入口自己的旧路径、
 * action、额外材料和禁止能力；公共材料只做去重合并，不改变 pending 状态。
 */
export function buildFeatureContractIntakeRows() {
	const laneByBatchId = new Map(
		MIGRATION_CONTRACT_INTAKE_CATALOG.map((lane) => [lane.batchId, lane]),
	);
	return FROZEN_DOMAIN_GATE_CATALOG.filter((gate) =>
		laneByBatchId.has(gate.migrationBatch),
	)
		.map((gate) => {
			const lane = laneByBatchId.get(gate.migrationBatch);
			const requiredMaterials = [
				...gate.commonMaterials,
				...lane.requiredEvidence,
				...gate.requiredMaterials,
			].filter((value, index, values) => values.indexOf(value) === index);
			return {
				featureKey: gate.featureKey,
				name: gate.name,
				batchId: gate.migrationBatch,
				contractFamily: gate.contractFamily,
				status: lane.status,
				legacyPaths: gate.legacyPaths,
				legacyActions: gate.legacyActions ?? [],
				requiredMaterials,
				forbiddenCapabilities: gate.forbiddenCapabilities,
				businessReady: false,
				nextInput: lane.nextInput,
			};
		})
		.sort((left, right) => left.featureKey.localeCompare(right.featureKey));
}

function duplicateValues(values) {
	const counts = new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([value]) => value)
		.sort();
}

/**
 * 校验契约材料清单的文本形状。
 *
 * 这些清单不是展示文案，而是后续会话选择“能否进入 adapter”的机器输入。
 * 空字符串、重复材料或把对象误塞进数组，都会让材料状态看起来完整却无法
 * 逐项验收；因此这里在批次覆盖检查之前 fail-closed。该校验只检查新仓库
 * 中的准入目录，不读取旧服务、数据库、Redis 或 Provider。
 */
function auditNonEmptyTextList(failures, label, values, minimumLength) {
	if (!Array.isArray(values)) {
		failures.push(`${label} 必须是数组`);
		return;
	}
	if (values.length < minimumLength) {
		failures.push(`${label} 至少需要 ${minimumLength} 项`);
	}
	const invalidValues = values.filter((value) => !nonEmptyText(value));
	if (invalidValues.length > 0) {
		failures.push(`${label} 只能包含非空文本`);
	}
	const duplicateItems = duplicateValues(values.filter(nonEmptyText));
	if (duplicateItems.length > 0) {
		failures.push(`${label} 不能重复：${duplicateItems.join("、")}`);
	}
}

/**
 * 审计 C/D/E 材料入口与冻结 gate 的覆盖关系。
 *
 * 审计通过只表示“下一步知道要收什么材料”，绝不把 pending 改成 ready。
 * 这是故意的 fail-closed 设计：正式材料进入仓库后，还必须通过独立的
 * 脱敏样例、adapter、运行和真机证据门禁。
 */
export function auditMigrationContractIntake() {
	const failures = [];
	const expectedBatchIds = new Set([
		"C-clinical-readonly-contracts",
		"D-patient-and-convenience-write",
		"E-external-entry",
	]);
	const actualBatchIds = MIGRATION_CONTRACT_INTAKE_CATALOG.map(
		(item) => item.batchId,
	);

	for (const batchId of expectedBatchIds) {
		if (!actualBatchIds.includes(batchId)) {
			failures.push(`缺少批次材料入口：${batchId}`);
		}
	}
	for (const batchId of actualBatchIds) {
		if (!expectedBatchIds.has(batchId)) {
			failures.push(`存在未允许的批次材料入口：${batchId}`);
		}
	}
	for (const batchId of duplicateValues(actualBatchIds)) {
		failures.push(`批次材料入口重复：${batchId}`);
	}

	const lanes = MIGRATION_CONTRACT_INTAKE_CATALOG.map((item) => {
		const gates = collectBatchGates(item.batchId);
		if (gates.length === 0) {
			failures.push(`${item.batchId} 没有对应冻结 gate`);
		}
		if (!nonEmptyText(item.name)) {
			failures.push(`${item.batchId} 缺少批次名称`);
		}
		if (!nonEmptyText(item.owner)) {
			failures.push(`${item.batchId} 缺少材料责任人`);
		}
		if (item.status !== "awaiting-formal-contract") {
			failures.push(`${item.batchId} 必须保持 awaiting-formal-contract`);
		}
		auditNonEmptyTextList(
			failures,
			`${item.batchId} 的正式材料清单`,
			item.requiredEvidence,
			5,
		);
		auditNonEmptyTextList(
			failures,
			`${item.batchId} 的实现顺序`,
			item.implementationSequence,
			5,
		);
		auditNonEmptyTextList(
			failures,
			`${item.batchId} 的未确认禁止项`,
			item.forbiddenUntilConfirmed,
			3,
		);
		if (!nonEmptyText(item.nextInput)) {
			failures.push(`${item.batchId} 缺少下一项材料说明`);
		}
		for (const gate of gates) {
			const gateLabel = `${item.batchId}/${gate.featureKey}`;
			const entryCount =
				(Array.isArray(gate.legacyPaths) ? gate.legacyPaths.length : 0) +
				(Array.isArray(gate.legacyActions) ? gate.legacyActions.length : 0);
			if (entryCount === 0) {
				failures.push(`${gateLabel} 必须至少保留一个旧页面或 action 入口`);
			}
			auditNonEmptyTextList(
				failures,
				`${gateLabel} 的禁止能力`,
				gate.forbiddenCapabilities,
				1,
			);
		}
		return {
			batchId: item.batchId,
			name: item.name,
			status: item.status,
			owner: item.owner,
			gateCount: gates.length,
			gateIds: gates.map((gate) => gate.id),
			featureKeys: gates.map((gate) => gate.featureKey).sort(),
			requiredEvidence: item.requiredEvidence,
			implementationSequence: item.implementationSequence,
			forbiddenUntilConfirmed: item.forbiddenUntilConfirmed,
			nextInput: item.nextInput,
			businessReady: false,
		};
	});

	const coveredFeatureKeys = lanes.flatMap((lane) => lane.featureKeys);
	const duplicatedFeatureKeys = duplicateValues(coveredFeatureKeys);
	for (const featureKey of duplicatedFeatureKeys) {
		failures.push(`C/D/E FeatureKey 重复归属：${featureKey}`);
	}

	const expectedFeatureKeys = FROZEN_DOMAIN_GATE_CATALOG.filter((gate) =>
		expectedBatchIds.has(gate.migrationBatch),
	).map((gate) => gate.featureKey);
	const uncoveredFeatureKeys = expectedFeatureKeys
		.filter((featureKey) => !coveredFeatureKeys.includes(featureKey))
		.filter((featureKey, index, values) => values.indexOf(featureKey) === index)
		.sort();
	for (const featureKey of uncoveredFeatureKeys) {
		failures.push(`C/D/E FeatureKey 未进入材料队列：${featureKey}`);
	}

	return {
		schemaVersion: 1,
		laneCount: lanes.length,
		coveredFeatureKeyCount: new Set(coveredFeatureKeys).size,
		featureIntakeRows: buildFeatureContractIntakeRows(),
		duplicatedFeatureKeys,
		uncoveredFeatureKeys,
		businessReady: false,
		lanes,
		failures,
		passed: failures.length === 0,
	};
}

if (import.meta.main) {
	const report = auditMigrationContractIntake();
	console.log(JSON.stringify(report, null, 2));
	if (!report.passed) process.exitCode = 1;
}
