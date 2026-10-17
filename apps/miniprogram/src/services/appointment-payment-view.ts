/** 平台支付状态与医院预约状态分开读取，医院终态始终收紧付款权限。 */
export type AppointmentPaymentStatus =
	| "pending"
	| "confirming"
	| "paid"
	| "expired"
	| "cancelled"
	| "unavailable";

export type AppointmentPaymentFields = {
	paymentStatus?: AppointmentPaymentStatus;
	canPay?: boolean;
	payExpiresAt?: string;
};

const PAYMENT_LABELS: Record<AppointmentPaymentStatus, string> = {
	pending: "待缴费",
	confirming: "支付确认中",
	paid: "已缴费",
	expired: "已过期",
	cancelled: "已取消",
	unavailable: "支付暂不可用",
};

/** 旧 API 可以缺省字段；新字段一旦出现，就必须满足明确的公共形状。 */
export function readAppointmentPaymentFields(
	value: Record<string, unknown>,
): AppointmentPaymentFields | null {
	const { paymentStatus, canPay, payExpiresAt } = value;
	if (
		(paymentStatus !== undefined &&
			(typeof paymentStatus !== "string" ||
				!Object.hasOwn(PAYMENT_LABELS, paymentStatus))) ||
		(canPay !== undefined && typeof canPay !== "boolean") ||
		(payExpiresAt !== undefined &&
			(typeof payExpiresAt !== "string" ||
				!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(
					payExpiresAt,
				) ||
				!Number.isFinite(Date.parse(payExpiresAt))))
	)
		return null;
	return {
		...(paymentStatus === undefined
			? {}
			: { paymentStatus: paymentStatus as AppointmentPaymentStatus }),
		...(canPay === undefined ? {} : { canPay: canPay as boolean }),
		...(payExpiresAt === undefined
			? {}
			: { payExpiresAt: payExpiresAt as string }),
	};
}

type PaymentViewInput = AppointmentPaymentFields & {
	status: string;
	selfPayStatus?: string;
};

/** 整单状态优先；仅旧 API 缺少整单状态时兼容现金已付，医院终态不算缴费完成。 */
export function isAppointmentPaymentCompleted(
	value: PaymentViewInput,
): boolean {
	if (value.status === "cancelled" || value.status === "expired") return false;
	return (
		value.paymentStatus === "paid" ||
		(value.paymentStatus === undefined && value.selfPayStatus === "cash_paid")
	);
}

/** 仅明确存在旧支付时提供查单；到期本身不表示已有资金订单。 */
export function hasKnownAppointmentPayment(value: PaymentViewInput): boolean {
	return (
		(value.selfPayStatus !== undefined &&
			value.selfPayStatus !== "not_started") ||
		value.paymentStatus === "confirming" ||
		value.paymentStatus === "paid"
	);
}

export function canContinueAppointmentPayment(
	value: PaymentViewInput,
	now = Date.now(),
): boolean {
	if (value.status !== "scheduled" || value.canPay === false) return false;
	if (value.payExpiresAt && Date.parse(value.payExpiresAt) <= now) return false;
	if (value.paymentStatus !== undefined)
		return value.paymentStatus === "pending";
	// 旧 API 只提供预约状态和自费状态时，不为已支付/确认中的订单再次调起收银台。
	return (
		value.selfPayStatus === undefined || value.selfPayStatus === "not_started"
	);
}

export function appointmentPaymentStatusLabel(
	value: PaymentViewInput,
	fallback: string,
): string {
	if (value.status === "cancelled") return "已取消";
	if (value.status === "expired") return "已过期";
	if (value.status !== "scheduled" && value.paymentStatus === "pending")
		return fallback;
	return value.paymentStatus ? PAYMENT_LABELS[value.paymentStatus] : fallback;
}

export function appointmentPaymentBlockedMessage(
	value: PaymentViewInput,
): string {
	if (isAppointmentPaymentCompleted(value))
		return "本次挂号已缴费，请勿重复付款";
	if (
		value.status === "expired" ||
		value.paymentStatus === "expired" ||
		(value.payExpiresAt && Date.parse(value.payExpiresAt) <= Date.now())
	) {
		return "预约支付期限已过，不能继续付款；如已扣款，请联系医院核对原支付结果";
	}
	if (value.status === "cancelled" || value.paymentStatus === "cancelled") {
		return "预约已取消，不能继续付款；如已扣款，请联系医院核对原支付结果";
	}
	if (
		value.paymentStatus === "confirming" ||
		(value.paymentStatus === undefined &&
			value.selfPayStatus === "awaiting_confirmation")
	)
		return "原支付结果正在确认，请稍后查看挂号详情；如已扣款请勿重复付款";
	return "当前预约不可继续付款，请查看挂号详情或联系医院核实";
}

/** 截止时间固定显示中国标准时间，不随设备时区改变。 */
export function appointmentPayDeadlineLabel(value: string | undefined): string {
	if (!value || !Number.isFinite(Date.parse(value))) return "";
	return new Date(Date.parse(value) + 8 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 19)
		.replace("T", " ");
}
