import { createHash } from "node:crypto";
import { ProviderRequestError } from "@hospital/adapters";
import {
	type AdapterCallContext,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceRefund,
	type MedicalInsuranceRefundRepository,
	medicalInsurancePaymentBreakdown,
	medicalInsuranceWechatCashRefundIdentity,
	normalizePatientReadModel,
	normalizeUserProfileReadModel,
	PatientReadModelValidationError,
	type PatientRepository,
	type PaymentAggregate,
	type PaymentHistoryStatus,
	type PaymentLeg,
	type PaymentOperationEvent,
	type PaymentOperationsRepository,
	type PaymentOperatorAuditRepository,
	type PaymentOrder,
	type PaymentOrderRepository,
	parseIsoCalendarDate,
	projectWechatRefundProviderResult,
	UserProfileReadModelValidationError,
	type UserProfileRepository,
	type WechatRefund,
	WechatRefundAmountExceededError,
	type WechatRefundGateway,
	WechatRefundIdempotencyConflictError,
	WechatRefundNotFoundError,
	type WechatRefundRepository,
	type WechatRefundSource,
} from "@hospital/domain";
import {
	projectMedicalInsuranceOrder,
	projectPaymentOrder,
} from "./payment-operations-projector";

export type AdminWechatRefundInput = {
	source: WechatRefundSource;
	orderId: string;
	refundFen: number;
	idempotencyKey: string;
	reason?: string;
};

export type AdminWechatRefundHistoryQuery = {
	source?: WechatRefundSource;
	business?: "registration" | "outpatient" | "other";
	/** 精确匹配服务端订单号；为空时读取最近记录。 */
	orderId?: string;
	page?: number;
	pageSize?: number;
	/** 兼容旧调用方；新调用方使用 pageSize。 */
	limit?: number;
	/** 按 Asia/Shanghai 自然日筛选订单创建时间。 */
	businessDay?: string;
	/** 来源订单映射后的支付聚合状态；退费状态不在此筛选项内。 */
	status?: PaymentHistoryStatus;
};

export type AdminPaymentHistoryPage = {
	items: readonly AdminWechatRefundPaymentRecord[];
	total: number;
	page: number;
	pageSize: number;
};

type AdminPaymentAmounts = {
	insuranceFen: number;
	actualCashFen: number | null;
	hospitalDiscountFen: number | null;
	actualPaidFen: number | null;
	amountBreakdownStatus: "confirmed" | "unverified";
};

export type AdminPaymentOperationDetail = {
	aggregate: Omit<PaymentAggregate, "ownerUserId" | "patientId" | "cashFen"> &
		AdminPaymentAmounts & { cashFen: number | null };
	legs: readonly PaymentLeg[];
	events: readonly PaymentOperationEvent[];
};

const ADMIN_PAYMENT_HISTORY_SCAN_LIMIT = 10_000;

/**
 * Admin 退款页面仅投影就诊人和下单用户名称；患者标识、支付凭证、微信调起参数、
 * out_trade_no 和加密 Provider 上下文一律不离开服务端。
 */
export type AdminWechatRefundPaymentRecord = AdminPaymentAmounts & {
	source: WechatRefundSource;
	orderId: string;
	patientDisplayName?: string;
	/** 下单平台用户的普通资料名称，不表示实际微信付款人的实名。 */
	orderUserDisplayName?: string;
	/** 平台支付聚合账本 ID；用于 Admin 后续详情与对账关联。 */
	operationAggregateId?: string;
	business: "registration" | "outpatient" | "other";
	/** 管理端可展示的金额事实；不包含患者身份或支付调起参数。 */
	totalFen: number;
	/** 普通自费为本地订单状态；医保混合单为微信现金段状态。 */
	paymentState: string;
	cashPaymentConfirmed: boolean;
	cashFen: number;
	medicalRefundableFen: number;
	refundOptions: Record<
		"ALL" | "HI" | "CASH",
		{
			enabled: boolean;
			amountFen: number;
			reason?: string;
		}
	>;
	personalAccountFen?: number;
	fundFen?: number;
	otherPaymentFen?: number;
	hospitalPartFen?: number;
	personalAccountMutualAidFen?: number;
	personalAccountSelfFen?: number;
	depositFen?: number;
	deliveryFeeFen?: number;
	medicalStatus?: string;
	ordStas?: string | null;
	wechatPaymentState?: string;
	refundReservedFen: number;
	refundableFen: number;
	refundCount: number;
	latestRefund?: {
		merchantRefundNo: string;
		status: WechatRefund["status"];
		refundFen: number;
		updatedAt: string;
	};
	latestMedicalRefund?: {
		refundNo: string;
		status:
			| "requested"
			| "processing"
			| "succeeded"
			| "failed"
			| "manual_review";
		medicalStatus: string;
		wechatStatus: string;
		totalFen: number;
		updatedAt: string;
	};
	/** Admin 直退、挂号退款编排或当前不可退。 */
	refundRoute: "admin" | "appointment_cancel" | "unavailable";
	createdAt: string;
	updatedAt: string;
};

/**
 * 仅限服务端编排调用：outTradeNo 必须来自已加密保存的 Provider 支付上下文，
 * 不能由管理端或小程序请求覆盖。
 */
export type TrustedPaymentOrderRefundInput = Omit<
	AdminWechatRefundInput,
	"source"
> & {
	outTradeNo: string;
};

type NormalizedRefundInput = {
	source: WechatRefundSource;
	orderId: string;
	refundFen: number;
	idempotencyKey: string;
	reason?: string;
};

type RequestForTargetOptions = {
	merchantRefundNo?: string;
	operatorRef?: string;
};

type ResolvedRefundTarget = {
	source: WechatRefundSource;
	sourceOrderId: string;
	outTradeNo: string;
	totalFen: number;
};

export class AdminWechatRefundInputError extends Error {
	constructor(message = "Admin Wechat refund input is invalid") {
		super(message);
		this.name = "AdminWechatRefundInputError";
	}
}

export class AdminWechatRefundHistoryNotConfiguredError extends Error {
	constructor() {
		super("Admin Wechat refund payment history is not configured");
		this.name = "AdminWechatRefundHistoryNotConfiguredError";
	}
}

export class AdminPaymentOperationNotConfiguredError extends Error {
	constructor() {
		super("Admin payment operation ledger is not configured");
		this.name = "AdminPaymentOperationNotConfiguredError";
	}
}

export class AdminPaymentOperationNotFoundError extends Error {
	constructor() {
		super("Payment operation aggregate was not found");
		this.name = "AdminPaymentOperationNotFoundError";
	}
}

