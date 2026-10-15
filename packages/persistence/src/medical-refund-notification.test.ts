import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	MedicalInsuranceOrder,
	MedicalInsuranceRefund,
	PaymentSyncRepository,
	PaymentSyncTask,
} from "@hospital/domain";
import {
	MedicalInsuranceRefundNotificationCoordinator,
	medicalInsuranceWechatCashRefundIdentity,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentSyncRepository,
	createInMemoryWechatRefundRepository,
} from "./repositories";

type NotifyInput = Parameters<
	ConstructorParameters<
		typeof MedicalInsuranceRefundNotificationCoordinator
	>[0]["gateway"]["notifyMedicalRefund"]
>[0];
const fixedTime = "2026-10-15T02:00:00.000Z";
const ledgerRefundNo = `RFMI${"a".repeat(48)}`;

async function fixture(
	options: {
		mixed?: boolean;
		discount?: boolean;
		refund?: Partial<MedicalInsuranceRefund>;
	} = {},
) {
	let now = new Date(fixedTime);
	const order: MedicalInsuranceOrder = {
		medicalOrderId: "test-notify-medical",
		ownerUserId: "test-owner",
		patientId: "test-patient",
		businessType: options.discount ? "registration" : "outpatient",
		orderType: options.discount ? "RegPay" : "DiagPay",
		businessId: "test-business",
		idempotencyKey: "test-order-key",
		medOrgOrd: "test-org-order",
		chrgBchno: "test-charge",
		payOrdId: "test-pay-order",
		payTokenHash: null,
		status: "insurance_settled",
		ordStas: "3",
		amounts: options.mixed
			? { totalFen: 1000, cashFen: 200, personalAccountFen: 300, fundFen: 500 }
			: options.discount
				? { totalFen: 1000, cashFen: 200, personalAccountFen: 0, fundFen: 800 }
				: { totalFen: 800, cashFen: 0, personalAccountFen: 0, fundFen: 800 },
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatMixTradeNo: "test-mix-trade",
		wechatOutTradeNo: "test-cash-trade",
		version: 1,
		createdAt: fixedTime,
		updatedAt: fixedTime,
	};
	const refund: MedicalInsuranceRefund = {
		refundId: "test-refund-id",
		medicalOrderId: order.medicalOrderId,
		ownerUserId: order.ownerUserId,
		payOrdId: order.payOrdId as string,
		refundNo: ledgerRefundNo,
		idempotencyKey: "test-refund-key",
		refundType: "HI",
		totalFen: 800,
		cashFen: 0,
		personalAccountFen: options.mixed ? 300 : 0,
		fundFen: options.mixed ? 500 : 800,
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		medicalProviderRequestId: "test-6203-result",
		wechatStatus: "not_required",
		wechatMerchantRefundNo: null,
		status: "manual_review",
		lastErrorCode: "medical-refund-notify-pending",
		version: 1,
		createdAt: fixedTime,
		updatedAt: fixedTime,
		...options.refund,
	};
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order);
	if (options.discount)
		await orders.saveSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
			{
				businessId: "test-business",
				hospitalId: "test-hospital",
				patientId: order.patientId,
				networkRegister: {},
				outNetworkSettleMain: {},
				nationalUpDetailList: [],
				upDetailList: [],
				tradeOrderIds: [],
				insuredAreaCode: "140581",
			},
		);
	const refunds = createInMemoryMedicalInsuranceRefundRepository([refund]);
	const tasks = createInMemoryPaymentSyncRepository();
	const wechatRefunds = createInMemoryWechatRefundRepository();
	const calls: { input: NotifyInput; context: AdapterCallContext }[] = [];
	let failures = 0;
	let hold: Promise<void> | undefined;
	const gateway = {
		async notifyMedicalRefund(input: NotifyInput, context: AdapterCallContext) {
			calls.push({ input: { ...input }, context: { ...context } });
			await hold;
			if (failures-- > 0) throw new Error("test-notify-transport-unknown");
			return { requestId: "test-provider-notify-receipt" };
		},
	};
	const coordinator = (
		overrides: { tasks?: PaymentSyncRepository; refunds?: typeof refunds } = {},
	) =>
		new MedicalInsuranceRefundNotificationCoordinator({
			tasks: overrides.tasks ?? tasks,
			refunds: overrides.refunds ?? refunds,
			orders,
			wechatRefunds,
			gateway,
			resolveAggregateId: async () => "test-payment-aggregate",
			now: () => now,
		});
	const currentRefund = async () => {
		const value = await refunds.findByRefundNo(refund.refundNo);
		if (!value) throw new Error("test-refund-missing");
		return value;
	};
	return {
		order,
		refund,
		orders,
		refunds,
		tasks,
		wechatRefunds,
		calls,
		coordinator,
		currentRefund,
		setFailures(value: number) {
			failures = value;
		},
		advance(ms = 60_001) {
			now = new Date(now.getTime() + ms);
		},
		hold(value: Promise<void>) {
			hold = value;
		},
	};
}

