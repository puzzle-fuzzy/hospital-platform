import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceWechatPaymentGateway,
	WechatPaymentNotification,
	WechatPaymentGateway,
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
			otherPaymentFen: 0,
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
		now: () => new Date(now),
		...(logger ? { logger } : {}),
	});
}

test("新医保订单的微信自费使用普通 APIv3/RSA 下单并在查单后进入统一后置确认", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "wechat-own-001",
			ownerUserId: "user-wechat-own-001",
			authorizationId: "authorization-own-001",
			wechatMixTradeNo: null,
			wechatOutTradeNo: null,
			wechatPaymentState: "not_started",
		}),
	);
	await orders.saveSettlementContext("user-wechat-own-001", "wechat-own-001", {
		businessId: "business-own-001",
		businessCode: "registration-own-001",
		hospitalId: "10389001",
		patientId: "provider-own-001",
		insuredAreaCode: "140582",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
	});
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-own-001",
		ownerUserId: "user-wechat-own-001",
		medicalOrderId: "wechat-own-001",
		providerSubject: "openid-own-001",
		payAuthNo: "pay-auth-own-001",
		patient: {
			idNo: "140581199001010011",
			userName: "自费测试人",
			idType: "01",
		},
		psnNo: "psn-own-001",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "insu-own-001",
		expiresAt: "2026-09-08T09:00:00.000Z",
		createdAt: now,
	});
	let createInput!: Parameters<WechatPaymentGateway["createJsapiOrder"]>[0];
	let createCalls = 0;
	let queryCalls = 0;
	let confirmCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations,
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: "user-wechat-own-001",
				providerSubject: "openid-own-001",
			},
		]),
		patients: {} as never,
		wechatPayment: {} as never,
		wechatCashPayment: {
			createJsapiOrder: async (input) => {
				createCalls += 1;
				createInput = input;
				return {
					prepayId: "prepay-own-001",
					payParams: {
						appId: "wx-app-own-001",
						timeStamp: "1786752000",
						nonceStr: "nonce-own-001",
						package: "prepay_id=prepay-own-001",
						signType: "RSA" as const,
						paySign: "signature-own-001",
					},
					trace: {
						provider: "wechat-pay" as const,
						operation: "jsapi-prepay",
						requestId: "wechat-own-create-001",
					},
				};
			},
			query: async () => {
				queryCalls += 1;
				return {
					state: "cash_paid" as const,
					totalFen: 200,
					trace: {
						provider: "wechat-pay" as const,
						operation: "order-query",
						requestId: "wechat-own-query-001",
					},
				};
			},
			close: async () => ({
				trace: {
					provider: "wechat-pay" as const,
					operation: "order-close",
					requestId: "wechat-own-close-001",
				},
			}),
		} as WechatPaymentGateway,
		confirmCashPayment: async () => {
			confirmCalls += 1;
			return {
				orderId: "wechat-own-001",
				status: "insurance_settled",
				amounts: {
					totalFen: 1000,
					insuranceFen: 800,
					cashFen: 200,
				},
			} as never;
		},
		now: () => new Date(now),
	});

	const ready = await service.create({
		ownerUserId: "user-wechat-own-001",
		orderId: "wechat-own-001",
		context: {
			traceId: "medical-own-create-001",
			idempotencyKey: "medical-own-create-001",
		},
	});
	expect(createCalls).toBe(1);
	expect(createInput).toMatchObject({
		openid: "openid-own-001",
		totalFen: 200,
		orderType: "RegPay",
	});
	expect(ready).toMatchObject({
		paymentState: "prepay_ready",
		payParams: { appId: "wx-app-own-001" },
	});

	const confirmed = await service.query({
		ownerUserId: "user-wechat-own-001",
		orderId: "wechat-own-001",
		context: {
			traceId: "medical-own-query-001",
			idempotencyKey: "medical-own-query-001",
		},
	});
	expect(queryCalls).toBe(1);
	expect(confirmCalls).toBe(1);
	expect(confirmed).toMatchObject({
		status: "insurance_settled",
		paymentState: "cash_paid",
		cashFen: 200,
	});
});

