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

function duplicateValues(values) {
	const counts = new Map();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts.entries()]
		.filter(([, count]) => count > 1)
		.map(([value]) => value)
		.sort();
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
		if (item.status !== "awaiting-formal-contract") {
			failures.push(`${item.batchId} 必须保持 awaiting-formal-contract`);
		}
		if (item.requiredEvidence.length < 5) {
			failures.push(`${item.batchId} 的正式材料清单不完整`);
		}
		if (item.implementationSequence.length < 5) {
			failures.push(`${item.batchId} 的实现顺序不完整`);
		}
		if (item.forbiddenUntilConfirmed.length < 3) {
			failures.push(`${item.batchId} 的未确认禁止项不完整`);
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
