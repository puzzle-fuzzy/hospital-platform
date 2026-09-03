import type { MedicalInsuranceWechatPayPayload } from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceAuthorizationContext,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceSettlementContext,
	type MedicalInsuranceWechatPaymentGateway,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import type { MedicalInsuranceRegistrationService } from "./registration-service";

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

export type MedicalInsuranceWechatPaymentServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	authorizations: import("@hospital/domain").MedicalInsuranceAuthorizationRepository;
	identityUsers: UserIdentityRepository;
	wechatPayment: MedicalInsuranceWechatPaymentGateway;
	registration: MedicalInsuranceRegistrationService;
	logger?: AppLogger;
	now?: () => Date;
};

/**
 * 医保自费支付服务只编排两件事：官方混合下单和混合订单查单。
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

	async create(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsuranceWechatPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		let order = await this.order(ownerUserId, orderId);
		if (order.wechatPaymentState === "prepay_ready" && order.wechatPayParams)
			return output(order);
		if (order.wechatPaymentState === "cash_paid") return output(order, false);
		if (order.status !== "cash_pending" || !order.amounts?.cashFen) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const { authorization, settlement, openid } = await this.contexts(
			order,
			ownerUserId,
		);
		const paymentOutTradeNo = order.wechatOutTradeNo ?? outTradeNo(orderId);
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.requested",
				traceId: input.context.traceId,
				orderId,
				cashFen: order.amounts.cashFen,
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
				amounts: order.amounts,
				authorization,
				settlement,
			},
			input.context,
		);
		if (result.cashFen !== order.amounts.cashFen) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
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
				orderId,
				providerRequestId: result.trace.requestId,
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
		if (paymentState === "cash_paid" && result.insuranceState === "paid") {
			// wx.requestPayment 的 success 只代表客户端调起成功；必须再走服务端
			// 混合查单和医保后置完成，才能清除 pending 上下文。
			const confirmed =
				await this.dependencies.registration.confirmWechatCashPayment({
					ownerUserId,
					orderId,
					context: input.context,
				});
			return {
				...output(order, false),
				status:
					confirmed.status as MedicalInsuranceWechatPayPayload["data"]["status"],
				paymentState: "cash_paid",
				cashFen: confirmed.amounts?.cashFen ?? order.amounts?.cashFen ?? 0,
			};
		}
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.queried",
				traceId: input.context.traceId,
				orderId,
				providerStatus: result.providerStatus,
				paymentState,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance WeChat mixed payment queried",
		);
		return output(order, false);
	}
}
