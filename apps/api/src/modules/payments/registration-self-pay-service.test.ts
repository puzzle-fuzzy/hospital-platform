import { expect, test } from "bun:test";
import { createFixtureHospitalSettlementGateway } from "@hospital/adapters";
import { PaymentOrderService } from "@hospital/domain";
import { createInMemoryPaymentOrderRepository } from "@hospital/persistence";
import {
	RegistrationSelfPayService,
	registrationSelfPayOrderKey,
} from "./registration-self-pay-service";

const ownerUserId = "fixture-user-0001";
const appointmentId = "appointment-001";
const order = {
	orderId: "payment-order-001",
	ownerUserId,
	patientId: "patient-001",
	idempotencyKey: registrationSelfPayOrderKey(appointmentId),
	amounts: { totalFen: 300, insuranceFen: 0, cashFen: 300 },
	state: "cash_paid" as const,
	version: 2,
	createdAt: "2026-09-07T00:00:00.000Z",
	updatedAt: "2026-09-07T00:00:00.000Z",
};

function appointments() {
	return {
		getPaymentContext: async () => ({
			appointmentId,
			patientId: order.patientId,
			totalFen: order.amounts.totalFen,
		}),
	} as never;
}

test("自费微信已支付后必须先回写 HIS，再进入 completed", async () => {
	const repository = createInMemoryPaymentOrderRepository([order]);
	const paymentOrders = new PaymentOrderService({ orders: repository });
	let calls = 0;
	const fixture = createFixtureHospitalSettlementGateway();
	const service = new RegistrationSelfPayService({
		appointments: appointments(),
		paymentOrders,
		wechatPrepay: {} as never,
		hospitalSettlement: {
			writeBack: async (input, context) => {
				calls += 1;
				expect(input.orderId).toBe(order.orderId);
				expect(input.settlement.cashFen).toBe(300);
				expect(context.idempotencyKey).toBe(
					`registration-self-pay-settlement:${order.orderId}`,
				);
				expect(input.registrationContext).toEqual({
					businessId: "settlement-business-001",
					payingId: "260650000000001",
					tradingId: "260650000000002",
				});
				return fixture.writeBack(input, context);
			},
		},
		resolveRegistrationContext: async (input) => {
			expect(input).toEqual({ ownerUserId, appointmentId });
			return {
				businessId: "settlement-business-001",
				payingId: "260650000000001",
				tradingId: "260650000000002",
			};
		},
	});

	const result = await service.create({
		ownerUserId,
		appointmentId,
		context: {
			traceId: "self-pay-trace-001",
			idempotencyKey: "self-pay-request-001",
		},
	});

	expect(result.status).toBe("cash_paid");
	expect(result.paymentState).toBe("completed");
	expect(calls).toBe(1);
	expect(
		(
			await repository.findByOwnerAndIdempotencyKey(
				ownerUserId,
				order.idempotencyKey,
			)
		)?.state,
	).toBe("completed");
});

test("HIS 回写未确认时不伪造完成，保留 cash_paid 供后续重试", async () => {
	const repository = createInMemoryPaymentOrderRepository([order]);
	const paymentOrders = new PaymentOrderService({ orders: repository });
	const service = new RegistrationSelfPayService({
		appointments: appointments(),
		paymentOrders,
		wechatPrepay: {} as never,
		hospitalSettlement: {
			writeBack: async () => {
				throw new Error("HIS unavailable");
			},
		},
	});

	const result = await service.create({
		ownerUserId,
		appointmentId,
		context: {
			traceId: "self-pay-trace-002",
			idempotencyKey: "self-pay-request-002",
		},
	});

	expect(result.status).toBe("awaiting_confirmation");
	expect(result.paymentState).toBe("cash_paid");
	expect(
		(
			await repository.findByOwnerAndIdempotencyKey(
				ownerUserId,
				order.idempotencyKey,
			)
		)?.state,
	).toBe("cash_paid");
});
