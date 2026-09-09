import type {
	MedicalInsuranceBusinessType,
	MedicalInsuranceOrderType,
} from "./medical-insurance-business";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { WechatMedicalInsurancePayParams } from "./ports";

/**
 * 医保订单域（F 批次）。
 *
 * 事实模型对应旧链路：6201 费用上传发放 payOrdId/payToken，6202 下单返回
 * ordStas 与四项金额，6301 查单/6302 回调提供终态证据。payToken/revsToken
 * 是 provider 凭证：只允许在 adapter→持久化窄边界内出现，落库仅存 SHA-256，
 * 日志、outbox 与小程序响应禁止原文。
 */

export type MedicalInsuranceOrderStatus =
	| "created"
	/** 6201 已发放 payOrdId/payToken；尚无 6202 金额事实。 */
	| "fee_uploaded"
	/** 6202 已接受（ordStas 处理中或已含金额）；等待终态。 */
	| "order_placed"
	/** 6302/6301 确认医保部分完成且无自费差额。 */
	| "insurance_settled"
	/** 6202 显示 ownPayAmt>0，等待微信 APIv3 医保混合自费支付。 */
	| "cash_pending"
	/** 状态未知/处理中（ordStas 0-2、17-25 或 6203 EXP）；只能查单或人工。 */
	| "awaiting_confirmation"
	/** 查单重试耗尽、6203 EXP 或对账不一致；人工接管。 */
	| "manual_review"
	/** 明确失败（ordStas 14/15/16 或撤销完成）。 */
	| "failed"
	/** 已按 2.6.65.11/2.6.65.6 完成支付关单和结算取消。 */
	| "cancelled";

const STATUS_VALUES: readonly MedicalInsuranceOrderStatus[] = [
	"created",
	"fee_uploaded",
	"order_placed",
	"insurance_settled",
	"cash_pending",
	"awaiting_confirmation",
	"manual_review",
	"failed",
	"cancelled",
];

export function isMedicalInsuranceOrderStatus(
	value: unknown,
): value is MedicalInsuranceOrderStatus {
	return (
		typeof value === "string" &&
		(STATUS_VALUES as readonly string[]).includes(value)
	);
}

/**
 * 合法状态迁移表。未知迁移一律拒绝：医保订单不能被“重开”或回退，
 * 终态之后只能进入 manual_review（对账修正），不能静默改写。
 */
const ALLOWED_TRANSITIONS: Record<
	MedicalInsuranceOrderStatus,
	readonly MedicalInsuranceOrderStatus[]
> = {
	created: [
		"fee_uploaded",
		"awaiting_confirmation",
		"failed",
		"manual_review",
		"cancelled",
	],
	fee_uploaded: [
		"order_placed",
		// 6202 may return a final candidate in the same command; the adapter
		// then completes 2.27.2.32 → 2.6.65.5 before the service persists it.
		"insurance_settled",
		"cash_pending",
		"awaiting_confirmation",
		"failed",
		"manual_review",
		"cancelled",
	],
	order_placed: [
		"insurance_settled",
		"cash_pending",
		"awaiting_confirmation",
		"failed",
		"manual_review",
		"cancelled",
	],
	insurance_settled: ["manual_review"],
	cash_pending: [
		"insurance_settled",
		"awaiting_confirmation",
		"manual_review",
		"cancelled",
	],
	awaiting_confirmation: [
		"insurance_settled",
		"cash_pending",
		"failed",
		"manual_review",
		"cancelled",
	],
	manual_review: [],
	failed: ["manual_review"],
	cancelled: [],
};

export class MedicalInsuranceOrderTransitionError extends Error {
	constructor(
		readonly from: MedicalInsuranceOrderStatus,
		readonly to: MedicalInsuranceOrderStatus,
	) {
		super(`Invalid medical insurance order transition: ${from} -> ${to}`);
		this.name = "MedicalInsuranceOrderTransitionError";
	}
}

export function assertMedicalInsuranceOrderTransition(
	from: MedicalInsuranceOrderStatus,
	to: MedicalInsuranceOrderStatus,
): void {
	if (!ALLOWED_TRANSITIONS[from].includes(to)) {
		throw new MedicalInsuranceOrderTransitionError(from, to);
	}
}

/**
 * 医保结算金额（分）。
 *
 * V2.2.5 的 6202 在原四项之外增加了 `othFeeAmt`、医院负担、共济个账、
 * 本人个账、押金和配送费。扩展项保持可选，以兼容历史订单；若存在则必须
 * 通过同一套非负整数和金额守恒校验。
 */
