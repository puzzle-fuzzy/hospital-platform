import { PAY_CONFIG, STORAGE_KEYS } from "../config";
import type { CreatedAppointment } from "./appointment";
import { newIdempotencyKey, request } from "./request";

export type PaymentProgress =
	| "authorizing"
	| "insuring"
	| "settling"
	| "polling"
	| "success";

/** 回跳前只保存新版平台的 opaque 引用，不保存患者实名、医院号或医保凭证。 */
export type PendingPayment = {
	appointmentId: string;
	patientId: string;
	orderId?: string;
	authorizeIdempotencyKey: string;
	feesIdempotencyKey: string;
	settleIdempotencyKey: string;
};

type Progress = (stage: PaymentProgress, message: string) => void;

function isOpaque(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function validPending(value: unknown): value is PendingPayment {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return (
		isOpaque(item.appointmentId) &&
		isOpaque(item.patientId) &&
		isOpaque(item.authorizeIdempotencyKey) &&
		isOpaque(item.feesIdempotencyKey) &&
		isOpaque(item.settleIdempotencyKey) &&
		(item.orderId === undefined || isOpaque(item.orderId))
	);
}

function savePending(value: PendingPayment): void {
	wx.setStorageSync(STORAGE_KEYS.pendingPayment, value);
}

export function readPendingPayment(): PendingPayment | null {
	const value = wx.getStorageSync(STORAGE_KEYS.pendingPayment);
	return validPending(value) ? value : null;
}

function clearPendingPayment(): void {
	wx.removeStorageSync(STORAGE_KEYS.pendingPayment);
}

/** 授权小程序的参数仍来自联调配置；凭证只用于跳转，不用于 API 请求。 */
export function assertMedicalConfig(): void {
	const missing: string[] = [];
	for (const [key, value] of [
		["medicalAppId", PAY_CONFIG.medicalAppId],
		["medicalCityCode", PAY_CONFIG.medicalCityCode],
		["medicalChannel", PAY_CONFIG.medicalChannel],
		["medicalOrgCode", PAY_CONFIG.medicalOrgCode],
		["medicalOrgAppId", PAY_CONFIG.medicalOrgAppId],
		["medicalOrgChannelCredential", PAY_CONFIG.medicalOrgChannelCredential],
	] as const) {
		if (!value) missing.push(key);
	}
	if (missing.length > 0)
		throw new Error(`医保机构联调配置不完整：${missing.join("、")}`);
}

export async function navigateToMedicalAuth(): Promise<void> {
	assertMedicalConfig();
	const path =
		`auth/pages/bindcard/auth/index?openType=getAuthCode` +
		`&cityCode=${encodeURIComponent(PAY_CONFIG.medicalCityCode)}` +
		`&channel=${encodeURIComponent(PAY_CONFIG.medicalChannel)}` +
		`&sourceapp=${encodeURIComponent(PAY_CONFIG.medicalSourceApp)}` +
		`&orgChnlCrtfCodg=${encodeURIComponent(PAY_CONFIG.medicalOrgChannelCredential)}` +
		`&orgCodg=${encodeURIComponent(PAY_CONFIG.medicalOrgCode)}` +
		`&bizType=${encodeURIComponent(PAY_CONFIG.medicalBizType)}` +
		`&orgAppId=${encodeURIComponent(PAY_CONFIG.medicalOrgAppId)}`;
	await new Promise<void>((resolve, reject) => {
		wx.navigateToMiniProgram({
			appId: PAY_CONFIG.medicalAppId,
			path,
			envVersion: PAY_CONFIG.medicalEnvVersion,
			success: () => resolve(),
			fail: reject,
		});
	});
}

/** 预约成功后才建立医保支付上下文，然后跳转到医保授权小程序。 */
export async function startMedicalPayment(
	appointment: CreatedAppointment,
	onProgress: Progress,
): Promise<PendingPayment> {
	const pending: PendingPayment = {
		appointmentId: appointment.appointmentId,
		patientId: appointment.patientId,
		authorizeIdempotencyKey: newIdempotencyKey("medical-authorize"),
		feesIdempotencyKey: newIdempotencyKey("medical-fees"),
		settleIdempotencyKey: newIdempotencyKey("medical-settle"),
	};
	savePending(pending);
	onProgress("authorizing", "请在医保小程序完成授权");
	await navigateToMedicalAuth();
	return pending;
}

type MedicalOrder = {
	orderId: string;
	status: string;
	amounts?: { totalFen: number; insuranceFen: number; cashFen: number };
};

async function orderCommand(
	path: string,
	idempotencyKey: string,
): Promise<MedicalOrder> {
	return request<MedicalOrder>({ path, method: "POST", idempotencyKey });
}

/**
 * 授权回跳后的完整新接口链路：授权、费用上传、结算。
 * 结算未形成终态时只查单，不重新挂号，也不重新授权。
 */
export async function continueMedicalPayment(
	authCode: string,
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	if (!authCode.trim()) throw new Error("医保授权结果为空");
	const authorize = await request<{ orderId: string; status: "authorized" }>({
		path: "/payments/medical-insurance/authorize",
		method: "POST",
		idempotencyKey: pending.authorizeIdempotencyKey,
		data: { appointmentId: pending.appointmentId, authCode },
	});
	const orderId = authorize.orderId;
	pending.orderId = orderId;
	savePending(pending);
	onProgress("insuring", "医保授权成功，正在上传挂号费用");
	await orderCommand(
		`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/fees`,
		pending.feesIdempotencyKey,
	);
	onProgress("settling", "正在进行医保结算");
	let order = await orderCommand(
		`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/settle`,
		pending.settleIdempotencyKey,
	);
	for (
		let index = 0;
		index < PAY_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		if (order.status === "insurance_settled") break;
		if (order.status === "cash_pending")
			throw new Error("医保结算完成，但存在待支付的自费金额");
		if (order.status === "failed" || order.status === "manual_review")
			throw new Error("医保结算未成功，请查看后台订单日志");
		await new Promise((resolve) =>
			setTimeout(resolve, PAY_CONFIG.insurancePollDelaysMs[index] || 1500),
		);
		onProgress("polling", `正在确认医保结算结果（${index + 1}）`);
		order = await request<MedicalOrder>({
			path: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}`,
			idempotencyKey: newIdempotencyKey("medical-query"),
		});
	}
	if (order.status !== "insurance_settled")
		throw new Error("医保结算仍在处理中，请稍后点击继续医保支付");
	clearPendingPayment();
	wx.setStorageSync(STORAGE_KEYS.lastResult, {
		appointmentId: pending.appointmentId,
		orderId,
		completedAt: Date.now(),
	});
	onProgress("success", "挂号和医保支付成功");
}
