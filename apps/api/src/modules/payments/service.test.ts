import { expect, test } from "bun:test";
import {
	createFixtureWechatPaymentGateway,
	createNotConfiguredGateways,
} from "@hospital/adapters";
import {
	IdentityUserReadModelValidationError,
	PaymentOrderInputError,
	PaymentOrderService,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
} from "@hospital/persistence";
import {
	RegistrationPaymentExitInputError,
	RegistrationPaymentExitRefundContextError,
	RegistrationPaymentExitRefundPendingError,
	RegistrationPaymentExitRefundSyncPendingError,
	RegistrationPaymentExitService,
} from "./registration-payment-exit-service";
import { registrationSelfPayOrderKey } from "./registration-self-pay-service";
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

test("微信预支付服务拒绝绕过 HTTP schema 的畸形输入", async () => {
	let orderCalls = 0;
	let providerCalls = 0;
	const fixture = createFixtureWechatPaymentGateway();
	const service = new WechatPrepayService({
		orders: {
			async get() {
				orderCalls += 1;
				throw new Error("order repository must not be called");
			},
		} as unknown as PaymentOrderService,
		identityUsers: createInMemoryIdentityUserRepository(),
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: {
			...fixture,
			async createJsapiOrder(...args) {
				providerCalls += 1;
				return fixture.createJsapiOrder(...args);
			},
		},
	});

	await expect(service.create(null as never)).rejects.toBeInstanceOf(
		PaymentOrderInputError,
	);
	await expect(service.read([] as never)).rejects.toBeInstanceOf(
		PaymentOrderInputError,
	);

	expect(orderCalls).toBe(0);
	expect(providerCalls).toBe(0);
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

test("wechat prepay rejects an invalid owner identity before creating an attempt", async () => {
	let providerCalls = 0;
	const fixture = createFixtureWechatPaymentGateway();
	const service = new WechatPrepayService({
		orders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository([order]),
		}),
		identityUsers: {
			async findByUserId() {
				return {
					userId: "other-owner",
					providerSubject: "fixture-openid-001",
				} as never;
			},
			async findOrCreateByWechat() {
				throw new Error("not used");
			},
		},
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: {
			...fixture,
			async createJsapiOrder(...args) {
				providerCalls += 1;
				return fixture.createJsapiOrder(...args);
			},
		},
	});

	await expect(
		service.create({
			ownerUserId: order.ownerUserId,
			orderId: order.orderId,
			context: {
				traceId: "trace-prepay-invalid-identity",
				idempotencyKey: "prepay-invalid-identity",
			},
		}),
	).rejects.toBeInstanceOf(IdentityUserReadModelValidationError);
	expect(providerCalls).toBe(0);
});

test("wechat prepay does not leave a not-configured dependency permanently pending", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository();
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
		attempts,
		wechatPayment: createNotConfiguredGateways().wechatPayment,
	});
	const input = {
		ownerUserId: order.ownerUserId,
		orderId: order.orderId,
		context: {
			traceId: "trace-prepay-not-configured",
			idempotencyKey: "prepay-not-configured",
		},
	};

	await expect(service.create(input)).rejects.toThrow(
		"Dependency is not configured: adapter:wechat-pay",
	);
	await expect(
		service.read({
			ownerUserId: input.ownerUserId,
			orderId: input.orderId,
			idempotencyKey: input.context.idempotencyKey,
		}),
	).resolves.toMatchObject({ status: "failed" });

	// 重试同一幂等键时仍返回配置错误，不能伪装成永久的并发处理中。
	await expect(service.create(input)).rejects.toThrow(
		"Dependency is not configured: adapter:wechat-pay",
	);
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

test("用户取消自费支付会先关闭微信单，再作废平台订单", async () => {
	const orders = createInMemoryPaymentOrderRepository([order]);
	const attempts = createInMemoryPaymentPrepayAttemptRepository([
		{
			attemptId: "attempt-exit-001",
			ownerUserId: order.ownerUserId,
			orderId: order.orderId,
			provider: "wechat-pay",
			idempotencyKey: "prepay-exit-001",
			status: "succeeded",
			version: 2,
			queryAttempts: 0,
			prepayId: "fixture-prepay-001",
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
		},
	]);
	const fixture = createFixtureWechatPaymentGateway();
	let closeCalls = 0;
	const paymentOrders = new PaymentOrderService({ orders });
	const prepay = new WechatPrepayService({
		orders: paymentOrders,
		identityUsers: createInMemoryIdentityUserRepository(),
		attempts,
		wechatPayment: {
			...fixture,
			query: async (_input, context) => ({
				state: "cash_pending",
				totalFen: order.amounts.cashFen,
				trace: {
					provider: "fixture-wechat-pay",
					operation: "order-query",
					requestId: context.traceId,
				},
			}),
			close: async (_input, context) => {
				closeCalls += 1;
				return {
					trace: {
						provider: "fixture-wechat-pay",
						operation: "order-close",
						requestId: context.traceId,
					},
				};
			},
		},
	});

	const result = await prepay.cancel({
		ownerUserId: order.ownerUserId,
		orderId: order.orderId,
		context: { traceId: "trace-exit-001", idempotencyKey: "exit-001" },
	});

	expect(result).toEqual({ orderId: order.orderId, status: "cancelled" });
	expect(closeCalls).toBe(1);
	await expect(
		paymentOrders.get(order.ownerUserId, order.orderId),
	).resolves.toMatchObject({
		state: "cancelled",
	});
});

