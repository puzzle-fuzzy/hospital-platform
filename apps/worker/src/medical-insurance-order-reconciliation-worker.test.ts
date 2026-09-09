import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceQueryTask,
	MedicalInsuranceSettlementEvidence,
} from "@hospital/domain";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
	createInMemoryPatientRepository,
} from "@hospital/persistence";
import { MedicalInsuranceOrderReconciliationWorker } from "./medical-insurance-order-reconciliation-worker";

const now = new Date("2026-09-03T00:00:00.000Z");

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-order-worker-001",
		ownerUserId: "user-worker-001",
		patientId: "patient-worker-001",
		appointmentId: "appointment-worker-001",
		authorizationId: "authorization-worker-001",
		feeUploadId: "credential-worker-001",
		idempotencyKey: "medical-order-worker-idempotency",
		medOrgOrd: "medical-order-worker-001",
		chrgBchno: "charge-worker-001",
		payOrdId: "pay-order-worker-001",
		payTokenHash: "a".repeat(64),
		mdtrtId: "mdtrt-worker-001",
		acctUsedFlag: "1",
		status: "order_placed",
		ordStas: "1",
		amounts: {
			totalFen: 100,
			cashFen: 20,
			personalAccountFen: 30,
			fundFen: 50,
		},
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		...overrides,
	};
}

function task(
	overrides: Partial<MedicalInsuranceQueryTask> = {},
): MedicalInsuranceQueryTask {
	return {
		taskId: "medical-order-worker-001",
		medicalOrderId: "medical-order-worker-001",
		status: "pending",
		version: 1,
		attempts: 0,
		maxAttempts: 12,
		nextAttemptAt: now.toISOString(),
		claimedUntil: null,
		terminalOrdStas: null,
		lastErrorCode: null,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
		...overrides,
	};
}

function evidence(
	overrides: Partial<MedicalInsuranceSettlementEvidence> = {},
): MedicalInsuranceSettlementEvidence {
	return {
		state: "awaiting_confirmation",
		amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
		trace: {
			provider: "medical-insurance",
			operation: "medical-insurance.6301",
			requestId: "medical-query-worker-001",
		},
		source: "6301",
		providerStatus: "1",
		finality: "processing",
		authoritative: false,
		...overrides,
	};
}

test("new medical order worker retries non-terminal 6301 evidence", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let receivedOwner: string | undefined;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async (input) => {
				receivedOwner = input.ownerUserId;
				return evidence();
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(receivedOwner).toBe("user-worker-001");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "awaiting_confirmation",
		amounts: order().amounts,
	});

	// The task repository is intentionally exercised through its public claim path;
	// an immediate second run must respect the backoff written by the worker.
	expect(await worker.runOnce(now)).toBe("idle");
});

test("authoritative Yunhealth evidence still waits for the official WeChat medical order", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "awaiting_confirmation",
			version: 2,
			amounts: {
				totalFen: 100,
				cashFen: 0,
				personalAccountFen: 30,
				fundFen: 70,
			},
			setlType: "ALL",
		}),
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([
		task({ version: 2, attempts: 1, nextAttemptAt: now.toISOString() }),
	]);
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () =>
				evidence({
					amounts: { totalFen: 100, insuranceFen: 100, cashFen: 0 },
					state: "insurance_settled",
					source: "yunhealth",
					providerStatus: "isSettle=1",
					finality: "paid",
					authoritative: true,
				}),
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "cash_pending",
		version: 3,
	});
});

test("new medical order worker does not query an order already in manual review", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order({ status: "manual_review" }));
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let queryCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () => {
				queryCalls += 1;
				return evidence();
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("manual_review");
	expect(queryCalls).toBe(0);
	const [claimedAgain] = await tasks.claimDueForQuery(
		new Date(now.getTime() + 60_000),
		1,
		60_000,
	);
	expect(claimedAgain).toBeUndefined();
});

