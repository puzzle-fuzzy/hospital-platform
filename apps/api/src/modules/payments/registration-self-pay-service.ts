import type { RegistrationSelfPayPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	type HospitalSettlementGateway,
	type PaymentOrder,
	PaymentOrderInputError,
	type PaymentOrderService,
	type RegistrationSelfPayPreparationGateway,
	type RegistrationSelfPaySettlementContext,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentWriteService } from "../appointments/write-service";
import type { WechatPrepayService } from "./service";

export type RegistrationSelfPayServiceDependencies = {
	appointments: AppointmentWriteService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	/** 微信已确认收款后，必须经过 HIS 回写才能进入 completed。 */
	hospitalSettlement: HospitalSettlementGateway;
	/** 微信下单前固定完成众阳 .1 -> .32 -> .2，并返回同一笔流水上下文。 */
	preparation: RegistrationSelfPayPreparationGateway;
	/** 优先读取普通自费密文上下文；仅为历史订单兼容同预约医保上下文。 */
	resolveRegistrationContext?: (input: {
		ownerUserId: string;
		appointmentId: string;
		orderId: string;
	}) => Promise<RegistrationSelfPaySettlementContext | undefined>;
	/** Provider 前置成功后必须先加密落库，随后才允许创建微信订单。 */
	saveRegistrationContext: (input: {
		ownerUserId: string;
		orderId: string;
		registrationContext: RegistrationSelfPaySettlementContext;
	}) => Promise<void>;
	/** .29 成功后的完整响应交给医保密文上下文保存，不参与支付状态判断。 */
	onThirdPartPayResponse?: (input: {
		ownerUserId: string;
		appointmentId: string;
		paymentOrder: PaymentOrder;
		registrationContext?: RegistrationSelfPaySettlementContext;
		rawResponse: string;
		thirdPartPayRecordId: string;
	}) => Promise<void>;
	logger?: AppLogger;
};

type Context = AdapterCallContext;

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

/** 挂号自费订单的服务端固定幂等键；取消预约也用同一键检查活动支付。 */
export function registrationSelfPayOrderKey(appointmentId: string): string {
	return `registration-self-pay:${appointmentId}`;
}

function prepayKey(appointmentId: string): string {
	return `registration-self-pay-prepay:${appointmentId}`;
}

function preparationKey(orderId: string): string {
	return `registration-self-pay-provider-prepare:${orderId}`;
}