test("new pure HI notification uses the full 52-character refund identity and clears only the pending marker", async () => {
	const f = await fixture({ discount: true });
	await f.coordinator().notify(f.order, f.refund);
	expect(f.calls).toHaveLength(1);
	expect(f.calls[0]?.input).toEqual({
		mixTradeNo: "test-mix-trade",
		totalFen: 800,
		fundFen: 800,
		personalAccountFen: 0,
		otherFen: 0,
		merchantRefundNo: ledgerRefundNo,
		successTime: fixedTime,
	});
	expect(f.calls[0]?.context.idempotencyKey).toBe(ledgerRefundNo);
	expect(f.calls[0]?.input.merchantRefundNo).toHaveLength(52);
	expect(await f.currentRefund()).toMatchObject({
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		status: "succeeded",
		lastErrorCode: null,
	});
	const [task] = await f.tasks.listTasksForAdmin({ limit: 10 });
	expect(task?.businessKey.length).toBeLessThanOrEqual(128);
	expect(task).toMatchObject({ status: "succeeded", attempts: 1 });
});

function legacyPureMedicalTask(
	status: "pending" | "succeeded" = "pending",
): PaymentSyncTask {
	const originalInput: NotifyInput = {
		mixTradeNo: "test-mix-trade",
		totalFen: 800,
		fundFen: 800,
		personalAccountFen: 0,
		otherFen: 0,
		merchantRefundNo: ledgerRefundNo.slice(0, 40),
		successTime: fixedTime,
	};
	const fingerprint = createHash("sha256")
		.update(JSON.stringify(originalInput))
		.digest("base64url");
	return {
		taskId: `medrefundnotify-${createHash("sha256").update(ledgerRefundNo).digest("hex").slice(0, 40)}`,
		aggregateId: "test-payment-aggregate",
		businessKey: `medical_refund_notify:${ledgerRefundNo}:${Date.parse(fixedTime).toString(36)}:${fingerprint}`,
		source: "wechat_pay",
		kind: "writeback",
		status,
		attempts: status === "succeeded" ? 1 : 0,
		maxAttempts: 20,
		nextRunAt: fixedTime,
		claimedUntil: null,
		lastErrorCode: null,
		resultDigest:
			status === "succeeded"
				? createHash("sha256").update("original-notify-receipt").digest("hex")
				: null,
		version: 1,
		createdAt: fixedTime,
		updatedAt: fixedTime,
	};
}