export type MedicalInsuranceAmounts = {
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
	/** 6202 othFeeAmt；属于总费用拆分，但不是患者现金支付。 */
	otherPaymentFen?: number;
	/** 6202 hospPartAmt；医院承担金额，不重复计入 othFeeAmt 守恒项。 */
	hospitalPartFen?: number;
	/** 6202 acctMulaidPay；个人账户共济支付。 */
	personalAccountMutualAidFen?: number;
	/** 6202 selfAcctPay；本人个账支出。 */
	personalAccountSelfFen?: number;
	/** 6202/6301/6302 deposit；住院押金抵扣金额。 */
	depositFen?: number;
	/** 6202/6301/6302 delvFee；配送/打包费，不参与医保费用总额。 */
	deliveryFeeFen?: number;
};

export class InvalidMedicalInsuranceAmountsError extends Error {
	readonly reason: "not_safe_integer" | "negative" | "zero_total" | "mismatch";

	constructor(
		reason: "not_safe_integer" | "negative" | "zero_total" | "mismatch",
	) {
		super(`Invalid medical insurance amounts: ${reason}`);
		this.name = "InvalidMedicalInsuranceAmountsError";
		this.reason = reason;
	}
}

export function assertValidMedicalInsuranceAmounts(
	amounts: MedicalInsuranceAmounts,
): MedicalInsuranceAmounts {
	const values = [
		amounts.totalFen,
		amounts.cashFen,
		amounts.personalAccountFen,
		amounts.fundFen,
		amounts.otherPaymentFen ?? 0,
		amounts.hospitalPartFen ?? 0,
		amounts.personalAccountMutualAidFen ?? 0,
		amounts.personalAccountSelfFen ?? 0,
		amounts.depositFen ?? 0,
		amounts.deliveryFeeFen ?? 0,
	];
	if (values.some((value) => !Number.isSafeInteger(value))) {
		throw new InvalidMedicalInsuranceAmountsError("not_safe_integer");
	}
	if (values.some((value) => value < 0)) {
		throw new InvalidMedicalInsuranceAmountsError("negative");
	}
	if (amounts.totalFen <= 0) {
		throw new InvalidMedicalInsuranceAmountsError("zero_total");
	}
	const splitTotal =
		amounts.cashFen +
		amounts.personalAccountFen +
		amounts.fundFen +
		(amounts.otherPaymentFen ?? 0);
	if (!Number.isSafeInteger(splitTotal) || splitTotal !== amounts.totalFen) {
		throw new InvalidMedicalInsuranceAmountsError("mismatch");
	}
	return amounts;
}

export type MedicalInsuranceCashReduceDetail = {
	cashReduceFen: number;
	cashReduceType: "HOSPITAL_REDUCE";
};

export type MedicalInsurancePaymentBreakdown = {
	wechatCashFen: number;
	cashReduceDetails: readonly MedicalInsuranceCashReduceDetail[];
};

export class InvalidMedicalInsurancePaymentBreakdownError extends Error {
	constructor(
		readonly reason:
			| "hospital_reduce_not_allowed"
			| "hospital_reduce_exceeds_cash",
	) {
		super(`Invalid medical insurance payment breakdown: ${reason}`);
		this.name = "InvalidMedicalInsurancePaymentBreakdownError";
	}
}

/** 将高平普通挂号的医院承担金额映射成微信官方 HOSPITAL_REDUCE。 */
export function medicalInsurancePaymentBreakdown(input: {
	amounts: MedicalInsuranceAmounts;
	orderType: MedicalInsuranceOrderType;
	insuredAreaCode: string;
}): MedicalInsurancePaymentBreakdown {
	const amounts = assertValidMedicalInsuranceAmounts(input.amounts);
	const hospitalReduceFen = amounts.hospitalPartFen ?? 0;
	if (hospitalReduceFen === 0) {
		return { wechatCashFen: amounts.cashFen, cashReduceDetails: [] };
	}
	if (
		input.orderType !== "RegPay" ||
		input.insuredAreaCode.trim() !== "140581"
	) {
		throw new InvalidMedicalInsurancePaymentBreakdownError(
			"hospital_reduce_not_allowed",
		);
	}
	if (hospitalReduceFen > amounts.cashFen) {
		throw new InvalidMedicalInsurancePaymentBreakdownError(
			"hospital_reduce_exceeds_cash",
		);
	}
	return {
		wechatCashFen: amounts.cashFen - hospitalReduceFen,
		cashReduceDetails: [
			{
				cashReduceFen: hospitalReduceFen,
				cashReduceType: "HOSPITAL_REDUCE",
			},
		],
	};
}

