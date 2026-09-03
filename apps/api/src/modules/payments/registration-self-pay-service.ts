import type { RegistrationSelfPayPayload } from "@hospital/contracts";
import {
	type PaymentOrder,
	PaymentOrderInputError,
	type PaymentOrderService,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentWriteService } from "../appointments/write-service";
import type { WechatPrepayService } from "./service";

export type RegistrationSelfPayServiceDependencies = {
	appointments: AppointmentWriteService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	logger?: AppLogger;
};

type Context = { traceId: string; idempotencyKey: string };

function opaque(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value.length > 64 ||
		!/^[A-Za-z0-9._:-]+$/.test(value)
	) {
		throw new PaymentOrderInputError(`${label} is invalid`);
	}
	return value;
}

function contextOf(value: unknown): Context {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new PaymentOrderInputError(
			"Registration self-pay context is invalid",
		);
	const record = value as Record<string, unknown>;
	return {
		traceId: opaque(record.traceId, "traceId"),
		idempotencyKey: opaque(record.idempotencyKey, "idempotencyKey"),
	};
}

function orderKey(appointmentId: string): string {
	return `registration-self-pay:${appointmentId}`;
}

function prepayKey(appointmentId: string): string {
	return `registration-self-pay-prepay:${appointmentId}`;
}

function output(
	appointmentId: string,
	order: PaymentOrder,
	status: RegistrationSelfPayPayload["data"]["status"],
	payParams?: RegistrationSelfPayPayload["data"]["payParams"],
): RegistrationSelfPayPayload["data"] {
	return {
		appointmentId,
		orderId: order.orderId,
		status,
		paymentState: order.state,
		totalFen: order.amounts.cashFen,
		...(payParams ? { payParams } : {}),
	};
}

/**
 * 纯自费挂号只复用平台普通微信支付订单能力：金额从已写入的预约读取，
 * 小程序不能提交金额；支付状态仍由微信查单/通知收敛，不把 wx 调起成功
 * 当成最终支付成功。
 */
export class RegistrationSelfPayService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: RegistrationSelfPayServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async create(input: {
		ownerUserId: string;
		appointmentId: string;
		context: unknown;
	}): Promise<RegistrationSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const appointment = await this.dependencies.appointments.getPaymentContext(
			ownerUserId,
			input.appointmentId,
		);
		const order = await this.dependencies.paymentOrders.createCashPending({
			ownerUserId,
			patientId: appointment.patientId,
			idempotencyKey: orderKey(appointment.appointmentId),
			amounts: {
				totalFen: appointment.totalFen,
				insuranceFen: 0,
				cashFen: appointment.totalFen,
			},
		});
		if (order.state === "cash_paid")
			return output(appointment.appointmentId, order, "cash_paid");
		if (order.state === "failed")
			return output(appointment.appointmentId, order, "failed");
		const prepay = await this.dependencies.wechatPrepay.create({
			ownerUserId,
			orderId: order.orderId,
			context: {
				traceId: context.traceId,
				idempotencyKey: prepayKey(appointment.appointmentId),
			},
		});
		this.logger.info(
			{
				event: "appointment.self-payment.ready",
				ownerUserId,
				appointmentId: appointment.appointmentId,
				orderId: order.orderId,
				traceId: context.traceId,
			},
			"Registration self-pay is ready",
		);
		return output(
			appointment.appointmentId,
			order,
			"prepay_ready",
			prepay.payParams,
		);
	}

	async query(input: {
		ownerUserId: string;
		appointmentId: string;
		context: unknown;
	}): Promise<RegistrationSelfPayPayload["data"]> {
		const context = contextOf(input.context);
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const appointmentId = opaque(input.appointmentId, "appointmentId");
		const appointment = await this.dependencies.appointments.getPaymentContext(
			ownerUserId,
			appointmentId,
		);
		const order =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				orderKey(appointment.appointmentId),
			);
		if (!order || order.patientId !== appointment.patientId)
			throw new PaymentOrderInputError(
				"Registration self-pay order is unavailable",
			);
		const reconciled = await this.dependencies.wechatPrepay.reconcile({
			ownerUserId,
			orderId: order.orderId,
			context,
		});
		const status: RegistrationSelfPayPayload["data"]["status"] =
			reconciled.status === "paid"
				? "cash_paid"
				: reconciled.status === "failed"
					? "failed"
					: "awaiting_confirmation";
		return output(
			appointment.appointmentId,
			{ ...order, state: reconciled.state },
			status,
		);
	}
}
