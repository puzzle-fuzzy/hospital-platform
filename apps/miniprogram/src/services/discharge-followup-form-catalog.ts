export type DischargeFormFieldKind = "input" | "textarea" | "date" | "choice";

export type DischargeFormField = {
	key: string;
	label: string;
	kind: DischargeFormFieldKind;
	placeholder?: string;
	options?: ReadonlyArray<string>;
	multiple?: boolean;
};

export type DischargeFormSection = {
	title: string;
	description?: string;
	fields: ReadonlyArray<DischargeFormField>;
};

export type DischargeFormDefinition = {
	tableName: string;
	sections: ReadonlyArray<DischargeFormSection>;
};

const choice = (
	key: string,
	label: string,
	options: ReadonlyArray<string>,
	multiple = false,
): DischargeFormField => ({ key, label, kind: "choice", options, multiple });

const input = (
	key: string,
	label: string,
	placeholder = "请输入",
): DischargeFormField => ({ key, label, kind: "input", placeholder });

const textarea = (
	key: string,
	label: string,
	placeholder = "请输入相关内容",
): DischargeFormField => ({ key, label, kind: "textarea", placeholder });

const date = (key: string, label: string): DischargeFormField => ({
	key,
	label,
	kind: "date",
});

const RELATIONSHIP_OPTIONS = [
	"本人",
	"配偶",
	"父母",
	"子女",
	"其他亲属",
	"其他",
];
const FOLLOW_UP_METHOD_OPTIONS = ["电话", "微信、短信", "家访", "其他"];
const CONDITION_OUTCOME_OPTIONS = [
	"痊愈",
	"好转",
	"无变化",
	"转其他医院",
	"死亡",
	"其他",
];
const TREATMENT_OPTIONS = [
	"口服药物",
	"肌肉注射",
	"静脉注射",
	"定期复查",
	"其他",
];
const FREQUENCY_OPTIONS = [
	"第一次（出院后 3–7 日）",
	"第二次（出院后 3–6 个月）",
];
const SATISFACTION_OPTIONS = ["很满意", "满意", "一般", "不满意"];

const PATIENT_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze([
	input("patientName", "姓名", "请输入姓名"),
	input("gender", "性别", "请输入性别"),
	input("age", "年龄", "请输入年龄"),
	input("occupation", "职业", "请输入职业"),
	choice("mainTreatment", "主要治疗方式", ["手术", "介入", "其他"], true),
	input("mainDiagnosis", "出院主要诊断", "请输入出院主要诊断"),
	date("dischargeTime", "出院时间"),
	input("dischargeMethod", "离院方式", "请输入离院方式"),
	input("attendingDoctor", "主管医生", "请输入主管医生"),
	input("phone", "电话", "请输入电话"),
	input("address", "住址", "请输入住址"),
	date("followUpDate", "随访日期"),
	choice("followUpMethod", "随访方式", FOLLOW_UP_METHOD_OPTIONS, true),
	choice("relationship", "受访者与患者关系", RELATIONSHIP_OPTIONS),
]);

const SURGERY_PATIENT_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze(
	[
		...PATIENT_FIELDS.slice(0, 5),
		input("surgeryName", "手术名称", "请输入手术名称"),
		...PATIENT_FIELDS.slice(5),
	],
);

const LEVEL2_PATIENT_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze([
	input("patientName", "患者姓名", "请输入患者姓名"),
	input("inpatientNo", "住院号（门诊号）", "请输入住院号或门诊号"),
	date("dischargeDate", "出院日期"),
	choice("relationship", "受访者与患者的关系", RELATIONSHIP_OPTIONS),
]);

