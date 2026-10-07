import { expect, test } from "bun:test";
import {
	type MedicalInsuranceOrder,
	PaymentSyncCoordinator,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOperationsRepository,
	createInMemoryPaymentOperatorAuditRepository,
	createInMemoryPaymentSyncRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { projectMedicalInsuranceOrder } from "../admin/payment-operations-projector";
import { AdminWechatRefundService } from "../admin/wechat-refund-service";
import { MedicalInsuranceOrderNotFoundError } from "./errors";
import { MedicalInsuranceRefundService } from "./refund-service";

const context = {
	traceId: "refund-trace-001",
	idempotencyKey: "refund-idempotency-001",
};

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-refund-001",
		ownerUserId: "user-refund-001",
		patientId: "patient-refund-001",
		authorizationId: "authorization-refund-001",
		feeUploadId: "fee-refund-001",
		idempotencyKey: "payment-idempotency-001",
		medOrgOrd: "med-org-refund-001",
		chrgBchno: "batch-refund-001",
		payOrdId: "pay-ord-refund-001",
		payTokenHash: "a".repeat(64),
		status: "insurance_settled",
		ordStas: "6",
		amounts: {
			totalFen: 1000,
			cashFen: 300,
			personalAccountFen: 200,
			fundFen: 500,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: "wx-out-refund-001",
		wechatPaymentState: "cash_paid",
		version: 1,
		createdAt: "2026-09-20T00:00:00.000Z",
		updatedAt: "2026-09-20T00:00:00.000Z",
		...overrides,
	};
}

test("医保全额退费先调用 6203，再调用微信 APIv3 现金退款并保持幂等", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const medicalOrder = order();
	await orders.insert(medicalOrder);
	const operations = createInMemoryPaymentOperationsRepository();
	const projection = await projectMedicalInsuranceOrder(
		operations,
		medicalOrder,
	);
	const audits = createInMemoryPaymentOperatorAuditRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-refund-001",
		ownerUserId: "user-refund-001",
		medicalOrderId: "medical-refund-001",
		providerSubject: "provider-subject-refund-001",
		payAuthNo: "pay-auth-refund-001",
		patient: { idNo: "140000000000000001", userName: "测试患者", idType: "01" },
		psnNo: "psn-refund-001",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "insu-refund-001",
		expiresAt: "2026-09-20T00:01:00.000Z",
		createdAt: "2026-09-19T23:00:00.000Z",
	});
	const aggregateRefunds = createInMemoryMedicalInsuranceRefundRepository();
	const wechatRefunds = createInMemoryWechatRefundRepository();
	let medicalCalls = 0;
	let wechatCalls = 0;
	let medicalPayload: Record<string, unknown> | undefined;
	const wechatRefund = new AdminWechatRefundService({
		refunds: wechatRefunds,
		paymentOrders: {} as never,
		medicalInsuranceOrders: orders,
		gateway: {
			requestRefund: async (input) => {
				wechatCalls += 1;
				return {
					...input,
					status: "SUCCESS" as const,
					providerRefundId: "wx-refund-001",
					trace: {
						provider: "wechat-pay",
						operation: "refund",
						requestId: "wx-req-001",
					},
				};
			},
			queryRefund: async () => {
				throw new Error("query should not be needed after success");
			},
		},
	});
	const service = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: aggregateRefunds,
		medicalInsuranceRefund: {
			refund: async (data) => {
				medicalCalls += 1;
				medicalPayload = data;
				return {
					refStatus: "SUCC" as const,
					trace: {
						provider: "legacy-fsi",
						operation: "6203",
						requestId: "6203-req-001",
					},
				};
			},
		},
		wechatRefund,
		paymentOperations: operations,
		operatorAudits: audits,
	});

	const first = await service.requestFullRefundByOrder({
		orderId: "medical-refund-001",
		reason: "全额退费",
		context,
	});
	const second = await service.requestFullRefundByOrder({
		orderId: "medical-refund-001",
		reason: "全额退费",
		context: { traceId: "refund-trace-retry", idempotencyKey: "different-key" },
	});

	expect(first.status).toBe("succeeded");
	expect(second).toEqual(first);
	expect(medicalCalls).toBe(1);
	expect(wechatCalls).toBe(1);
	expect(medicalPayload?.payAuthNo).toBe("pay-auth-refund-001");
	expect(medicalPayload?.totlRefdAmt).toBe("10.00");
	expect(projection).toBeDefined();
	expect(
		await audits.listByAggregate(projection?.aggregate.aggregateId ?? ""),
	).toHaveLength(2);
});

