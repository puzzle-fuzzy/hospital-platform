import type {
	MedicalInsuranceOrderPayload,
	MedicalInsuranceWechatPayPayload,
} from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	isMedicalInsuranceOrderType,
	type MedicalInsuranceAuthorizationContext,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceSettlementContext,
	type MedicalInsuranceWechatPaymentGateway,
	medicalInsuranceOrderTypeForBusiness,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { MedicalInsurancePluginPaymentService } from "./plugin-payment-service";

export class MedicalInsuranceWechatPaymentInputError extends Error {
	constructor(message = "Medical insurance WeChat payment input is invalid") {
		super(message);
		this.name = "MedicalInsuranceWechatPaymentInputError";
	}
}

export class MedicalInsuranceWechatPaymentNotAllowedError extends Error {
	constructor() {
		super(
			"Medical insurance WeChat payment is not allowed for the current order",
		);
		this.name = "MedicalInsuranceWechatPaymentNotAllowedError";
	}
}

export type MedicalInsuranceWechatNotification = {
	notificationId: string;
	eventType: "MEDICAL_INSURANCE.SUCCESS";
	mixTradeNo: string;
	outTradeNo: string;
	totalFen: number;
	cashFen: number;
	selfPayStatus: "SELF_PAY_SUCCESS";
	medicalInsurancePayStatus: "MED_INS_PAY_SUCCESS";
	receivedAt: string;
};

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new MedicalInsuranceWechatPaymentInputError(`${label} is invalid`);
	return value;
}

function output(
	order: MedicalInsuranceOrder,
	includePayParams = true,
): MedicalInsuranceWechatPayPayload["data"] {
	const paymentState = order.wechatPaymentState ?? "not_started";
	return {
		orderId: order.medicalOrderId,
		status: order.status as MedicalInsuranceWechatPayPayload["data"]["status"],
		paymentState,
		cashFen: order.amounts?.cashFen ?? 0,
		...(order.wechatMixTradeNo ? { mixTradeNo: order.wechatMixTradeNo } : {}),
		...(includePayParams && order.wechatPayParams
			? { payParams: order.wechatPayParams }
			: {}),
	};
}

function outTradeNo(orderId: string): string {
	const digest = Array.from(orderId).reduce(
		(hash, character) => (hash * 33 + character.charCodeAt(0)) >>> 0,
		5381,
	);
	return `MIP${digest.toString(16).padStart(8, "0")}${orderId
		.replaceAll(/[^A-Za-z0-9]/g, "")
		.slice(-19)}`.slice(0, 32);
}

function settlementPatch(order: MedicalInsuranceOrder) {
	return {
		status: order.status,
		ordStas: order.ordStas,
		amounts: order.amounts,
		setlType: order.setlType,
		revsTokenHash: order.revsTokenHash,
		revsTokenExpiresAt: order.revsTokenExpiresAt,
	};
}

function orderBusiness(order: MedicalInsuranceOrder): {
	businessType: "registration" | "outpatient";
	orderType: "RegPay" | "DiagPay";
} {
	// 0034 以前的订单没有业务字段；有 appointment_id 的历史订单按挂号
	// 兼容读取。新订单必须由入口显式写入，且这里再次校验类型配对，避免
	// 把门诊账单误发成 RegPay 或把挂号费用误发成 DiagPay。
	const businessType =
		order.businessType ?? (order.appointmentId ? "registration" : undefined);
	if (!businessType) throw new MedicalInsuranceWechatPaymentNotAllowedError();
	const expectedOrderType = medicalInsuranceOrderTypeForBusiness(businessType);
	const orderType = order.orderType ?? expectedOrderType;
	if (
		!isMedicalInsuranceOrderType(orderType) ||
		orderType !== expectedOrderType
	) {
		throw new MedicalInsuranceWechatPaymentNotAllowedError();
	}
	return { businessType, orderType };
}

export type MedicalInsuranceWechatPaymentServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	authorizations: import("@hospital/domain").MedicalInsuranceAuthorizationRepository;
	identityUsers: UserIdentityRepository;
	wechatPayment: MedicalInsuranceWechatPaymentGateway;
	/** 微信现金支付确认后回到统一医保订单核心，而不是绑定挂号 service。 */
	confirmCashPayment: (input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}) => Promise<MedicalInsuranceOrderPayload["data"]>;
	/** 云健康插件链路；配置完成时接管支付成功后的 .29 → .15 → .5。 */
	pluginPaymentBridge?: MedicalInsurancePluginPaymentService;
	logger?: AppLogger;
	now?: () => Date;
};

/**
 * 医保自费支付服务以官方微信 APIv3 混合下单/查单为收款边界；云健康插件
 * 后置链路是否启用由组合根配置决定，启用时支付成功必须再完成 .29/.15/.5。
 * 6202 的金额、6201 的 payOrdId、授权参保信息均由服务端订单/密文仓储读取。
 */
