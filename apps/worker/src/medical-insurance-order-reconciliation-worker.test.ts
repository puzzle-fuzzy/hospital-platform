import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	MedicalInsuranceOrder,
	MedicalInsurancePostPaymentComponent,
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

function prePaymentComponent(
	kind: MedicalInsurancePostPaymentComponent["kind"],
	amountFen: number,
	payModel: MedicalInsurancePostPaymentComponent["payModel"],
	payTypeId: MedicalInsurancePostPaymentComponent["payTypeId"],
	totalFen = 100,
): MedicalInsurancePostPaymentComponent {
	const medicalOrderId = "medical-order-worker-001";
	return {
		componentId: `${medicalOrderId}:${kind}`,
		kind,
		totalFen,
		amountFen,
		payModel,
		payTypeId,
		recordCode: createHash("sha256")
			.update(`medical-post-payment:${medicalOrderId}:${kind}`)
			.digest("hex")
			.slice(0, 32),
		state: "succeeded",
		attempts: 1,
		payingId: `paying-${kind}`,
		tradingId: `trading-${kind}`,
		providerRequestId: `pre-payment-${kind}`,
		updatedAt: now.toISOString(),
	};
}

function sequencedPostPaymentComponents(
	cashPayTypeId: "5031" | "5033" = "5033",
): readonly MedicalInsurancePostPaymentComponent[] {
	const medicalOrderId = "medical-order-worker-001";
	return [
		{
			componentId: `${medicalOrderId}:medical`,
			kind: "medical",
			totalFen: 100,
			amountFen: 80,
			payModel: "H5",
			payTypeId: "2",
			payTypeParams: [
				{ kind: "fund", payTypeId: "2", amountFen: 50 },
				{ kind: "personal_account", payTypeId: "5", amountFen: 30 },
			],
			recordCode: createHash("sha256")
				.update(`medical-post-payment:${medicalOrderId}:medical`)
				.digest("hex")
				.slice(0, 32),
			state: "succeeded",
			attempts: 1,
			payingId: "paying-medical-001",
			tradingId: "trading-medical-001",
			providerRequestId: "pre-payment-medical-001",
			updatedAt: now.toISOString(),
		},
		{
			componentId: `${medicalOrderId}:wechat_cash`,
			kind: "wechat_cash",
			totalFen: 100,
			amountFen: 20,
			payModel: "H5",
			payTypeId: cashPayTypeId,
			recordCode: createHash("sha256")
				.update(`medical-post-payment:${medicalOrderId}:wechat_cash`)
				.digest("hex")
				.slice(0, 32),
			state: "pending",
			attempts: 0,
			updatedAt: now.toISOString(),
		},
	];
}

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