test("支付退出不会把已确认收款的自费订单误作废", async () => {
	let appointmentCancelCalls = 0;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([
			{
				...order,
				idempotencyKey: registrationSelfPayOrderKey("appointment-exit-001"),
				state: "cash_paid",
			},
		]),
	});
	const prepay = new WechatPrepayService({
		orders: paymentOrders,
		identityUsers: createInMemoryIdentityUserRepository(),
		attempts: createInMemoryPaymentPrepayAttemptRepository(),
		wechatPayment: createFixtureWechatPaymentGateway(),
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				appointmentCancelCalls += 1;
				return { appointmentId: "appointment-exit-001", status: "cancelled" };
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: prepay,
	});

	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-001",
			mode: "self",
			context: { traceId: "trace-exit-paid", idempotencyKey: "exit-paid" },
		}),
	).rejects.toBeInstanceOf(RegistrationPaymentExitInputError);
	expect(appointmentCancelCalls).toBe(0);
});

test("已完成的挂号自费会全额退款确认后才取消预约", async () => {
	let normalCancellationCalls = 0;
	let refundedCancellationCalls = 0;
	let refundRequests = 0;
	let refundInput: Record<string, unknown> | undefined;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([
			{
				...order,
				idempotencyKey: registrationSelfPayOrderKey(
					"appointment-exit-refund-001",
				),
				state: "completed",
			},
		]),
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				normalCancellationCalls += 1;
				throw new Error(
					"normal cancellation must not run after a confirmed refund",
				);
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				refundedCancellationCalls += 1;
				return {
					appointmentId: "appointment-exit-refund-001",
					status: "cancelled" as const,
				};
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: {
			cancel: async () => ({ orderId: order.orderId, status: "paid" as const }),
		} as never,
		selfPayRefund: {
			requestTrustedPaymentOrder: async (input) => {
				refundRequests += 1;
				refundInput = input;
				return {
					status: "success",
					merchantRefundNo: "refund-registration-001",
				} as never;
			},
			query: async () => {
				throw new Error("a confirmed refund must not be queried again");
			},
		},
	});

	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-refund-001",
			mode: "auto",
			context: {
				traceId: "trace-exit-refund-001",
				idempotencyKey: "exit-refund-001",
			},
		}),
	).resolves.toEqual({
		appointmentId: "appointment-exit-refund-001",
		status: "cancelled",
	});

	expect(refundRequests).toBe(1);
	expect(refundInput).toEqual({
		orderId: order.orderId,
		outTradeNo: order.orderId,
		refundFen: order.amounts.cashFen,
		idempotencyKey: "registration-self-pay-refund:appointment-exit-refund-001",
		reason: "挂号预约取消退款",
	});
	expect(normalCancellationCalls).toBe(0);
	expect(refundedCancellationCalls).toBe(1);
});

