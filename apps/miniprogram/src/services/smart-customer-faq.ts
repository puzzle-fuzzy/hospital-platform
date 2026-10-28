/**
 * 智能客服“门诊与住院一站式服务”常见问题目录。
 *
 * 边界：答案只使用本仓库已确认的业务事实（线上流程、功能入口、须知条款）；
 * 窗口位置、工作时间、联系电话、收费标准等医院现场信息一律不编造，
 * 统一提示以医院现场公示为准。模型问答的事实来源是服务端知识库检索，
 * 本目录是模型不可用或资料未覆盖时的原生兜底，两者不互相替代。
 */

export type SmartCustomerFaqAction = {
	label: string;
	/** 仅允许本目录内登记的小程序页面路径，页面跳转前会按目录复核。 */
	url: string;
};

export type SmartCustomerFaqItem = {
	id: string;
	question: string;
	answer: string;
	action?: SmartCustomerFaqAction;
};

export type SmartCustomerFaqGroup = {
	id: string;
	title: string;
	items: ReadonlyArray<SmartCustomerFaqItem>;
};

export const SMART_CUSTOMER_FAQ_GROUPS: ReadonlyArray<SmartCustomerFaqGroup> =
	[
		{
			id: "outpatient",
			title: "门诊服务",
			items: [
				{
					id: "outpatient-reception-notice",
					question: "门诊接诊须知",
					answer:
						"医院实行实名制就诊，请携带有效证件按时到院取号候诊；请确认就诊日期与时段后按安排就诊。未按时取号的预约可能按爽约处理，取消规则以医院现场公示为准。挂号费用以下单时医院实际收费为准。如有急危重症，请立即前往急诊或拨打 120。",
					action: {
						label: "去预约挂号",
						url: "/pages/appointment-directory/appointment-directory",
					},
				},
				{
					id: "patient-card-process",
					question: "就诊卡办理（办卡）流程",
					answer:
						"线上办理：在小程序首页进入“添加就诊人”，跳转百灵医院公众号完成实名绑卡，返回后就诊人目录自动同步。线下办理：携带本人有效身份证件到医院办卡窗口办理。窗口位置和工作时间以医院现场公示为准。",
					action: {
						label: "线上添加就诊人",
						url: "/pages/patient-binding/patient-binding",
					},
				},
				{
					id: "record-copy-notice",
					question: "病历复印须知",
					answer:
						"复印门诊或住院病历，请携带本人有效身份证件到医院病案管理部门提出申请；他人代办时需同时携带患者和代办人的有效证件。可复印内容、办理流程和收费标准以医院现场公示为准。小程序“门诊病历”可先自助查看近 30 天门诊就诊摘要。",
					action: {
						label: "查看门诊病历",
						url: "/pages/medical-record/medical-record",
					},
				},
				{
					id: "report-fee-query",
					question: "报告和费用怎么查",
					answer:
						"检验检查报告可在小程序首页“报告查询”查看；门诊待缴和已缴费用可在首页“门诊缴费”自助查看，缴费状态以医院实际记录为准。",
					action: {
						label: "查门诊费用",
						url: "/pages/outpatient-payment/outpatient-payment",
					},
				},
			],
		},
		{
			id: "inpatient",
			title: "住院服务",
			items: [
				{
					id: "inpatient-info-query",
					question: "住院信息怎么查",
					answer:
						"小程序住院服务提供住院摘要查询，数据以医院住院登记为准；查询结果仅供参考，具体诊疗安排请以病房和医护告知为准。",
					action: {
						label: "住院信息查询",
						url: "/pages/inpatient-center/inpatient-center",
					},
				},
				{
					id: "inpatient-deposit",
					question: "住院预缴怎么办理",
					answer:
						"住院预缴可在小程序住院服务内发起；预缴金额、支付方式和收退规则以医院实际公示与住院收费为准，页面未开放时以其提示为准。",
					action: {
						label: "住院预缴",
						url: "/pages/inpatient-payment/inpatient-payment",
					},
				},
				{
					id: "inpatient-discharge-followup",
					question: "出院后随访与指导",
					answer:
						"出院后可在我院相关服务中查看随访安排和康复指导；随访计划、复诊时间和注意事项以主管医护出院告知为准。",
					action: {
						label: "出院随访",
						url: "/pages/discharge-followup/discharge-followup",
					},
				},
			],
		},
	];

/** 页面跳转前按目录复核，防止模板数据被替换成任意页面路径。 */
export function smartCustomerFaqActionUrl(id: string): string | undefined {
	for (const group of SMART_CUSTOMER_FAQ_GROUPS) {
		for (const item of group.items) {
			if (item.id === id) return item.action?.url;
		}
	}
	return undefined;
}
