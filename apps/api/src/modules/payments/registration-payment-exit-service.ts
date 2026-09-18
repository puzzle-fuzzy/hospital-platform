import {
	type AdapterCallContext,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrderRepository,
	normalizeAdapterCallContext,
	type PaymentOrder,
	type PaymentOrderService,
	type RegistrationSelfPayRefundNotificationGateway,
	type RegistrationSelfPaySettlementContext,
	type WechatRefund,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentWriteService } from "../appointments/write-service";
import type { MedicalInsuranceRegistrationService } from "../medical-insurance/registration-service";
import type { MedicalInsuranceWechatPaymentService } from "../medical-insurance/wechat-payment-service";
import { registrationSelfPayOrderKey } from "./registration-self-pay-service";
import type { WechatPrepayService } from "./service";

export type RegistrationPaymentExitMode =
	| "medical"
	| "mixed"
	| "self"
	/** 预约详情取消使用；由服务端按实际关联订单自动判断支付路线。 */
	| "auto";

export class RegistrationPaymentExitInputError extends Error {
	constructor(message = "Registration payment exit input is invalid") {
		super(message);
		this.name = "RegistrationPaymentExitInputError";
	}
}

/** 已支付挂号退款的内部端口；患者端不会持有管理端令牌。 */
type RegistrationSelfPayRefundService = {
	requestTrustedPaymentOrder(
		input: {
			orderId: string;
			outTradeNo: string;
			refundFen: number;
			idempotencyKey: string;
			reason?: string;
		},
		context: AdapterCallContext,
	): Promise<WechatRefund>;
	query(
		merchantRefundNo: string,
		context: AdapterCallContext,
	): Promise<WechatRefund>;
};

export class RegistrationPaymentExitRefundPendingError extends Error {
	constructor() {
		super("Registration self-pay refund is pending");
		this.name = "RegistrationPaymentExitRefundPendingError";
	}
}

export class RegistrationPaymentExitRefundFailedError extends Error {
	constructor() {
		super("Registration self-pay refund did not complete");
		this.name = "RegistrationPaymentExitRefundFailedError";
	}
}

export class RegistrationPaymentExitRefundNotConfiguredError extends Error {
	constructor() {
		super("Registration self-pay refund is not configured");
		this.name = "RegistrationPaymentExitRefundNotConfiguredError";
	}
}

/** 已支付的旧订单缺少 Provider 生成的微信商户单号，不能猜测退款目标。 */
export class RegistrationPaymentExitRefundContextError extends Error {
	constructor() {
		super("Registration self-pay refund context is unavailable");
		this.name = "RegistrationPaymentExitRefundContextError";
	}
}

/** 微信退款成功但医院 .15 回写尚未确认；预约必须继续保留。 */
export class RegistrationPaymentExitRefundSyncPendingError extends Error {
	constructor() {
		super("Registration self-pay refund write-back is pending");
		this.name = "RegistrationPaymentExitRefundSyncPendingError";
	}
}

function contextOf(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new RegistrationPaymentExitInputError(
			"Registration payment exit context is invalid",
		);
	return context;
}

function id(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new RegistrationPaymentExitInputError(`${label} is invalid`);
	return value;
}

/** 同一预约只能持有一笔全额微信退款，重试必须复用同一退款单。 */
function registrationSelfPayRefundKey(appointmentId: string): string {
	return `registration-self-pay-refund:${appointmentId}`;
}

/**
 * 挂号支付退出是一个服务端编排命令，而不是“客户端连续调用两个接口”。
 * 先把医保/微信支付订单收敛到不可支付状态，再取消预约，才能释放号源；
 * 任一 provider 结果未知时命令直接失败，保留预约和 pending 上下文等待补偿。
 */
export class RegistrationPaymentExitService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: {
			appointments: AppointmentWriteService;
			medicalInsurance: MedicalInsuranceRegistrationService;
			medicalInsuranceWechatPayment: MedicalInsuranceWechatPaymentService;
			medicalInsuranceOrders: MedicalInsuranceOrderRepository;
			paymentOrders: PaymentOrderService;
			wechatPrepay: WechatPrepayService;
			/** 仅已完成的普通微信挂号自费单使用；未配置时保持 fail-closed。 */
			selfPayRefund?: RegistrationSelfPayRefundService;
			/** 新 MD5 自费退款成功后必须先走众阳 .15 回写。 */
			selfPayRefundNotification?: RegistrationSelfPayRefundNotificationGateway;
			resolveRegistrationContext?: (input: {
				ownerUserId: string;
				appointmentId: string;
				orderId: string;
			}) => Promise<RegistrationSelfPaySettlementContext | undefined>;
			saveRegistrationContext?: (input: {
				ownerUserId: string;
				orderId: string;
				registrationContext: RegistrationSelfPaySettlementContext;
			}) => Promise<void>;
			logger?: AppLogger;
			now?: () => Date;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	/** 微信建议退款查询至少间隔一分钟，避免用户连点放大查单流量。 */
	private mayQueryRefund(updatedAt: string): boolean {
		const updatedAtMs = Date.parse(updatedAt);
		return (
			Number.isFinite(updatedAtMs) &&
			this.now().getTime() - updatedAtMs >= 60_000
		);
	}

