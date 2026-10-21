import {
	ApiError,
	createIdempotencyKey,
	queryOutpatientSelfPay,
	requestOutpatientSelfPay,
	requestOutpatientSelfPayCancellation,
} from "./api-client";
import { isCurrentSelectedPatient } from "./patient-selection-service";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "./session-generation";
import { hasPlatformSession } from "./session-service";

export type OutpatientSelfPayProgress =
	| "creating"
	| "paying"
	| "confirming"
	| "cancelling";

export class OutpatientSelfPayCancellationPendingError extends Error {
	constructor() {
		super("取消状态正在确认，请勿重复付款");
		this.name = "OutpatientSelfPayCancellationPendingError";
	}
}

export class OutpatientSelfPayPendingError extends Error {
	constructor() {
		super("门诊微信支付仍在确认");
		this.name = "OutpatientSelfPayPendingError";
	}
}

const QUERY_DELAYS_MS = [0, 800, 1600] as const;
const PAYMENT_TIMEOUT_MS = 60_000;

function wait(ms: number): Promise<void> {
	return ms <= 0
		? Promise.resolve()
		: new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryUntilSettled(
	recordId: string,
	patientId: string,
	orderId: string,
	onProgress: (stage: OutpatientSelfPayProgress, message: string) => void,
	assertCurrent: () => void,
) {
	for (const delay of QUERY_DELAYS_MS) {
		assertCurrent();
		await wait(delay);
		assertCurrent();
		onProgress("confirming", "正在确认门诊微信支付结果，请勿重复付款");
		const result = await queryOutpatientSelfPay(recordId, patientId, orderId);
		assertCurrent();
		if (result.data.status === "cash_paid") return result;
		if (result.data.status === "failed") {
			throw new ApiError("微信支付已失败，请稍后重试", {
				code: "payment-order-conflict",
			});
		}
	}
	throw new OutpatientSelfPayPendingError();
}

/** 门诊微信支付：服务端下单后调起微信，回到服务端查单确认。 */
export async function startOutpatientSelfPay(
	recordId: string,
	patientId: string,
	onProgress: (stage: OutpatientSelfPayProgress, message: string) => void,
	isPageCurrent: () => boolean = () => true,
) {
	const session = getSessionGeneration();
	const assertCurrent = () => {
		if (
			!isCurrentSessionGeneration(session) ||
			!isCurrentSelectedPatient(patientId) ||
			!isPageCurrent() ||
			!hasPlatformSession()
		) {
			throw new ApiError("Outpatient payment context changed", {
				code: "session-changed",
			});
		}
	};
	assertCurrent();
	onProgress("creating", "正在创建门诊微信支付订单，请勿重复点击");
	const payment = await requestOutpatientSelfPay(recordId, patientId);
	assertCurrent();
	if (payment.data.status === "cash_paid") return payment;
	// 已有订单待确认（含持久化取消标记）不能再次调起原收银台。
	if (payment.data.status === "awaiting_confirmation") return payment;
	if (payment.data.status === "failed") {
		throw new ApiError("微信支付已失败，请稍后重试", {
			code: "payment-order-conflict",
		});
	}
	const params = payment.data.payParams;
	if (params?.signType !== "MD5") {
		throw new ApiError("服务端支付参数不可用", {
			code: "wechat-pay-params-missing",
		});
	}
	const cancelIdempotencyKey = createIdempotencyKey(
		"outpatient-self-pay-cancel",
	);
	onProgress("paying", "正在打开微信支付收银台，请勿重复点击");
	const outcome = await new Promise<"paid" | "cancelled">((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			reject(
				new ApiError("微信支付收银台响应超时，支付结果可能仍在确认", {
					code: "payment-prepay-unknown",
				}),
			);
		}, PAYMENT_TIMEOUT_MS);
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};
		try {
			wx.requestPayment({
				...params,
				success: () => finish(() => resolve("paid")),
				fail: (error) =>
					finish(() => {
						if (
							/^requestPayment:fail\s+cancel$/u.test(
								String(error?.errMsg ?? "").trim(),
							)
						)
							resolve("cancelled");
						else
							reject(
								new ApiError("微信支付调起失败", {
									code: "wechat-payment-launch-failed",
								}),
							);
					}),
			});
		} catch {
			finish(() =>
				reject(
					new ApiError("微信支付调起失败", {
						code: "wechat-payment-launch-failed",
					}),
				),
			);
		}
	});
	assertCurrent();
	if (outcome === "cancelled") {
		onProgress("cancelling", "正在核对并取消本次结算，请勿重复付款");
		try {
			const result = await requestOutpatientSelfPayCancellation(
				{ recordId, patientId, orderId: payment.data.orderId },
				cancelIdempotencyKey,
				session,
			);
			assertCurrent();
			return result;
		} catch {
			assertCurrent();
			throw new OutpatientSelfPayCancellationPendingError();
		}
	}
	return queryUntilSettled(
		recordId,
		patientId,
		payment.data.orderId,
		onProgress,
		assertCurrent,
	);
}
