import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceWechatPaymentGateway,
} from "@hospital/domain";
import { type AppLogger, createLogger } from "@hospital/observability";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import {
	MedicalInsuranceWechatPaymentNotAllowedError,
	MedicalInsuranceWechatPaymentService,
} from "./wechat-payment-service";

const now = "2026-09-08T08:00:00.000Z";

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "wechat-query-001",
		ownerUserId: "user-wechat-query-001",
		patientId: "patient-wechat-query-001",
		businessType: "registration",
		orderType: "RegPay",
		businessId: "appointment-wechat-query-001",
		appointmentId: "appointment-wechat-query-001",
		idempotencyKey: "wechat-query-idempotency-001",
		medOrgOrd: "med-org-wechat-query-001",
		chrgBchno: "batch-wechat-query-001",
		payOrdId: "pay-ord-wechat-query-001",
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "cash_pending",
		ordStas: "2",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 300,
			fundFen: 500,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatMixTradeNo: "mix-query-001",
		wechatOutTradeNo: "out-query-001",
		wechatPaymentState: "prepay_ready",
		wechatPayParams: null,
		version: 1,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function makeService(
	orders: ReturnType<typeof createInMemoryMedicalInsuranceOrderRepository>,
	queryResult: Awaited<
		ReturnType<MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]>
	>,
	logger?: AppLogger,
) {
	const wechatPayment = {
		queryMixedOrder: async () => queryResult,
	} as unknown as MedicalInsuranceWechatPaymentGateway;
	return new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment,
		confirmCashPayment: async () => {
			throw new Error("should not complete a failed query");
		},
		...(logger ? { logger } : {}),
	});
}

test("医保查单失败原因会持久化并透传给支付小程序", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const lines: string[] = [];
	const service = makeService(
		orders,
		{
			cashState: "paid",
			insuranceState: "failed",
			medInsPayStatus: "MED_INS_PAY_FAIL",
			medInsFailReason: "医保局具体失败原因",
			cashFen: 200,
			totalFen: 1000,
			providerStatus: "MIX_PAY_FAIL/SELF_PAY_SUCCESS/MED_INS_PAY_FAIL",
			trace: {
				provider: "wechat-pay",
				operation: "medical-mix-query",
				requestId: "wechat-query-provider-001",
			},
		},
		createLogger({
			service: "medical-insurance-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	);

	const result = await service.query({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "wechat-query-trace-001",
			idempotencyKey: "wechat-query-request-001",
		},
	});

	expect(result).toMatchObject({
		paymentState: "failed",
		medInsFailReason: "医保局具体失败原因",
	});
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		medInsFailReason: "医保局具体失败原因",
	});
	const queriedLog = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((line) => line.event === "medical-insurance.wechat-mix.queried");
	expect(queriedLog).toMatchObject({
		medInsPayStatus: "MED_INS_PAY_FAIL",
		medInsFailReason: "医保局具体失败原因",
	});
});

test("自费失败不会产生医保失败原因字段", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order({ medInsFailReason: "旧医保失败原因" }));
	const service = makeService(orders, {
		cashState: "failed",
		insuranceState: "paid",
		medInsPayStatus: "MED_INS_PAY_SUCCESS",
		cashFen: 200,
		totalFen: 1000,
		providerStatus: "MIX_PAY_FAIL/SELF_PAY_FAIL/MED_INS_PAY_SUCCESS",
		trace: {
			provider: "wechat-pay",
			operation: "medical-mix-query",
			requestId: "wechat-query-provider-002",
		},
	});

	const result = await service.query({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "wechat-query-trace-002",
			idempotencyKey: "wechat-query-request-002",
		},
	});

	expect(result).not.toHaveProperty("medInsFailReason");
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		medInsFailReason: null,
	});
});