	private async resolveSelfPayRefundContext(input: {
		ownerUserId: string;
		appointmentId: string;
		orderId: string;
	}): Promise<RegistrationSelfPaySettlementContext | undefined> {
		return this.dependencies.resolveRegistrationContext?.(input);
	}

	private async syncYunhealthRefundWriteBack(input: {
		ownerUserId: string;
		appointmentId: string;
		order: PaymentOrder;
		registrationContext: RegistrationSelfPaySettlementContext | undefined;
		refund: WechatRefund;
		context: AdapterCallContext;
	}): Promise<void> {
		const registrationContext = input.registrationContext;
		if (!registrationContext?.payParams) return;
		const notification = this.dependencies.selfPayRefundNotification;
		const saveContext = this.dependencies.saveRegistrationContext;
		if (!notification || !saveContext) {
			throw new RegistrationPaymentExitRefundNotConfiguredError();
		}
		const existing = registrationContext.refundWriteBack;
		if (existing) {
			if (
				existing.merchantRefundNo !== input.refund.merchantRefundNo ||
				existing.refundFen !== input.order.amounts.cashFen
			) {
				throw new RegistrationPaymentExitRefundContextError();
			}
			return;
		}
		try {
			const trace = await notification.notifyRefund(
				{
					orderId: input.order.orderId,
					merchantRefundNo: input.refund.merchantRefundNo,
					refundFen: input.order.amounts.cashFen,
					registrationContext,
				},
				input.context,
			);
			await saveContext({
				ownerUserId: input.ownerUserId,
				orderId: input.order.orderId,
				registrationContext: {
					...registrationContext,
					refundWriteBack: {
						merchantRefundNo: input.refund.merchantRefundNo,
						refundFen: input.order.amounts.cashFen,
						syncedAt: this.now().toISOString(),
					},
				},
			});
			this.logger.info(
				{
					event: "appointment.self-payment.refund.write-back-confirmed",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
					provider: trace.provider,
					providerRequestId: trace.requestId,
				},
				"Registration self-pay refund write-back confirmed",
			);
		} catch (error) {
			this.logger.warn(
				{
					event: "appointment.self-payment.refund.write-back-pending",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
					errorName: error instanceof Error ? error.name : "UNKNOWN",
				},
				"Registration self-pay refund write-back is pending",
			);
			throw new RegistrationPaymentExitRefundSyncPendingError();
		}
	}

	private async refundCompletedSelfPay(input: {
		ownerUserId: string;
		appointmentId: string;
		order: PaymentOrder;
		context: AdapterCallContext;
	}): Promise<void> {
		const refundService = this.dependencies.selfPayRefund;
		if (!refundService)
			throw new RegistrationPaymentExitRefundNotConfiguredError();
		const registrationContext = await this.resolveSelfPayRefundContext({
			ownerUserId: input.ownerUserId,
			appointmentId: input.appointmentId,
			orderId: input.order.orderId,
		});
		let outTradeNo = input.order.orderId;
		if (registrationContext?.payParams) {
			if (
				registrationContext.outTradeNoSource !== "yunhealth_2_6_65_2" ||
				!registrationContext.outTradeNo
			) {
				throw new RegistrationPaymentExitRefundContextError();
			}
			if (
				!this.dependencies.selfPayRefundNotification ||
				!this.dependencies.saveRegistrationContext
			) {
				throw new RegistrationPaymentExitRefundNotConfiguredError();
			}
			outTradeNo = registrationContext.outTradeNo;
		}

		let refund: WechatRefund;
		try {
			refund = await refundService.requestTrustedPaymentOrder(
				{
					orderId: input.order.orderId,
					outTradeNo,
					refundFen: input.order.amounts.cashFen,
					idempotencyKey: registrationSelfPayRefundKey(input.appointmentId),
					reason: "挂号预约取消退款",
				},
				input.context,
			);
			if (
				(refund.status === "requested" || refund.status === "processing") &&
				this.mayQueryRefund(refund.updatedAt)
			) {
				refund = await refundService.query(
					refund.merchantRefundNo,
					input.context,
				);
			}
		} catch (error) {
			this.logger.warn(
				{
					event: "appointment.self-payment.refund.failed",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
					errorName: error instanceof Error ? error.name : "UNKNOWN",
				},
				"Registration self-pay refund did not complete",
			);
			throw new RegistrationPaymentExitRefundFailedError();
		}

		if (refund.status === "success") {
			await this.syncYunhealthRefundWriteBack({
				...input,
				registrationContext,
				refund,
			});
			this.logger.info(
				{
					event: "appointment.self-payment.refund.confirmed",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
				},
				"Registration self-pay refund confirmed before appointment cancellation",
			);
			return;
		}

		if (
			refund.status === "requested" ||
			refund.status === "processing" ||
			refund.status === "unknown"
		) {
			this.logger.info(
				{
					event: "appointment.self-payment.refund.pending",
					traceId: input.context.traceId,
					ownerUserId: input.ownerUserId,
					appointmentId: input.appointmentId,
					refundStatus: refund.status,
				},
				"Registration self-pay refund remains pending",
			);
			throw new RegistrationPaymentExitRefundPendingError();
		}

		this.logger.warn(
			{
				event: "appointment.self-payment.refund.failed",
				traceId: input.context.traceId,
				ownerUserId: input.ownerUserId,
				appointmentId: input.appointmentId,
				refundStatus: refund.status,
			},
			"Registration self-pay refund did not complete",
		);
		throw new RegistrationPaymentExitRefundFailedError();
	}

