import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceRefund,
	MedicalInsuranceRefundGateway,
	WechatRefund,
	WechatRefundGateway,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOperationsRepository,
	createInMemoryPaymentOperatorAuditRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { projectMedicalInsuranceOrder } from "../admin/payment-operations-projector";
import { AdminWechatRefundService } from "../admin/wechat-refund-service";
import { MedicalInsuranceRegistrationInputError } from "./errors";
import { MedicalInsuranceRefundService } from "./refund-service";

type RecoveryInput = Parameters<
	MedicalInsuranceRefundService["recoverRejectedAppRefdSn"]
>[0];

const context = {
	traceId: "refund-recovery-request-001",
	idempotencyKey: "refund-recovery-idempotency-001",
};

async function fixture(
	options: {
		refund?: Partial<MedicalInsuranceRefund>;
		order?: Partial<MedicalInsuranceOrder>;
		cashless?: boolean;
		newerRefund?: boolean;
		existingWechatRefund?: boolean;
		withoutWechat?: boolean;
		withoutLedgerLookup?: boolean;
		withoutAudits?: boolean;
		auditFailure?: boolean;
		rejectClaim?: boolean;
		wechatFailure?: boolean;
		medicalRefStatus?: "SUCC" | "FAIL" | "EXP";
		waitForMedical?: () => Promise<void>;
	} = {},
) {
	const medicalOrder: MedicalInsuranceOrder = {
		medicalOrderId: "medical-recovery-001",
		ownerUserId: "user-recovery-001",
		patientId: "patient-recovery-001",
		authorizationId: "authorization-recovery-001",
		feeUploadId: "fee-recovery-001",
		idempotencyKey: "payment-recovery-001",
		medOrgOrd: "med-org-recovery-001",
		chrgBchno: "batch-recovery-001",
		payOrdId: "pay-ord-recovery-001",
		payTokenHash: "a".repeat(64),
		status: "insurance_settled",
		ordStas: "6",
		amounts: {
			totalFen: 1000,
			cashFen: options.cashless ? 0 : 200,
			personalAccountFen: 0,
			fundFen: options.cashless ? 1000 : 800,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: "wx-out-recovery-001",
		wechatPaymentState: "cash_paid",
		version: 1,
		createdAt: "2026-10-15T08:00:00.000Z",
		updatedAt: "2026-10-15T08:10:00.000Z",
		...options.order,
	};
	const idempotencyKey = `admin-medical-full:${medicalOrder.medicalOrderId}`;
	const refundNo = `RFMI${createHash("sha256")
		.update(`${medicalOrder.medicalOrderId}\n${idempotencyKey}`, "utf8")
		.digest("hex")
		.slice(0, 48)}`;
	const legacy: MedicalInsuranceRefund = {
		refundId: "medical-refund-recovery-001",
		medicalOrderId: medicalOrder.medicalOrderId,
		ownerUserId: medicalOrder.ownerUserId,
		payOrdId: medicalOrder.payOrdId ?? "pay-ord-recovery-001",
		refundNo,
		idempotencyKey,
		refundType: "ALL",
		totalFen: 1000,
		cashFen: options.cashless ? 0 : 200,
		personalAccountFen: 0,
		fundFen: options.cashless ? 1000 : 800,
		medicalStatus: "failed",
		medicalRefStatus: null,
		medicalProviderRequestId: "00000000-0000-4000-8000-000000000001",
		wechatStatus: options.cashless ? "not_required" : "requested",
		wechatMerchantRefundNo: options.cashless ? null : refundNo,
		status: "failed",
		lastErrorCode: "360221",
		version: 4,
		createdAt: "2026-10-15T08:19:30.000Z",
		updatedAt: "2026-10-15T08:19:32.000Z",
		...options.refund,
	};
	const refunds = createInMemoryMedicalInsuranceRefundRepository([
		legacy,
		...(options.newerRefund
			? [
					{
						...legacy,
						refundId: "newer-refund-001",
						refundNo: `RFMI${"b".repeat(48)}`,
						idempotencyKey: "newer-refund-idempotency-001",
						updatedAt: "2026-10-15T08:20:00.000Z",
					},
				]
			: []),
	]);
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(medicalOrder);
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-recovery-001",
		ownerUserId: medicalOrder.ownerUserId,
		medicalOrderId: medicalOrder.medicalOrderId,
		providerSubject: "provider-subject-recovery-001",
		payAuthNo: "synthetic-pay-auth-recovery-001",
		ecToken: "synthetic-ec-token-recovery-001",
		patient: { idNo: "140000000000000001", userName: "测试患者", idType: "01" },
		psnNo: "psn-recovery-001",
		insutype: "310",
		insuplcAdmdvs: "1401",
		insuCode: "insu-recovery-001",
		expiresAt: "2026-10-15T08:25:00.000Z",
		createdAt: "2026-10-15T08:00:00.000Z",
	});
	const oldWechat: WechatRefund = {
		refundRecordId: "existing-wx-refund-001",
		merchantRefundNo: "existing-wx-merchant-refund-001",
		source: "medical_insurance",
		sourceOrderId: medicalOrder.medicalOrderId,
		outTradeNo: "wx-out-recovery-001",
		totalFen: 200,
		refundFen: 200,
		reason: null,
		idempotencyKey: "existing-wx-refund-idempotency-001",
		status: "unknown",
		providerStatus: null,
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: "existing-wx-provider-request-001",
		successTime: null,
		lastErrorCode: "timeout",
		version: 1,
		createdAt: "2026-10-15T08:20:00.000Z",
		updatedAt: "2026-10-15T08:20:00.000Z",
	};
	const wechatRefunds = createInMemoryWechatRefundRepository(
		options.existingWechatRefund ? [oldWechat] : [],
	);
	const calls = {
		medical: [] as Parameters<MedicalInsuranceRefundGateway["refund"]>[],
		wechat: [] as Parameters<WechatRefundGateway["requestRefund"]>[],
		sequence: [] as string[],
	};
	const wechatRefundRepository = { ...wechatRefunds };
	if (options.withoutLedgerLookup) {
		delete wechatRefundRepository.findBySourceAndSourceOrder;
	}
	const wechatRefund = new AdminWechatRefundService({
		refunds: wechatRefundRepository,
		paymentOrders: {} as never,
		medicalInsuranceOrders: orders,
		gateway: {
			requestRefund: async (...args) => {
				calls.wechat.push(args);
				calls.sequence.push("wechat");
				if (options.wechatFailure) {
					throw Object.assign(new Error("wechat refund rejected"), {
						requestOutcome: "rejected",
						providerErrorCode: "WECHAT_REJECTED",
					});
				}
				return {
					...args[0],
					status: "SUCCESS",
					providerRefundId: "wx-refund-recovery-001",
					trace: {
						provider: "wechat-pay",
						operation: "refund",
						requestId: "wx-recovery-request-001",
					},
				};
			},
			queryRefund: async () => {
				throw new Error("Successful recovery should not query WeChat");
			},
		},
	});
	const operations = createInMemoryPaymentOperationsRepository();
	const projection = await projectMedicalInsuranceOrder(
		operations,
		medicalOrder,
	);
	const audits = createInMemoryPaymentOperatorAuditRepository();
	let sequence = 0;
	const service = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: options.rejectClaim
			? { ...refunds, update: async () => undefined }
			: refunds,
		medicalInsuranceRefund: {
			refund: async (...args) => {
				calls.medical.push(args);
				calls.sequence.push("medical");
				await options.waitForMedical?.();
				return {
					refStatus: options.medicalRefStatus ?? "SUCC",
					trace: {
						provider: "legacy-fsi",
						operation: "6203",
						requestId: "6203-recovery-request-001",
					},
				};
			},
		},
		...(options.withoutWechat ? {} : { wechatRefund }),
		paymentOperations: operations,
		...(options.withoutAudits
			? {}
			: {
					operatorAudits: options.auditFailure
						? {
								...audits,
								append: async () => {
									throw new Error("audit unavailable");
								},
							}
						: audits,
				}),
		now: () => new Date("2026-10-15T08:30:00.000Z"),
		createId: () => `recovery-fixture-${++sequence}`,
	});
	const input: RecoveryInput = {
		refundNo: legacy.refundNo,
		expectedVersion: legacy.version,
		expectedProviderRequestId: "00000000-0000-4000-8000-000000000001",
		confirmedRejection: "APP_REFD_SN_TOO_LONG",
		operatorRef: "operator-recovery-001",
		context,
		reason: "修复医保退费流水号长度后恢复",
	};
	return {
		service,
		input,
		legacy,
		refunds,
		wechatRefunds,
		calls,
		audits,
		aggregateId: projection?.aggregate.aggregateId ?? "",
	};
}