test("worker recovers an unknown WeChat medical create result by out_trade_no", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatOutTradeNo: "out-worker-recovery-001",
			wechatPaymentState: "unknown",
			wechatPrepayExpiresAt: "2026-09-03T02:00:00.000Z",
		}),
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	const patients = createInMemoryPatientRepository([
		{
			id: "patient-worker-001",
			ownerUserId: "user-worker-001",
			displayName: "代付儿童",
			relationship: "child",
			cardNumberMasked: "******0011",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);
	let recoveredInput: unknown;
	let createCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: "user-worker-001",
				providerSubject: "openid-worker-001",
			},
		]),
		patients,
		medicalInsurance: { query: async () => evidence() },
		wechatPayment: {
			createMixedOrder: async () => {
				createCalls += 1;
				throw new Error("create must not be used during recovery");
			},
			recoverMixedOrder: async (input) => {
				recoveredInput = input;
				return {
					mixTradeNo: "mix-worker-recovery-001",
					prepayId: "prepay-worker-recovery-001",
					payParams: {
						timeStamp: "1788393600",
						nonceStr: "nonce-worker-recovery-001",
						package: "prepay_id=prepay-worker-recovery-001",
						signType: "RSA",
						paySign: "signature-worker-recovery-001",
						mixTradeNo: "mix-worker-recovery-001",
					},
					cashFen: 20,
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-create-recovered",
						requestId: "medical-mix-recovery-worker-001",
					},
				};
			},
			queryMixedOrder: async () => ({
				mixState: "pending",
				cashState: "pending",
				insuranceState: "pending",
				medInsPayStatus: "MED_INS_PAY_CREATED",
				cashFen: 20,
				totalFen: 100,
				providerStatus: "MIX_PAY_CREATED/SELF_PAY_CREATED/MED_INS_PAY_CREATED",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-mix-query-worker-recovery-001",
				},
			}),
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(createCalls).toBe(0);
	expect(recoveredInput).toEqual({
		orderId: "medical-order-worker-001",
		outTradeNo: "out-worker-recovery-001",
		openid: "openid-worker-001",
		payOrdId: "pay-order-worker-001",
		medOrgOrd: "medical-order-worker-001",
		orderType: "RegPay",
		amounts: order().amounts,
		expectedPayForRelatives: true,
	});
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		wechatMixTradeNo: "mix-worker-recovery-001",
		wechatOutTradeNo: "out-worker-recovery-001",
		wechatPaymentState: "prepay_ready",
		wechatPrepayExpiresAt: "2026-09-03T02:00:00.000Z",
		wechatPayParams: {
			package: "prepay_id=prepay-worker-recovery-001",
			mixTradeNo: "mix-worker-recovery-001",
		},
	});
});

test("mixed worker marks cash paid only after both WeChat payment parts are paid", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-worker-001",
			wechatOutTradeNo: "out-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-worker-001",
			hospitalId: "hospital-worker-001",
			patientId: "provider-patient-worker-001",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-worker-001"],
			payingId: "260650000000001",
			tradingId: "260650000000002",
			plugin: {
				paymentOrderId: "payment-worker-001",
				payingId: "260650000000003",
				tradingId: "260650000000004",
				payTypeId: "5",
				payType: "CREDIT",
				workStationId: "",
				tradeCode: "trade-code-worker-001",
				tradeTypeCode: "10",
				outTradeNo: "out-worker-001",
				recordCode: "record-worker-001",
				state: "prepay_ready",
			},
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let legacyQueryCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () => {
				legacyQueryCalls += 1;
				return evidence();
			},
		},
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => ({
				mixState: "paid",
				cashState: "paid",
				insuranceState: "paid",
				medInsPayStatus: "MED_INS_PAY_SUCCESS",
				cashFen: 20,
				totalFen: 100,
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-mix-worker-001",
				},
			}),
		},
		completeWechatPayment: async (input) => {
			expect(input).toMatchObject({
				medicalOrderId: "medical-order-worker-001",
				paymentOrderId: "payment-worker-001",
			});
			return true;
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(legacyQueryCalls).toBe(0);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "cash_pending",
		wechatPaymentState: "cash_paid",
	});
});

