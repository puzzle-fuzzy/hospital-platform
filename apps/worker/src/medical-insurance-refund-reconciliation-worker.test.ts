import { expect, test } from "bun:test";
import type {
	MedicalInsuranceRefund,
	WechatRefund,
	WechatRefundProviderStatus,
} from "@hospital/domain";
import { PaymentSyncCoordinator } from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentSyncRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { MedicalInsuranceRefundReconciliationWorker } from "./medical-insurance-refund-reconciliation-worker";

const startedAt = new Date("2026-09-22T00:00:00.000Z");

function aggregateRefund(
	overrides: Partial<MedicalInsuranceRefund> = {},
): MedicalInsuranceRefund {
	return {
		refundId: "medical-refund-worker-001",
		medicalOrderId: "medical-order-worker-001",
		ownerUserId: "owner-worker-001",
		payOrdId: "pay-ord-worker-001",
		refundNo: "RFMIworker001",
		idempotencyKey: "admin-medical-full:medical-order-worker-001",
		refundType: "ALL",
		totalFen: 1000,
		cashFen: 300,
		personalAccountFen: 200,
		fundFen: 500,
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		medicalProviderRequestId: "medical-request-worker-001",
		wechatStatus: "processing",
		wechatMerchantRefundNo: "RFMIworker001",
		status: "processing",
		lastErrorCode: null,
		version: 2,
		createdAt: startedAt.toISOString(),
		updatedAt: startedAt.toISOString(),
		...overrides,
	};
}

function wechatRefund(overrides: Partial<WechatRefund> = {}): WechatRefund {
	return {
		refundRecordId: "wechat-refund-worker-001",
		merchantRefundNo: "RFMIworker001",
		source: "medical_insurance",
		sourceOrderId: "medical-order-worker-001",
		outTradeNo: "wechat-out-worker-001",
		totalFen: 300,
		refundFen: 300,
		reason: null,
		idempotencyKey: "medical-refund:RFMIworker001",
		status: "processing",
		providerStatus: "PROCESSING",
		providerRefundId: "wechat-provider-refund-001",
		providerTransactionId: "wechat-transaction-001",
		providerRequestId: "wechat-request-001",
		successTime: null,
		lastErrorCode: null,
		version: 2,
		createdAt: startedAt.toISOString(),
		updatedAt: startedAt.toISOString(),
		...overrides,
	};
}

async function fixture(
	statuses: readonly WechatRefundProviderStatus[],
	overrides: Partial<MedicalInsuranceRefund> = {},
) {
	const medicalRefunds = createInMemoryMedicalInsuranceRefundRepository([
		aggregateRefund(overrides),
	]);
	const wechatRefunds = createInMemoryWechatRefundRepository([wechatRefund()]);
	const paymentSync = createInMemoryPaymentSyncRepository();
	const sync = new PaymentSyncCoordinator({
		repository: paymentSync,
		now: () => startedAt,
		createId: () => "refund-worker-task-001",
	});
	const task = await sync.enqueue({
		aggregateId: "payment-aggregate-worker-001",
		businessKey: "medical_refund:RFMIworker001",
		source: "wechat_pay",
		kind: "reconcile",
		maxAttempts: 20,
		nextRunAt: startedAt.toISOString(),
	});
	let calls = 0;
	const worker = new MedicalInsuranceRefundReconciliationWorker({
		sync,
		medicalRefunds,
		wechatRefunds,
		wechatRefund: {
			requestRefund: async () => {
				throw new Error("worker must not request a second refund");
			},
			queryRefund: async ({ merchantRefundNo }) => {
				const status = statuses[Math.min(calls, statuses.length - 1)];
				calls += 1;
				if (!status) throw new Error("missing provider status");
				return {
					status,
					merchantRefundNo,
					providerRefundId: "wechat-provider-refund-001",
					providerTransactionId: "wechat-transaction-001",
					outTradeNo: "wechat-out-worker-001",
					totalFen: 300,
					refundFen: 300,
					...(status === "SUCCESS"
						? { successTime: "2026-09-22T00:01:00+08:00" }
						: {}),
					trace: {
						provider: "wechat-pay",
						operation: "query-refund",
						requestId: `wechat-query-${calls}`,
					},
				};
			},
		},
	});
	return {
		worker,
		medicalRefunds,
		wechatRefunds,
		paymentSync,
		task,
		calls: () => calls,
	};
}

