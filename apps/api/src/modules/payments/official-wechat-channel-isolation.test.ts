import { expect, test } from "bun:test";
import { createFixtureWechatPaymentGateway } from "@hospital/adapters";
import {
	PaymentCashPrepayNotAllowedError,
	type PaymentOrder,
	PaymentOrderService,
	type RegistrationSelfPaySettlementContext,
	type WechatPaymentGateway,
} from "@hospital/domain";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createNotConfiguredRepositories,
	type MySqlRepositories,
} from "@hospital/persistence";
import { createDefaultApplicationServices } from "../../application";
import { WechatPrepayService } from "./service";

const ownerUserId = "channel-owner";
const orderId = "channel-order";
const context = { traceId: "channel-trace", idempotencyKey: "channel-key" };
const time = "2026-10-21T02:00:00.000Z";
const keys = [
	"outpatient-self-pay:record-fixture",
	`outpatient-self-pay:retry:${"a".repeat(64)}`,
];

function storedOrder(
	key: string,
	state: PaymentOrder["state"] = "cash_pending",
): PaymentOrder {
	return {
		ownerUserId,
		orderId,
		patientId: "channel-patient",
		idempotencyKey: key,
		amounts: { totalFen: 2137, insuranceFen: 0, cashFen: 2137 },
		state,
		version: 1,
		createdAt: time,
		updatedAt: time,
	};
}

async function boundaryFixture(
	key: string,
	marker: "requested" | "awaiting_confirmation" | "cancelled",
) {
	const state = marker === "cancelled" ? "cancelled" : "cash_pending";
	const repository = createInMemoryPaymentOrderRepository([
		storedOrder(key, state),
	]);
	const saved: RegistrationSelfPaySettlementContext = {
		businessId: "9000000000000000101",
		payingId: "9000000000000000102",
		tradingId: "9000000000000000103",
		tradeTypeCode: "2",
		outpatientCancellation: { state: marker, requestedAt: time },
	};
	await repository.saveRegistrationSelfPayContext?.(
		ownerUserId,
		orderId,
		saved,
	);
	const attempts = createInMemoryPaymentPrepayAttemptRepository();
	await attempts.insert({
		attemptId: "old-generic-attempt",
		ownerUserId,
		orderId,
		provider: "wechat-pay",
		idempotencyKey: context.idempotencyKey,
		status: "succeeded",
		version: 1,
		queryAttempts: 0,
		createdAt: time,
		updatedAt: time,
		prepayId: "outdated-prepay",
		payParams: {
			appId: "wx-fixture",
			timeStamp: "1",
			nonceStr: "old-nonce",
			package: "prepay_id=outdated-prepay",
			signType: "RSA",
			paySign: "outdated-signature",
		},
	});
	let attemptCalls = 0,
		gatewayCalls = 0;
	const blockedAttempts = {
		...attempts,
		findByOwnerOrderAndIdempotencyKey: async (
			...args: Parameters<typeof attempts.findByOwnerOrderAndIdempotencyKey>
		) => {
			attemptCalls++;
			return attempts.findByOwnerOrderAndIdempotencyKey(...args);
		},
		findByOwnerAndOrderId: async (
			...args: Parameters<typeof attempts.findByOwnerAndOrderId>
		) => {
			attemptCalls++;
			return attempts.findByOwnerAndOrderId(...args);
		},
		insert: async (...args: Parameters<typeof attempts.insert>) => {
			attemptCalls++;
			return attempts.insert(...args);
		},
		update: async (...args: Parameters<typeof attempts.update>) => {
			attemptCalls++;
			return attempts.update(...args);
		},
	};
	const reject = async () => {
		gatewayCalls++;
		throw new Error("Generic provider must not receive hospital MD5 orders");
	};
	const gateway = {
		createJsapiOrder: reject,
		query: reject,
		close: reject,
	} as WechatPaymentGateway;
	const orders = new PaymentOrderService({ orders: repository });
	const service = new WechatPrepayService({
		orders,
		attempts: blockedAttempts,
		identityUsers: createInMemoryIdentityUserRepository(),
		wechatPayment: gateway,
	});
	return {
		repository,
		service,
		gateway,
		blockedAttempts,
		counts: () => ({ attemptCalls, gatewayCalls }),
		state,
	};
}

async function assertAllBlocked(service: WechatPrepayService) {
	const input = { ownerUserId, orderId, context };
	for (const method of ["create", "reconcile", "cancel"] as const) {
		await expect(service[method](input)).rejects.toBeInstanceOf(
			PaymentCashPrepayNotAllowedError,
		);
	}
	await expect(
		service.read({
			ownerUserId,
			orderId,
			idempotencyKey: context.idempotencyKey,
		}),
	).rejects.toBeInstanceOf(PaymentCashPrepayNotAllowedError);
}

for (const key of keys) {
	test.each(["requested", "awaiting_confirmation", "cancelled"] as const)(
		`普通门诊${key.includes(":retry:") ? "重试" : "首笔"}订单%s不能通过通用入口创建、读取、查单或关单`,
		async (marker) => {
			const f = await boundaryFixture(key, marker);
			await assertAllBlocked(f.service);
			expect(f.counts()).toEqual({ attemptCalls: 0, gatewayCalls: 0 });
			expect(
				await f.repository.findByOwnerAndId(ownerUserId, orderId),
			).toMatchObject({ state: f.state, version: 1 });
		},
	);
	test(`真实组合根保留普通门诊${key.includes(":retry:") ? "重试" : "首笔"}通道隔离，旧参数无法被取出`, async () => {
		const f = await boundaryFixture(key, "requested");
		const services = createDefaultApplicationServices({
			repositories: {
				...createNotConfiguredRepositories(),
				paymentOrders: f.repository,
				paymentPrepayAttempts: f.blockedAttempts,
			} as MySqlRepositories,
			wechatPaymentGateway: f.gateway,
		});
		await assertAllBlocked(services.wechatPrepay);
		expect(f.counts()).toEqual({ attemptCalls: 0, gatewayCalls: 0 });
		expect(
			(await f.repository.findByOwnerAndId(ownerUserId, orderId))?.state,
		).toBe("cash_pending");
	});
}

test.each(["generic-cash-key", "registration-self-pay:fixture-appointment"])(
	"合法通用或挂号订单%s仍可创建和读取官方微信参数",
	async (key) => {
		const repository = createInMemoryPaymentOrderRepository([storedOrder(key)]);
		let appointmentChecks = 0;
		const service = new WechatPrepayService({
			orders: new PaymentOrderService({ orders: repository }),
			identityUsers: createInMemoryIdentityUserRepository([
				{ userId: ownerUserId, providerSubject: "fixture-openid" },
			]),
			attempts: createInMemoryPaymentPrepayAttemptRepository(),
			wechatPayment: createFixtureWechatPaymentGateway(),
			assertAppointmentPaymentAllowed: async (_owner, appointmentId) => {
				expect(appointmentId).toBe("fixture-appointment");
				appointmentChecks++;
			},
		});
		expect(
			(await service.create({ ownerUserId, orderId, context })).payParams
				.signType,
		).toBe("RSA");
		expect(
			(
				await service.read({
					ownerUserId,
					orderId,
					idempotencyKey: context.idempotencyKey,
				})
			).status,
		).toBe("ready");
		expect(appointmentChecks).toBe(
			key.startsWith("registration-self-pay:") ? 1 : 0,
		);
	},
);
