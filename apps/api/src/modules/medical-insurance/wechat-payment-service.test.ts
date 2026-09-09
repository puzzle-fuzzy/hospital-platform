import { expect, test } from "bun:test";
import type {
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceWechatPaymentGateway,
	MedicalInsuranceWechatPaymentIdentity,
} from "@hospital/domain";
import { type AppLogger, createLogger } from "@hospital/observability";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import {
	MedicalInsuranceWechatPaymentService,
	MedicalInsuranceWechatPrepayExpiredError,
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
			mixState: "failed",
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
		mixState: "failed",
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
			mixPayType: "CASH_AND_INSURANCE",
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

test("关系为空但授权查询返回本人授权号时按本人支付", async () => {
	const patients = createInMemoryPatientRepository();
	await patients.upsertFromDirectory({
		ownerUserId: "user-unknown-direct-001",
		patientId: "patient-unknown-direct-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-unknown-direct-001",
			displayName: "本人就诊人",
			relationship: "unknown",
			cardNumberMasked: "******1234",
		},
	});
	const service = new MedicalInsuranceWechatPaymentService({
		orders: {} as never,
		queryTasks: {} as never,
		authorizations: {} as never,
		identityUsers: {} as never,
		patients,
		wechatPayment: {} as never,
		confirmCashPayment: async () => {
			throw new Error("not used");
		},
	});
	const authorization: MedicalInsuranceAuthorizationContext = {
		authorizationId: "authorization-unknown-direct-001",
		ownerUserId: "user-unknown-direct-001",
		medicalOrderId: "order-unknown-direct-001",
		providerSubject: "openid-unknown-direct-001",
		payAuthNo: "AUTH-DIRECT-001",
		payForRelatives: false,
		patient: {
			idNo: "140581198001011234",
			userName: "本人就诊人",
			idType: "01",
		},
		psnNo: "psn-unknown-direct-001",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "140581",
		expiresAt: "2026-09-08T09:00:00.000Z",
		createdAt: now,
	};
	const paymentIdentity = await (
		service as unknown as {
			paymentIdentity: (
				order: MedicalInsuranceOrder,
				authorization: MedicalInsuranceAuthorizationContext,
			) => Promise<MedicalInsuranceWechatPaymentIdentity>;
		}
	).paymentIdentity(
		order({
			medicalOrderId: "order-unknown-direct-001",
			ownerUserId: "user-unknown-direct-001",
			patientId: "patient-unknown-direct-001",
		}),
		authorization,
	);

	expect(paymentIdentity).toEqual({
		payForRelatives: false,
		payer: {
			name: "本人就诊人",
			idNo: "140581198001011234",
		},
	});
});

