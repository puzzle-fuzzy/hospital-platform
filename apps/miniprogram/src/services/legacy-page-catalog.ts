import { FEATURE_STATUS_CATALOG, type FeatureKey } from "./feature-navigation";

/**
 * 旧端页面迁移状态的机器可读枚举。
 *
 * 这里的 `partial` 只表示新端已经有安全的只读或静态子集，绝不等价于
 * 旧页面的全部功能已经完成；`blocked-*` 则表示入口已经有稳定状态页，
 * 但因为外部协议、临床审核或支付回写尚未确认，不能继续猜测实现。
 * `surface-only` 表示页面外壳和关闭态已经迁移，但真实业务读取仍未开放；
 * 它是入口覆盖阶段，不得计入 `replaced`。
 */
export type LegacyPageMigrationStatus =
	| "replaced"
	| "partial"
	| "blocked-provider"
	| "blocked-clinical"
	| "blocked-external"
	| "partial"
	| "blocked-patient-contract"
	| "partial"
	| "surface-only"
	| "excluded";

export type LegacyPageMigration = {
	/** 旧仓库相对 `hospital-app/src` 的真实页面路径。 */
	legacyPath: string;
	/** 旧页面所属业务域，用于后续按域批量推进。 */
	domain: "首页" | "就诊" | "互联网医院" | "预约" | "患者" | "健康" | "用户";
	status: LegacyPageMigrationStatus;
	/** 新端最终落点；状态页和真实页面都必须是 app.json 中的已注册页面。 */
	nativeTarget: string | null;
	/**
	 * 入口准入目录 key。阻塞页面用它进入统一状态页；已经迁移安全只读
	 * 子集的页面也可以保留它，用于连接未来 contract 和迁移覆盖视图。
	 */
	featureKey?: FeatureKey;
	/** 迁移边界，供测试和新会话快速判断，不当作用户文案。 */
	note: string;
};

/**
 * 旧端 64 个页面的逐页落点台账。
 *
 * 这份清单故意把“静态/只读子集”和“真实业务完成”分开：它解决的是
 * 全量入口不遗漏和后续接入有明确替换位置，而不是用一个占位页虚构
 * Provider、HIS、医保或支付能力。新增正式页面时，先替换对应记录的
 * `nativeTarget/status`，再删除相应的 feature-status 分支。
 */
