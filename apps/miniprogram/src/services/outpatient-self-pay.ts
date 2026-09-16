import {
	ApiError,
	queryOutpatientSelfPay,
	requestOutpatientSelfPay,
} from "./api-client";

export type OutpatientSelfPayProgress = "creating" | "paying" | "confirming";

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
	onProgress: (stage: OutpatientSelfPayProgress, message: string) => void,
) {
	for (const delay of QUERY_DELAYS_MS) {
		await wait(delay);
		onProgress("confirming", "正在确认门诊微信支付结果，请勿重复付款");
		const result = await queryOutpatientSelfPay(recordId, patientId);
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
) {
	onProgress("creating", "正在创建门诊微信支付订单，请勿重复点击");
	const payment = await requestOutpatientSelfPay(recordId, patientId);
	if (payment.data.status === "cash_paid") return payment;
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
	onProgress("paying", "正在打开微信支付收银台，请勿重复点击");
	await new Promise<void>((resolve, reject) => {
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
				success: () => finish(resolve),
				fail: (error) =>
					finish(() =>
						reject(
							/cancel/iu.test(String(error?.errMsg ?? ""))
								? new ApiError("用户取消了微信支付", {
										code: "payment-cancelled",
									})
								: new ApiError("微信支付调起失败", {
										code: "wechat-payment-launch-failed",
									}),
						),
					),
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
	return queryUntilSettled(recordId, patientId, onProgress);
}