test("MD5 挂号自费使用 .2 返回的商户单号退款并在 .15 回写后取消", async () => {
	const appointmentId = "appointment-exit-refund-md5-001";
	const completedOrder = {
		...order,
		idempotencyKey: registrationSelfPayOrderKey(appointmentId),
		state: "completed" as const,
	};
	const orders = createInMemoryPaymentOrderRepository([completedOrder]);
	const saveContext = orders.saveRegistrationSelfPayContext;
	const getContext = orders.getRegistrationSelfPayContext;
	if (!saveContext || !getContext)
		throw new Error("self-pay context repository unavailable");
	const registrationContext = {
		businessId: "yunhealth-business-refund-001",
		tradeTypeCode: "10",
		businessCode: "REG-REFUND-001",
		payingId: "1952638941030000002",
		tradingId: "1952638941030000003",
		hospitalId: "10389001",
		patientId: "1952638941030000200",
		certNo: "11010519900101007X",
		psnCertType: "01",
		psnName: "测试患者",
		psnNo: "P000001",
		patInHosId: "0",
		outTradeNo: "YUNHEALTH-WX-OUT-001",
		outTradeNoSource: "yunhealth_2_6_65_2" as const,
		recordCode: "0123456789abcdef0123456789abcdef",
		payTypeId: "5032",
		payType: "CREDIT" as const,
		workStationId: "",
		payParams: {
			appId: "wx1234567890abcdef",
			timeStamp: "1789000000",
			nonceStr: "0123456789abcdef0123456789abcdef",
			package: "prepay_id=wx-provider-prepay-001",
			signType: "MD5" as const,
			paySign: "0123456789abcdef0123456789abcdef",
		},
	};
	await saveContext(
		completedOrder.ownerUserId,
		completedOrder.orderId,
		registrationContext,
	);
	let refundInput: Record<string, unknown> | undefined;
	let notificationInput: Record<string, unknown> | undefined;
	let cancellations = 0;
	const paymentOrders = new PaymentOrderService({ orders });
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				throw new Error("normal cancellation must not run after refund");
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				cancellations += 1;
				return { appointmentId, status: "cancelled" as const };
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: {
			cancel: async () => ({
				orderId: completedOrder.orderId,
				status: "paid" as const,
			}),
		} as never,
		selfPayRefund: {
			requestTrustedPaymentOrder: async (input) => {
				refundInput = input;
				return {
					status: "success",
					merchantRefundNo: "RF-PO-YUNHEALTH-001",
				} as never;
			},
			query: async () => {
				throw new Error("a confirmed refund must not be queried again");
			},
		},
		selfPayRefundNotification: {
			notifyRefund: async (input) => {
				notificationInput = input;
				return {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.15.refund",
					requestId: "yunhealth-refund-notify-001",
				};
			},
		},
		resolveRegistrationContext: async (input) =>
			getContext(input.ownerUserId, input.orderId),
		saveRegistrationContext: async (input) =>
			saveContext(input.ownerUserId, input.orderId, input.registrationContext),
	});

	await expect(
		service.abandon({
			ownerUserId: completedOrder.ownerUserId,
			appointmentId,
			mode: "auto",
			context: {
				traceId: "trace-exit-refund-md5-001",
				idempotencyKey: "exit-refund-md5-001",
			},
		}),
	).resolves.toEqual({ appointmentId, status: "cancelled" });

	expect(refundInput).toMatchObject({
		orderId: completedOrder.orderId,
		outTradeNo: "YUNHEALTH-WX-OUT-001",
		refundFen: completedOrder.amounts.cashFen,
	});
	expect(notificationInput).toMatchObject({
		orderId: completedOrder.orderId,
		merchantRefundNo: "RF-PO-YUNHEALTH-001",
		refundFen: completedOrder.amounts.cashFen,
		registrationContext,
	});
	expect(cancellations).toBe(1);
	await expect(
		getContext(completedOrder.ownerUserId, completedOrder.orderId),
	).resolves.toMatchObject({
		refundWriteBack: {
			merchantRefundNo: "RF-PO-YUNHEALTH-001",
			refundFen: completedOrder.amounts.cashFen,
		},
	});
});

test("缺少 .2 原始 out_trade_no 的旧 MD5 订单不会猜测退款目标", async () => {
	const appointmentId = "appointment-exit-refund-md5-legacy-001";
	const completedOrder = {
		...order,
		idempotencyKey: registrationSelfPayOrderKey(appointmentId),
		state: "completed" as const,
	};
	let refundRequests = 0;
	let cancellations = 0;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([completedOrder]),
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				cancellations += 1;
				return { appointmentId, status: "cancelled" as const };
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				cancellations += 1;
				return { appointmentId, status: "cancelled" as const };
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: {
			cancel: async () => ({
				orderId: completedOrder.orderId,
				status: "paid" as const,
			}),
		} as never,
		selfPayRefund: {
			requestTrustedPaymentOrder: async () => {
				refundRequests += 1;
				throw new Error("refund request must not be reached");
			},
			query: async () => {
				throw new Error("refund query must not be reached");
			},
		},
		resolveRegistrationContext: async () => ({
			businessId: "yunhealth-business-legacy-001",
			payingId: "1952638941030000002",
			tradingId: "1952638941030000003",
			hospitalId: "10389001",
			patientId: "1952638941030000200",
			certNo: "11010519900101007X",
			psnCertType: "01",
			psnName: "测试患者",
			psnNo: "P000001",
			patInHosId: "0",
			outTradeNo: completedOrder.orderId,
			recordCode: "0123456789abcdef0123456789abcdef",
			payTypeId: "5032",
			payType: "CREDIT" as const,
			workStationId: "",
			payParams: {
				appId: "wx1234567890abcdef",
				timeStamp: "1789000000",
				nonceStr: "0123456789abcdef0123456789abcdef",
				package: "prepay_id=wx-provider-prepay-001",
				signType: "MD5" as const,
				paySign: "0123456789abcdef0123456789abcdef",
			},
		}),
	});

	await expect(
		service.abandon({
			ownerUserId: completedOrder.ownerUserId,
			appointmentId,
			mode: "self",
			context: {
				traceId: "trace-exit-refund-md5-legacy-001",
				idempotencyKey: "exit-refund-md5-legacy-001",
			},
		}),
	).rejects.toBeInstanceOf(RegistrationPaymentExitRefundContextError);
	expect(refundRequests).toBe(0);
	expect(cancellations).toBe(0);
});