/** 患者端/服务端共用的医保订单读模型；不含 provider 凭证原文。 */
export type MedicalInsuranceOrder = {
	medicalOrderId: string;
	ownerUserId: string;
	patientId: string;
	/**
	 * 统一医保订单的业务维度。旧订单可能没有该字段，读取时按 appointment_id
	 * 兼容推导为 registration；所有新订单必须显式写入，禁止从页面名称猜测。
	 */
	businessType?: MedicalInsuranceBusinessType;
	/** 发送给微信医保统一下单的 `order_type`，由业务类型推导并持久化。 */
	orderType?: MedicalInsuranceOrderType;
	/** 业务事实主键：挂号为 appointmentId，门诊为服务端确认的费用记录 ID。 */
	businessId?: string;
	/** 预约医保链路关联的服务端 opaque appointment 引用。 */
	appointmentId?: string;
	/** 授权成功后保存的服务端引用；原始 authCode 永不落库。 */
	authorizationId?: string | null;
	/** 6201 成功后的服务端费用上传引用，原始 payToken 仍只在凭证仓储内。 */
	feeUploadId?: string | null;
	idempotencyKey: string;
	medOrgOrd: string;
	chrgBchno: string;
	payOrdId: string | null;
	payTokenHash: string | null;
	/** 6201 返回并供 6202 关联的就诊/医保结算号。 */
	mdtrtId?: string | null;
	/** 2.6.33 + 1101 推导出的 6202 个账支付标志；空串表示按医保中心默认规则。 */
	acctUsedFlag?: string | null;
	status: MedicalInsuranceOrderStatus;
	ordStas: string | null;
	amounts: MedicalInsuranceAmounts | null;
	setlType: "ALL" | "CASH" | "HI" | null;
	revsTokenHash: string | null;
	revsTokenExpiresAt: string | null;
	lastError: string | null;
	/** 微信医保查单在 MED_INS_PAY_FAIL 时返回的医保局侧失败原因。 */
	medInsFailReason?: string | null;
	/** 官方微信医保混合订单标识；只保存 provider 可关联引用。 */
	wechatMixTradeNo?: string | null;
	/** 服务端生成的微信自费 out_trade_no；用于 JSAPI 预下单幂等。 */
	wechatOutTradeNo?: string | null;
	/** 微信调起参数的读模型；MySQL 实现必须以密文保存。 */
	wechatPayParams?: WechatMedicalInsurancePayParams | null;
	/** JSAPI prepay_id 最迟可调起时间；过期参数不得再次返回给小程序。 */
	wechatPrepayExpiresAt?: string | null;
	wechatPaymentState?:
		| "not_started"
		| "prepay_ready"
		| "cash_paid"
		| "failed"
		| "unknown";
	version: number;
	createdAt: string;
	updatedAt: string;
};

/**
 * 医保后置回写所需的服务端事实。
 *
 * 这些字段来自 2.6.65.1、2.27.2.27、2.6.33 和 1101；支付最终成功后
 * 再追加分项 2.6.65.2 流水。
 * 只能通过 owner-scoped 加密仓储交给医保 adapter，不能进入订单读模型、
 * API response、日志或 outbox。
 */