const LEVEL1_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze(
	[
		choice("conditionOutcome", "① 出院后病情转归", CONDITION_OUTCOME_OPTIONS),
		textarea(
			"symptomsGuidance",
			"近一周主要症状及指导",
			"近一周主要症状及指导:",
		),
		choice("treatmentMethod", "② 后续治疗", TREATMENT_OPTIONS),
		textarea(
			"treatmentMethodDetails",
			"主要治疗药物及用法",
			"主要治疗药物及用法:",
		),
		choice("rehabilitation", "③ 康复锻炼", ["器械锻炼", "无器械锻炼", "其他"]),
		textarea("exerciseDetails", "锻炼部位及方式", "锻炼部位及方式:"),
		choice("mentalState", "④ 精神情绪", ["良好", "一般", "较差"]),
		choice("livingSelfCare", "生活自理", ["独立", "协助", "卧床"]),
		choice("workStatus", "工作劳动", ["正常", "适当照顾", "休息"]),
		choice(
			"precautions",
			"⑥ 注意事项",
			["饮食", "睡眠", "服药", "锻炼", "大小便", "其他"],
			true,
		),
		choice("returnVisit", "⑦ 复诊随诊", ["复诊", "随诊", "电话预约"]),
		date("returnVisitTime", "复诊/随诊时间"),
		choice("extendedServices", "⑧ 延伸性服务", [
			"远程监控和指导",
			"线上诊疗",
			"指导患者及时就诊及就诊渠道",
		]),
		textarea("extendedServicesContent", "延伸性服务具体内容", "具体内容:"),
		choice("unsuitableFollowUp", "⑨ 不宜随访", ["住院不足24小时", "患者死亡"]),
	],
);

const LEVEL4_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze(
	[
		choice("conditionOutcome", "① 出院后病情转归", CONDITION_OUTCOME_OPTIONS),
		choice(
			"oneWeekStatus",
			"② 出院后一周情况",
			[
				"疼痛",
				"饮食",
				"大小便",
				"伤口愈合情况",
				"功能恢复情况",
				"阴道异常出血",
				"其它",
			],
			true,
		),
		choice(
			"threeToSixMonthsStatus",
			"③ 出院后三至六个月情况",
			[
				"腹部情况",
				"饮食",
				"大小便",
				"功能恢复情况",
				"化疗情况",
				"是否按医嘱定期复查及后续治疗",
				"体重变化",
				"性生活",
				"ADL 评分",
				"其它",
			],
			true,
		),
		choice("treatmentMethod", "④ 后续治疗", TREATMENT_OPTIONS),
		textarea(
			"treatmentMethodDetails",
			"主要治疗药物及用法",
			"主要治疗药物及用法:",
		),
		choice("rehabilitation", "⑤ 康复锻炼", [
			"器械锻炼",
			"无器械锻炼",
			"使用支具",
			"其他",
		]),
		textarea(
			"exerciseDetails",
			"锻炼部位及方式",
			"锻炼部位、方式及支具使用注意事项:",
		),
		choice("mentalState", "⑥ 精神情绪", ["良好", "一般", "较差"]),
		choice("livingSelfCare", "生活自理", ["独立", "协助", "卧床"]),
		choice(
			"livingImpairment",
			"功能情况",
			["肢体障碍情况", "语言功能", "视觉功能"],
			true,
		),
		choice("workStatus", "工作劳动", ["正常", "适当照顾", "休息"]),
		choice(
			"precautions",
			"⑦ 注意事项",
			[
				"饮食",
				"睡眠",
				"服药",
				"戒烟",
				"限酒",
				"大小便",
				"心理",
				"造口情况",
				"管道护理",
				"功能锻炼",
				"其他",
			],
			true,
		),
		choice("returnVisit", "⑧ 复诊随诊", ["复诊", "随诊", "电话预约"]),
		date("returnVisitTime", "复诊/随诊时间"),
		choice("followUpFrequency", "⑨ 随访频次", FREQUENCY_OPTIONS),
	],
);