export const LEGACY_PAGE_MIGRATION_CATALOG: ReadonlyArray<LegacyPageMigration> =
	[
		{
			legacyPath: "pages/consult/consult.vue",
			domain: "就诊",
			status: "partial",
			nativeTarget: "pages/consult/consult",
			note: "已迁移患者上下文、未来/历史预约只读摘要和三标签状态壳；实时队列与 WebSocket 待 contract。",
		},
		{
			legacyPath: "pages/hospital/hospital.vue",
			domain: "互联网医院",
			status: "partial",
			nativeTarget: "pages/hospital/hospital",
			note: "已按旧端行为恢复固定 HTTPS WebView；只允许既定互联网医院地址，不接受任意 URL、不转交平台 token，也不复用通用 ticket。",
		},
		{
			legacyPath: "pages/index/index.vue",
			domain: "首页",
			status: "replaced",
			nativeTarget: "pages/index/index",
			note: "已由原生首页、患者读模型和服务入口替换。",
		},
		{
			legacyPath: "pages/setting/setData.vue",
			domain: "首页",
			status: "excluded",
			nativeTarget: null,
			note: "旧端开发辅助页，不进入生产小程序。",
		},
		{
			legacyPath: "pages/user/user.vue",
			domain: "用户",
			status: "partial",
			nativeTarget: "pages/my/my",
			note: "已拆为我的、个人资料、患者选择和挂号记录等安全子集。",
		},
		{
			legacyPath: "pagesB/account/follow.vue",
			domain: "用户",
			status: "replaced",
			nativeTarget: "pages/official-account/official-account",
			note: "已迁移静态公众号说明；关注状态、二维码和订阅仍关闭。",
		},
		{
			legacyPath: "pagesB/health/admission_preconsultation.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/admission-preconsultation/admission-preconsultation",
			featureKey: "admission-preconsultation",
			note: "已迁移入院预问诊原生页面外壳和患者入口；版本化问卷、授权、幂等提交和医护读取规则仍关闭。",
		},
		{
			legacyPath: "pagesB/health/blood_pressure_calc.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-test/health-test",
			featureKey: "health-test",
			note: "已迁移不带临床分级的血压读数校验和展示；旧端血压阈值、参考均值和风险结论不迁移，等待临床规则确认。",
		},
		{
			legacyPath: "pagesB/health/bmi_calc.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-test/health-test",
			featureKey: "health-test",
			note: "已迁移 BMI 公式数值计算；旧端人群分类、风险解释和参考表不迁移，等待临床规则确认。",
		},
		{
			legacyPath: "pagesB/health/discharge_followup_detail.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/discharge-followup/discharge-followup",
			featureKey: "discharge-followup",
			note: "已迁移出院随访原生页面外壳和患者入口；出院事件、随访任务、答案版本和撤回规则仍关闭。",
		},
		{
			legacyPath: "pagesB/health/discharge_followup.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/discharge-followup/discharge-followup",
			featureKey: "discharge-followup",
			note: "已迁移出院随访统一原生外壳；不能按旧 user_id/pat_id 覆盖不同随访任务，真实任务 contract 仍关闭。",
		},
		{
			legacyPath: "pagesB/health/disease_detail.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-knowledge-detail/health-knowledge-detail",
			note: "已迁移审核内容详情只读页面；真实 bundle 发布、临床审核和下线审计仍关闭。",
		},
		{
			legacyPath: "pagesB/health/drug_detail.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-knowledge-detail/health-knowledge-detail",
			note: "已迁移审核内容药品详情只读页面；不构成处方或个体化用药建议。",
		},
		{
			legacyPath: "pagesB/health/electronic_bill.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "electronic-bill",
			note: "等待账单资源授权、金额单位和短期文件访问 contract。",
		},
		{
			legacyPath: "pagesB/health/electronic_consultation.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/electronic-consultation/electronic-consultation",
			featureKey: "electronic-consultation",
			note: "已迁移电子导诊单页面外壳、患者选择入口和关闭态；真实来源、患者上下文和读写权限仍待 contract。",
		},
		{
			legacyPath: "pagesB/health/electronic_record.vue",
			domain: "健康",
			status: "blocked-provider",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "medical-record",
			note: "旧端只能证明存在门诊记录调用线索；尚无正式 Provider 请求/响应、患者映射和字段白名单，因此统一进入状态页，不读取预约或报告数据冒充病历。",
		},
		{
			legacyPath: "pagesB/health/gift_electronic_banner.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/gift-banner/gift-banner",
			featureKey: "gift-banner",
			note: "已迁移电子锦旗原生列表/记录空态、当前就诊人和患者入口；内容审核、文件安全、脱敏公开和撤回规则仍关闭。",
		},
		{
			legacyPath: "pagesB/health/gift_health_praise.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-praise/health-praise",
			featureKey: "health-praise",
			note: "已迁移表扬信原生列表/记录空态、当前就诊人和患者入口；内容审核、文件安全、脱敏展示和幂等仍关闭。",
		},
		{
			legacyPath: "pagesB/health/health_encyclopedia.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-encyclopedia/health-encyclopedia",
			// 该页面已经有审核内容只读实现，必须接入统一状态目录，
			// 否则会被错误归类为“新端新增入口”。
			featureKey: "health-encyclopedia",
			note: "已迁移症状/疾病目录只读页面；无审核发布 bundle 时由服务端和页面共同关闭。",
		},
		{
			legacyPath: "pagesB/health/health_test.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-test/health-test",
			featureKey: "health-test",
			note: "已迁移健康自测统一原生外壳；题库版本、评分规则、免责声明和结果保留策略仍关闭。",
		},
		{
			legacyPath: "pagesB/health/inpatient_center.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/inpatient-center/inpatient-center",
			featureKey: "inpatient-center",
			note: "已迁移住院信息页面外壳、独立 episode 提示和关闭态；不复用门诊 patientId，真实住院标识仍待 contract。",
		},
		{
			legacyPath: "pagesB/health/inpatient_payment.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "inpatient-payment",
			note: "等待住院账单、支付状态机、查单和 HIS 回写。",
		},
		{
			legacyPath: "pagesB/health/list_electronic_banner.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/gift-banner/gift-banner",
			featureKey: "gift-banner",
			note: "已迁移电子锦旗列表原生空态；列表必须基于审核后的公开视图，不能直接展示旧快照。",
		},
		{
			legacyPath: "pagesB/health/list_health_praise.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-praise/health-praise",
			featureKey: "health-praise",
			note: "已迁移表扬信列表原生空态；列表必须基于审核后的公开视图，不能直读旧表。",
		},
		{
			legacyPath: "pagesB/health/medical_insurance_pay.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "insurance",
			note: "医保授权、FSI 查单、回调和 HIS 回写最后处理。",
		},
		{
			legacyPath: "pagesB/health/outpatient_pay_detail.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/outpatient-payment-detail/outpatient-payment-detail",
			featureKey: "outpatient-payment-detail",
			note: "已迁移 owner/patient 作用域的已核对费用摘要详情；项目级明细、支付和电子票据继续关闭。",
		},
		{
			legacyPath: "pagesB/health/outpatient_pay.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/outpatient-payment/outpatient-payment",
			featureKey: "outpatient-payment-write",
			note: "已迁移门诊费用只读列表；支付、医保、结算和退费未开放。",
		},
		{
			legacyPath: "pagesB/health/payment_cashier.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "cashier",
			note: "不恢复旧端 web-view 收银台或任意外部 URL。",
		},
		{
			legacyPath: "pagesB/health/pre_visit.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/pre-visit/pre-visit",
			featureKey: "pre-visit",
			note: "已迁移预约前预问诊原生页面外壳和患者入口；问卷版本、预约关系、授权、幂等和医护读取仍关闭。",
		},
		{
			legacyPath: "pagesB/health/record_electronic_banner.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/gift-banner/gift-banner",
			featureKey: "gift-banner",
			note: "已迁移电子锦旗详情原生关闭态；详情仅能读取审核后的公开记录，不能复用旧端患者快照。",
		},
		{
			legacyPath: "pagesB/health/record_health_praise.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-praise/health-praise",
			featureKey: "health-praise",
			note: "已迁移表扬信详情原生关闭态；详情仅能读取审核后的公开记录，不能复用旧端患者快照。",
		},
		{
			legacyPath: "pagesB/health/report_detail.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/report-detail/report-detail",
			// 详情页已有 LIS 安全只读子集；未接入的影像、心电和附件能力
			// 仍由同一个 feature 状态边界明确关闭。
			featureKey: "report-detail",
			note: "已建立 owner/patient/TTL 引用骨架；真实详情与附件仍待 provider。",
		},
		{
			legacyPath: "pagesB/health/report_query.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/report-directory/report-directory",
			note: "已迁移有限日期窗口报告目录；PEIS/PACS/ECG 详情仍分开。",
		},
		{
			legacyPath: "pagesB/health/risk_form_fall.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/risk-evaluation/risk-evaluation",
			featureKey: "risk-evaluation",
			note: "已迁移风险评估原生外壳；跌倒风险题目、评分阈值、适用人群和免责声明仍关闭。",
		},
		{
			legacyPath: "pagesB/health/risk_form_pain.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/risk-evaluation/risk-evaluation",
			featureKey: "risk-evaluation",
			note: "已迁移风险评估原生外壳；疼痛风险题目、评分阈值、适用人群和免责声明仍关闭。",
		},
		{
			legacyPath: "pagesB/health/risk_form_pressure.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/risk-evaluation/risk-evaluation",
			featureKey: "risk-evaluation",
			note: "已迁移风险评估原生外壳；压力风险题目、评分阈值、适用人群和免责声明仍关闭。",
		},
		{
			legacyPath: "pagesB/health/risk_self_evaluation.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/risk-evaluation/risk-evaluation",
			featureKey: "risk-evaluation",
			note: "已迁移风险评估原生外壳和患者入口；题库版本、评分算法、结果授权和临床复核仍关闭。",
		},
		{
			legacyPath: "pagesB/health/search_result.vue",
			domain: "健康",
			status: "partial",
			nativeTarget: "pages/health-knowledge-search/health-knowledge-search",
			note: "已迁移症状关联疾病只读结果；查询仅使用审核 bundle，搜索索引和内容发布仍受版本闸门控制。",
		},
		{
			legacyPath: "pagesB/health/self_test_question.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-test/health-test",
			featureKey: "health-test",
			note: "已迁移健康自测题目原生外壳；不可变题库版本、答案校验和临床审核仍关闭。",
		},
		{
			legacyPath: "pagesB/health/self_test_result.vue",
			domain: "健康",
			status: "surface-only",
			nativeTarget: "pages/health-test/health-test",
			featureKey: "health-test",
			note: "已迁移健康自测结果原生外壳；评分结果、解释文案、免责声明和撤回策略仍关闭。",
		},
		{
			legacyPath: "pagesB/health/webview.vue",
			domain: "互联网医院",
			status: "partial",
			nativeTarget: "pages/smart-customer/smart-customer",
			featureKey: "smart-customer",
			note: "已按旧端默认行为恢复固定 HTTPS 智能客服 WebView；不恢复同一通用页面承载的任意 URL、智能导诊、患者绑定/解绑或旧 ticket 链路。",
		},
		{
			legacyPath: "pagesB/hospital/bloodAppointment.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/blood-appointment/blood-appointment",
			featureKey: "blood-appointment",
			note: "已按旧端真实行为迁移当前就诊人、院区位置和无可预约项目空态；这部分安全子集已完成，采血号源、预约写入、取消和最终状态查询仍关闭。",
		},
		{
			legacyPath: "pagesB/hospital/confirm_registration.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/confirm-registration/confirm-registration",
			featureKey: "appointment-write",
			note: "确认信息页已迁移：展示排班/号别/序号/时段与当前就诊人脱敏上下文，须知为重写的通用文案；锁号、费用报价、执行预约、支付前置和 HIS 回写仍关闭，提交进入统一关闭态。",
		},
		{
			legacyPath: "pagesB/hospital/department_select.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/appointment-schedule/appointment-schedule",
			note: "三级细分门诊已进入独立的按医生/按日期号源页；医生名片字段和号源详情可读，号源写入仍关闭。",
		},
		{
			legacyPath: "pagesB/hospital/doctor_card.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/my-doctor-detail/my-doctor-detail",
			note: "医生名片、关注/取消关注、未来七天排班和有余号时段入口已迁移；预约写入仍统一进入现有确认页边界。",
		},
		{
			legacyPath: "pagesB/hospital/hospitalList.vue",
			domain: "预约",
			status: "replaced",
			nativeTarget: "pages/hospital-list/hospital-list",
			note: "已迁移单院区静态卡片和安全预约前置。",
		},
		{
			legacyPath: "pagesB/hospital/navigation.vue",
			domain: "预约",
			status: "replaced",
			nativeTarget: "pages/hospital-navigation/hospital-navigation",
			note: "已迁移静态地图和预览，不伪造实时路线。",
		},
		{
			legacyPath: "pagesB/hospital/registration_detail.vue",
			domain: "预约",
			status: "replaced",
			nativeTarget: "pages/appointment-detail/appointment-detail",
			featureKey: "appointment-detail",
			note: "已迁移挂号详情、患者脱敏信息、预约状态、金额和 owner-scoped 取消预约；Provider 历史记录无平台引用时仅展示安全摘要。",
		},
		{
			legacyPath: "pagesB/hospital/registration_medical_pay.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "insurance",
			note: "挂号医保支付与门诊缴费支付分开建模，最后处理。",
		},
		{
			legacyPath: "pagesB/hospital/registration.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/appointment-directory/appointment-directory",
			note: "已迁移预约目录只读；锁号、登记、支付和取消未开放。",
		},
		{
			legacyPath: "pagesB/hospital/selectPatient.vue",
			domain: "患者",
			status: "replaced",
			nativeTarget: "pages/patient-select/patient-select",
			note: "已由统一原生就诊人选择页替换。",
		},
		{
			legacyPath: "pagesB/hospital/timeslot_source.vue",
			domain: "预约",
			status: "partial",
			nativeTarget: "pages/timeslot-source/timeslot-source",
			note: "分时段号源只读页已迁移：按短期 scheduleId 读取服务端白名单号源并进入确认页；不展示费用、不携带 provider sourceId，锁号与写入前确认未开放。",
		},
		{
			legacyPath: "pagesB/patient/agreement.vue",
			domain: "患者",
			status: "replaced",
			nativeTarget: "pages/patient-agreement/patient-agreement",
			featureKey: "patient-agreement",
			note: "已迁移为原文只读页；协议版本、同意记录、撤回和审计仍未开放。",
		},
		{
			legacyPath: "pagesB/patient/doctor.vue",
			domain: "患者",
			status: "replaced",
			nativeTarget: "pages/my-doctor/my-doctor",
			featureKey: "doctor",
			note: "已由平台用户级我的医生列表、医生名片、关注/取消关注和排班入口替换；关系按当前 Bearer owner 隔离。",
		},
		{
			legacyPath: "pagesB/patient/express.vue",
			domain: "患者",
			status: "partial",
			nativeTarget: "pages/patient-express/patient-express",
			featureKey: "patient-express",
			note: "旧端实际只有患者选择和预留空列表，已迁移为 owner-scoped 原生患者卡片和空态；真实物流来源、患者归属和状态字段仍待 provider contract。",
		},
		{
			legacyPath: "pagesB/patient/patient_signature.vue",
			domain: "患者",
			status: "partial",
			nativeTarget: "pages/patient-signature/patient-signature",
			featureKey: "patient-signature",
			note: "已迁移 owner-scoped 脱敏患者列表、选中态、协议入口和关闭说明；不复用旧端假患者列表或硬编码外部小程序，真实签名 contract 仍待确认。",
		},
		{
			legacyPath: "pagesB/patient/patientAdd.vue",
			domain: "患者",
			status: "surface-only",
			nativeTarget: "pages/patient-binding/patient-binding",
			featureKey: "patient-binding",
			note: "已迁移添加就诊人页面外壳和关闭态；旧端查档异常继续建档、无幂等和最终确认等行为不原样迁移。",
		},
		{
			legacyPath: "pagesB/patient/patientChange.vue",
			domain: "患者",
			status: "replaced",
			nativeTarget: "pages/patient-select/patient-select",
			note: "已由 owner-scoped 目录和显式选择替换。",
		},
		{
			legacyPath: "pagesB/user/edit_profile.vue",
			domain: "用户",
			status: "partial",
			nativeTarget: "pages/profile/profile",
			note: "已迁移普通资料子集；头像、实名和手机号保持独立边界。",
		},
		{
			legacyPath: "pagesB/user/feedback.vue",
			domain: "用户",
			status: "replaced",
			nativeTarget: "pages/feedback/feedback",
			note: "已迁移旧端实际存在的静态帮助和客服电话行为。",
		},
		{
			legacyPath: "pagesB/user/miss_appointment.vue",
			domain: "用户",
			status: "partial",
			nativeTarget: "pages/missed-appointments/missed-appointments",
			note: "已由预约历史 status=missed 派生只读页替换，待真实四方证据。",
		},
		{
			legacyPath: "pagesB/user/my_consultation.vue",
			domain: "用户",
			status: "blocked-external",
			nativeTarget: "pages/feature-status/feature-status",
			featureKey: "consultation",
			note: "旧端实际调用独立的治疗陪诊历史入口，不是预约历史；外部主体、受众、短期会话、回跳和退出 contract 未确认，因此不把预约记录改名为问诊。",
		},
		{
			legacyPath: "pagesB/user/my_registration.vue",
			domain: "用户",
			status: "partial",
			nativeTarget: "pages/appointment-records/appointment-records",
			note: "已迁移在线/全部预约历史只读；本地平台预约支持详情和 owner-scoped 取消，Provider 历史摘要不提供写操作，支付仍由 miniprogram-pay 处理。",
		},
		{
			legacyPath: "pagesB/user/subscription_message.vue",
			domain: "用户",
			status: "partial",
			nativeTarget: "pages/patient-subscription/patient-subscription",
			featureKey: "patient-subscription",
			note: "已迁移消息订阅的搜索、分类折叠、当前就诊人和只读开关展示；旧端本地开关不是微信订阅授权，完整发送链路仍关闭。",
		},
	] as const;