test("frozen short40 pure HI task retries with its original body, amount and time after restart", async () => {
	const f = await fixture({ discount: true });
	const originalTask = legacyPureMedicalTask();
	await f.tasks.enqueueTask(originalTask);
	f.setFailures(1);
	await expect(f.coordinator().notify(f.order, f.refund)).rejects.toThrow(
		"transport-unknown",
	);
	const current = await f.currentRefund();
	await f.refunds.update(
		{
			...current,
			updatedAt: "2026-10-15T02:00:30.000Z",
			version: current.version + 1,
		},
		current.version,
	);
	f.advance();
	expect(await f.coordinator().runOnce()).toBe("succeeded");
	expect(f.calls).toHaveLength(2);
	expect(f.calls[0]?.input).toEqual({
		mixTradeNo: "test-mix-trade",
		totalFen: 800,
		fundFen: 800,
		personalAccountFen: 0,
		otherFen: 0,
		merchantRefundNo: ledgerRefundNo.slice(0, 40),
		successTime: fixedTime,
	});
	expect(f.calls[1]?.input).toEqual(f.calls[0]?.input);
	expect(f.calls.map((call) => call.context.idempotencyKey)).toEqual([
		ledgerRefundNo.slice(0, 40),
		ledgerRefundNo.slice(0, 40),
	]);
	const stored = await f.tasks.findTaskById(originalTask.taskId);
	expect(stored).toMatchObject({
		status: "succeeded",
		attempts: 2,
		businessKey: originalTask.businessKey,
		createdAt: fixedTime,
	});
	expect((await f.currentRefund()).fundFen).toBe(800);
});

test("succeeded frozen short40 task is neither sent nor reopened when a pending marker is reconciled", async () => {
	const f = await fixture();
	const originalTask = legacyPureMedicalTask("succeeded");
	await f.tasks.enqueueTask(originalTask);
	f.advance();
	const tasks: PaymentSyncRepository = {
		...f.tasks,
		enqueueTask: async () => {
			throw new Error("Must not recreate a succeeded task");
		},
		updateTask: async () => {
			throw new Error("Must not reopen or rewrite a succeeded task");
		},
		claimDueTasks: async () => {
			throw new Error("Must not claim an accepted notification");
		},
	};
	await f.coordinator({ tasks }).notify(f.order, await f.currentRefund());
	expect(f.calls).toHaveLength(0);
	expect(await f.tasks.findTaskById(originalTask.taskId)).toEqual(originalTask);
	expect(await f.currentRefund()).toMatchObject({
		status: "succeeded",
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		fundFen: 800,
		personalAccountFen: 0,
		lastErrorCode: null,
	});
});

test("persisted task retries after restart with identical body, identity and success time despite newer cash state", async () => {
	const f = await fixture({ mixed: true });
	f.setFailures(1);
	await expect(f.coordinator().notify(f.order, f.refund)).rejects.toThrow(
		"transport-unknown",
	);
	const [pending] = await f.tasks.listTasksForAdmin({ limit: 10 });
	expect(pending).toMatchObject({ status: "pending", attempts: 1 });
	const current = await f.currentRefund();
	await f.refunds.update(
		{
			...current,
			wechatMerchantRefundNo: "new-cash-identity-after-schedule",
			version: current.version + 1,
			updatedAt: "2026-10-15T02:00:30.000Z",
		},
		current.version,
	);
	f.advance();
	expect(await f.coordinator().runOnce()).toBe("succeeded");
	expect(f.calls).toHaveLength(2);
	expect(f.calls[1]?.input).toEqual(f.calls[0]?.input);
	expect(f.calls[1]?.context.idempotencyKey).toBe(
		f.calls[0]?.context.idempotencyKey,
	);
	expect(f.calls[1]?.input.merchantRefundNo).toBe(
		medicalInsuranceWechatCashRefundIdentity(f.order.medicalOrderId)
			.merchantRefundNo,
	);
	expect(f.calls[1]?.input.successTime).toBe(fixedTime);
});