const CARDIOLOGY_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormField> =
	Object.freeze([
		choice("conditionOutcome", "① 出院后病情转归", CONDITION_OUTCOME_OPTIONS),
		choice(
			"mainSymptoms",
			"② 近期主要症状及指导",
			[
				"无症状",
				"胸痛",
				"胸闷",
				"心慌",
				"气促",
				"恶心",
				"呕吐",
				"呼吸困难",
				"乏力、水肿",
				"腹胀、腹痛",
				"其它",
			],
			true,
		),
		textarea("symptomGuidance", "症状指导内容", "指导内容:"),
		choice(
			"mainDrugs",
			"③ 主要药物及用法",
			[
				"阿司匹林",
				"铝镁匹林",
				"吲哚布芬",
				"氯吡格雷",
				"替格瑞洛",
				"硝酸酯类",
				"ACEI/ARB",
				"B-R",
				"达格列净",
				"利尿剂",
				"补钾药物",
				"其他",
			],
			true,
		),
		textarea("mainDrugsDetails", "主要药物名称及用法", "主要药物名称及用法:"),
		choice("rehabilitation", "④ 康复锻炼", ["休息", "散步", "太极拳"]),
		choice(
			"lifeGuidance",
			"⑤ 饮食生活指导",
			["饮食", "戒烟", "限酒", "体重", "大小便", "睡眠", "其它"],
			true,
		),
		choice("mentalState", "精神情绪", ["良好", "一般", "较差"]),
		choice("livingSelfCare", "生活自理", ["独立", "协助", "卧床"]),
		choice("workStatus", "工作劳动", ["正常", "适当照顾", "休息"]),
		choice("precautions", "⑥ 注意事项", ["血压", "心率", "血脂", "血糖"], true),
		choice("returnVisit", "⑦ 复诊方式", ["电话", "门诊", "住院"]),
		choice("followUpFrequency", "⑧ 随访频次", FREQUENCY_OPTIONS),
	]);

const NEURO_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze([
	choice("conditionOutcome", "① 出院后病情转归", CONDITION_OUTCOME_OPTIONS),
	choice(
		"mainSymptoms",
		"② 近期主要症状及指导",
		[
			"无症状",
			"肢体无力",
			"肢体感觉障碍",
			"头晕",
			"视物模糊",
			"面瘫",
			"头部感觉障碍",
			"语言功能障碍",
			"认知功能障碍",
			"其他",
		],
		true,
	),
	textarea("symptomGuidance", "症状指导内容", "指导内容:"),
	choice(
		"mainDrugs",
		"③ 主要药物及用法",
		["抗血小板药物", "降脂药物", "降血压药物", "降血糖药物", "其他"],
		true,
	),
	textarea("mainDrugsDetails", "主要药物名称及用法", "主要药物名称及用法:"),
	choice("rehabilitation", "④ 康复锻炼", ["休息", "散步", "太极拳"]),
	choice(
		"lifeGuidance",
		"⑤ 饮食生活指导",
		["饮食", "戒烟", "限酒", "体重", "大小便", "睡眠", "其他"],
		true,
	),
	choice("mentalState", "精神情绪", ["良好", "一般", "较差"]),
	choice("livingSelfCare", "生活自理", ["独立", "协助", "卧床"]),
	choice("workStatus", "工作劳动", ["正常", "适当照顾", "休息"]),
	choice("precautions", "⑥ 注意事项", ["血压", "心率", "血脂", "血糖"], true),
	choice("returnVisit", "⑦ 复诊方式", ["电话", "门诊", "住院"]),
	choice("followUpFrequency", "⑧ 随访频次", FREQUENCY_OPTIONS),
]);

const DAYTIME_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormField> =
	Object.freeze([
		choice(
			"incisionStatus",
			"手术切口",
			["渗血", "渗液", "发红", "肿胀", "疼痛"],
			true,
		),
		choice(
			"drainageStatus",
			"引流情况",
			["通畅", "不通畅", "颜色正常", "颜色异常"],
			true,
		),
		choice("excretionStatus", "排泄情况", ["未排", "腹泻"], true),
		choice(
			"otherSymptoms",
			"其它症状",
			["恶心", "呕吐", "嗜睡", "发热", "头痛", "眩晕"],
			true,
		),
		choice("treatmentMethod", "② 后续治疗", [
			"口服药物",
			"肌肉注射",
			"静脉注射",
			"定期复查",
			"其他",
		]),
		textarea("treatmentDetails", "主要治疗药物及用法", "主要治疗药物及用法:"),
		choice("rehabilitation", "③ 康复锻炼", [
			"器械锻炼",
			"无器械锻炼",
			"使用支具",
			"其他",
		]),
		textarea(
			"exerciseDetails",
			"锻炼部位及方式",
			"锻炼部位、方式及支具使用注意事项:",
		),
		choice("mentalState", "④ 精神情绪", ["良好", "一般", "较差"]),
		choice("lifeSelfCare", "生活自理", [
			"独立",
			"协助",
			"卧床",
			"肢体障碍情况",
			"语言功能",
			"视觉功能",
		]),
		choice("lifeWork", "工作劳动", ["正常", "适当照顾", "休息"]),
		choice(
			"precautions",
			"⑥ 注意事项",
			[
				"饮食",
				"睡眠",
				"服药",
				"戒烟",
				"限酒",
				"大小便",
				"心理",
				"造口情况",
				"管道护理",
				"功能锻炼",
				"其他",
			],
			true,
		),
		choice("returnVisit", "⑦ 复诊随诊", ["复诊", "随诊", "电话预约"]),
		input("returnVisitTimeText", "复诊/随诊时间", "请输入建议复诊/随诊时间"),
	]);