const CONFIRMED_PAYMENT_ORDER_STATES = new Set([
	"cash_paid",
	"his_written_back",
	"completed",
]);
const RESERVED_REFUND_STATUSES = new Set<WechatRefund["status"]>([
	"requested",
	"processing",
	"success",
	"unknown",
]);
const REGISTRATION_SELF_PAY_KEY_PREFIX = "registration-self-pay:";
const OUTPATIENT_SELF_PAY_KEY_PREFIX = "outpatient-self-pay:";

function requiredText(value: unknown, maxLength: number): string {
	if (typeof value !== "string") throw new AdminWechatRefundInputError();
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new AdminWechatRefundInputError();
	}
	return normalized;
}

function optionalReason(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const reason = requiredText(value, 80);
	if (new TextEncoder().encode(reason).byteLength > 80) {
		throw new AdminWechatRefundInputError("退款原因不能超过 80 字节");
	}
	return reason;
}

function normalizeRefundInput(
	input: AdminWechatRefundInput,
): NormalizedRefundInput {
	if (
		input.source !== "payment_order" &&
		input.source !== "medical_insurance"
	) {
		throw new AdminWechatRefundInputError();
	}
	const idempotencyKey = requiredText(input.idempotencyKey, 128);
	if (!isBoundedOpaqueIdentifier(idempotencyKey)) {
		throw new AdminWechatRefundInputError();
	}
	if (!Number.isSafeInteger(input.refundFen) || input.refundFen <= 0) {
		throw new AdminWechatRefundInputError("退费金额必须是正整数分");
	}
	const reason = optionalReason(input.reason);
	return {
		source: input.source,
		orderId: requiredText(input.orderId, 64),
		refundFen: input.refundFen,
		idempotencyKey,
		...(reason ? { reason } : {}),
	};
}

function normalizeHistoryQuery(input: AdminWechatRefundHistoryQuery): Required<
	Pick<AdminWechatRefundHistoryQuery, "page" | "pageSize">
> &
	Pick<
		AdminWechatRefundHistoryQuery,
		"source" | "business" | "orderId" | "businessDay" | "status"
	> & {
		createdFrom?: string;
		createdTo?: string;
	} {
	if (
		input.source !== undefined &&
		input.source !== "payment_order" &&
		input.source !== "medical_insurance"
	) {
		throw new AdminWechatRefundInputError();
	}
	if (
		input.business !== undefined &&
		input.business !== "registration" &&
		input.business !== "outpatient" &&
		input.business !== "other"
	) {
		throw new AdminWechatRefundInputError();
	}
	if (
		input.status !== undefined &&
		input.status !== "created" &&
		input.status !== "pending" &&
		input.status !== "paid" &&
		input.status !== "failed" &&
		input.status !== "manual_review"
	) {
		throw new AdminWechatRefundInputError();
	}
	const page = input.page ?? 1;
	const pageSize = input.pageSize ?? input.limit ?? 50;
	if (!Number.isSafeInteger(page) || page < 1 || page > 10000) {
		throw new AdminWechatRefundInputError("历史支付页码不合法");
	}
	if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
		throw new AdminWechatRefundInputError("历史支付每页条数不合法");
	}
	if (page * pageSize > ADMIN_PAYMENT_HISTORY_SCAN_LIMIT) {
		throw new AdminWechatRefundInputError(
			"历史支付页码超出当前查询窗口，请缩小筛选范围",
		);
	}
	const orderId = input.orderId?.trim();
	const businessDay = input.businessDay?.trim();
	if (
		businessDay !== undefined &&
		(parseIsoCalendarDate(businessDay) === undefined ||
			!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(businessDay))
	) {
		throw new AdminWechatRefundInputError("业务日必须是有效的 YYYY-MM-DD 日期");
	}
	const createdFrom = businessDay
		? new Date(`${businessDay}T00:00:00+08:00`).toISOString()
		: undefined;
	const createdTo = businessDay
		? new Date(
				new Date(`${businessDay}T00:00:00+08:00`).getTime() + 86_400_000,
			).toISOString()
		: undefined;
	return {
		page,
		pageSize,
		...(input.source ? { source: input.source } : {}),
		...(input.business ? { business: input.business } : {}),
		...(orderId ? { orderId: requiredText(orderId, 64) } : {}),
		...(businessDay ? { businessDay } : {}),
		...(input.status ? { status: input.status } : {}),
		...(createdFrom ? { createdFrom } : {}),
		...(createdTo ? { createdTo } : {}),
	};
}

function normalPaymentBusiness(
	order: PaymentOrder,
): AdminWechatRefundPaymentRecord["business"] {
	if (order.idempotencyKey.startsWith(REGISTRATION_SELF_PAY_KEY_PREFIX)) {
		return "registration";
	}
	if (order.idempotencyKey.startsWith(OUTPATIENT_SELF_PAY_KEY_PREFIX)) {
		return "outpatient";
	}
	return "other";
}

function medicalPaymentBusiness(
	order: MedicalInsuranceOrder,
): AdminWechatRefundPaymentRecord["business"] {
	return order.businessType === "outpatient" || order.orderType === "DiagPay"
		? "outpatient"
		: "registration";
}

function refundSummary(refunds: readonly WechatRefund[]): {
	reservedFen: number;
	latestRefund: AdminWechatRefundPaymentRecord["latestRefund"];
} {
	const ordered = [...refunds].sort((left, right) => {
		const updated = right.updatedAt.localeCompare(left.updatedAt);
		return updated || right.refundRecordId.localeCompare(left.refundRecordId);
	});
	const latest = ordered[0];
	return {
		reservedFen: ordered
			.filter((refund) => RESERVED_REFUND_STATUSES.has(refund.status))
			.reduce((total, refund) => total + refund.refundFen, 0),
		latestRefund: latest
			? {
					merchantRefundNo: latest.merchantRefundNo,
					status: latest.status,
					refundFen: latest.refundFen,
					updatedAt: latest.updatedAt,
				}
			: undefined,
	};
}

function refundOptions(
	cashFen: number,
	medicalFen: number,
	reason?: string,
): AdminWechatRefundPaymentRecord["refundOptions"] {
	const option = (amountFen: number, unavailable?: string) => ({
		enabled: amountFen > 0 && !unavailable,
		amountFen,
		...(unavailable
			? { reason: unavailable }
			: amountFen <= 0
				? { reason: "没有剩余已支付金额" }
				: {}),
	});
	return {
		ALL: option(cashFen + medicalFen, reason),
		HI: option(medicalFen, reason),
		CASH: option(cashFen, reason),
	};
}