test("worker按本人恢复关系为空患者的未知微信医保建单结果", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatOutTradeNo: "out-worker-recovery-001",
			wechatPaymentState: "unknown",
			wechatPrepayExpiresAt: "2026-09-03T02:00:00.000Z",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-worker-recovery-001",
			hospitalId: "1001",
			patientId: "2001",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
			postPaymentPlanVersion: "sequenced-v1",
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	const patients = createInMemoryPatientRepository([
		{
			id: "patient-worker-001",
			ownerUserId: "user-worker-001",
			displayName: "关系为空测试人",
			relationship: "unknown",
			cardNumberMasked: "******0011",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);
	let recoveredInput: unknown;
	let createCalls = 0;
	let officialRecoverCalls = 0;
	let ordinaryQueryCalls = 0;
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
				officialRecoverCalls += 1;
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
		wechatCashPayment: {
			createJsapiOrder: async () => {
				throw new Error("ordinary WeChat create is not used");
			},
			query: async () => {
				ordinaryQueryCalls += 1;
				throw new Error(
					"sequenced medical recovery must not use ordinary WeChat query",
				);
			},
			close: async () => {
				throw new Error("ordinary WeChat close is not used");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(createCalls).toBe(0);
	expect(officialRecoverCalls).toBe(1);
	expect(ordinaryQueryCalls).toBe(0);
	expect(recoveredInput).toEqual({
		orderId: "medical-order-worker-001",
		outTradeNo: "out-worker-recovery-001",
		openid: "openid-worker-001",
		payOrdId: "pay-order-worker-001",
		medOrgOrd: "medical-order-worker-001",
		orderType: "RegPay",
		amounts: order().amounts,
		expectedPayForRelatives: false,
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
			wechatPayParamsFormat: "legacy_md5",
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

test("legacy plugin order uses completeWechatPayment when postPayment is globally configured", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-legacy-plugin-worker-001",
			wechatOutTradeNo: "out-legacy-plugin-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-legacy-plugin-worker-001",
			businessCode: "trade-code-legacy-plugin-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140500",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-legacy-plugin-worker-001"],
			plugin: {
				paymentOrderId: "payment-legacy-plugin-worker-001",
				payingId: "paying-legacy-plugin-worker-001",
				tradingId: "trading-legacy-plugin-worker-001",
				payTypeId: "5031",
				payType: "CREDIT",
				workStationId: "",
				tradeCode: "trade-code-legacy-plugin-worker-001",
				tradeTypeCode: "1",
				outTradeNo: "out-legacy-plugin-worker-001",
				recordCode: "record-legacy-plugin-worker-001",
				state: "cash_paid",
			},
		},
	);
	let medicalFinalizeCalls = 0;
	let newPreOrderCalls = 0;
	let legacyCompletionCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async () => {
				medicalFinalizeCalls += 1;
				throw new Error("legacy plugin must use completeWechatPayment");
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
				personalAccountFen: 30,
				otherPaymentFen: 0,
				medicalCashFen: 20,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "wechat-legacy-plugin-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async () => {
				newPreOrderCalls += 1;
				throw new Error("legacy plugin must not enter component orchestration");
			},
		},
		completeWechatPayment: async (input) => {
			legacyCompletionCalls += 1;
			expect(input).toEqual({
				ownerUserId: "user-worker-001",
				medicalOrderId: "medical-order-worker-001",
				paymentOrderId: "payment-legacy-plugin-worker-001",
			});
			return true;
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(legacyCompletionCalls).toBe(1);
	expect(newPreOrderCalls).toBe(0);
	expect(medicalFinalizeCalls).toBe(0);
});

test("legacy top-level .2 IDs use medical finalize when postPayment is globally configured", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-legacy-medical-worker-001",
			wechatOutTradeNo: "out-legacy-medical-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-legacy-medical-worker-001",
			businessCode: "trade-code-legacy-medical-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140500",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-legacy-medical-worker-001"],
			payingId: "paying-legacy-medical-worker-001",
			tradingId: "trading-legacy-medical-worker-001",
		},
	);
	let medicalFinalizeCalls = 0;
	let newPreOrderCalls = 0;
	let legacyPluginCompletionCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async (input) => {
				medicalFinalizeCalls += 1;
				expect(input).toEqual({
					orderId: "medical-order-worker-001",
					ownerUserId: "user-worker-001",
					cashPaymentConfirmed: true,
				});
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
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
				personalAccountFen: 30,
				otherPaymentFen: 0,
				medicalCashFen: 20,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "wechat-legacy-medical-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async () => {
				newPreOrderCalls += 1;
				throw new Error("legacy top-level IDs must not enter component flow");
			},
		},
		completeWechatPayment: async () => {
			legacyPluginCompletionCalls += 1;
			throw new Error("legacy plugin completion is not used without plugin");
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(medicalFinalizeCalls).toBe(1);
	expect(newPreOrderCalls).toBe(0);
	expect(legacyPluginCompletionCalls).toBe(0);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "insurance_settled",
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

test("医院负担不让 Worker 把过期微信现金预支付误判为可用", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 20,
				personalAccountFen: 30,
				fundFen: 30,
				otherPaymentFen: 20,
				hospitalPartFen: 20,
			},
			wechatMixTradeNo: "mix-expired-cash-worker-001",
			wechatOutTradeNo: "out-expired-cash-worker-001",
			wechatPaymentState: "prepay_ready",
			wechatPayParams: {
				timeStamp: "1788393599",
				nonceStr: "expired-cash-worker-nonce-001",
				package: "prepay_id=expired-cash-worker-001",
				signType: "RSA",
				paySign: "expired-cash-worker-signature-001",
				mixTradeNo: "mix-expired-cash-worker-001",
			},
			wechatPrepayExpiresAt: "2026-09-02T23:59:59.000Z",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-expired-cash-worker-001",
			businessCode: "trade-expired-cash-worker-001",
			hospitalId: "10389001",
			patientId: "provider-expired-cash-worker-001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: [],
		},
	);
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
					requestId: "medical-expired-cash-worker-query-001",
				},
			}),
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({ wechatPaymentState: "unknown" });
});

