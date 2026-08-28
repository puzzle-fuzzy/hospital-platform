import { type Static, Type } from "@sinclair/typebox";

/** 存活检查只证明 API 进程能响应，不代表数据库或外部 provider 可用。 */
export const HealthResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		status: Type.Literal("ok"),
		service: Type.String(),
		version: Type.String(),
	}),
});

/** 依赖状态必须显式区分“未配置”和“已配置但不可用”，禁止误报 ready。 */
export const DependencyStateSchema = Type.Union([
	Type.Literal("ok"),
	Type.Literal("not_configured"),
	Type.Literal("unavailable"),
]);

export type DependencyState = Static<typeof DependencyStateSchema>;

/**
 * 微信登录 code 只在服务端兑换，前端不得提交 openid、session_key 或 AppSecret。
 *
 * 登录是一次性凭证交换，不接受旧端遗留字段被静默丢弃；否则调用方会收到
 * “成功”却不知道自己的请求中混入了错误身份字段。服务层还会再次拒绝首尾
 * 空白和控制字符，保证绕过 HTTP 的内部调用也遵守同一边界。
 */
export const WechatLoginRequest = Type.Object(
	{
		code: Type.String({ minLength: 1, maxLength: 256 }),
	},
	{ additionalProperties: false },
);

/** 登录成功只返回平台会话和内部用户 id，不暴露 provider session_key。 */
export const AuthSessionResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		accessToken: Type.String({ minLength: 1 }),
		tokenType: Type.Literal("Bearer"),
		expiresInSeconds: Type.Integer({ minimum: 1 }),
		user: Type.Object({ id: Type.String({ minLength: 1 }) }),
	}),
});

/** 会话恢复只返回平台内部用户引用，不读取或暴露 provider subject。 */
export const CurrentUserResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		user: Type.Object({ id: Type.String({ minLength: 1 }) }),
	}),
});

/** 普通资料性别枚举；实名性别和医院患者性别不复用此字段。 */
export const UserGenderSchema = Type.Union([
	Type.Literal("male"),
	Type.Literal("female"),
	Type.Literal("unknown"),
]);

/**
 * 普通资料版本最终落在 MySQL INT UNSIGNED；API 不能接受超出数据库范围的
 * 客户端版本，否则会把一个可预期的输入错误推迟成持久化异常。
 */
export const MAX_USER_PROFILE_VERSION = 4_294_967_295;

/**
 * 资料昵称最多 64 个 Unicode code point。
 *
 * TypeBox 0.34 的 `maxLength` 运行时按 JavaScript UTF-16 code unit 计数：一个
 * emoji 会占两个 unit，直接写 `maxLength: 64` 就会把合法的 64 个 emoji 错误
 * 拒绝。这个 pattern 将 BMP 字符计为一个 code point，将合法的代理项对计为一
 * 个 code point；同时拒绝孤立代理项，确保 HTTP 契约与资料服务的 `Array.from`
 * 计数规则一致。`minLength` 只负责拒绝空字符串，实际长度上限由 pattern 完成。
 */
const USER_PROFILE_DISPLAY_NAME_PATTERN =
	"^(?:[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]|[^\\uD800-\\uDFFF]){1,64}$";

/** 个人资料展示名的跨 HTTP/领域共享约束。 */
export const UserProfileDisplayNameSchema = Type.String({
	minLength: 1,
	pattern: USER_PROFILE_DISPLAY_NAME_PATTERN,
	description:
		"最多 64 个 Unicode code point；服务端另行拒绝首尾空白和控制字符。",
});

/** 个人资料只返回平台展示字段，不返回微信身份、实名或患者字段。 */
export const UserProfileSchema = Type.Object({
	displayName: UserProfileDisplayNameSchema,
	gender: UserGenderSchema,
	age: Type.Union([Type.Integer({ minimum: 0, maximum: 150 }), Type.Null()]),
	email: Type.Union([
		Type.String({ maxLength: 320, format: "email" }),
		Type.Null(),
	]),
	/** 0 表示尚未持久化，正整数表示已落库版本。 */
	version: Type.Integer({ minimum: 0, maximum: MAX_USER_PROFILE_VERSION }),
});

export const UserProfileResponse = Type.Object({
	success: Type.Literal(true),
	data: UserProfileSchema,
});

