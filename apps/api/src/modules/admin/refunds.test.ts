import { expect, test } from "bun:test";
import { MedicalInsuranceRefundAmountExceededError } from "@hospital/domain";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import {
	adminMedicalInsuranceRefundModule,
	adminPaymentRefundModule,
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
	actualCashFen: 500,
	hospitalDiscountFen: 0,
	actualPaidFen: 500,
	amountBreakdownStatus: "confirmed",
	medicalRefundableFen: 0,
	refundOptions: {
		ALL: { enabled: true, amountFen: 400 },
		HI: { enabled: false, amountFen: 0 },
		CASH: { enabled: true, amountFen: 400 },
	},
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

test("Admin 支付退费按所选腿请求，拒绝覆盖金额，并允许独立对账", async () => {
	const calls: unknown[] = [];
	const result = {
		source: "medical_insurance" as const,
		orderId: "medical-selected-leg-001",
		refundType: "HI" as const,
		status: "succeeded" as const,
		amounts: { totalFen: 800, cashFen: 0, personalAccountFen: 0, fundFen: 800 },
	};
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminPaymentRefundModule(
			{
				async request(input) {
					calls.push(input);
					return result;
				},
				async query(input) {
					calls.push(input);
					return result;
				},
			},
			"admin-options-token",
		),
	);
	const post = (body: unknown, token = "admin-options-token") =>
		app.handle(
			new Request("http://localhost/admin/payment-refunds", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-admin-refund-token": token,
					"x-request-id": "refund-mode-trace",
					"idempotency-key": "refund-mode-key",
				},
				body: JSON.stringify(body),
			}),
		);
	expect(
		(
			await post({
				source: "medical_insurance",
				orderId: result.orderId,
				refundType: "HI",
				reason: "原路退回",
			})
		).status,
	).toBe(200);
	expect(calls[0]).toEqual({
		source: "medical_insurance",
		orderId: result.orderId,
		refundType: "HI",
		reason: "原路退回",
		context: {
			traceId: "refund-mode-trace",
			idempotencyKey: "refund-mode-key",
		},
	});
	expect(
		(
			await post(
				{
					source: "medical_insurance",
					orderId: result.orderId,
					refundType: "ALL",
				},
				"wrong",
			)
		).status,
	).toBe(401);
	expect(
		(
			await post({
				source: "medical_insurance",
				orderId: result.orderId,
				refundType: "ALL",
				refundFen: 1,
			})
		).status,
	).toBe(200);
	expect(calls[1]).not.toHaveProperty("refundFen");
	expect(
		(
			await post({
				source: "medical_insurance",
				orderId: result.orderId,
				refundType: "OTHER",
			})
		).status,
	).toBe(400);
	expect(calls).toHaveLength(2);
	const query = await app.handle(
		new Request(
			`http://localhost/admin/payment-refunds/medical_insurance/${result.orderId}`,
			{
				headers: {
					"x-admin-refund-token": "admin-options-token",
					"x-request-id": "refund-query-trace",
				},
			},
		),
	);
	expect(query.status).toBe(200);
	expect(calls[2]).toEqual({
		source: "medical_insurance",
		orderId: result.orderId,
		context: {
			traceId: "refund-query-trace",
			idempotencyKey: "refund-query-trace",
		},
	});
});

test("旧 Admin 整笔医保退费入口在提供统一服务时只委托 ALL", async () => {
	let legacyCalls = 0;
	let delegated: unknown;
	const result = {
		source: "medical_insurance" as const,
		orderId: "medical-compat-001",
		refundType: "ALL" as const,
		status: "succeeded" as const,
		amounts: { totalFen: 800, cashFen: 0, personalAccountFen: 0, fundFen: 800 },
	};
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminMedicalInsuranceRefundModule(
			{
				async requestFullRefundByOrder() {
					legacyCalls += 1;
					throw new Error("legacy orchestration must not execute");
				},
				async query() {
					return undefined;
				},
			},
			"admin-compat-token",
			{
				async request(input) {
					delegated = input;
					return result;
				},
			},
		),
	);
	const response = await app.handle(
		new Request("http://localhost/admin/medical-insurance-refunds", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-refund-token": "admin-compat-token",
				"x-request-id": "compat-trace",
			},
			body: JSON.stringify({ orderId: result.orderId }),
		}),
	);
	expect(response.status).toBe(200);
	expect(legacyCalls).toBe(0);
	expect(delegated).toEqual({
		source: "medical_insurance",
		orderId: result.orderId,
		refundType: "ALL",
		context: { traceId: "compat-trace", idempotencyKey: "compat-trace" },
	});
});

test("Admin 医保分项已被其它入口占用时返回冲突，不能当成服务故障", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).use(
		adminPaymentRefundModule(
			{
				async request() {
					throw new MedicalInsuranceRefundAmountExceededError();
				},
				async query() {
					throw new Error("not used");
				},
			},
			"admin-budget-token",
		),
	);
	const response = await app.handle(
		new Request("http://localhost/admin/payment-refunds", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-admin-refund-token": "admin-budget-token",
			},
			body: JSON.stringify({
				source: "medical_insurance",
				orderId: "medical-budget-order",
				refundType: "HI",
			}),
		}),
	);
	expect(response.status).toBe(409);
});

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
			actualCashFen: 11_561,
			hospitalDiscountFen: 0,
			actualPaidFen: 17_600,
			amountBreakdownStatus: "confirmed",
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
