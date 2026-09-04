import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type {
	PaymentOrder,
	PaymentOrderRepository,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	WechatPaymentGateway,
} from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	MAX_PAYMENT_QUERY_ATTEMPTS,
	PaymentReconciliationWorker,
} from "./payment-reconciliation-worker";

const now = new Date("2026-08-15T00:00:00.000Z");
const order: PaymentOrder = {
	orderId: "order-worker-001",
	ownerUserId: "user-worker-001",
	patientId: "patient-worker-001",
	idempotencyKey: "order-worker-key-001",
	amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
	state: "cash_pending",
	version: 4,
	createdAt: now.toISOString(),
	updatedAt: now.toISOString(),
};

function createOrderRepository(seed: PaymentOrder): {
	repository: PaymentOrderRepository;
	read(): PaymentOrder;
} {
	let current = seed;
	const repository: PaymentOrderRepository = {
		async findById(orderId) {
			return current.orderId === orderId ? current : undefined;
		},
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			return current.ownerUserId === ownerUserId &&
				current.idempotencyKey === idempotencyKey
				? current
				: undefined;
		},
		async findByOwnerAndId(ownerUserId, orderId) {
			return current.ownerUserId === ownerUserId && current.orderId === orderId
				? current
				: undefined;
		},
		async insert() {
			throw new Error("insert is not used by reconciliation tests");
		},
		async update(updated, expectedVersion) {
			if (current.version !== expectedVersion) {
				throw new Error("version conflict");
			}
			current = updated;
			return current;
		},
	};
	return { repository, read: () => current };
}

function createAttemptRepository(seed: PaymentPrepayAttempt): {
	repository: PaymentPrepayAttemptRepository;
	read(): PaymentPrepayAttempt;
} {
	let current = seed;
	const repository: PaymentPrepayAttemptRepository = {
		async findByOwnerOrderAndIdempotencyKey() {
			return current;
		},
		async insert(attempt) {
			current = attempt;
			return current;
		},
		async update(attempt, expectedVersion) {
			if (current.version !== expectedVersion) {
				throw new Error("attempt version conflict");
			}
			current = attempt;
			return current;
		},
		async claimDueForQuery(queryNow, limit, leaseMs) {
			if (
				limit <= 0 ||
				leaseMs <= 0 ||
				current.status === "manual_review" ||
				!current.nextQueryAt ||
				new Date(current.nextQueryAt).getTime() > queryNow.getTime() ||
				(current.queryClaimedUntil &&
					new Date(current.queryClaimedUntil).getTime() > queryNow.getTime())
			) {
				return [];
			}
			current = {
				...current,
				queryClaimedUntil: new Date(queryNow.getTime() + leaseMs).toISOString(),
				// 测试替身也要模拟数据库 claim 的版本递增，否则无法覆盖
				// worker 使用新版本更新、旧 worker 被版本栅栏拒绝的约束。
				version: current.version + 1,
				updatedAt: queryNow.toISOString(),
			};
			return [current];
		},
	};
	return { repository, read: () => current };
}

function gatewayFor(
	query: WechatPaymentGateway["query"],
): WechatPaymentGateway {
	return {
		createJsapiOrder: async () => {
			throw new Error("prepay is not used by reconciliation tests");
		},
		query,
	};
}

function attempt(): PaymentPrepayAttempt {
	return {
		attemptId: "attempt-worker-001",
		ownerUserId: order.ownerUserId,
		orderId: order.orderId,
		provider: "wechat-pay",
		idempotencyKey: "prepay-worker-key-001",
		status: "succeeded",
		version: 2,
		queryAttempts: 0,
		nextQueryAt: now.toISOString(),
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

test("reconciliation worker confirms a matching cash payment and clears its schedule", async () => {
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository(attempt());
	let providerCalls = 0;
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => {
			providerCalls += 1;
			return {
				state: "cash_paid",
				totalFen: 300,
				trace: {
					provider: "wechat-pay",
					operation: "order-query",
					requestId: "provider-query-001",
				},
			};
		}),
	});

	await expect(worker.runOnce(now)).resolves.toBe("reconciled");
	expect(providerCalls).toBe(1);
	expect(orders.read()).toMatchObject({ state: "cash_paid", version: 5 });
	expect(attempts.read()).toMatchObject({
		queryAttempts: 1,
		lastQueriedAt: now.toISOString(),
	});
	expect(attempts.read().nextQueryAt).toBeUndefined();
});