test("微信退款成功但 .15 回写未知时保留预约", async () => {
	const appointmentId = "appointment-exit-refund-md5-sync-001";
	const completedOrder = {
		...order,
		idempotencyKey: registrationSelfPayOrderKey(appointmentId),
		state: "completed" as const,
	};
	let cancellations = 0;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([completedOrder]),
	});
	const md5Context = {
		businessId: "yunhealth-business-sync-001",
		tradeTypeCode: "10",
		payingId: "1952638941030000002",
		tradingId: "1952638941030000003",
		hospitalId: "10389001",
		patientId: "1952638941030000200",
		certNo: "11010519900101007X",
		psnCertType: "01",
		psnName: "测试患者",
		psnNo: "P000001",
		patInHosId: "0",
		outTradeNo: "YUNHEALTH-WX-OUT-SYNC-001",
		outTradeNoSource: "yunhealth_2_6_65_2" as const,
		recordCode: "0123456789abcdef0123456789abcdef",
		payTypeId: "5032",
		payType: "CREDIT" as const,
		workStationId: "",
		payParams: {
			appId: "wx1234567890abcdef",
			timeStamp: "1789000000",
			nonceStr: "0123456789abcdef0123456789abcdef",
			package: "prepay_id=wx-provider-prepay-001",
			signType: "MD5" as const,
			paySign: "0123456789abcdef0123456789abcdef",
		},
	};
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				cancellations += 1;
				return { appointmentId, status: "cancelled" as const };
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				cancellations += 1;
				return { appointmentId, status: "cancelled" as const };
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: {
			cancel: async () => ({
				orderId: completedOrder.orderId,
				status: "paid" as const,
			}),
		} as never,
		selfPayRefund: {
			requestTrustedPaymentOrder: async () =>
				({
					status: "success",
					merchantRefundNo: "RF-PO-YUNHEALTH-SYNC-001",
				}) as never,
			query: async () => {
				throw new Error("refund query must not be reached");
			},
		},
		selfPayRefundNotification: {
			notifyRefund: async () => {
				throw new Error("yunhealth response is unknown");
			},
		},
		resolveRegistrationContext: async () => md5Context,
		saveRegistrationContext: async () => undefined,
	});

	await expect(
		service.abandon({
			ownerUserId: completedOrder.ownerUserId,
			appointmentId,
			mode: "self",
			context: {
				traceId: "trace-exit-refund-md5-sync-001",
				idempotencyKey: "exit-refund-md5-sync-001",
			},
		}),
	).rejects.toBeInstanceOf(RegistrationPaymentExitRefundSyncPendingError);
	expect(cancellations).toBe(0);
});

test("挂号退款处理中保留预约，满一分钟后查单确认才取消", async () => {
	let now = new Date("2026-09-18T01:00:30.000Z");
	let refundQueries = 0;
	let appointmentCancellationCalls = 0;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([
			{
				...order,
				idempotencyKey: registrationSelfPayOrderKey(
					"appointment-exit-refund-002",
				),
				state: "completed",
			},
		]),
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				throw new Error(
					"normal cancellation must not run after a confirmed refund",
				);
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				appointmentCancellationCalls += 1;
				return {
					appointmentId: "appointment-exit-refund-002",
					status: "cancelled" as const,
				};
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: {
			cancel: async () => ({ orderId: order.orderId, status: "paid" as const }),
		} as never,
		selfPayRefund: {
			requestTrustedPaymentOrder: async () =>
				({
					status: "processing",
					merchantRefundNo: "refund-registration-002",
					updatedAt: "2026-09-18T01:00:00.000Z",
				}) as never,
			query: async () => {
				refundQueries += 1;
				return {
					status: "success",
					merchantRefundNo: "refund-registration-002",
				} as never;
			},
		},
		now: () => now,
	});

	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-refund-002",
			mode: "self",
			context: {
				traceId: "trace-exit-refund-002a",
				idempotencyKey: "exit-refund-002a",
			},
		}),
	).rejects.toBeInstanceOf(RegistrationPaymentExitRefundPendingError);
	expect(refundQueries).toBe(0);
	expect(appointmentCancellationCalls).toBe(0);

	now = new Date("2026-09-18T01:01:01.000Z");
	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-refund-002",
			mode: "self",
			context: {
				traceId: "trace-exit-refund-002b",
				idempotencyKey: "exit-refund-002b",
			},
		}),
	).resolves.toEqual({
		appointmentId: "appointment-exit-refund-002",
		status: "cancelled",
	});
	expect(refundQueries).toBe(1);
	expect(appointmentCancellationCalls).toBe(1);
});

