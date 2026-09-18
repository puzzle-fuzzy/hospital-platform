import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	HospitalSettlementGateway,
	MedicalInsuranceOrder,
	MedicalInsuranceOrderRepository,
	MedicalInsurancePostPaymentComponent,
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MedicalInsuranceSettlementContext,
	MedicalInsuranceSettlementEvidence,
	MedicalInsuranceSettlementEvidenceFinality,
	MedicalInsuranceWechatPaymentGateway,
	PatientRepository,
	RegistrationSelfPaySettlementContext,
	UserIdentityRepository,
	WechatPaymentGateway,
	YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import {
	assertMedicalInsuranceOrderTransition,
	isMedicalInsuranceOrderType,
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
	medicalInsuranceCashPrepay,
	medicalInsuranceOrderTypeForBusiness,
	medicalInsurancePaymentBreakdown,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

/** 新医保订单域使用 owner-scoped 查询参数，不能复用旧 PaymentOrder worker。 */
export type MedicalInsuranceOrderQueryGateway = {
	query(
		input: {
			orderId: string;
			ownerUserId: string;
			cashPaymentConfirmed?: boolean;
		},
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
};

const BASE_QUERY_DELAY_MS = 15_000;
const MAX_QUERY_DELAY_MS = 15 * 60 * 1000;
const QUERY_BATCH_SIZE = 1;
// 两段结算包含微信查单及最多六个串行 Provider 写入；一分钟租约会在流程尚未
// 完成时被另一 Worker 抢占。五分钟覆盖正常调用窗口，崩溃后仍可自动回收。
const QUERY_CLAIM_LEASE_MS = 5 * 60_000;
const WECHAT_PREPAY_VALIDITY_MS = 2 * 60 * 60 * 1000;

function stableComponentCode(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function settlementContextText(
	value: Record<string, unknown>,
	keys: readonly string[],
): string | undefined {
	for (const key of keys) {
		const candidate = value[key];
		if (typeof candidate !== "string" && typeof candidate !== "number")
			continue;
		const normalized = String(candidate).trim();
		if (normalized) return normalized;
	}
	return undefined;
}

type CombinedPayTypeParam = NonNullable<
	MedicalInsurancePostPaymentComponent["payTypeParams"]
>[number];

function expectedPaymentLegs(input: {
	order: MedicalInsuranceOrder;
	insuredAreaCode: string;
}): readonly CombinedPayTypeParam[] {
	const amounts = input.order.amounts;
	if (!amounts) throw new Error("medical payment amounts are unavailable");
	const breakdown = medicalInsurancePaymentBreakdown({
		amounts,
		orderType: input.order.orderType ?? "RegPay",
		insuredAreaCode: input.insuredAreaCode,
	});
	if ((amounts.otherPaymentFen ?? 0) !== (amounts.hospitalPartFen ?? 0)) {
		throw new Error("medical-insurance-med-ins-other-fee-unmapped");
	}
	const hospitalReduceFen = breakdown.cashReduceDetails.reduce(
		(sum, detail) => sum + detail.cashReduceFen,
		0,
	);
	const hospitalPaymentFen = (amounts.hospitalPartFen ?? 0) + hospitalReduceFen;
	// 必须与 API 前置合单 2.6.65.2 保持一致：先医保统筹，再优惠挂号。
	const definitions: CombinedPayTypeParam[] = [
		{
			kind: "fund",
			amountFen: amounts.fundFen,
			payTypeId: "2",
		},
		{
			kind: "personal_account",
			amountFen: amounts.personalAccountFen,
			payTypeId: "5",
		},
		{
			kind: "wechat_cash",
			amountFen: breakdown.wechatCashFen,
			payTypeId: "5031",
		},
	];
	if (hospitalPaymentFen > 0) {
		definitions.splice(1, 0, {
			kind: "hospital_reduce",
			amountFen: hospitalPaymentFen,
			payTypeId: "50",
		});
	}
	return definitions.filter((component) => component.amountFen > 0);
}

function expectedPrePaymentComponents(input: {
	order: MedicalInsuranceOrder;
	insuredAreaCode: string;
	now: Date;
	mode: "sequenced" | "combined" | "legacy";
}): readonly MedicalInsurancePostPaymentComponent[] {
	const amounts = input.order.amounts;
	if (!amounts) throw new Error("medical payment amounts are unavailable");
	const payTypeParams = expectedPaymentLegs(input);
	if (
		payTypeParams.length === 0 ||
		payTypeParams.reduce((sum, component) => sum + component.amountFen, 0) !==
			amounts.totalFen
	) {
		throw new Error("medical-insurance-combined-payment-amount-mismatch");
	}
	if (input.mode === "sequenced") {
		const medicalLegs = payTypeParams.filter(
			(component) => component.kind !== "wechat_cash",
		);
		const cashLeg = payTypeParams.find(
			(component) => component.kind === "wechat_cash",
		);
		const medicalFen = medicalLegs.reduce(
			(sum, component) => sum + component.amountFen,
			0,
		);
		const components: MedicalInsurancePostPaymentComponent[] = [];
		if (medicalFen > 0) {
			components.push({
				componentId: `${input.order.medicalOrderId}:medical`,
				kind: "medical",
				totalFen: amounts.totalFen,
				amountFen: medicalFen,
				payModel: "H5",
				payTypeId: "2",
				payTypeParams: medicalLegs,
				recordCode: stableComponentCode(
					`medical-post-payment:${input.order.medicalOrderId}:medical`,
				),
				state: "pending",
				attempts: 0,
				updatedAt: input.now.toISOString(),
			});
		}
		if (cashLeg) {
			components.push({
				componentId: `${input.order.medicalOrderId}:wechat_cash`,
				kind: "wechat_cash",
				totalFen: amounts.totalFen,
				amountFen: cashLeg.amountFen,
				payModel: "H5",
				payTypeId: "5031",
				recordCode: stableComponentCode(
					`medical-post-payment:${input.order.medicalOrderId}:wechat_cash`,
				),
				state: "pending",
				attempts: 0,
				updatedAt: input.now.toISOString(),
			});
		}
		return components;
	}
	if (input.mode === "combined") {
		return [
			{
				componentId: `${input.order.medicalOrderId}:combined`,
				kind: "combined",
				totalFen: amounts.totalFen,
				amountFen: amounts.totalFen,
				payModel: "H5",
				payTypeId: "2",
				payTypeParams,
				recordCode: stableComponentCode(
					`medical-post-payment:${input.order.medicalOrderId}:combined`,
				),
				state: "pending",
				attempts: 0,
				updatedAt: input.now.toISOString(),
			},
		];
	}
	return payTypeParams.map((component) => ({
		componentId: `${input.order.medicalOrderId}:${component.kind}`,
		kind: component.kind,
		totalFen: amounts.totalFen,
		amountFen: component.amountFen,
		payModel: "H5" as const,
		payTypeId: component.payTypeId,
		recordCode: stableComponentCode(
			`medical-post-payment:${input.order.medicalOrderId}:${component.kind}`,
		),
		state: "pending" as const,
		attempts: 0,
		updatedAt: input.now.toISOString(),
	}));
}

function samePayTypeParams(
	left: MedicalInsurancePostPaymentComponent["payTypeParams"],
	right: MedicalInsurancePostPaymentComponent["payTypeParams"],
): boolean {
	const leftParams = left ?? [];
	const rightParams = right ?? [];
	return (
		leftParams.length === rightParams.length &&
		leftParams.every(
			(parameter, index) =>
				parameter.kind === rightParams[index]?.kind &&
				parameter.payTypeId === rightParams[index]?.payTypeId &&
				parameter.amountFen === rightParams[index]?.amountFen,
		)
	);
}

function samePrePaymentComponent(
	left: MedicalInsurancePostPaymentComponent,
	right: MedicalInsurancePostPaymentComponent,
): boolean {
	return (
		left.componentId === right.componentId &&
		left.kind === right.kind &&
		left.totalFen === right.totalFen &&
		left.amountFen === right.amountFen &&
		left.payModel === right.payModel &&
		left.payTypeId === right.payTypeId &&
		samePayTypeParams(left.payTypeParams, right.payTypeParams) &&
		left.recordCode === right.recordCode
	);
}

function samePrePaymentPlan(
	saved: readonly MedicalInsurancePostPaymentComponent[],
	planned: readonly MedicalInsurancePostPaymentComponent[],
): boolean {
	return (
		saved.length === planned.length &&
		planned.every((plannedComponent) =>
			saved.some((savedComponent) =>
				samePrePaymentComponent(savedComponent, plannedComponent),
			),
		)
	);
}

/**
 * 本次修复前可能已有 5031/MINI_PROGRAM 的 .2 分项成功落库。该流水不能
 * 在支付完成后改写；Worker 只允许它作为已完成的历史事实进入最终回写。
 * 新订单和任何 failed/pending 旧流水仍须使用 H5/5031。
 */
function sameOrCompletedLegacyMiniProgramPrePaymentPlan(
	saved: readonly MedicalInsurancePostPaymentComponent[],
	planned: readonly MedicalInsurancePostPaymentComponent[],
): boolean {
	if (samePrePaymentPlan(saved, planned)) return true;
	if (saved.length !== planned.length) return false;
	const plannedById = new Map(
		planned.map((component) => [component.componentId, component]),
	);
	if (plannedById.size !== planned.length) return false;

	let legacyCashComponent = false;
	const seen = new Set<string>();
	for (const savedComponent of saved) {
		if (seen.has(savedComponent.componentId)) return false;
		seen.add(savedComponent.componentId);
		const plannedComponent = plannedById.get(savedComponent.componentId);
		if (!plannedComponent) return false;
		if (samePrePaymentComponent(savedComponent, plannedComponent)) continue;
		if (
			legacyCashComponent ||
			savedComponent.kind !== "wechat_cash" ||
			plannedComponent.kind !== "wechat_cash" ||
			savedComponent.payTypeId !== "5031" ||
			plannedComponent.payTypeId !== "5031" ||
			savedComponent.payModel !== "MINI_PROGRAM" ||
			plannedComponent.payModel !== "H5" ||
			savedComponent.state !== "succeeded" ||
			!savedComponent.payingId ||
			!savedComponent.tradingId ||
			savedComponent.totalFen !== plannedComponent.totalFen ||
			savedComponent.amountFen !== plannedComponent.amountFen ||
			savedComponent.recordCode !== plannedComponent.recordCode
		) {
			return false;
		}
		legacyCashComponent = true;
	}
	return legacyCashComponent;
}

export type MedicalInsuranceOrderReconciliationWorkerResult =
	| "idle"
	| "reconciled"
	| "retry_scheduled"
	| "manual_review";

function queryDelayMs(queryAttempts: number): number {
	return Math.min(
		MAX_QUERY_DELAY_MS,
		BASE_QUERY_DELAY_MS * 2 ** Math.max(0, queryAttempts),
	);
}

function isNonTerminalEvidence(
	finality: MedicalInsuranceSettlementEvidenceFinality,
): boolean {
	return (
		finality === "processing" ||
		finality === "settlement_candidate" ||
		finality === "unknown"
	);
}

function taskAfterQuery(
	task: MedicalInsuranceQueryTask,
	now: Date,
	options: {
		continueQuery: boolean;
		manualReview?: boolean;
		lastErrorCode?: string;
		terminalOrdStas?: string;
	},
): MedicalInsuranceQueryTask {
	const {
		claimedUntil: _previousClaimedUntil,
		lastErrorCode: _previousLastErrorCode,
		...withoutSchedule
	} = task;
	const attempts = Math.min(Number.MAX_SAFE_INTEGER, task.attempts + 1);
	const exhausted =
		options.continueQuery &&
		attempts >=
			Math.min(task.maxAttempts, MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS);
	const manualReview = options.manualReview || exhausted;
	return {
		...withoutSchedule,
		status: manualReview
			? "manual_review"
			: options.continueQuery
				? "pending"
				: "completed",
		attempts,
		claimedUntil: null,
		lastErrorCode: options.lastErrorCode ?? null,
		terminalOrdStas: options.terminalOrdStas ?? task.terminalOrdStas,
		version: task.version + 1,
		updatedAt: now.toISOString(),
		...(options.continueQuery && !manualReview
			? {
					nextAttemptAt: new Date(
						now.getTime() + queryDelayMs(task.attempts),
					).toISOString(),
				}
			: {}),
	};
}

function sameAmounts(
	order: MedicalInsuranceOrder,
	evidence: MedicalInsuranceSettlementEvidence,
): boolean {
	if (!order.amounts) return false;
	return (
		order.amounts.totalFen === evidence.amounts.totalFen &&
		order.amounts.cashFen === evidence.amounts.cashFen &&
		order.amounts.personalAccountFen +
			order.amounts.fundFen +
			(order.amounts.otherPaymentFen ?? 0) ===
			evidence.amounts.insuranceFen
	);
}

function reconciliationFailureCode(error: unknown): string | undefined {
	if (!(error instanceof Error)) return undefined;
	if (
		error.message === "medical order version conflict" ||
		error.message ===
			"Medical insurance query task was changed by another worker"
	) {
		return "concurrent-state-change";
	}
	return undefined;
}

/**
 * 2.27.2.32 的成功回写是不可重放的权威事实。
 *
 * `ord_stas` 只允许保存 6202/6301 的短状态，不能把
 * `completion=isSettle=1` 之类的诊断文本写入数据库；诊断值留在加密结算
 * 上下文和日志中，订单状态迁移只使用已有的短状态快照。
 */
function successfulSettlementWriteback(
	context: MedicalInsuranceSettlementContext | undefined,
	order: MedicalInsuranceOrder,
): boolean {
	const providerStatus = context?.settlementWriteback?.providerStatus ?? "";
	const medicalSucceeded =
		context?.settlementWriteback?.status === "succeeded" &&
		/(^|,)insur=SUCCESS(,|$)/u.test(providerStatus) &&
		/(^|,)settle=SUCCESS(,|$)/u.test(providerStatus);
	const selfPayRequired =
		(order.amounts?.cashFen ?? 0) > 0 &&
		Boolean(
			context?.postPaymentComponents?.some(
				(component) => component.kind === "wechat_cash",
			),
		);
	const selfPayProviderStatus =
		context?.selfPaySettlementWriteback?.providerStatus ?? "";
	const selfPaySucceeded =
		!selfPayRequired ||
		(context?.selfPaySettlementWriteback?.status === "succeeded" &&
			/(^|,)insur=SUCCESS(,|$)/u.test(selfPayProviderStatus) &&
			/(^|,)settle=SUCCESS(,|$)/u.test(selfPayProviderStatus));
	const completionRequired = true;
	const completionSucceeded =
		!completionRequired ||
		context?.settlementCompletion?.status === "succeeded";
	const selfPayCompletionRequired = selfPayRequired;
	const selfPayCompletionSucceeded =
		!selfPayCompletionRequired ||
		context?.selfPaySettlementCompletion?.status === "succeeded";
	return (
		medicalSucceeded &&
		selfPaySucceeded &&
		completionSucceeded &&
		selfPayCompletionSucceeded
	);
}

function candidateState(
	evidence: MedicalInsuranceSettlementEvidence,
): MedicalInsuranceOrder["status"] {
	if (evidence.finality === "failed" || evidence.finality === "cancelled") {
		return evidence.authoritative ? "failed" : "awaiting_confirmation";
	}
	if (
		evidence.finality === "paid" &&
		evidence.authoritative &&
		evidence.source === "yunhealth"
	) {
		// .32 成功后仍由微信自费订单阶段确认；门诊最终还要完成 .5，
		// 挂号只要求两条 .32 成功。
		return "cash_pending";
	}
	return "awaiting_confirmation";
}

function recoverableOrderType(
	order: MedicalInsuranceOrder,
): MedicalInsuranceOrder["orderType"] {
	const businessType =
		order.businessType ?? (order.appointmentId ? "registration" : undefined);
	if (!businessType) return undefined;
	const expected = medicalInsuranceOrderTypeForBusiness(businessType);
	const orderType = order.orderType ?? expected;
	return isMedicalInsuranceOrderType(orderType) && orderType === expected
		? orderType
		: undefined;
}

function hasUsableWechatPrepay(
	order: MedicalInsuranceOrder,
	now: Date,
): boolean {
	// 6202 hospPartAmt 是 othFeeAmt 明细，不能从 ownPayAmt/cashFen 再减。
	if ((order.amounts?.cashFen ?? 0) === 0) return true;
	if (!order.wechatPayParams || !order.wechatPrepayExpiresAt) return false;
	const expiresAt = Date.parse(order.wechatPrepayExpiresAt);
	return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

/** 返回可安全应用的订单状态；不允许查单把终态静默改回处理中。 */
function safeNextState(
	order: MedicalInsuranceOrder,
	candidate: MedicalInsuranceOrder["status"],
): MedicalInsuranceOrder["status"] {
	if (candidate === order.status) return candidate;
	try {
		assertMedicalInsuranceOrderTransition(order.status, candidate);
		return candidate;
	} catch {
		if (order.status === "manual_review") return "manual_review";
		return "manual_review";
	}
}

/**
 * 新医保订单域的支付成功后置结算 Worker。
 *
 * 旧的 `MedicalInsuranceReconciliationWorker` 面向历史 PaymentOrder 聚合，
 * 不能直接消费 `hp_medical_insurance_orders`；本 Worker 使用同一张查单任务表，
 * 但通过 owner-scoped 医保订单仓储和安全凭证 gateway 完成真正的订单回写。
 */
export class MedicalInsuranceOrderReconciliationWorker {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			tasks: MedicalInsuranceQueryTaskRepository;
			orders: MedicalInsuranceOrderRepository;
			medicalInsurance: MedicalInsuranceOrderQueryGateway;
			wechatPayment?: MedicalInsuranceWechatPaymentGateway;
			/** 新订单普通微信 APIv3/RSA 自费查单；旧混合单仍走 wechatPayment。 */
			wechatCashPayment?: WechatPaymentGateway;
			identityUsers?: UserIdentityRepository;
			patients?: PatientRepository;
			postPayment?: YunhealthRegistrationPluginPaymentGateway;
			postPaymentPayType?: "CREDIT" | "POS" | "CROWD_FUNDING";
			postPaymentWorkStationId?: string;
			postPaymentTradeTypeCode?: string;
			/** 新两段流程中自费子流水的 .29 -> .15 -> .5 回写。 */
			hospitalSettlement?: HospitalSettlementGateway;
			completeWechatPayment?: (
				input: {
					ownerUserId: string;
					medicalOrderId: string;
					paymentOrderId: string;
				},
				context: AdapterCallContext,
			) => Promise<boolean>;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async updateTask(
		task: MedicalInsuranceQueryTask,
		now: Date,
		options: Parameters<typeof taskAfterQuery>[2],
	): Promise<MedicalInsuranceQueryTask> {
		const updated = taskAfterQuery(task, now, options);
		return this.dependencies.tasks.update(updated, task.version);
	}

	private async recoverWechatMixedOrder(
		task: MedicalInsuranceQueryTask,
		order: MedicalInsuranceOrder,
		now: Date,
		context: AdapterCallContext,
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const gateway = this.dependencies.wechatPayment;
		const orderType = recoverableOrderType(order);
		const identity = await this.dependencies.identityUsers?.findByUserId(
			order.ownerUserId,
		);
		const patients = await this.dependencies.patients?.listByOwner(
			order.ownerUserId,
		);
		const patient = patients?.find(
			(candidate) => candidate.id === order.patientId,
		);
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (
			!gateway ||
			!identity?.providerSubject ||
			!patient ||
			!order.wechatOutTradeNo ||
			!order.payOrdId ||
			!order.amounts ||
			!orderType
		) {
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-mixed-recovery-context-missing",
			});
			this.logger.error(
				{
					event:
						"worker.payment.medical_wechat_recovery.manual_review_required",
					taskId: task.taskId,
					orderId: order.medicalOrderId,
					reason: "wechat-mixed-recovery-context-missing",
				},
				"Medical insurance WeChat order recovery requires manual review",
			);
			return "manual_review";
		}
		const cashPrepay = medicalInsuranceCashPrepay(settlement);
		const result = await gateway.recoverMixedOrder(
			{
				orderId: order.medicalOrderId,
				outTradeNo: order.wechatOutTradeNo,
				openid: identity.providerSubject,
				payOrdId: order.payOrdId,
				medOrgOrd: order.medOrgOrd,
				orderType,
				amounts: order.amounts,
				...(settlement?.insuredAreaCode
					? { insuredAreaCode: settlement.insuredAreaCode }
					: {}),
				// 与授权/下单阶段的临时验收策略一致：unknown 暂按本人。
				expectedPayForRelatives:
					patient.relationship !== "self" && patient.relationship !== "unknown",
				...(cashPrepay ? { cashPrepay } : {}),
			},
			context,
		);
		const recoveredPrepayExpiresAt = result.prepayId
			? (order.wechatPrepayExpiresAt ??
				new Date(now.getTime() + WECHAT_PREPAY_VALIDITY_MS).toISOString())
			: null;
		const recoveredPrepayUsable =
			!result.prepayId ||
			(recoveredPrepayExpiresAt !== null &&
				Date.parse(recoveredPrepayExpiresAt) > now.getTime());
		const recovered = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: order.status,
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				wechatMixTradeNo: result.mixTradeNo,
				wechatOutTradeNo: order.wechatOutTradeNo,
				wechatPayParams: recoveredPrepayUsable ? result.payParams : null,
				wechatPrepayExpiresAt: recoveredPrepayExpiresAt,
				wechatPaymentState: recoveredPrepayUsable ? "prepay_ready" : "unknown",
			},
		);
		if (!recovered) throw new Error("medical order version conflict");
		this.logger.info(
			{
				event: "worker.payment.medical_wechat_recovery.succeeded",
				taskId: task.taskId,
				orderId: order.medicalOrderId,
				providerRequestId: result.trace.requestId,
				mixTradeNo: result.mixTradeNo,
			},
			"Medical insurance WeChat order recovered by merchant order number",
		);
		return this.reconcileWechatMixedOrder(task, recovered, now, context);
	}

	private async reconcileOwnWechatOrder(
		task: MedicalInsuranceQueryTask,
		order: MedicalInsuranceOrder,
		now: Date,
		context: AdapterCallContext,
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const gateway = this.dependencies.wechatCashPayment;
		if (!gateway || !order.wechatOutTradeNo || !order.amounts) {
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-self-pay-recovery-context-missing",
			});
			return "manual_review";
		}
		const result = await gateway.query(
			{ orderId: order.wechatOutTradeNo },
			context,
		);
		if (result.totalFen !== order.amounts.cashFen) {
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-self-pay-amount-mismatch",
			});
			await this.dependencies.orders.applySettlement(
				order.medicalOrderId,
				order.version,
				{
					status: "manual_review",
					ordStas: order.ordStas,
					amounts: order.amounts,
					setlType: order.setlType,
					revsTokenHash: order.revsTokenHash,
					revsTokenExpiresAt: order.revsTokenExpiresAt,
					wechatPaymentState: "failed",
				},
			);
			return "manual_review";
		}
		if (result.state === "cash_pending") {
			const updatedTask = await this.updateTask(task, now, {
				continueQuery: true,
				lastErrorCode: "wechat-self-pay-pending",
			});
			return updatedTask.status === "manual_review"
				? "manual_review"
				: "retry_scheduled";
		}
		if (result.state === "failed") {
			await this.dependencies.orders.applySettlement(
				order.medicalOrderId,
				order.version,
				{
					status: "manual_review",
					ordStas: order.ordStas,
					amounts: order.amounts,
					setlType: order.setlType,
					revsTokenHash: order.revsTokenHash,
					revsTokenExpiresAt: order.revsTokenExpiresAt,
					wechatPaymentState: "failed",
				},
			);
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-self-pay-failed",
			});
			return "manual_review";
		}

		const paidOrder = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: order.status,
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				wechatPaymentState: "cash_paid",
			},
		);
		if (!paidOrder) throw new Error("medical order version conflict");
		let evidence: MedicalInsuranceSettlementEvidence;
		try {
			evidence = await this.dependencies.medicalInsurance.query(
				{
					orderId: order.medicalOrderId,
					ownerUserId: order.ownerUserId,
					cashPaymentConfirmed: true,
				},
				{
					...context,
					idempotencyKey: `medical-self-pay-finalize:${order.medicalOrderId}`,
				},
			);
		} catch {
			await this.updateTask(task, now, {
				continueQuery: true,
				lastErrorCode: "medical-self-pay-finalize-pending",
			});
			return "retry_scheduled";
		}
		const completed =
			evidence.state === "insurance_settled" &&
			evidence.finality === "paid" &&
			evidence.authoritative &&
			sameAmounts(paidOrder, evidence);
		if (completed) {
			const settled = await this.dependencies.orders.applySettlement(
				paidOrder.medicalOrderId,
				paidOrder.version,
				{
					status: "insurance_settled",
					ordStas: paidOrder.ordStas,
					amounts: paidOrder.amounts,
					setlType: paidOrder.setlType,
					revsTokenHash: paidOrder.revsTokenHash,
					revsTokenExpiresAt: paidOrder.revsTokenExpiresAt,
					wechatPaymentState: "cash_paid",
				},
			);
			if (!settled) throw new Error("medical order version conflict");
			await this.updateTask(task, now, {
				continueQuery: false,
				terminalOrdStas: evidence.providerStatus,
			});
			return "reconciled";
		}
		const needsManualReview =
			evidence.finality === "failed" ||
			evidence.finality === "cancelled" ||
			!sameAmounts(paidOrder, evidence);
		const updatedTask = await this.updateTask(task, now, {
			continueQuery: !needsManualReview,
			manualReview: needsManualReview,
			lastErrorCode: needsManualReview
				? "medical-self-pay-finalize-conflict"
				: "medical-self-pay-finalize-pending",
			...(needsManualReview
				? { terminalOrdStas: evidence.providerStatus }
				: {}),
		});
		if (needsManualReview) {
			await this.dependencies.orders.applySettlement(
				paidOrder.medicalOrderId,
				paidOrder.version,
				{
					status: "manual_review",
					ordStas: paidOrder.ordStas,
					amounts: paidOrder.amounts,
					setlType: paidOrder.setlType,
					revsTokenHash: paidOrder.revsTokenHash,
					revsTokenExpiresAt: paidOrder.revsTokenExpiresAt,
					wechatPaymentState: "cash_paid",
				},
			);
			return "manual_review";
		}
		return updatedTask.status === "manual_review"
			? "manual_review"
			: "retry_scheduled";
	}

	private async updateSettlementContext(
		order: MedicalInsuranceOrder,
		update: (
			current: MedicalInsuranceSettlementContext,
		) => MedicalInsuranceSettlementContext,
	): Promise<MedicalInsuranceSettlementContext> {
		const current = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (!current) {
			throw new Error("medical-insurance-settlement-context-missing");
		}
		const next = update(current);
		await this.dependencies.orders.saveSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
			next,
		);
		return next;
	}

	private registrationSelfPayContext(
		order: MedicalInsuranceOrder,
		settlement: MedicalInsuranceSettlementContext,
		component: MedicalInsurancePostPaymentComponent,
	): RegistrationSelfPaySettlementContext {
		const register = settlement.networkRegister;
		const certNo = settlementContextText(register, [
			"idNo",
			"id_no",
			"certNo",
			"cert_no",
		]);
		const psnName = settlementContextText(register, [
			"netPatName",
			"net_pat_name",
			"psnName",
			"psn_name",
		]);
		const psnNo = settlementContextText(register, [
			"memberNo",
			"member_no",
			"psnNo",
			"psn_no",
		]);
		if (
			!component.payingId ||
			!component.tradingId ||
			!order.wechatOutTradeNo ||
			!certNo ||
			!psnName ||
			!psnNo ||
			!this.dependencies.postPaymentPayType ||
			this.dependencies.postPaymentWorkStationId === undefined ||
			!this.dependencies.postPaymentTradeTypeCode
		) {
			throw new Error("medical-insurance-self-pay-writeback-context-missing");
		}
		const thirdParty = settlement.selfPayThirdPartyWriteback;
		return {
			businessId: settlement.businessId,
			...(settlement.businessCode
				? { businessCode: settlement.businessCode }
				: {}),
			tradeTypeCode:
				order.businessType === "outpatient"
					? "2"
					: this.dependencies.postPaymentTradeTypeCode,
			payingId: component.payingId,
			tradingId: component.tradingId,
			hospitalId: settlement.hospitalId,
			patientId: settlement.patientId,
			certNo,
			psnCertType:
				settlementContextText(register, [
					"psnCertType",
					"psn_cert_type",
					"idType",
					"id_type",
				]) ?? "01",
			psnName,
			psnNo,
			patInHosId:
				settlementContextText(register, ["patInHosId", "pat_in_hos_id"]) ?? "0",
			outTradeNo: order.wechatOutTradeNo,
			recordCode: component.recordCode,
			payTypeId: component.payTypeId,
			payType: this.dependencies.postPaymentPayType,
			workStationId: this.dependencies.postPaymentWorkStationId,
			...(thirdParty?.status === "succeeded" && thirdParty.thirdPartPayRecordId
				? {
						thirdPartPayRecordId: thirdParty.thirdPartPayRecordId,
						...(thirdParty.rawResponse
							? { thirdPartPayRawResponse: thirdParty.rawResponse }
							: {}),
					}
				: {}),
			...(settlement.selfPayPaymentNotify?.status === "succeeded"
				? { paymentNotifyCompleted: true }
				: {}),
		};
	}

	/** 医保 `.32/.5` 完成后，创建独立 5031 `.2` 并执行 `.29/.15/.5`。 */
	private async completeSequencedSelfPay(
		order: MedicalInsuranceOrder,
		settlement: MedicalInsuranceSettlementContext,
		now: Date,
		context: AdapterCallContext,
	): Promise<boolean> {
		const preOrderGateway = this.dependencies.postPayment;
		const writeBackGateway = this.dependencies.hospitalSettlement;
		const cashComponent = settlement.postPaymentComponents?.find(
			(component) => component.kind === "wechat_cash",
		);
		if (!cashComponent) {
			if (!settlement.postPaymentCompletedAt) {
				await this.updateSettlementContext(order, (current) => ({
					...current,
					postPaymentCompletedAt: now.toISOString(),
				}));
			}
			return true;
		}
		if (
			!preOrderGateway ||
			!writeBackGateway ||
			!settlement.businessCode ||
			!this.dependencies.postPaymentPayType ||
			this.dependencies.postPaymentWorkStationId === undefined ||
			!this.dependencies.postPaymentTradeTypeCode
		) {
			return false;
		}

		let currentSettlement = settlement;
		let currentComponent = cashComponent;
		if (currentComponent.state === "succeeded") {
			await this.dependencies.orders.saveYunhealthPaymentQueryReference({
				ownerUserId: order.ownerUserId,
				medicalOrderId: order.medicalOrderId,
				componentId: currentComponent.componentId,
				recordCode: currentComponent.recordCode,
			});
		}
		if (currentComponent.state !== "succeeded") {
			const attempted: MedicalInsurancePostPaymentComponent = {
				...currentComponent,
				state: "pending",
				attempts: currentComponent.attempts + 1,
				updatedAt: now.toISOString(),
			};
			currentSettlement = await this.updateSettlementContext(
				order,
				(current) => ({
					...current,
					postPaymentComponents: (current.postPaymentComponents ?? []).map(
						(component) =>
							component.componentId === attempted.componentId
								? attempted
								: component,
					),
				}),
			);
			try {
				const result = await preOrderGateway.createPreOrder(
					{
						orderId: attempted.componentId,
						businessId: currentSettlement.businessId,
						tradeCode: currentSettlement.businessCode as string,
						totalFen: attempted.totalFen,
						amountFen: attempted.amountFen,
						hospitalId: currentSettlement.hospitalId,
						patientId: currentSettlement.patientId,
						payTypeId: attempted.payTypeId,
						payModel: "H5",
						payType: this.dependencies.postPaymentPayType,
						workStationId: this.dependencies.postPaymentWorkStationId,
						recordCode: attempted.recordCode,
						tradeTypeCode:
							order.businessType === "outpatient"
								? "2"
								: this.dependencies.postPaymentTradeTypeCode,
					},
					{
						...context,
						idempotencyKey: `medical-self-pay-preorder:${attempted.componentId}`,
					},
				);
				currentComponent = {
					...attempted,
					state: "succeeded",
					payingId: result.payingId,
					tradingId: result.tradingId,
					providerRequestId: result.trace.requestId,
					updatedAt: new Date().toISOString(),
				};
				currentSettlement = await this.updateSettlementContext(
					order,
					(current) => ({
						...current,
						postPaymentComponents: (current.postPaymentComponents ?? []).map(
							(component) =>
								component.componentId === currentComponent.componentId
									? currentComponent
									: component,
						),
					}),
				);
				await this.dependencies.orders.saveYunhealthPaymentQueryReference({
					ownerUserId: order.ownerUserId,
					medicalOrderId: order.medicalOrderId,
					componentId: currentComponent.componentId,
					recordCode: currentComponent.recordCode,
				});
			} catch (error) {
				const metadata = providerFailureMetadata(error);
				await this.updateSettlementContext(order, (current) => ({
					...current,
					postPaymentComponents: (current.postPaymentComponents ?? []).map(
						(component) =>
							component.componentId === attempted.componentId
								? {
										...attempted,
										state: "failed",
										lastErrorCode:
											metadata.providerErrorCode ??
											metadata.providerFailureReason ??
											"self-pay-preorder-failed",
										updatedAt: new Date().toISOString(),
									}
								: component,
					),
				}));
				throw error;
			}
		}

		currentSettlement =
			(await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			)) ?? currentSettlement;
		if (currentSettlement.selfPaySettlementCompletion?.status === "succeeded") {
			if (!currentSettlement.postPaymentCompletedAt) {
				await this.updateSettlementContext(order, (current) => ({
					...current,
					postPaymentCompletedAt: now.toISOString(),
				}));
			}
			return true;
		}
		for (const step of [
			currentSettlement.selfPayThirdPartyWriteback,
			currentSettlement.selfPayPaymentNotify,
			currentSettlement.selfPaySettlementCompletion,
		]) {
			if (step && step.status !== "succeeded") return false;
		}

		const registrationContext = this.registrationSelfPayContext(
			order,
			currentSettlement,
			currentComponent,
		);
		const attemptedAt = () => new Date().toISOString();
		const trace = await writeBackGateway.writeBack(
			{
				orderId: currentComponent.componentId,
				settlement: {
					orderId: currentComponent.componentId,
					state: "cash_paid",
					totalFen: currentComponent.amountFen,
					insuranceFen: 0,
					cashFen: currentComponent.amountFen,
					trace: [],
				},
				registrationContext,
				onThirdPartPayAttempt: async () => {
					await this.updateSettlementContext(order, (current) => ({
						...current,
						selfPayThirdPartyWriteback: {
							attemptedAt: attemptedAt(),
							status: "unknown",
						},
					}));
				},
				onThirdPartPayResponse: async (response) => {
					await this.updateSettlementContext(order, (current) => ({
						...current,
						selfPayThirdPartyWriteback: {
							attemptedAt:
								current.selfPayThirdPartyWriteback?.attemptedAt ??
								attemptedAt(),
							status: "succeeded",
							...(response.requestId
								? { providerRequestId: response.requestId }
								: {}),
							providerStatus: "2.27.2.29_success",
							thirdPartPayRecordId: response.thirdPartPayRecordId,
							rawResponse: response.rawResponse,
						},
					}));
				},
				onPaymentNotifyAttempt: async () => {
					await this.updateSettlementContext(order, (current) => ({
						...current,
						selfPayPaymentNotify: {
							attemptedAt: attemptedAt(),
							status: "unknown",
						},
					}));
				},
				onPaymentNotifyResponse: async (response) => {
					await this.updateSettlementContext(order, (current) => ({
						...current,
						selfPayPaymentNotify: {
							attemptedAt:
								current.selfPayPaymentNotify?.attemptedAt ?? attemptedAt(),
							status: "succeeded",
							providerRequestId: response.requestId,
							providerStatus: "2.6.65.15_success",
						},
					}));
				},
				onCompleteSettlementAttempt: async () => {
					await this.updateSettlementContext(order, (current) => ({
						...current,
						selfPaySettlementCompletion: {
							attemptedAt: attemptedAt(),
							status: "unknown",
						},
					}));
				},
			},
			{
				...context,
				idempotencyKey: `medical-self-pay-writeback:${currentComponent.componentId}`,
			},
		);
		await this.updateSettlementContext(order, (current) => ({
			...current,
			postPaymentCompletedAt: attemptedAt(),
			selfPaySettlementCompletion: {
				attemptedAt:
					current.selfPaySettlementCompletion?.attemptedAt ?? attemptedAt(),
				status: "succeeded",
				providerRequestId: trace.requestId,
				providerStatus: "completion=1",
			},
		}));
		return true;
	}

	private async markInsuranceOrderSettled(
		order: MedicalInsuranceOrder,
	): Promise<boolean> {
		const latest = await this.dependencies.orders.findByMedicalOrderId(
			order.medicalOrderId,
		);
		if (!latest) return false;
		if (latest.status === "insurance_settled") return true;
		const completed = await this.dependencies.orders.applySettlement(
			latest.medicalOrderId,
			latest.version,
			{
				status: "insurance_settled",
				ordStas: latest.ordStas,
				amounts: latest.amounts,
				setlType: latest.setlType,
				revsTokenHash: latest.revsTokenHash,
				revsTokenExpiresAt: latest.revsTokenExpiresAt,
				wechatPaymentState: "cash_paid",
			},
		);
		if (completed?.status === "insurance_settled") return true;
		const refreshed = await this.dependencies.orders.findByMedicalOrderId(
			latest.medicalOrderId,
		);
		if (!refreshed) return false;
		if (refreshed.status === "insurance_settled") return true;
		const retried = await this.dependencies.orders.applySettlement(
			refreshed.medicalOrderId,
			refreshed.version,
			{
				status: "insurance_settled",
				ordStas: refreshed.ordStas,
				amounts: refreshed.amounts,
				setlType: refreshed.setlType,
				revsTokenHash: refreshed.revsTokenHash,
				revsTokenExpiresAt: refreshed.revsTokenExpiresAt,
				wechatPaymentState: "cash_paid",
			},
		);
		return retried?.status === "insurance_settled";
	}

	private async completePrePaymentComponents(
		order: MedicalInsuranceOrder,
		wechatResult: Awaited<
			ReturnType<MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]>
		>,
		now: Date,
		context: AdapterCallContext,
	): Promise<boolean> {
		const gateway = this.dependencies.postPayment;
		if (!gateway || !order.amounts) return false;
		let settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (!settlement?.insuredAreaCode || !settlement.businessCode) return false;
		const expected = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType: order.orderType ?? "RegPay",
			insuredAreaCode: settlement.insuredAreaCode,
		});
		if (
			wechatResult.totalFen !== order.amounts.totalFen ||
			wechatResult.fundFen !== order.amounts.fundFen ||
			wechatResult.personalAccountFen !== order.amounts.personalAccountFen ||
			wechatResult.otherPaymentFen !== (order.amounts.otherPaymentFen ?? 0) ||
			wechatResult.medicalCashFen !== order.amounts.cashFen ||
			wechatResult.cashFen !== expected.wechatCashFen ||
			JSON.stringify(wechatResult.cashReduceDetails ?? []) !==
				JSON.stringify(expected.cashReduceDetails)
		) {
			throw new Error("medical-insurance-wechat-component-amount-mismatch");
		}

		const saved = settlement.postPaymentComponents;
		if (!saved) {
			throw new Error("medical-insurance-pre-payment-components-missing");
		}
		const sequenced = settlement.postPaymentPlanVersion === "sequenced-v1";
		const combined = saved.some((component) => component.kind === "combined");
		const planned = expectedPrePaymentComponents({
			order,
			insuredAreaCode: settlement.insuredAreaCode,
			now,
			mode: sequenced ? "sequenced" : combined ? "combined" : "legacy",
		});
		// 新两段计划、旧合单必须精确匹配；历史拆分只按既有事实续跑。
		if (
			((sequenced || combined) && !samePrePaymentPlan(saved, planned)) ||
			(!sequenced &&
				!combined &&
				!sameOrCompletedLegacyMiniProgramPrePaymentPlan(saved, planned))
		) {
			throw new Error("medical-insurance-pre-payment-plan-changed");
		}
		const medicalComponent = saved.find(
			(component) => component.kind === "medical",
		);
		if (
			sequenced
				? Boolean(medicalComponent && medicalComponent.state !== "succeeded")
				: saved.some((component) => component.state !== "succeeded")
		) {
			throw new Error("medical-insurance-pre-payment-components-incomplete");
		}
		if (sequenced && !medicalComponent) {
			const selfPayCompleted = await this.completeSequencedSelfPay(
				order,
				settlement,
				now,
				context,
			);
			return selfPayCompleted ? this.markInsuranceOrderSettled(order) : false;
		}

		settlement =
			(await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			)) ?? settlement;
		if (!sequenced && !settlement.postPaymentCompletedAt) {
			settlement = {
				...settlement,
				postPaymentCompletedAt: now.toISOString(),
			};
			await this.dependencies.orders.saveSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
				settlement,
			);
		}

		// cashPaymentConfirmed=true 只完成第一段医保 `.32 -> .5`。新两段计划
		// 必须等它成功后，才创建 5031 自费 `.2` 并进入 `.29 -> .15 -> .5`；
		// 发布前的 combined/拆分计划仍按已持久化事实续跑。
		let completion: MedicalInsuranceSettlementEvidence | undefined;
		let completionError: unknown;
		try {
			completion = await this.dependencies.medicalInsurance.query(
				{
					orderId: order.medicalOrderId,
					ownerUserId: order.ownerUserId,
					cashPaymentConfirmed: true,
				},
				{
					...context,
					idempotencyKey: `medical-post-payment-finalize:${order.medicalOrderId}`,
				},
			);
		} catch (error) {
			completionError = error;
		}
		const settlementAfterFinalize =
			await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			);
		const writebackSucceeded = sequenced
			? settlementAfterFinalize?.settlementWriteback?.status === "succeeded" &&
				settlementAfterFinalize.settlementCompletion?.status === "succeeded"
			: successfulSettlementWriteback(settlementAfterFinalize, order);
		const completionAccepted = Boolean(
			completion &&
				completion.state === "insurance_settled" &&
				completion.finality === "paid" &&
				completion.authoritative &&
				sameAmounts(order, completion),
		);
		// 新串行流程只能以已经持久化成功的 `.32` 和医保 `.5` 作为进入
		// 自费腿的门禁。查询返回 paid 只说明支付终态，绝不能替代 HIS
		// 回写成功事实，否则会在医保 `.5` 失败后错误创建第二笔自费 `.2`。
		if (sequenced && !writebackSucceeded) {
			const nonReplayableWritebackBlocked = [
				settlementAfterFinalize?.settlementWriteback?.status,
				settlementAfterFinalize?.settlementCompletion?.status,
			].some((status) => status === "failed" || status === "unknown");
			if (completionError && !nonReplayableWritebackBlocked) {
				throw completionError;
			}
			return false;
		}
		if (completionError && !writebackSucceeded) throw completionError;
		if (!completionAccepted && !writebackSucceeded) return false;
		if (writebackSucceeded && !completionAccepted) {
			this.logger.warn(
				{
					event: "worker.payment.medical_wechat_query.writeback_succeeded",
					traceId: context.traceId,
					orderId: order.medicalOrderId,
					completionErrorName:
						completionError instanceof Error ? completionError.name : undefined,
				},
				"Medical insurance .32 writeback succeeded; treating payment as settled",
			);
		}
		if (sequenced) {
			const selfPayCompleted = await this.completeSequencedSelfPay(
				order,
				settlementAfterFinalize ?? settlement,
				now,
				context,
			);
			if (!selfPayCompleted) return false;
		}
		return this.markInsuranceOrderSettled(order);
	}

	private async reconcileWechatMixedOrder(
		task: MedicalInsuranceQueryTask,
		order: MedicalInsuranceOrder,
		now: Date,
		context: AdapterCallContext,
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const gateway = this.dependencies.wechatPayment;
		if (
			!gateway ||
			!order.wechatMixTradeNo ||
			!order.wechatOutTradeNo ||
			!order.payOrdId ||
			!order.amounts
		) {
			await this.updateTask(task, now, {
				continueQuery: false,
				manualReview: true,
				lastErrorCode: "wechat-mixed-query-context-missing",
			});
			this.logger.error(
				{
					event: "worker.payment.medical_wechat_query.manual_review_required",
					taskId: task.taskId,
					orderId: order.medicalOrderId,
					reason: "wechat-mixed-query-context-missing",
				},
				"Medical insurance WeChat mixed order requires manual review",
			);
			return "manual_review";
		}
		const settlementBeforeQuery =
			await this.dependencies.orders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType: order.orderType ?? "RegPay",
			insuredAreaCode: settlementBeforeQuery?.insuredAreaCode ?? "",
		});
		const result = await gateway.queryMixedOrder(
			{
				orderId: order.medicalOrderId,
				mixTradeNo: order.wechatMixTradeNo,
				expectedOutTradeNo: order.wechatOutTradeNo,
				expectedPayOrdId: order.payOrdId,
				expectedTotalFen: order.amounts.totalFen,
				expectedCashFen: breakdown.wechatCashFen,
			},
			context,
		);
		const hasCompleteComponentEvidence =
			result.fundFen !== undefined &&
			result.personalAccountFen !== undefined &&
			result.otherPaymentFen !== undefined &&
			result.medicalCashFen !== undefined &&
			result.cashReduceDetails !== undefined;
		if (
			(this.dependencies.postPayment && !hasCompleteComponentEvidence) ||
			(hasCompleteComponentEvidence &&
				(result.fundFen !== order.amounts.fundFen ||
					result.personalAccountFen !== order.amounts.personalAccountFen ||
					result.otherPaymentFen !== (order.amounts.otherPaymentFen ?? 0) ||
					result.medicalCashFen !== order.amounts.cashFen ||
					JSON.stringify(result.cashReduceDetails ?? []) !==
						JSON.stringify(breakdown.cashReduceDetails)))
		) {
			throw new Error("medical-insurance-wechat-component-amount-mismatch");
		}
		const fullyPaid =
			result.mixState === "paid" &&
			result.cashState === "paid" &&
			result.insuranceState === "paid";
		const providerFailed =
			result.mixState === "failed" ||
			result.cashState === "failed" ||
			result.insuranceState === "failed";
		const paymentState = fullyPaid
			? "cash_paid"
			: providerFailed
				? "failed"
				: result.cashState === "paid"
					? "unknown"
					: hasUsableWechatPrepay(order, now)
						? "prepay_ready"
						: "unknown";
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: providerFailed ? "manual_review" : order.status,
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				wechatPaymentState: paymentState,
				medInsFailReason:
					result.medInsPayStatus === "MED_INS_PAY_FAIL"
						? (result.medInsFailReason ?? null)
						: null,
			},
		);
		if (!updated) throw new Error("medical order version conflict");
		let hisCompleted = false;
		let hisWritebackBlocked = false;
		if (fullyPaid) {
			if (
				this.dependencies.postPayment &&
				settlementBeforeQuery?.insuredAreaCode &&
				settlementBeforeQuery.businessCode &&
				settlementBeforeQuery.postPaymentComponents?.length
			) {
				hisCompleted = await this.completePrePaymentComponents(
					updated,
					result,
					now,
					context,
				);
			} else if (
				settlementBeforeQuery?.plugin?.paymentOrderId &&
				this.dependencies.completeWechatPayment
			) {
				// 仅兼容发布前已经创建过旧 plugin 流水的存量订单。
				hisCompleted = await this.dependencies.completeWechatPayment(
					{
						ownerUserId: order.ownerUserId,
						medicalOrderId: order.medicalOrderId,
						paymentOrderId: settlementBeforeQuery.plugin.paymentOrderId,
					},
					context,
				);
			} else if (
				settlementBeforeQuery?.payingId &&
				settlementBeforeQuery.tradingId
			) {
				// 兼容本次发布前已经完成前置 .2、但尚未完成微信查单的纯医保单。
				const completion = await this.dependencies.medicalInsurance.query(
					{
						orderId: order.medicalOrderId,
						ownerUserId: order.ownerUserId,
						cashPaymentConfirmed: true,
					},
					context,
				);
				if (
					completion.state === "insurance_settled" &&
					completion.finality === "paid" &&
					completion.authoritative &&
					sameAmounts(updated, completion)
				) {
					const completed = await this.dependencies.orders.applySettlement(
						updated.medicalOrderId,
						updated.version,
						{
							status: "insurance_settled",
							// ord_stas 是 VARCHAR(8)，保留 6301 的短状态快照；
							// 后置接口的完整结果已在加密结算上下文中保存。
							ordStas: updated.ordStas,
							amounts: updated.amounts,
							setlType: updated.setlType,
							revsTokenHash: updated.revsTokenHash,
							revsTokenExpiresAt: updated.revsTokenExpiresAt,
							wechatPaymentState: "cash_paid",
						},
					);
					if (!completed) throw new Error("medical order version conflict");
					hisCompleted = true;
				}
			} else {
				throw new Error("medical-insurance-post-payment-not-configured");
			}
			const settlementAfterCompletion =
				await this.dependencies.orders.getSettlementContext(
					order.ownerUserId,
					order.medicalOrderId,
				);
			const writebackStatus =
				settlementAfterCompletion?.settlementWriteback?.status;
			const selfPayWritebackStatus =
				settlementAfterCompletion?.selfPaySettlementWriteback?.status;
			const completionStatus =
				settlementAfterCompletion?.settlementCompletion?.status;
			const selfPayCompletionStatus =
				settlementAfterCompletion?.selfPaySettlementCompletion?.status;
			const selfPayThirdPartyStatus =
				settlementAfterCompletion?.selfPayThirdPartyWriteback?.status;
			const selfPayPaymentNotifyStatus =
				settlementAfterCompletion?.selfPayPaymentNotify?.status;
			// `.32` 和 `.5` 都是不可重放的 HIS 写入；任一已经失败或结果未知，
			// 后续查单只能进入人工核验，不能再次向 Provider 发起请求。
			hisWritebackBlocked =
				writebackStatus === "failed" ||
				writebackStatus === "unknown" ||
				selfPayWritebackStatus === "failed" ||
				selfPayWritebackStatus === "unknown" ||
				selfPayThirdPartyStatus === "failed" ||
				selfPayThirdPartyStatus === "unknown" ||
				selfPayPaymentNotifyStatus === "failed" ||
				selfPayPaymentNotifyStatus === "unknown" ||
				completionStatus === "failed" ||
				completionStatus === "unknown" ||
				selfPayCompletionStatus === "failed" ||
				selfPayCompletionStatus === "unknown";
		}
		const writebackManualReview =
			fullyPaid && !hisCompleted && hisWritebackBlocked;
		const continueQuery =
			(!fullyPaid && !providerFailed) ||
			(fullyPaid && !hisCompleted && !hisWritebackBlocked);
		const updatedTask = await this.updateTask(task, now, {
			continueQuery,
			manualReview: providerFailed || writebackManualReview,
			...(providerFailed
				? { lastErrorCode: "wechat-mixed-payment-failed" }
				: writebackManualReview
					? { lastErrorCode: "wechat-mixed-his-writeback-failed" }
					: fullyPaid && hisCompleted
						? {}
						: fullyPaid
							? { lastErrorCode: "wechat-mixed-his-writeback-pending" }
							: { lastErrorCode: "wechat-mixed-payment-pending" }),
		});
		if (updatedTask.status === "manual_review" && !providerFailed) {
			await this.dependencies.orders.applySettlement(
				updated.medicalOrderId,
				updated.version,
				{
					status: "manual_review",
					ordStas: updated.ordStas,
					amounts: updated.amounts,
					setlType: updated.setlType,
					revsTokenHash: updated.revsTokenHash,
					revsTokenExpiresAt: updated.revsTokenExpiresAt,
					wechatPaymentState: updated.wechatPaymentState,
				},
			);
		}
		this.logger[providerFailed || writebackManualReview ? "error" : "info"](
			{
				event:
					providerFailed || writebackManualReview
						? "worker.payment.medical_wechat_query.manual_review_required"
						: fullyPaid && hisCompleted
							? "worker.payment.medical_wechat_query.confirmed"
							: "worker.payment.medical_wechat_query.retry_scheduled",
				taskId: task.taskId,
				orderId: order.medicalOrderId,
				queryAttempts: updatedTask.attempts,
				providerRequestId: result.trace.requestId,
				providerStatus: result.providerStatus,
				mixState: result.mixState,
				cashState: result.cashState,
				insuranceState: result.insuranceState,
				medInsPayStatus: result.medInsPayStatus,
				...(result.medInsFailReason
					? { medInsFailReason: result.medInsFailReason }
					: {}),
			},
			"Medical insurance WeChat mixed order reconciled",
		);
		return providerFailed || writebackManualReview
			? "manual_review"
			: fullyPaid && hisCompleted
				? "reconciled"
				: updatedTask.status === "manual_review"
					? "manual_review"
					: "retry_scheduled";
	}

	async runOnce(
		now = new Date(),
	): Promise<MedicalInsuranceOrderReconciliationWorkerResult> {
		const due = await this.dependencies.tasks.claimDueForQuery(
			now,
			QUERY_BATCH_SIZE,
			QUERY_CLAIM_LEASE_MS,
		);
		const task = due[0];
		if (!task) return "idle";

		const context: AdapterCallContext = {
			traceId: `medical-order-query:${task.taskId}:${task.attempts + 1}`,
			idempotencyKey: `medical-order-query:${task.taskId}`,
		};

		try {
			const order = await this.dependencies.orders.findByMedicalOrderId(
				task.medicalOrderId,
			);
			if (!order) {
				await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "medical-order-not-found",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						reason: "medical-order-not-found",
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (order.status === "manual_review") {
				const updatedTask = await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "order-already-manual-review",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						reason: updatedTask.lastErrorCode,
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (order.status === "cash_pending" && order.wechatMixTradeNo) {
				return await this.reconcileWechatMixedOrder(task, order, now, context);
			}
			if (
				order.status === "cash_pending" &&
				!order.wechatMixTradeNo &&
				order.wechatOutTradeNo
			) {
				const paymentSettlement =
					await this.dependencies.orders.getSettlementContext(
						order.ownerUserId,
						order.medicalOrderId,
					);
				if (paymentSettlement?.postPaymentPlanVersion === "sequenced-v1") {
					// 新计划的 out_trade_no 属于官方医保混合订单恢复键。即使普通
					// 微信 gateway 同时存在，也绝不能把它送入 JSAPI 单独查单。
					return await this.recoverWechatMixedOrder(task, order, now, context);
				}
				if (this.dependencies.wechatCashPayment) {
					return await this.reconcileOwnWechatOrder(task, order, now, context);
				}
				if (order.wechatPaymentState === "unknown") {
					return await this.recoverWechatMixedOrder(task, order, now, context);
				}
			}
			if (order.status === "cash_pending") {
				await this.updateTask(task, now, {
					continueQuery: false,
					lastErrorCode: "wechat-medical-order-not-created",
				});
				this.logger.info(
					{
						event:
							"worker.payment.medical_order_query.waiting_for_wechat_order",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
					},
					"Medical insurance order is waiting for the user to create the official WeChat medical order",
				);
				return "reconciled";
			}
			if (order.status === "insurance_settled" || order.status === "failed") {
				await this.updateTask(task, now, {
					continueQuery: false,
					lastErrorCode: `order-already-${order.status}`,
				});
				this.logger.info(
					{
						event:
							"worker.payment.medical_order_query.completed_terminal_order",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						status: order.status,
					},
					"Medical insurance query task closed for terminal order",
				);
				return "reconciled";
			}
			if (!order.amounts) {
				await this.updateTask(task, now, {
					continueQuery: false,
					manualReview: true,
					lastErrorCode: "medical-order-amounts-missing",
				});
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						reason: "medical-order-amounts-missing",
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}

			const evidence = await this.dependencies.medicalInsurance.query(
				{ orderId: order.medicalOrderId, ownerUserId: order.ownerUserId },
				context,
			);
			const amountsMatch = sameAmounts(order, evidence);
			const nonTerminal = isNonTerminalEvidence(evidence.finality);
			const requestedState = safeNextState(
				order,
				amountsMatch ? candidateState(evidence) : "awaiting_confirmation",
			);
			const transitionNeedsReview = requestedState === "manual_review";
			if (requestedState !== order.status) {
				const updated = await this.dependencies.orders.applySettlement(
					order.medicalOrderId,
					order.version,
					{
						status: requestedState,
						ordStas: evidence.providerStatus,
						amounts: order.amounts,
						setlType: order.amounts.cashFen > 0 ? "CASH" : "ALL",
						revsTokenHash: order.revsTokenHash,
						revsTokenExpiresAt: order.revsTokenExpiresAt,
					},
				);
				if (!updated) throw new Error("medical order version conflict");
			}

			const needsManualReview =
				transitionNeedsReview || (!nonTerminal && !amountsMatch);
			const taskOptions: Parameters<typeof taskAfterQuery>[2] = {
				continueQuery: nonTerminal && !transitionNeedsReview,
				manualReview: needsManualReview,
			};
			const lastErrorCode = nonTerminal
				? "provider-pending"
				: !amountsMatch
					? "evidence-amount-mismatch"
					: transitionNeedsReview
						? "invalid-order-transition"
						: undefined;
			if (lastErrorCode) taskOptions.lastErrorCode = lastErrorCode;
			if (!nonTerminal) taskOptions.terminalOrdStas = evidence.providerStatus;
			const updatedTask = await this.updateTask(task, now, taskOptions);

			if (updatedTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						providerStatus: evidence.providerStatus,
						reason: updatedTask.lastErrorCode,
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			if (nonTerminal) {
				this.logger.info(
					{
						event: "worker.payment.medical_order_query.retry_scheduled",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: updatedTask.attempts,
						providerRequestId: evidence.trace.requestId,
						providerStatus: evidence.providerStatus,
					},
					"Medical insurance order query will be retried",
				);
				return "retry_scheduled";
			}
			this.logger.info(
				{
					event: "worker.payment.medical_order_query.reconciled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: updatedTask.attempts,
					providerRequestId: evidence.trace.requestId,
					providerStatus: evidence.providerStatus,
				},
				"Medical insurance order query reconciled",
			);
			return "reconciled";
		} catch (error) {
			const failureCode = reconciliationFailureCode(error);
			const retryTask = taskAfterQuery(task, now, {
				continueQuery: true,
				lastErrorCode: "provider-query-failed",
			});
			await this.dependencies.tasks
				.update(retryTask, task.version)
				.catch(() => undefined);
			if (retryTask.status === "manual_review") {
				this.logger.error(
					{
						event: "worker.payment.medical_order_query.manual_review_required",
						taskId: task.taskId,
						orderId: task.medicalOrderId,
						queryAttempts: retryTask.attempts,
						maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
						reason: "provider-query-failed",
						errorName: error instanceof Error ? error.name : "UnknownError",
						...(error instanceof Error && error.message
							? { errorMessage: error.message }
							: {}),
						...(failureCode ? { failureCode } : {}),
						...providerFailureMetadata(error),
					},
					"Medical insurance order query requires manual review",
				);
				return "manual_review";
			}
			this.logger.warn(
				{
					event: "worker.payment.medical_order_query.retry_scheduled",
					taskId: task.taskId,
					orderId: task.medicalOrderId,
					queryAttempts: retryTask.attempts,
					errorName: error instanceof Error ? error.name : "UnknownError",
					...(error instanceof Error && error.message
						? { errorMessage: error.message }
						: {}),
					...(failureCode ? { failureCode } : {}),
					...providerFailureMetadata(error),
				},
				"Medical insurance order query will be retried",
			);
			return "retry_scheduled";
		}
	}
}