test("关系为空的亲情授权使用授权返回的绑卡人作为付款人", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			authorizationId: "authorization-relative-001",
			wechatMixTradeNo: null,
			wechatOutTradeNo: null,
			wechatPaymentState: "not_started",
		}),
	);
	await orders.saveSettlementContext(
		"user-wechat-query-001",
		"wechat-query-001",
		{
			businessId: "appointment-wechat-query-001",
			hospitalId: "hospital-relative-001",
			patientId: "provider-relative-001",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
			payingId: "paying-relative-001",
			tradingId: "trading-relative-001",
		},
	);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-relative-001",
		ownerUserId: "user-wechat-query-001",
		medicalOrderId: "wechat-query-001",
		providerSubject: "openid-relative-001",
		payAuthNo: "pay-auth-relative-001",
		payForRelatives: true,
		patient: {
			idNo: "140581201501010011",
			userName: "选中儿童",
			idType: "01",
		},
		payer: {
			idNo: "140581198001010022",
			userName: "当前微信本人",
			idType: "01",
		},
		psnNo: "psn-relative-001",
		insutype: "310",
		insuplcAdmdvs: "140500",
		insuCode: "insu-relative-001",
		expiresAt: "2026-09-08T09:00:00.000Z",
		createdAt: now,
	});
	const patients = createInMemoryPatientRepository();
	await patients.upsertFromDirectory({
		ownerUserId: "user-wechat-query-001",
		patientId: "patient-self-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-self-001",
			displayName: "当前微信本人",
			relationship: "self",
			cardNumberMasked: "******0022",
		},
	});
	await patients.upsertFromDirectory({
		ownerUserId: "user-wechat-query-001",
		patientId: "patient-wechat-query-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-relative-001",
			displayName: "选中儿童",
			relationship: "unknown",
			cardNumberMasked: "******0011",
		},
	});
	let paymentIdentity: unknown;
	const recoverFirstValues: Array<boolean | undefined> = [];
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations,
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: "user-wechat-query-001",
				providerSubject: "openid-relative-001",
				unionId: "union-relative-001",
			},
		]),
		patients,
		patientProfile: {
			resolve: async () => {
				throw new Error("支付人身份应来自医保授权查询，不应再次猜测本人档案");
			},
		},
		wechatPayment: {
			createMixedOrder: async (
				input: Parameters<
					MedicalInsuranceWechatPaymentGateway["createMixedOrder"]
				>[0],
			) => {
				paymentIdentity = input.paymentIdentity;
				recoverFirstValues.push(input.recoverFirst);
				return {
					mixTradeNo: "mix-relative-001",
					prepayId: "prepay-relative-001",
					payParams: {
						timeStamp: "1786752000",
						nonceStr: "nonce-relative-001",
						package: "prepay_id=prepay-relative-001",
						signType: "RSA",
						paySign: "signature-relative-001",
						mixTradeNo: "mix-relative-001",
					},
					cashFen: 200,
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-create",
						requestId: "wechat-relative-001",
					},
				};
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("payment creation must not complete HIS");
		},
		now: () => new Date(now),
	});

	await service.create({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "relative-payment-trace-001",
			idempotencyKey: "relative-payment-request-001",
		},
	});
	expect(paymentIdentity).toEqual({
		payForRelatives: true,
		payer: {
			name: "当前微信本人",
			idNo: "140581198001010022",
		},
		relative: {
			name: "选中儿童",
			idNo: "140581201501010011",
		},
	});
	expect(recoverFirstValues).toEqual([undefined]);
	const firstStored = await orders.findByMedicalOrderId("wechat-query-001");
	expect(firstStored).toMatchObject({
		wechatOutTradeNo: expect.stringMatching(/^MIP/u),
		wechatPaymentState: "prepay_ready",
		wechatPrepayExpiresAt: "2026-09-08T10:00:00.000Z",
	});
	if (!firstStored) throw new Error("created medical order was not persisted");
	if (!firstStored.wechatOutTradeNo) {
		throw new Error("created medical order did not persist out_trade_no");
	}
	const reset = await orders.applySettlement(
		firstStored.medicalOrderId,
		firstStored.version,
		{
			status: firstStored.status,
			ordStas: firstStored.ordStas,
			amounts: firstStored.amounts,
			setlType: firstStored.setlType,
			revsTokenHash: firstStored.revsTokenHash,
			revsTokenExpiresAt: firstStored.revsTokenExpiresAt,
			wechatMixTradeNo: null,
			wechatOutTradeNo: firstStored.wechatOutTradeNo,
			wechatPayParams: null,
			wechatPrepayExpiresAt: null,
			wechatPaymentState: "unknown",
		},
	);
	if (!reset) throw new Error("medical order recovery fixture was not reset");

	await service.create({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "relative-payment-recovery-trace-001",
			idempotencyKey: "relative-payment-recovery-request-001",
		},
	});
	expect(recoverFirstValues).toEqual([undefined, true]);

	const recoveredStored = await orders.findByMedicalOrderId("wechat-query-001");
	if (!recoveredStored?.wechatOutTradeNo) {
		throw new Error("recovered medical order was not persisted");
	}
	const expiredReset = await orders.applySettlement(
		recoveredStored.medicalOrderId,
		recoveredStored.version,
		{
			status: recoveredStored.status,
			ordStas: recoveredStored.ordStas,
			amounts: recoveredStored.amounts,
			setlType: recoveredStored.setlType,
			revsTokenHash: recoveredStored.revsTokenHash,
			revsTokenExpiresAt: recoveredStored.revsTokenExpiresAt,
			wechatMixTradeNo: null,
			wechatOutTradeNo: recoveredStored.wechatOutTradeNo,
			wechatPayParams: null,
			wechatPrepayExpiresAt: "2026-09-08T07:59:59.000Z",
			wechatPaymentState: "unknown",
		},
	);
	if (!expiredReset) throw new Error("expired prepay fixture was not reset");

	await expect(
		service.create({
			ownerUserId: "user-wechat-query-001",
			orderId: "wechat-query-001",
			context: {
				traceId: "relative-payment-expired-trace-001",
				idempotencyKey: "relative-payment-expired-request-001",
			},
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceWechatPrepayExpiredError);
	expect(recoverFirstValues).toEqual([undefined, true, true]);
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		wechatMixTradeNo: "mix-relative-001",
		wechatPaymentState: "unknown",
		wechatPayParams: null,
		wechatPrepayExpiresAt: "2026-09-08T07:59:59.000Z",
	});
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