test("pure insurance reaches terminal only after both .32 and .5 succeed", async () => {
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
			postPaymentPlanVersion: "sequenced-v1",
			postPaymentComponents: [
				{
					...prePaymentComponent("medical", 100, "H5", "2"),
					payTypeParams: [
						{ kind: "fund", payTypeId: "2", amountFen: 70 },
						{ kind: "personal_account", payTypeId: "5", amountFen: 30 },
					],
				},
			],
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let cashPaymentConfirmed: boolean | undefined;
	const componentInputs: unknown[] = [];
	const completionCalls: string[] = [];
	let medicalCompletionWrites = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async (input) => {
				cashPaymentConfirmed = input.cashPaymentConfirmed;
				completionCalls.push("medical.32");
				const current = await orders.getSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
				);
				if (!current) throw new Error("settlement context missing");
				medicalCompletionWrites += 1;
				completionCalls.push("medical.5");
				await orders.saveSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
					{
						...current,
						settlementWriteback: {
							attemptedAt: now.toISOString(),
							status: "succeeded",
							providerRequestId: "pure-medical-.32-001",
							providerStatus: "insur=SUCCESS,settle=SUCCESS",
						},
						settlementCompletion: {
							attemptedAt: now.toISOString(),
							status: "succeeded",
							providerRequestId: "pure-medical-.5-001",
							providerStatus: "completion=1",
						},
					},
				);
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
				throw new Error(".2 must not run after payment");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(cashPaymentConfirmed).toBeTrue();
	expect(componentInputs).toEqual([]);
	expect(medicalCompletionWrites).toBe(1);
	expect(completionCalls).toEqual(["medical.32", "medical.5"]);
	expect(completionCalls.filter((call) => call.endsWith(".5"))).toHaveLength(1);
	expect(
		await orders.getSettlementContext(
			"user-worker-001",
			"medical-order-worker-001",
		),
	).toMatchObject({
		settlementWriteback: { status: "succeeded" },
		settlementCompletion: { status: "succeeded" },
	});
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "insurance_settled",
		wechatPaymentState: "cash_paid",
		// ord_stas 仅保留 6202/6301 的短状态，后置诊断值不写入 VARCHAR(8)。
		ordStas: "1",
		version: 3,
	});
});

test("mixed payment validates one combined .2 before finalizing HIS once", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 20,
				personalAccountFen: 30,
				fundFen: 50,
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
			insuredAreaCode: "140500",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-component-worker-001"],
			postPaymentComponents: [
				{
					componentId: "medical-order-worker-001:combined",
					kind: "combined",
					totalFen: 100,
					amountFen: 100,
					payModel: "H5",
					payTypeId: "2",
					payTypeParams: [
						{ kind: "fund", payTypeId: "2", amountFen: 50 },
						{ kind: "personal_account", payTypeId: "5", amountFen: 30 },
						{ kind: "wechat_cash", payTypeId: "5031", amountFen: 20 },
					],
					recordCode: createHash("sha256")
						.update("medical-post-payment:medical-order-worker-001:combined")
						.digest("hex")
						.slice(0, 32),
					state: "succeeded",
					attempts: 1,
					payingId: "paying-combined",
					tradingId: "trading-combined",
					providerRequestId: "pre-payment-combined",
					updatedAt: now.toISOString(),
				},
			],
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	const componentCalls: Array<{
		orderId: string;
		totalFen: number;
		amountFen?: number;
		payModel?: string;
		payTypeId: string;
		paymentSystemUserId?: string;
	}> = [];
	let finalizationCalls = 0;
	let completeSettlementCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		identityUsers: createInMemoryIdentityUserRepository([
			{
				userId: "user-worker-001",
				providerSubject: "openid-component-worker-001",
			},
		]),
		medicalInsurance: {
			query: async (input) => {
				if (!input.cashPaymentConfirmed) {
					throw new Error("finalization must be payment-confirmed");
				}
				finalizationCalls += 1;
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
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
				personalAccountFen: 30,
				otherPaymentFen: 0,
				medicalCashFen: 20,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/NO_SELF_PAY/MED_INS_PAY_SUCCESS",
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
				throw new Error(".2 must not run after payment");
			},
			completeSettlement: async () => {
				completeSettlementCalls += 1;
				return {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.5",
					requestId: "complete-component-worker-001",
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(componentCalls).toEqual([]);
	expect(completeSettlementCalls).toBe(0);
	expect(finalizationCalls).toBe(1);
	const settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "insurance_settled",
		// 后置响应的诊断字符串不能写入 ord_stas VARCHAR(8)。
		ordStas: "1",
	});
	expect(
		settlement?.postPaymentComponents?.every(
			(item) => item.state === "succeeded",
		),
	).toBeTrue();
	expect(settlement?.postPaymentCompletedAt).toBe(now.toISOString());
});

