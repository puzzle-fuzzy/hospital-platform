/**
 * 旧端仍可见、但新端尚未具备正式业务 contract 的入口目录。
 *
 * 这里的作用是先把迁移期间的导航闭环建立起来：用户点击任意可见入口
 * 都能看到稳定、可解释的状态页，而不是无响应或进入不存在的页面。状态
 * 页只表达迁移边界，不会把 Toast、本地缓存或静态页面伪装成真实业务成功。
 */
export type FeatureKey =
	| "admission-preconsultation"
	| "appointment-detail"
	| "appointment-write"
	| "blood-appointment"
	| "cashier"
	| "companion"
	| "consultation"
	| "discharge-followup"
	| "doctor"
	| "doctor-directory"
	| "electronic-consultation"
	| "electronic-bill"
	| "patient-express"
	| "patient-agreement"
	| "patient-address"
	| "patient-qr"
	| "patient-signature"
	| "patient-subscription"
	| "gift-banner"
	| "guide"
	| "health-encyclopedia"
	| "health-praise"
	| "health-test"
	| "inpatient-center"
	| "inpatient-payment"
	| "insurance"
	| "medical-record"
	| "outpatient-payment-detail"
	| "outpatient-payment-write"
	| "patient-binding"
	| "pre-visit"
	| "report-cloud-image"
	| "report-detail"
	| "report-peis"
	| "report-follow-up"
	| "report-share"
	| "risk-evaluation"
	| "smart-customer";

export type FeatureStatus = {
	/** 页面标题使用旧端用户熟悉的业务名称。 */
	title: string;
	/**
	 * 迁移阻塞类型不是装饰文案，而是当前业务准入的机器可读边界。
	 * 页面可以据此告诉用户“为什么暂未开放”，后续 contract 完成时也能
	 * 按域批量替换，不会把医疗审核、支付回写和普通 provider 读取混成一类。
	 */
	readiness:
		| "待 provider contract"
		| "待临床审核"
		| "待支付与回写 contract"
		| "待患者绑定 contract"
		| "待外部入口 contract"
		| "入口校验失败";
	/** 明确告诉用户当前为什么不能继续，避免“系统坏了”的误解。 */
	description: string;
	/** 说明后续需要哪一类真实 contract，便于产品和后端继续接入。 */
	contractHint: string;
	icon: string;
};

/**
 * 面向普通用户的功能状态文案。
 *
 * `FeatureStatus.readiness` 是迁移和发布门禁使用的内部分类，不能直接
 * 出现在小程序页面里。这里把同一分类转换成用户能理解的“正在准备什么”
 * 和“当前会发生什么”，避免所有入口都只显示模糊的“服务不可用”。
 */
export type FeatureUserFacingCopy = {
	badge: string;
	description: string;
	progress: string;
};

/** 将内部迁移分类投影为安全、稳定、可读的页面文案。 */
export function getFeatureUserFacingCopy(
	feature: FeatureStatus,
): FeatureUserFacingCopy {
	switch (feature.readiness) {
		case "待 provider contract":
			return {
				badge: "数据服务接入中",
				description: `${feature.title}正在接入医院数据服务，当前暂时无法查询。`,
				progress: "我们正在完成数据来源、权限和安全检查，开放后会及时更新。",
			};
		case "待临床审核":
			return {
				badge: "专业内容审核中",
				description: `${feature.title}的内容正在完成专业审核，当前暂时无法使用。`,
				progress:
					"我们正在完成内容版本、适用范围和安全检查，开放后会及时更新。",
			};
		case "待支付与回写 contract":
			return {
				badge: "支付服务准备中",
				description: `${feature.title}涉及支付或结算，当前暂时无法使用。`,
				progress: "我们正在完成订单、支付结果和结算核对，开放后会及时更新。",
			};
		case "待患者绑定 contract":
			return {
				badge: "就诊人服务完善中",
				description: `${feature.title}需要完善就诊人服务，当前暂时无法使用。`,
				progress: "我们正在完成就诊人信息和授权流程检查，开放后会及时更新。",
			};
		case "待外部入口 contract":
			return {
				badge: "安全配置中",
				description: `${feature.title}正在完成安全配置，当前暂时无法使用。`,
				progress:
					"我们正在完成访问范围、登录隔离和返回流程检查，开放后会及时更新。",
			};
		case "入口校验失败":
			return {
				badge: "入口无效",
				description: "该服务入口无效，请返回首页后重新选择服务。",
				progress: "当前不会读取旧缓存或发起业务请求，请从首页重新进入。",
			};
	}
}