test("医院负担不掩盖已过期的微信现金预支付", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			amounts: {
				totalFen: 1000,
				cashFen: 200,
				personalAccountFen: 300,
				fundFen: 300,
				otherPaymentFen: 200,
				hospitalPartFen: 200,
			},
			wechatPayParams: {
				timeStamp: "1786751999",
				nonceStr: "expired-cash-nonce-001",
				package: "prepay_id=expired-cash-prepay-001",
				signType: "RSA",
				paySign: "expired-cash-signature-001",
				mixTradeNo: "mix-query-001",
			},
			wechatPrepayExpiresAt: "2026-09-08T07:59:59.000Z",
		}),
	);
	await orders.saveSettlementContext(
		"user-wechat-query-001",
		"wechat-query-001",
		{
			businessId: "appointment-wechat-query-001",
			businessCode: "registration-wechat-query-001",
			hospitalId: "10389001",
			patientId: "provider-wechat-query-001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
		},
	);
	const service = makeService(orders, {
		mixState: "pending",
		cashState: "pending",
		insuranceState: "pending",
		medInsPayStatus: "MED_INS_PAY_CREATED",
		cashFen: 200,
		totalFen: 1000,
		providerStatus: "MIX_PAY_CREATED/SELF_PAY_CREATED/MED_INS_PAY_CREATED",
		trace: {
			provider: "wechat-pay",
			operation: "medical-mix-query",
			requestId: "medical-expired-cash-query-001",
		},
	});

	await expect(
		service.create({
			ownerUserId: "user-wechat-query-001",
			orderId: "wechat-query-001",
			context: {
				traceId: "medical-expired-cash-trace-001",
				idempotencyKey: "medical-expired-cash-request-001",
			},
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceWechatPrepayExpiredError);
});

test("6202纯医保且关系为空时按本人创建官方INSURANCE_ONLY订单", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			authorizationId: "authorization-pure-001",
			amounts: {
				totalFen: 1000,
				cashFen: 0,
				personalAccountFen: 300,
				fundFen: 700,
			},
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
			businessCode: "registration-pure-001",
			hospitalId: "10389001",
			patientId: "provider-pure-001",
			insuredAreaCode: "140500",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
		},
	);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-pure-001",
		ownerUserId: "user-wechat-query-001",
		medicalOrderId: "wechat-query-001",
		providerSubject: "openid-pure-001",
		payAuthNo: "pay-auth-pure-001",
		patient: {
			idNo: "140500199001010011",
			userName: "纯医保测试人",
			idType: "01",
		},
		psnNo: "psn-pure-001",
		insutype: "310",
		insuplcAdmdvs: "140500",
		insuCode: "insu-pure-001",
		expiresAt: "2026-09-08T09:00:00.000Z",
		createdAt: now,
	});
	const patients = createInMemoryPatientRepository();
	await patients.upsertFromDirectory({
		ownerUserId: "user-wechat-query-001",
		patientId: "patient-wechat-query-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-pure-001",
			displayName: "纯医保测试人",
			relationship: "unknown",
			cardNumberMasked: "******0011",
		},
	});
	let createInput:
		| Parameters<MedicalInsuranceWechatPaymentGateway["createMixedOrder"]>[0]
		| undefined;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations,
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: "user-wechat-query-001",
				providerSubject: "openid-pure-001",
			},
		]),
		patients,
		wechatPayment: {
			createMixedOrder: async (
				input: Parameters<
					MedicalInsuranceWechatPaymentGateway["createMixedOrder"]
				>[0],
			) => {
				createInput = input;
				return {
					mixTradeNo: "mix-pure-001",
					payParams: { mixTradeNo: "mix-pure-001" },
					cashFen: 0,
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-create",
						requestId: "wechat-pure-001",
					},
				};
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("payment creation must not finalize HIS");
		},
		now: () => new Date(now),
	});

	const result = await service.create({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "medical-pure-create-001",
			idempotencyKey: "medical-pure-create-001",
		},
	});

	expect(createInput).toMatchObject({
		orderType: "RegPay",
		amounts: { cashFen: 0 },
		paymentIdentity: { payForRelatives: false },
	});
	expect(result).toMatchObject({
		status: "cash_pending",
		paymentState: "prepay_ready",
		payParams: { mixTradeNo: "mix-pure-001" },
	});
	expect(await orders.findByMedicalOrderId("wechat-query-001")).toMatchObject({
		wechatMixTradeNo: "mix-pure-001",
		wechatPrepayExpiresAt: null,
		wechatPaymentState: "prepay_ready",
	});
});

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

test("历史医保 MD5 调起参数不会再次返回或触发重复混合下单", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			wechatPayParams: null,
			wechatPayParamsFormat: "legacy_md5",
		}),
	);
	let createCalls = 0;
	let queryCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {
			createMixedOrder: async () => {
				createCalls += 1;
				throw new Error("legacy MD5 order must not be recreated");
			},
			queryMixedOrder: async () => {
				queryCalls += 1;
				return {
					mixState: "pending",
					cashState: "pending",
					insuranceState: "pending",
					medInsPayStatus: "MED_INS_PAY_CREATED",
					cashFen: 200,
					totalFen: 1000,
					providerStatus:
						"MIX_PAY_CREATED/SELF_PAY_CREATED/MED_INS_PAY_CREATED",
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-query",
						requestId: "legacy-md5-query-001",
					},
				};
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("legacy MD5 order must not complete synchronously");
		},
		now: () => new Date(now),
	});

	const result = await service.create({
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "legacy-md5-create-001",
			idempotencyKey: "legacy-md5-create-001",
		},
	});

	expect(result).toMatchObject({
		status: "cash_pending",
		paymentState: "prepay_ready",
		mixTradeNo: "mix-query-001",
	});
	expect(result).not.toHaveProperty("payParams");
	expect(createCalls).toBe(0);
	expect(queryCalls).toBe(1);
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
			fundFen: 500,
			personalAccountFen: 300,
			otherPaymentFen: 0,
			medicalCashFen: 200,
			cashReduceDetails: [],
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