export class MedicalInsuranceWechatPaymentService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: MedicalInsuranceWechatPaymentServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	private async order(ownerUserId: string, orderId: string) {
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance order was not found",
			);
		}
		return order;
	}

	private async contexts(
		order: MedicalInsuranceOrder,
		ownerUserId: string,
	): Promise<{
		authorization: MedicalInsuranceAuthorizationContext;
		settlement: MedicalInsuranceSettlementContext;
		openid: string;
	}> {
		if (!order.authorizationId || !order.payOrdId || !order.amounts) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const authorization = await this.dependencies.authorizations.get({
			authorizationId: order.authorizationId,
			ownerUserId,
			medicalOrderId: order.medicalOrderId,
			now: this.now().toISOString(),
		});
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			order.medicalOrderId,
		);
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!authorization || !settlement || !identity?.providerSubject) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		return { authorization, settlement, openid: identity.providerSubject };
	}

	private async completeCashPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		if (this.dependencies.pluginPaymentBridge) {
			this.logger.info(
				{
					event: "medical-insurance.wechat-mix.plugin-settlement.requested",
					traceId: input.context.traceId,
					orderId: input.orderId,
				},
				"Medical insurance WeChat mixed payment will settle through Yunhealth plugin flow",
			);
			const result =
				await this.dependencies.pluginPaymentBridge.completeOfficialWechatPayment(
					input,
				);
			this.logger.info(
				{
					event: "medical-insurance.wechat-mix.plugin-settlement.completed",
					traceId: input.context.traceId,
					orderId: input.orderId,
					status: result.status,
				},
				"Medical insurance WeChat mixed payment Yunhealth plugin flow completed",
			);
			return result;
		}
		return this.dependencies.confirmCashPayment(input);
	}

	async create(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsuranceWechatPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		let order = await this.order(ownerUserId, orderId);
		if (order.status === "cancelled") return output(order, false);
		const { businessType, orderType } = orderBusiness(order);
		if (order.wechatPaymentState === "prepay_ready" && order.wechatPayParams) {
			if (this.dependencies.pluginPaymentBridge) {
				await this.dependencies.pluginPaymentBridge.prepareForOfficialWechatPayment(
					{
						ownerUserId,
						orderId,
						outTradeNo: order.wechatOutTradeNo ?? outTradeNo(orderId),
						context: input.context,
					},
				);
			}
			this.logger.info(
				{
					event: "medical-insurance.wechat-mix.ready",
					traceId: input.context.traceId,
					ownerUserId,
					orderId,
					businessType,
					orderType,
					reused: true,
					paymentState: order.wechatPaymentState,
				},
				"Existing medical insurance WeChat mixed payment reused",
			);
			return output(order);
		}
		if (order.wechatPaymentState === "cash_paid") {
			if (this.dependencies.pluginPaymentBridge) {
				await this.completeCashPayment({
					ownerUserId,
					orderId,
					context: input.context,
				});
				order = await this.order(ownerUserId, orderId);
			}
			return output(order, false);
		}
		if (order.status !== "cash_pending" || !order.amounts?.cashFen) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const { authorization, settlement, openid } = await this.contexts(
			order,
			ownerUserId,
		);
		const paymentOutTradeNo = order.wechatOutTradeNo ?? outTradeNo(orderId);
		if (this.dependencies.pluginPaymentBridge) {
			await this.dependencies.pluginPaymentBridge.prepareForOfficialWechatPayment(
				{
					ownerUserId,
					orderId,
					outTradeNo: paymentOutTradeNo,
					context: input.context,
				},
			);
		}
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.requested",
				traceId: input.context.traceId,
				ownerUserId,
				orderId,
				cashFen: order.amounts.cashFen,
				businessType,
				orderType,
			},
			"Medical insurance WeChat mixed payment requested",
		);
		const result = await this.dependencies.wechatPayment.createMixedOrder(
			{
				orderId,
				outTradeNo: paymentOutTradeNo,
				openid,
				payOrdId: order.payOrdId as string,
				medOrgOrd: order.medOrgOrd,
				orderType,
				amounts: order.amounts,
				medicalOrderCreateTime: order.createdAt,
				authorization,
				settlement,
			},
			input.context,
		);
		if (result.cashFen !== order.amounts.cashFen) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		if (this.dependencies.pluginPaymentBridge) {
			await this.dependencies.pluginPaymentBridge.markOfficialWechatPrepayReady(
				{
					ownerUserId,
					orderId,
					outTradeNo: paymentOutTradeNo,
					prepayId: result.prepayId,
					context: input.context,
				},
			);
		}
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...settlementPatch(order),
				wechatMixTradeNo: result.mixTradeNo,
				wechatOutTradeNo: paymentOutTradeNo,
				wechatPayParams: result.payParams,
				wechatPaymentState: "prepay_ready",
			},
		);
		if (!updated) {
			order = await this.order(ownerUserId, orderId);
			if (order.wechatPayParams && order.wechatMixTradeNo) return output(order);
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.ready",
				traceId: input.context.traceId,
				ownerUserId,
				orderId,
				providerRequestId: result.trace.requestId,
				businessType,
				orderType,
			},
			"Medical insurance WeChat mixed payment is ready",
		);
		return output(updated);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsuranceWechatPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		let order = await this.order(ownerUserId, orderId);
		if (order.status === "cancelled") return output(order, false);
		const { businessType, orderType } = orderBusiness(order);
		if (!order.wechatMixTradeNo || !order.amounts) return output(order, false);
		const result = await this.dependencies.wechatPayment.queryMixedOrder(
			{
				orderId,
				mixTradeNo: order.wechatMixTradeNo,
				expectedTotalFen: order.amounts.totalFen,
				expectedCashFen: order.amounts.cashFen,
			},
			input.context,
		);
		const paymentState =
			result.cashState === "failed" || result.insuranceState === "failed"
				? "failed"
				: result.cashState === "paid"
					? "cash_paid"
					: "prepay_ready";
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...settlementPatch(order),
				wechatPaymentState: paymentState,
			},
		);
		order = updated ?? (await this.order(ownerUserId, orderId));
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.queried",
				traceId: input.context.traceId,
				ownerUserId,
				orderId,
				businessType,
				orderType,
				providerStatus: result.providerStatus,
				cashState: result.cashState,
				insuranceState: result.insuranceState,
				paymentState,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance WeChat mixed payment queried",
		);
		if (paymentState === "cash_paid" && result.insuranceState === "paid") {
			// wx.requestMedicalInsurancePay 的 success 只代表客户端调起成功；必须再走服务端
			// 混合查单和医保后置完成，才能清除 pending 上下文。
			const confirmed = await this.completeCashPayment({
				ownerUserId,
				orderId,
				context: input.context,
			});
			order = await this.order(ownerUserId, orderId);
			return {
				...output(order, false),
				status:
					confirmed.status as MedicalInsuranceWechatPayPayload["data"]["status"],
				paymentState: "cash_paid",
				cashFen: confirmed.amounts?.cashFen ?? order.amounts?.cashFen ?? 0,
			};
		}
		return output(order, false);
	}

	/**
	 * 处理官方医保混合成功回调。回调中的 mix_trade_no 只用于定位服务端订单，
	 * 金额必须与本地 6202 事实一致；随后仍通过官方混合查单和统一医保核心
	 * 完成 HIS 收敛，避免仅凭回调文本直接把订单标记完成。
	 */
	async receiveNotification(input: {
		notification: MedicalInsuranceWechatNotification;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<void> {
		const notification = input.notification;
		let order = await this.dependencies.orders.findByWechatMixTradeNo(
			notification.mixTradeNo,
		);
		if (!order) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification order was not found",
			);
		}
		if (
			order.wechatOutTradeNo &&
			order.wechatOutTradeNo !== notification.outTradeNo
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification order does not match",
			);
		}
		if (!order.amounts || order.amounts.totalFen !== notification.totalFen) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification amount does not match",
			);
		}
		if (order.amounts.cashFen !== notification.cashFen) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification cash amount does not match",
			);
		}
		// 回调是异步触发信号，不直接作为最终支付事实；再向微信 APIv3
		// 混合订单查单，确认自费和医保两段都成功后才允许推进 HIS 收敛。
		const confirmedPayment =
			await this.dependencies.wechatPayment.queryMixedOrder(
				{
					orderId: order.medicalOrderId,
					mixTradeNo: notification.mixTradeNo,
					expectedTotalFen: order.amounts.totalFen,
					expectedCashFen: order.amounts.cashFen,
				},
				input.context,
			);
		if (
			confirmedPayment.cashState !== "paid" ||
			confirmedPayment.insuranceState !== "paid"
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification payment is not fully confirmed",
			);
		}
		if (
			order.wechatPaymentState === "cash_paid" &&
			order.status === "insurance_settled"
		) {
			this.logger.info(
				{
					event: "medical-insurance.wechat-mix.notification.duplicate",
					traceId: input.context.traceId,
					orderId: order.medicalOrderId,
					notificationId: notification.notificationId,
				},
				"Medical insurance WeChat mixed notification already applied",
			);
			return;
		}
		const markedPaid =
			order.wechatPaymentState === "cash_paid"
				? order
				: await this.dependencies.orders.applySettlement(
						order.medicalOrderId,
						order.version,
						{
							...settlementPatch(order),
							wechatPaymentState: "cash_paid",
						},
					);
		if (!markedPaid) {
			order =
				(await this.dependencies.orders.findByWechatMixTradeNo(
					notification.mixTradeNo,
				)) ?? order;
		}
		const current = markedPaid ?? order;
		if (current.wechatPaymentState !== "cash_paid") {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification could not update the order",
			);
		}
		await this.completeCashPayment({
			ownerUserId: current.ownerUserId,
			orderId: current.medicalOrderId,
			context: input.context,
		});
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.notification.applied",
				traceId: input.context.traceId,
				orderId: current.medicalOrderId,
				notificationId: notification.notificationId,
			},
			"Medical insurance WeChat mixed notification applied",
		);
	}
}