const LEVEL2_COMMON_FIELDS: ReadonlyArray<DischargeFormField> = Object.freeze([
	choice("lifeSelfCare", "生活自理", ["独立", "协助", "卧床"]),
	choice("lifeWork", "生活劳动", ["正常", "适当照顾", "休息"]),
	choice("envFeeling", "院内环境卫生感受", ["良好", "一般", "不好", "其他"]),
	choice(
		"windowDeptIssues",
		"窗口科室服务问题",
		[
			"结账处",
			"住院药房",
			"医保科",
			"病案室",
			"门急诊收费",
			"门急诊药房",
			"其他",
		],
		true,
	),
	choice(
		"exams",
		"住院期间做过的检查",
		["放射", "CT核磁", "检验", "胃镜", "心电图", "其他"],
		true,
	),
	textarea(
		"examServiceComment",
		"检查过程中服务态度评价",
		"检查过程中服务态度评价:",
	),
	choice(
		"irregularBehaviors",
		"科室医务人员不规范行为",
		["私自收费", "收受红包", "向外介绍检查", "向外介绍买药", "其他", "无"],
		true,
	),
	choice("chronicReturnVisit", "慢病复诊随诊方式", [
		"复诊",
		"随诊",
		"电话预约",
	]),
	input("chronicReturnVisitTime", "复诊/随诊时间", "请输入建议的复诊/随诊时间"),
	choice(
		"suggestionType",
		"合理化意见建议类型",
		["服务态度", "诊疗技术", "就医环境", "就诊流程", "其他"],
		true,
	),
	textarea("suggestionContent", "意见和建议", "请填写您的意见和建议"),
	input("visitor", "回访人", "请输入回访人"),
	input("visitMethod", "回访方式", "如：电话、门诊、上门等"),
	date("visitDate", "回访日期"),
]);

function fieldAt(
	fields: ReadonlyArray<DischargeFormField>,
	index: number,
): DischargeFormField {
	const field = fields[index];
	if (!field) throw new Error(`随访表单目录缺少字段: ${index}`);
	return field;
}

function sectionAt(
	sections: ReadonlyArray<DischargeFormSection>,
	index: number,
): DischargeFormSection {
	const section = sections[index];
	if (!section) throw new Error(`随访表单目录缺少分组: ${index}`);
	return section;
}