export type MedicalInsuranceSettlementContext = {
	businessId: string;
	businessCode?: string;
	hospitalId: string;
	patientId: string;
	/** 6201 实际费用上传使用的收费批次号；6202 必须复用同一值。历史上下文缺失时不得回退猜测。 */
	chrgBchno?: string;
	networkRegister: Record<string, unknown>;
	outNetworkSettleMain: Record<string, unknown>;
	nationalUpDetailList: readonly Record<string, unknown>[];
	upDetailList: readonly Record<string, unknown>[];
	tradeOrderIds: readonly string[];
	/** 新流程只在支付成功后的分项 .2 完成后写入。 */
	payingId?: string;
	tradingId?: string;
	/** 1101 已确认的参保地区，供支付后重试使用。 */
	insuredAreaCode?: string;
	/**
	 * 6201 前置链路的持久化阶段。`pre_6201` 表示 .1 已经产生真实
	 * 结算流水，重试时必须复用，不能再次创建；`fee_uploaded` 表示 6201
	 * 已完成。历史上下文没有该字段时按旧流程处理。
	 */
	feeUploadStage?: "pre_6201" | "fee_uploaded";
	/** .1 已校验通过的真实结算金额，供 6201 安全续跑使用。 */
	settlementAmountFen?: number;
	/**
	 * 历史版本在 6202 ownPayAmt>0 后创建的云健康插件自费上下文。
	 *
	 * 这里必须和医保主结算上下文一起加密保存，但不能复用主医保
	 * 仅用于继续完成发布前已存在的订单；新订单不再创建该前置流水。
	 */
	plugin?: MedicalInsurancePluginPaymentContext;
	/** 微信/医保最终成功后，按金额分项后置提交的 2.6.65.2 流水。 */
	postPaymentComponents?: readonly MedicalInsurancePostPaymentComponent[];
	postPaymentCompletedAt?: string;
	/** 6201 返回的独立医保收银台地址；短期保存，仅通过专用接口返回给支付小程序。 */
	cashierUrl?: string;
};

export type MedicalInsurancePostPaymentComponentKind =
	| "hospital_reduce"
	| "fund"
	| "personal_account"
	| "wechat_cash";

export type MedicalInsurancePostPaymentComponentState =
	| "pending"
	| "succeeded"
	| "failed";

export type MedicalInsurancePostPaymentComponent = {
	componentId: string;
	kind: MedicalInsurancePostPaymentComponentKind;
	totalFen: number;
	amountFen: number;
	payModel: "H5" | "MINI_PROGRAM";
	payTypeId: "2" | "3" | "50";
	recordCode: string;
	state: MedicalInsurancePostPaymentComponentState;
	attempts: number;
	payingId?: string;
	tradingId?: string;
	providerRequestId?: string;
	lastErrorCode?: string;
	updatedAt: string;
};

export type MedicalInsurancePluginPaymentState =
	| "preorder_created"
	| "prepay_ready"
	| "cash_paid"
	| "29_succeeded"
	| "15_succeeded"
	| "settled";

/** 旧服务插件混合支付的完整服务端事实，禁止进入患者端响应。 */
export type MedicalInsurancePluginPaymentContext = {
	/** 对应平台 hp_payment_orders 的内部订单号。 */
	paymentOrderId: string;
	/** 历史版第二次 2.6.65.2 返回的插件支付流水。 */
	payingId: string;
	tradingId: string;
	payTypeId: string;
	payType: "CREDIT" | "POS" | "CROWD_FUNDING";
	workStationId: string;
	tradeCode: string;
	tradeTypeCode: string;
	/** 微信 JSAPI 与 .29 agreementNo 共用的 out_trade_no。 */
	outTradeNo: string;
	/** 传给 2.6.65.15 的稳定 32 位三方支付单号。 */
	recordCode: string;
	/**
	 * 2.27.2.29 的完整原始响应，仅用于服务端加密留存和后续审计查看；
	 * 业务流程不得从该字段推导状态或金额。
	 */
	thirdPartPayRawResponse?: string;
	prepayId?: string;
	thirdPartPayRecordId?: string;
	wechatTransactionId?: string;
	state: MedicalInsurancePluginPaymentState;
};

/** 6302 结算结果通知的已解密事实（open 之后进入 domain 的形状）。 */
export type MedicalInsuranceSettlementNotification = {
	payOrdId: string;
	callType: string;
	medOrgOrd: string;
	traceTime: string;
	feeSumamt: number;
	ownPayAmt: number;
	psnAcctPay: number;
	fundPay: number;
	/** V2.2.5 扩展项；6302 旧回调未提供时保持 undefined。 */
	othFeeAmt?: number;
	hospPartAmt?: number;
	acctMulaidPay?: number;
	selfAcctPay?: number;
	deposit?: number;
	delvFee?: number;
	setlType: "ALL" | "CASH" | "HI";
	revsToken: string;
};

export class InvalidMedicalInsuranceNotificationError extends Error {
	constructor(reason: string) {
		super(`Invalid medical insurance settlement notification: ${reason}`);
		this.name = "InvalidMedicalInsuranceNotificationError";
	}
}

/**
 * 校验 6302 通知事实并归一化金额为分。
 * 规范要求 callType 固定 02（支付成功回调）；其它值不能驱动订单终态。
 */