/**
 * 普通资料使用版本条件更新；不接受 avatar/openid/unionid/身份证等旧字段。
 *
 * 必须显式关闭 additionalProperties：TypeBox/Elysia 在默认配置下可能把未知
 * 字段当作可忽略的兼容字段，导致旧端请求收到 200 却没有保存完整意图。资料域
 * 宁可让调用方修正请求，也不能把身份字段静默吞掉后伪造“更新成功”。
 */
export const UserProfileUpdateRequest = Type.Object(
	{
		version: Type.Integer({ minimum: 0, maximum: MAX_USER_PROFILE_VERSION }),
		displayName: Type.Optional(UserProfileDisplayNameSchema),
		gender: Type.Optional(UserGenderSchema),
		age: Type.Optional(
			Type.Union([Type.Integer({ minimum: 0, maximum: 150 }), Type.Null()]),
		),
		email: Type.Optional(
			Type.Union([
				Type.String({ maxLength: 320, format: "email" }),
				Type.Null(),
			]),
		),
	},
	{ additionalProperties: false },
);

/**
 * 关系值是跨 provider 的内部规范，页面显示文案由小程序决定。
 * `other` 是上游明确给出的“其他”，`unknown` 是关系缺失或暂时无法识别。
 */
export const PatientRelationshipSchema = Type.Union([
	Type.Literal("self"),
	Type.Literal("spouse"),
	Type.Literal("child"),
	Type.Literal("parent"),
	Type.Literal("other"),
	Type.Literal("unknown"),
]);

/** 患者目录是否具备预约、报告和费用只读链路需要的临床映射。 */
export const PatientClinicalAccessSchema = Type.Union([
	Type.Literal("ready"),
	Type.Literal("unavailable"),
]);

/**
 * 患者端允许返回的卡号展示值。
 *
 * 卡号不是普通字符串：最多保留前五位和后四位，中间必须存在至少一个
 * 掩码字符；`未绑定` 表示 Provider 没有可展示卡号。把规则写进公共
 * Elysia response contract，可以让路由 schema 和领域/小程序的运行时
 * 二次校验共享同一条安全边界，避免未来 service 漏校验时仍把完整卡号
 * 当成合法响应发出。这里使用标准 JSON Schema `pattern`，不依赖 TypeBox
 * 私有的 RegExp kind，便于文档生成和不同运行时验证器保持一致。
 */
export const PatientCardNumberMaskedSchema = Type.Union([
	Type.Literal("未绑定"),
	Type.String({ pattern: "^[A-Za-z0-9]{0,5}\\*+[A-Za-z0-9]{0,4}$" }),
]);

export const PatientSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	displayName: Type.String({ minLength: 1 }),
	relationship: PatientRelationshipSchema,
	cardNumberMasked: PatientCardNumberMaskedSchema,
	source: Type.Union([
		Type.Literal("hospital-his"),
		Type.Literal("legacy-record"),
	]),
	clinicalAccess: PatientClinicalAccessSchema,
});