test("微信退款处理中会按原退款单号调度查单，随后收敛成功", async () => {
	const testFixture = await fixture(["PROCESSING", "SUCCESS"]);

	expect(await testFixture.worker.runOnce(startedAt)).toBe("retry_scheduled");
	expect(testFixture.calls()).toBe(1);
	expect(
		(await testFixture.medicalRefunds.findByRefundNo("RFMIworker001"))?.status,
	).toBe("processing");
	const pendingTask = await testFixture.paymentSync.findTaskById(
		testFixture.task.taskId,
	);
	expect(pendingTask?.status).toBe("pending");
	expect(pendingTask?.nextRunAt).toBe("2026-09-22T00:01:00.000Z");

	expect(
		await testFixture.worker.runOnce(new Date("2026-09-22T00:01:00.000Z")),
	).toBe("succeeded");
	expect(testFixture.calls()).toBe(2);
	expect(
		await testFixture.medicalRefunds.findByRefundNo("RFMIworker001"),
	).toMatchObject({ status: "succeeded", wechatStatus: "success" });
	expect(
		await testFixture.wechatRefunds.findByMerchantRefundNo("RFMIworker001"),
	).toMatchObject({ status: "success", providerStatus: "SUCCESS" });
	expect(
		(await testFixture.paymentSync.findTaskById(testFixture.task.taskId))
			?.status,
	).toBe("succeeded");
});

test("微信成功事实已落库但聚合更新中断时直接收敛，不重复查单", async () => {
	const testFixture = await fixture(["PROCESSING"]);
	const current =
		await testFixture.wechatRefunds.findByMerchantRefundNo("RFMIworker001");
	if (!current) throw new Error("wechat refund fixture is missing");
	await testFixture.wechatRefunds.update(
		{
			...current,
			status: "success",
			providerStatus: "SUCCESS",
			successTime: "2026-09-22T00:00:30+08:00",
			version: current.version + 1,
			updatedAt: "2026-09-22T00:00:30.000Z",
		},
		current.version,
	);

	expect(await testFixture.worker.runOnce(startedAt)).toBe("succeeded");
	expect(testFixture.calls()).toBe(0);
	expect(
		await testFixture.medicalRefunds.findByRefundNo("RFMIworker001"),
	).toMatchObject({ status: "succeeded", wechatStatus: "success" });
});

test("微信退款关闭形成部分成功并进入人工复核，不重新申请退款", async () => {
	const testFixture = await fixture(["CLOSED"]);

	expect(await testFixture.worker.runOnce(startedAt)).toBe("manual_review");
	expect(testFixture.calls()).toBe(1);
	expect(
		await testFixture.medicalRefunds.findByRefundNo("RFMIworker001"),
	).toMatchObject({
		status: "manual_review",
		wechatStatus: "failed",
		lastErrorCode: "wechat-refund-closed",
	});
	expect(
		(await testFixture.paymentSync.findTaskById(testFixture.task.taskId))
			?.status,
	).toBe("manual_review");
});

test("退款身份不匹配立即转人工复核，不做无意义的长尾查单", async () => {
	const testFixture = await fixture(["SUCCESS"]);
	const current =
		await testFixture.wechatRefunds.findByMerchantRefundNo("RFMIworker001");
	if (!current) throw new Error("wechat refund fixture is missing");
	await testFixture.wechatRefunds.update(
		{
			...current,
			sourceOrderId: "another-medical-order",
			version: current.version + 1,
		},
		current.version,
	);

	expect(await testFixture.worker.runOnce(startedAt)).toBe("manual_review");
	expect(testFixture.calls()).toBe(0);
	expect(
		await testFixture.medicalRefunds.findByRefundNo("RFMIworker001"),
	).toMatchObject({
		status: "manual_review",
		lastErrorCode: "wechat-refund-aggregate-mismatch",
	});
	expect(
		await testFixture.paymentSync.findTaskById(testFixture.task.taskId),
	).toMatchObject({
		status: "manual_review",
		attempts: 1,
		lastErrorCode: "wechat-refund-aggregate-mismatch",
	});
});

test("微信查单网络失败只安排重试，聚合状态不会误判退款失败", async () => {
	const medicalRefunds = createInMemoryMedicalInsuranceRefundRepository([
		aggregateRefund(),
	]);
	const wechatRefunds = createInMemoryWechatRefundRepository([wechatRefund()]);
	const paymentSync = createInMemoryPaymentSyncRepository();
	const sync = new PaymentSyncCoordinator({
		repository: paymentSync,
		now: () => startedAt,
		createId: () => "refund-worker-task-error",
	});
	const task = await sync.enqueue({
		aggregateId: "payment-aggregate-worker-001",
		businessKey: "medical_refund:RFMIworker001",
		source: "wechat_pay",
		kind: "reconcile",
		maxAttempts: 20,
		nextRunAt: startedAt.toISOString(),
	});
	const worker = new MedicalInsuranceRefundReconciliationWorker({
		sync,
		medicalRefunds,
		wechatRefunds,
		wechatRefund: {
			requestRefund: async () => {
				throw new Error("worker must not request a second refund");
			},
			queryRefund: async () => {
				throw new TypeError("network unavailable");
			},
		},
	});

	expect(await worker.runOnce(startedAt)).toBe("retry_scheduled");
	expect(await medicalRefunds.findByRefundNo("RFMIworker001")).toMatchObject({
		status: "processing",
		wechatStatus: "processing",
	});
	expect((await paymentSync.findTaskById(task.taskId))?.status).toBe("pending");
});
