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
		preparation: {} as never,
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
			expect(input).toEqual({
				ownerUserId,
				appointmentId,
				orderId: order.orderId,
			});
			return {
				businessId: "settlement-business-001",
				payingId: "260650000000001",
				tradingId: "260650000000002",
			};
		},
		saveRegistrationContext: async () => undefined,
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
		preparation: {} as never,
		hospitalSettlement: {
			writeBack: async () => {
				throw new Error("HIS unavailable");
			},
		},
		saveRegistrationContext: async () => undefined,
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

test("新自费订单先完成并保存 .1/.32/.2 上下文，再创建微信 APIv3 订单", async () => {
	const repository = createInMemoryPaymentOrderRepository();
	const paymentOrders = new PaymentOrderService({
		orders: repository,
		createOrderId: () => "payment-order-new-001",
		now: () => new Date("2026-09-07T00:00:00.000Z"),
	});
	const events: string[] = [];
	let storedContext:
		| {
				businessId: string;
				businessCode: string;
				payingId: string;
				tradingId: string;
		  }
		| undefined;
	const preparedContext = {
		businessId: "1952638941030000001",
		businessCode: "REG-20260907-001",
		payingId: "1952638941030000002",
		tradingId: "1952638941030000003",
		hospitalId: "10389001",
		patientId: "1952638941030000200",
		certNo: "11010519900101007X",
		psnCertType: "01",
		psnName: "测试患者",
		psnNo: "P000001",
		patInHosId: "0",
		outTradeNo: "payment-order-new-001",
		recordCode: "0123456789abcdef0123456789abcdef",
		payTypeId: "50",
		payType: "CREDIT" as const,
		workStationId: "",
	};
	const service = new RegistrationSelfPayService({
		appointments: {
			getPaymentContext: async () => ({
				appointmentId,
				patientId: "patient-001",
				totalFen: 1000,
				sourceSerialNumber: "1",
				providerRegisterId: "1952638941030000100",
			}),
			getProviderPaymentContext: async () => ({
				providerRegisterId: "1952638941030000100",
				providerPatientId: "1952638941030000200",
				patient: {
					name: "测试患者",
					cardNo: "P000001",
					idNo: "11010519900101007X",
				},
			}),
		} as never,
		paymentOrders,
		preparation: {
			prepare: async () => {
				events.push("prepare-.1-.32-.2");
				return {
					registrationContext: preparedContext,
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: "prepare-3",
						requestIds: ["prepare-1", "prepare-2", "prepare-3"],
					},
				};
			},
		},
		wechatPrepay: {
			create: async () => {
				events.push("wechat-api-v3");
				expect(storedContext).toBeDefined();
				return {
					payParams: {
						appId: "wx-test",
						timeStamp: "1",
						nonceStr: "nonce",
						package: "prepay_id=prepay-test",
						signType: "RSA" as const,
						paySign: "signature",
					},
				};
			},
		} as never,
		hospitalSettlement: {} as never,
		resolveRegistrationContext: async () => storedContext,
		saveRegistrationContext: async (input) => {
			events.push("save-encrypted-context");
			storedContext = input.registrationContext as typeof storedContext;
		},
	});

	const result = await service.create({
		ownerUserId,
		appointmentId,
		context: {
			traceId: "self-pay-trace-new",
			idempotencyKey: "self-pay-request-new",
		},
	});

	expect(events).toEqual([
		"prepare-.1-.32-.2",
		"save-encrypted-context",
		"wechat-api-v3",
	]);
	expect(result.status).toBe("prepay_ready");
	expect(result.orderId).toBe("payment-order-new-001");
});
