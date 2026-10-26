import { success } from "@hospital/contracts";
import {
	MedicalInsuranceRefundAmountExceededError,
	WechatRefundAmountExceededError,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
} from "@hospital/domain";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "../medical-insurance/errors";
import type { MedicalInsuranceRefundService } from "../medical-insurance/refund-service";
import type { AdminPaymentRefundService } from "./payment-refund-service";
import {
	AdminPaymentOperationNotConfiguredError,
	AdminPaymentOperationNotFoundError,
	AdminWechatRefundHistoryNotConfiguredError,
	AdminWechatRefundInputError,
	type AdminWechatRefundService,
} from "./wechat-refund-service";

const AdminRefundHeaders = t.Object({
	"x-admin-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AdminRefundBody = t.Object(
	{
		// 医保订单必须走下方的整笔聚合入口，不能在 Admin 里只退微信现金腿。
		source: t.Literal("payment_order"),
		orderId: t.String({ minLength: 1, maxLength: 64 }),
		refundFen: t.Integer({ minimum: 1, maximum: 9_000_000_000_000_000 }),
		idempotencyKey: t.String({ minLength: 1, maxLength: 128 }),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

const AdminRefundParams = t.Object({
	merchantRefundNo: t.String({ minLength: 1, maxLength: 64 }),
});

const AdminRefundHistoryQuery = t.Object(
	{
		source: t.Optional(
			t.Union([t.Literal("payment_order"), t.Literal("medical_insurance")]),
		),
		business: t.Optional(
			t.Union([
				t.Literal("registration"),
				t.Literal("outpatient"),
				t.Literal("other"),
			]),
		),
		orderId: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
		participantName: t.Optional(t.String({ minLength: 1, maxLength: 64 })),
		identityNumber: t.Optional(
			t.String({
				minLength: 15,
				maxLength: 18,
				pattern: "^(?:[0-9]{15}|[0-9]{17}[0-9xX])$",
			}),
		),
		page: t.Optional(t.String({ minLength: 1, maxLength: 5 })),
		pageSize: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
		/** 兼容旧管理端调用；新调用使用 pageSize。 */
		limit: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
		businessDay: t.Optional(t.String({ minLength: 10, maxLength: 10 })),
		status: t.Optional(
			t.Union([
				t.Literal("created"),
				t.Literal("pending"),
				t.Literal("paid"),
				t.Literal("failed"),
				t.Literal("manual_review"),
			]),
		),
	},
	{ additionalProperties: false },
);

const AdminPaymentOperationParams = t.Object({
	aggregateId: t.String({ minLength: 1, maxLength: 64 }),
});

const AdminMedicalInsuranceRefundHeaders = t.Object({
	"x-admin-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"idempotency-key": t.Optional(t.String({ minLength: 1, maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AdminMedicalInsuranceRefundBody = t.Object(
	{
		orderId: t.String({ minLength: 1, maxLength: 64 }),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

const AdminMedicalInsuranceRefundParams = t.Object({
	refundNo: t.String({ minLength: 1, maxLength: 64 }),
});

const AdminPaymentRefundBody = t.Object(
	{
		source: t.Union([
			t.Literal("payment_order"),
			t.Literal("medical_insurance"),
		]),
		orderId: t.String({ minLength: 1, maxLength: 64 }),
		refundType: t.Union([t.Literal("ALL"), t.Literal("HI"), t.Literal("CASH")]),
		reason: t.Optional(t.String({ maxLength: 80 })),
	},
	{ additionalProperties: false },
);

const AdminPaymentRefundParams = t.Object({
	source: t.Union([t.Literal("payment_order"), t.Literal("medical_insurance")]),
	orderId: t.String({ minLength: 1, maxLength: 64 }),
});

const AdminPaymentRefundQuery = t.Object(
	{
		refundType: t.Optional(
			t.Union([t.Literal("ALL"), t.Literal("HI"), t.Literal("CASH")]),
		),
	},
	{ additionalProperties: false },
);

function mapPaymentRefundError(error: unknown): never {
	if (error instanceof MedicalInsuranceOrderNotFoundError) {
		throw new HttpError(404, "not_found", "医保订单不存在或尚未落库");
	}
	if (error instanceof MedicalInsuranceRegistrationInputError) {
		throw new HttpError(400, "validation", error.message);
	}
	return mapError(error);
}

export function adminPaymentRefundModule(
	service: Pick<AdminPaymentRefundService, "request" | "query">,
	adminRefundToken: string,
) {
	return new Elysia({ name: "admin-payment-refunds-module" })
		.post(
			"/admin/payment-refunds",
			async ({ headers, body }) => {
				authorize(adminRefundToken, headers);
				try {
					return success(
						await service.request({
							source: body.source,
							orderId: body.orderId,
							refundType: body.refundType,
							...(body.reason !== undefined ? { reason: body.reason } : {}),
							context: adapterContextFromHeaders(headers),
						}),
					);
				} catch (error) {
					return mapPaymentRefundError(error);
				}
			},
			{
				headers: AdminMedicalInsuranceRefundHeaders,
				body: AdminPaymentRefundBody,
				detail: { hide: true },
			},
		)
		.get(
			"/admin/payment-refunds/:source/:orderId",
			async ({ headers, params, query }) => {
				authorize(adminRefundToken, headers);
				try {
					return success(
						await service.query({
							...params,
							...(query.refundType ? { refundType: query.refundType } : {}),
							context: adapterContextFromHeaders(headers),
						}),
					);
				} catch (error) {
					return mapPaymentRefundError(error);
				}
			},
			{
				headers: AdminMedicalInsuranceRefundHeaders,
				params: AdminPaymentRefundParams,
				query: AdminPaymentRefundQuery,
				detail: { hide: true },
			},
		);
}

function constantTimeEqual(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
}

function authorize(
	token: string,
	headers: Record<string, string | undefined>,
): void {
	const expectedToken = token.trim();
	if (!expectedToken)
		throw new HttpError(503, "admin-not-configured", "管理端退费尚未配置");
	if (
		!constantTimeEqual(headers["x-admin-refund-token"] ?? "", expectedToken)
	) {
		throw new HttpError(401, "admin-unauthorized", "管理端退费令牌无效");
	}
}

function mapError(error: unknown): never {
	if (error instanceof MedicalInsuranceRefundAmountExceededError) {
		throw new HttpError(409, "refund_amount_exceeded", error.message);
	}
	if (error instanceof AdminWechatRefundInputError) {
		throw new HttpError(400, "validation", error.message);
	}
	if (error instanceof WechatRefundNotFoundError) {
		throw new HttpError(404, "not_found", "退款订单不存在或尚未落库");
	}
	if (error instanceof WechatRefundAmountExceededError) {
		throw new HttpError(
			409,
			"refund_amount_exceeded",
			"退费金额超过可退自费金额",
		);
	}
	if (error instanceof WechatRefundIdempotencyConflictError) {
		throw new HttpError(
			409,
			"idempotency_conflict",
			"退费幂等键与已有退款不一致",
		);
	}
	if (error instanceof AdminWechatRefundHistoryNotConfiguredError) {
		throw new HttpError(503, "admin-not-configured", "管理端退费历史尚未配置");
	}
	if (error instanceof AdminPaymentOperationNotConfiguredError) {
		throw new HttpError(503, "admin-not-configured", "支付运营账本尚未配置");
	}
	if (error instanceof AdminPaymentOperationNotFoundError) {
		throw new HttpError(404, "not_found", "支付聚合单不存在或尚未投影");
	}
	throw error;
}

function historyPage(value: string | undefined): number {
	if (value === undefined) return 1;
	if (!/^[1-9][0-9]*$/u.test(value)) {
		throw new HttpError(400, "validation", "page 必须是正整数");
	}
	const page = Number(value);
	if (!Number.isSafeInteger(page) || page > 10000) {
		throw new HttpError(400, "validation", "page 必须是 1 到 10000 的整数");
	}
	return page;
}

function historyPageSize(value: string | undefined): number {
	if (value === undefined) return 50;
	if (!/^[1-9][0-9]*$/u.test(value)) {
		throw new HttpError(400, "validation", "pageSize 必须是 1 到 100 的整数");
	}
	const pageSize = Number(value);
	if (!Number.isSafeInteger(pageSize) || pageSize > 100) {
		throw new HttpError(400, "validation", "pageSize 必须是 1 到 100 的整数");
	}
	return pageSize;
}

export function adminWechatRefundModule(
	service: Pick<
		AdminWechatRefundService,
		"request" | "query" | "listPaymentHistory"
	> &
		Partial<Pick<AdminWechatRefundService, "getPaymentOperationDetail">>,
	adminRefundToken: string,
) {
	return new Elysia({ name: "admin-wechat-refunds-module" })
		.post(
			"/admin/wechat-refunds",
			async ({ headers, body }) => {
				authorize(adminRefundToken, headers);
				try {
					return success(
						await service.request(body, adapterContextFromHeaders(headers)),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{
				headers: AdminRefundHeaders,
				body: AdminRefundBody,
				detail: { hide: true },
			},
		)
		.get(
			"/admin/payment-operations/:aggregateId",
			async ({ headers, params }) => {
				authorize(adminRefundToken, headers);
				try {
					const detail = service.getPaymentOperationDetail;
					if (!detail) throw new AdminPaymentOperationNotConfiguredError();
					return success(
						await detail.call(service, params.aggregateId, {
							...(headers["x-request-id"]
								? { requestId: headers["x-request-id"] }
								: {}),
						}),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{
				headers: AdminRefundHeaders,
				params: AdminPaymentOperationParams,
				detail: { hide: true },
			},
		)
		.get(
			"/admin/wechat-refund-payments",
			async ({ headers, query }) => {
				authorize(adminRefundToken, headers);
				try {
					return success(
						await service.listPaymentHistory({
							page: historyPage(query.page),
							pageSize: historyPageSize(query.pageSize ?? query.limit),
							...(query.source ? { source: query.source } : {}),
							...(query.business ? { business: query.business } : {}),
							...(query.orderId?.trim()
								? { orderId: query.orderId.trim() }
								: {}),
							...(query.participantName?.trim()
								? { participantName: query.participantName.trim() }
								: {}),
							...(query.identityNumber?.trim()
								? { identityNumber: query.identityNumber.trim() }
								: {}),
							...(query.businessDay ? { businessDay: query.businessDay } : {}),
							...(query.status ? { status: query.status } : {}),
						}),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{
				headers: AdminRefundHeaders,
				query: AdminRefundHistoryQuery,
				detail: { hide: true },
			},
		)
		.get(
			"/admin/wechat-refunds/:merchantRefundNo",
			async ({ headers, params }) => {
				authorize(adminRefundToken, headers);
				try {
					return success(
						await service.query(
							params.merchantRefundNo,
							adapterContextFromHeaders(headers),
						),
					);
				} catch (error) {
					return mapError(error);
				}
			},
			{
				headers: AdminRefundHeaders,
				params: AdminRefundParams,
				detail: { hide: true },
			},
		);
}

/**
 * Admin 医保订单只提供整笔聚合退费入口；医保 6203 与微信 APIv3 现金腿
 * 由 MedicalInsuranceRefundService 在服务端一次编排，浏览器不能选择单腿。
 */
export function adminMedicalInsuranceRefundModule(
	service: Pick<
		MedicalInsuranceRefundService,
		"requestFullRefundByOrder" | "query"
	>,
	adminRefundToken: string,
	paymentRefundService?: Pick<AdminPaymentRefundService, "request">,
) {
	return new Elysia({ name: "admin-medical-insurance-refunds-module" })
		.post(
			"/admin/medical-insurance-refunds",
			async ({ headers, body }) => {
				authorize(adminRefundToken, headers);
				try {
					if (paymentRefundService) {
						return success(
							await paymentRefundService.request({
								source: "medical_insurance",
								orderId: body.orderId,
								refundType: "ALL",
								...(body.reason !== undefined ? { reason: body.reason } : {}),
								context: adapterContextFromHeaders(headers),
							}),
						);
					}
					return success(
						await service.requestFullRefundByOrder({
							orderId: body.orderId,
							...(body.reason !== undefined ? { reason: body.reason } : {}),
							context: adapterContextFromHeaders(headers),
						}),
					);
				} catch (error) {
					return mapPaymentRefundError(error);
				}
			},
			{
				headers: AdminMedicalInsuranceRefundHeaders,
				body: AdminMedicalInsuranceRefundBody,
				detail: { hide: true },
			},
		)
		.get(
			"/admin/medical-insurance-refunds/:refundNo",
			async ({ headers, params }) => {
				authorize(adminRefundToken, headers);
				const result = await service.query(
					params.refundNo,
					headers["x-request-id"] ? { requestId: headers["x-request-id"] } : {},
				);
				if (!result) {
					throw new HttpError(404, "not_found", "医保退费记录不存在");
				}
				return success(result);
			},
			{
				headers: AdminRefundHeaders,
				params: AdminMedicalInsuranceRefundParams,
				detail: { hide: true },
			},
		);
}