test("mixed worker does not write HIS when only the cash part is paid", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-worker-pending-001",
			wechatOutTradeNo: "out-worker-pending-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let completionCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: { query: async () => evidence() },
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => ({
				mixState: "pending",
				cashState: "paid",
				insuranceState: "pending",
				medInsPayStatus: "MED_INS_PAY_CREATED",
				cashFen: 20,
				totalFen: 100,
				providerStatus:
					"MIX_PAY_PROCESSING/SELF_PAY_SUCCESS/MED_INS_PAY_CREATED",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-mix-worker-pending-001",
				},
			}),
		},
		completeWechatPayment: async () => {
			completionCalls += 1;
			return true;
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(completionCalls).toBe(0);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "cash_pending",
		wechatPaymentState: "unknown",
	});
	const [scheduled] = await tasks.claimDueForQuery(
		new Date(now.getTime() + 15_000),
		1,
		60_000,
	);
	expect(scheduled).toMatchObject({
		status: "in_progress",
		terminalOrdStas: null,
		lastErrorCode: "wechat-mixed-payment-pending",
	});
});

test("pure insurance completes only after official WeChat query and final HIS settlement", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 0,
				personalAccountFen: 30,
				fundFen: 70,
			},
			setlType: "ALL",
			wechatMixTradeNo: "mix-pure-worker-001",
			wechatOutTradeNo: "out-pure-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-pure-worker-001",
			businessCode: "trade-code-pure-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-pure-worker-001"],
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let cashPaymentConfirmed: boolean | undefined;
	const componentInputs: unknown[] = [];
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async (input) => {
				cashPaymentConfirmed = input.cashPaymentConfirmed;
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 100, cashFen: 0 },
					state: "insurance_settled",
					source: "yunhealth",
					providerStatus: "isSettle=1",
					finality: "paid",
					authoritative: true,
				});
			},
		},
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => ({
				mixState: "paid",
				cashState: "paid",
				insuranceState: "paid",
				medInsPayStatus: "MED_INS_PAY_SUCCESS",
				cashFen: 0,
				totalFen: 100,
				fundFen: 70,
				personalAccountFen: 30,
				otherPaymentFen: 0,
				medicalCashFen: 0,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/NO_SELF_PAY/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-pure-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async (input) => {
				componentInputs.push(input);
				return {
					payingId: `26065000000000${componentInputs.length}`,
					tradingId: `26066000000000${componentInputs.length}`,
					payTypeId: input.payTypeId,
					payType: input.payType,
					workStationId: input.workStationId,
					tradeTypeCode: input.tradeTypeCode,
					trace: {
						provider: "yunhealth",
						operation: "registration-plugin-payment-preorder",
						requestId: `component-${componentInputs.length}`,
					},
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(cashPaymentConfirmed).toBeTrue();
	expect(componentInputs).toEqual([
		expect.objectContaining({
			totalFen: 100,
			amountFen: 70,
			payModel: "H5",
			payTypeId: "2",
		}),
		expect.objectContaining({
			totalFen: 100,
			amountFen: 30,
			payModel: "H5",
			payTypeId: "3",
		}),
	]);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "insurance_settled",
		wechatPaymentState: "cash_paid",
		ordStas: "isSettle=1",
		version: 3,
	});
});

