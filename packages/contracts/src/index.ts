import { Type, type Static } from "@sinclair/typebox";

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

export type PaymentState = Static<typeof PaymentStateSchema>;

export type HealthPayload = Static<typeof HealthResponse>;
export type ReadyPayload = Static<typeof ReadyResponse>;
export type PingPayload = Static<typeof PingResponse>;
export type ErrorPayload = Static<typeof ErrorResponse>;
export type WechatLoginPayload = Static<typeof WechatLoginRequest>;
export type AuthSessionPayload = Static<typeof AuthSessionResponse>;
export type PatientPayload = Static<typeof PatientSchema>;
export type PatientListPayload = Static<typeof PatientListResponse>;
export type PaymentOrderCreatePayload = Static<
	typeof PaymentOrderCreateRequest
>;
export type PaymentAmountsPayload = Static<typeof PaymentAmountsSchema>;
export type PaymentOrderPayload = Static<typeof PaymentOrderResponse>;

export function success<const T>(data: T): { success: true; data: T } {
	return { success: true, data };
}
