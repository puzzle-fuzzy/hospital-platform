/**
 * 全量迁移中尚未放行的 18 个业务域准入目录。
 *
 * 这份目录只描述“要满足什么条件才可以离开统一状态页”，不是运行时
 * 路由配置，也不是 Provider 的兼容层。所有域都必须先完成自己的 contract、
 * owner 边界、错误语义和回滚证据，再分别进入 adapter/domain/API/页面实现。
 * 这样可以避免不同旧页面共用一个“万能接口”，也避免把空列表误认为迁移完成。
 */

/**
 * 所有阻断域必须先具备同一组页面状态，尤其不能遗漏成功空结果与契约异常；
 * 统一状态机让后续真实实现不会把 Provider 故障渲染成“暂无记录”。
 */
const COMMON_SEMANTIC_STATES = Object.freeze([
	"requesting",
	"success-non-empty",
	"success-empty",
	"unauthorized",
	"invalid-input",
	"temporary-failure",
	"contract-invalid",
]);

/**
 * 所有阻断域共有的 contract 材料。域特有材料在各自条目中补充，不能用
 * 这组通用字段代替金额、临床审核、患者同意或外部短期会话等专项规则。
 */
const COMMON_CONTRACT_MATERIALS = Object.freeze([
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

/** 为每个域注入不可缺少的状态机和通用材料，避免条目漏填。 */
function createGate(gate) {
	return Object.freeze({
		...gate,
		semanticStates: COMMON_SEMANTIC_STATES,
		commonMaterials: COMMON_CONTRACT_MATERIALS,
	});
}

export const FROZEN_DOMAIN_GATE_CATALOG = Object.freeze([
	createGate({
		id: "outpatient-records",
		name: "门诊病历",
		featureKey: "medical-record",
		readiness: "待 provider contract",
		contractFamily: "provider-read-only",
		legacyPaths: ["pagesB/health/electronic_record.vue"],
		requiredMaterials: ["provider-version", "patient-reference"],
		forbiddenCapabilities: ["病历明细写入", "跨患者查询", "未经审核的临床建议"],
	}),
	createGate({
		id: "inpatient",
		name: "住院信息",
		featureKey: "inpatient-center",
		readiness: "待 provider contract",
		contractFamily: "provider-read-only",
		legacyPaths: ["pagesB/health/inpatient_center.vue"],
		requiredMaterials: [
			"episode-identity",
			"patInHosId-mapping",
			"status-enum",
		],
		forbiddenCapabilities: [
			"把门诊 patientId 当住院 episode",
			"住院记录写入",
			"住院费用结算",
		],
	}),
	createGate({
		id: "inpatient-payment",
		name: "住院支付",
		featureKey: "inpatient-payment",
		readiness: "待支付与回写 contract",
		contractFamily: "payment-write",
		legacyPaths: ["pagesB/health/inpatient_payment.vue"],
		requiredMaterials: [
			"amount-unit",
			"order-state-machine",
			"callback-query",
			"idempotency",
			"compensation",
		],
		forbiddenCapabilities: [
			"创建住院支付订单",
			"调起支付",
			"医保结算",
			"HIS 状态回写",
		],
	}),
	createGate({
		id: "insurance",
		name: "医保电子凭证与挂号医保支付",
		featureKey: "insurance",
		readiness: "待支付与回写 contract",
		contractFamily: "payment-write",
		legacyPaths: [
			"pagesB/health/medical_insurance_pay.vue",
			"pagesB/hospital/registration_medical_pay.vue",
		],
		legacyActions: ["我的:insurance"],
		requiredMaterials: [
			"authorization-code-ttl",
			"patient-and-order-owner",
			"medical-insurance-protocol",
			"query-and-callback",
			"idempotency",
		],
		forbiddenCapabilities: [
			"把授权成功当作结算成功",
			"小程序提交 provider token 或金额",
			"绕过平台订单直接调用医保接口",
			"医保结果未经查单写回 HIS",
		],
	}),
	createGate({
		id: "doctor-relationship",
		name: "我的医生",
		featureKey: "doctor",
		readiness: "待 provider contract",
		contractFamily: "provider-read-only",
		legacyPaths: ["pagesB/patient/doctor.vue"],
		requiredMaterials: [
			"relationship-source",
			"display-allowlist",
			"expiration",
		],
		forbiddenCapabilities: [
			"客户端自行指定医生关系",
			"医生资料写入",
			"跨 owner 查看医生",
		],
	}),
	createGate({
		id: "smart-guide",
		name: "智能导诊",
		featureKey: "guide",
		readiness: "待外部入口 contract",
		contractFamily: "external-session",
		legacyPaths: [],
		legacyActions: ["首页:guide"],
		requiredMaterials: [
			"model-and-knowledge-version",
			"disclaimer",
			"risk-routing",
			"session-owner",
			"session-audit",
		],
		forbiddenCapabilities: [
			"未经版本管理返回医疗建议",
			"把导诊会话当诊断或预约成功",
			"跨用户复用会话上下文",
		],
	}),
	createGate({
		id: "treatment-companion",
		name: "陪诊服务",
		featureKey: "companion",
		readiness: "待外部入口 contract",
		contractFamily: "external-session",
		legacyPaths: [],
		legacyActions: ["首页:companion"],
		requiredMaterials: [
			"external-subject",
			"session-owner",
			"short-session",
			"retention",
			"exit",
			"revocation",
		],
		forbiddenCapabilities: [
			"把预约历史当陪诊记录",
			"长期保存外部 ticket",
			"跨患者创建陪诊会话",
		],
	}),
	createGate({
		id: "smart-customer",
		name: "智能客服",
		featureKey: "smart-customer",
		readiness: "待外部入口 contract",
		contractFamily: "external-session",
		legacyPaths: ["pagesB/health/webview.vue"],
		legacyActions: ["我的:smart-customer"],
		requiredMaterials: [
			"domain-allowlist",
			"external-audience",
			"short-session",
			"redirect",
			"exit",
		],
		forbiddenCapabilities: [
			"任意外部 URL",
			"把平台 token 交给 WebView",
			"长期 ticket 或无受众回跳",
		],
	}),
	createGate({
		id: "consultation",
		name: "我的问诊",
		featureKey: "consultation",
		readiness: "待外部入口 contract",
		contractFamily: "external-session",
		legacyPaths: ["pagesB/user/my_consultation.vue"],
		requiredMaterials: [
			"external-subject",
			"allowlist",
			"short-session",
			"redirect",
			"exit",
			"revocation",
		],
		forbiddenCapabilities: [
			"任意 WebView",
			"长期 ticket",
			"把问诊会话当普通患者列表",
		],
	}),
	createGate({
		id: "electronic-consultation",
		name: "电子导诊单",
		featureKey: "electronic-consultation",
		readiness: "待 provider contract",
		contractFamily: "provider-read-only",
		legacyPaths: ["pagesB/health/electronic_consultation.vue"],
		requiredMaterials: [
			"source-system",
			"patient-context",
			"short-session",
			"redirect",
		],
		forbiddenCapabilities: [
			"伪造导诊单",
			"跨患者读取导诊结果",
			"直接提交未经确认的临床结论",
		],
	}),
	createGate({
		id: "patient-binding",
		name: "患者新增绑定",
		featureKey: "patient-binding",
		readiness: "待患者绑定 contract",
		contractFamily: "patient-write",
		legacyPaths: ["pagesB/patient/patientAdd.vue"],
		requiredMaterials: [
			"consent",
			"identity-verification",
			"idempotency",
			"withdrawal",
			"staff-read",
		],
		forbiddenCapabilities: [
			"仅凭姓名绑定",
			"客户端提交 Provider 患者号",
			"无同意建档",
		],
	}),
	createGate({
		id: "admission-preconsultation",
		name: "入院预问诊",
		featureKey: "admission-preconsultation",
		readiness: "待临床审核",
		contractFamily: "clinical-content-write",
		legacyPaths: ["pagesB/health/admission_preconsultation.vue"],
		requiredMaterials: [
			"questionnaire-version",
			"authorization",
			"submission-idempotency",
			"clinical-review",
		],
		forbiddenCapabilities: [
			"使用旧题库生成医疗结论",
			"无授权提交",
			"把问卷答案当诊断",
		],
	}),
	createGate({
		id: "discharge-followup",
		name: "出院随访",
		featureKey: "discharge-followup",
		readiness: "待临床审核",
		contractFamily: "clinical-content-write",
		legacyPaths: [
			"pagesB/health/discharge_followup.vue",
			"pagesB/health/discharge_followup_detail.vue",
		],
		requiredMaterials: [
			"discharge-event",
			"followup-task",
			"answer-version",
			"withdrawal",
			"clinical-review",
		],
		forbiddenCapabilities: [
			"跨任务提交答案",
			"覆盖历史随访",
			"无医护读取规则发布",
		],
	}),
	createGate({
		id: "risk-evaluation",
		name: "风险评估",
		featureKey: "risk-evaluation",
		readiness: "待临床审核",
		contractFamily: "clinical-content-write",
		legacyPaths: [
			"pagesB/health/risk_form_fall.vue",
			"pagesB/health/risk_form_pain.vue",
			"pagesB/health/risk_form_pressure.vue",
			"pagesB/health/risk_self_evaluation.vue",
		],
		requiredMaterials: [
			"rule-version",
			"applicable-population",
			"disclaimer",
			"clinical-review",
		],
		forbiddenCapabilities: [
			"使用客户端阈值计算医疗等级",
			"个体化诊断",
			"无版本回滚",
		],
	}),
	createGate({
		id: "health-test",
		name: "健康自测与计算器",
		featureKey: "health-test",
		readiness: "待临床审核",
		contractFamily: "clinical-content-write",
		legacyPaths: [
			"pagesB/health/blood_pressure_calc.vue",
			"pagesB/health/bmi_calc.vue",
			"pagesB/health/health_test.vue",
			"pagesB/health/self_test_question.vue",
			"pagesB/health/self_test_result.vue",
		],
		requiredMaterials: [
			"question-bank-version",
			"threshold-version",
			"applicable-population",
			"disclaimer",
			"clinical-review",
		],
		forbiddenCapabilities: [
			"把旧 JSON 当医学事实",
			"无审核输出等级结论",
			"个体化用药建议",
		],
	}),
	createGate({
		id: "pre-visit",
		name: "预约前预问诊",
		featureKey: "pre-visit",
		readiness: "待临床审核",
		contractFamily: "clinical-content-write",
		legacyPaths: ["pagesB/health/pre_visit.vue"],
		requiredMaterials: [
			"appointment-context",
			"questionnaire-version",
			"submission-idempotency",
			"clinical-review",
		],
		forbiddenCapabilities: [
			"把预问诊当预约成功",
			"跨预约复用答案",
			"未经审核给出分诊结论",
		],
	}),
	createGate({
		id: "gift-banner",
		name: "电子锦旗",
		featureKey: "gift-banner",
		readiness: "待临床审核",
		contractFamily: "external-content",
		legacyPaths: [
			"pagesB/health/gift_electronic_banner.vue",
			"pagesB/health/list_electronic_banner.vue",
			"pagesB/health/record_electronic_banner.vue",
		],
		requiredMaterials: [
			"content-review",
			"file-security",
			"public-redaction",
			"submission-idempotency",
			"withdrawal",
		],
		forbiddenCapabilities: [
			"直接公开患者正文",
			"上传未校验文件",
			"无撤回展示内容",
		],
	}),
	createGate({
		id: "health-praise",
		name: "表扬信",
		featureKey: "health-praise",
		readiness: "待临床审核",
		contractFamily: "external-content",
		legacyPaths: [
			"pagesB/health/gift_health_praise.vue",
			"pagesB/health/list_health_praise.vue",
			"pagesB/health/record_health_praise.vue",
		],
		requiredMaterials: [
			"content-review",
			"file-security",
			"public-redaction",
			"submission-idempotency",
			"withdrawal",
		],
		forbiddenCapabilities: [
			"直接公开患者正文",
			"把表扬信当医疗证明",
			"无审核发布",
		],
	}),
]);

export const FROZEN_DOMAIN_GATE_COUNT = FROZEN_DOMAIN_GATE_CATALOG.length;
