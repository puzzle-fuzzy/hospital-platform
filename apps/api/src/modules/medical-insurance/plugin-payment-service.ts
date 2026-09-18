import { createHash } from "node:crypto";
import type {
	MedicalInsuranceOrderPayload,
	MedicalInsurancePluginPayPayload,
} from "@hospital/contracts";
import {
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsurancePostPaymentComponent,
	type MedicalInsuranceSettlementContext,
	medicalInsurancePaymentBreakdown,
	type PaymentOrder,
	PaymentOrderInputError,
	type PaymentOrderService,
	type RegistrationSelfPaySettlementContext,
	type UserIdentityRepository,
	type YunhealthMiniProgramPrepay,
	type YunhealthRegistrationPluginPaymentGateway,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";
import type { WechatPrepayService } from "../payments/service";
import { MedicalInsuranceRegistrationInputError } from "./errors";

const PLUGIN_ORDER_PREFIX = "registration-medical-plugin-self-pay:";
const PLUGIN_PREPAY_PREFIX = "registration-medical-plugin-prepay:";
const WECHAT_SELF_PAY_TYPE_ID = "5031";
/** 已经落库的旧流水只允许继续完成，不用于创建新的 2.6.65.2 微信自费流水。 */
const LEGACY_WECHAT_SELF_PAY_TYPE_IDS = new Set(["5", "50", "5027"]);

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

type CombinedPayTypeParam = NonNullable<
	MedicalInsurancePostPaymentComponent["payTypeParams"]
>[number];

function paymentLegs(input: {
	order: MedicalInsuranceOrder;
	insuredAreaCode: string;
}): readonly CombinedPayTypeParam[] {
	const amounts = input.order.amounts;
	if (!amounts) throw new Error("medical payment amounts are unavailable");
	if ((amounts.otherPaymentFen ?? 0) !== (amounts.hospitalPartFen ?? 0)) {
		throw new Error("medical-insurance-med-ins-other-fee-unmapped");
	}
	const breakdown = medicalInsurancePaymentBreakdown({
		amounts,
		orderType: input.order.orderType ?? "RegPay",
		insuredAreaCode: input.insuredAreaCode,
	});
	const hospitalReduceFen = breakdown.cashReduceDetails.reduce(
		(sum, detail) => sum + detail.cashReduceFen,
		0,
	);
	const hospitalPaymentFen = (amounts.hospitalPartFen ?? 0) + hospitalReduceFen;
	// HIS 要求 2.6.65.2 严格按医保统筹、优惠挂号、个人账户、微信自费的顺序写入。
	// 数组顺序就是合单 payTypeParams 的实际顺序，不能把医院优惠提前到医保统筹之前。
	const definitions: CombinedPayTypeParam[] = [
		{
			kind: "fund",
			amountFen: amounts.fundFen,
			payTypeId: "2",
		},
		{
			kind: "personal_account",
			amountFen: amounts.personalAccountFen,
			payTypeId: "5",
		},
		{
			kind: "wechat_cash",
			amountFen: breakdown.wechatCashFen,
			// 5031 是医保入口的自费记账分项，而不是众阳的小程序医保收银。
			// 实际微信收款随后由自有 APIv3/RSA 订单完成，不能在 .2 中附带 openid。
			payTypeId: "5031",
		},
	];
	if (hospitalPaymentFen > 0) {
		definitions.splice(1, 0, {
			kind: "hospital_reduce",
			amountFen: hospitalPaymentFen,
			payTypeId: "50",
		});
	}
	return definitions.filter((component) => component.amountFen > 0);
}

/** 新订单只发一个 .65.2；每种支付方式作为其内部 payTypeParams 保存。 */
function combinedPrePaymentComponents(input: {
	order: MedicalInsuranceOrder;
	insuredAreaCode: string;
	now: Date;
}): readonly MedicalInsurancePostPaymentComponent[] {
	const amounts = input.order.amounts;
	if (!amounts) throw new Error("medical payment amounts are unavailable");
	const payTypeParams = paymentLegs(input);
	if (
		payTypeParams.length === 0 ||
		payTypeParams.reduce((sum, component) => sum + component.amountFen, 0) !==
			amounts.totalFen
	) {
		throw new Error("medical-insurance-combined-payment-amount-mismatch");
	}
	return [
		{
			componentId: `${input.order.medicalOrderId}:combined`,
			kind: "combined",
			totalFen: amounts.totalFen,
			amountFen: amounts.totalFen,
			payModel: "H5",
			payTypeId: "2",
			payTypeParams,
			recordCode: stableCode(
				`medical-post-payment:${input.order.medicalOrderId}:combined`,
			),
			state: "pending",
			attempts: 0,
			updatedAt: input.now.toISOString(),
		},
	];
}

/** 发布前已持久化的拆分计划只能按原事实继续完成，不能自动合并。 */
function legacyPrePaymentComponents(input: {
	order: MedicalInsuranceOrder;
	insuredAreaCode: string;
	now: Date;
}): readonly MedicalInsurancePostPaymentComponent[] {
	const amounts = input.order.amounts;
	if (!amounts) throw new Error("medical payment amounts are unavailable");
	const definitions = paymentLegs(input);
	return definitions.map((component) => ({
		componentId: `${input.order.medicalOrderId}:${component.kind}`,
		kind: component.kind,
		totalFen: amounts.totalFen,
		amountFen: component.amountFen,
		payModel: "H5" as const,
		payTypeId: component.payTypeId,
		recordCode: stableCode(
			`medical-post-payment:${input.order.medicalOrderId}:${component.kind}`,
		),
		state: "pending" as const,
		attempts: 0,
		updatedAt: input.now.toISOString(),
	}));
}

function samePayTypeParams(
	left: MedicalInsurancePostPaymentComponent["payTypeParams"],
	right: MedicalInsurancePostPaymentComponent["payTypeParams"],
): boolean {
	const leftParams = left ?? [];
	const rightParams = right ?? [];
	return (
		leftParams.length === rightParams.length &&
		leftParams.every(
			(parameter, index) =>
				parameter.kind === rightParams[index]?.kind &&
				parameter.payTypeId === rightParams[index]?.payTypeId &&
				parameter.amountFen === rightParams[index]?.amountFen,
		)
	);
}

function samePrePaymentComponent(
	left: MedicalInsurancePostPaymentComponent,
	right: MedicalInsurancePostPaymentComponent,
): boolean {
	return (
		left.componentId === right.componentId &&
		left.kind === right.kind &&
		left.totalFen === right.totalFen &&
		left.amountFen === right.amountFen &&
		left.payModel === right.payModel &&
		left.payTypeId === right.payTypeId &&
		samePayTypeParams(left.payTypeParams, right.payTypeParams) &&
		left.recordCode === right.recordCode
	);
}

function samePrePaymentPlan(
	saved: readonly MedicalInsurancePostPaymentComponent[],
	planned: readonly MedicalInsurancePostPaymentComponent[],
): boolean {
	return (
		saved.length === planned.length &&
		planned.every((plannedComponent) =>
			saved.some((savedComponent) =>
				samePrePaymentComponent(savedComponent, plannedComponent),
			),
		)
	);
}

/**
 * 仅修复本次发布产生的失败记录：5031 被错误以 MINI_PROGRAM 提交时，
 * Provider 在未创建任何可继续完成的交易前即拒绝。其他历史流水一律不迁移，
 * 避免改写已成功、进行中或结果未知的支付事实。
 */
function migrateRejectedMiniProgramWechatCashPlan(
	saved: readonly MedicalInsurancePostPaymentComponent[],
	planned: readonly MedicalInsurancePostPaymentComponent[],
): MedicalInsurancePostPaymentComponent[] | undefined {
	if (saved.length !== planned.length) return undefined;
	const plannedById = new Map(
		planned.map((component) => [component.componentId, component]),
	);
	if (plannedById.size !== planned.length) return undefined;

	let migrated = false;
	const seen = new Set<string>();
	const components: MedicalInsurancePostPaymentComponent[] = [];
	for (const savedComponent of saved) {
		if (seen.has(savedComponent.componentId)) return undefined;
		seen.add(savedComponent.componentId);
		const plannedComponent = plannedById.get(savedComponent.componentId);
		if (!plannedComponent) return undefined;
		if (samePrePaymentComponent(savedComponent, plannedComponent)) {
			components.push(savedComponent);
			continue;
		}
		if (
			migrated ||
			savedComponent.kind !== "wechat_cash" ||
			plannedComponent.kind !== "wechat_cash" ||
			savedComponent.payTypeId !== WECHAT_SELF_PAY_TYPE_ID ||
			plannedComponent.payTypeId !== WECHAT_SELF_PAY_TYPE_ID ||
			savedComponent.payModel !== "MINI_PROGRAM" ||
			plannedComponent.payModel !== "H5" ||
			savedComponent.state !== "failed" ||
			savedComponent.payingId ||
			savedComponent.tradingId ||
			savedComponent.providerRequestId ||
			savedComponent.payParams ||
			savedComponent.wechatOutTradeNo ||
			savedComponent.totalFen !== plannedComponent.totalFen ||
			savedComponent.amountFen !== plannedComponent.amountFen ||
			savedComponent.recordCode !== plannedComponent.recordCode
		) {
			return undefined;
		}
		migrated = true;
		components.push({
			...plannedComponent,
			state: "failed",
			attempts: savedComponent.attempts,
			updatedAt: savedComponent.updatedAt,
		});
	}
	return migrated ? components : undefined;
}

function pluginOrderKey(medicalOrderId: string): string {
	return `${PLUGIN_ORDER_PREFIX}${medicalOrderId}`;
}

function pluginPrepayKey(medicalOrderId: string): string {
	return `${PLUGIN_PREPAY_PREFIX}${medicalOrderId}`;
}

function pluginPayTypeIdForOrder(configuredPayTypeId: string): string {
	if (configuredPayTypeId !== WECHAT_SELF_PAY_TYPE_ID) {
		throw new DependencyNotConfiguredError(
			"yunhealth-wechat-self-pay-type-id-5031",
		);
	}
	return WECHAT_SELF_PAY_TYPE_ID;
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

function medicalOrderOutput(
	medicalOrder: MedicalInsuranceOrder,
): MedicalInsuranceOrderPayload["data"] {
	return {
		orderId: medicalOrder.medicalOrderId,
		status: medicalOrder.status,
		...(medicalOrder.amounts
			? {
					amounts: {
						totalFen: medicalOrder.amounts.totalFen,
						insuranceFen:
							medicalOrder.amounts.personalAccountFen +
							medicalOrder.amounts.fundFen +
							(medicalOrder.amounts.otherPaymentFen ?? 0),
						cashFen: medicalOrder.amounts.cashFen,
					},
				}
			: {}),
	};
}

function prepayIdFromPackage(packageValue: string): string | undefined {
	const prefix = "prepay_id=";
	return packageValue.startsWith(prefix)
		? packageValue.slice(prefix.length).trim() || undefined
		: undefined;
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
 * 云健康医保支付联调编排。当前顺序是在官方微信医保支付前按 6202
 * 分项调用 .2；支付成功后由 Worker 依次调用 .32、.5，旧 plugin 上下文继续兼容。
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
		settlement: MedicalInsuranceSettlementContext;
		openid: string;
	}> {
		if (!order.authorizationId || !order.payOrdId || !order.amounts) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment is not allowed for the current order",
			);
		}
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			order.medicalOrderId,
		);
		const identity =
			await this.dependencies.identityUsers.findByUserId(ownerUserId);
		if (!settlement || !identity?.providerSubject) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment context is not available",
			);
		}
		return { settlement, openid: identity.providerSubject };
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
		settlement: MedicalInsuranceSettlementContext,
		paymentOrder: PaymentOrder,
		options: { outTradeNo?: string } = {},
	): Promise<MedicalInsuranceSettlementContext> {
		const existing = settlement.plugin;
		const expectedPayTypeId = pluginPayTypeIdForOrder(
			this.dependencies.pluginPayTypeId,
		);
		if (existing) {
			if (existing.paymentOrderId !== paymentOrder.orderId) {
				throw new PaymentOrderInputError(
					"Medical insurance plugin payment order does not match the saved context",
				);
			}
			if (options.outTradeNo && existing.outTradeNo !== options.outTradeNo) {
				throw new PaymentOrderInputError(
					"Medical insurance plugin outTradeNo does not match the saved context",
				);
			}
			if (
				existing.payTypeId !== expectedPayTypeId &&
				!LEGACY_WECHAT_SELF_PAY_TYPE_IDS.has(existing.payTypeId)
			) {
				throw new PaymentOrderInputError(
					"Medical insurance plugin payTypeId does not match the current or legacy WeChat self-pay mapping",
				);
			}
			return settlement;
		}
		throw new MedicalInsuranceRegistrationInputError(
			"Fresh medical insurance plugin pre-order is disabled",
		);
	}

	/** 保存官方微信 v3 混合预支付证据；不把 paySign 等调起字段写入插件上下文。 */
	async markOfficialWechatPrepayReady(input: {
		ownerUserId: string;
		orderId: string;
		outTradeNo: string;
		prepayId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<void> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const outTradeNo = opaque(input.outTradeNo, "outTradeNo");
		const prepayId = opaque(input.prepayId, "prepayId");
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			orderId,
		);
		const plugin = settlement?.plugin;
		if (!plugin || plugin.outTradeNo !== outTradeNo) {
			throw new DependencyNotConfiguredError(
				"medical-insurance-plugin-payment",
			);
		}
		const state = [
			"cash_paid",
			"29_succeeded",
			"15_succeeded",
			"settled",
		].includes(plugin.state)
			? plugin.state
			: "prepay_ready";
		await this.dependencies.orders.saveSettlementContext(ownerUserId, orderId, {
			...settlement,
			plugin: { ...plugin, prepayId, state },
		});
		this.logger.info(
			{
				event: "medical-insurance.plugin-prepay.persisted",
				traceId: input.context.traceId,
				orderId,
				outTradeNo,
				payingId: plugin.payingId,
				tradingId: plugin.tradingId,
				prepayId,
				pluginState: state,
			},
			"Medical insurance WeChat mixed prepay evidence persisted",
		);
	}

	/**
	 * 新订单先以一个合单 .2 固化全部非零 6202 支付腿，之后才允许创建微信
	 * 订单。发布前已经拆分保存的计划只按原事实续跑，绝不在半途重组。
	 */
	async prepareSplitPaymentsBeforeOfficialWechatPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<{ cashPrepay?: YunhealthMiniProgramPrepay }> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const medicalOrder = await this.order(ownerUserId, orderId);
		if (medicalOrder.status !== "cash_pending" || !medicalOrder.amounts) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance pre-payment components are not allowed for the current order",
			);
		}
		const { settlement: loadedSettlement, openid } = await this.contexts(
			ownerUserId,
			medicalOrder,
		);
		if (!loadedSettlement.insuredAreaCode || !loadedSettlement.businessCode) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance pre-payment component context is incomplete",
			);
		}
		const combinedPlan = combinedPrePaymentComponents({
			order: medicalOrder,
			insuredAreaCode: loadedSettlement.insuredAreaCode,
			now: this.now(),
		});
		let planned = combinedPlan;
		let settlement = loadedSettlement;
		const saved = settlement.postPaymentComponents;
		if (saved) {
			if (saved.some((component) => component.kind === "combined")) {
				if (!samePrePaymentPlan(saved, combinedPlan)) {
					throw new Error("medical-insurance-pre-payment-plan-changed");
				}
			} else {
				// 历史拆分计划可能已经有真实 Provider 流水；不能改成一个新的
				// recordCode 或复用新的 idempotency key，否则会丢失不可逆支付事实。
				planned = legacyPrePaymentComponents({
					order: medicalOrder,
					insuredAreaCode: loadedSettlement.insuredAreaCode,
					now: this.now(),
				});
				if (!samePrePaymentPlan(saved, planned)) {
					const migrated = migrateRejectedMiniProgramWechatCashPlan(
						saved,
						planned,
					);
					if (!migrated) {
						throw new Error("medical-insurance-pre-payment-plan-changed");
					}
					settlement = { ...settlement, postPaymentComponents: migrated };
					await this.dependencies.orders.saveSettlementContext(
						ownerUserId,
						orderId,
						settlement,
					);
				}
			}
		} else {
			settlement = { ...settlement, postPaymentComponents: combinedPlan };
			await this.dependencies.orders.saveSettlementContext(
				ownerUserId,
				orderId,
				settlement,
			);
		}

		const combinedComponent = planned[0];
		if (planned.length === 1 && combinedComponent?.kind === "combined") {
			settlement =
				(await this.dependencies.orders.getSettlementContext(
					ownerUserId,
					orderId,
				)) ?? settlement;
			const components: MedicalInsurancePostPaymentComponent[] = [
				...(settlement.postPaymentComponents ?? planned),
			];
			const index = components.findIndex(
				(component) => component.componentId === combinedComponent.componentId,
			);
			const current = components[index];
			if (current?.kind !== "combined") {
				throw new Error("medical-insurance-combined-pre-payment-missing");
			}
			if (current.state === "succeeded") return {};
			const payTypeParams = current.payTypeParams;
			if (!payTypeParams?.length) {
				throw new Error(
					"medical-insurance-combined-pre-payment-params-missing",
				);
			}
			const attempted: MedicalInsurancePostPaymentComponent = {
				...current,
				state: "pending",
				attempts: current.attempts + 1,
				updatedAt: this.now().toISOString(),
			};
			components[index] = attempted;
			settlement = { ...settlement, postPaymentComponents: components };
			await this.dependencies.orders.saveSettlementContext(
				ownerUserId,
				orderId,
				settlement,
			);

			try {
				const result = await this.dependencies.pluginPayment.createPreOrder(
					{
						orderId: attempted.componentId,
						businessId: settlement.businessId,
						tradeCode: loadedSettlement.businessCode,
						totalFen: attempted.totalFen,
						hospitalId: settlement.hospitalId,
						patientId: settlement.patientId,
						payTypeId: "2",
						payModel: "H5",
						payTypeParams: payTypeParams.map(({ payTypeId, amountFen }) => ({
							payTypeId,
							amountFen,
						})),
						payType: this.dependencies.pluginPayType,
						workStationId: this.dependencies.pluginWorkStationId,
						recordCode: attempted.recordCode,
						tradeTypeCode:
							medicalOrder.businessType === "outpatient"
								? "2"
								: this.dependencies.pluginTradeTypeCode,
					},
					{
						...input.context,
						idempotencyKey: `medical-post-payment:${attempted.componentId}`,
					},
				);
				components[index] = {
					...attempted,
					state: "succeeded",
					payingId: result.payingId,
					tradingId: result.tradingId,
					providerRequestId: result.trace.requestId,
					updatedAt: this.now().toISOString(),
				};
				settlement = {
					...settlement,
					payingId: result.payingId,
					tradingId: result.tradingId,
					postPaymentComponents: components,
				};
				await this.dependencies.orders.saveSettlementContext(
					ownerUserId,
					orderId,
					settlement,
				);
				this.logger.info(
					{
						event: "medical-insurance.pre-payment.combined.succeeded",
						traceId: input.context.traceId,
						orderId,
						amountFen: attempted.amountFen,
						payTypeParamCount: payTypeParams.length,
						providerRequestId: result.trace.requestId,
					},
					"Medical insurance combined pre-payment persisted before WeChat",
				);
				return {};
			} catch (error) {
				const metadata = providerFailureMetadata(error);
				components[index] = {
					...attempted,
					state: "failed",
					lastErrorCode:
						metadata.providerErrorCode ??
						metadata.providerFailureReason ??
						"pre-payment-combined-failed",
					updatedAt: this.now().toISOString(),
				};
				await this.dependencies.orders.saveSettlementContext(
					ownerUserId,
					orderId,
					{ ...settlement, postPaymentComponents: components },
				);
				throw error;
			}
		}

		for (const plannedComponent of planned) {
			settlement =
				(await this.dependencies.orders.getSettlementContext(
					ownerUserId,
					orderId,
				)) ?? settlement;
			const components: MedicalInsurancePostPaymentComponent[] = [
				...(settlement.postPaymentComponents ?? planned),
			];
			const index = components.findIndex(
				(component) => component.componentId === plannedComponent.componentId,
			);
			const current = components[index];
			if (!current) {
				throw new Error("medical-insurance-pre-payment-component-missing");
			}
			if (current.state === "succeeded") continue;

			const attempted: MedicalInsurancePostPaymentComponent = {
				...current,
				state: "pending",
				attempts: current.attempts + 1,
				updatedAt: this.now().toISOString(),
			};
			components[index] = attempted;
			settlement = { ...settlement, postPaymentComponents: components };
			await this.dependencies.orders.saveSettlementContext(
				ownerUserId,
				orderId,
				settlement,
			);

			try {
				const result = await this.dependencies.pluginPayment.createPreOrder(
					{
						orderId: attempted.componentId,
						businessId: settlement.businessId,
						tradeCode: loadedSettlement.businessCode,
						totalFen: attempted.totalFen,
						amountFen: attempted.amountFen,
						hospitalId: settlement.hospitalId,
						patientId: settlement.patientId,
						payTypeId: attempted.payTypeId,
						payModel: attempted.payModel,
						...(attempted.payModel === "MINI_PROGRAM"
							? { paymentSystemUserId: openid }
							: {}),
						payType: this.dependencies.pluginPayType,
						workStationId: this.dependencies.pluginWorkStationId,
						recordCode: attempted.recordCode,
						// 众阳 2.6.65.2 的门诊交易类型固定为 2；挂号继续沿用服务端配置。
						tradeTypeCode:
							medicalOrder.businessType === "outpatient"
								? "2"
								: this.dependencies.pluginTradeTypeCode,
					},
					{
						...input.context,
						idempotencyKey: `medical-post-payment:${attempted.componentId}`,
					},
				);
				components[index] = {
					...attempted,
					state: "succeeded",
					payingId: result.payingId,
					tradingId: result.tradingId,
					providerRequestId: result.trace.requestId,
					...(result.payParams
						? {
								payParams: result.payParams,
								wechatOutTradeNo: result.outTradeNo,
							}
						: {}),
					updatedAt: this.now().toISOString(),
				};
				// .32 的 PayNotifyService 只接受医保统筹分项（payTypeId=2）
				// 的 payingId/tradingId。不能让后续的医院减免、个账或微信
				// 分项覆盖结算上下文的主流水关联键。
				const primaryMedicalComponent = components.find(
					(component) =>
						component.kind === "fund" &&
						component.payTypeId === "2" &&
						component.state === "succeeded" &&
						component.payingId &&
						component.tradingId,
				);
				const primaryPayingId =
					primaryMedicalComponent?.payingId ??
					settlement.payingId ??
					result.payingId;
				const primaryTradingId =
					primaryMedicalComponent?.tradingId ??
					settlement.tradingId ??
					result.tradingId;
				settlement = {
					...settlement,
					...(primaryPayingId && primaryTradingId
						? { payingId: primaryPayingId, tradingId: primaryTradingId }
						: {}),
					postPaymentComponents: components,
				};
				await this.dependencies.orders.saveSettlementContext(
					ownerUserId,
					orderId,
					settlement,
				);
				this.logger.info(
					{
						event: "medical-insurance.pre-payment-component.succeeded",
						traceId: input.context.traceId,
						orderId,
						component: attempted.kind,
						amountFen: attempted.amountFen,
						payModel: attempted.payModel,
						payTypeId: attempted.payTypeId,
						providerRequestId: result.trace.requestId,
					},
					"Medical insurance pre-payment component persisted before WeChat",
				);
			} catch (error) {
				const metadata = providerFailureMetadata(error);
				components[index] = {
					...attempted,
					state: "failed",
					lastErrorCode:
						metadata.providerErrorCode ??
						metadata.providerFailureReason ??
						"pre-payment-component-failed",
					updatedAt: this.now().toISOString(),
				};
				await this.dependencies.orders.saveSettlementContext(
					ownerUserId,
					orderId,
					{ ...settlement, postPaymentComponents: components },
				);
				throw error;
			}
		}
		// 微信现金分项只在这里建立 Provider 的 5031 关联流水；实际收款由
		// 自有微信 APIv3/RSA 订单完成，不再复用 .2 返回的旧 MD5 参数。
		return {};
	}

	/** 仅续跑发布前已经存在 plugin 上下文的旧订单。 */
	async prepareForOfficialWechatPayment(input: {
		ownerUserId: string;
		orderId: string;
		outTradeNo: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<void> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		const requestedOutTradeNo = opaque(input.outTradeNo, "outTradeNo");
		const medicalOrder = await this.order(ownerUserId, orderId);
		if (
			!medicalOrder.amounts?.cashFen ||
			medicalOrder.status !== "cash_pending"
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment is not allowed for the current order",
			);
		}
		const { settlement } = await this.contexts(ownerUserId, medicalOrder);
		if (!settlement.plugin) {
			throw new MedicalInsuranceRegistrationInputError(
				"Fresh medical insurance plugin pre-order is disabled",
			);
		}
		const existingPaymentOrder =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				pluginOrderKey(orderId),
			);
		if (!existingPaymentOrder) {
			throw new DependencyNotConfiguredError(
				"medical-insurance-plugin-payment",
			);
		}
		const paymentOrder = existingPaymentOrder;
		if (paymentOrder.state === "failed" || paymentOrder.state === "cancelled") {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment order must be reconciled before retry",
			);
		}
		const withPlugin = await this.ensurePluginOrder(settlement, paymentOrder, {
			outTradeNo: requestedOutTradeNo,
		});
		this.logger.info(
			{
				event: "medical-insurance.plugin-preorder.ready-for-wechat-mix",
				traceId: input.context.traceId,
				orderId,
				paymentOrderId: paymentOrder.orderId,
				outTradeNo: withPlugin.plugin?.outTradeNo,
				payingId: withPlugin.plugin?.payingId,
				tradingId: withPlugin.plugin?.tradingId,
				recordCode: withPlugin.plugin?.recordCode,
				pluginState: withPlugin.plugin?.state,
			},
			"Medical insurance Yunhealth plugin context is ready for WeChat mixed payment",
		);
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
					this.logger.info(
						{
							event: "medical-insurance.plugin.2.27.2.29.persisted",
							traceId: context.traceId,
							orderId: medicalOrder.medicalOrderId,
							paymentOrderId: paymentOrder.orderId,
							payingId: currentPlugin.payingId,
							tradingId: currentPlugin.tradingId,
							thirdPartPayRecordId,
							rawResponseBytes: new TextEncoder().encode(rawResponse)
								.byteLength,
							rawResponseSha256: createHash("sha256")
								.update(rawResponse)
								.digest("hex"),
						},
						"Medical insurance Yunhealth 2.27.2.29 raw response persisted",
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
				providerRequestIds: trace.requestIds,
				pluginState: "settled",
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

	/**
	 * 官方微信 APIv3 混合查单确认后，推进内部插件支付单并执行 .29 → .15 → .5。
	 * 只有这三个 Provider 步骤全部成功，医保订单才会进入 insurance_settled。
	 */
	async completeOfficialWechatPayment(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsuranceOrderPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		let medicalOrder = await this.order(ownerUserId, orderId);
		let settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			orderId,
		);
		if (!settlement?.plugin) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment context is not available",
			);
		}
		let paymentOrder = await this.dependencies.paymentOrders.get(
			ownerUserId,
			settlement.plugin.paymentOrderId,
		);
		if (paymentOrder.state === "cash_pending") {
			paymentOrder = await this.dependencies.paymentOrders.transition(
				ownerUserId,
				paymentOrder.orderId,
				"cash_paid",
			);
			const currentPlugin = settlement.plugin;
			if (
				currentPlugin.state === "preorder_created" ||
				currentPlugin.state === "prepay_ready"
			) {
				settlement = {
					...settlement,
					plugin: { ...currentPlugin, state: "cash_paid" },
				};
				await this.dependencies.orders.saveSettlementContext(
					ownerUserId,
					orderId,
					settlement,
				);
			}
		}
		if (
			paymentOrder.state !== "cash_paid" &&
			paymentOrder.state !== "his_written_back" &&
			paymentOrder.state !== "completed"
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin payment has not been confirmed by WeChat",
			);
		}
		medicalOrder = await this.order(ownerUserId, orderId);
		paymentOrder = await this.complete(
			ownerUserId,
			medicalOrder,
			paymentOrder,
			settlement,
			input.context,
		);
		const current = await this.order(ownerUserId, orderId);
		this.logger.info(
			{
				event: "medical-insurance.plugin-settlement.completed-for-wechat-mix",
				traceId: input.context.traceId,
				orderId,
				paymentOrderId: paymentOrder.orderId,
				paymentState: paymentOrder.state,
				medicalOrderStatus: current.status,
			},
			"Medical insurance WeChat mixed payment Yunhealth settlement completed",
		);
		return medicalOrderOutput(current);
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
		if (!settlement.plugin) {
			// 公开旧入口仍需保留给存量订单查询/续跑，但新订单绝不能在
			// 用户付款前创建 2.6.65.2 流水。
			throw new MedicalInsuranceRegistrationInputError(
				"Fresh medical insurance plugin pre-order is disabled",
			);
		}
		const existingPaymentOrder =
			await this.dependencies.paymentOrders.findByOwnerAndIdempotencyKey(
				ownerUserId,
				pluginOrderKey(orderId),
			);
		if (!existingPaymentOrder) {
			throw new DependencyNotConfiguredError(
				"medical-insurance-plugin-payment",
			);
		}
		const paymentOrder = existingPaymentOrder;
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
		const withPlugin = await this.ensurePluginOrder(settlement, paymentOrder);
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
		if (plugin) {
			const prepayId = prepayIdFromPackage(prepay.payParams.package);
			if (prepayId) {
				await this.markOfficialWechatPrepayReady({
					ownerUserId,
					orderId,
					outTradeNo: paymentOrder.orderId,
					prepayId,
					context: input.context,
				});
			}
		}
		medicalOrder = await this.saveMedicalPaymentState(medicalOrder, {
			wechatOutTradeNo: paymentOrder.orderId,
			wechatPaymentState: "prepay_ready",
		});
		if ("mode" in prepay.payParams) {
			throw new MedicalInsuranceRegistrationInputError(
				"Medical insurance plugin requires native Wechat payment parameters",
			);
		}
		return output(medicalOrder, paymentOrder, prepay.payParams);
	}

	async query(input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<MedicalInsurancePluginPayPayload["data"]> {
		const ownerUserId = opaque(input.ownerUserId, "ownerUserId");
		const orderId = opaque(input.orderId, "orderId");
		await this.order(ownerUserId, orderId);
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
