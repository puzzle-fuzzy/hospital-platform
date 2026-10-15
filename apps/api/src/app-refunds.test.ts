import { expect, test } from "bun:test";
import { createApp } from "./app";
import {
	type ApplicationServices,
	createDefaultApplicationServices,
} from "./application";
import type {
	AdminPaymentRefundResult,
	AdminPaymentRefundService,
} from "./modules/admin/payment-refund-service";

const token = "admin-refund-composition-token";
const orderId = "medical-refund-composition-001";
const path = "/api/v1/admin/payment-refunds";
const result: AdminPaymentRefundResult = {
	source: "medical_insurance",
	orderId,
	refundType: "ALL",
	status: "succeeded",
	amounts: {
		totalFen: 1000,
		cashFen: 200,
		personalAccountFen: 0,
		fundFen: 800,
	},
};

function fixture(
	options: { withoutToken?: boolean; withoutService?: boolean } = {},
) {
	const requests: Parameters<AdminPaymentRefundService["request"]>[0][] = [];
	const queries: Parameters<AdminPaymentRefundService["query"]>[0][] = [];
	let legacyCalls = 0;
	const service: Pick<AdminPaymentRefundService, "request" | "query"> = {
		async request(input) {
			requests.push(input);
			return { ...result, source: input.source, refundType: input.refundType };
		},
		async query(input) {
			queries.push(input);
			return {
				...result,
				source: input.source,
				refundType: input.refundType ?? "ALL",
			};
		},
	};
	const services = {
		...createDefaultApplicationServices(),
		...(options.withoutService
			? {}
			: { adminPaymentRefund: service as AdminPaymentRefundService }),
		medicalInsuranceRefund: {
			async requestFullRefundByOrder() {
				legacyCalls += 1;
				throw new Error("legacy request must delegate to the unified service");
			},
		} as unknown as NonNullable<ApplicationServices["medicalInsuranceRefund"]>,
	};
	const app = createApp({
		services,
		...(options.withoutToken ? {} : { adminRefundToken: token }),
	});
	return { app, requests, queries, legacyCalls: () => legacyCalls };
}

function post(body: unknown, suppliedToken = token, target = path) {
	return new Request(`http://localhost${target}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-admin-refund-token": suppliedToken,
			"x-request-id": "refund-composition-trace",
			"idempotency-key": "refund-composition-key",
		},
		body: JSON.stringify(body),
	});
}

test("createApp 装载统一退费服务并传递三种模式和独立查询范围", async () => {
	const f = fixture();
	for (const refundType of ["ALL", "HI", "CASH"] as const) {
		const response = await f.app.handle(
			post({
				source: "medical_insurance",
				orderId,
				refundType,
				reason: "原路退回",
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: { ...result, refundType },
		});
		expect(f.requests.at(-1)).toEqual({
			source: "medical_insurance",
			orderId,
			refundType,
			reason: "原路退回",
			context: {
				traceId: "refund-composition-trace",
				idempotencyKey: "refund-composition-key",
			},
		});
	}
	const queried = await f.app.handle(
		new Request(
			`http://localhost${path}/medical_insurance/${orderId}?refundType=HI`,
			{
				headers: {
					"x-admin-refund-token": token,
					"x-request-id": "refund-composition-query",
				},
			},
		),
	);
	expect(queried.status).toBe(200);
	expect(f.queries).toEqual([
		{
			source: "medical_insurance",
			orderId,
			refundType: "HI",
			context: {
				traceId: "refund-composition-query",
				idempotencyKey: "refund-composition-query",
			},
		},
	]);
	expect(f.legacyCalls()).toBe(0);
});

test("createApp 统一退费请求和查询先校验内部令牌，患者 bearer 不能替代", async () => {
	const f = fixture();
	const body = { source: "medical_insurance", orderId, refundType: "ALL" };
	expect((await f.app.handle(post(body, "wrong-token"))).status).toBe(401);
	expect(
		(
			await f.app.handle(
				new Request(`http://localhost${path}/medical_insurance/${orderId}`, {
					headers: { "x-admin-refund-token": "wrong-token" },
				}),
			)
		).status,
	).toBe(401);
	expect(
		(
			await f.app.handle(
				new Request(`http://localhost${path}`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						authorization: "Bearer patient-session",
					},
					body: JSON.stringify(body),
				}),
			)
		).status,
	).toBe(400);
	expect(f.requests).toEqual([]);
	expect(f.queries).toEqual([]);
});

test("createApp 拒绝客户端覆盖退款金额和身份，非法模式不进入服务", async () => {
	const f = fixture();
	const body = { source: "medical_insurance", orderId, refundType: "ALL" };
	for (const patch of [
		{ refundFen: 1 },
		{ amounts: { totalFen: 1, cashFen: 1, fundFen: 0, personalAccountFen: 0 } },
		{ merchantRefundNo: "client-refund-no" },
		{ refundType: "OTHER" },
		{ source: "other" },
	]) {
		expect((await f.app.handle(post({ ...body, ...patch }))).status).toBe(400);
	}
	expect(
		(await f.app.handle(post({ source: "medical_insurance", orderId }))).status,
	).toBe(400);
	expect(f.requests).toEqual([]);
});

test("createApp 旧整笔医保入口委托统一服务 ALL，客户端不能把旧入口改成单腿", async () => {
	const f = fixture();
	const legacyPath = "/api/v1/admin/medical-insurance-refunds";
	expect(
		(
			await f.app.handle(
				post({ orderId, reason: "整笔退费" }, token, legacyPath),
			)
		).status,
	).toBe(200);
	expect(f.requests).toEqual([
		{
			source: "medical_insurance",
			orderId,
			refundType: "ALL",
			reason: "整笔退费",
			context: {
				traceId: "refund-composition-trace",
				idempotencyKey: "refund-composition-key",
			},
		},
	]);
	expect(
		(
			await f.app.handle(
				post({ orderId, refundType: "CASH" }, token, legacyPath),
			)
		).status,
	).toBe(400);
	expect(
		(await f.app.handle(post({ orderId }, "wrong-token", legacyPath))).status,
	).toBe(401);
	expect(f.requests).toHaveLength(1);
	expect(f.legacyCalls()).toBe(0);
});

test("createApp 未配置统一服务或退款令牌时不暴露新退费路由", async () => {
	for (const options of [{ withoutService: true }, { withoutToken: true }]) {
		const f = fixture(options);
		expect(
			(
				await f.app.handle(
					post({ source: "medical_insurance", orderId, refundType: "ALL" }),
				)
			).status,
		).toBe(404);
		expect(f.requests).toEqual([]);
	}
});