/** 患者列表是脱敏后的读模型，不允许把领域层 ownerUserId 透传到客户端。 */
export const PatientListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(PatientSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** 预约目录科室是 provider 白名单后的公开读模型。 */
export const AppointmentDepartmentSchema = Type.Object({
	departmentId: Type.String({ minLength: 1 }),
	departmentCode: Type.Optional(Type.String({ minLength: 1 })),
	displayName: Type.String({ minLength: 1 }),
	location: Type.Optional(Type.String({ minLength: 1 })),
});

export const AppointmentDepartmentListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(AppointmentDepartmentSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** 排班读模型使用 opaque 平台 scheduleId，不返回 provider 原始标识或挂号金额。 */
export const AppointmentScheduleSchema = Type.Object({
	scheduleId: Type.String({ minLength: 1 }),
	departmentId: Type.String({ minLength: 1 }),
	departmentName: Type.String({ minLength: 1 }),
	doctorId: Type.String({ minLength: 1 }),
	doctorName: Type.String({ minLength: 1 }),
	workDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
	shiftName: Type.String({ minLength: 1 }),
	startTime: Type.Optional(Type.String({ minLength: 1 })),
	endTime: Type.Optional(Type.String({ minLength: 1 })),
	totalSlots: Type.Integer({ minimum: 0 }),
	availableSlots: Type.Integer({ minimum: 0 }),
	timeGroup: Type.Union([
		Type.Literal("point"),
		Type.Literal("range"),
		Type.Literal("unknown"),
	]),
});

export const AppointmentScheduleListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(AppointmentScheduleSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** 预约历史只返回服务端规范化状态，不暴露 provider 的数字状态码。 */
export const AppointmentRecordStatusSchema = Type.Union([
	Type.Literal("scheduled"),
	Type.Literal("cancelled"),
	Type.Literal("completed"),
	Type.Literal("missed"),
	Type.Literal("stopped"),
	Type.Literal("substituted"),
	Type.Literal("registered"),
	Type.Literal("unknown"),
]);

/**
 * 预约记录时间只允许旧端已经确认的“时间点/时间段”形态。
 *
 * Provider 的 `groupStart/groupEnd` 会在 adapter 中先归一化为这个公开格式；
 * 不能把“上午”、完整日期时间或任意文本放进公共 contract，否则小程序会
 * 按小时错误推导上午/下午，患者看到的就诊时间也无法和旧端对应。
 */
export const APPOINTMENT_RECORD_WORK_TIME_PATTERN =
	"^(?:[01]\\d|2[0-3]):[0-5]\\d(?:-(?:[01]\\d|2[0-3]):[0-5]\\d)?$";

/** 运行时校验预约记录时间，并拒绝结束时间早于开始时间的区间。 */
export function isAppointmentRecordWorkTime(value: unknown): value is string {
	if (typeof value !== "string") return false;
	const match =
		/^(?:[01]\d|2[0-3]):[0-5]\d(?:-(?:[01]\d|2[0-3]):[0-5]\d)?$/.exec(value);
	if (!match) return false;
	const [start, end] = value.split("-");
	if (!start || !end) return true;
	const toMinutes = (clock: string): number =>
		Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
	return toMinutes(end) >= toMinutes(start);
}

/** 预约记录摘要不包含 provider appointmentInfoId、费用、支付或患者身份字段。 */
export const AppointmentRecordSchema = Type.Object({
	departmentName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	doctorName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	workDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
	workTime: Type.Optional(
		Type.String({
			pattern: APPOINTMENT_RECORD_WORK_TIME_PATTERN,
			maxLength: 11,
		}),
	),
	location: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	serialNumber: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	status: AppointmentRecordStatusSchema,
});

export const AppointmentRecordListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(AppointmentRecordSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** 门诊病历列表只返回已经脱敏的就诊摘要，不返回 regId/patId 等 Provider 标识。 */
export const OutpatientMedicalRecordSchema = Type.Object({
	departmentName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	doctorName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	hospitalName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	clinicTypeName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	chargeClassName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	visitTime: Type.String({ minLength: 1, maxLength: 64 }),
	diagnosis: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
});

export const OutpatientMedicalRecordListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(OutpatientMedicalRecordSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** 报告目录的来源枚举；provider 原始数据和资源 URL 不在公开 contract。 */
export const ReportKindSchema = Type.Union([
	Type.Literal("laboratory"),
	Type.Literal("imaging"),
	Type.Literal("ecg"),
]);

export const ReportSchema = Type.Object({
	/** 仅当服务端详情 gate 打开且已建立短期引用时返回的 opaque id。 */
	reportId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	kind: ReportKindSchema,
	title: Type.String({ minLength: 1, maxLength: 256 }),
	reportedAt: Type.String({ minLength: 1, maxLength: 64 }),
	status: Type.Union([Type.Literal("available"), Type.Literal("abnormal")]),
	hasAttachment: Type.Boolean(),
});

export const ReportListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		items: Type.Array(ReportSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

/** LIS 详情只返回白名单检测项，不返回 provider 报告号、患者字段或文件 URL。 */
export const LaboratoryReportDetailItemSchema = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 256 }),
	result: Type.String({ minLength: 1, maxLength: 256 }),
	unit: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	referenceRange: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	flag: Type.Union([
		Type.Literal("normal"),
		Type.Literal("high"),
		Type.Literal("low"),
		Type.Literal("critical"),
		Type.Literal("unknown"),
	]),
});

export const ReportDetailResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		reportId: Type.String({ minLength: 1, maxLength: 128 }),
		kind: Type.Literal("laboratory"),
		title: Type.String({ minLength: 1, maxLength: 256 }),
		reportedAt: Type.String({ minLength: 1, maxLength: 64 }),
		items: Type.Array(LaboratoryReportDetailItemSchema),
		hasAttachment: Type.Boolean(),
	}),
});