test("医保混合回调只唤醒持久化查单任务，不在回调内访问 Provider", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const completedTask: MedicalInsuranceQueryTask = {
		taskId: "wechat-query-001",
		medicalOrderId: "wechat-query-001",
		status: "completed",
		version: 2,
		attempts: 1,
		maxAttempts: 12,
		nextAttemptAt: now,
		claimedUntil: null,
		terminalOrdStas: null,
		lastErrorCode: "order-already-cash_pending",
		createdAt: now,
		updatedAt: now,
	};
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([
		completedTask,
	]);
	let providerCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: tasks,
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {
			queryMixedOrder: async () => {
				providerCalls += 1;
				throw new Error("callback must not query Provider");
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("callback must not complete HIS");
		},
		now: () => new Date(now),
	});

	await service.receiveNotification({
		notification: {
			notificationId: "medical-notification-001",
			eventType: "MEDICAL_INSURANCE.SUCCESS",
			mixTradeNo: "mix-query-001",
			outTradeNo: "out-query-001",
			totalFen: 1000,
			cashFen: 200,
			selfPayStatus: "SELF_PAY_SUCCESS",
			medicalInsurancePayStatus: "MED_INS_PAY_SUCCESS",
			receivedAt: now,
		},
		context: {
			traceId: "medical-notification-001",
			idempotencyKey: "medical-notification-001",
		},
	});

	expect(providerCalls).toBe(0);
	expect(await tasks.claimDueForQuery(new Date(now), 1, 60_000)).toHaveLength(
		1,
	);
});

test("新建亲属或儿童混合支付在任何 Provider 请求前被拒绝", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			wechatMixTradeNo: null,
			wechatOutTradeNo: null,
			wechatPaymentState: "not_started",
		}),
	);
	let providerCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: createInMemoryPatientRepository([
			{
				id: "patient-wechat-query-001",
				ownerUserId: "user-wechat-query-001",
				displayName: "测试儿童",
				relationship: "child",
				cardNumberMasked: "******0001",
				source: "hospital-his",
				clinicalAccess: "ready",
			},
		]),
		wechatPayment: {
			createMixedOrder: async () => {
				providerCalls += 1;
				throw new Error("child payment must not reach WeChat");
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("child payment must not complete");
		},
	});

	await expect(
		service.create({
			ownerUserId: "user-wechat-query-001",
			orderId: "wechat-query-001",
			context: {
				traceId: "child-payment-trace-001",
				idempotencyKey: "child-payment-request-001",
			},
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceWechatPaymentNotAllowedError);
	expect(providerCalls).toBe(0);
});

test("云健康混合查单只唤醒 Worker，不在 API 内并发查 Provider 或回写 HIS", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([
		{
			taskId: "wechat-query-001",
			medicalOrderId: "wechat-query-001",
			status: "completed",
			version: 2,
			attempts: 1,
			maxAttempts: 12,
			nextAttemptAt: now,
			claimedUntil: null,
			terminalOrdStas: null,
			lastErrorCode: null,
			createdAt: now,
			updatedAt: now,
		},
	]);
	let synchronousCompletionCalls = 0;
	let providerQueryCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: tasks,
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {
			queryMixedOrder: async () => {
				providerQueryCalls += 1;
				throw new Error("API must not query a Worker-owned mixed order");
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			synchronousCompletionCalls += 1;
			throw new Error("API must not complete HIS");
		},
		pluginPaymentBridge: {} as never,
		now: () => new Date(now),
	});

	await expect(
		service.query({
			ownerUserId: "user-wechat-query-001",
			orderId: "wechat-query-001",
			context: {
				traceId: "wechat-query-trace-003",
				idempotencyKey: "wechat-query-request-003",
			},
		}),
	).resolves.toMatchObject({
		status: "cash_pending",
		paymentState: "prepay_ready",
	});
	expect(providerQueryCalls).toBe(0);
	expect(synchronousCompletionCalls).toBe(0);
	expect(await tasks.claimDueForQuery(new Date(now), 1, 60_000)).toHaveLength(
		1,
	);
});

test("已完成医院回写的混合订单不会被后续 Provider 查单降级", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({ status: "insurance_settled", wechatPaymentState: "cash_paid" }),
	);
	let providerCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {
			queryMixedOrder: async () => {
				providerCalls += 1;
				throw new Error("terminal order must not be queried");
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("terminal order must not be completed again");
		},
	});

	await expect(
		service.query({
			ownerUserId: "user-wechat-query-001",
			orderId: "wechat-query-001",
			context: {
				traceId: "wechat-query-terminal-001",
				idempotencyKey: "wechat-query-terminal-request-001",
			},
		}),
	).resolves.toMatchObject({
		status: "insurance_settled",
		paymentState: "cash_paid",
	});
	expect(providerCalls).toBe(0);
});