test("concurrent API notifications claim one send and never call either refund reserve", async () => {
	const f = await fixture({ mixed: true });
	let release = () => {};
	f.hold(
		new Promise<void>((resolve) => {
			release = resolve;
		}),
	);
	let cashReserves = 0;
	let medicalReserves = 0;
	f.wechatRefunds.reserve = async () => {
		cashReserves++;
		throw new Error("cash refund must not run");
	};
	f.refunds.reserve = async () => {
		medicalReserves++;
		throw new Error("6203 refund must not run");
	};
	const first = f.coordinator().notify(f.order, f.refund);
	const second = f.coordinator().notify(f.order, f.refund);
	const settled = Promise.allSettled([first, second]);
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	expect(f.calls).toHaveLength(1);
	release();
	expect(
		(await settled).filter((item) => item.status === "fulfilled"),
	).toHaveLength(1);
	expect(cashReserves).toBe(0);
	expect(medicalReserves).toBe(0);
});

test("worker recovers success persisted before task scheduling and dispatches once", async () => {
	const f = await fixture();
	expect(await f.tasks.listTasksForAdmin({ limit: 10 })).toHaveLength(0);
	expect(await f.coordinator().runOnce()).toBe("succeeded");
	expect(await f.coordinator().runOnce()).toBe("idle");
	expect(f.calls).toHaveLength(1);
});

test("notification success followed by result storage failure retries the exact same notification", async () => {
	const f = await fixture();
	let failSave = true;
	const tasks: PaymentSyncRepository = {
		...f.tasks,
		async updateTask(task, expectedVersion) {
			if (task.status === "succeeded" && failSave) {
				failSave = false;
				throw new Error("test-result-db-unavailable");
			}
			return f.tasks.updateTask(task, expectedVersion);
		},
	};
	await expect(
		f.coordinator({ tasks }).notify(f.order, f.refund),
	).rejects.toThrow("db-unavailable");
	f.advance();
	expect(await f.coordinator({ tasks }).runOnce()).toBe("succeeded");
	expect(f.calls).toHaveLength(2);
	expect(f.calls[1]?.input).toEqual(f.calls[0]?.input);
	expect(f.calls[1]?.context.idempotencyKey).toBe(
		f.calls[0]?.context.idempotencyKey,
	);
});

test("a succeeded task repairs marker cleanup on the next query without another network call", async () => {
	const f = await fixture();
	let failClear = true;
	const refunds = {
		...f.refunds,
		async update(record: MedicalInsuranceRefund, expectedVersion: number) {
			if (record.lastErrorCode === null && failClear) {
				failClear = false;
				throw new Error("test-marker-db-unavailable");
			}
			return f.refunds.update(record, expectedVersion);
		},
	};
	await expect(
		f.coordinator({ refunds }).notify(f.order, f.refund),
	).rejects.toThrow("marker-db-unavailable");
	expect((await f.tasks.listTasksForAdmin({ limit: 10 }))[0]?.status).toBe(
		"succeeded",
	);
	await f.coordinator({ refunds }).notify(f.order, await f.currentRefund());
	expect(f.calls).toHaveLength(1);
	expect((await f.currentRefund()).lastErrorCode).toBeNull();
});

test("claim CAS conflict never permits an unclaimed or second send", async () => {
	const f = await fixture();
	const tasks: PaymentSyncRepository = {
		...f.tasks,
		claimDueTasks: async () => [],
	};
	await expect(
		f.coordinator({ tasks }).notify(f.order, f.refund),
	).rejects.toThrow("notify-pending");
	expect(f.calls).toHaveLength(0);
});

test("successful notification cleanup never masks a failed cash leg as processing or succeeded", async () => {
	const f = await fixture({
		mixed: true,
		refund: {
			refundType: "ALL",
			totalFen: 1000,
			cashFen: 200,
			wechatStatus: "failed",
		},
	});
	await f.coordinator().notify(f.order, f.refund);
	expect(await f.currentRefund()).toMatchObject({
		medicalStatus: "success",
		wechatStatus: "failed",
		status: "manual_review",
		lastErrorCode: null,
	});
});