/** 健康知识发布元数据；患者端只看到来源和审核时间，不看到后台审核人。 */
export const HealthKnowledgePublicationSchema = Type.Object({
	contentVersion: Type.String({ minLength: 1, maxLength: 64 }),
	reviewedAt: Type.String({ minLength: 1, maxLength: 64 }),
	sourceLabel: Type.String({ minLength: 1, maxLength: 128 }),
	disclaimer: Type.String({ minLength: 1, maxLength: 512 }),
});

export const HealthKnowledgeCatalogItemSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 128 }),
	name: Type.String({ minLength: 1, maxLength: 256 }),
});

export const HealthKnowledgeLetterItemSchema = Type.Intersect([
	HealthKnowledgeCatalogItemSchema,
	Type.Object({ initialLetter: Type.String({ minLength: 1, maxLength: 8 }) }),
]);

export const HealthKnowledgeDiseaseSummarySchema = Type.Intersect([
	HealthKnowledgeLetterItemSchema,
	Type.Object({
		treatmentDepartment: Type.Optional(
			Type.String({ minLength: 1, maxLength: 500 }),
		),
		symptoms: Type.Optional(Type.String({ minLength: 1, maxLength: 10_000 })),
	}),
]);

/** 可点击药品必须绑定版本内 drugId；纯文本药品说明可以没有 id。 */
export const HealthKnowledgeDrugReferenceSchema = Type.Union([
	Type.Object({
		drugId: Type.String({ minLength: 1, maxLength: 128 }),
		drugName: Type.String({ minLength: 1, maxLength: 256 }),
		isClickable: Type.Literal(true),
	}),
	Type.Object({
		drugId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		drugName: Type.String({ minLength: 1, maxLength: 256 }),
		isClickable: Type.Literal(false),
	}),
]);

/** 疾病正文是审核内容，不代表平台对用户作出诊断或处方。 */
export const HealthKnowledgeDiseaseDetailSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 128 }),
	diseaseName: Type.String({ minLength: 1, maxLength: 256 }),
	diseaseAlias: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	affectedPart: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
	treatmentDepartment: Type.Optional(
		Type.String({ minLength: 1, maxLength: 500 }),
	),
	susceptibleCrowd: Type.Optional(
		Type.String({ minLength: 1, maxLength: 500 }),
	),
	availableDrugs: Type.Array(HealthKnowledgeDrugReferenceSchema),
	cause: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	symptoms: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	examination: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	prevention: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	treatment: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
});

export const HealthKnowledgeDrugDetailSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 128 }),
	drugName: Type.String({ minLength: 1, maxLength: 256 }),
	manufacturer: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	chineseName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	specifications: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
	treatableDiseases: Type.Optional(
		Type.String({ minLength: 1, maxLength: 500 }),
	),
	indications: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	usageDosage: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
	adverseReactions: Type.Optional(
		Type.String({ minLength: 1, maxLength: 100_000 }),
	),
	contraindications: Type.Optional(
		Type.String({ minLength: 1, maxLength: 100_000 }),
	),
	interactions: Type.Optional(
		Type.String({ minLength: 1, maxLength: 100_000 }),
	),
	precautions: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
});

/** 列表 contract 统一携带 publication，避免缓存只按正文 id 判断新旧。 */
export const HealthKnowledgeCatalogResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		publication: HealthKnowledgePublicationSchema,
		items: Type.Array(HealthKnowledgeCatalogItemSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

export const HealthKnowledgeDiseaseListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		publication: HealthKnowledgePublicationSchema,
		items: Type.Array(HealthKnowledgeDiseaseSummarySchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

export const HealthKnowledgeSymptomListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		publication: HealthKnowledgePublicationSchema,
		items: Type.Array(HealthKnowledgeLetterItemSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

export const HealthKnowledgeDiseaseDetailResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		publication: HealthKnowledgePublicationSchema,
		item: HealthKnowledgeDiseaseDetailSchema,
	}),
});

export const HealthKnowledgeDrugDetailResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		publication: HealthKnowledgePublicationSchema,
		item: HealthKnowledgeDrugDetailSchema,
	}),
});