test("支付退出会在自费订单失效后取消预约并释放号源", async () => {
	let appointmentCancelCalls = 0;
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([
			{
				...order,
				idempotencyKey: registrationSelfPayOrderKey("appointment-exit-002"),
			},
		]),
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				appointmentCancelCalls += 1;
				return { appointmentId: "appointment-exit-002", status: "cancelled" };
			},
		} as never,
		medicalInsurance: { cancel: async () => undefined } as never,
		medicalInsuranceWechatPayment: { query: async () => undefined } as never,
		medicalInsuranceOrders: createInMemoryMedicalInsuranceOrderRepository(),
		paymentOrders,
		wechatPrepay: new WechatPrepayService({
			orders: paymentOrders,
			identityUsers: createInMemoryIdentityUserRepository(),
			attempts: createInMemoryPaymentPrepayAttemptRepository(),
			wechatPayment: createFixtureWechatPaymentGateway(),
		}),
	});

	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-002",
			mode: "auto",
			context: { traceId: "trace-exit-002", idempotencyKey: "exit-002" },
		}),
	).resolves.toEqual({
		appointmentId: "appointment-exit-002",
		status: "cancelled",
	});
	expect(appointmentCancelCalls).toBe(1);
	await expect(
		paymentOrders.get(order.ownerUserId, order.orderId),
	).resolves.toMatchObject({ state: "cancelled" });
});

test("医保混合支付退出会先确认未支付，再作废医保订单并释放号源", async () => {
	let mixedQueryCalls = 0;
	let medicalCancelCalls = 0;
	let appointmentCancelCalls = 0;
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	await medicalOrders.insert({
		medicalOrderId: "medical-exit-001",
		ownerUserId: order.ownerUserId,
		patientId: order.patientId,
		appointmentId: "appointment-exit-003",
		authorizationId: "authorization-exit-001",
		feeUploadId: "fee-exit-001",
		idempotencyKey: "medical-exit-idempotency",
		medOrgOrd: "medical-org-exit-001",
		chrgBchno: "charge-exit-001",
		payOrdId: "pay-exit-001",
		payTokenHash: null,
		mdtrtId: "mdtrt-exit-001",
		acctUsedFlag: "1",
		status: "cash_pending",
		ordStas: null,
		amounts: {
			totalFen: 1000,
			personalAccountFen: 700,
			fundFen: 0,
			cashFen: 300,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatMixTradeNo: "mix-exit-001",
		wechatPaymentState: "prepay_ready",
		version: 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	});
	const service = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				appointmentCancelCalls += 1;
				return { appointmentId: "appointment-exit-003", status: "cancelled" };
			},
		} as never,
		medicalInsurance: {
			cancel: async () => {
				medicalCancelCalls += 1;
				return { status: "cancelled" };
			},
		} as never,
		medicalInsuranceWechatPayment: {
			query: async () => {
				mixedQueryCalls += 1;
				return { paymentState: "prepay_ready", status: "cash_pending" };
			},
		} as never,
		medicalInsuranceOrders: medicalOrders,
		paymentOrders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository(),
		}),
		wechatPrepay: {} as never,
	});

	await expect(
		service.abandon({
			ownerUserId: order.ownerUserId,
			appointmentId: "appointment-exit-003",
			mode: "mixed",
			context: { traceId: "trace-exit-003", idempotencyKey: "exit-003" },
		}),
	).resolves.toEqual({
		appointmentId: "appointment-exit-003",
		status: "cancelled",
	});
	expect(mixedQueryCalls).toBe(1);
	expect(medicalCancelCalls).toBe(1);
	expect(appointmentCancelCalls).toBe(1);
});