test("sequenced-v1 mixed payment completes medical .32 before cash .2/.29/.15/.5 with one final .5", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-sequenced-worker-001",
			wechatOutTradeNo: "out-sequenced-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-sequenced-worker-001",
			businessCode: "trade-code-sequenced-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140500",
			networkRegister: {
				idNo: "140500199001010011",
				netPatName: "顺序测试人",
				memberNo: "psn-sequenced-worker-001",
				psnCertType: "01",
			},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-sequenced-worker-001"],
			postPaymentPlanVersion: "sequenced-v1",
			postPaymentComponents: sequencedPostPaymentComponents(),
		},
	);

	const calls: string[] = [];
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async (input) => {
				expect(input.cashPaymentConfirmed).toBeTrue();
				calls.push("medical.32");
				const current = await orders.getSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
				);
				if (!current) throw new Error("settlement context missing");
				await orders.saveSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
					{
						...current,
						settlementWriteback: {
							attemptedAt: now.toISOString(),
							status: "succeeded",
							providerRequestId: "medical-.32-sequenced-001",
							providerStatus: "insur=SUCCESS,settle=SUCCESS",
						},
					},
				);
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
					state: "awaiting_confirmation",
					source: "yunhealth",
					providerStatus: "medical_writeback_succeeded_cash_finalize_pending",
					finality: "settlement_candidate",
					authoritative: false,
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
			queryMixedOrder: async () => {
				calls.push("wechat.query");
				return {
					mixState: "paid",
					cashState: "paid",
					insuranceState: "paid",
					medInsPayStatus: "MED_INS_PAY_SUCCESS",
					cashFen: 20,
					totalFen: 100,
					fundFen: 50,
					personalAccountFen: 30,
					otherPaymentFen: 0,
					medicalCashFen: 20,
					cashReduceDetails: [],
					providerStatus:
						"MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-query",
						requestId: "wechat-sequenced-worker-001",
					},
				};
			},
		},
		postPaymentPayType: "CREDIT",
		postPaymentWorkStationId: "",
		postPaymentTradeTypeCode: "1",
		postPayment: {
			createPreOrder: async (input) => {
				calls.push("cash.2");
				expect(input).toMatchObject({
					orderId: "medical-order-worker-001:wechat_cash",
					amountFen: 20,
					payModel: "H5",
					payTypeId: "5033",
				});
				return {
					payingId: "paying-cash-001",
					tradingId: "trading-cash-001",
					payTypeId: "5033",
					payType: "CREDIT",
					workStationId: "",
					tradeTypeCode: "1",
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: "cash-.2-sequenced-001",
					},
				};
			},
		},
		hospitalSettlement: {
			writeBack: async (input) => {
				expect(input.orderId).toBe("medical-order-worker-001:wechat_cash");
				expect(input.skipCompleteSettlement).not.toBeTrue();
				expect(input.registrationContext).toMatchObject({
					payingId: "paying-cash-001",
					tradingId: "trading-cash-001",
					payTypeId: "5033",
				});
				calls.push("cash.29");
				await input.onThirdPartPayAttempt?.();
				await input.onThirdPartPayResponse?.({
					rawResponse:
						'{"success":true,"data":{"thirdPartPayRecordId":"third-part-cash-001"}}',
					thirdPartPayRecordId: "third-part-cash-001",
					requestId: "cash-.29-sequenced-001",
				});
				calls.push("cash.15");
				await input.onPaymentNotifyAttempt?.();
				await input.onPaymentNotifyResponse?.({
					requestId: "cash-.15-sequenced-001",
				});
				calls.push("cash.5");
				await input.onCompleteSettlementAttempt?.();
				return {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.5",
					requestId: "cash-.5-sequenced-001",
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(calls).toEqual([
		"wechat.query",
		"medical.32",
		"cash.2",
		"cash.29",
		"cash.15",
		"cash.5",
	]);
	expect(calls.filter((call) => call.endsWith(".5"))).toHaveLength(1);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({ status: "insurance_settled" });
	const settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	const medicalComponent = settlement?.postPaymentComponents?.find(
		(component) => component.kind === "medical",
	);
	const cashComponent = settlement?.postPaymentComponents?.find(
		(component) => component.kind === "wechat_cash",
	);
	expect(medicalComponent).toMatchObject({
		state: "succeeded",
		payingId: "paying-medical-001",
		tradingId: "trading-medical-001",
	});
	expect(cashComponent).toMatchObject({
		state: "succeeded",
		payingId: "paying-cash-001",
		tradingId: "trading-cash-001",
	});
	expect(cashComponent?.payingId).not.toBe(medicalComponent?.payingId);
	expect(cashComponent?.tradingId).not.toBe(medicalComponent?.tradingId);
	expect(settlement).toMatchObject({
		settlementWriteback: { status: "succeeded" },
		selfPayThirdPartyWriteback: { status: "succeeded" },
		selfPayPaymentNotify: { status: "succeeded" },
		selfPaySettlementCompletion: { status: "succeeded" },
	});
	expect(settlement?.settlementCompletion).toBeUndefined();
	expect(settlement?.postPaymentCompletedAt).toBeDefined();
});

test("sequenced-v1 pure cash skips medical finalize and completes .2/.29/.15/.5", async () => {
	const medicalOrderId = "medical-order-worker-001";
	const cashRecordCode = createHash("sha256")
		.update(`medical-post-payment:${medicalOrderId}:wechat_cash`)
		.digest("hex")
		.slice(0, 32);
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 100,
				personalAccountFen: 0,
				fundFen: 0,
			},
			wechatMixTradeNo: "mix-sequenced-cash-worker-001",
			wechatOutTradeNo: "out-sequenced-cash-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext("user-worker-001", medicalOrderId, {
		businessId: "business-sequenced-cash-worker-001",
		businessCode: "trade-code-sequenced-cash-worker-001",
		hospitalId: "1001",
		patientId: "2001",
		insuredAreaCode: "140500",
		networkRegister: {
			idNo: "140500199001010022",
			netPatName: "纯自费顺序测试人",
			memberNo: "psn-sequenced-cash-worker-001",
			psnCertType: "01",
		},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["trade-sequenced-cash-worker-001"],
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentComponents: [
			{
				componentId: `${medicalOrderId}:wechat_cash`,
				kind: "wechat_cash",
				totalFen: 100,
				amountFen: 100,
				payModel: "H5",
				payTypeId: "5033",
				recordCode: cashRecordCode,
				state: "pending",
				attempts: 0,
				updatedAt: now.toISOString(),
			},
		],
	});

	const calls: string[] = [];
	let medicalFinalizeCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async () => {
				medicalFinalizeCalls += 1;
				throw new Error("pure cash must not enter medical .32/.5 finalize");
			},
		},
		wechatPayment: {
			createMixedOrder: async () => {
				throw new Error("create is not used");
			},
			recoverMixedOrder: async () => {
				throw new Error("recover is not used");
			},
			queryMixedOrder: async () => {
				calls.push("wechat.query");
				return {
					mixState: "paid",
					cashState: "paid",
					insuranceState: "paid",
					medInsPayStatus: "MED_INS_PAY_SUCCESS",
					cashFen: 100,
					totalFen: 100,
					fundFen: 0,
					personalAccountFen: 0,
					otherPaymentFen: 0,
					medicalCashFen: 100,
					cashReduceDetails: [],
					providerStatus:
						"MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-query",
						requestId: "wechat-sequenced-cash-worker-001",
					},
				};
			},
		},
		postPaymentPayType: "CREDIT",
		postPaymentWorkStationId: "",
		postPaymentTradeTypeCode: "1",
		postPayment: {
			createPreOrder: async (input) => {
				calls.push("cash.2");
				expect(input).toMatchObject({
					orderId: `${medicalOrderId}:wechat_cash`,
					totalFen: 100,
					amountFen: 100,
					payModel: "H5",
					payTypeId: "5033",
					recordCode: cashRecordCode,
				});
				return {
					payingId: "paying-pure-cash-001",
					tradingId: "trading-pure-cash-001",
					payTypeId: "5033",
					payType: "CREDIT",
					workStationId: "",
					tradeTypeCode: "1",
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: "pure-cash-.2-sequenced-001",
					},
				};
			},
		},
		hospitalSettlement: {
			writeBack: async (input) => {
				expect(input.skipCompleteSettlement).not.toBeTrue();
				expect(input.registrationContext).toMatchObject({
					payingId: "paying-pure-cash-001",
					tradingId: "trading-pure-cash-001",
					recordCode: cashRecordCode,
					payTypeId: "5033",
				});
				calls.push("cash.29");
				await input.onThirdPartPayAttempt?.();
				await input.onThirdPartPayResponse?.({
					rawResponse:
						'{"success":true,"data":{"thirdPartPayRecordId":"third-part-pure-cash-001"}}',
					thirdPartPayRecordId: "third-part-pure-cash-001",
					requestId: "pure-cash-.29-sequenced-001",
				});
				calls.push("cash.15");
				await input.onPaymentNotifyAttempt?.();
				await input.onPaymentNotifyResponse?.({
					requestId: "pure-cash-.15-sequenced-001",
				});
				calls.push("cash.5");
				await input.onCompleteSettlementAttempt?.();
				return {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.5",
					requestId: "pure-cash-.5-sequenced-001",
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(medicalFinalizeCalls).toBe(0);
	expect(calls).toEqual([
		"wechat.query",
		"cash.2",
		"cash.29",
		"cash.15",
		"cash.5",
	]);
	expect(calls.filter((call) => call.endsWith(".5"))).toHaveLength(1);
	expect(await orders.findByMedicalOrderId(medicalOrderId)).toMatchObject({
		status: "insurance_settled",
		wechatPaymentState: "cash_paid",
	});
	const settlement = await orders.getSettlementContext(
		"user-worker-001",
		medicalOrderId,
	);
	expect(settlement?.postPaymentComponents).toEqual([
		expect.objectContaining({
			kind: "wechat_cash",
			state: "succeeded",
			payingId: "paying-pure-cash-001",
			tradingId: "trading-pure-cash-001",
		}),
	]);
	expect(settlement).toMatchObject({
		selfPayThirdPartyWriteback: { status: "succeeded" },
		selfPayPaymentNotify: { status: "succeeded" },
		selfPaySettlementCompletion: { status: "succeeded" },
	});
	expect(settlement?.settlementWriteback).toBeUndefined();
	expect(settlement?.settlementCompletion).toBeUndefined();
});

test("sequenced-v1 never creates cash .2 while medical .32 is not successful", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-medical-.32-failed-worker-001",
			wechatOutTradeNo: "out-medical-.32-failed-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-medical-.32-failed-worker-001",
			businessCode: "trade-code-medical-.32-failed-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140500",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-medical-.32-failed-worker-001"],
			postPaymentPlanVersion: "sequenced-v1",
			postPaymentComponents: sequencedPostPaymentComponents(),
		},
	);
	let cashPreOrderCalls = 0;
	let cashWriteBackCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async () => {
				const current = await orders.getSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
				);
				if (!current) throw new Error("settlement context missing");
				await orders.saveSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
					{
						...current,
						settlementWriteback: {
							attemptedAt: now.toISOString(),
							status: "failed",
							providerStatus: "insur=SUCCESS,settle=FAIL",
						},
					},
				);
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
					state: "awaiting_confirmation",
					source: "yunhealth",
					providerStatus: "insur=SUCCESS,settle=FAIL",
					finality: "settlement_candidate",
					authoritative: false,
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
				personalAccountFen: 30,
				otherPaymentFen: 0,
				medicalCashFen: 20,
				cashReduceDetails: [],
				providerStatus: "MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "wechat-medical-.32-failed-worker-001",
				},
			}),
		},
		postPaymentPayType: "CREDIT",
		postPaymentWorkStationId: "",
		postPaymentTradeTypeCode: "1",
		postPayment: {
			createPreOrder: async () => {
				cashPreOrderCalls += 1;
				throw new Error("cash .2 must wait for medical .32 success");
			},
		},
		hospitalSettlement: {
			writeBack: async () => {
				cashWriteBackCalls += 1;
				throw new Error("cash writeback must wait for medical .32 success");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("manual_review");
	expect(cashPreOrderCalls).toBe(0);
	expect(cashWriteBackCalls).toBe(0);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({ status: "manual_review" });
});