function settlementKey(orderId: string): string {
	return `registration-self-pay-settlement:${orderId}`;
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

	/**
	 * 旧服务的支付后边界：微信 SUCCESS 只能证明现金已收，不能直接视为
	 * 挂号完成。HIS 回写成功后再按状态机推进 his_written_back -> completed。
	 * Provider 调用本身必须由 adapter 保证幂等；如果请求结果不确定，订单
	 * 留在 cash_paid，下一次查询/补偿仍会重试，不会丢失“已收款未入 HIS”。
	 */
	private async completeHis(
		ownerUserId: string,
		appointmentId: string,
		order: PaymentOrder,
		context: Context,
	): Promise<PaymentOrder> {
		if (order.state === "completed") return order;
		if (order.state === "his_written_back") {
			return this.dependencies.paymentOrders.transition(
				ownerUserId,
				order.orderId,
				"completed",
			);
		}
		if (order.state !== "cash_paid") return order;

		try {
			const registrationContext = this.dependencies.resolveRegistrationContext
				? await this.dependencies.resolveRegistrationContext({
						ownerUserId,
						appointmentId,
						orderId: order.orderId,
					})
				: undefined;
			if (
				this.dependencies.resolveRegistrationContext &&
				!registrationContext
			) {
				this.logger.warn(
					{
						event: "appointment.self-payment.his-context-pending",
						ownerUserId,
						appointmentId,
						orderId: order.orderId,
					},
					"Registration self-pay HIS context is pending",
				);
				return order;
			}
			const trace = await this.dependencies.hospitalSettlement.writeBack(
				{
					orderId: order.orderId,
					settlement: {
						orderId: order.orderId,
						state: order.state,
						totalFen: order.amounts.totalFen,
						insuranceFen: order.amounts.insuranceFen,
						cashFen: order.amounts.cashFen,
						trace: [],
					},
					...(registrationContext ? { registrationContext } : {}),
					...(this.dependencies.onThirdPartPayResponse
						? {
								onThirdPartPayResponse: (response: {
									rawResponse: string;
									thirdPartPayRecordId: string;
								}) =>
									this.dependencies.onThirdPartPayResponse?.({
										ownerUserId,
										appointmentId,
										paymentOrder: order,
										...(registrationContext ? { registrationContext } : {}),
										rawResponse: response.rawResponse,
										thirdPartPayRecordId: response.thirdPartPayRecordId,
									}),
							}
						: {}),
				},
				{
					...context,
					idempotencyKey: settlementKey(order.orderId),
				},
			);
			this.logger.info(
				{
					event: "appointment.self-payment.his-writeback-succeeded",
					ownerUserId,
					appointmentId: order.idempotencyKey.replace(
						"registration-self-pay:",
						"",
					),
					orderId: order.orderId,
					provider: trace.provider,
					providerRequestId: trace.requestId,
				},
				"Registration self-pay HIS writeback succeeded",
			);
		} catch (error) {
			this.logger.warn(
				{
					event: "appointment.self-payment.his-writeback-pending",
					ownerUserId,
					orderId: order.orderId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Registration self-pay is paid but HIS writeback is pending",
			);
			return order;
		}

		const writtenBack = await this.dependencies.paymentOrders.transition(
			ownerUserId,
			order.orderId,
			"his_written_back",
		);
		return this.dependencies.paymentOrders.transition(
			ownerUserId,
			writtenBack.orderId,
			"completed",
		);
	}

	private async finalize(
		ownerUserId: string,
		appointmentId: string,
		order: PaymentOrder,
		context: Context,
	): Promise<PaymentOrder> {
		return this.completeHis(ownerUserId, appointmentId, order, context);
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
			idempotencyKey: registrationSelfPayOrderKey(appointment.appointmentId),
			amounts: {
				totalFen: appointment.totalFen,
				insuranceFen: 0,
				cashFen: appointment.totalFen,
			},
		});
		if (order.state === "cash_paid") {
			const finalized = await this.finalize(
				ownerUserId,
				appointment.appointmentId,
				order,
				context,
			);
			return output(
				appointment.appointmentId,
				finalized,
				finalized.state === "completed" ? "cash_paid" : "awaiting_confirmation",
			);
		}
		if (order.state === "completed" || order.state === "his_written_back") {
			const finalized = await this.finalize(
				ownerUserId,
				appointment.appointmentId,
				order,
				context,
			);
			return output(appointment.appointmentId, finalized, "cash_paid");
		}
		if (order.state === "failed")
			return output(appointment.appointmentId, order, "failed");

		let registrationContext = this.dependencies.resolveRegistrationContext
			? await this.dependencies.resolveRegistrationContext({
					ownerUserId,
					appointmentId: appointment.appointmentId,
					orderId: order.orderId,
				})
			: undefined;
		if (!registrationContext) {
			const provider =
				await this.dependencies.appointments.getProviderPaymentContext(
					ownerUserId,
					appointment.appointmentId,
					context,
				);
			const prepared = await this.dependencies.preparation.prepare(
				{
					orderId: order.orderId,
					totalFen: order.amounts.totalFen,
					providerRegisterId: provider.providerRegisterId,
					providerPatientId: provider.providerPatientId,
					patient: provider.patient,
				},
				{
					...context,
					idempotencyKey: preparationKey(order.orderId),
				},
			);
			registrationContext = prepared.registrationContext;
			await this.dependencies.saveRegistrationContext({
				ownerUserId,
				orderId: order.orderId,
				registrationContext,
			});
			this.logger.info(
				{
					event: "appointment.self-payment.provider-preparation-succeeded",
					ownerUserId,
					appointmentId: appointment.appointmentId,
					orderId: order.orderId,
					provider: prepared.trace.provider,
					providerRequestIds: prepared.trace.requestIds ?? [
						prepared.trace.requestId,
					],
				},
				"Registration self-pay provider preparation succeeded",
			);
		}
		const prepay = await this.dependencies.wechatPrepay.create({
			ownerUserId,
			orderId: order.orderId,
			paymentContext: {
				orderType: "RegPay",
				// v4.0 的 serial_no 是 HIS 订单号；优先使用众阳返回的
				// HIS 挂号流水，其次使用挂号流水，不能把排班号当 HIS 订单号。
				serialNo:
					appointment.providerHisRegisterId ??
					appointment.providerRegisterId ??
					order.orderId,
			},
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
				registrationSelfPayOrderKey(appointment.appointmentId),
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
		const finalized =
			reconciled.state === "cash_paid" ||
			reconciled.state === "his_written_back" ||
			reconciled.state === "completed"
				? await this.finalize(
						ownerUserId,
						appointment.appointmentId,
						{ ...order, state: reconciled.state },
						context,
					)
				: { ...order, state: reconciled.state };
		const status: RegistrationSelfPayPayload["data"]["status"] =
			finalized.state === "completed"
				? "cash_paid"
				: reconciled.status === "failed"
					? "failed"
					: "awaiting_confirmation";
		return output(appointment.appointmentId, finalized, status);
	}
}