test("6203 EXP 不会继续退款微信现金段，并进入人工复核", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-refund-exp-001",
			authorizationId: "authorization-refund-exp-001",
		}),
	);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-refund-exp-001",
		ownerUserId: "user-refund-001",
		medicalOrderId: "medical-refund-exp-001",
		providerSubject: "provider-subject-refund-001",
		payAuthNo: "pay-auth-refund-exp-001",
		patient: { idNo: "140000000000000001", userName: "测试患者", idType: "01" },
		psnNo: "psn-refund-001",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "insu-refund-001",
		expiresAt: "2026-09-20T00:01:00.000Z",
		createdAt: "2026-09-19T23:00:00.000Z",
	});
	const service = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: createInMemoryMedicalInsuranceRefundRepository(),
		medicalInsuranceRefund: {
			refund: async () => ({
				refStatus: "EXP" as const,
				trace: {
					provider: "legacy-fsi",
					operation: "6203",
					requestId: "6203-exp-001",
				},
			}),
		},
	});

	const result = await service.requestMedicalOnlyByOrder({
		orderId: "medical-refund-exp-001",
		context: { traceId: "refund-exp", idempotencyKey: "refund-exp-001" },
		operatorRef: "his-medical-leg",
	});

	expect(result.status).toBe("manual_review");
	expect(result.medicalStatus).toBe("unknown");
	expect(result.wechatStatus).toBe("not_required");
});

test("微信现金退费受理后创建主动查单任务，查询同一退款单号收敛成功", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const medicalOrder = order({ medicalOrderId: "medical-refund-query-001" });
	await orders.insert(medicalOrder);
	const operations = createInMemoryPaymentOperationsRepository();
	await projectMedicalInsuranceOrder(operations, medicalOrder);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-refund-001",
		ownerUserId: "user-refund-001",
		medicalOrderId: "medical-refund-query-001",
		providerSubject: "provider-subject-refund-query-001",
		payAuthNo: "pay-auth-refund-query-001",
		patient: { idNo: "140000000000000001", userName: "测试患者", idType: "01" },
		psnNo: "psn-refund-query-001",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "insu-refund-query-001",
		expiresAt: "2026-09-20T00:01:00.000Z",
		createdAt: "2026-09-19T23:00:00.000Z",
	});
	const aggregateRefunds = createInMemoryMedicalInsuranceRefundRepository();
	const wechatRefunds = createInMemoryWechatRefundRepository();
	const paymentSyncRepository = createInMemoryPaymentSyncRepository();
	const paymentSync = new PaymentSyncCoordinator({
		repository: paymentSyncRepository,
		now: () => new Date("2026-09-20T00:00:00.000Z"),
		createId: () => "medical-refund-sync-task-001",
	});
	let requestCalls = 0;
	let queryCalls = 0;
	const wechatRefund = new AdminWechatRefundService({
		refunds: wechatRefunds,
		paymentOrders: {} as never,
		medicalInsuranceOrders: orders,
		gateway: {
			requestRefund: async (input) => {
				requestCalls += 1;
				return {
					...input,
					status: "PROCESSING" as const,
					providerRefundId: "wx-refund-query-001",
					trace: {
						provider: "wechat-pay",
						operation: "refund",
						requestId: "wx-request-query-001",
					},
				};
			},
			queryRefund: async ({ merchantRefundNo }) => {
				queryCalls += 1;
				return {
					status: "SUCCESS" as const,
					merchantRefundNo,
					providerRefundId: "wx-refund-query-001",
					providerTransactionId: "wx-transaction-query-001",
					outTradeNo: "wx-out-refund-001",
					totalFen: 300,
					refundFen: 300,
					successTime: "2026-09-20T00:01:00+08:00",
					trace: {
						provider: "wechat-pay",
						operation: "query-refund",
						requestId: "wx-query-001",
					},
				};
			},
		},
	});
	const service = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: aggregateRefunds,
		medicalInsuranceRefund: {
			refund: async () => ({
				refStatus: "SUCC" as const,
				trace: {
					provider: "legacy-fsi",
					operation: "6203",
					requestId: "6203-query-001",
				},
			}),
		},
		wechatRefund,
		paymentOperations: operations,
		paymentSync,
	});

	const requested = await service.requestFullRefundByOrder({
		orderId: medicalOrder.medicalOrderId,
		context,
	});
	expect(requested.status).toBe("processing");
	expect(requested.wechatStatus).toBe("processing");
	expect(requestCalls).toBe(1);
	expect(queryCalls).toBe(0);
	const replayed = await service.requestFullRefundByOrder({
		orderId: medicalOrder.medicalOrderId,
		context: {
			traceId: "refund-query-request-retry",
			idempotencyKey: "different-admin-click-key",
		},
	});
	expect(replayed).toEqual(requested);
	expect(requestCalls).toBe(1);
	expect(
		await paymentSyncRepository.listTasksForAdmin({ limit: 10 }),
	).toMatchObject([
		{
			businessKey: `medical_refund:${requested.refundNo}`,
			status: "pending",
			source: "wechat_pay",
			kind: "reconcile",
		},
	]);

	const reconciled = await service.query(requested.refundNo, {
		requestId: "admin-refund-query-001",
	});
	expect(reconciled).toMatchObject({
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "success",
	});
	expect(requestCalls).toBe(1);
	expect(queryCalls).toBe(1);
});