test("sequenced-v1 legacy mixed order with an early successful .5 skips the final duplicate .5", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			wechatMixTradeNo: "mix-legacy-early-.5-worker-001",
			wechatOutTradeNo: "out-legacy-early-.5-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-legacy-early-.5-worker-001",
			businessCode: "trade-code-legacy-early-.5-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140500",
			networkRegister: {
				idNo: "140500199001010033",
				netPatName: "存量提前完成测试人",
				memberNo: "psn-legacy-early-.5-worker-001",
				psnCertType: "01",
			},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-legacy-early-.5-worker-001"],
			postPaymentPlanVersion: "sequenced-v1",
			postPaymentComponents: sequencedPostPaymentComponents("5031"),
			settlementWriteback: {
				attemptedAt: now.toISOString(),
				status: "succeeded",
				providerRequestId: "legacy-medical-.32-worker-001",
				providerStatus: "insur=SUCCESS,settle=SUCCESS",
			},
			settlementCompletion: {
				attemptedAt: now.toISOString(),
				status: "succeeded",
				providerRequestId: "legacy-medical-.5-worker-001",
				providerStatus: "completion=1",
			},
		},
	);

	const calls: string[] = [];
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async () => {
				calls.push("medical.cached");
				return evidence({
					amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
					state: "insurance_settled",
					source: "yunhealth",
					providerStatus: "completion=1",
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
			queryMixedOrder: async () => {
				calls.push("wechat.query");
				return {
					mixState: "paid",
					cashState: "paid",
					insuranceState: "paid",
					medInsPayStatus: "MED_INS_PAY_SUCCESS",
					cashFen: 20,
					totalFen: 100,
					fundFen: 50,
					personalAccountFen: 30,
					otherPaymentFen: 0,
					medicalCashFen: 20,
					cashReduceDetails: [],
					providerStatus:
						"MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-query",
						requestId: "wechat-legacy-early-.5-worker-001",
					},
				};
			},
		},
		postPaymentPayType: "CREDIT",
		postPaymentWorkStationId: "",
		postPaymentTradeTypeCode: "1",
		postPayment: {
			createPreOrder: async (input) => {
				calls.push("cash.2");
				expect(input.payTypeId).toBe("5031");
				return {
					payingId: "paying-legacy-cash-001",
					tradingId: "trading-legacy-cash-001",
					payTypeId: input.payTypeId,
					payType: "CREDIT",
					workStationId: "",
					tradeTypeCode: "1",
					trace: {
						provider: "yunhealth",
						operation: "registration-self-pay.2.6.65.2.plugin",
						requestId: "legacy-cash-.2-worker-001",
					},
				};
			},
		},
		hospitalSettlement: {
			writeBack: async (input) => {
				expect(input.skipCompleteSettlement).toBeTrue();
				calls.push("cash.29");
				await input.onThirdPartPayAttempt?.();
				await input.onThirdPartPayResponse?.({
					rawResponse:
						'{"success":true,"data":{"thirdPartPayRecordId":"third-part-legacy-cash-001"}}',
					thirdPartPayRecordId: "third-part-legacy-cash-001",
					requestId: "legacy-cash-.29-worker-001",
				});
				calls.push("cash.15");
				await input.onPaymentNotifyAttempt?.();
				await input.onPaymentNotifyResponse?.({
					requestId: "legacy-cash-.15-worker-001",
				});
				return {
					provider: "yunhealth",
					operation: "registration-self-pay.2.6.65.15",
					requestId: "legacy-cash-.15-worker-001",
				};
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("reconciled");
	expect(calls).toEqual([
		"wechat.query",
		"medical.cached",
		"cash.2",
		"cash.29",
		"cash.15",
	]);
	const settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	expect(settlement).toMatchObject({
		settlementCompletion: { status: "succeeded" },
		selfPayThirdPartyWriteback: { status: "succeeded" },
		selfPayPaymentNotify: { status: "succeeded" },
		postPaymentComponents: expect.arrayContaining([
			expect.objectContaining({
				kind: "wechat_cash",
				payTypeId: "5031",
				state: "succeeded",
			}),
		]),
	});
	expect(settlement?.selfPaySettlementCompletion).toBeUndefined();
	expect(settlement?.postPaymentCompletedAt).toBeDefined();
	// 存量单已经调用过一次医保 `.5`；本次自费补写不能再发第二次。
	expect(1 + calls.filter((call) => call.endsWith(".5")).length).toBe(1);
});

test("sequenced-v1 legacy mixed order blocks cash when an early .5 is failed or unknown", async () => {
	for (const completionStatus of ["failed", "unknown"] as const) {
		const orders = createInMemoryMedicalInsuranceOrderRepository();
		await orders.insert(
			order({
				status: "cash_pending",
				wechatMixTradeNo: `mix-legacy-${completionStatus}-.5-worker-001`,
				wechatOutTradeNo: `out-legacy-${completionStatus}-.5-worker-001`,
				wechatPaymentState: "prepay_ready",
			}),
		);
		await orders.saveSettlementContext(
			"user-worker-001",
			"medical-order-worker-001",
			{
				businessId: `business-legacy-${completionStatus}-.5-worker-001`,
				businessCode: `trade-code-legacy-${completionStatus}-.5-worker-001`,
				hospitalId: "1001",
				patientId: "2001",
				insuredAreaCode: "140500",
				networkRegister: {},
				outNetworkSettleMain: {},
				nationalUpDetailList: [],
				upDetailList: [],
				tradeOrderIds: [`trade-legacy-${completionStatus}-.5-worker-001`],
				postPaymentPlanVersion: "sequenced-v1",
				postPaymentComponents: sequencedPostPaymentComponents(),
				settlementWriteback: {
					attemptedAt: now.toISOString(),
					status: "succeeded",
					providerStatus: "insur=SUCCESS,settle=SUCCESS",
				},
				settlementCompletion: {
					attemptedAt: now.toISOString(),
					status: completionStatus,
					providerStatus: "completion=UNKNOWN",
				},
			},
		);
		let cashPreOrderCalls = 0;
		let cashWriteBackCalls = 0;
		const worker = new MedicalInsuranceOrderReconciliationWorker({
			tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
			orders,
			medicalInsurance: {
				query: async () =>
					evidence({
						amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
						state: "awaiting_confirmation",
						source: "yunhealth",
						providerStatus: "2.6.65.5_already_attempted",
						finality: "settlement_candidate",
						authoritative: false,
					}),
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
					personalAccountFen: 30,
					otherPaymentFen: 0,
					medicalCashFen: 20,
					cashReduceDetails: [],
					providerStatus:
						"MIX_PAY_SUCCESS/SELF_PAY_SUCCESS/MED_INS_PAY_SUCCESS",
					trace: {
						provider: "wechat-pay",
						operation: "medical-mix-query",
						requestId: `wechat-legacy-${completionStatus}-.5-worker-001`,
					},
				}),
			},
			postPaymentPayType: "CREDIT",
			postPaymentWorkStationId: "",
			postPaymentTradeTypeCode: "1",
			postPayment: {
				createPreOrder: async () => {
					cashPreOrderCalls += 1;
					throw new Error("cash .2 must not run after an unsafe early .5");
				},
			},
			hospitalSettlement: {
				writeBack: async () => {
					cashWriteBackCalls += 1;
					throw new Error(
						"cash writeback must not run after an unsafe early .5",
					);
				},
			},
		});

		expect(await worker.runOnce(now)).toBe("manual_review");
		expect(cashPreOrderCalls).toBe(0);
		expect(cashWriteBackCalls).toBe(0);
		expect(
			await orders.findByMedicalOrderId("medical-order-worker-001"),
		).toMatchObject({ status: "manual_review" });
	}
});

