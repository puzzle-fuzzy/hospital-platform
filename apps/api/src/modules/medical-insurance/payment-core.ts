import type { MedicalInsuranceOrderPayload } from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
	type AdapterCallContext,
	assertValidMedicalInsuranceAmounts,
	type MedicalInsuranceGateway,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	type MedicalInsuranceSettlementEvidenceFinality,
	normalizeAdapterCallContext,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";

function contextOf(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new MedicalInsuranceRegistrationInputError(
			"Medical insurance context is invalid",
		);
	return context;
}

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	return value;
}

function output(
	order: MedicalInsuranceOrder,
): MedicalInsuranceOrderPayload["data"] {
	return {
		orderId: order.medicalOrderId,
		status: order.status,
		...(order.amounts
			? {
					amounts: {
						totalFen: order.amounts.totalFen,
						insuranceFen:
							order.amounts.personalAccountFen + order.amounts.fundFen,
						cashFen: order.amounts.cashFen,
					},
				}
			: {}),
	};
}

function needsMedicalInsuranceQuery(
	finality: MedicalInsuranceSettlementEvidenceFinality,
): boolean {
	return (
		finality === "processing" ||
		finality === "settlement_candidate" ||
		finality === "unknown"
	);
}

function logBusiness(order: MedicalInsuranceOrder): Record<string, unknown> {
	const businessType =
		order.businessType ?? (order.appointmentId ? "registration" : undefined);
	const orderType =
		order.orderType ?? (businessType === "registration" ? "RegPay" : undefined);
	return {
		...(businessType ? { businessType } : {}),
		...(orderType ? { orderType } : {}),
		...((order.businessId ?? order.appointmentId)
			? { businessId: order.businessId ?? order.appointmentId }
			: {}),
	};
}

function businessPatch(order: MedicalInsuranceOrder) {
	return {
		...(order.businessType ? { businessType: order.businessType } : {}),
		...(order.orderType ? { orderType: order.orderType } : {}),
		...((order.businessId ?? order.appointmentId)
			? { businessId: order.businessId ?? order.appointmentId }
			: {}),
	};
}

export type MedicalInsurancePaymentCoreDependencies = {
	orders: MedicalInsuranceOrderRepository;
	medicalInsurance: MedicalInsuranceGateway;
	/** 6202 非终态必须持久化为查单任务，不能只依赖进程内重试。 */
	queryTasks?: MedicalInsuranceQueryTaskRepository;
	logger?: AppLogger;
	now?: () => Date;
};

/**
 * 挂号和门诊共享的医保支付核心。
 *
 * 这里不读取预约或门诊页面字段，只处理两类业务都必需的事实：订单归属、
 * 6202/6301 结果归一化、金额校验、CAS 状态更新、非终态查单入队，以及
 * 微信现金完成后的服务端确认。业务入口负责把真实 6201 费用上下文交给
 * adapter；这条边界避免门诊为复用状态机而伪造 appointment。
 */
export class MedicalInsurancePaymentCore {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: MedicalInsurancePaymentCoreDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	private async order(ownerUserId: string, orderId: string) {
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId)
			throw new MedicalInsuranceOrderNotFoundError();
		return order;
	}

	private async enqueueQueryTask(orderId: string): Promise<void> {
		if (!this.dependencies.queryTasks) return;
		const timestamp = this.now().toISOString();
		await this.dependencies.queryTasks.insert({
			// 订单 ID 本身是有界 opaque 标识；复用它保持 taskId 稳定，
			// 同一订单重试不会生成多个并发查单任务。
			taskId: orderId,
			medicalOrderId: orderId,
			status: "pending",
			version: 1,
			attempts: 0,
			maxAttempts: MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
			nextAttemptAt: timestamp,
			claimedUntil: null,
			terminalOrdStas: null,
			lastErrorCode: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	}

	async settle(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.order(ownerUserId, orderId);
		if (!order.authorizationId || !order.feeUploadId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance fee upload is required",
			);
		if (order.status === "awaiting_confirmation") {
			// 6202 已有事实但任务写入可能因网络故障丢失；重试只补同一 taskId，
			// 绝不能再次调用 6202 造成重复结算。
			await this.enqueueQueryTask(order.medicalOrderId);
			return output(order);
		}
		if (
			order.status === "insurance_settled" ||
			order.status === "cash_pending" ||
			order.status === "failed"
		)
			return output(order);
		this.logger.info(
			{
				event: "medical-insurance.settlement.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				...logBusiness(order),
			},
			"Medical insurance settlement requested",
		);
		const result = await this.dependencies.medicalInsurance.settle(
			{
				orderId,
				ownerUserId,
				authorizationId: order.authorizationId,
				feeUploadId: order.feeUploadId,
				mdtrtId: order.mdtrtId ?? "",
				acctUsedFlag: order.acctUsedFlag ?? "",
			},
			context,
		);
		const amounts = assertValidMedicalInsuranceAmounts(result.amounts);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: result.state,
				ordStas: result.providerStatus,
				amounts,
				setlType: amounts.cashFen > 0 ? "CASH" : "ALL",
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				...businessPatch(order),
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		if (needsMedicalInsuranceQuery(result.finality))
			await this.enqueueQueryTask(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.settlement.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				...logBusiness(order),
				state: result.state,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance settlement completed",
		);
		return output(updated);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
		cashPaymentConfirmed?: boolean;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.order(ownerUserId, orderId);
		const result = await this.dependencies.medicalInsurance.query(
			{
				orderId,
				ownerUserId,
				...(input.cashPaymentConfirmed ? { cashPaymentConfirmed: true } : {}),
			},
			context,
		);
		const amounts = assertValidMedicalInsuranceAmounts({
			totalFen: result.amounts.totalFen,
			cashFen: result.amounts.cashFen,
			personalAccountFen:
				order.amounts?.personalAccountFen ?? result.amounts.insuranceFen,
			fundFen: order.amounts?.fundFen ?? 0,
		});
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: result.state,
				ordStas: result.providerStatus,
				amounts,
				setlType: amounts.cashFen > 0 ? "CASH" : "ALL",
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				...businessPatch(order),
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		if (needsMedicalInsuranceQuery(result.finality))
			await this.enqueueQueryTask(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.settlement.queried",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				...logBusiness(order),
				state: result.state,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance settlement queried",
		);
		return output(updated);
	}

	/**
	 * 微信客户端 success 只代表调起成功；这里强制进入统一 6301 查单，
	 * 由服务端证据推进医保订单终态，挂号和门诊使用完全相同的规则。
	 */
	async confirmWechatCashPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: unknown;
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.order(ownerUserId, orderId);
		if (order.wechatPaymentState !== "cash_paid") return output(order);
		return this.query({
			ownerUserId,
			orderId,
			context: input.context,
			cashPaymentConfirmed: true,
		});
	}
}
