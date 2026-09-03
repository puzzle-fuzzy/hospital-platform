import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

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
	/** 6202 显示 ownPayAmt>0，等待插件自费支付。 */
	| "cash_pending"
	/** 状态未知/处理中（ordStas 0-2、17-25 或 6203 EXP）；只能查单或人工。 */
	| "awaiting_confirmation"
	/** 查单重试耗尽、6203 EXP 或对账不一致；人工接管。 */
	| "manual_review"
	/** 明确失败（ordStas 14/15/16 或撤销完成）。 */
	| "failed";

const STATUS_VALUES: readonly MedicalInsuranceOrderStatus[] = [
	"created",
	"fee_uploaded",
	"order_placed",
	"insurance_settled",
	"cash_pending",
	"awaiting_confirmation",
	"manual_review",
	"failed",
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
	created: ["fee_uploaded", "failed", "manual_review"],
	fee_uploaded: [
		"order_placed",
		"awaiting_confirmation",
		"failed",
		"manual_review",
	],
	order_placed: [
		"insurance_settled",
		"cash_pending",
		"awaiting_confirmation",
		"failed",
		"manual_review",
	],
	insurance_settled: ["manual_review"],
	cash_pending: ["insurance_settled", "awaiting_confirmation", "manual_review"],
	awaiting_confirmation: [
		"insurance_settled",
		"cash_pending",
		"failed",
		"manual_review",
	],
	manual_review: [],
	failed: ["manual_review"],
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

/** 医保四项金额（分）；total = cash + personalAccount + fund，与 6202/6301 一致。 */
export type MedicalInsuranceAmounts = {
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
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
		amounts.cashFen + amounts.personalAccountFen + amounts.fundFen;
	if (!Number.isSafeInteger(splitTotal) || splitTotal !== amounts.totalFen) {
		throw new InvalidMedicalInsuranceAmountsError("mismatch");
	}
	return amounts;
}

/** 患者端/服务端共用的医保订单读模型；不含 provider 凭证原文。 */
export type MedicalInsuranceOrder = {
	medicalOrderId: string;
	ownerUserId: string;
	patientId: string;
	idempotencyKey: string;
	medOrgOrd: string;
	chrgBchno: string;
	payOrdId: string | null;
	payTokenHash: string | null;
	status: MedicalInsuranceOrderStatus;
	ordStas: string | null;
	amounts: MedicalInsuranceAmounts | null;
	setlType: "ALL" | "CASH" | "HI" | null;
	revsTokenHash: string | null;
	revsTokenExpiresAt: string | null;
	lastError: string | null;
	version: number;
	createdAt: string;
	updatedAt: string;
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
	const setlTypeRaw = text("setlType", 8);
	if (setlTypeRaw !== "ALL" && setlTypeRaw !== "CASH" && setlTypeRaw !== "HI") {
		throw new InvalidMedicalInsuranceNotificationError(
			"setlType must be ALL, CASH or HI",
		);
	}
	const notification: MedicalInsuranceSettlementNotification = {
		payOrdId: text("payOrdId", 64),
		callType: text("callType", 8),
		medOrgOrd: text("medOrgOrd", 64),
		traceTime: text("traceTime", 40),
		feeSumamt: yuanToFen(input.feeSumamt, "feeSumamt"),
		ownPayAmt: yuanToFen(input.ownPayAmt, "ownPayAmt"),
		psnAcctPay: yuanToFen(input.psnAcctPay, "psnAcctPay"),
		fundPay: yuanToFen(input.fundPay, "fundPay"),
		setlType: setlTypeRaw,
		revsToken: text("revsToken", 64),
	};
	assertValidMedicalInsuranceAmounts({
		totalFen: notification.feeSumamt,
		cashFen: notification.ownPayAmt,
		personalAccountFen: notification.psnAcctPay,
		fundFen: notification.fundPay,
	});
	return notification;
}

/**
 * 依据 6302 通知推导订单目标状态：现金为 0 即医保全结，否则等待插件自费。
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
	};
	if (currentAmounts) {
		const same =
			currentAmounts.totalFen === amounts.totalFen &&
			currentAmounts.cashFen === amounts.cashFen &&
			currentAmounts.personalAccountFen === amounts.personalAccountFen &&
			currentAmounts.fundFen === amounts.fundFen;
		if (!same) return "awaiting_confirmation";
	}
	return amounts.cashFen === 0 ? "insurance_settled" : "cash_pending";
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
	 * 以 taskId 幂等入队；相同 taskId 但指向另一订单或不同调度内容必须拒绝。
	 */
	insert(task: MedicalInsuranceQueryTask): Promise<MedicalInsuranceQueryTask>;
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
	findByPayOrdId(payOrdId: string): Promise<MedicalInsuranceOrder | undefined>;
	findByOwnerAndIdempotencyKey(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<MedicalInsuranceOrder | undefined>;
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
		},
	): Promise<MedicalInsuranceOrder | undefined>;
}