/** 创建订单只引用服务端报价，客户端不能提交医保金额或现金金额。 */
export const PaymentOrderCreateRequest = Type.Object({
	patientId: Type.String({ minLength: 1, maxLength: 128 }),
	quoteId: Type.String({ minLength: 1, maxLength: 128 }),
});

/** 门诊费用状态由服务端根据 provider 合同映射，小程序不得自行推导。 */
export const OutpatientPaymentStatusSchema = Type.Union([
	Type.Literal("unpaid"),
	Type.Literal("paid"),
]);

/** 门诊费用只返回展示所需字段；订单号、患者卡号和医保字段留在服务端。 */
export const OutpatientPaymentRecordSchema = Type.Object({
	recordId: Type.String({ minLength: 1, maxLength: 128 }),
	status: OutpatientPaymentStatusSchema,
	departmentName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	doctorName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	billDate: Type.String({ minLength: 1, maxLength: 64 }),
	amountFen: Type.Integer({ minimum: 0 }),
});

export const OutpatientPaymentListResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		status: OutpatientPaymentStatusSchema,
		items: Type.Array(OutpatientPaymentRecordSchema),
		total: Type.Integer({ minimum: 0 }),
	}),
});

export const ReadyResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		status: Type.Union([Type.Literal("ready"), Type.Literal("not_ready")]),
		dependencies: Type.Object({
			database: DependencyStateSchema,
			redis: DependencyStateSchema,
			/** schema gate 关闭时禁止发布系统误报为 ready。 */
			schema: DependencyStateSchema,
		}),
	}),
});

export const ErrorResponse = Type.Object({
	success: Type.Literal(false),
	error: Type.Object({
		code: Type.String(),
		message: Type.String(),
	}),
});

export const PingResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		service: Type.String(),
		apiVersion: Type.String(),
	}),
});

/** 支付状态是后端事实模型；小程序不得自行推导或跳过状态。 */
export const PaymentStateSchema = Type.Union([
	Type.Literal("created"),
	Type.Literal("authorized"),
	Type.Literal("pre_settled"),
	Type.Literal("insurance_submitted"),
	Type.Literal("insurance_settled"),
	Type.Literal("cash_pending"),
	Type.Literal("cash_paid"),
	Type.Literal("his_written_back"),
	Type.Literal("awaiting_confirmation"),
	Type.Literal("completed"),
	Type.Literal("failed"),
	Type.Literal("cancelled"),
]);

/** 支付订单金额为后端 quote 的脱敏读模型，单位始终是人民币分。 */
export const PaymentAmountsSchema = Type.Object({
	totalFen: Type.Integer({ minimum: 1 }),
	insuranceFen: Type.Integer({ minimum: 0 }),
	cashFen: Type.Integer({ minimum: 0 }),
});

export const PaymentOrderSchema = Type.Object({
	orderId: Type.String({ minLength: 1 }),
	patientId: Type.String({ minLength: 1 }),
	amounts: PaymentAmountsSchema,
	state: PaymentStateSchema,
	version: Type.Integer({ minimum: 1 }),
	createdAt: Type.String({ minLength: 1 }),
	updatedAt: Type.String({ minLength: 1 }),
});

/** 订单响应不暴露 ownerUserId、idempotencyKey 或 provider 原始字段。 */
export const PaymentOrderResponse = Type.Object({
	success: Type.Literal(true),
	data: PaymentOrderSchema,
});

/** 服务端生成的微信小程序调起参数；不包含订单 owner 或 provider 原始报文。 */
export const WechatMiniProgramPayParamsSchema = Type.Object({
	appId: Type.String({ minLength: 1 }),
	timeStamp: Type.String({ minLength: 1 }),
	nonceStr: Type.String({ minLength: 1 }),
	package: Type.String({ minLength: 1 }),
	signType: Type.Literal("RSA"),
	paySign: Type.String({ minLength: 1 }),
});

/** 预支付接口只表示参数已生成，不表示微信支付成功或业务订单完成。 */
export const WechatPrepayResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		orderId: Type.String({ minLength: 1 }),
		state: PaymentStateSchema,
		payParams: WechatMiniProgramPayParamsSchema,
	}),
});

