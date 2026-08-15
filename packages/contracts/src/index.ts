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

/** 微信登录 code 只在服务端兑换，前端不得提交 openid、session_key 或 AppSecret。 */
export const WechatLoginRequest = Type.Object({
	code: Type.String({ minLength: 1, maxLength: 256 }),
});

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

/** 关系值是跨 provider 的内部规范，页面显示文案由小程序决定。 */
export const PatientRelationshipSchema = Type.Union([
	Type.Literal("self"),
	Type.Literal("spouse"),
	Type.Literal("child"),
	Type.Literal("parent"),
	Type.Literal("other"),
]);

export const PatientSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
	displayName: Type.String({ minLength: 1 }),
	relationship: PatientRelationshipSchema,
	cardNumberMasked: Type.String({ minLength: 1 }),
	source: Type.Union([
		Type.Literal("hospital-his"),
		Type.Literal("legacy-record"),
	]),
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
	Type.Literal("unknown"),
]);

/** 预约记录摘要不包含 provider appointmentInfoId、费用、支付或患者身份字段。 */
export const AppointmentRecordSchema = Type.Object({
	departmentName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	doctorName: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	workDate: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
	workTime: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
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
		treatmentDepartment: Type.Optional(Type.String({ maxLength: 500 })),
		symptoms: Type.Optional(Type.String({ maxLength: 10_000 })),
	}),
]);

export const HealthKnowledgeDrugReferenceSchema = Type.Object({
	drugId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
	drugName: Type.String({ minLength: 1, maxLength: 256 }),
	isClickable: Type.Boolean(),
});

/** 疾病正文是审核内容，不代表平台对用户作出诊断或处方。 */
export const HealthKnowledgeDiseaseDetailSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 128 }),
	diseaseName: Type.String({ minLength: 1, maxLength: 256 }),
	diseaseAlias: Type.Optional(Type.String({ maxLength: 500 })),
	affectedPart: Type.Optional(Type.String({ maxLength: 500 })),
	treatmentDepartment: Type.Optional(Type.String({ maxLength: 500 })),
	susceptibleCrowd: Type.Optional(Type.String({ maxLength: 500 })),
	availableDrugs: Type.Array(HealthKnowledgeDrugReferenceSchema),
	cause: Type.Optional(Type.String({ maxLength: 100_000 })),
	symptoms: Type.Optional(Type.String({ maxLength: 100_000 })),
	examination: Type.Optional(Type.String({ maxLength: 100_000 })),
	prevention: Type.Optional(Type.String({ maxLength: 100_000 })),
	treatment: Type.Optional(Type.String({ maxLength: 100_000 })),
});

export const HealthKnowledgeDrugDetailSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 128 }),
	drugName: Type.String({ minLength: 1, maxLength: 256 }),
	manufacturer: Type.Optional(Type.String({ maxLength: 256 })),
	chineseName: Type.Optional(Type.String({ maxLength: 256 })),
	specifications: Type.Optional(Type.String({ maxLength: 256 })),
	treatableDiseases: Type.Optional(Type.String({ maxLength: 500 })),
	indications: Type.Optional(Type.String({ maxLength: 100_000 })),
	usageDosage: Type.Optional(Type.String({ maxLength: 100_000 })),
	adverseReactions: Type.Optional(Type.String({ maxLength: 100_000 })),
	contraindications: Type.Optional(Type.String({ maxLength: 100_000 })),
	interactions: Type.Optional(Type.String({ maxLength: 100_000 })),
	precautions: Type.Optional(Type.String({ maxLength: 100_000 })),
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
export type PaymentAmountsPayload = Static<typeof PaymentAmountsSchema>;
export type PaymentOrderPayload = Static<typeof PaymentOrderResponse>;
export type WechatPrepayPayload = Static<typeof WechatPrepayResponse>;
export type WechatPrepayStatusPayload = Static<
	typeof WechatPrepayStatusResponse
>;

export function success<const T>(data: T): { success: true; data: T } {
	return { success: true, data };
}