export function normalizeMedicalInsuranceSettlementNotification(
	input: Record<string, unknown>,
): MedicalInsuranceSettlementNotification {
	const yuanToFen = (value: unknown, field: string): number => {
		const text =
			typeof value === "string"
				? value.trim()
				: typeof value === "number" && Number.isFinite(value)
					? String(value)
					: "";
		if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
			throw new InvalidMedicalInsuranceNotificationError(
				`${field} must be a non-negative yuan amount`,
			);
		}
		const [wholeValue, fractionValue = ""] = text.split(".");
		if (!wholeValue) {
			throw new InvalidMedicalInsuranceNotificationError(`${field} is invalid`);
		}
		const fen =
			BigInt(wholeValue) * 100n + BigInt(fractionValue.padEnd(2, "0"));
		if (fen > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new InvalidMedicalInsuranceNotificationError(
				`${field} exceeds the safe integer range`,
			);
		}
		return Number(fen);
	};
	const text = (field: string, max: number): string => {
		const value = input[field];
		if (
			typeof value !== "string" ||
			!value.trim() ||
			value.length > max ||
			value !== value.trim()
		) {
			throw new InvalidMedicalInsuranceNotificationError(
				`${field} is required`,
			);
		}
		return value.trim();
	};
	const optionalAmount = (field: string): number | undefined => {
		if (
			input[field] === undefined ||
			input[field] === null ||
			input[field] === ""
		)
			return undefined;
		return yuanToFen(input[field], field);
	};
	const setlTypeRaw = text("setlType", 8);
	if (setlTypeRaw !== "ALL" && setlTypeRaw !== "CASH" && setlTypeRaw !== "HI") {
		throw new InvalidMedicalInsuranceNotificationError(
			"setlType must be ALL, CASH or HI",
		);
	}
	const othFeeAmt = optionalAmount("othFeeAmt");
	const hospPartAmt = optionalAmount("hospPartAmt");
	const acctMulaidPay = optionalAmount("acctMulaidPay");
	const selfAcctPay = optionalAmount("selfAcctPay");
	const deposit = optionalAmount("deposit");
	const delvFee = optionalAmount("delvFee");
	const notification: MedicalInsuranceSettlementNotification = {
		payOrdId: text("payOrdId", 64),
		callType: text("callType", 8),
		medOrgOrd: text("medOrgOrd", 64),
		traceTime: text("traceTime", 40),
		feeSumamt: yuanToFen(input.feeSumamt, "feeSumamt"),
		ownPayAmt: yuanToFen(input.ownPayAmt, "ownPayAmt"),
		psnAcctPay: yuanToFen(input.psnAcctPay, "psnAcctPay"),
		fundPay: yuanToFen(input.fundPay, "fundPay"),
		...(othFeeAmt === undefined ? {} : { othFeeAmt }),
		...(hospPartAmt === undefined ? {} : { hospPartAmt }),
		...(acctMulaidPay === undefined ? {} : { acctMulaidPay }),
		...(selfAcctPay === undefined ? {} : { selfAcctPay }),
		...(deposit === undefined ? {} : { deposit }),
		...(delvFee === undefined ? {} : { delvFee }),
		setlType: setlTypeRaw,
		revsToken: text("revsToken", 64),
	};
	if (notification.callType !== "02") {
		throw new InvalidMedicalInsuranceNotificationError(
			"callType must be 02 for a payment-success notification",
		);
	}
	assertValidMedicalInsuranceAmounts({
		totalFen: notification.feeSumamt,
		cashFen: notification.ownPayAmt,
		personalAccountFen: notification.psnAcctPay,
		fundFen: notification.fundPay,
		...(notification.othFeeAmt === undefined
			? {}
			: { otherPaymentFen: notification.othFeeAmt }),
		...(notification.hospPartAmt === undefined
			? {}
			: { hospitalPartFen: notification.hospPartAmt }),
		...(notification.acctMulaidPay === undefined
			? {}
			: { personalAccountMutualAidFen: notification.acctMulaidPay }),
		...(notification.selfAcctPay === undefined
			? {}
			: { personalAccountSelfFen: notification.selfAcctPay }),
		...(notification.deposit === undefined
			? {}
			: { depositFen: notification.deposit }),
		...(notification.delvFee === undefined
			? {}
			: { deliveryFeeFen: notification.delvFee }),
	});
	return notification;
}