/**
 * 所有未完成入口共用一份状态目录，避免首页、“我的”和状态页出现互相
 * 矛盾的文案。新增真实业务页面时，应先从这里移除对应 key，再删除旧入口
 * 的迁移状态分支，确保迁移矩阵、导航和页面实现同步收敛。
 */
export const FEATURE_STATUS_CATALOG: Readonly<
	Record<FeatureKey, FeatureStatus>
> = Object.freeze({
	"admission-preconsultation": {
		title: "入院预问诊",
		readiness: "待临床审核",
		description: "问卷版本和提交接口正在迁移中，当前不会提交医疗问诊数据。",
		contractHint: "等待版本化问卷、患者授权、幂等提交和医护端读取规则确认。",
		icon: "/assets/legacy-home/service-admission.svg",
	},
	"appointment-detail": {
		title: "挂号详情",
		readiness: "待 provider contract",
		description: "挂号详情正在迁移中，当前不会展示未经引用校验的预约明细。",
		contractHint: "等待挂号详情引用、患者归属、状态映射和敏感字段白名单确认。",
		icon: "/assets/legacy-user/appointment-status.svg",
	},
	"appointment-write": {
		title: "预约下单",
		readiness: "待支付与回写 contract",
		description: "预约下单正在迁移中，当前不会锁号、创建预约或发起支付。",
		contractHint: "等待锁号、幂等、取消、费用、支付前置和 HIS 回写规则确认。",
		icon: "/assets/legacy-home/service-registration.svg",
	},
	"blood-appointment": {
		title: "采血预约",
		readiness: "待 provider contract",
		description: "采血预约正在迁移中，当前不会读取号源或提交预约。",
		contractHint: "等待采血号源、患者映射、预约写入、取消和最终状态查询确认。",
		icon: "/assets/legacy-home/service-registration.svg",
	},
	cashier: {
		title: "支付收银台",
		readiness: "待支付与回写 contract",
		description: "收银台正在迁移中，当前不会打开旧端 WebView 或任意外部地址。",
		contractHint:
			"等待 HTTPS allowlist、订单 owner、回调、查单和失败回退规则确认。",
		icon: "/assets/legacy-home/top-payment.svg",
	},
	companion: {
		title: "陪诊服务",
		readiness: "待外部入口 contract",
		description: "陪诊入口正在迁移中，当前不会创建或读取陪诊会话。",
		contractHint: "等待会话归属、内容保留、患者授权和审计规则确认。",
		icon: "/assets/legacy-home/right-guide.png",
	},
	consultation: {
		title: "我的问诊",
		readiness: "待 provider contract",
		description:
			"旧端问诊历史当前包含演示数据，真实来源正在核对中；新端不会复制演示记录或创建问诊会话。",
		contractHint:
			"需要确认真实问诊/陪诊来源、患者归属、内容脱敏、会话生命周期和保留周期。",
		icon: "/assets/legacy-user/consultation.svg",
	},
	"discharge-followup": {
		title: "出院随访",
		readiness: "待临床审核",
		description: "随访任务正在迁移中，当前不会提交或覆盖随访答案。",
		contractHint: "等待出院事件、任务版本、提交幂等和撤回规则确认。",
		icon: "/assets/legacy-home/service-followup.svg",
	},
	doctor: {
		title: "我的医生",
		readiness: "待 provider contract",
		description: "医生关系数据正在迁移中，当前不会展示未经授权的医生信息。",
		contractHint: "等待医生关系来源、患者归属、展示白名单和失效规则确认。",
		icon: "/assets/legacy-user/doctor.svg",
	},
	"doctor-directory": {
		title: "医生目录",
		readiness: "待 provider contract",
		description: "医生目录正在迁移中，当前不会展示未经审核的医生快照。",
		contractHint: "等待科室/医生目录来源、字段白名单、更新时间和失效规则确认。",
		icon: "/assets/legacy-user/doctor.svg",
	},
	"electronic-consultation": {
		title: "电子导诊单",
		readiness: "待 provider contract",
		description: "电子导诊单正在迁移中，当前不会读取旧缓存或生成虚假的导诊单。",
		contractHint: "等待导诊单来源、患者上下文和读写权限确认。",
		icon: "/assets/legacy-user/electronic-consultation.svg",
	},
	"electronic-bill": {
		title: "电子账单",
		readiness: "待支付与回写 contract",
		description: "电子账单正在迁移中，当前不会展示未经引用校验的账单文件。",
		contractHint:
			"等待账单资源授权、金额单位、患者归属、短期链接和过期规则确认。",
		icon: "/assets/legacy-home/top-payment.svg",
	},
	"patient-agreement": {
		title: "就诊人协议",
		readiness: "待患者绑定 contract",
		description: "协议原文已可查看；当前不会接受未确认版本的实名或授权操作。",
		contractHint:
			"阅读页已迁移，仍等待协议版本、展示主体、用户同意记录、撤回和审计规则确认。",
		icon: "/assets/legacy-home/service-patient.svg",
	},
	"patient-address": {
		title: "就诊人联系地址",
		readiness: "待患者绑定 contract",
		description:
			"联系地址正在迁移中，当前不会保存或展示未经归属校验的地址信息。",
		contractHint:
			"等待字段白名单、owner/患者归属、版本并发、脱敏和删除规则确认。",
		icon: "/assets/legacy-home/service-patient.svg",
	},
	"patient-express": {
		title: "我的快递",
		readiness: "待 provider contract",
		description:
			"快递记录正在迁移中，当前不会使用旧端空列表或未经归属校验的物流信息。",
		contractHint:
			"等待快递来源、患者归属、物流字段白名单、状态映射和查询失败语义确认。",
		icon: "/assets/legacy-home/service-patient.svg",
	},
	"patient-qr": {
		title: "就诊二维码",
		readiness: "待患者绑定 contract",
		description:
			"就诊二维码正在迁移中，当前不会把卡号或临床患者标识交给第三方生成图片。",
		contractHint:
			"等待医院扫码字段、签名、有效期、受众、防重放和撤销规则确认。",
		icon: "/assets/legacy-home/patient-qr.svg",
	},
	"patient-signature": {
		title: "就诊人签名",
		readiness: "待患者绑定 contract",
		description: "患者签名正在迁移中，当前不会上传或复用旧端签名文件。",
		contractHint:
			"等待签名用途、文件安全、授权确认、撤回和医护侧审计规则确认。",
		icon: "/assets/legacy-home/service-patient.svg",
	},
	"patient-subscription": {
		title: "消息订阅",
		readiness: "待外部入口 contract",
		description:
			"消息订阅正在迁移中，当前不会把本地开关当作微信授权或发送成功。",
		contractHint: "等待模板 ID、授权时机、业务事件、发送结果和撤销状态确认。",
		icon: "/assets/legacy-user/insurance.svg",
	},
	"gift-banner": {
		title: "电子锦旗",
		readiness: "待临床审核",
		description: "电子锦旗正在迁移中，当前不会提交患者或医护快照。",
		contractHint: "等待内容审核、文件安全、脱敏公开展示和撤回规则确认。",
		icon: "/assets/legacy-home/service-banner.svg",
	},
	guide: {
		title: "智能导诊",
		readiness: "待外部入口 contract",
		description: "智能导诊正在迁移中，当前不会返回未经版本管理的医疗建议。",
		contractHint: "等待模型/知识版本、免责声明、会话审计和风险分流规则确认。",
		icon: "/assets/legacy-home/right-guide.png",
	},
	"health-encyclopedia": {
		title: "健康百科",
		readiness: "待临床审核",
		description:
			"健康内容正在迁移中，当前不会展示未经临床审核的疾病或药品信息。",
		contractHint: "等待版本化内容、临床审核、搜索和下线审计规则确认。",
		icon: "/assets/legacy-home/service-encyclopedia.svg",
	},
	"health-praise": {
		title: "表扬信",
		readiness: "待临床审核",
		description: "表扬信正在迁移中，当前不会提交或公开患者相关内容。",
		contractHint: "等待内容审核、脱敏展示、文件上传、幂等和撤回规则确认。",
		icon: "/assets/legacy-home/service-praise.svg",
	},
	"health-test": {
		title: "健康自测",
		readiness: "待临床审核",
		description:
			"当前仅开放不带临床结论的 BMI 数值计算和血压读数校验，旧题库与风险分级仍关闭。",
		contractHint: "等待题库版本、临床审核、评分规则、适用人群和免责声明确认。",
		icon: "/assets/legacy-home/service-test.svg",
	},
	"inpatient-center": {
		title: "住院信息查询",
		readiness: "待 provider contract",
		description: "住院信息正在迁移中，当前不会复用门诊患者标识查询住院数据。",
		contractHint: "等待住院登记、住院患者标识、权限和脱敏字段确认。",
		icon: "/assets/legacy-home/service-inpatient.svg",
	},
	"inpatient-payment": {
		title: "住院预缴",
		readiness: "待支付与回写 contract",
		description: "住院预缴正在迁移中，当前不会发起支付或医保授权。",
		contractHint: "等待住院费用、金额单位、支付状态机、查单和回写规则确认。",
		icon: "/assets/legacy-home/service-inpatient-payment.svg",
	},
	insurance: {
		title: "医保电子凭证",
		readiness: "待支付与回写 contract",
		description: "医保电子凭证需要独立授权，当前暂未开放。",
		contractHint: "等待医保授权、1101/6201/6202 等协议、查单和 HIS 回写验收。",
		icon: "/assets/legacy-user/insurance.svg",
	},
	"medical-record": {
		title: "门诊病历",
		readiness: "待 provider contract",
		description:
			"门诊病历正在迁移中，当前不会读取未经确认的病历目录或用预约、报告数据替代。",
		contractHint:
			"病历正文、详情引用、住院记录和附件仍需独立 HIS/EMR contract。",
		icon: "/assets/legacy-user/medical-record.svg",
	},
	"outpatient-payment-detail": {
		title: "费用记录详情",
		readiness: "待支付与回写 contract",
		description: "门诊费用详情正在迁移中，当前不会展示未经引用校验的费用明细。",
		contractHint:
			"等待账单引用、患者归属、金额单位、明细白名单和短期授权确认。",
		icon: "/assets/legacy-home/top-payment.svg",
	},
	"outpatient-payment-write": {
		title: "门诊缴费",
		readiness: "待支付与回写 contract",
		description:
			"门诊缴费流程正在迁移中，当前不会创建订单或发起微信/医保支付。",
		contractHint:
			"等待订单归属、金额守恒、支付状态机、医保授权、查单和结算回写确认。",
		icon: "/assets/legacy-home/top-payment.svg",
	},
	"patient-binding": {
		title: "添加就诊人",
		readiness: "待患者绑定 contract",
		description: "新增或绑定就诊人正在迁移中，当前不会提交实名或绑卡资料。",
		contractHint:
			"等待查档、建档、绑卡、协议、幂等、最终状态查询和撤回规则确认。",
		icon: "/assets/legacy-home/service-patient.svg",
	},
	"pre-visit": {
		title: "预约前预问诊",
		readiness: "待临床审核",
		description: "预问诊正在迁移中，当前不会提交或覆盖问诊答案。",
		contractHint:
			"等待问卷版本、患者授权、提交幂等、撤回和医护端读取规则确认。",
		icon: "/assets/legacy-home/service-admission.svg",
	},
	"report-cloud-image": {
		title: "云影像",
		readiness: "待 provider contract",
		description: "云影像正在迁移中，当前不会向第三方地址传递报告或患者标识。",
		contractHint: "等待影像受众、短期授权、资源范围、过期和审计规则确认。",
		icon: "/assets/legacy-home/report-cloud.svg",
	},
	"report-detail": {
		title: "报告详情",
		readiness: "待 provider contract",
		description: "报告详情正在迁移中，当前不会打开未经授权的临床报告资源。",
		contractHint: "等待来源详情合同、患者归属、脱敏字段和资源授权确认。",
		icon: "/assets/legacy-home/report-tab.svg",
	},
	"report-peis": {
		title: "体检报告",
		readiness: "待 provider contract",
		description: "体检报告正在迁移中，当前不会使用身份证号直连第三方报告系统。",
		contractHint:
			"等待 PEIS 患者映射、报告资源授权、脱敏字段和附件下载规则确认。",
		icon: "/assets/legacy-home/report-tab.svg",
	},
	"report-follow-up": {
		title: "报告复诊",
		readiness: "待 provider contract",
		description: "报告复诊入口正在迁移中，当前不会根据报告自动创建就诊或预约。",
		contractHint: "等待复诊目标、患者上下文、预约关系和医疗责任边界确认。",
		icon: "/assets/legacy-home/report-tab.svg",
	},
	"report-share": {
		title: "报告分享",
		readiness: "待外部入口 contract",
		description: "报告分享正在迁移中，当前不会生成可外传的临床报告链接。",
		contractHint:
			"等待分享受众、脱敏字段、有效期、防重放、撤销和访问审计确认。",
		icon: "/assets/legacy-home/report-share.svg",
	},
	"risk-evaluation": {
		title: "风险自评",
		readiness: "待临床审核",
		description: "风险自评正在迁移中，当前不会使用未经临床审核的分级和建议。",
		contractHint: "等待题目、评分、阈值、适用人群、版本和免责声明确认。",
		icon: "/assets/legacy-home/service-risk.svg",
	},
	"smart-customer": {
		title: "智能客服",
		readiness: "待外部入口 contract",
		description:
			"智能客服正在迁移中，当前不会打开未经过 allowlist 校验的外部页面。",
		contractHint: "等待客服会话、外部域名白名单、登录态隔离和失败回退确认。",
		icon: "/assets/legacy-user/smart-customer.svg",
	},
});