test("医保现金回调按已落库 out_trade_no 关联，不依赖 MIP 前缀", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			wechatOutTradeNo: "MZJSD20260917003002",
			wechatMixTradeNo: "mix-mzjsd-cash-001",
		}),
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository();
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: tasks,
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {} as never,
		confirmCashPayment: async () => {
			throw new Error("cash callback must not complete HIS");
		},
		now: () => new Date(now),
	});
	const notification: WechatPaymentNotification = {
		notificationId: "medical-cash-notification-mzjsd-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "MZJSD20260917003002",
		tradeState: "SUCCESS",
		totalFen: 200,
		providerTransactionId: "4200000000000201",
		receivedAt: now,
	};

	await expect(
		service.receiveCashNotification({
			notification,
			context: {
				traceId: notification.notificationId,
				idempotencyKey: `cash:${notification.notificationId}`,
			},
		}),
	).resolves.toBe(true);
	expect(await tasks.claimDueForQuery(new Date(now), 1, 60_000)).toHaveLength(
		1,
	);
});

test("亲属混合支付使用当前微信本人作为付款人并使用选中就诊人作为亲属", async () => {
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
			businessCode: "REGISTRATION-001",
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
		patient: {
			idNo: "140581201501010011",
			userName: "选中儿童",
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
			relationship: "child",
			cardNumberMasked: "******0011",
		},
	});
	let paymentIdentity: unknown;
	const recoverFirstValues: Array<boolean | undefined> = [];
	const paymentSequence: string[] = [];
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
			resolve: async (input) => {
				expect(input).toEqual({
					unionId: "union-relative-001",
					providerPatientId: "provider-self-001",
				});
				return {
					patient: {
						providerPatientId: "provider-self-001",
						name: "当前微信本人",
						cardNo: "CARD-SELF-001",
						idNo: "140581198001010022",
						phone: "13800000000",
					},
					trace: {
						provider: "zhongyang",
						operation: "appointment-patient-profile",
						requestId: "profile-relative-001",
					},
				};
			},
		},
		wechatPayment: {
			createMixedOrder: async (
				input: Parameters<
					MedicalInsuranceWechatPaymentGateway["createMixedOrder"]
				>[0],
			) => {
				paymentSequence.push("wechat-medical-mix");
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
		pluginPaymentBridge: {
			prepareSplitPaymentsBeforeOfficialWechatPayment: async () => {
				paymentSequence.push("yunhealth-2.6.65.2");
				return {};
			},
		} as never,
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
	expect(paymentSequence.slice(0, 2)).toEqual([
		"yunhealth-2.6.65.2",
		"wechat-medical-mix",
	]);
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

test("504 后进入人工审核的订单不会再次预下单或触发医保查单", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "manual_review",
			wechatPaymentState: "unknown",
			medInsFailReason: "MIX_PAY_FAIL",
		}),
	);
	let providerCalls = 0;
	const service = new MedicalInsuranceWechatPaymentService({
		orders,
		queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
		authorizations: {} as never,
		identityUsers: {} as never,
		patients: {} as never,
		wechatPayment: {
			createMixedOrder: async () => {
				providerCalls += 1;
				throw new Error("must not recreate a manual-review order");
			},
			queryMixedOrder: async () => {
				providerCalls += 1;
				throw new Error("must not query a manual-review order");
			},
		} as unknown as MedicalInsuranceWechatPaymentGateway,
		confirmCashPayment: async () => {
			throw new Error("must not complete a manual-review order");
		},
	});
	const input = {
		ownerUserId: "user-wechat-query-001",
		orderId: "wechat-query-001",
		context: {
			traceId: "manual-review-replay-001",
			idempotencyKey: "manual-review-replay-idempotency-001",
		},
	};

	await expect(service.create(input)).resolves.toMatchObject({
		status: "manual_review",
		paymentState: "unknown",
		medInsFailReason: "MIX_PAY_FAIL",
	});
	await expect(service.query(input)).resolves.toMatchObject({
		status: "manual_review",
		paymentState: "unknown",
		medInsFailReason: "MIX_PAY_FAIL",
	});
	expect(providerCalls).toBe(0);
});
