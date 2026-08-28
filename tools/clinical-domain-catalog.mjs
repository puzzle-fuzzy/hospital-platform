/**
 * 临床只读四域的独立准入目录。
 *
 * 这里描述的是“尚未注册时必须保持的边界”，不是运行时业务配置。
 * 门诊记录、住院、医生关系和问诊/电子导诊的 Provider 身份、患者映射、
 * 权限和保留周期不同，不能因为它们都从“我的”入口进入就共用一个接口。
 */
export const CLINICAL_DOMAIN_CATALOG = Object.freeze([
	{
		id: "outpatient-records",
		name: "门诊就诊记录",
		expectedReadiness: "待 provider contract",
		legacyEntries: [
			{
				path: "pagesB/health/electronic_record.vue",
				featureKey: "medical-record",
				status: "blocked-provider",
			},
		],
		documents: [
			"docs/provider-intake/clinical-read-models-2026-08-25.md",
			"docs/migration/medical-record-directory-contract-draft.md",
			"docs/migration/medical-record-and-hospital-boundary.md",
		],
		requiredMarkers: ["out-visit-records", "patId", "字段白名单", "未注册"],
		forbiddenApiTokens: ["/out-visit-records", "/out-emrs", "/medical-records"],
	},
	{
		id: "inpatient",
		name: "住院信息",
		expectedReadiness: "待 provider contract",
		legacyEntries: [
			{
				path: "pagesB/health/inpatient_center.vue",
				featureKey: "inpatient-center",
				status: "blocked-provider",
				surfaceOnlyTarget: "pages/inpatient-center/inpatient-center",
			},
		],
		documents: [
			"docs/provider-intake/clinical-read-models-2026-08-25.md",
			"docs/migration/clinical-domain-batch-contract-gates-2026-08-25.md",
			"docs/migration/medical-record-and-hospital-boundary.md",
		],
		requiredMarkers: ["episode", "patInHosId", "住院患者标识", "未注册"],
		forbiddenApiTokens: [
			"/inpatient",
			"/inpatient-records",
			"/hospitalization",
		],
	},
	{
		id: "doctor-relationship",
		name: "我的医生",
		expectedReadiness: "待 provider contract",
		legacyEntries: [
			{
				path: "pagesB/patient/doctor.vue",
				featureKey: "doctor",
				status: "blocked-provider",
				surfaceOnlyTarget: "pages/my-doctor/my-doctor",
			},
		],
		documents: [
			"docs/provider-intake/clinical-read-models-2026-08-25.md",
			"docs/migration/clinical-domain-batch-contract-gates-2026-08-25.md",
			"docs/migration/convenience-service-boundaries.md",
		],
		requiredMarkers: ["my_doctor", "展示白名单", "医生关系", "未注册"],
		forbiddenApiTokens: ["/doctors", "/doctor-relationships", "/my-doctor"],
	},
	{
		id: "consultation",
		name: "问诊与电子导诊",
		expectedReadiness: "待外部入口 contract",
		legacyEntries: [
			{
				path: "pagesB/user/my_consultation.vue",
				featureKey: "consultation",
				status: "blocked-external",
				readiness: "待外部入口 contract",
			},
			{
				path: "pagesB/health/electronic_consultation.vue",
				featureKey: "electronic-consultation",
				status: "blocked-provider",
				readiness: "待 provider contract",
				surfaceOnlyTarget:
					"pages/electronic-consultation/electronic-consultation",
			},
		],
		documents: [
			"docs/provider-intake/clinical-read-models-2026-08-25.md",
			"docs/migration/electronic-consultation-contract-draft.md",
			"docs/migration/consult-and-internet-hospital-boundary-audit-2026-08-25.md",
		],
		requiredMarkers: ["回跳", "短期", "WebView", "未注册"],
		forbiddenApiTokens: [
			"/consultations",
			"/electronic-consultation",
			"/consult",
		],
	},
]);
