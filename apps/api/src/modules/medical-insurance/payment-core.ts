import type {
	MedicalInsuranceCancellationPayload,
	MedicalInsuranceOrderPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	assertValidMedicalInsuranceAmounts,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS,
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
import {
	loadMedicalInsurancePaymentPresentation,
	type MedicalInsurancePaymentPresentation,
} from "./payment-presentation";

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
	presentation: MedicalInsurancePaymentPresentation = {},
): MedicalInsuranceOrderPayload["data"] {
	return {
		orderId: order.medicalOrderId,
		status: order.status,
		...(order.amounts
			? {
					amounts: {
						totalFen: order.amounts.totalFen,
						insuranceFen:
							order.amounts.personalAccountFen +
							order.amounts.fundFen +
							(order.amounts.otherPaymentFen ?? 0),
						cashFen: order.amounts.cashFen,
						...presentation,
					},
				}
			: {}),
	};
}

function cancellationOutput(
	orderId: string,
	result: {
		state: "cancelled" | "awaiting_confirmation" | "manual_review";
		paymentState: "not_created" | "processing" | "closed" | "paid" | "unknown";
		settlementState: "not_created" | "cancelled" | "unknown";
	},
): MedicalInsuranceCancellationPayload["data"] {
	return {
		orderId,
		status: result.state,
		paymentState: result.paymentState,
		settlementState: result.settlementState,
		restartAllowed: result.state === "cancelled",
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

/**
 * 这些状态已经是服务端可供结果页展示的最终事实。
 * 结果页查单不能为了刷新金额再次访问医保上游，否则上游短暂超时会
 * 把已经落库的 6202/6301 金额变成“查询失败”，导致前端费用明细空白。
 */
function isTerminalMedicalOrderStatus(
	status: MedicalInsuranceOrder["status"],
): boolean {
	return (
		status === "insurance_settled" ||
		status === "failed" ||
		status === "manual_review" ||
		status === "cancelled"
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
 * 6202 结果归一化、金额校验、CAS 状态更新、非终态后置任务入队，以及
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

	private async output(
		order: MedicalInsuranceOrder,
	): Promise<MedicalInsuranceOrderPayload["data"]> {
		return output(
			order,
			await loadMedicalInsurancePaymentPresentation(
				order,
				this.dependencies.orders,
			),
		);
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
		if (
			order.status === "order_placed" ||
			order.status === "awaiting_confirmation"
		) {
			// awaiting_confirmation 也可能是 6202 发出前已持久化的未知门禁；
			// 无论上次是否收到回包，重试都只补同一 taskId，绝不能再次调用
			// 6202 造成重复结算。
			await this.enqueueQueryTask(order.medicalOrderId);
			return this.output(order);
		}
		if (
			order.status === "insurance_settled" ||
			order.status === "cash_pending" ||
			order.status === "failed" ||
			order.status === "manual_review" ||
			order.status === "cancelled"
		)
			return this.output(order);
		if (!order.authorizationId || !order.feeUploadId)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance fee upload is required",
			);
		// 6202 的 orgBizSer 要求每次上游请求唯一，不能依赖客户端幂等键安全
		// 重放。必须先用订单 CAS 持久化“结果待确认”门禁，再发出 6202；这样
		// 即使进程在发送后、回包落库前退出，下一次请求也只会走 6301 查单。
		const claimed = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: "awaiting_confirmation",
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				...businessPatch(order),
			},
		);
		if (!claimed) {
			const latest = await this.order(ownerUserId, orderId);
			if (
				latest.status === "order_placed" ||
				latest.status === "awaiting_confirmation"
			) {
				await this.enqueueQueryTask(latest.medicalOrderId);
				return this.output(latest);
			}
			if (latest.status !== "fee_uploaded") return this.output(latest);
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		// 查单任务也必须先于外部写入持久化；否则用户退出且 API 进程恰好在
		// 6202 发送后崩溃时，既没有回包状态，也没有后台任务能够主动收敛。
		await this.enqueueQueryTask(claimed.medicalOrderId);
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
		let result: Awaited<ReturnType<MedicalInsuranceGateway["settle"]>>;
		try {
			result = await this.dependencies.medicalInsurance.settle(
				{
					orderId,
					ownerUserId,
					authorizationId: order.authorizationId,
					feeUploadId: order.feeUploadId,
					mdtrtId: claimed.mdtrtId ?? "",
					acctUsedFlag: claimed.acctUsedFlag ?? "",
				},
				context,
			);
		} catch (error) {
			// 请求抛错并不能证明 6202 没有到达医保中心。订单已在调用前进入
			// awaiting_confirmation，保留同一查单任务和原始异常给调用方。
			await this.enqueueQueryTask(claimed.medicalOrderId);
			throw error;
		}
		const amounts = assertValidMedicalInsuranceAmounts(result.amounts);
		const updated = await this.dependencies.orders.applySettlement(
			claimed.medicalOrderId,
			claimed.version,
			{
				status: result.state,
				ordStas: result.providerStatus,
				amounts,
				setlType: amounts.cashFen > 0 ? "CASH" : "ALL",
				revsTokenHash: null,
				revsTokenExpiresAt: null,
				...businessPatch(claimed),
			},
		);
		if (!updated) {
			// 6302/6301 可能先于 6202 HTTP 回包完成并更新同一订单。此时以最新
			// 服务端事实为准，不能把一次 CAS 竞争误报成可重新提交 6202。
			const latest = await this.order(ownerUserId, orderId);
			if (needsMedicalInsuranceQuery(result.finality))
				await this.enqueueQueryTask(latest.medicalOrderId);
			return this.output(latest);
		}
		if (needsMedicalInsuranceQuery(result.finality))
			await this.enqueueQueryTask(claimed.medicalOrderId);
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
		return this.output(updated);
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
		if (isTerminalMedicalOrderStatus(order.status)) {
			return this.output(order);
		}
		if (!order.amounts) {
			// 6202 回包落库前中断时，6301 的公共证据只有医保合计，无法还原
			// 基金/个账等 6202 分项。禁止把合计全部猜成个人账户后写回；保留
			// awaiting_confirmation，由 Worker 在短暂等待后转人工核对原报文。
			return this.output(order);
		}
		const result = await this.dependencies.medicalInsurance.query(
			{
				orderId,
				ownerUserId,
				...(input.cashPaymentConfirmed ? { cashPaymentConfirmed: true } : {}),
			},
			context,
		);
		const amounts = assertValidMedicalInsuranceAmounts({
			// 后置 .32 的公共 PaymentAmounts 只保留总额/现金/医保合计；6202 已经
			// 确认的医院负担、个账细分等事实必须从订单原样带过，不能在后置
			// 时重建成 0，否则后续高平优惠分项会被错误判成未映射。
			...order.amounts,
			totalFen: result.amounts.totalFen,
			cashFen: result.amounts.cashFen,
			personalAccountFen: order.amounts.personalAccountFen,
			fundFen: order.amounts.fundFen,
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
		return this.output(updated);
	}

	/**
	 * 取消医保支付订单的分支。支付中恢复保留安全关单；重新展码不检查
	 * 重复/旧订单，直接由上层创建新的医保订单。
	 */
	async cancel(input: {
		ownerUserId: string;
		orderId: string;
		reason: "payment_in_progress" | "reauthorization";
		context: unknown;
	}): Promise<MedicalInsuranceCancellationPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const order = await this.order(ownerUserId, orderId);
		if (order.status === "cancelled") {
			this.logger.info(
				{
					event: "medical-insurance.cancellation.already-completed",
					traceId: context.traceId,
					ownerUserId,
					orderId,
					...logBusiness(order),
				},
				"Medical insurance cancellation already completed",
			);
			return cancellationOutput(orderId, {
				state: "cancelled",
				paymentState: "unknown",
				settlementState: "cancelled",
			});
		}
		if (
			order.status === "insurance_settled" ||
			(order.status === "cash_pending" &&
				order.wechatPaymentState === "cash_paid")
		)
			throw new MedicalInsuranceRegistrationInputError(
				"已完成的医保支付不能走支付中关单分支",
			);
		// 仅完成授权、尚未创建 2.6.65.1 结算主单时，可以直接作废本地订单。
		// 如果 pre_6201 上下文已经存在，说明上游结算主单已经创建，即使 6201
		// 尚未完成也必须继续走 Provider 取消，不能只清理本地状态。
		const canCancelLocallyBeforeFeeUpload =
			!order.feeUploadId &&
			!order.payOrdId &&
			(order.status === "created" || order.status === "failed");
		const preFeeSettlementContext = canCancelLocallyBeforeFeeUpload
			? await this.dependencies.orders.getSettlementContext(
					ownerUserId,
					orderId,
				)
			: undefined;
		if (canCancelLocallyBeforeFeeUpload && !preFeeSettlementContext) {
			const updated = await this.dependencies.orders.applySettlement(
				order.medicalOrderId,
				order.version,
				{
					status: "cancelled",
					ordStas: order.ordStas,
					amounts: order.amounts,
					setlType: order.setlType,
					revsTokenHash: order.revsTokenHash,
					revsTokenExpiresAt: order.revsTokenExpiresAt,
					...businessPatch(order),
				},
			);
			if (!updated)
				throw new DependencyNotConfiguredError("medical-insurance-orders");
			return cancellationOutput(orderId, {
				state: "cancelled",
				paymentState: "not_created",
				settlementState: "not_created",
			});
		}
		this.logger.info(
			{
				event: "medical-insurance.cancellation.requested",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				...logBusiness(order),
				reason: input.reason,
			},
			"Medical insurance cancellation requested",
		);
		const result = await this.dependencies.medicalInsurance.cancel(
			{ orderId, ownerUserId, reason: input.reason },
			context,
		);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: result.state,
				// ord_stas 只保存 6202/6301/6302 的短状态快照（数据库 VARCHAR(8)）。
				// 关单诊断可能是长文本，保留在响应和结构化日志中，不能写入该列。
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				...businessPatch(order),
			},
		);
		if (!updated)
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		this.logger.info(
			{
				event: "medical-insurance.cancellation.completed",
				traceId: context.traceId,
				ownerUserId,
				orderId,
				...logBusiness(order),
				state: result.state,
				paymentState: result.paymentState,
				settlementState: result.settlementState,
				providerStatus: result.providerStatus,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance cancellation completed",
		);
		return cancellationOutput(orderId, result);
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
		if (order.wechatPaymentState !== "cash_paid") return this.output(order);
		return this.query({
			ownerUserId,
			orderId,
			context: input.context,
			cashPaymentConfirmed: true,
		});
	}
}