test("HIS 可按 payOrdId 发起医保单腿退费，并复用平台订单退款记录", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const medicalOrder = order({
		medicalOrderId: "medical-refund-pay-ord-id-001",
		payOrdId: "pay-ord-his-refund-001",
		authorizationId: "authorization-pay-ord-id-001",
	});
	await orders.insert(medicalOrder);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-pay-ord-id-001",
		ownerUserId: medicalOrder.ownerUserId,
		medicalOrderId: medicalOrder.medicalOrderId,
		providerSubject: "provider-subject-pay-ord-id-001",
		payAuthNo: "pay-auth-pay-ord-id-001",
		patient: { idNo: "140000000000000001", userName: "测试患者", idType: "01" },
		psnNo: "psn-pay-ord-id-001",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "insu-pay-ord-id-001",
		expiresAt: "2026-09-20T00:01:00.000Z",
		createdAt: "2026-09-19T23:00:00.000Z",
	});
	const refunds = createInMemoryMedicalInsuranceRefundRepository();
	let medicalCalls = 0;
	const service = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds,
		medicalInsuranceRefund: {
			refund: async () => {
				medicalCalls += 1;
				return {
					refStatus: "SUCC" as const,
					trace: {
						provider: "legacy-fsi",
						operation: "6203",
						requestId: "6203-pay-ord-id-001",
					},
				};
			},
		},
	});

	const byPayOrdId = await service.requestMedicalOnlyByPayOrdId({
		payOrdId: medicalOrder.payOrdId ?? "",
		reason: "HIS 医保退费",
		context: { traceId: "his-pay-ord-id-001", idempotencyKey: "ignored" },
		operatorRef: "his-medical-leg",
	});
	const byMedicalOrderId = await service.requestMedicalOnlyByOrder({
		orderId: medicalOrder.medicalOrderId,
		context: {
			traceId: "his-pay-ord-id-retry-001",
			idempotencyKey: "also-ignored",
		},
	});

	expect(byPayOrdId).toMatchObject({
		orderId: medicalOrder.medicalOrderId,
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "not_required",
	});
	expect(byMedicalOrderId).toEqual(byPayOrdId);
	expect(medicalCalls).toBe(1);
	expect(
		(await refunds.findLatestByMedicalOrderId(medicalOrder.medicalOrderId))
			?.idempotencyKey,
	).toBe(`his-medical-leg:${medicalOrder.medicalOrderId}`);
	await expect(
		service.requestMedicalOnlyByPayOrdId({
			payOrdId: "pay-ord-his-refund-missing",
			context,
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceOrderNotFoundError);
});