export type FeatureStatusKey = FeatureKey | "invalid-entry";

/**
 * 非法或过期的动态入口必须有独立状态，不能默认落到某个具体业务。
 *
 * 默认显示“门诊病历”看似安全，实际上会把入口参数错误伪装成病历业务，
 * 用户会误以为病历服务不可用，后续日志和问题反馈也会被错误归类。这个
 * fallback 只解释入口校验失败，不读取缓存、不访问 Provider，也不改变业务
 * readiness 统计。
 */
export const INVALID_FEATURE_STATUS: FeatureStatus = Object.freeze({
	title: "服务入口不可用",
	readiness: "入口校验失败",
	description: "该服务入口无效，请返回首页后重新选择服务。",
	contractHint:
		"当前页面不会读取旧缓存、调用业务接口或发起支付，请从首页重新进入。",
	icon: "/assets/legacy-home/service-record.svg",
});

/**
 * 将外部 query 收敛为可信状态目录中的 key；未知值进入专用错误状态。
 * 返回值同时供页面标题和渲染数据使用，避免两处分别解析造成标题/内容错位。
 */
export function resolveFeatureStatus(value?: string): {
	featureKey: FeatureStatusKey;
	feature: FeatureStatus;
} {
	if (value && Object.hasOwn(FEATURE_STATUS_CATALOG, value)) {
		const featureKey = value as FeatureKey;
		return {
			featureKey,
			feature: FEATURE_STATUS_CATALOG[featureKey],
		};
	}
	return {
		featureKey: "invalid-entry",
		feature: INVALID_FEATURE_STATUS,
	};
}