test("受控恢复保留原退款身份和金额，6203 成功后才退款微信现金", async () => {
	const f = await fixture();
	const result = await f.service.recoverRejectedAppRefdSn(f.input);
	expect(result).toMatchObject({
		refundNo: f.legacy.refundNo,
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "success",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 0,
			fundFen: 800,
		},
	});
	expect(f.calls.sequence).toEqual(["medical", "wechat"]);
	expect(f.calls.medical).toHaveLength(1);
	expect(f.calls.medical[0]?.[0]).toEqual({
		payOrdId: f.legacy.payOrdId,
		appRefdSn: f.legacy.refundNo.slice(0, 40),
		appRefdTime: "20261015163000",
		refdType: "ALL",
		totlRefdAmt: "10.00",
		cashRefdAmt: "2.00",
		psnAcctRefdAmt: "0.00",
		fundRefdAmt: "8.00",
		ecToken: "synthetic-ec-token-recovery-001",
	});
	expect(f.calls.medical[0]?.[1]).toEqual({
		totalFen: 1000,
		cashFen: 200,
		personalAccountFen: 0,
		fundFen: 800,
	});
	expect(f.calls.wechat[0]?.[0]).toMatchObject({
		merchantRefundNo: f.legacy.refundNo,
		outTradeNo: "wx-out-recovery-001",
		totalFen: 200,
		refundFen: 200,
	});
	const stored = await f.refunds.findByRefundNo(f.legacy.refundNo);
	expect(stored).toMatchObject({
		refundId: f.legacy.refundId,
		refundNo: f.legacy.refundNo,
		idempotencyKey: f.legacy.idempotencyKey,
		wechatMerchantRefundNo: f.legacy.refundNo,
		medicalProviderRequestId: "6203-recovery-request-001",
	});
	const auditEvents = await f.audits.listByAggregate(f.aggregateId);
	expect(auditEvents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				operatorRef: f.input.operatorRef,
				requestId: context.traceId,
				action: "refund_request",
			}),
		]),
	);
	for (const audit of auditEvents) {
		expect(audit.reasonCode?.length ?? 0).toBeLessThanOrEqual(64);
	}
});