test("changed body facts after scheduling fail closed into manual review", async () => {
	const f = await fixture();
	await f.coordinator().schedule(f.order, f.refund);
	const current = await f.currentRefund();
	await f.refunds.update(
		{ ...current, totalFen: 700, fundFen: 700, version: current.version + 1 },
		current.version,
	);
	expect(await f.coordinator().runOnce()).toBe("retry_scheduled");
	expect(f.calls).toHaveLength(0);
	expect((await f.tasks.listTasksForAdmin({ limit: 10 }))[0]?.status).toBe(
		"manual_review",
	);
});

test("unsigned legacy task metadata is never sent and enters manual review", async () => {
	const f = await fixture();
	const task = await f.coordinator().schedule(f.order, f.refund);
	await f.tasks.updateTask(
		{
			...task,
			businessKey: `medical_refund_notify:${f.refund.refundNo}:${Date.parse(fixedTime)}`,
			version: task.version + 1,
		},
		task.version,
	);
	expect(await f.coordinator().runOnce()).toBe("retry_scheduled");
	expect(f.calls).toHaveLength(0);
	expect((await f.tasks.listTasksForAdmin({ limit: 10 }))[0]?.status).toBe(
		"manual_review",
	);
});

test("one invalid crash-gap candidate cannot starve another valid notification", async () => {
	const f = await fixture();
	const refunds = {
		...f.refunds,
		listAwaitingMedicalNotification: async () => [
			{ ...f.refund, payOrdId: "wrong-provider-order" },
			f.refund,
		],
	};
	expect(await f.coordinator({ refunds }).runOnce()).toBe("succeeded");
	expect(f.calls).toHaveLength(1);
});

test("later cash ledger cannot replace a notification identity selected before restart", async () => {
	const f = await fixture({ mixed: true });
	const firstCash = {
		refundRecordId: "test-old-cash",
		merchantRefundNo: "test-cash-identity-original",
		idempotencyKey: "test-old-cash-key",
		source: "medical_insurance" as const,
		sourceOrderId: f.order.medicalOrderId,
		outTradeNo: "test-cash-trade",
		totalFen: 200,
		refundFen: 100,
		reason: null,
		status: "success" as const,
		providerStatus: "SUCCESS" as const,
		providerRefundId: "test-provider-refund",
		providerTransactionId: null,
		providerRequestId: null,
		successTime: fixedTime,
		lastErrorCode: null,
		version: 1,
		createdAt: fixedTime,
		updatedAt: fixedTime,
	};
	await f.wechatRefunds.reserve(firstCash);
	f.setFailures(1);
	await expect(f.coordinator().notify(f.order, f.refund)).rejects.toThrow(
		"transport-unknown",
	);
	await f.wechatRefunds.reserve({
		...firstCash,
		refundRecordId: "test-new-cash",
		merchantRefundNo: "test-cash-identity-later",
		idempotencyKey: "test-new-cash-key",
		createdAt: "2026-10-15T02:00:30.000Z",
	});
	f.advance();
	expect(await f.coordinator().runOnce()).toBe("succeeded");
	expect(f.calls[0]?.input.merchantRefundNo).toBe(firstCash.merchantRefundNo);
	expect(f.calls[1]?.input).toEqual(f.calls[0]?.input);
});

test("cash refund identity is stable and binds the full order identifier", () => {
	const first = medicalInsuranceWechatCashRefundIdentity("order-same-prefix-A");
	expect(
		medicalInsuranceWechatCashRefundIdentity("order-same-prefix-A"),
	).toEqual(first);
	expect(
		medicalInsuranceWechatCashRefundIdentity("order-same-prefix-B"),
	).not.toEqual(first);
	expect(first.merchantRefundNo).toMatch(/^RFHIS[0-9a-f]{56}$/);
	expect(() => medicalInsuranceWechatCashRefundIdentity(" order ")).toThrow(
		"invalid-refund-order-id",
	);
});