function refundIdentityMatches(
	record: WechatRefund,
	target: {
		source: WechatRefundSource;
		sourceOrderId: string;
		outTradeNo: string;
		totalFen: number;
	},
	refundFen: number,
): boolean {
	return (
		record.source === target.source &&
		record.sourceOrderId === target.sourceOrderId &&
		record.outTradeNo === target.outTradeNo &&
		record.totalFen === target.totalFen &&
		record.refundFen === refundFen
	);
}

function isUnknownProviderFailure(error: unknown): boolean {
	return (
		error instanceof ProviderRequestError && error.requestOutcome === "unknown"
	);
}

function isRefundQueryNotFound(error: unknown): boolean {
	return (
		error instanceof ProviderRequestError &&
		error.provider === "wechat-pay" &&
		error.operation === "refund-query" &&
		error.statusCode === 404 &&
		error.providerErrorCode === "RESOURCE_NOT_EXISTS" &&
		error.requestOutcome === "rejected"
	);
}

function errorCode(error: unknown): string {
	if (error instanceof ProviderRequestError) {
		return error.providerErrorCode ?? error.operation;
	}
	return error instanceof Error ? error.name : "UNKNOWN";
}

export function hisMedicalWechatMerchantRefundNo(orderId: string): string {
	return medicalInsuranceWechatCashRefundIdentity(orderId).merchantRefundNo;
}

export type RegistrationRefundUnavailableReason =
	| "cancellation_not_configured"
	| "write_back_not_configured"
	| "authentication_not_supported"
	| "write_back_authorization_missing";

export function resolveRegistrationRefundUnavailableReason(capabilities: {
	cancellationConfigured: boolean;
	writeBackConfigured: boolean;
	writeBackAuthorized: boolean;
	writeBackAuthenticationSupported?: boolean;
}): RegistrationRefundUnavailableReason | undefined {
	if (!capabilities.cancellationConfigured)
		return "cancellation_not_configured";
	if (!capabilities.writeBackConfigured) return "write_back_not_configured";
	if (capabilities.writeBackAuthenticationSupported === false)
		return "authentication_not_supported";
	if (!capabilities.writeBackAuthorized)
		return "write_back_authorization_missing";
	return undefined;
}

function registrationRefundUnavailableMessage(
	reason: RegistrationRefundUnavailableReason | undefined,
): string {
	switch (reason) {
		case "write_back_not_configured":
			return "医院退费回写服务未配置，暂不能退款并取消挂号";
		case "write_back_authorization_missing":
			return "医院退费回写缺少服务端授权，暂不能退款并取消挂号";
		case "authentication_not_supported":
			return "医院退费回写鉴权配置不受支持，暂不能退款并取消挂号";
		default:
			return "取消挂号服务未配置，暂不能退款并取消挂号";
	}
}

