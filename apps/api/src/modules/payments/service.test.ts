import { expect, test } from "bun:test";
import { createFixtureWechatPaymentGateway } from "@hospital/adapters";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
} from "@hospital/persistence";
import { PaymentOrderService } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { PaymentIdentityNotFoundError, WechatPrepayService } from "./service";

const order = {
	orderId: "order-cash-001",
	ownerUserId: "fixture-user-0001",
	patientId: "patient-001",
	idempotencyKey: "order-key-001",
	amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
	state: "cash_pending" as const,
	version: 4,
	createdAt: "2026-08-15T00:00:00.000Z",
	updatedAt: "2026-08-15T00:00:00.000Z",
};

test("wechat prepay reads server identity and returns only server pay params", async () => {
	const identityUsers = createInMemoryIdentityUserRepository([
		{
			userId: "fixture-user-0001",
			providerSubject: "fixture-openid-001",
		},
	]);
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([order]),
		}),
		identityUsers,
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: createFixtureWechatPaymentGateway(),
		createAttemptId: () => "attempt-001",
	});

	const result = await service.create({
		ownerUserId: "fixture-user-0001",
		orderId: order.orderId,
		context: { traceId: "trace-prepay-001", idempotencyKey: "prepay-key-001" },
	});
	const status = await service.read({
		ownerUserId: "fixture-user-0001",
		orderId: order.orderId,
		idempotencyKey: "prepay-key-001",
	});

	expect(result).toEqual({
		orderId: order.orderId,
		state: "cash_pending",
		payParams: {
			appId: "fixture-app-id",
			timeStamp: "1700000000",
			nonceStr: "fixture-nonce-001",
			package: "prepay_id=fixture-prepay-001",
			signType: "RSA",
			paySign: "fixture-pay-sign-001",
		},
	});
	expect(status).toMatchObject({
		orderId: order.orderId,
		state: "cash_pending",
		status: "ready",
	});
});

test("wechat prepay refuses an order before cash_pending", async () => {
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([
				{ ...order, state: "created" },
			]),
		}),
		identityUsers: createInMemoryIdentityUserRepository(),
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: createFixtureWechatPaymentGateway(),
	});

	expect(
		service.create({
			ownerUserId: order.ownerUserId,
			orderId: order.orderId,
			context: {
				traceId: "trace-prepay-002",
				idempotencyKey: "prepay-key-002",
			},
		}),
	).rejects.toThrow("not allowed");
});

test("wechat prepay replays a durable success without a second provider call", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository();
	const identityUsers = createInMemoryIdentityUserRepository([
		{
			userId: order.ownerUserId,
			providerSubject: "fixture-openid-001",
		},
	]);
	let providerCalls = 0;
	const fixture = createFixtureWechatPaymentGateway();
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([order]),
		}),
		identityUsers,
		attempts,
		wechatPayment: {
			...fixture,
			createJsapiOrder: async (...args) => {
				providerCalls += 1;
				return fixture.createJsapiOrder(...args);
			},
		},
	});
	const input = {
		ownerUserId: order.ownerUserId,
		orderId: order.orderId,
		context: {
			traceId: "trace-prepay-replay",
			idempotencyKey: "prepay-replay",
		},
	};

	const first = await service.create(input);
	const second = await service.create(input);

	expect(providerCalls).toBe(1);
	expect(second).toEqual(first);
});

test("wechat prepay fails before provider call when identity is missing", async () => {
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([order]),
		}),
		identityUsers: createInMemoryIdentityUserRepository(),
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: createFixtureWechatPaymentGateway(),
	});

	await expect(
		service.create({
			ownerUserId: order.ownerUserId,
			orderId: order.orderId,
			context: {
				traceId: "trace-prepay-003",
				idempotencyKey: "prepay-key-003",
			},
		}),
	).rejects.toBeInstanceOf(PaymentIdentityNotFoundError);
});

test("wechat prepay logs contain no provider subject or pay credential", async () => {
	const lines: string[] = [];
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([order]),
		}),
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: order.ownerUserId,
				providerSubject: "fixture-openid-001",
			},
		]),
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: createFixtureWechatPaymentGateway(),
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await service.create({
		ownerUserId: order.ownerUserId,
		orderId: order.orderId,
		context: { traceId: "trace-prepay-004", idempotencyKey: "prepay-key-004" },
	});

	const output = lines.join("\n");
	expect(output).toContain("payment.wechat_prepay.created");
	expect(output).not.toContain("fixture-openid-001");
	expect(output).not.toContain("fixture-prepay-001");
});
