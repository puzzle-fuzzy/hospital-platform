import type {
	MedicalInsuranceOrderPayload,
	MedicalInsuranceWechatPayPayload,
} from "@hospital/contracts";
import {
	type AppointmentPatientProfileGateway,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	isMedicalInsuranceOrderType,
	type MedicalInsuranceAuthorizationContext,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceQueryTaskRepository,
	type MedicalInsuranceSettlementContext,
	type MedicalInsuranceWechatPaymentGateway,
	type MedicalInsuranceWechatPaymentIdentity,
	medicalInsuranceOrderTypeForBusiness,
	medicalInsurancePaymentBreakdown,
	type PatientRepository,
	type UserIdentityRepository,
	type WechatPaymentNotification,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";
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

export class MedicalInsuranceWechatPrepayExpiredError extends Error {
	constructor() {
		super("Medical insurance WeChat prepay parameters have expired");
		this.name = "MedicalInsuranceWechatPrepayExpiredError";
	}
}

export type MedicalInsuranceWechatNotification = {
	notificationId: string;
	eventType: "MEDICAL_INSURANCE.SUCCESS";
	mixTradeNo: string;
	outTradeNo: string;
	totalFen: number;
	cashFen: number;
	fundFen: number;
	personalAccountFen: number;
	otherPaymentFen: number;
	medicalCashFen: number;
	cashReduceDetails: readonly {
		cashReduceFen: number;
		cashReduceType: string;
	}[];
	mixPayType: "INSURANCE_ONLY" | "CASH_AND_INSURANCE";
	selfPayStatus: "SELF_PAY_SUCCESS" | "NO_SELF_PAY";
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
		...(order.medInsFailReason
			? { medInsFailReason: order.medInsFailReason }
			: {}),
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

const WECHAT_PREPAY_VALIDITY_MS = 2 * 60 * 60 * 1000;

function prepayExpiresAt(order: MedicalInsuranceOrder): number {
	const explicit = order.wechatPrepayExpiresAt
		? Date.parse(order.wechatPrepayExpiresAt)
		: Number.NaN;
	if (Number.isFinite(explicit)) return explicit;
	// 0038 以前的订单没有到期字段；用最后一次写入时间做保守兼容，避免
	// 发布窗口内把仍有效的参数立即判废，也绝不无限复用。
	const updatedAt = Date.parse(order.updatedAt);
	return Number.isFinite(updatedAt)
		? updatedAt + WECHAT_PREPAY_VALIDITY_MS
		: Number.NaN;
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
	queryTasks: MedicalInsuranceQueryTaskRepository;
	authorizations: import("@hospital/domain").MedicalInsuranceAuthorizationRepository;
	identityUsers: UserIdentityRepository;
	patients: PatientRepository;
	patientProfile?: AppointmentPatientProfileGateway;
	wechatPayment: MedicalInsuranceWechatPaymentGateway;
	/** 微信现金支付确认后回到统一医保订单核心，而不是绑定挂号 service。 */
	confirmCashPayment: (input: {
		ownerUserId: string;
		orderId: string;
		context: { traceId: string; idempotencyKey: string };
	}) => Promise<MedicalInsuranceOrderPayload["data"]>;
	/** 云健康后置链路的启用标记；页面查单只唤醒 Worker，避免并发回写。 */
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

	private async requeue(orderId: string): Promise<void> {
		await this.dependencies.queryTasks.requeue(orderId, this.now());
	}

	private async paymentIdentity(
		order: MedicalInsuranceOrder,
		authorization: MedicalInsuranceAuthorizationContext,
	): Promise<MedicalInsuranceWechatPaymentIdentity> {
		const patients = await this.dependencies.patients.listByOwner(
			order.ownerUserId,
		);
		const patient = patients.find(
			(candidate) => candidate.id === order.patientId,
		);
		if (!patient) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const selectedIdentity = {
			name: authorization.patient.userName,
			idNo: authorization.patient.idNo,
		};
		const payForRelatives = authorization.payForRelatives === true;
		if (
			(patient.relationship === "self" && payForRelatives) ||
			(patient.relationship !== "self" &&
				patient.relationship !== "unknown" &&
				!payForRelatives)
		) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		if (!payForRelatives) {
			return {
				payForRelatives: false,
				payer: selectedIdentity,
			};
		}
		const payer = authorization.payer;
		if (!payer?.userName.trim() || !payer.idNo.trim()) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		return {
			payForRelatives: true,
			payer: {
				name: payer.userName,
				idNo: payer.idNo,
			},
			relative: selectedIdentity,
		};
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
		return {
			authorization,
			settlement,
			openid: identity.providerSubject,
		};
	}

	private async completeOfficialPayment(
		order: MedicalInsuranceOrder,
		input: {
			ownerUserId: string;
			orderId: string;
			context: { traceId: string; idempotencyKey: string };
		},
	): Promise<MedicalInsuranceOrderPayload["data"]> {
		if (
			this.dependencies.pluginPaymentBridge &&
			(order.amounts?.cashFen ?? 0) > 0
		) {
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
		// 已完成医院回写的终态不能再被后续查单结果降级或改成待人工处理。
		if (order.status === "insurance_settled") return output(order, false);
		const { businessType, orderType } = orderBusiness(order);
		if (order.wechatPaymentState === "prepay_ready" && order.wechatPayParams) {
			const hasWechatCash =
				(order.amounts?.cashFen ?? 0) - (order.amounts?.hospitalPartFen ?? 0) >
				0;
			const expiresAt = hasWechatCash
				? prepayExpiresAt(order)
				: Number.POSITIVE_INFINITY;
			if (
				hasWechatCash &&
				(!Number.isFinite(expiresAt) || expiresAt <= this.now().getTime())
			) {
				const reconciled = await this.query(input);
				if (
					reconciled.status === "insurance_settled" ||
					reconciled.status === "manual_review" ||
					reconciled.status === "failed" ||
					reconciled.paymentState === "failed"
				) {
					return reconciled;
				}
				throw new MedicalInsuranceWechatPrepayExpiredError();
			}
			await this.requeue(orderId);
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
			// 历史版本可能只凭普通 JSAPI 查单写入 cash_paid；任何续跑都先重新
			// 查询官方混合订单，不能直接执行 .29/.15/.5。
			return this.query(input);
		}
		if (order.status !== "cash_pending" || !order.amounts) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const paymentAmounts = order.amounts;
		const paymentPayOrdId = order.payOrdId as string;
		const paymentMedOrgOrd = order.medOrgOrd;
		const medicalOrderCreateTime = order.createdAt;
		const { authorization, settlement, openid } = await this.contexts(
			order,
			ownerUserId,
		);
		const paymentIdentity = await this.paymentIdentity(order, authorization);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: paymentAmounts,
			orderType,
			insuredAreaCode: authorization.insuplcAdmdvs,
		});
		const paymentOutTradeNo = order.wechatOutTradeNo ?? outTradeNo(orderId);
		const paymentPrepayExpiresAt =
			breakdown.wechatCashFen > 0
				? (order.wechatPrepayExpiresAt ??
					new Date(
						this.now().getTime() + WECHAT_PREPAY_VALIDITY_MS,
					).toISOString())
				: null;
		let recoverFirst =
			order.wechatPaymentState === "unknown" &&
			order.wechatOutTradeNo === paymentOutTradeNo;
		if (!recoverFirst) {
			// Provider 调用前先持久化稳定 out_trade_no 和“创建结果未知”事实。
			// 如果进程在微信已建单、本地尚未保存 mix_trade_no 之间退出，下一次
			// 请求会先走官方 out_trade_no 查单，不会先创建第二个 JSAPI/医保单。
			const marked = await this.dependencies.orders.applySettlement(
				order.medicalOrderId,
				order.version,
				{
					...settlementPatch(order),
					wechatOutTradeNo: paymentOutTradeNo,
					wechatPrepayExpiresAt: paymentPrepayExpiresAt,
					wechatPaymentState: "unknown",
				},
			);
			if (marked) {
				order = marked;
				// Provider 调用前即放入补偿队列；即使 API 进程随后退出，Worker
				// 也会只查不建地恢复已经存在的官方医保订单。
				await this.requeue(orderId);
			} else {
				order = await this.order(ownerUserId, orderId);
				if (
					order.wechatPaymentState === "prepay_ready" &&
					order.wechatPayParams &&
					order.wechatMixTradeNo
				) {
					await this.requeue(orderId);
					return output(order);
				}
				recoverFirst =
					order.wechatPaymentState === "unknown" &&
					order.wechatOutTradeNo === paymentOutTradeNo;
				if (!recoverFirst) {
					throw new DependencyNotConfiguredError("medical-insurance-orders");
				}
			}
		}
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.requested",
				traceId: input.context.traceId,
				ownerUserId,
				orderId,
				cashFen: breakdown.wechatCashFen,
				payForRelatives: paymentIdentity.payForRelatives,
				mixPayType:
					breakdown.wechatCashFen === 0
						? "INSURANCE_ONLY"
						: "CASH_AND_INSURANCE",
				businessType,
				orderType,
			},
			"Medical insurance WeChat mixed payment requested",
		);
		const result = await this.dependencies.wechatPayment.createMixedOrder(
			{
				orderId,
				outTradeNo: paymentOutTradeNo,
				...(recoverFirst ? { recoverFirst: true } : {}),
				openid,
				payOrdId: paymentPayOrdId,
				medOrgOrd: paymentMedOrgOrd,
				orderType,
				amounts: paymentAmounts,
				medicalOrderCreateTime,
				authorization,
				settlement,
				paymentIdentity,
			},
			input.context,
		);
		if (result.cashFen !== breakdown.wechatCashFen) {
			throw new MedicalInsuranceWechatPaymentNotAllowedError();
		}
		const recoveredPrepayExpired = Boolean(
			result.prepayId &&
				(!paymentPrepayExpiresAt ||
					Date.parse(paymentPrepayExpiresAt) <= this.now().getTime()),
		);
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...settlementPatch(order),
				wechatMixTradeNo: result.mixTradeNo,
				wechatOutTradeNo: paymentOutTradeNo,
				wechatPayParams: recoveredPrepayExpired ? null : result.payParams,
				wechatPrepayExpiresAt: result.prepayId ? paymentPrepayExpiresAt : null,
				wechatPaymentState: recoveredPrepayExpired ? "unknown" : "prepay_ready",
			},
		);
		if (!updated) {
			order = await this.order(ownerUserId, orderId);
			if (
				order.wechatPayParams &&
				order.wechatMixTradeNo &&
				((order.amounts?.cashFen ?? 0) -
					(order.amounts?.hospitalPartFen ?? 0) ===
					0 ||
					prepayExpiresAt(order) > this.now().getTime())
			) {
				await this.requeue(orderId);
				return output(order);
			}
			throw new DependencyNotConfiguredError("medical-insurance-orders");
		}
		await this.requeue(orderId);
		if (recoveredPrepayExpired) {
			// 先保存找回的 mix_trade_no 供 Worker 查单，但绝不把超过官方两小时
			// 有效期的 prepay_id 重新签名返回给小程序。取消/重建在下一步闭环。
			throw new MedicalInsuranceWechatPrepayExpiredError();
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
		// 已完成医院回写的终态不能再被后续查单结果降级或改成待人工处理。
		if (order.status === "insurance_settled") return output(order, false);
		const { businessType, orderType } = orderBusiness(order);
		if (
			!order.wechatMixTradeNo ||
			!order.wechatOutTradeNo ||
			!order.payOrdId ||
			!order.amounts
		) {
			return output(order, false);
		}
		if (this.dependencies.pluginPaymentBridge) {
			// 云健康回写链路启用时，官方混合查单只能由持久化 Worker 串行
			// 执行。页面轮询只读取本地状态并唤醒任务，不能与 Worker 同时
			// 更新订单版本或抢占 in_progress 查询租约。
			await this.requeue(orderId);
			return output(order, false);
		}
		const settlement = await this.dependencies.orders.getSettlementContext(
			ownerUserId,
			orderId,
		);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType,
			insuredAreaCode: settlement?.insuredAreaCode ?? "",
		});
		let result: Awaited<
			ReturnType<MedicalInsuranceWechatPaymentGateway["queryMixedOrder"]>
		>;
		try {
			result = await this.dependencies.wechatPayment.queryMixedOrder(
				{
					orderId,
					mixTradeNo: order.wechatMixTradeNo,
					expectedOutTradeNo: order.wechatOutTradeNo,
					expectedPayOrdId: order.payOrdId,
					expectedTotalFen: order.amounts.totalFen,
					expectedCashFen: breakdown.wechatCashFen,
				},
				input.context,
			);
		} catch (error) {
			this.logger.error(
				{
					event: "medical-insurance.wechat-mix.query.failed",
					traceId: input.context.traceId,
					ownerUserId,
					orderId,
					businessType,
					orderType,
					errorType: error instanceof Error ? error.name : "unknown",
					...providerFailureMetadata(error),
				},
				"Medical insurance WeChat mixed payment query failed",
			);
			throw error;
		}
		const hasCompleteComponentEvidence =
			result.fundFen !== undefined &&
			result.personalAccountFen !== undefined &&
			result.otherPaymentFen !== undefined &&
			result.medicalCashFen !== undefined &&
			result.cashReduceDetails !== undefined;
		if (
			hasCompleteComponentEvidence &&
			(result.fundFen !== order.amounts.fundFen ||
				result.personalAccountFen !== order.amounts.personalAccountFen ||
				result.otherPaymentFen !== (order.amounts.otherPaymentFen ?? 0) ||
				result.medicalCashFen !== order.amounts.cashFen ||
				JSON.stringify(result.cashReduceDetails) !==
					JSON.stringify(breakdown.cashReduceDetails))
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat query component amounts do not match",
			);
		}
		const fullyPaid =
			result.mixState === "paid" &&
			result.cashState === "paid" &&
			result.insuranceState === "paid";
		const providerFailed =
			result.mixState === "failed" ||
			result.cashState === "failed" ||
			result.insuranceState === "failed";
		const paymentState = fullyPaid
			? "cash_paid"
			: providerFailed
				? "failed"
				: result.cashState === "paid"
					? "unknown"
					: "prepay_ready";
		const nextStatus = providerFailed ? "manual_review" : order.status;
		const updated = await this.dependencies.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				...settlementPatch(order),
				status: nextStatus,
				wechatPaymentState: paymentState,
				// 失败原因只属于本次查单返回的医保失败状态；其他状态清除
				// 历史原因，避免退款/成功后继续展示过期文案。
				medInsFailReason:
					result.medInsPayStatus === "MED_INS_PAY_FAIL"
						? (result.medInsFailReason ?? null)
						: null,
			},
		);
		order = updated ?? (await this.order(ownerUserId, orderId));
		if (!fullyPaid && !providerFailed) await this.requeue(orderId);
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.queried",
				traceId: input.context.traceId,
				ownerUserId,
				orderId,
				businessType,
				orderType,
				providerStatus: result.providerStatus,
				mixState: result.mixState,
				cashState: result.cashState,
				insuranceState: result.insuranceState,
				medInsPayStatus: result.medInsPayStatus,
				...(result.medInsFailReason
					? { medInsFailReason: result.medInsFailReason }
					: {}),
				paymentState,
				providerRequestId: result.trace.requestId,
			},
			"Medical insurance WeChat mixed payment queried",
		);
		if (fullyPaid) {
			// wx.requestMedicalInsurancePay 的 success 只代表客户端调起成功；必须再走服务端
			// 混合查单和医保后置完成，才能清除 pending 上下文。
			if (this.dependencies.pluginPaymentBridge) {
				// 云健康 .29/.15/.5 由持久化 Worker 串行执行，避免 API 查单与
				// 后台补偿同时写同一 Provider 流水。页面继续轮询本订单即可。
				await this.requeue(orderId);
				return output(order, false);
			}
			const confirmed = await this.completeOfficialPayment(order, {
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
	 * 普通 JSAPI 回调承载混合订单的现金段。识别 MIP out_trade_no 后只唤醒
	 * 医保混合查单，不写普通支付通知表，也不允许普通支付 Worker 单独据此
	 * 完成医院回写。
	 */
	async receiveCashNotification(input: {
		notification: WechatPaymentNotification;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<boolean> {
		const notification = input.notification;
		if (!notification.orderId.startsWith("MIP")) return false;
		const order = await this.dependencies.orders.findByWechatOutTradeNo(
			notification.orderId,
		);
		if (!order?.amounts) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance cash notification order was not found",
			);
		}
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType: order.orderType ?? "RegPay",
			insuredAreaCode: settlement?.insuredAreaCode ?? "",
		});
		if (notification.totalFen !== breakdown.wechatCashFen) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance cash notification amount does not match",
			);
		}
		await this.requeue(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.wechat-cash.notification.accepted",
				traceId: input.context.traceId,
				orderId: order.medicalOrderId,
				notificationId: notification.notificationId,
				providerTransactionId: notification.providerTransactionId,
			},
			"Medical insurance cash notification queued for mixed-order query",
		);
		return true;
	}

	/**
	 * 处理官方医保混合成功回调。回调只做验签后的本地关联、金额校验与持久化
	 * 查单任务唤醒，确保 5 秒内应答；Provider 查单和 HIS 回写由后台执行。
	 */
	async receiveNotification(input: {
		notification: MedicalInsuranceWechatNotification;
		context: { traceId: string; idempotencyKey: string };
	}): Promise<void> {
		const notification = input.notification;
		const order = await this.dependencies.orders.findByWechatMixTradeNo(
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
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts: order.amounts,
			orderType: order.orderType ?? "RegPay",
			insuredAreaCode: settlement?.insuredAreaCode ?? "",
		});
		if (
			notification.cashFen !== breakdown.wechatCashFen ||
			JSON.stringify(notification.cashReduceDetails) !==
				JSON.stringify(breakdown.cashReduceDetails)
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification cash amount does not match",
			);
		}
		if (
			notification.fundFen !== order.amounts.fundFen ||
			notification.personalAccountFen !== order.amounts.personalAccountFen ||
			notification.otherPaymentFen !== (order.amounts.otherPaymentFen ?? 0) ||
			notification.medicalCashFen !== order.amounts.cashFen
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification component amounts do not match",
			);
		}
		const expectedMixPayType =
			breakdown.wechatCashFen === 0 ? "INSURANCE_ONLY" : "CASH_AND_INSURANCE";
		const expectedSelfPayStatus =
			breakdown.wechatCashFen === 0 ? "NO_SELF_PAY" : "SELF_PAY_SUCCESS";
		if (
			notification.mixPayType !== expectedMixPayType ||
			notification.selfPayStatus !== expectedSelfPayStatus
		) {
			throw new MedicalInsuranceWechatPaymentInputError(
				"Medical insurance WeChat notification payment type does not match",
			);
		}
		await this.requeue(order.medicalOrderId);
		this.logger.info(
			{
				event: "medical-insurance.wechat-mix.notification.accepted",
				traceId: input.context.traceId,
				orderId: order.medicalOrderId,
				notificationId: notification.notificationId,
			},
			"Medical insurance WeChat mixed notification queued for query",
		);
	}
}
