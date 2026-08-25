/**
 * 已开放低风险业务域的“闭环事实源”。
 *
 * 这不是业务运行时配置，也不代表真实 Provider/真机已经验收；它只把
 * 页面、公网 API、服务实现、领域模型、适配器、日志和文档的落点放在一张
 * 可机器校验的清单里，防止广度迁移时只补了页面却漏掉后端或验收依据。
 * `operationClass` 额外区分纯读取、读模型同步和普通资料读写，避免把
 * 患者目录同步或资料 PUT 误报成高风险业务已经开放。
 */
export const READ_ONLY_DOMAIN_CATALOG = [
	{
		id: "patients",
		name: "就诊人目录",
		operationClass: "read-model-sync",
		pages: ["pages/patient-select/patient-select"],
		publicRoutes: ["POST /api/v2/patients/sync", "GET /api/v2/patients"],
		internalRouteTokens: ["/patients/sync", "/patients"],
		apiModule: "apps/api/src/modules/patients/index.ts",
		serviceFiles: ["apps/api/src/modules/patients/service.ts"],
		domainFiles: ["packages/domain/src/patients.ts"],
		adapterFiles: ["packages/adapters/src/zhongyang-patients.ts"],
		documentation: [
			"docs/migration/patient-context-read-contract.md",
			"docs/release/patient-directory-correctness-audit-2026-08-21.md",
		],
		logEvents: [
			"patient.directory.requested",
			"patient.directory.synced",
			"patient.directory.failed",
			"patient.directory.read.requested",
			"patient.directory.read.loaded",
			"patient.directory.read.failed",
		],
		boundary: "只读 owner-scoped 脱敏目录；新增绑定和实名关系继续关闭。",
	},
	{
		id: "appointments",
		name: "预约目录与预约历史",
		operationClass: "read-only",
		pages: [
			"pages/appointment-directory/appointment-directory",
			"pages/appointment-records/appointment-records",
			"pages/missed-appointments/missed-appointments",
		],
		publicRoutes: [
			"GET /api/v2/appointments/departments",
			"GET /api/v2/appointments/schedules",
			"GET /api/v2/appointments/records",
		],
		internalRouteTokens: [
			"/appointments/departments",
			"/appointments/schedules",
			"/appointments/records",
		],
		apiModule: "apps/api/src/modules/appointments/index.ts",
		serviceFiles: ["apps/api/src/modules/appointments/service.ts"],
		domainFiles: ["packages/domain/src/appointments.ts"],
		adapterFiles: ["packages/adapters/src/zhongyang-appointments.ts"],
		documentation: [
			"docs/release/miniprogram-appointment-directory-readonly-contract-2026-08-19.md",
			"docs/release/miniprogram-appointment-record-readonly-contract-2026-08-19.md",
		],
		logEvents: [
			"appointment.directory.departments.requested",
			"appointment.directory.departments.synced",
			"appointment.directory.departments.failed",
			"appointment.directory.schedules.requested",
			"appointment.directory.schedules.synced",
			"appointment.directory.schedules.failed",
			"appointment.records.requested",
			"appointment.records.synced",
			"appointment.records.failed",
		],
		boundary: "科室、排班和历史只读；锁号、预约写入、取消及 HIS 回写继续关闭。",
	},
	{
		id: "reports",
		name: "检查报告目录与受限详情",
		operationClass: "read-only",
		pages: [
			"pages/report-directory/report-directory",
			"pages/report-detail/report-detail",
		],
		publicRoutes: ["GET /api/v2/reports", "GET /api/v2/reports/{reportId}"],
		internalRouteTokens: ["/reports", "/reports/:reportId"],
		apiModule: "apps/api/src/modules/reports/index.ts",
		serviceFiles: ["apps/api/src/modules/reports/service.ts"],
		domainFiles: ["packages/domain/src/reports.ts"],
		adapterFiles: ["packages/adapters/src/zhongyang-reports.ts"],
		documentation: [
			"docs/migration/report-provider-contract-audit-2026-08-19.md",
			"docs/release/report-readonly-migration-audit-2026-08-22.md",
		],
		logEvents: [
			"report.directory.requested",
			"report.directory.synced",
			"report.directory.failed",
			"report.detail.requested",
			"report.detail.synced",
			"report.detail.failed",
			"report.detail_reference.failed",
		],
		boundary:
			"只开放摘要和白名单 LIS 详情；体检、影像/心电详情、附件下载和解读继续关闭。",
	},
	{
		id: "outpatient-payments",
		name: "门诊费用只读列表",
		operationClass: "read-only",
		pages: ["pages/outpatient-payment/outpatient-payment"],
		publicRoutes: ["GET /api/v2/payments/outpatient/records"],
		internalRouteTokens: ["/payments/outpatient/records"],
		apiModule: "apps/api/src/modules/outpatient-payments/index.ts",
		serviceFiles: ["apps/api/src/modules/outpatient-payments/index.ts"],
		domainFiles: ["packages/domain/src/outpatient-payments.ts"],
		adapterFiles: ["packages/adapters/src/zhongyang-outpatient-payments.ts"],
		documentation: [
			"docs/migration/outpatient-payment-provider-contract-audit-2026-08-19.md",
			"docs/release/outpatient-payment-readonly-audit-2026-08-22.md",
		],
		logEvents: [
			"outpatient.payment.records.requested",
			"outpatient.payment.records.loaded",
			"outpatient.payment.records.failed",
		],
		boundary: "只读费用记录；支付订单、微信调起、医保授权和结算写回继续关闭。",
	},
	{
		id: "user-profile",
		name: "普通个人资料",
		operationClass: "read-write",
		pages: ["pages/profile/profile"],
		publicRoutes: ["GET /api/v2/me/profile", "PUT /api/v2/me/profile"],
		internalRouteTokens: ["/me/profile"],
		apiModule: "apps/api/src/modules/profile/index.ts",
		serviceFiles: ["apps/api/src/modules/profile/service.ts"],
		domainFiles: ["packages/domain/src/user-profile.ts"],
		adapterFiles: [],
		documentation: [
			"docs/migration/user-profile-contract.md",
			"docs/release/current-report-profile-invariant-audit-2026-08-24.md",
		],
		logEvents: [
			"user.profile.requested",
			"user.profile.loaded",
			"user.profile.read_failed",
			// 普通资料标记为 read-write 后，更新链路也必须进入同一份闭环
			// 清单；否则 readiness 只证明 GET 存在，无法发现 PUT 的日志
			// 文档或运行实现被遗漏。事件本身仍由 profile service 负责，
			// 这里不把用户资料正文、userId 或版本值加入审计清单。
			"user.profile.update.requested",
			"user.profile.updated",
			"user.profile.conflict",
			"user.profile.update_failed",
		],
		boundary:
			"只读普通展示资料；实名、微信身份、患者身份和头像资源不混入该契约。",
	},
];
