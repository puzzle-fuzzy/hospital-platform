import { expect, test } from "bun:test";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import {
	adminMedicalInsuranceRefundModule,
	adminWechatRefundModule,
} from "./refunds";
import type {
	AdminWechatRefundHistoryQuery,
	AdminWechatRefundPaymentRecord,
} from "./wechat-refund-service";

const historyRecord: AdminWechatRefundPaymentRecord = {
	source: "payment_order",
	orderId: "payment-history-route-001",
	business: "outpatient",
	patientDisplayName: "测试就诊人",
	orderUserDisplayName: "测试下单用户",
	totalFen: 500,
	insuranceFen: 0,
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
					return {
						items: [historyRecord],
						total: 1,
						page: input.page ?? 1,
						pageSize: input.pageSize ?? 50,
					};
				},
			},
			"admin-refund-token-001",
		),
	);

	const response = await app.handle(
		new Request(
			"http://localhost/admin/wechat-refund-payments?source=payment_order&limit=20&businessDay=2026-09-18&status=paid",
			{
				headers: {
					"x-admin-refund-token": "admin-refund-token-001",
				},
			},
		),
	);

	expect(response.status).toBe(200);
	expect(query).toEqual({
		source: "payment_order",
		page: 1,
		pageSize: 20,
		businessDay: "2026-09-18",
		status: "paid",
	});
	expect(await response.json()).toEqual({
		success: true,
		data: {
			items: [historyRecord],
			total: 1,
			page: 1,
			pageSize: 20,
		},
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

test("Admin 医保订单退费固定走医保+微信整笔聚合入口", async () => {
	let requestInput:
		| {
				orderId: string;
				reason?: string;
				context: unknown;
		  }
		| undefined;
	const aggregate = {
		orderId: "medical-admin-refund-001",
		refundNo: "RFMIabcdef",
		status: "processing" as const,
		medicalStatus: "success" as const,
		wechatStatus: "processing" as const,
		amounts: {
			totalFen: 1000,
			cashFen: 400,
			personalAccountFen: 300,
			fundFen: 300,
		},
	} as const;
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminMedicalInsuranceRefundModule(
			{
				async requestFullRefundByOrder(input) {
					requestInput = input;
					return aggregate;
				},
				async query() {
					return aggregate;
				},
			},
			"admin-refund-token-001",
		),
	);

	const response = await app.handle(
		new Request("http://localhost/admin/medical-insurance-refunds", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-refund-token": "admin-refund-token-001",
				"idempotency-key": "ui-key-001",
				"x-request-id": "admin-request-001",
			},
			body: JSON.stringify({
				orderId: "medical-admin-refund-001",
				reason: "患者申请退费",
			}),
		}),
	);

	expect(response.status).toBe(200);
	expect(requestInput).toEqual({
		orderId: "medical-admin-refund-001",
		reason: "患者申请退费",
		context: {
			traceId: "admin-request-001",
			idempotencyKey: "ui-key-001",
		},
	});
	expect(await response.json()).toEqual({
		success: true,
		data: aggregate,
	});

	const unauthorized = await app.handle(
		new Request("http://localhost/admin/medical-insurance-refunds", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-refund-token": "wrong-token",
			},
			body: JSON.stringify({ orderId: "medical-admin-refund-001" }),
		}),
	);
	expect(unauthorized.status).toBe(401);
});

test("Admin 普通微信退费入口拒绝医保来源，避免拆分医保现金腿", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminWechatRefundModule(
			{
				async request() {
					throw new Error("handler must not run");
				},
				async query() {
					throw new Error("not used");
				},
				async listPaymentHistory() {
					return { items: [], total: 0, page: 1, pageSize: 50 };
				},
			},
			"admin-refund-token-001",
		),
	);

	const response = await app.handle(
		new Request("http://localhost/admin/wechat-refunds", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-refund-token": "admin-refund-token-001",
			},
			body: JSON.stringify({
				source: "medical_insurance",
				orderId: "medical-admin-refund-002",
				refundFen: 100,
				idempotencyKey: "medical-leg-only-001",
			}),
		}),
	);

	expect(response.status).toBeGreaterThanOrEqual(400);
});

test("Admin 支付运营账本详情只返回聚合单、支付腿和低敏事件", async () => {
	const aggregateId = `payagg-${"a".repeat(56)}`;
	const detail = {
		aggregate: {
			aggregateId,
			business: "outpatient" as const,
			businessKey: "medical_insurance:medical-001",
			businessId: "record-001",
			totalFen: 17_600,
			insuranceFen: 6_039,
			cashFen: 11_561,
			status: "paid",
			hisSyncStatus: "pending",
			sourceVersion: 1,
			version: 1,
			createdAt: "2026-09-20T00:00:00.000Z",
			updatedAt: "2026-09-20T00:01:00.000Z",
		},
		legs: [
			{
				legId: `payleg-${"b".repeat(56)}`,
				aggregateId,
				legType: "medical_insurance" as const,
				source: "medical_insurance" as const,
				sourceOrderId: "medical-001",
				amountFen: 6_039,
				status: "confirmed",
				version: 1,
				createdAt: "2026-09-20T00:00:00.000Z",
				updatedAt: "2026-09-20T00:01:00.000Z",
			},
		],
		events: [],
	} as const;
	let requestedAggregateId = "";
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminWechatRefundModule(
			{
				async request() {
					throw new Error("not used");
				},
				async query() {
					throw new Error("not used");
				},
				async listPaymentHistory() {
					throw new Error("not used");
				},
				async getPaymentOperationDetail(id) {
					requestedAggregateId = id;
					return detail;
				},
			},
			"admin-refund-token-001",
		),
	);

	const response = await app.handle(
		new Request(`http://localhost/admin/payment-operations/${aggregateId}`, {
			headers: { "x-admin-refund-token": "admin-refund-token-001" },
		}),
	);

	expect(response.status).toBe(200);
	expect(requestedAggregateId).toBe(aggregateId);
	expect(await response.json()).toEqual({ success: true, data: detail });
});
