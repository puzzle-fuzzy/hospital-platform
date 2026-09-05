import {
	ApiError,
	queryAppointmentSelfPay,
	requestAppointmentSelfPay,
	toWechatPaymentParams,
} from "./api-client";

export type RegistrationSelfPayProgress = "creating" | "paying" | "confirming";

/** 用户取消微信收银台时，预约仍保留，页面可以继续支付。 */
export class RegistrationSelfPayCancelledError extends Error {
	constructor() {
		super("用户已取消自费支付");
		this.name = "RegistrationSelfPayCancelledError";
	}
}

/** 微信已调起但服务端尚未拿到最终结果；不能把它显示成支付失败。 */
export class RegistrationSelfPayPendingError extends Error {
	constructor() {
		super("微信自费支付仍在确认");
		this.name = "RegistrationSelfPayPendingError";
	}
}

const QUERY_DELAYS_MS = [0, 800, 1600] as const;

function wait(delayMs: number): Promise<void> {
	if (delayMs <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function paymentFailed(): ApiError {
	return new ApiError("微信自费支付已失败，请稍后重试", {
		code: "payment-order-conflict",
	});
}

async function queryUntilSettled(
	appointmentId: string,
	onProgress: (stage: RegistrationSelfPayProgress, message: string) => void,
): Promise<{ status: "cash_paid"; orderId: string } | { status: "pending" }> {
	for (const delayMs of QUERY_DELAYS_MS) {
		await wait(delayMs);
		onProgress("confirming", "正在确认微信自费支付结果");
		const result = await queryAppointmentSelfPay(appointmentId);
		if (result.data.status === "cash_paid") {
			return { status: "cash_paid", orderId: result.data.orderId };
		}
		if (result.data.status === "failed") throw paymentFailed();
	}
	return { status: "pending" };
}

/**
 * 挂号自费支付的最小真实流程：创建/重放订单 → 调起微信 → 服务端查单。
 * 这里不把 wx.requestPayment 的 success 当成支付完成，也不在客户端保存金额
 * 或支付凭证；用户取消后只抛出可识别的本地错误，预约和服务端订单都保留。
 */
export async function startRegistrationSelfPay(
	appointmentId: string,
	onProgress: (stage: RegistrationSelfPayProgress, message: string) => void,
): Promise<{ status: "cash_paid"; orderId: string }> {
	onProgress("creating", "正在创建自费支付订单");
	const payment = await requestAppointmentSelfPay(appointmentId);
	if (payment.data.status === "cash_paid") {
		return { status: "cash_paid", orderId: payment.data.orderId };
	}
	if (payment.data.status === "failed") throw paymentFailed();

	const paymentParams = toWechatPaymentParams(payment);
	if (!paymentParams) {
		const settled = await queryUntilSettled(appointmentId, onProgress);
		if (settled.status === "cash_paid") return settled;
		throw new RegistrationSelfPayPendingError();
	}

	onProgress("paying", "正在打开微信自费支付收银台");
	let cancelled = false;
	await new Promise<void>((resolve, reject) => {
		wx.requestPayment({
			...paymentParams,
			success: () => resolve(),
			fail: (error) => {
				const errMsg = typeof error?.errMsg === "string" ? error.errMsg : "";
				if (/cancel/i.test(errMsg)) {
					cancelled = true;
					resolve();
					return;
				}
				reject(
					new ApiError("微信支付调起失败", {
						code: "wechat-payment-launch-failed",
					}),
				);
			},
		});
	});

	let settled: Awaited<ReturnType<typeof queryUntilSettled>>;
	try {
		settled = await queryUntilSettled(appointmentId, onProgress);
	} catch (error) {
		// 用户已经明确取消收银台时，查单网络波动不能被转换成“请求失败”；
		// 预约仍保留，下一次点击会按服务端固定订单继续确认。
		if (cancelled) throw new RegistrationSelfPayPendingError();
		throw error;
	}
	if (settled.status === "cash_paid") return settled;
	if (cancelled) throw new RegistrationSelfPayCancelledError();
	throw new RegistrationSelfPayPendingError();
}