	async abandon(input: {
		ownerUserId: string;
		appointmentId: string;
		mode: RegistrationPaymentExitMode;
		context: unknown;
	}): Promise<{ appointmentId: string; status: "cancelled" }> {
		const context = contextOf(input.context);
		const ownerUserId = id(input.ownerUserId, "ownerUserId");
		const appointmentId = id(input.appointmentId, "appointmentId");
		if (
			input.mode !== "medical" &&
			input.mode !== "mixed" &&
			input.mode !== "self" &&
			input.mode !== "auto"
		)
			throw new RegistrationPaymentExitInputError("payment mode is invalid");
		let selfPayRefundConfirmed = false;

		// 先处理自费单，再处理医保单。异常数据同时存在两类订单时，
		// 不能先作废医保单，之后才发现自费单已经确认收款。
		const selfPayOrder =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				registrationSelfPayOrderKey(appointmentId),
			);
		if (
			selfPayOrder &&
			selfPayOrder.state !== "cancelled" &&
			selfPayOrder.state !== "failed"
		) {
			const cancellation = await this.dependencies.wechatPrepay.cancel({
				ownerUserId,
				orderId: selfPayOrder.orderId,
				context,
			});
			if (cancellation.status === "paid") {
				// 只有医院结算和平台订单均已完成时才允许走退款取消。现金已扣、
				// HIS 回写尚未完成的中间状态仍保持原来的 fail-closed 行为。
				if (selfPayOrder.state !== "completed")
					throw new RegistrationPaymentExitInputError(
						"已确认支付成功，不能作废当前预约",
					);
				await this.refundCompletedSelfPay({
					ownerUserId,
					appointmentId,
					order: selfPayOrder,
					context,
				});
				selfPayRefundConfirmed = true;
			}
		}

		const medicalOrder =
			await this.dependencies.medicalInsuranceOrders.findByOwnerAndAppointmentId(
				ownerUserId,
				appointmentId,
			);
		if (
			medicalOrder &&
			medicalOrder.status !== "cancelled" &&
			medicalOrder.status !== "failed"
		) {
			// 混合支付必须先确认微信现金部分没有已经支付。查询结果为 pending
			// 时，用户明确取消了收银台，随后由 2.6.65.6 收敛医保结算；查询异常
			// 则不继续取消预约。
			if (
				medicalOrder.wechatMixTradeNo &&
				medicalOrder.status === "cash_pending" &&
				(input.mode === "mixed" || input.mode === "auto")
			) {
				const payment =
					await this.dependencies.medicalInsuranceWechatPayment.query({
						ownerUserId,
						orderId: medicalOrder.medicalOrderId,
						context,
					});
				if (
					payment.paymentState === "cash_paid" ||
					payment.status === "insurance_settled"
				)
					throw new RegistrationPaymentExitInputError(
						"已确认支付成功，不能作废当前预约",
					);
			}
			const cancellation = await this.dependencies.medicalInsurance.cancel({
				ownerUserId,
				orderId: medicalOrder.medicalOrderId,
				reason: "payment_in_progress",
				context,
			});
			if (cancellation.status !== "cancelled")
				throw new RegistrationPaymentExitInputError("医保订单未能安全失效");
		}

		const result = selfPayRefundConfirmed
			? await this.dependencies.appointments.cancelAfterConfirmedSelfPayRefund({
					ownerUserId,
					appointmentId,
					context,
				})
			: await this.dependencies.appointments.cancel({
					ownerUserId,
					appointmentId,
					context,
				});
		this.logger.info(
			{
				event: "appointment.payment-exit.completed",
				traceId: context.traceId,
				ownerUserId,
				appointmentId,
				mode: input.mode,
			},
			"Registration payment exit cancelled the appointment",
		);
		return result;
	}
}