test("mixed payment persists successful post-payment components and retries only the failed component", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 30,
				personalAccountFen: 20,
				fundFen: 50,
				hospitalPartFen: 10,
			},
			wechatMixTradeNo: "mix-component-worker-001",
			wechatOutTradeNo: "out-component-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-component-worker-001",
			businessCode: "trade-code-component-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-component-worker-001"],
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	const componentCalls: Array<{
		orderId: string;
		totalFen: number;
		amountFen?: number;
		payModel?: string;
		payTypeId: string;
	}> = [];
	let personalAccountAttempts = 0;
	let finalizationCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async (input) => {
				if (!input.cashPaymentConfirmed) {
					throw new Error("finalization must be payment-confirmed");
				}
				finalizationCalls += 1;
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 70, cashFen: 30 },
					state: "insurance_settled",
					source: "yunhealth",
					providerStatus: "isSettle=1",
					finality: "paid",
					authoritative: true,
				});
			},
		},
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => ({
				mixState: "paid",
				cashState: "paid",
				insuranceState: "paid",
				medInsPayStatus: "MED_INS_PAY_SUCCESS",
				cashFen: 20,
				totalFen: 100,
				fundFen: 50,
				personalAccountFen: 20,
				otherPaymentFen: 0,
				medicalCashFen: 30,
				cashReduceDetails: [
					{ cashReduceFen: 10, cashReduceType: "HOSPITAL_REDUCE" },
				],
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-component-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async (input) => {
				componentCalls.push(input);
				if (input.orderId.endsWith(":personal_account")) {
					personalAccountAttempts += 1;
					if (personalAccountAttempts === 1) {
						throw new Error("temporary personal account failure");
					}
				}
				return {
					payingId: `27065000000000${componentCalls.length}`,
					tradingId: `27066000000000${componentCalls.length}`,
					payTypeId: input.payTypeId,
					payType: input.payType,
					workStationId: input.workStationId,
					tradeTypeCode: input.tradeTypeCode,
					trace: {
						provider: "yunhealth",
						operation: "registration-plugin-payment-preorder",
						requestId: `component-${componentCalls.length}`,
					},
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	let settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	expect(
		settlement?.postPaymentComponents?.map((component) => component.state),
	).toEqual(["succeeded", "succeeded", "failed", "pending"]);

	const retryAt = new Date(now.getTime() + 60_000);
	expect(await worker.runOnce(retryAt)).toBe("reconciled");
	expect(
		componentCalls.map((input) => input.orderId.split(":").at(-1)),
	).toEqual([
		"hospital_reduce",
		"fund",
		"personal_account",
		"personal_account",
		"wechat_cash",
	]);
	expect(
		componentCalls.map(({ totalFen, amountFen, payModel, payTypeId }) => ({
			totalFen,
			amountFen,
			payModel,
			payTypeId,
		})),
	).toEqual([
		{ totalFen: 100, amountFen: 10, payModel: "H5", payTypeId: "50" },
		{ totalFen: 100, amountFen: 50, payModel: "H5", payTypeId: "2" },
		{ totalFen: 100, amountFen: 20, payModel: "H5", payTypeId: "3" },
		{ totalFen: 100, amountFen: 20, payModel: "H5", payTypeId: "3" },
		{
			totalFen: 100,
			amountFen: 20,
			payModel: "MINI_PROGRAM",
			payTypeId: "3",
		},
	]);
	expect(finalizationCalls).toBe(1);
	settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	expect(
		settlement?.postPaymentComponents?.every(
			(item) => item.state === "succeeded",
		),
	).toBeTrue();
	expect(settlement?.postPaymentCompletedAt).toBe(retryAt.toISOString());
});

test("nonzero med_ins_other_fee stays unmapped and blocks post-payment writeback", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 110,
				cashFen: 20,
				personalAccountFen: 30,
				fundFen: 50,
				otherPaymentFen: 10,
			},
			wechatMixTradeNo: "mix-other-worker-001",
			wechatOutTradeNo: "out-other-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-other-worker-001",
			businessCode: "trade-code-other-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-other-worker-001"],
		},
	);
	let postPaymentCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: { query: async () => evidence() },
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => ({
				mixState: "paid",
				cashState: "paid",
				insuranceState: "paid",
				medInsPayStatus: "MED_INS_PAY_SUCCESS",
				cashFen: 20,
				totalFen: 110,
				fundFen: 50,
				personalAccountFen: 30,
				otherPaymentFen: 10,
				medicalCashFen: 20,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-other-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async () => {
				postPaymentCalls += 1;
				throw new Error("must not submit an incomplete split");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(postPaymentCalls).toBe(0);
	expect(
		(
			await orders.getSettlementContext(
				"user-worker-001",
				"medical-order-worker-001",
			)
		)?.postPaymentComponents,
	).toBeUndefined();
});
