import { createHash } from "node:crypto";
import type { MedicalInsurancePluginPayPayload } from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceAuthorizationContext,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsurancePluginPaymentContext,
	type MedicalInsuranceSettlementContext,
	type PaymentOrder,
	PaymentOrderInputError,
	PaymentOrderService,
	type RegistrationSelfPaySettlementContext,
	type UserIdentityRepository,
	type YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { MedicalInsuranceRegistrationInputError } from "./errors";
import type { WechatPrepayService } from "../payments/service";

const PLUGIN_ORDER_PREFIX = "registration-medical-plugin-self-pay:";
const PLUGIN_PREPAY_PREFIX = "registration-medical-plugin-prepay:";

function opaque(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value))
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	return value;
}

function contextText(
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

function stableCode(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function pluginOrderKey(medicalOrderId: string): string {
	return `${PLUGIN_ORDER_PREFIX}${medicalOrderId}`;
}

function pluginPrepayKey(medicalOrderId: string): string {
	return `${PLUGIN_PREPAY_PREFIX}${medicalOrderId}`;
}

function output(
	medicalOrder: MedicalInsuranceOrder,
	paymentOrder: PaymentOrder,
	payParams?: MedicalInsurancePluginPayPayload["data"]["payParams"],
): MedicalInsurancePluginPayPayload["data"] {
	return {
		orderId: medicalOrder.medicalOrderId,
		paymentOrderId: paymentOrder.orderId,
		status:
			medicalOrder.status === "insurance_settled"
				? "insurance_settled"
				: medicalOrder.status === "failed"
					? "failed"
					: medicalOrder.status === "manual_review"
						? "manual_review"
						: "cash_pending",
		paymentState: paymentOrder.state,
		cashFen: medicalOrder.amounts?.cashFen ?? paymentOrder.amounts.cashFen,
		...(payParams ? { payParams } : {}),
	};
}

function samePluginContext(
	context: MedicalInsurancePluginPaymentContext,
): MedicalInsurancePluginPaymentContext {
	return { ...context };
}

export type MedicalInsurancePluginPaymentServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	authorizations: import("@hospital/domain").MedicalInsuranceAuthorizationRepository;
	identityUsers: UserIdentityRepository;
	paymentOrders: PaymentOrderService;
	wechatPrepay: WechatPrepayService;
	pluginPayment: YunhealthRegistrationPluginPaymentGateway;
	hospitalSettlement: import("@hospital/domain").HospitalSettlementGateway;
	pluginPayTypeId: string;
	pluginPayType: "CREDIT" | "POS" | "CROWD_FUNDING";
	pluginWorkStationId: string;
	pluginTradeTypeCode: string;
	logger?: AppLogger;
	now?: () => Date;
};

/**
 * 旧服务的插件版医保混合支付编排：
 *
 * 6202 cash_pending → 第二次云健康 .2 → 同一 out_trade_no 的微信 JSAPI
 * → 微信查单成功 → .29 → .15 → .5。所有插件流水都挂在医保订单密文
 * settlement context 下，普通纯自费订单不会进入这条链。
 */
export class MedicalInsurancePluginPaymentService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: MedicalInsurancePluginPaymentServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	private async order(ownerUserId: string, orderId: string) {
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance order was not found",
			);
		}
		return order;
	}

	private async contexts(
		ownerUserId: string,
		order: MedicalInsuranceOrder,
	): Promise<{
		authorization: MedicalInsuranceAuthorizationContext;
		settlement: MedicalInsuranceSettlementContext;
		openid: string;
	}> {
		if (!order.authorizationId || !order.payOrdId || !order.amounts) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment is not allowed for the current order",
			);
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
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment context is not available",
			);
		}
		return { authorization, settlement, openid: identity.providerSubject };
	}

	private pluginInput(settlement: MedicalInsuranceSettlementContext): Omit<
		RegistrationSelfPaySettlementContext,
		"outTradeNo" | "recordCode" | "thirdPartPayRecordId"
	> & {
		tradeCode: string;
		tradeTypeCode: string;
	} {
		const register = settlement.networkRegister;
		const tradeCode = settlement.businessCode?.trim();
		const certNo = contextText(register, [
			"idNo",
			"id_no",
			"certNo",
			"cert_no",
		]);
		const psnName = contextText(register, [
			"netPatName",
			"net_pat_name",
			"psnName",
			"psn_name",
		]);
		const psnNo = contextText(register, [
			"memberNo",
			"member_no",
			"psnNo",
			"psn_no",
		]);
		if (
			!tradeCode ||
			!settlement.businessId.trim() ||
			!settlement.hospitalId.trim() ||
			!settlement.patientId.trim() ||
			!certNo ||
			!psnName ||
			!psnNo
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment is not allowed for the current order",
			);
		}
		return {
			businessId: settlement.businessId,
			payingId: settlement.payingId,
			tradingId: settlement.tradingId,
			hospitalId: settlement.hospitalId,
			patientId: settlement.patientId,
			certNo,
			psnCertType:
				contextText(register, [
					"psnCertType",
					"psn_cert_type",
					"idType",
					"id_type",
				]) ?? "01",
			psnName,
			psnNo,
			patInHosId: contextText(register, ["patInHosId", "pat_in_hos_id"]) ?? "0",
			payTypeId: this.dependencies.pluginPayTypeId,
			payType: this.dependencies.pluginPayType,
			workStationId: this.dependencies.pluginWorkStationId,
			tradeCode,
			tradeTypeCode: this.dependencies.pluginTradeTypeCode,
		};
	}

	private async saveMedicalPaymentState(
		order: MedicalInsuranceOrder,
		patch: {
			wechatOutTradeNo?: string;
			wechatPaymentState?: MedicalInsuranceOrder["wechatPaymentState"];
		},
	): Promise<MedicalInsuranceOrder> {
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: order.status,
				ordStas: order.ordStas,
				amounts: order.amounts,
				setlType: order.setlType,
				revsTokenHash: order.revsTokenHash,
				revsTokenExpiresAt: order.revsTokenExpiresAt,
				...patch,
			},
		);
		return (
			updated ?? (await this.order(order.ownerUserId, order.medicalOrderId))
		);
	}

	private async ensurePluginOrder(
		ownerUserId: string,
		order: MedicalInsuranceOrder,
		settlement: MedicalInsuranceSettlementContext,
		paymentOrder: PaymentOrder,
		context: { traceId: string; idempotencyKey: string },
	): Promise<MedicalInsuranceSettlementContext> {
		const existing = settlement.plugin;
		if (existing) {
			if (existing.paymentOrderId !== paymentOrder.orderId) {
				throw new PaymentOrderInputError(
					"Medical insurance plugin payment order does not match the saved context",
				);
			}
			return settlement;
		}
		const input = this.pluginInput(settlement);
		const recordCode = stableCode(
			`medical-insurance-plugin:${order.medicalOrderId}:${paymentOrder.orderId}`,
		);
		const result = await this.dependencies.pluginPayment.createPreOrder(
			{
				orderId: paymentOrder.orderId,
				businessId: input.businessId,
				tradeCode: input.tradeCode,
				totalFen: order.amounts?.cashFen ?? 0,
				hospitalId: input.hospitalId ?? "",
				patientId: input.patientId ?? "",
				payTypeId: input.payTypeId ?? this.dependencies.pluginPayTypeId,
				payType: input.payType ?? this.dependencies.pluginPayType,
				workStationId:
					input.workStationId ?? this.dependencies.pluginWorkStationId,
				recordCode,
				tradeTypeCode: input.tradeTypeCode,
			},
			context,
		);
		const plugin: MedicalInsurancePluginPaymentContext = {
			paymentOrderId: paymentOrder.orderId,
			payingId: result.payingId,
			tradingId: result.tradingId,
			payTypeId: result.payTypeId,
			payType: result.payType,
			workStationId: result.workStationId,
			tradeCode: input.tradeCode,
			tradeTypeCode: input.tradeTypeCode,
			outTradeNo: paymentOrder.orderId,
			recordCode,
			state: "preorder_created",
		};
		const next = { ...settlement, plugin: samePluginContext(plugin) };
		await this.dependencies.orders.saveSettlementContext(
			ownerUserId,
			order.medicalOrderId,
			next,
		);
		this.logger.info(
			{
				event: "medical-insurance.plugin-preorder.created",
				traceId: context.traceId,
				orderId: order.medicalOrderId,
				paymentOrderId: paymentOrder.orderId,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance Yunhealth plugin pre-order created",
		);
		return next;
	}

	private registrationContext(
		settlement: MedicalInsuranceSettlementContext,
	): RegistrationSelfPaySettlementContext {
		const plugin = settlement.plugin;
		if (!plugin)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment context is not available",
			);
		const register = settlement.networkRegister;
		const text = (keys: readonly string[]) => contextText(register, keys);
		const certNo = text(["idNo", "id_no", "certNo", "cert_no"]);
		const psnName = text(["netPatName", "net_pat_name", "psnName", "psn_name"]);
		const psnNo = text(["memberNo", "member_no", "psnNo", "psn_no"]);
		if (!certNo || !psnName || !psnNo) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin patient context is incomplete",
			);
		}
		return {
			businessId: settlement.businessId,
			payingId: plugin.payingId,
			tradingId: plugin.tradingId,
			hospitalId: settlement.hospitalId,
			patientId: settlement.patientId,
			certNo,
			psnCertType:
				text(["psnCertType", "psn_cert_type", "idType", "id_type"]) ?? "01",
			psnName,
			psnNo,
			patInHosId: text(["patInHosId", "pat_in_hos_id"]) ?? "0",
			outTradeNo: plugin.outTradeNo,
			recordCode: plugin.recordCode,
			payTypeId: plugin.payTypeId,
			payType: plugin.payType,
			workStationId: plugin.workStationId,
			...(plugin.thirdPartPayRecordId
				? { thirdPartPayRecordId: plugin.thirdPartPayRecordId }
				: {}),
		};
	}

	private async complete(
		ownerUserId: string,
		medicalOrder: MedicalInsuranceOrder,
		paymentOrder: PaymentOrder,
		settlement: MedicalInsuranceSettlementContext,
		context: { traceId: string; idempotencyKey: string },
	): Promise<PaymentOrder> {
		if (paymentOrder.state === "completed") return paymentOrder;
		if (paymentOrder.state === "his_written_back") {
			return this.dependencies.paymentOrders.transition(
				ownerUserId,
				paymentOrder.orderId,
				"completed",
			);
		}
		if (paymentOrder.state !== "cash_paid") return paymentOrder;
		const trace = await this.dependencies.hospitalSettlement.writeBack(
			{
				orderId: paymentOrder.orderId,
				settlement: {
					orderId: paymentOrder.orderId,
					state: paymentOrder.state,
					totalFen: paymentOrder.amounts.totalFen,
					insuranceFen: paymentOrder.amounts.insuranceFen,
					cashFen: paymentOrder.amounts.cashFen,
					trace: [],
				},
				registrationContext: this.registrationContext(settlement),
				onThirdPartPayResponse: async ({
					rawResponse,
					thirdPartPayRecordId,
				}) => {
					const currentSettlement =
						(await this.dependencies.orders.getSettlementContext(
							ownerUserId,
							medicalOrder.medicalOrderId,
						)) ?? settlement;
					const currentPlugin = currentSettlement.plugin;
					if (
						!currentPlugin ||
						currentPlugin.paymentOrderId !== paymentOrder.orderId
					) {
						throw new DependencyNotConfiguredError(
							"medical-insurance-plugin-payment",
						);
					}
					await this.dependencies.orders.saveSettlementContext(
						ownerUserId,
						medicalOrder.medicalOrderId,
						{
							...currentSettlement,
							plugin: {
								...currentPlugin,
								thirdPartPayRecordId,
								thirdPartPayRawResponse: rawResponse,
								state: "29_succeeded",
							},
						},
					);
				},
			},
			{
				...context,
				idempotencyKey: `registration-medical-plugin-settlement:${paymentOrder.orderId}`,
			},
		);
		const latestSettlement =
			await this.dependencies.orders.getSettlementContext(
				ownerUserId,
				medicalOrder.medicalOrderId,
			);
		if (latestSettlement?.plugin) {
			await this.dependencies.orders.saveSettlementContext(
				ownerUserId,
				medicalOrder.medicalOrderId,
				{
					...latestSettlement,
					plugin: { ...latestSettlement.plugin, state: "settled" },
				},
			);
		}
		const settled = await this.dependencies.orders.applySettlement(
			medicalOrder.medicalOrderId,
			medicalOrder.version,
			{
				status: "insurance_settled",
				ordStas: medicalOrder.ordStas,
				amounts: medicalOrder.amounts,
				setlType: medicalOrder.setlType,
				revsTokenHash: medicalOrder.revsTokenHash,
				revsTokenExpiresAt: medicalOrder.revsTokenExpiresAt,
				wechatOutTradeNo: settlement.plugin?.outTradeNo ?? null,
				wechatPaymentState: "cash_paid",
			},
		);
		if (
			!settled &&
			(await this.order(ownerUserId, medicalOrder.medicalOrderId)).status !==
				"insurance_settled"
		) {
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		this.logger.info(
			{
				event: "medical-insurance.plugin-settlement.completed",
				traceId: context.traceId,
				orderId: medicalOrder.medicalOrderId,
				paymentOrderId: paymentOrder.orderId,
				providerRequestId: trace.requestId,
			},
			"Medical insurance Yunhealth plugin settlement completed",
		);
		const writtenBack = await this.dependencies.paymentOrders.transition(
			ownerUserId,
			paymentOrder.orderId,
			"his_written_back",
		);
		return this.dependencies.paymentOrders.transition(
			ownerUserId,
			writtenBack.orderId,
			"completed",
		);
	}

	async create(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsurancePluginPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		let medicalOrder = await this.order(ownerUserId, orderId);
		if (
			!medicalOrder.amounts?.cashFen ||
			medicalOrder.status !== "cash_pending"
		) {
			if (medicalOrder.status === "insurance_settled") {
				const paymentOrder =
					await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
						ownerUserId,
						pluginOrderKey(orderId),
					);
				if (paymentOrder) return output(medicalOrder, paymentOrder);
			}
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment is not allowed for the current order",
			);
		}
		const { settlement } = await this.contexts(ownerUserId, medicalOrder);
		const existingPaymentOrder =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				pluginOrderKey(orderId),
			);
		if (settlement.plugin && !existingPaymentOrder) {
			throw new DependencyNotConfiguredError(
				"medical-insurance-plugin-payment",
			);
		}
		let paymentOrder =
			existingPaymentOrder ??
			(await this.dependencies.paymentOrders.createCashPending({
				ownerUserId,
				patientId: medicalOrder.patientId,
				idempotencyKey: pluginOrderKey(orderId),
				amounts: {
					totalFen: medicalOrder.amounts.cashFen,
					insuranceFen: 0,
					cashFen: medicalOrder.amounts.cashFen,
				},
			}));
		if (
			paymentOrder.state === "cash_paid" ||
			paymentOrder.state === "his_written_back"
		) {
			const completed = await this.complete(
				ownerUserId,
				medicalOrder,
				paymentOrder,
				settlement,
				input.context,
			);
			return output(medicalOrder, completed);
		}
		if (paymentOrder.state === "completed")
			return output(medicalOrder, paymentOrder);
		if (paymentOrder.state === "failed") {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment order must be reconciled before retry",
			);
		}
		const withPlugin = await this.ensurePluginOrder(
			ownerUserId,
			medicalOrder,
			settlement,
			paymentOrder,
			input.context,
		);
		const prepay = await this.dependencies.wechatPrepay.create({
			ownerUserId,
			orderId: paymentOrder.orderId,
			context: {
				traceId: input.context.traceId,
				idempotencyKey: pluginPrepayKey(orderId),
			},
		});
		const plugin = withPlugin.plugin;
		if (plugin && plugin.state !== "prepay_ready") {
			await this.dependencies.orders.saveSettlementContext(
				ownerUserId,
				orderId,
				{
					...withPlugin,
					plugin: { ...plugin, state: "prepay_ready" },
				},
			);
		}
		medicalOrder = await this.saveMedicalPaymentState(medicalOrder, {
			wechatOutTradeNo: paymentOrder.orderId,
			wechatPaymentState: "prepay_ready",
		});
		return output(medicalOrder, paymentOrder, prepay.payParams);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsurancePluginPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const medicalOrder = await this.order(ownerUserId, orderId);
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			orderId,
		);
		const plugin = settlement?.plugin;
		if (!settlement || !plugin)
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment context is not available",
			);
		let paymentOrder = await this.dependencies.paymentOrders.get(
			ownerUserId,
			plugin.paymentOrderId,
		);
		if (paymentOrder.state === "cash_pending") {
			await this.dependencies.wechatPrepay.reconcile({
				ownerUserId,
				orderId: paymentOrder.orderId,
				context: input.context,
			});
			paymentOrder = await this.dependencies.paymentOrders.get(
				ownerUserId,
				paymentOrder.orderId,
			);
		}
		if (paymentOrder.state === "cash_paid") {
			// reconcile 可能刚把支付单从 cash_pending 推进到 cash_paid；此时
			// 医保订单的 version 也可能已被后台通知或别的请求推进，不能继续
			// 使用 query 开始时的旧快照做 HIS 回写后的 CAS 更新。
			const currentMedicalOrder = await this.order(ownerUserId, orderId);
			paymentOrder = await this.complete(
				ownerUserId,
				currentMedicalOrder,
				paymentOrder,
				settlement,
				input.context,
			);
		}
		const currentMedicalOrder = await this.order(ownerUserId, orderId);
		return output(currentMedicalOrder, paymentOrder);
	}
}

export { PLUGIN_ORDER_PREFIX };
