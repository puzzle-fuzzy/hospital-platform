import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder } from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOperationsRepository,
	createInMemoryPaymentOperatorAuditRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { AdminWechatRefundService } from "../admin/wechat-refund-service";
import { projectMedicalInsuranceOrder } from "../admin/payment-operations-projector";
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

	const result = await service.request({
		ownerUserId: "user-refund-001",
		orderId: "medical-refund-exp-001",
		refund: {
			refundType: "HI",
			personalAccountRefundFen: 200,
			fundRefundFen: 500,
		},
		context: { traceId: "refund-exp", idempotencyKey: "refund-exp-001" },
	});

	expect(result.status).toBe("manual_review");
	expect(result.medicalStatus).toBe("unknown");
	expect(result.wechatStatus).toBe("not_required");
});