/**
 * 依据 6302 通知推导订单目标状态。6302 只证明医保侧产生了结算结果，纯医保
 * 和混合支付都必须继续走微信官方医保订单查单，并在医院 .5 回写成功后才能
 * 进入 insurance_settled；因此金额一致时统一停在 cash_pending。
 * 通知金额与订单已落库 6202 金额不一致时进入 awaiting_confirmation，
 * 不允许直接覆盖（权威差异必须人工对账）。
 */
export function medicalInsuranceStatusForNotification(
	notification: MedicalInsuranceSettlementNotification,
	currentAmounts: MedicalInsuranceAmounts | null,
): "insurance_settled" | "cash_pending" | "awaiting_confirmation" {
	const amounts: MedicalInsuranceAmounts = {
		totalFen: notification.feeSumamt,
		cashFen: notification.ownPayAmt,
		personalAccountFen: notification.psnAcctPay,
		fundFen: notification.fundPay,
		...(notification.othFeeAmt === undefined
			? {}
			: { otherPaymentFen: notification.othFeeAmt }),
		...(notification.hospPartAmt === undefined
			? {}
			: { hospitalPartFen: notification.hospPartAmt }),
		...(notification.acctMulaidPay === undefined
			? {}
			: { personalAccountMutualAidFen: notification.acctMulaidPay }),
		...(notification.selfAcctPay === undefined
			? {}
			: { personalAccountSelfFen: notification.selfAcctPay }),
		...(notification.deposit === undefined
			? {}
			: { depositFen: notification.deposit }),
		...(notification.delvFee === undefined
			? {}
			: { deliveryFeeFen: notification.delvFee }),
	};
	if (currentAmounts) {
		const same =
			currentAmounts.totalFen === amounts.totalFen &&
			currentAmounts.cashFen === amounts.cashFen &&
			currentAmounts.personalAccountFen === amounts.personalAccountFen &&
			currentAmounts.fundFen === amounts.fundFen &&
			(currentAmounts.otherPaymentFen ?? 0) ===
				(amounts.otherPaymentFen ?? 0) &&
			(currentAmounts.hospitalPartFen ?? 0) ===
				(amounts.hospitalPartFen ?? 0) &&
			(currentAmounts.personalAccountMutualAidFen ?? 0) ===
				(amounts.personalAccountMutualAidFen ?? 0) &&
			(currentAmounts.personalAccountSelfFen ?? 0) ===
				(amounts.personalAccountSelfFen ?? 0) &&
			(currentAmounts.depositFen ?? 0) === (amounts.depositFen ?? 0) &&
			(currentAmounts.deliveryFeeFen ?? 0) === (amounts.deliveryFeeFen ?? 0);
		if (!same) return "awaiting_confirmation";
	}
	return "cash_pending";
}

/** 查单任务状态；与 outbox/prepay 查单保持同一种 12 次上限语义。 */
export type MedicalInsuranceQueryTaskStatus =
	| "pending"
	| "in_progress"
	| "awaiting_confirmation"
	| "completed"
	| "manual_review";

export type MedicalInsuranceQueryTask = {
	taskId: string;
	medicalOrderId: string;
	status: MedicalInsuranceQueryTaskStatus;
	/** 查单任务和订单事实分别做 CAS，防止重复查单覆盖终态。 */
	version: number;
	attempts: number;
	maxAttempts: number;
	nextAttemptAt: string;
	claimedUntil: string | null;
	terminalOrdStas: string | null;
	lastErrorCode: string | null;
	createdAt: string;
	updatedAt: string;
};

export const MAX_MEDICAL_INSURANCE_QUERY_ATTEMPTS = 12;

/**
 * 医保 6301 查单任务的持久化端口。
 *
 * claim 必须在数据库侧原子地把 pending 任务改成 in_progress 并递增
 * version；update 也必须携带 claim 后的 version。这样 Worker 崩溃、重复
 * tick 或多实例并行时，最多只有一个实例能继续处理同一任务。
 */