test("两次并发恢复只有 CAS 领取成功的一次调用 6203 和微信", async () => {
	let signalStarted = () => {};
	let releaseMedical = () => {};
	const started = new Promise<void>((resolve) => {
		signalStarted = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		releaseMedical = resolve;
	});
	const f = await fixture({
		waitForMedical: async () => {
			signalStarted();
			await blocked;
		},
	});
	const resultsPromise = Promise.allSettled([
		f.service.recoverRejectedAppRefdSn(f.input),
		f.service.recoverRejectedAppRefdSn({
			...f.input,
			context: { ...context, traceId: "refund-recovery-request-concurrent" },
		}),
	]);
	await started;
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toMatchObject({
		status: "processing",
		medicalStatus: "processing",
	});
	releaseMedical();
	const results = await resultsPromise;
	expect(
		results.filter((result) => result.status === "fulfilled"),
	).toHaveLength(1);
	expect(results.filter((result) => result.status === "rejected")).toHaveLength(
		1,
	);
	expect(f.calls.medical).toHaveLength(1);
	expect(f.calls.wechat).toHaveLength(1);
});

for (const [label, patch] of [
	["旧版本", { expectedVersion: 3 }],
	["原请求号不匹配", { expectedProviderRequestId: "other-provider-request" }],
	[
		"未经确认的拒绝原因",
		{ confirmedRejection: "UNCONFIRMED" as "APP_REFD_SN_TOO_LONG" },
	],
	["无效操作者", { operatorRef: "" }],
	["无效请求上下文", { context: {} }],
] as const) {
	test(`受控恢复拒绝${label}，且不调用任何退款网关`, async () => {
		const f = await fixture();
		await expect(
			f.service.recoverRejectedAppRefdSn({ ...f.input, ...patch }),
		).rejects.toBeInstanceOf(MedicalInsuranceRegistrationInputError);
		expect(f.calls.sequence).toEqual([]);
		expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
	});
}

for (const [label, refund] of [
	["非遗留流水号", { refundNo: `RFMI${"a".repeat(36)}` }],
	["聚合状态未知", { status: "manual_review" }],
	["医保结果未知", { medicalStatus: "unknown" }],
	["非长度错误码", { lastErrorCode: "500" }],
	["已存在医保业务退款结果", { medicalRefStatus: "FAIL" }],
	["微信结果未知", { wechatStatus: "unknown" }],
	["非全额退费", { refundType: "HI" }],
	["用户不匹配", { ownerUserId: "other-owner" }],
	["医保支付号不匹配", { payOrdId: "other-pay-order" }],
	["原始金额不匹配", { fundFen: 799 }],
	["非 Admin 幂等身份", { idempotencyKey: "other-idempotency-key" }],
	["微信退款号不匹配", { wechatMerchantRefundNo: "other-wechat-refund" }],
] satisfies [string, Partial<MedicalInsuranceRefund>][]) {
	test(`受控恢复拒绝${label}，保持原退费状态`, async () => {
		const f = await fixture({ refund });
		await expect(
			f.service.recoverRejectedAppRefdSn(f.input),
		).rejects.toBeInstanceOf(MedicalInsuranceRegistrationInputError);
		expect(f.calls.sequence).toEqual([]);
		expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
	});
}