test("reconciliation worker schedules another query for an explicit NOTPAY result", async () => {
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository(attempt());
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => ({
			state: "cash_pending",
			totalFen: 300,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-002",
			},
		})),
	});

	await expect(worker.runOnce(now)).resolves.toBe("reconciled");
	expect(orders.read().state).toBe("cash_pending");
	expect(attempts.read().nextQueryAt).toBe("2026-08-15T00:00:15.000Z");
});

test("reconciliation worker moves a mismatched amount to manual confirmation", async () => {
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository(attempt());
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => ({
			state: "cash_paid",
			totalFen: 301,
			trace: {
				provider: "wechat-pay",
				operation: "order-query",
				requestId: "provider-query-003",
			},
		})),
	});

	await expect(worker.runOnce(now)).resolves.toBe("reconciled");
	expect(orders.read().state).toBe("awaiting_confirmation");
	expect(attempts.read().nextQueryAt).toBeUndefined();
});

test("reconciliation worker keeps a provider failure recoverable with structured logs", async () => {
	const lines: string[] = [];
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository(attempt());
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => {
			throw new Error("provider is temporarily unavailable");
		}),
		logger: createLogger({
			service: "hospital-worker-test",
			environment: "test",
			level: "warn",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(worker.runOnce(now)).resolves.toBe("retry_scheduled");
	expect(orders.read().state).toBe("cash_pending");
	expect(attempts.read().nextQueryAt).toBe("2026-08-15T00:00:15.000Z");
	const output = lines.join("\n");
	expect(output).toContain("worker.payment.wechat_query.retry_scheduled");
	expect(output).not.toContain("provider is temporarily unavailable");
});

test("reconciliation worker marks an absent WeChat order failed and retryable", async () => {
	const lines: string[] = [];
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository(attempt());
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => {
			throw new ProviderRequestError({
				provider: "wechat-pay",
				operation: "order-query",
				message: "Wechat order query confirmed payment order does not exist",
				requestId: "wechat-query-missing-001",
				statusCode: 404,
				retryable: false,
				failureStage: "http",
				requestOutcome: "rejected",
				reason: "payment-order-not-found",
				providerErrorCode: "ORDER_NOT_EXIST",
				providerErrorMessage: "订单不存在",
			});
		}),
		logger: createLogger({
			service: "hospital-worker-test",
			environment: "test",
			level: "warn",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(worker.runOnce(now)).resolves.toBe("failed");
	expect(attempts.read()).toMatchObject({
		status: "failed",
		lastErrorCode: "provider-order-not-found",
		queryAttempts: 1,
	});
	expect(attempts.read().nextQueryAt).toBeUndefined();
	const output = lines.join("\n");
	expect(output).toContain("worker.payment.wechat_query.order_not_found");
	expect(output).toContain("ORDER_NOT_EXIST");
	expect(output).toContain("订单不存在");
});

test("reconciliation worker stops provider failures at the manual review boundary", async () => {
	const orders = createOrderRepository(order);
	const attempts = createAttemptRepository({
		...attempt(),
		queryAttempts: MAX_PAYMENT_QUERY_ATTEMPTS - 1,
	});
	const worker = new PaymentReconciliationWorker({
		attempts: attempts.repository,
		orders: new PaymentOrderService({ orders: orders.repository }),
		wechatPayment: gatewayFor(async () => {
			throw new Error("provider is temporarily unavailable");
		}),
	});

	await expect(worker.runOnce(now)).resolves.toBe("manual_review");
	expect(attempts.read()).toMatchObject({
		status: "manual_review",
		queryAttempts: MAX_PAYMENT_QUERY_ATTEMPTS,
		lastErrorCode: "provider-query-failed",
	});
	expect(attempts.read().nextQueryAt).toBeUndefined();
});