test(".32 success without the required .5 remains non-terminal", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 20,
				personalAccountFen: 20,
				fundFen: 50,
				otherPaymentFen: 10,
				hospitalPartFen: 10,
			},
			wechatMixTradeNo: "mix-writeback-success-worker-001",
			wechatOutTradeNo: "out-writeback-success-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	const context = {
		businessId: "business-writeback-success-worker-001",
		businessCode: "trade-code-writeback-success-worker-001",
		hospitalId: "1001",
		patientId: "2001",
		insuredAreaCode: "140581",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["trade-writeback-success-worker-001"],
		postPaymentComponents: [
			prePaymentComponent("hospital_reduce", 30, "H5", "50"),
			prePaymentComponent("fund", 50, "H5", "2"),
			prePaymentComponent("personal_account", 20, "H5", "5"),
		],
	};
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		context,
	);
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks: createInMemoryMedicalInsuranceQueryTaskRepository([task()]),
		orders,
		medicalInsurance: {
			query: async () => {
				const current = await orders.getSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
				);
				if (!current) throw new Error("settlement context missing");
				await orders.saveSettlementContext(
					"user-worker-001",
					"medical-order-worker-001",
					{
						...current,
						settlementWriteback: {
							attemptedAt: now.toISOString(),
							status: "succeeded",
							providerRequestId: "notify-writeback-success-worker-001",
							providerStatus: "insur=SUCCESS,settle=SUCCESS",
						},
					},
				);
				throw new Error(".5 response unavailable after .32 success");
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
				fundFen: 50,
				personalAccountFen: 20,
				otherPaymentFen: 10,
				medicalCashFen: 20,
				cashReduceDetails: [
					{ cashReduceFen: 20, cashReduceType: "HOSPITAL_REDUCE" },
				],
				providerStatus: "MIX_PAY_SUCCESS/NO_SELF_PAY/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-writeback-success-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async () => {
				throw new Error(".2 must not run after payment");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("retry_scheduled");
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({
		status: "cash_pending",
		wechatPaymentState: "cash_paid",
		ordStas: "1",
	});
	const settlement = await orders.getSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
	);
	expect(settlement?.settlementWriteback?.status).toBe("succeeded");
	expect(settlement?.settlementCompletion).toBeUndefined();
});