for (const [label, options] of [
	["微信已有退款台账", { existingWechatRefund: true }],
	["存在更新的退款单", { newerRefund: true }],
	["微信退款适配器不可用", { withoutWechat: true }],
	["审计仓储不可用", { withoutAudits: true }],
	["订单尚未支付", { order: { status: "awaiting_confirmation" } }],
	["现金段未确认支付", { order: { wechatPaymentState: "unknown" } }],
] satisfies [string, Parameters<typeof fixture>[0]][]) {
	test(`受控恢复拒绝${label}，不重新申请医保退款`, async () => {
		const f = await fixture(options);
		await expect(
			f.service.recoverRejectedAppRefdSn(f.input),
		).rejects.toBeInstanceOf(MedicalInsuranceRegistrationInputError);
		expect(f.calls.sequence).toEqual([]);
		expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
	});
}

test("微信仓储缺少按订单查账能力时拒绝恢复，不发送退款", async () => {
	const f = await fixture({ withoutLedgerLookup: true });
	await expect(
		f.service.recoverRejectedAppRefdSn(f.input),
	).rejects.toBeInstanceOf(Error);
	expect(f.calls.sequence).toEqual([]);
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
});

test("恢复审计写入失败时保持原失败状态，不发送退款", async () => {
	const f = await fixture({ auditFailure: true });
	await expect(f.service.recoverRejectedAppRefdSn(f.input)).rejects.toThrow(
		"audit unavailable",
	);
	expect(f.calls.sequence).toEqual([]);
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
});

test("CAS 更新失败时不能通过回读继续调用医保退款", async () => {
	const f = await fixture({ rejectClaim: true });
	await expect(
		f.service.recoverRejectedAppRefdSn(f.input),
	).rejects.toBeInstanceOf(MedicalInsuranceRegistrationInputError);
	expect(f.calls.sequence).toEqual([]);
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
});

test("恢复成功后再次提交恢复被拒绝，不重复退款", async () => {
	const f = await fixture();
	await f.service.recoverRejectedAppRefdSn(f.input);
	await expect(
		f.service.recoverRejectedAppRefdSn(f.input),
	).rejects.toBeInstanceOf(MedicalInsuranceRegistrationInputError);
	expect(f.calls.sequence).toEqual(["medical", "wechat"]);
});

test("恢复的医保返回 EXP 时保留人工复核，不继续退款微信", async () => {
	const f = await fixture({ medicalRefStatus: "EXP" });
	expect(await f.service.recoverRejectedAppRefdSn(f.input)).toMatchObject({
		refundNo: f.legacy.refundNo,
		status: "manual_review",
		medicalStatus: "unknown",
		wechatStatus: "requested",
	});
	expect(f.calls.sequence).toEqual(["medical"]);
	expect(
		await f.wechatRefunds.findBySourceAndSourceOrder?.(
			"medical_insurance",
			f.legacy.medicalOrderId,
		),
	).toEqual([]);
});

test("医保恢复成功但微信失败时，审计不能记为整笔退费成功", async () => {
	const f = await fixture({ wechatFailure: true });
	expect(await f.service.recoverRejectedAppRefdSn(f.input)).toMatchObject({
		status: "manual_review",
		medicalStatus: "success",
		wechatStatus: "failed",
	});
	expect(f.calls.sequence).toEqual(["medical", "wechat"]);
	const auditEvents = await f.audits.listByAggregate(f.aggregateId);
	expect(auditEvents).toHaveLength(2);
	expect(auditEvents.at(-1)?.outcome).not.toBe("succeeded");
});

test("纯医保 ALL 恢复无需微信适配器，仍保留原52位平台退款号", async () => {
	const f = await fixture({ cashless: true, withoutWechat: true });
	expect(await f.service.recoverRejectedAppRefdSn(f.input)).toMatchObject({
		refundNo: f.legacy.refundNo,
		status: "succeeded",
		medicalStatus: "success",
		wechatStatus: "not_required",
	});
	expect(f.calls.sequence).toEqual(["medical"]);
	expect(f.calls.medical[0]?.[0].appRefdSn).toBe(
		f.legacy.refundNo.slice(0, 40),
	);
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toMatchObject({
		wechatMerchantRefundNo: null,
	});
});

test("普通 Admin 点击历史失败单仍返回原失败，不能自动触发受控恢复", async () => {
	const f = await fixture();
	expect(
		await f.service.requestFullRefundByOrder({
			orderId: f.legacy.medicalOrderId,
			operatorRef: "ordinary-admin-click",
			context,
		}),
	).toMatchObject({
		refundNo: f.legacy.refundNo,
		status: "failed",
		medicalStatus: "failed",
		wechatStatus: "requested",
	});
	expect(f.calls.sequence).toEqual([]);
	expect(await f.refunds.findByRefundNo(f.legacy.refundNo)).toEqual(f.legacy);
});