/**
 * 迁移状态页只接受代码内固定 key，禁止把旧端 URL 或任意 provider 参数
 * 拼进小程序导航。这样既覆盖入口，又不会引入未审计的外部跳转。
 */
export function navigateToFeatureStatus(feature: FeatureKey): void {
	if (!FEATURE_STATUS_CATALOG[feature]) return;
	wx.navigateTo({
		url: `/pages/feature-status/feature-status?feature=${encodeURIComponent(feature)}`,
	});
}

/**
 * 页面外壳已经迁移的入口走自己的原生页面，尚未具备页面外壳的入口仍
 * 进入统一状态页。这个分发只改变页面落点，不代表对应 Provider、临床
 * 数据或外部业务已经开放；原生页面会继续展示关闭态和迁移说明。
 */
const FEATURE_SURFACE_TARGETS: Readonly<Partial<Record<FeatureKey, string>>> =
	Object.freeze({
		"inpatient-center": "/pages/inpatient-center/inpatient-center",
		doctor: "/pages/my-doctor/my-doctor",
		"electronic-consultation":
			"/pages/electronic-consultation/electronic-consultation",
		"patient-binding": "/pages/patient-binding/patient-binding",
		// 协议原文是已迁移的静态只读页面；查看协议不会写入同意状态，
		// 也不会把“看过协议”误判为实名绑定或授权完成。
		"patient-agreement": "/pages/patient-agreement/patient-agreement",
		"patient-signature": "/pages/patient-signature/patient-signature",
		"patient-express": "/pages/patient-express/patient-express",
		"admission-preconsultation":
			"/pages/admission-preconsultation/admission-preconsultation",
		"health-test": "/pages/health-test/health-test",
		"discharge-followup": "/pages/discharge-followup/discharge-followup",
		"gift-banner": "/pages/gift-banner/gift-banner",
		"health-praise": "/pages/health-praise/health-praise",
		"pre-visit": "/pages/pre-visit/pre-visit",
		"risk-evaluation": "/pages/risk-evaluation/risk-evaluation",
		"smart-customer": "/pages/smart-customer/smart-customer",
		"patient-subscription": "/pages/patient-subscription/patient-subscription",
		"blood-appointment": "/pages/blood-appointment/blood-appointment",
		"appointment-detail": "/pages/appointment-detail/appointment-detail",
	});

export function navigateToFeatureEntry(feature: FeatureKey): void {
	if (!FEATURE_STATUS_CATALOG[feature]) return;
	const target = FEATURE_SURFACE_TARGETS[feature];
	if (target) {
		wx.navigateTo({ url: target });
		return;
	}
	navigateToFeatureStatus(feature);
}