test(".32 failed writeback moves an otherwise paid mixed order to manual review without retry", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			status: "cash_pending",
			amounts: {
				totalFen: 100,
				cashFen: 20,
				personalAccountFen: 20,
				fundFen: 50,
				otherPaymentFen: 10,
				hospitalPartFen: 10,
			},
			wechatMixTradeNo: "mix-writeback-failed-worker-001",
			wechatOutTradeNo: "out-writeback-failed-worker-001",
			wechatPaymentState: "prepay_ready",
		}),
	);
	await orders.saveSettlementContext(
		"user-worker-001",
		"medical-order-worker-001",
		{
			businessId: "business-writeback-failed-worker-001",
			businessCode: "trade-code-writeback-failed-worker-001",
			hospitalId: "1001",
			patientId: "2001",
			insuredAreaCode: "140581",
			networkRegister: {},
			outNetworkSettleMain: {},
			nationalUpDetailList: [],
			upDetailList: [],
			tradeOrderIds: ["trade-writeback-failed-worker-001"],
			postPaymentComponents: [
				prePaymentComponent("hospital_reduce", 30, "H5", "50"),
				prePaymentComponent("fund", 50, "H5", "2"),
				prePaymentComponent("personal_account", 20, "H5", "5"),
			],
			settlementWriteback: {
				attemptedAt: "2026-09-03T00:00:01.000Z",
				status: "failed",
				providerRequestId: "notify-writeback-failed-worker-001",
				providerStatus: "insur=SUCCESS,settle=FAIL",
			},
		},
	);
	const tasks = createInMemoryMedicalInsuranceQueryTaskRepository([task()]);
	let finalizationCalls = 0;
	const worker = new MedicalInsuranceOrderReconciliationWorker({
		tasks,
		orders,
		medicalInsurance: {
			query: async () => {
				finalizationCalls += 1;
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
				cashFen: 0,
				totalFen: 100,
				fundFen: 50,
				personalAccountFen: 20,
				otherPaymentFen: 10,
				medicalCashFen: 20,
				cashReduceDetails: [
					{ cashReduceFen: 20, cashReduceType: "HOSPITAL_REDUCE" },
				],
				providerStatus: "MIX_PAY_SUCCESS/NO_SELF_PAY/MED_INS_PAY_SUCCESS",
				trace: {
					provider: "wechat-pay",
					operation: "medical-mix-query",
					requestId: "medical-writeback-failed-worker-001",
				},
			}),
		},
		postPayment: {
			createPreOrder: async () => {
				throw new Error(".2 must not run after payment");
			},
			completeSettlement: async () => {
				throw new Error(".5 must not run after failed .32");
			},
		},
	});

	expect(await worker.runOnce(now)).toBe("manual_review");
	expect(finalizationCalls).toBe(1);
	expect(
		await orders.findByMedicalOrderId("medical-order-worker-001"),
	).toMatchObject({ status: "manual_review" });
	expect(await worker.runOnce(new Date(now.getTime() + 60_000))).toBe("idle");
	expect(finalizationCalls).toBe(1);
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