const LEVEL2_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormSection> =
	Object.freeze([
		{
			title: "① 出院以后，主管医师对您进行了随访吗？",
			fields: [choice("followedUp", "是否随访", ["是", "否"])],
		},
		{
			title: "② 您对主管医师的服务满意吗？",
			fields: [
				choice("satisfactionDoctor", "服务满意度", SATISFACTION_OPTIONS),
			],
		},
		{
			title: "③ 对医务人员的服务态度满意吗？",
			fields: [choice("satisfactionStaff", "服务满意度", SATISFACTION_OPTIONS)],
		},
		{
			title: "④ 询问近期状况及健康指导",
			fields: LEVEL2_COMMON_FIELDS.slice(0, 2),
		},
		{
			title: "⑤ 您对院内环境卫生感觉如何？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 2)],
		},
		{
			title: "⑥ 您对院内窗口科室服务满意吗？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 3)],
		},
		{
			title: "⑦ 您在住院期间做过哪些检查？他们的服务态度怎样？",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 4),
				fieldAt(LEVEL2_COMMON_FIELDS, 5),
			],
		},
		{
			title:
				"⑧ 住院期间，所在科室的医务人员是否有私自收费、收受红包、向外介绍检查/购药等行为？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 6)],
		},
		{
			title: "⑨ 对慢病病人的复诊随诊指导",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 7),
				fieldAt(LEVEL2_COMMON_FIELDS, 8),
			],
		},
		{
			title: "⑩ 请您给我们提出合理化意见和建议",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 9),
				fieldAt(LEVEL2_COMMON_FIELDS, 10),
			],
		},
		{
			title: "回访记录",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 11),
				fieldAt(LEVEL2_COMMON_FIELDS, 12),
				fieldAt(LEVEL2_COMMON_FIELDS, 13),
			],
		},
	]);

const LEVEL4_SECOND_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormSection> =
	Object.freeze([
		{
			title: "② 出院以后半年内是否按时复查？",
			fields: [choice("halfYearRecheck", "是否按时复查", ["是", "否"])],
		},
		{
			title: "③ 复查是否顺利？",
			fields: [choice("recheckSmooth", "复查是否顺利", ["是", "否"])],
		},
		...LEVEL2_FOLLOWUP_FIELDS.slice(3),
	]);

const DAYTIME_SECOND_FOLLOWUP_FIELDS: ReadonlyArray<DischargeFormSection> =
	Object.freeze([
		sectionAt(LEVEL2_FOLLOWUP_FIELDS, 0),
		{
			title: "② 您对主管医师的服务满意吗？",
			fields: [
				choice("satisfactionDoctor", "服务满意度", SATISFACTION_OPTIONS),
			],
		},
		{
			title: "③ 对其他医务人员的服务态度满意吗？",
			fields: [choice("satisfactionStaff", "服务满意度", SATISFACTION_OPTIONS)],
		},
		{
			title: "④ 您对日间手术模式的就医过程是否满意吗？",
			fields: [
				choice(
					"daytimeProcessSatisfaction",
					"就医过程满意度",
					SATISFACTION_OPTIONS,
				),
			],
		},
		{
			title: "⑤ 询问近期状况及健康指导",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 0),
				fieldAt(LEVEL2_COMMON_FIELDS, 1),
			],
		},
		{
			title: "⑥ 您对院内环境卫生感觉如何？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 2)],
		},
		{
			title: "⑦ 您对院内窗口科室服务满意吗？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 3)],
		},
		{
			title: "⑧ 您在住院期间做过哪些检查？他们的服务态度怎样？",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 4),
				fieldAt(LEVEL2_COMMON_FIELDS, 5),
			],
		},
		{
			title:
				"⑨ 住院期间，所在科室的医务人员是否有私自收费、收受红包、向外介绍检查/购药等行为？",
			fields: [fieldAt(LEVEL2_COMMON_FIELDS, 6)],
		},
		{
			title: "⑩ 对慢病病人的复诊随诊指导",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 7),
				fieldAt(LEVEL2_COMMON_FIELDS, 8),
			],
		},
		{
			title: "⑪ 请您给我们提出合理化意见和建议",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 9),
				fieldAt(LEVEL2_COMMON_FIELDS, 10),
			],
		},
		{
			title: "回访记录",
			fields: [
				fieldAt(LEVEL2_COMMON_FIELDS, 11),
				fieldAt(LEVEL2_COMMON_FIELDS, 12),
				fieldAt(LEVEL2_COMMON_FIELDS, 13),
			],
		},
	]);

function definition(
	tableName: string,
	sections: ReadonlyArray<DischargeFormSection>,
): DischargeFormDefinition {
	return { tableName, sections };
}

const LEVEL1 = "高平市人民医院一级随访记录表";
const LEVEL4 = "高平市人民医院四级手术随访记录表";
const CARDIOLOGY = "心内科四级手术随访记录表";
const NEURO = "神经内科四级手术随访记录表";
const LEVEL2 = "高平市人民医院二级回访登记表";
const DAYTIME = "高平市人民医院日间手术随访记录表";
const LEVEL4_SECOND = "高平市人民医院四级手术二次回访登记表";
const DAYTIME_SECOND = "高平市人民医院日间手术二级回访登记表";

