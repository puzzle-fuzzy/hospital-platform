import { success } from "@hospital/contracts";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";
import {
	PaymentSyncAdminInputError,
	type PaymentSyncAdminListInput,
	type PaymentSyncAdminService,
	PaymentSyncAdminTaskConflictError,
	PaymentSyncAdminTaskNotFoundError,
} from "./payment-sync-service";

const AdminPaymentSyncHeaders = t.Object({
	"x-admin-refund-token": t.String({ minLength: 1, maxLength: 512 }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const AdminPaymentSyncQuery = t.Object(
	{
		limit: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
		status: t.Optional(
			t.Union([
				t.Literal("pending"),
				t.Literal("in_progress"),
				t.Literal("succeeded"),
				t.Literal("failed"),
				t.Literal("manual_review"),
			]),
		),
		source: t.Optional(
			t.Union([
				t.Literal("his"),
				t.Literal("medical_insurance"),
				t.Literal("wechat_pay"),
			]),
		),
		kind: t.Optional(
			t.Union([
				t.Literal("pull"),
				t.Literal("reconcile"),
				t.Literal("writeback"),
			]),
		),
		aggregateId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
	},
	{ additionalProperties: false },
);

const AdminPaymentSyncParams = t.Object({
	taskId: t.String({ minLength: 1, maxLength: 64 }),
});

const AdminPaymentSyncManualReviewBody = t.Object(
	{ reason: t.String({ minLength: 1, maxLength: 64 }) },
	{ additionalProperties: false },
);

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

function authorize(token: string, value: string | undefined): void {
	const expected = token.trim();
	if (!expected)
		throw new HttpError(503, "admin-not-configured", "管理端尚未配置");
	if (!constantTimeEqual(value ?? "", expected)) {
		throw new HttpError(401, "admin-unauthorized", "管理端令牌无效");
	}
}

function parseLimit(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (!/^[1-9][0-9]*$/u.test(value)) {
		throw new HttpError(400, "validation", "limit 必须是 1 到 100 的整数");
	}
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit > 100) {
		throw new HttpError(400, "validation", "limit 必须是 1 到 100 的整数");
	}
	return limit;
}

function mapError(error: unknown): never {
	if (error instanceof PaymentSyncAdminInputError) {
		throw new HttpError(400, "validation", error.message);
	}
	if (error instanceof PaymentSyncAdminTaskNotFoundError) {
		throw new HttpError(404, "not_found", "同步任务不存在");
	}
	if (error instanceof PaymentSyncAdminTaskConflictError) {
		throw new HttpError(409, "conflict", error.message);
	}
	throw error;
}

export function adminPaymentSyncModule(
	service: Pick<PaymentSyncAdminService, "list" | "retry" | "markManualReview">,
	adminRefundToken: string,
) {
	return new Elysia({ name: "admin-payment-sync-module" })
		.get(
			"/admin/payment-sync-tasks",
			async ({ headers, query }) => {
				authorize(adminRefundToken, headers["x-admin-refund-token"]);
				try {
					const parsedLimit = parseLimit(query.limit);
					const input: PaymentSyncAdminListInput = {
						...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
						...(query.status ? { status: query.status } : {}),
						...(query.source ? { source: query.source } : {}),
						...(query.kind ? { kind: query.kind } : {}),
						...(query.aggregateId ? { aggregateId: query.aggregateId } : {}),
					};
					return success(await service.list(input));
				} catch (error) {
					return mapError(error);
				}
			},
			{
				headers: AdminPaymentSyncHeaders,
				query: AdminPaymentSyncQuery,
				detail: { hide: true },
			},
		)
		.post(
			"/admin/payment-sync-tasks/:taskId/retry",
			async ({ headers, params }) => {
				authorize(adminRefundToken, headers["x-admin-refund-token"]);
				try {
					return success(
						await service.retry(params.taskId, {
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
				headers: AdminPaymentSyncHeaders,
				params: AdminPaymentSyncParams,
				detail: { hide: true },
			},
		)
		.post(
			"/admin/payment-sync-tasks/:taskId/manual-review",
			async ({ headers, params, body }) => {
				authorize(adminRefundToken, headers["x-admin-refund-token"]);
				try {
					return success(
						await service.markManualReview(params.taskId, body.reason, {
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
				headers: AdminPaymentSyncHeaders,
				params: AdminPaymentSyncParams,
				body: AdminPaymentSyncManualReviewBody,
				detail: { hide: true },
			},
		);
}
