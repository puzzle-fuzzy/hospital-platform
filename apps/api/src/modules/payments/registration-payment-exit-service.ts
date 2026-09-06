import {
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrderRepository,
	normalizeAdapterCallContext,
	type PaymentOrderService,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentWriteService } from "../appointments/write-service";
import type { MedicalInsuranceRegistrationService } from "../medical-insurance/registration-service";
import type { MedicalInsuranceWechatPaymentService } from "../medical-insurance/wechat-payment-service";
import { registrationSelfPayOrderKey } from "./registration-self-pay-service";
import type { WechatPrepayService } from "./service";

export type RegistrationPaymentExitMode = "medical" | "mixed" | "self";

export class RegistrationPaymentExitInputError extends Error {
	constructor(message = "Registration payment exit input is invalid") {
		super(message);
		this.name = "RegistrationPaymentExitInputError";
	}
}

function contextOf(value: unknown): {
	traceId: string;
	idempotencyKey: string;
} {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new RegistrationPaymentExitInputError(
			"Registration payment exit context is invalid",
		);
	return { traceId: context.traceId, idempotencyKey: context.idempotencyKey };
}

function id(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new RegistrationPaymentExitInputError(`${label} is invalid`);
	return value;
}

/**
 * 挂号支付退出是一个服务端编排命令，而不是“客户端连续调用两个接口”。
 * 先把医保/微信支付订单收敛到不可支付状态，再取消预约，才能释放号源；
 * 任一 provider 结果未知时命令直接失败，保留预约和 pending 上下文等待补偿。
 */
export class RegistrationPaymentExitService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			appointments: AppointmentWriteService;
			medicalInsurance: MedicalInsuranceRegistrationService;
			medicalInsuranceWechatPayment: MedicalInsuranceWechatPaymentService;
			medicalInsuranceOrders: MedicalInsuranceOrderRepository;
			paymentOrders: PaymentOrderService;
			wechatPrepay: WechatPrepayService;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
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
			input.mode !== "self"
		)
			throw new RegistrationPaymentExitInputError("payment mode is invalid");

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
			if (cancellation.status === "paid")
				throw new RegistrationPaymentExitInputError(
					"已确认支付成功，不能作废当前预约",
				);
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
				input.mode === "mixed"
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

		const result = await this.dependencies.appointments.cancel({
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
