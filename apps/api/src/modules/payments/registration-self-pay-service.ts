import type { RegistrationSelfPayPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	type HospitalSettlementGateway,
	type PaymentOrder,
	PaymentOrderInputError,
	type PaymentOrderService,
	type RegistrationSelfPayPreparationGateway,
	type RegistrationSelfPaySettlementContext,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { AppointmentWriteService } from "../appointments/write-service";
import type { WechatPrepayService } from "./service";

export type RegistrationSelfPayServiceDependencies = {
	appointments: AppointmentWriteService;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	/** 众阳非 HIS 收款 .5 返回 isSettle=1 后才能进入 completed。 */
	hospitalSettlement: HospitalSettlementGateway;
	/** 收银台前固定完成众阳 .1 -> .27 -> .2，并返回同一笔流水上下文。 */
	preparation: RegistrationSelfPayPreparationGateway;
	/** 仅用于把当前微信 openid 传给众阳 MINI_PROGRAM .2。 */
	identityUsers?: UserIdentityRepository;
	/** 优先读取普通自费密文上下文；仅为历史订单兼容同预约医保上下文。 */
	resolveRegistrationContext?: (input: {
		ownerUserId: string;
		appointmentId: string;
		orderId: string;
	}) => Promise<RegistrationSelfPaySettlementContext | undefined>;
	/** Provider 前置成功后必须先加密落库，随后才允许调起微信收银台。 */
	saveRegistrationContext: (input: {
		ownerUserId: string;
		orderId: string;
		registrationContext: RegistrationSelfPaySettlementContext;
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
 * 新纯自费直接使用 2.6.65.2 返回的 APIv2/MD5 收银台参数：金额只从
 * 已写入的预约读取；wx 调起成功后调用 .5，只有 isSettle=1 才完成。
 * 修改前已创建的 APIv3/RSA 订单继续保留原查单分支。
 */
export class RegistrationSelfPayService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: RegistrationSelfPayServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	/**
	 * 支付后边界：微信 SUCCESS 只触发服务端确认，不能直接视为挂号完成。
	 * 众阳 .5 返回 isSettle=1 后，再按 cash_paid -> his_written_back -> completed
	 * 推进本地状态机；.5 未确认或结果未知时保留原状态继续查询。
	 * Provider 调用本身必须由 adapter 保证幂等；如果请求结果不确定，订单
	 * 留在原状态，下一次查询仍会复用同一 Provider 流水，不重复下单。
	 */
	private async completeProviderSettlement(
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
		if (order.state !== "cash_pending" && order.state !== "cash_paid") {
			return order;
		}

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
			if (registrationContext) {
				await this.dependencies.saveRegistrationContext({
					ownerUserId,
					orderId: order.orderId,
					registrationContext,
				});
			}
			const trace = await this.dependencies.hospitalSettlement.writeBack(
				{
					orderId: order.orderId,
					settlement: {
						orderId: order.orderId,
						// .5 是权威完成判断；只有它返回 isSettle=1 后，才真正
						// 把本地 cash_pending 迁移为 cash_paid。
						state: "cash_paid",
						totalFen: order.amounts.totalFen,
						insuranceFen: order.amounts.insuranceFen,
						cashFen: order.amounts.cashFen,
						trace: [],
					},
					...(registrationContext ? { registrationContext } : {}),
				},
				{
					...context,
					idempotencyKey: settlementKey(order.orderId),
				},
			);
			this.logger.info(
				{
					event: "appointment.self-payment.provider-settlement-succeeded",
					ownerUserId,
					appointmentId: order.idempotencyKey.replace(
						"registration-self-pay:",
						"",
					),
					orderId: order.orderId,
					provider: trace.provider,
					providerRequestId: trace.requestId,
				},
				"Registration self-pay Provider settlement succeeded",
			);
		} catch (error) {
			this.logger.warn(
				{
					event: "appointment.self-payment.provider-settlement-pending",
					ownerUserId,
					orderId: order.orderId,
					errorName: error instanceof Error ? error.name : "UnknownError",
				},
				"Registration self-pay Provider settlement is pending",
			);
			return order;
		}

		const paid =
			order.state === "cash_pending"
				? await this.dependencies.paymentOrders.transition(
						ownerUserId,
						order.orderId,
						"cash_paid",
					)
				: order;
		const writtenBack = await this.dependencies.paymentOrders.transition(
			ownerUserId,
			paid.orderId,
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
		return this.completeProviderSettlement(
			ownerUserId,
			appointmentId,
			order,
			context,
		);
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
		const reusedRegistrationContext = Boolean(registrationContext);
		if (!registrationContext) {
			const identity = this.dependencies.identityUsers
				? await this.dependencies.identityUsers.findByUserId(ownerUserId)
				: undefined;
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
					...(identity?.providerSubject
						? { paymentSystemUserId: identity.providerSubject }
						: {}),
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
		if (registrationContext.payParams) {
			// 重放请求先用 .5 判断原支付是否已经完成；未确认时只返回同一组
			// MD5/prepay_id，不创建第二笔微信订单。
			if (reusedRegistrationContext) {
				const confirmed = await this.finalize(
					ownerUserId,
					appointment.appointmentId,
					order,
					context,
				);
				if (confirmed.state === "completed") {
					return output(appointment.appointmentId, confirmed, "cash_paid");
				}
			}
			this.logger.info(
				{
					event: "appointment.self-payment.ready",
					ownerUserId,
					appointmentId: appointment.appointmentId,
					orderId: order.orderId,
					traceId: context.traceId,
					provider: "yunhealth",
					signType: "MD5",
				},
				"Registration self-pay is ready",
			);
			return output(
				appointment.appointmentId,
				order,
				"prepay_ready",
				registrationContext.payParams,
			);
		}
		// 仅用于修改前已落库、但未保存 .2 MD5 参数的 APIv3/RSA 订单。
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
		const registrationContext = this.dependencies.resolveRegistrationContext
			? await this.dependencies.resolveRegistrationContext({
					ownerUserId,
					appointmentId: appointment.appointmentId,
					orderId: order.orderId,
				})
			: undefined;
		if (registrationContext?.payParams) {
			// 新 MD5 路线不查询我方 APIv3 out_trade_no；每次查询直接重放
			// 幂等的 .5，并且只把 isSettle=1 映射为支付完成。
			const finalized = await this.finalize(
				ownerUserId,
				appointment.appointmentId,
				order,
				context,
			);
			return output(
				appointment.appointmentId,
				finalized,
				finalized.state === "completed"
					? "cash_paid"
					: finalized.state === "failed"
						? "failed"
						: "awaiting_confirmation",
			);
		}

		// 修改前已经存在的 APIv3/RSA 订单仍按微信 out_trade_no 查单收尾。
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