export const DISCHARGE_FOLLOWUP_FORM_CATALOG: Readonly<
	Record<string, DischargeFormDefinition>
> = Object.freeze({
	[LEVEL1]: definition(LEVEL1, [
		{ title: "患者基本信息", fields: PATIENT_FIELDS },
		{ title: "住院医师随访及指导", fields: LEVEL1_FOLLOWUP_FIELDS },
	]),
	[LEVEL4]: definition(LEVEL4, [
		{ title: "患者基本信息", fields: SURGERY_PATIENT_FIELDS },
		{ title: "住院医师随访及指导", fields: LEVEL4_FOLLOWUP_FIELDS },
	]),
	[CARDIOLOGY]: definition(CARDIOLOGY, [
		{ title: "患者基本信息", fields: SURGERY_PATIENT_FIELDS },
		{ title: "主管医师随访及指导", fields: CARDIOLOGY_FOLLOWUP_FIELDS },
	]),
	[NEURO]: definition(NEURO, [
		{ title: "患者基本信息", fields: SURGERY_PATIENT_FIELDS },
		{ title: "主管医师随访及指导", fields: NEURO_FOLLOWUP_FIELDS },
	]),
	[LEVEL2]: definition(LEVEL2, [
		{ title: "基本信息", fields: LEVEL2_PATIENT_FIELDS },
		...LEVEL2_FOLLOWUP_FIELDS,
	]),
	[DAYTIME]: definition(DAYTIME, [
		{ title: "患者基本信息", fields: SURGERY_PATIENT_FIELDS },
		{
			title: "① 出院后24小时病情",
			fields: DAYTIME_FOLLOWUP_FIELDS.slice(0, 4),
		},
		{ title: "② 后续治疗", fields: DAYTIME_FOLLOWUP_FIELDS.slice(4, 6) },
		{ title: "③ 康复锻炼", fields: DAYTIME_FOLLOWUP_FIELDS.slice(6, 8) },
		{ title: "④ 精神情绪", fields: [fieldAt(DAYTIME_FOLLOWUP_FIELDS, 8)] },
		{ title: "⑤ 生活状况", fields: DAYTIME_FOLLOWUP_FIELDS.slice(9, 11) },
		{ title: "⑥ 注意事项", fields: [fieldAt(DAYTIME_FOLLOWUP_FIELDS, 11)] },
		{ title: "⑦ 复诊随诊", fields: DAYTIME_FOLLOWUP_FIELDS.slice(12, 14) },
	]),
	[LEVEL4_SECOND]: definition(LEVEL4_SECOND, [
		{
			title: "内容记录",
			description:
				"您好！您是（或者家属）吗？这里是高平市人民医院回访中心，现就您出院后的恢复情况进行一次随访，请您理解和配合，谢谢。",
			fields: [],
		},
		{ title: "基本信息", fields: LEVEL2_PATIENT_FIELDS },
		...LEVEL4_SECOND_FOLLOWUP_FIELDS,
	]),
	[DAYTIME_SECOND]: definition(DAYTIME_SECOND, [
		{ title: "基本信息", fields: LEVEL2_PATIENT_FIELDS },
		...DAYTIME_SECOND_FOLLOWUP_FIELDS,
	]),
});

export function getDischargeFollowupFormDefinition(
	tableName: string,
): DischargeFormDefinition {
	const form =
		DISCHARGE_FOLLOWUP_FORM_CATALOG[tableName] ??
		DISCHARGE_FOLLOWUP_FORM_CATALOG[LEVEL1];
	if (!form) throw new Error("出院随访表单目录缺少一级随访表单");
	return form;
}

export function createDischargeFormValues(
	form: DischargeFormDefinition,
): Record<string, string | string[]> {
	return Object.fromEntries(
		form.sections.flatMap((section) =>
			section.fields.map((field) => [
				field.key,
				field.kind === "choice" ? [] : "",
			]),
		),
	);
}
