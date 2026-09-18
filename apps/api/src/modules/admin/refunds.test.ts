import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { adminWechatRefundModule } from "./refunds";
import type {
	AdminWechatRefundHistoryQuery,
	AdminWechatRefundPaymentRecord,
} from "./wechat-refund-service";

const historyRecord: AdminWechatRefundPaymentRecord = {
	source: "payment_order",
	orderId: "payment-history-route-001",
	business: "outpatient",
	paymentState: "completed",
	cashPaymentConfirmed: true,
	cashFen: 500,
	refundReservedFen: 100,
	refundableFen: 400,
	refundCount: 1,
	latestRefund: {
		merchantRefundNo: "RF-PO-history-route-001",
		status: "success",
		refundFen: 100,
		updatedAt: "2026-09-18T01:01:00.000Z",
	},
	refundRoute: "admin",
	createdAt: "2026-09-18T01:00:00.000Z",
	updatedAt: "2026-09-18T01:01:00.000Z",
};

test("Admin 微信退款历史只接受退款令牌并返回最小支付读模型", async () => {
	let query: AdminWechatRefundHistoryQuery | undefined;
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminWechatRefundModule(
			{
				async request() {
					throw new Error("not used");
				},
				async query() {
					throw new Error("not used");
				},
				async listPaymentHistory(input: AdminWechatRefundHistoryQuery = {}) {
					query = input;
					return [historyRecord];
				},
			},
			"admin-refund-token-001",
		),
	);

	const response = await app.handle(
		new Request(
			"http://localhost/admin/wechat-refund-payments?source=payment_order&limit=20",
			{
				headers: {
					"x-admin-refund-token": "admin-refund-token-001",
				},
			},
		),
	);

	expect(response.status).toBe(200);
	expect(query).toEqual({ source: "payment_order", limit: 20 });
	expect(await response.json()).toEqual({
		success: true,
		data: [historyRecord],
	});

	const unauthorized = await app.handle(
		new Request("http://localhost/admin/wechat-refund-payments", {
			headers: { "x-admin-refund-token": "wrong-token" },
		}),
	);
	expect(unauthorized.status).toBe(401);

	const invalidLimit = await app.handle(
		new Request("http://localhost/admin/wechat-refund-payments?limit=101", {
			headers: { "x-admin-refund-token": "admin-refund-token-001" },
		}),
	);
	expect(invalidLimit.status).toBe(400);
});