export interface MedicalInsuranceQueryTaskRepository {
	/**
	 * 以 taskId 幂等入队；taskId 指向另一订单时必须拒绝，已存在任务的状态、版本
	 * 和调度字段以数据库权威行返回，不能被重新入队覆盖。
	 */
	insert(task: MedicalInsuranceQueryTask): Promise<MedicalInsuranceQueryTask>;
	/**
	 * 微信混合预下单或任一支付回调到达后，重新唤醒同一医保订单的持久化
	 * 查单任务。manual_review 不会被自动重开，避免回调重放绕过人工闸门。
	 */
	requeue(medicalOrderId: string, now: Date): Promise<void>;
	claimDueForQuery(
		now: Date,
		limit: number,
		leaseMs: number,
	): Promise<readonly MedicalInsuranceQueryTask[]>;
	update(
		task: MedicalInsuranceQueryTask,
		expectedVersion: number,
	): Promise<MedicalInsuranceQueryTask>;
}

/** 订单引用与凭证指纹的公共校验；持久化与 service 共用。 */
export function isValidMedicalInsuranceReference(value: unknown): boolean {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 64 &&
		isBoundedOpaqueIdentifier(value)
	);
}

/**
 * 医保订单仓储端口。
 *
 * v1 只承载 6302/6301 事实落库与查询；6201/6202 编排写入（insert）由
 * 后续编排 service 使用。所有状态变更必须带 expectedVersion 做 CAS，
 * 回调与查单并发到达时只允许一方生效。
 */
export interface MedicalInsuranceOrderRepository {
	insert(order: MedicalInsuranceOrder): Promise<MedicalInsuranceOrder>;
	findByMedicalOrderId(
		medicalOrderId: string,
	): Promise<MedicalInsuranceOrder | undefined>;
	findByPayOrdId(payOrdId: string): Promise<MedicalInsuranceOrder | undefined>;
	/** 微信医保混合回调只携带 mix_trade_no，必须用服务端订单关联查询。 */
	findByWechatMixTradeNo(
		mixTradeNo: string,
	): Promise<MedicalInsuranceOrder | undefined>;
	/** 普通 JSAPI 成功回调携带 out_trade_no，用它识别医保混合单的现金段。 */
	findByWechatOutTradeNo(
		outTradeNo: string,
	): Promise<MedicalInsuranceOrder | undefined>;
	findByOwnerAndAppointmentId(
		ownerUserId: string,
		appointmentId: string,
	): Promise<MedicalInsuranceOrder | undefined>;
	/**
	 * 统一业务键查询。旧实现可暂不提供，编排层会回退到旧的幂等查询；
	 * MySQL 和内存实现必须实现它，保证门诊不会复用 appointment 专属查询。
	 */
	findByOwnerAndBusinessKey?: (
		ownerUserId: string,
		businessType: MedicalInsuranceBusinessType,
		businessId: string,
	) => Promise<MedicalInsuranceOrder | undefined>;
	findByOwnerAndIdempotencyKey(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<MedicalInsuranceOrder | undefined>;
	saveSettlementContext(
		ownerUserId: string,
		medicalOrderId: string,
		context: MedicalInsuranceSettlementContext,
	): Promise<void>;
	/** 只在当前订单尚无上下文时写入；用于受控历史订单补录，必须原子防覆盖。 */
	saveSettlementContextIfMissing(
		ownerUserId: string,
		medicalOrderId: string,
		context: MedicalInsuranceSettlementContext,
	): Promise<boolean>;
	getSettlementContext(
		ownerUserId: string,
		medicalOrderId: string,
	): Promise<MedicalInsuranceSettlementContext | undefined>;
	applySettlement(
		medicalOrderId: string,
		expectedVersion: number,
		patch: {
			status: MedicalInsuranceOrderStatus;
			ordStas: string | null;
			amounts: MedicalInsuranceAmounts | null;
			setlType: "ALL" | "CASH" | "HI" | null;
			revsTokenHash: string | null;
			revsTokenExpiresAt: string | null;
			appointmentId?: string;
			businessType?: MedicalInsuranceBusinessType;
			orderType?: MedicalInsuranceOrderType;
			businessId?: string;
			authorizationId?: string | null;
			feeUploadId?: string | null;
			payOrdId?: string | null;
			payTokenHash?: string | null;
			mdtrtId?: string | null;
			acctUsedFlag?: string | null;
			wechatMixTradeNo?: string | null;
			wechatOutTradeNo?: string | null;
			wechatPayParams?: WechatMedicalInsurancePayParams | null;
			wechatPrepayExpiresAt?: string | null;
			wechatPaymentState?: MedicalInsuranceOrder["wechatPaymentState"];
			/** 传 null 清除旧原因；未提供则保持已有值。 */
			medInsFailReason?: string | null;
		},
	): Promise<MedicalInsuranceOrder | undefined>;
}
