import { success } from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import {
	AdminWechatRefundInputError,
	type AdminWechatRefundService,
} from "./wechat-refund-service";
import {
	WechatRefundAmountExceededError,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
} from "@hospital/domain";

const AdminRefundHeaders = t.Object({
	"x-admin-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AdminRefundBody = t.Object(
	{
		source: t.Union([
			t.Literal("payment_order"),
			t.Literal("medical_insurance"),
		]),
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
	throw error;
}

export function adminWechatRefundModule(
	service: Pick<AdminWechatRefundService, "request" | "query">,
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