/** 供审计和测试使用的旧页面总数，避免以后新增页面时静默漏登记。 */
export const LEGACY_PAGE_COUNT = 64;

/**
 * 旧页面按业务域聚合后的迁移摘要。
 *
 * 这里不是产品统计报表，而是“广度优先”阶段的工程护栏：每个旧业务域都
 * 必须有明确总量和状态分布，后续新增页面时如果只补了逐页台账、没有同步
 * 业务域摘要，测试就会失败。`blocked-*` 仍代表稳定状态页，不代表业务完成。
 */
export type LegacyPageDomainSummary = {
	domain: LegacyPageMigration["domain"];
	total: number;
	byStatus: Readonly<Partial<Record<LegacyPageMigrationStatus, number>>>;
};

const LEGACY_PAGE_DOMAINS: ReadonlyArray<LegacyPageMigration["domain"]> = [
	"首页",
	"就诊",
	"互联网医院",
	"预约",
	"患者",
	"健康",
	"用户",
];

/**
 * 从逐页事实清单派生业务域摘要，禁止手工维护第二份容易漂移的计数。
 */
export const LEGACY_PAGE_DOMAIN_SUMMARY: ReadonlyArray<LegacyPageDomainSummary> =
	LEGACY_PAGE_DOMAINS.map((domain) => {
		const byStatus: Partial<Record<LegacyPageMigrationStatus, number>> = {};
		for (const entry of LEGACY_PAGE_MIGRATION_CATALOG) {
			if (entry.domain !== domain) continue;
			byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1;
		}
		return Object.freeze({
			domain,
			total: Object.values(byStatus).reduce(
				(total, count) => total + (count ?? 0),
				0,
			),
			byStatus: Object.freeze(byStatus),
		});
	});

/** 仅暴露状态页目录中确实存在的 feature key，避免拼接任意 query。 */
export function isKnownLegacyFeatureKey(
	value: FeatureKey | undefined,
): value is FeatureKey {
	return value !== undefined && Object.hasOwn(FEATURE_STATUS_CATALOG, value);
}