export class AdminWechatRefundService {
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: {
			refunds: WechatRefundRepository;
			paymentOrders: PaymentOrderRepository;
			medicalInsuranceOrders: MedicalInsuranceOrderRepository;
			medicalInsuranceRefunds?: MedicalInsuranceRefundRepository;
			patients?: Pick<PatientRepository, "listByOwner">;
			userProfiles?: Pick<UserProfileRepository, "findByUserId">;
			registrationRefundEnabled?: boolean;
			registrationRefundUnavailableReason?: RegistrationRefundUnavailableReason;
			paymentOperations?: PaymentOperationsRepository;
			operatorAudits?: PaymentOperatorAuditRepository;
			gateway: WechatRefundGateway;
			now?: () => Date;
			createId?: () => string;
		},
	) {
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async medicalCashBreakdown(order: MedicalInsuranceOrder) {
		if (!order.amounts || !order.orderType) {
			throw new AdminWechatRefundInputError(
				"支付上下文不完整，不能确认实际微信支付金额",
			);
		}
		const settlement =
			await this.dependencies.medicalInsuranceOrders.getSettlementContext(
				order.ownerUserId,
				order.medicalOrderId,
			);
		if (order.orderType === "RegPay" && !settlement?.insuredAreaCode?.trim()) {
			throw new AdminWechatRefundInputError(
				"支付上下文不完整，不能确认挂号优惠金额",
			);
		}
		try {
			const breakdown = medicalInsurancePaymentBreakdown({
				amounts: order.amounts,
				orderType: order.orderType,
				insuredAreaCode: settlement?.insuredAreaCode ?? "",
			});
			const hospitalDiscountFen = breakdown.cashReduceDetails.reduce(
				(sum, detail) => sum + detail.cashReduceFen,
				0,
			);
			// 当前优惠规则不能覆盖历史交易事实；已有分项冲突时停止推断。
			const savedLegs = (settlement?.postPaymentComponents ?? []).flatMap(
				(component) =>
					component.kind === "medical" || component.kind === "combined"
						? (component.payTypeParams ?? []).map((leg) => ({
								kind: leg.kind,
								amountFen: leg.amountFen,
								state: component.state,
							}))
						: [
								{
									kind: component.kind,
									amountFen: component.amountFen,
									state: component.state,
								},
							],
			);
			const cashLegs = savedLegs.filter((leg) => leg.kind === "wechat_cash");
			const discountLegs = savedLegs.filter(
				(leg) => leg.kind === "hospital_reduce",
			);
			if (
				(cashLegs.length > 0 &&
					cashLegs.reduce((sum, leg) => sum + leg.amountFen, 0) !==
						breakdown.wechatCashFen) ||
				(discountLegs.length > 0 &&
					discountLegs.reduce((sum, leg) => sum + leg.amountFen, 0) !==
						hospitalDiscountFen + (order.amounts.hospitalPartFen ?? 0)) ||
				(hospitalDiscountFen > 0 &&
					!discountLegs.some((leg) => leg.state === "succeeded"))
			) {
				throw new AdminWechatRefundInputError(
					"原支付分项缺少医院减免确认或与当前拆分不一致，请核实历史支付金额",
				);
			}
			return breakdown;
		} catch {
			throw new AdminWechatRefundInputError(
				"支付分项不完整，不能确认实际微信支付金额",
			);
		}
	}

	private async medicalAmountMetadata(order: MedicalInsuranceOrder): Promise<{
		amounts: AdminPaymentAmounts;
		unavailableReason?: string;
	}> {
		const insuranceFen =
			(order.amounts?.fundFen ?? 0) + (order.amounts?.personalAccountFen ?? 0);
		try {
			const breakdown = await this.medicalCashBreakdown(order);
			return {
				amounts: {
					insuranceFen,
					actualCashFen: breakdown.wechatCashFen,
					hospitalDiscountFen: breakdown.cashReduceDetails.reduce(
						(sum, detail) => sum + detail.cashReduceFen,
						0,
					),
					actualPaidFen: insuranceFen + breakdown.wechatCashFen,
					amountBreakdownStatus: "confirmed",
				},
			};
		} catch (error) {
			if (!(error instanceof AdminWechatRefundInputError)) throw error;
			return {
				amounts: {
					insuranceFen,
					actualCashFen: null,
					hospitalDiscountFen: null,
					actualPaidFen: null,
					amountBreakdownStatus: "unverified",
				},
				unavailableReason: error.message,
			};
		}
	}

	private async medicalRefundHistory(
		orderId: string,
	): Promise<readonly MedicalInsuranceRefund[]> {
		const repository = this.dependencies.medicalInsuranceRefunds;
		if (!repository) return [];
		const records = await repository.listByMedicalOrderId(orderId);
		return [...records].sort(
			(left, right) =>
				right.updatedAt.localeCompare(left.updatedAt) ||
				right.refundNo.localeCompare(left.refundNo),
		);
	}

	private async resolveTarget(
		input: NormalizedRefundInput,
		trustedPaymentOrderOutTradeNo?: string,
	): Promise<ResolvedRefundTarget> {
		const sourceOrderId = input.orderId;
		if (input.source === "payment_order") {
			const order =
				await this.dependencies.paymentOrders.findById(sourceOrderId);
			if (!order) throw new WechatRefundNotFoundError();
			if (
				order.state !== "cash_paid" &&
				order.state !== "his_written_back" &&
				order.state !== "completed"
			) {
				throw new AdminWechatRefundInputError(
					"普通微信订单尚未确认自费支付成功，不能发起退费",
				);
			}
			if (order.amounts.cashFen <= 0) {
				throw new AdminWechatRefundInputError("普通订单没有可退的微信自费金额");
			}
			if (
				!trustedPaymentOrderOutTradeNo &&
				order.idempotencyKey.startsWith(REGISTRATION_SELF_PAY_KEY_PREFIX)
			) {
				throw new AdminWechatRefundInputError(
					"挂号自费退款必须从预约取消流程发起，不能绕过医院退款回写",
				);
			}
			return {
				source: input.source,
				sourceOrderId,
				outTradeNo: trustedPaymentOrderOutTradeNo ?? sourceOrderId,
				totalFen: order.amounts.cashFen,
			};
		}
		if (input.source !== "medical_insurance") {
			throw new AdminWechatRefundInputError();
		}
		const order =
			await this.dependencies.medicalInsuranceOrders.findByMedicalOrderId(
				sourceOrderId,
			);
		if (!order) throw new WechatRefundNotFoundError();
		if (order.wechatPaymentState !== "cash_paid" || !order.wechatOutTradeNo) {
			throw new AdminWechatRefundInputError(
				"医保混合单尚未确认微信自费支付成功，不能发起微信退费",
			);
		}
		const totalFen = (await this.medicalCashBreakdown(order)).wechatCashFen;
		if (totalFen <= 0) {
			throw new AdminWechatRefundInputError("医保混合单没有可退的微信自费金额");
		}
		return {
			source: input.source,
			sourceOrderId,
			outTradeNo: order.wechatOutTradeNo,
			totalFen,
		};
	}

	private async applyProviderResult(
		record: WechatRefund,
		result: Awaited<ReturnType<WechatRefundGateway["requestRefund"]>>,
	): Promise<WechatRefund> {
		const updated = projectWechatRefundProviderResult(
			record,
			result,
			this.now().toISOString(),
		);
		const saved = await this.dependencies.refunds.update(
			updated,
			record.version,
		);
		if (!saved) throw new Error("Wechat refund record changed concurrently");
		return saved;
	}

	private async markRequestFailure(
		record: WechatRefund,
		error: unknown,
	): Promise<WechatRefund> {
		const updated: WechatRefund = {
			...record,
			status: isUnknownProviderFailure(error) ? "unknown" : "request_failed",
			lastErrorCode: errorCode(error),
			version: record.version + 1,
			updatedAt: this.now().toISOString(),
		};
		const saved = await this.dependencies.refunds.update(
			updated,
			record.version,
		);
		if (!saved) throw new Error("Wechat refund record changed concurrently");
		return saved;
	}

	private async appendRefundAudit(input: {
		source: WechatRefundSource;
		orderId: string;
		requestId: string;
		operatorRef?: string;
		action: "refund_request" | "refund_query";
		outcome: "succeeded" | "failed" | "rejected";
		reasonCode?: string;
	}): Promise<void> {
		const audits = this.dependencies.operatorAudits;
		const operations = this.dependencies.paymentOperations;
		if (!audits) return;
		const aggregateId = operations
			? (
					await operations.findAggregateByBusinessKey(
						`${input.source === "payment_order" ? "payment_order" : "medical_insurance"}:${input.orderId}`,
					)
				)?.aggregateId
			: undefined;
		await audits.append({
			auditId: `audit-${input.action}-${this.createId()}`,
			operatorRef: input.operatorRef ?? null,
			action: input.action,
			...(aggregateId ? { aggregateId } : {}),
			requestId: input.requestId,
			outcome: input.outcome,
			...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
			occurredAt: this.now().toISOString(),
		});
	}

	private async requestForTarget(
		input: NormalizedRefundInput,
		target: ResolvedRefundTarget,
		context: AdapterCallContext,
		options: RequestForTargetOptions = {},
	): Promise<WechatRefund> {
		if (input.refundFen > target.totalFen) {
			throw new WechatRefundAmountExceededError();
		}
		const now = this.now().toISOString();
		const merchantRefundNo =
			options.merchantRefundNo ??
			`RF-${target.source === "medical_insurance" ? "MI" : "PO"}-${this.createId().replaceAll("-", "").slice(0, 28)}`;
		const initial: WechatRefund = {
			refundRecordId: `refund-${this.createId()}`,
			merchantRefundNo,
			idempotencyKey: input.idempotencyKey,
			source: target.source,
			sourceOrderId: target.sourceOrderId,
			outTradeNo: target.outTradeNo,
			totalFen: target.totalFen,
			refundFen: input.refundFen,
			reason: input.reason ?? null,
			status: "requested",
			providerStatus: null,
			providerRefundId: null,
			providerTransactionId: null,
			providerRequestId: null,
			successTime: null,
			lastErrorCode: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const reserved = await this.dependencies.refunds.reserve(initial);
		const record = reserved.record;
		if (reserved.status === "existing") {
			if (!refundIdentityMatches(record, target, input.refundFen)) {
				throw new WechatRefundIdempotencyConflictError();
			}
			if (
				record.status === "success" ||
				record.status === "closed" ||
				record.status === "abnormal" ||
				record.status === "processing"
			) {
				return record;
			}
			if (record.status === "requested" || record.status === "unknown") {
				try {
					return await this.query(record.merchantRefundNo, context);
				} catch (error) {
					if (isRefundQueryNotFound(error)) {
						return this.requestStoredRefund(
							record,
							context,
							options.operatorRef,
						);
					}
					// 查单失败不能把已预留的未知退款误报为可重新申请的确定失败。
					return (
						(await this.dependencies.refunds.findByMerchantRefundNo(
							record.merchantRefundNo,
						)) ?? record
					);
				}
			}
		}
		return this.requestStoredRefund(record, context, options.operatorRef);
	}

	/** 查单明确不存在时，也只能重发台账已预留的原退款身份和原参数。 */
	private async requestStoredRefund(
		record: WechatRefund,
		context: AdapterCallContext,
		operatorRef?: string,
	): Promise<WechatRefund> {
		let saved: WechatRefund;
		try {
			saved = await this.applyProviderResult(
				record,
				await this.dependencies.gateway.requestRefund(
					{
						outTradeNo: record.outTradeNo,
						merchantRefundNo: record.merchantRefundNo,
						totalFen: record.totalFen,
						refundFen: record.refundFen,
						...(record.reason ? { reason: record.reason } : {}),
					},
					context,
				),
			);
		} catch (error) {
			const saved = await this.markRequestFailure(record, error);
			if (!record.idempotencyKey.startsWith("medical-refund:")) {
				await this.appendRefundAudit({
					source: record.source,
					orderId: record.sourceOrderId,
					requestId: context.traceId,
					...(operatorRef ? { operatorRef } : {}),
					action: "refund_request",
					outcome: "failed",
					reasonCode: errorCode(error),
				});
			}
			return saved;
		}
		if (!record.idempotencyKey.startsWith("medical-refund:")) {
			await this.appendRefundAudit({
				source: record.source,
				orderId: record.sourceOrderId,
				requestId: context.traceId,
				...(operatorRef ? { operatorRef } : {}),
				action: "refund_request",
				outcome: "succeeded",
			});
		}
		return saved;
	}

	async request(
		input: AdminWechatRefundInput,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = normalizeRefundInput(input);
		return this.requestForTarget(
			normalized,
			await this.resolveTarget(normalized),
			context,
		);
	}

	async listPaymentHistory(
		input: AdminWechatRefundHistoryQuery = {},
	): Promise<AdminPaymentHistoryPage> {
		const query = normalizeHistoryQuery(input);
		const listPaymentOrders =
			this.dependencies.paymentOrders.listRecentForAdmin;
		const listMedicalOrders =
			this.dependencies.medicalInsuranceOrders.listRecentForAdmin;
		const countPaymentOrders = this.dependencies.paymentOrders.countForAdmin;
		const countMedicalOrders =
			this.dependencies.medicalInsuranceOrders.countForAdmin;
		const findRefunds = this.dependencies.refunds.findBySourceAndSourceOrder;
		if (
			!listPaymentOrders ||
			!listMedicalOrders ||
			!countPaymentOrders ||
			!countMedicalOrders ||
			!findRefunds
		) {
			throw new AdminWechatRefundHistoryNotConfiguredError();
		}
		const sourceQuery = {
			...(query.business ? { business: query.business } : {}),
			...(query.orderId ? { orderId: query.orderId } : {}),
			...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
			...(query.createdTo ? { createdTo: query.createdTo } : {}),
			...(query.status ? { aggregateStatus: query.status } : {}),
		};
		const fetchLimit = query.page * query.pageSize;
		const [paymentOrders, medicalOrders] = await Promise.all([
			query.source === "medical_insurance"
				? Promise.resolve([] as readonly PaymentOrder[])
				: listPaymentOrders({
						limit: fetchLimit,
						...sourceQuery,
					}),
			query.source === "payment_order"
				? Promise.resolve([] as readonly MedicalInsuranceOrder[])
				: listMedicalOrders({
						limit: fetchLimit,
						...sourceQuery,
					}),
		]);
		const [paymentTotal, medicalTotal] = await Promise.all([
			query.source === "medical_insurance"
				? Promise.resolve(0)
				: countPaymentOrders(sourceQuery),
			query.source === "payment_order"
				? Promise.resolve(0)
				: countMedicalOrders(sourceQuery),
		]);
		const candidates = [
			...paymentOrders.map((order) => ({
				source: "payment_order" as const,
				order,
			})),
			...medicalOrders.map((order) => ({
				source: "medical_insurance" as const,
				order,
			})),
		].sort((left, right) => {
			const updated = right.order.updatedAt.localeCompare(left.order.updatedAt);
			const leftId =
				left.source === "payment_order"
					? left.order.orderId
					: left.order.medicalOrderId;
			const rightId =
				right.source === "payment_order"
					? right.order.orderId
					: right.order.medicalOrderId;
			return updated || rightId.localeCompare(leftId);
		});
		const patientNamesByOwner = new Map<
			string,
			Promise<ReadonlyMap<string, string>>
		>();
		const orderUserNamesByOwner = new Map<
			string,
			Promise<string | undefined>
		>();
		const participantNamesFor = async (
			order: Pick<PaymentOrder, "ownerUserId" | "patientId">,
		) => {
			const owner = order.ownerUserId;
			let patientNames = patientNamesByOwner.get(owner);
			if (!patientNames) {
				patientNames = (async () => {
					try {
						const records =
							await this.dependencies.patients?.listByOwner(owner);
						if (records === undefined) return new Map<string, string>();
						return new Map(
							normalizePatientReadModel(records, owner).map((patient) => [
								patient.id,
								patient.displayName,
							]),
						);
					} catch (error) {
						if (error instanceof PatientReadModelValidationError) {
							return new Map<string, string>();
						}
						throw error;
					}
				})();
				patientNamesByOwner.set(owner, patientNames);
			}
			let orderUserName = orderUserNamesByOwner.get(owner);
			if (!orderUserName) {
				orderUserName = (async () => {
					try {
						const profile =
							await this.dependencies.userProfiles?.findByUserId(owner);
						if (profile === undefined) return undefined;
						return normalizeUserProfileReadModel(profile, owner).displayName;
					} catch (error) {
						if (error instanceof UserProfileReadModelValidationError) {
							return undefined;
						}
						throw error;
					}
				})();
				orderUserNamesByOwner.set(owner, orderUserName);
			}
			const [patients, orderUserDisplayName] = await Promise.all([
				patientNames,
				orderUserName,
			]);
			const patientDisplayName = patients.get(order.patientId);
			return {
				...(patientDisplayName ? { patientDisplayName } : {}),
				...(orderUserDisplayName ? { orderUserDisplayName } : {}),
			};
		};
		const records = await Promise.all(
			candidates
				.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
				.map(async (candidate) => {
					const orderId =
						candidate.source === "payment_order"
							? candidate.order.orderId
							: candidate.order.medicalOrderId;
					const [refunds, medicalRefunds, operationProjection, participants] =
						await Promise.all([
							findRefunds(candidate.source, orderId),
							candidate.source === "medical_insurance" &&
							this.dependencies.medicalInsuranceRefunds
								? this.medicalRefundHistory(orderId)
								: Promise.resolve([] as readonly MedicalInsuranceRefund[]),
							this.dependencies.paymentOperations
								? candidate.source === "payment_order"
									? projectPaymentOrder(
											this.dependencies.paymentOperations,
											candidate.order,
										)
									: projectMedicalInsuranceOrder(
											this.dependencies.paymentOperations,
											candidate.order,
										)
								: Promise.resolve(undefined),
							participantNamesFor(candidate.order),
						]);
					const latestMedicalRefund = medicalRefunds[0];
					const summary = refundSummary(refunds);
					if (candidate.source === "payment_order") {
						const order = candidate.order;
						const cashPaymentConfirmed = CONFIRMED_PAYMENT_ORDER_STATES.has(
							order.state,
						);
						const refundableFen = cashPaymentConfirmed
							? Math.max(0, order.amounts.cashFen - summary.reservedFen)
							: 0;
						const business = normalPaymentBusiness(order);
						return {
							source: candidate.source,
							orderId,
							...participants,
							...(operationProjection
								? {
										operationAggregateId:
											operationProjection.aggregate.aggregateId,
									}
								: {}),
							business,
							totalFen: order.amounts.totalFen,
							insuranceFen: order.amounts.insuranceFen,
							paymentState: order.state,
							cashPaymentConfirmed,
							cashFen: order.amounts.cashFen,
							actualCashFen: order.amounts.cashFen,
							hospitalDiscountFen: 0,
							actualPaidFen: order.amounts.insuranceFen + order.amounts.cashFen,
							amountBreakdownStatus: "confirmed",
							medicalRefundableFen: 0,
							refundOptions: refundOptions(
								refundableFen,
								0,
								business !== "registration"
									? undefined
									: order.state !== "completed"
										? "医院完成状态未确认，请先核对挂号结果"
										: this.dependencies.registrationRefundUnavailableReason ||
												!this.dependencies.registrationRefundEnabled
											? registrationRefundUnavailableMessage(
													this.dependencies.registrationRefundUnavailableReason,
												)
											: undefined,
							),
							refundReservedFen: summary.reservedFen,
							refundableFen,
							refundCount: refunds.length,
							...(summary.latestRefund
								? { latestRefund: summary.latestRefund }
								: {}),
							refundRoute:
								!cashPaymentConfirmed || refundableFen <= 0
									? "unavailable"
									: business === "registration"
										? "appointment_cancel"
										: "admin",
							createdAt: order.createdAt,
							updatedAt: order.updatedAt,
						} satisfies AdminWechatRefundPaymentRecord;
					}
					const order = candidate.order;
					const mixedPaymentCompleted =
						order.wechatPaymentState === "cash_paid";
					const cashFen = order.amounts?.cashFen ?? 0;
					const metadata = await this.medicalAmountMetadata(order);
					const { actualCashFen } = metadata.amounts;
					const cashPaymentConfirmed =
						mixedPaymentCompleted &&
						actualCashFen !== null &&
						actualCashFen > 0;
					let unavailable = metadata.unavailableReason;
					if (!this.dependencies.medicalInsuranceRefunds)
						unavailable ??= "退款台账不可用，请先核对退款记录";
					const reservedMedicalFen = medicalRefunds.reduce(
						(sum, refund) => sum + refund.fundFen + refund.personalAccountFen,
						0,
					);
					// 已有失败/未知记录也沿原退款身份恢复，不能通过另一个入口释放金额重建退款。
					const ledgerCashReserved = refunds.reduce(
						(sum, refund) => sum + refund.refundFen,
						0,
					);
					const aggregateCashReserved = medicalRefunds.reduce((sum, refund) => {
						const represented = refunds.some(
							(wechat) =>
								wechat.merchantRefundNo === refund.wechatMerchantRefundNo,
						);
						return sum + (represented ? 0 : refund.cashFen);
					}, 0);
					const reservedCashFen = ledgerCashReserved + aggregateCashReserved;
					const refundableFen = cashPaymentConfirmed
						? Math.max(0, (actualCashFen ?? 0) - reservedCashFen)
						: 0;
					const medicalPaymentConfirmed =
						order.status === "insurance_settled" ||
						["4", "5", "6"].includes(order.ordStas ?? "") ||
						(order.status === "manual_review" && mixedPaymentCompleted);
					const medicalRefundableFen =
						medicalPaymentConfirmed && order.payOrdId
							? Math.max(
									0,
									(order.amounts?.fundFen ?? 0) +
										(order.amounts?.personalAccountFen ?? 0) -
										reservedMedicalFen,
								)
							: 0;
					const options = refundOptions(
						refundableFen,
						medicalRefundableFen,
						unavailable,
					);
					return {
						source: candidate.source,
						orderId,
						...participants,
						...(operationProjection
							? {
									operationAggregateId:
										operationProjection.aggregate.aggregateId,
								}
							: {}),
						business: medicalPaymentBusiness(order),
						totalFen: order.amounts?.totalFen ?? 0,
						paymentState: order.wechatPaymentState ?? "not_started",
						cashPaymentConfirmed,
						cashFen,
						...metadata.amounts,
						medicalRefundableFen,
						refundOptions: options,
						...(order.amounts?.personalAccountFen === undefined
							? {}
							: { personalAccountFen: order.amounts.personalAccountFen }),
						...(order.amounts?.fundFen === undefined
							? {}
							: { fundFen: order.amounts.fundFen }),
						...(order.amounts?.otherPaymentFen === undefined
							? {}
							: { otherPaymentFen: order.amounts.otherPaymentFen }),
						...(order.amounts?.hospitalPartFen === undefined
							? {}
							: { hospitalPartFen: order.amounts.hospitalPartFen }),
						...(order.amounts?.personalAccountMutualAidFen === undefined
							? {}
							: {
									personalAccountMutualAidFen:
										order.amounts.personalAccountMutualAidFen,
								}),
						...(order.amounts?.personalAccountSelfFen === undefined
							? {}
							: {
									personalAccountSelfFen: order.amounts.personalAccountSelfFen,
								}),
						...(order.amounts?.depositFen === undefined
							? {}
							: { depositFen: order.amounts.depositFen }),
						...(order.amounts?.deliveryFeeFen === undefined
							? {}
							: { deliveryFeeFen: order.amounts.deliveryFeeFen }),
						medicalStatus: order.status,
						ordStas: order.ordStas,
						wechatPaymentState: order.wechatPaymentState ?? "not_started",
						refundReservedFen: reservedCashFen,
						refundableFen,
						refundCount: refunds.length,
						...(summary.latestRefund
							? { latestRefund: summary.latestRefund }
							: {}),
						...(latestMedicalRefund
							? {
									latestMedicalRefund: {
										refundNo: latestMedicalRefund.refundNo,
										status: latestMedicalRefund.status,
										medicalStatus: latestMedicalRefund.medicalStatus,
										wechatStatus: latestMedicalRefund.wechatStatus,
										totalFen: latestMedicalRefund.totalFen,
										updatedAt: latestMedicalRefund.updatedAt,
									},
								}
							: {}),
						refundRoute: options.ALL.enabled ? "admin" : "unavailable",
						createdAt: order.createdAt,
						updatedAt: order.updatedAt,
					} satisfies AdminWechatRefundPaymentRecord;
				}),
		);
		return {
			items: records,
			total: paymentTotal + medicalTotal,
			page: query.page,
			pageSize: query.pageSize,
		};
	}

	async getPaymentOperationDetail(
		aggregateId: string,
		context: { requestId?: string; operatorRef?: string | null } = {},
	): Promise<AdminPaymentOperationDetail> {
		if (!isBoundedOpaqueIdentifier(aggregateId)) {
			throw new AdminWechatRefundInputError("支付聚合单号不合法");
		}
		const repository = this.dependencies.paymentOperations;
		if (!repository) throw new AdminPaymentOperationNotConfiguredError();
		const aggregate = await repository.findAggregateById(aggregateId);
		if (!aggregate) throw new AdminPaymentOperationNotFoundError();
		const [legs, events] = await Promise.all([
			repository.listLegs(aggregateId),
			repository.listEvents(aggregateId),
		]);
		if (this.dependencies.operatorAudits) {
			await this.dependencies.operatorAudits.append({
				auditId: `audit-${this.createId()}`,
				operatorRef: context.operatorRef ?? null,
				action: "payment_detail_read",
				aggregateId,
				...(context.requestId ? { requestId: context.requestId } : {}),
				outcome: "succeeded",
				occurredAt: this.now().toISOString(),
			});
		}
		const {
			ownerUserId: _ownerUserId,
			patientId: _patientId,
			...safeAggregate
		} = aggregate;
		if (!aggregate.businessKey.startsWith("medical_insurance:")) {
			return {
				aggregate: {
					...safeAggregate,
					actualCashFen: aggregate.cashFen,
					hospitalDiscountFen: 0,
					actualPaidFen: aggregate.insuranceFen + aggregate.cashFen,
					amountBreakdownStatus: "confirmed",
				},
				legs,
				events,
			};
		}
		const orderId = aggregate.businessKey.slice("medical_insurance:".length);
		const order =
			await this.dependencies.medicalInsuranceOrders.findByMedicalOrderId(
				orderId,
			);
		const amounts: AdminPaymentAmounts = order
			? (await this.medicalAmountMetadata(order)).amounts
			: {
					insuranceFen: aggregate.insuranceFen,
					actualCashFen: null,
					hospitalDiscountFen: null,
					actualPaidFen: null,
					amountBreakdownStatus: "unverified",
				};
		// 修正本次响应的展示分项，不改写旧账本及其历史事件。
		const displayLegs: PaymentLeg[] = legs
			.filter((leg) => leg.legType === "medical_insurance")
			.map((leg) => ({ ...leg, amountFen: amounts.insuranceFen }));
		if (amounts.amountBreakdownStatus === "confirmed") {
			for (const [legType, amountFen] of [
				["wechat_cash", amounts.actualCashFen],
				["hospital_reduce", amounts.hospitalDiscountFen],
			] as const) {
				if (amountFen === null || amountFen <= 0) continue;
				const existing = legs.find((leg) => leg.legType === legType);
				displayLegs.push({
					legId:
						existing?.legId ??
						`view-${createHash("sha256").update(`${aggregateId}:${legType}`).digest("hex").slice(0, 24)}`,
					aggregateId,
					legType,
					source: legType === "wechat_cash" ? "wechat_pay" : "platform",
					sourceOrderId: orderId,
					amountFen,
					status:
						existing?.status ??
						(legType === "hospital_reduce" ||
						order?.wechatPaymentState === "cash_paid"
							? "confirmed"
							: "pending"),
					...(existing?.providerReferenceDigest && legType === "wechat_cash"
						? { providerReferenceDigest: existing.providerReferenceDigest }
						: {}),
					...(existing?.confirmedAt
						? { confirmedAt: existing.confirmedAt }
						: {}),
					version: existing?.version ?? aggregate.version,
					createdAt: existing?.createdAt ?? aggregate.createdAt,
					updatedAt: existing?.updatedAt ?? aggregate.updatedAt,
				});
			}
		}
		return {
			aggregate: {
				...safeAggregate,
				...amounts,
				cashFen: amounts.actualCashFen,
			},
			legs: displayLegs,
			events,
		};
	}

	/**
	 * 当前挂号 MD5 支付的微信 out_trade_no 由众阳 .2 返回。它不等于本地
	 * payment order id 时，只有这个服务端入口可以使用已保存的真实值。
	 */
	async requestTrustedPaymentOrder(
		input: TrustedPaymentOrderRefundInput,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = normalizeRefundInput({
			source: "payment_order",
			orderId: input.orderId,
			refundFen: input.refundFen,
			idempotencyKey: input.idempotencyKey,
			...(input.reason !== undefined ? { reason: input.reason } : {}),
		});
		const outTradeNo = requiredText(input.outTradeNo, 32);
		return this.requestForTarget(
			normalized,
			await this.resolveTarget(normalized, outTradeNo),
			context,
		);
	}

	/**
	 * 医保聚合退费的内部入口。merchantRefundNo 由医保退费编排服务稳定生成，
	 * 不接受 HTTP/Admin 输入；这样 6203 成功后重试微信腿时仍复用同一个 APIv3
	 * 退款身份，并由现有退款记录负责查单/幂等。
	 */
	async requestTrustedMedicalInsurance(
		input: {
			orderId: string;
			refundFen: number;
			idempotencyKey: string;
			merchantRefundNo: string;
			reason?: string;
			operatorRef?: string;
		},
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = normalizeRefundInput({
			source: "medical_insurance",
			orderId: input.orderId,
			refundFen: input.refundFen,
			idempotencyKey: input.idempotencyKey,
			...(input.reason !== undefined ? { reason: input.reason } : {}),
		});
		const merchantRefundNo = requiredText(input.merchantRefundNo, 64);
		return this.requestForTarget(
			normalized,
			await this.resolveTarget(normalized),
			context,
			{
				merchantRefundNo,
				...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
			},
		);
	}

	/**
	 * HIS 微信单腿退费入口。微信金额和原支付号均从服务端医保订单读取，
	 * HIS 只能按医保订单号触发，不能提交金额或 out_trade_no 覆盖服务端事实。
	 */
	async requestMedicalInsuranceCashByOrder(
		input: {
			orderId: string;
			reason?: string;
			expectedCashFen?: number;
		},
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const orderId = requiredText(input.orderId, 64);
		if (
			input.expectedCashFen !== undefined &&
			(!Number.isSafeInteger(input.expectedCashFen) ||
				input.expectedCashFen <= 0)
		) {
			throw new AdminWechatRefundInputError("已核实的微信实付金额不合法");
		}
		const existingMedicalRefunds = await this.medicalRefundHistory(orderId);
		if (
			existingMedicalRefunds.some(
				(record) => record.refundType === "ALL" && record.cashFen > 0,
			)
		) {
			throw new AdminWechatRefundInputError(
				"该医保订单已有整笔聚合退费记录，不能再次单独退微信",
			);
		}
		const { idempotencyKey } =
			medicalInsuranceWechatCashRefundIdentity(orderId);
		const listRefunds = this.dependencies.refunds.findBySourceAndSourceOrder;
		if (!listRefunds)
			throw new AdminWechatRefundInputError("微信退款台账核查不可用");
		const existingRefunds = await listRefunds.call(
			this.dependencies.refunds,
			"medical_insurance",
			orderId,
		);
		const canonical = existingRefunds.find(
			(record) =>
				record.idempotencyKey === idempotencyKey ||
				record.merchantRefundNo === hisMedicalWechatMerchantRefundNo(orderId),
		);
		if (canonical) {
			if (
				input.expectedCashFen !== undefined &&
				canonical.totalFen !== input.expectedCashFen
			)
				throw new AdminWechatRefundInputError(
					"已有微信退款与已核实的原支付金额不一致",
				);
			return canonical.status === "requested" || canonical.status === "unknown"
				? this.query(canonical.merchantRefundNo, context)
				: canonical;
		}
		const target = await this.resolveTarget({
			source: "medical_insurance",
			orderId,
			refundFen: 1,
			idempotencyKey,
			...(input.reason !== undefined ? { reason: input.reason } : {}),
		});
		if (
			input.expectedCashFen !== undefined &&
			target.totalFen !== input.expectedCashFen
		)
			throw new AdminWechatRefundInputError(
				"微信实付金额在核验后已变化，请刷新重试",
			);
		const refundFen = Math.max(
			0,
			target.totalFen -
				existingRefunds.reduce((sum, record) => sum + record.refundFen, 0),
		);
		if (refundFen <= 0)
			throw new AdminWechatRefundInputError(
				"没有剩余可退的微信自费金额，请查询已有退款",
			);
		return this.requestTrustedMedicalInsurance(
			{
				orderId,
				refundFen,
				idempotencyKey,
				merchantRefundNo: hisMedicalWechatMerchantRefundNo(orderId),
				operatorRef: "his-wechat-leg",
				...(input.reason !== undefined ? { reason: input.reason } : {}),
			},
			context,
		);
	}

	/**
	 * HIS 微信单腿退费的外部支付号入口。outTradeNo 只用于定位已落库的医保订单；
	 * 实际退款仍委托给按平台医保订单号的入口，以保持退款号、金额和幂等身份一致。
	 */
	async requestMedicalInsuranceCashByOutTradeNo(
		input: {
			outTradeNo: string;
			reason?: string;
		},
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const outTradeNo = requiredText(input.outTradeNo, 32);
		const order =
			await this.dependencies.medicalInsuranceOrders.findByWechatOutTradeNo(
				outTradeNo,
			);
		if (!order) throw new WechatRefundNotFoundError();
		return this.requestMedicalInsuranceCashByOrder(
			{
				orderId: order.medicalOrderId,
				...(input.reason !== undefined ? { reason: input.reason } : {}),
			},
			context,
		);
	}

	/** 仅供聚合退费编排服务防止与 HIS 微信单腿重复发起。 */
	async findMedicalInsuranceRefundByOrder(
		orderId: string,
		options: { requireLedgerLookup?: boolean } = {},
	): Promise<WechatRefund | undefined> {
		const find = this.dependencies.refunds.findBySourceAndSourceOrder;
		if (!find) {
			if (options.requireLedgerLookup) {
				throw new Error(
					"Medical insurance Wechat refund ledger lookup is unavailable",
				);
			}
			return undefined;
		}
		const records = await find("medical_insurance", requiredText(orderId, 64));
		return [...records].sort((left, right) => {
			const updated = right.updatedAt.localeCompare(left.updatedAt);
			return updated || right.refundRecordId.localeCompare(left.refundRecordId);
		})[0];
	}

	async query(
		merchantRefundNo: string,
		context: AdapterCallContext,
	): Promise<WechatRefund> {
		const normalized = requiredText(merchantRefundNo, 64);
		const record =
			await this.dependencies.refunds.findByMerchantRefundNo(normalized);
		if (!record) throw new WechatRefundNotFoundError();
		let saved: WechatRefund;
		try {
			const result = await this.dependencies.gateway.queryRefund(
				{ merchantRefundNo: record.merchantRefundNo },
				context,
			);
			saved = await this.applyProviderResult(record, result);
		} catch (error) {
			if (!record.idempotencyKey.startsWith("medical-refund:")) {
				await this.appendRefundAudit({
					source: record.source,
					orderId: record.sourceOrderId,
					requestId: context.traceId,
					action: "refund_query",
					outcome: "failed",
					reasonCode: errorCode(error),
				});
			}
			throw error;
		}
		if (!record.idempotencyKey.startsWith("medical-refund:")) {
			await this.appendRefundAudit({
				source: record.source,
				orderId: record.sourceOrderId,
				requestId: context.traceId,
				action: "refund_query",
				outcome: "succeeded",
			});
		}
		return saved;
	}
}