/** 预支付尝试状态是持久化读模型，不代表订单已经完成支付。 */
export const WechatPrepayStatusResponse = Type.Object({
	success: Type.Literal(true),
	data: Type.Object({
		orderId: Type.String({ minLength: 1 }),
		state: PaymentStateSchema,
		status: Type.Union([
			Type.Literal("not_started"),
			Type.Literal("pending"),
			Type.Literal("ready"),
			Type.Literal("unknown"),
		]),
		payParams: Type.Optional(WechatMiniProgramPayParamsSchema),
	}),
});

export type PaymentState = Static<typeof PaymentStateSchema>;

export type HealthPayload = Static<typeof HealthResponse>;
export type ReadyPayload = Static<typeof ReadyResponse>;
export type PingPayload = Static<typeof PingResponse>;
export type ErrorPayload = Static<typeof ErrorResponse>;
export type WechatLoginPayload = Static<typeof WechatLoginRequest>;
export type AuthSessionPayload = Static<typeof AuthSessionResponse>;
export type CurrentUserPayload = Static<typeof CurrentUserResponse>;
export type UserProfilePayload = Static<typeof UserProfileResponse>;
export type UserProfileUpdatePayload = Static<typeof UserProfileUpdateRequest>;
export type PatientPayload = Static<typeof PatientSchema>;
export type PatientListPayload = Static<typeof PatientListResponse>;
export type AppointmentDepartmentPayload = Static<
	typeof AppointmentDepartmentSchema
>;
export type AppointmentDepartmentListPayload = Static<
	typeof AppointmentDepartmentListResponse
>;
export type AppointmentSchedulePayload = Static<
	typeof AppointmentScheduleSchema
>;
export type AppointmentScheduleListPayload = Static<
	typeof AppointmentScheduleListResponse
>;
export type AppointmentRecordPayload = Static<typeof AppointmentRecordSchema>;
export type AppointmentRecordListPayload = Static<
	typeof AppointmentRecordListResponse
>;
export type OutpatientMedicalRecordPayload = Static<
	typeof OutpatientMedicalRecordSchema
>;
export type OutpatientMedicalRecordListPayload = Static<
	typeof OutpatientMedicalRecordListResponse
>;
export type ReportPayload = Static<typeof ReportSchema>;
export type ReportListPayload = Static<typeof ReportListResponse>;
export type ReportDetailPayload = Static<typeof ReportDetailResponse>;
export type HealthKnowledgePublicationPayload = Static<
	typeof HealthKnowledgePublicationSchema
>;
export type HealthKnowledgeCatalogItemPayload = Static<
	typeof HealthKnowledgeCatalogItemSchema
>;
export type HealthKnowledgeDiseaseSummaryPayload = Static<
	typeof HealthKnowledgeDiseaseSummarySchema
>;
export type HealthKnowledgeCatalogResponsePayload = Static<
	typeof HealthKnowledgeCatalogResponse
>;
export type HealthKnowledgeDiseaseListResponsePayload = Static<
	typeof HealthKnowledgeDiseaseListResponse
>;
export type HealthKnowledgeSymptomListResponsePayload = Static<
	typeof HealthKnowledgeSymptomListResponse
>;
export type HealthKnowledgeDiseaseDetailResponsePayload = Static<
	typeof HealthKnowledgeDiseaseDetailResponse
>;
export type HealthKnowledgeDrugDetailResponsePayload = Static<
	typeof HealthKnowledgeDrugDetailResponse
>;
export type PaymentOrderCreatePayload = Static<
	typeof PaymentOrderCreateRequest
>;
export type OutpatientPaymentStatusPayload = Static<
	typeof OutpatientPaymentStatusSchema
>;
export type OutpatientPaymentRecordPayload = Static<
	typeof OutpatientPaymentRecordSchema
>;
export type OutpatientPaymentListPayload = Static<
	typeof OutpatientPaymentListResponse
>;
export type PaymentAmountsPayload = Static<typeof PaymentAmountsSchema>;
export type PaymentOrderPayload = Static<typeof PaymentOrderResponse>;
export type WechatPrepayPayload = Static<typeof WechatPrepayResponse>;
export type WechatPrepayStatusPayload = Static<
	typeof WechatPrepayStatusResponse
>;

export function success<const T>(data: T): { success: true; data: T } {
	return { success: true, data };
}
