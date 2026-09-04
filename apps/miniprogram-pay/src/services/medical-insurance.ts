import { PAY_CONFIG, STORAGE_KEYS } from "../config";
import type { CreatedAppointment } from "./appointment";
import { newIdempotencyKey, request } from "./request";

export type PaymentProgress =
	| "authorizing"
	| "insuring"
	| "settling"
	| "polling"
	| "cash-paying"
	| "cash-confirming"
	| "self-paying"
	| "self-confirming"
	| "success";

export type PaymentMode = "medical" | "mixed" | "self";

/** 回跳前只保存新版平台的 opaque 引用，不保存患者实名、医院号或医保凭证。 */
export type PendingPayment = {
	appointmentId: string;
	patientId: string;
	orderId?: string;
	authorizeIdempotencyKey: string;
	feesIdempotencyKey: string;
	settleIdempotencyKey: string;
	mode?: PaymentMode;
	phase?:
		| "authorization"
		| "cash_payment"
		| "medical_cash_required"
		| "self_payment";
	wechatPayIdempotencyKey?: string;
	wechatQueryIdempotencyKey?: string;
	selfPayIdempotencyKey?: string;
	selfQueryIdempotencyKey?: string;
};

type Progress = (stage: PaymentProgress, message: string) => void;

type CashPaymentPending = PendingPayment & {
	orderId: string;
	phase: "cash_payment";
	wechatPayIdempotencyKey: string;
	wechatQueryIdempotencyKey: string;
};

type SelfPaymentPending = PendingPayment & {
	orderId: string;
	phase: "self_payment";
	selfPayIdempotencyKey: string;
	selfQueryIdempotencyKey: string;
};

/** 微信跳转被用户主动取消属于正常业务分支，不应被页面显示为系统异常。 */
export class MedicalAuthNavigationCancelledError extends Error {
	constructor() {
		super("用户取消了医保授权跳转");
		this.name = "MedicalAuthNavigationCancelledError";
	}
}

/** 微信收银台被用户主动取消也是正常业务分支，预约和医保订单都要保留。 */
export class WechatPaymentCancelledError extends Error {
	constructor() {
		super("用户取消了微信支付");
		this.name = "WechatPaymentCancelledError";
	}
}

/** 纯医保订单出现现金应付时，不应隐式切换成混合支付。 */
export class MedicalCashRequiredError extends Error {
	constructor() {
		super("当前医保结算包含自费金额，请选择医保混合支付");
		this.name = "MedicalCashRequiredError";
	}
}

function isNavigationCancelled(value: unknown): boolean {
	const message =
		value instanceof Error
			? value.message
			: typeof value === "object" && value !== null
				? String((value as { errMsg?: unknown }).errMsg ?? "")
				: String(value ?? "");
	return /取消|\bcancel(?:led|ed)?\b/i.test(message);
}

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
		(item.orderId === undefined || isOpaque(item.orderId)) &&
		(item.phase === undefined ||
			item.phase === "authorization" ||
			item.phase === "cash_payment" ||
			item.phase === "medical_cash_required" ||
			item.phase === "self_payment") &&
		(item.mode === undefined ||
			item.mode === "medical" ||
			item.mode === "mixed" ||
			item.mode === "self") &&
		(item.wechatPayIdempotencyKey === undefined ||
			isOpaque(item.wechatPayIdempotencyKey)) &&
		(item.wechatQueryIdempotencyKey === undefined ||
			isOpaque(item.wechatQueryIdempotencyKey)) &&
		(item.selfPayIdempotencyKey === undefined ||
			isOpaque(item.selfPayIdempotencyKey)) &&
		(item.selfQueryIdempotencyKey === undefined ||
			isOpaque(item.selfQueryIdempotencyKey))
	);
}

function savePending(value: PendingPayment): void {
	wx.setStorageSync(STORAGE_KEYS.pendingPayment, value);
}

export function readPendingPayment(): PendingPayment | null {
	const value = wx.getStorageSync(STORAGE_KEYS.pendingPayment);
	return validPending(value) ? value : null;
}

/** 预约已存在时只允许切换后续支付分支，不重新创建预约或医保订单。 */
export function setPendingPaymentMode(
	pending: PendingPayment,
	mode: PaymentMode,
): PendingPayment {
	const next = { ...pending, mode };
	savePending(next);
	return next;
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
		// 机构渠道认证编码沿用旧服务的原样传法；该编码包含 `/`，医保授权页
		// 对这个字段不会按普通 URL 参数再次解码，编码成 `%2F` 会被判定为错误编码。
		`&orgChnlCrtfCodg=${PAY_CONFIG.medicalOrgChannelCredential}` +
		`&orgCodg=${encodeURIComponent(PAY_CONFIG.medicalOrgCode)}` +
		`&bizType=${encodeURIComponent(PAY_CONFIG.medicalBizType)}` +
		`&orgAppId=${encodeURIComponent(PAY_CONFIG.medicalOrgAppId)}`;
	await new Promise<void>((resolve, reject) => {
		wx.navigateToMiniProgram({
			appId: PAY_CONFIG.medicalAppId,
			path,
			envVersion: PAY_CONFIG.medicalEnvVersion,
			success: () => resolve(),
			fail: (error) =>
				reject(
					isNavigationCancelled(error)
						? new MedicalAuthNavigationCancelledError()
						: error,
				),
		});
	});
}

/** 预约成功后才建立医保支付上下文，然后跳转到医保授权小程序。 */
export async function startMedicalPayment(
	appointment: CreatedAppointment,
	onProgress: Progress,
	mode: Exclude<PaymentMode, "self"> = "mixed",
): Promise<PendingPayment> {
	const pending: PendingPayment = {
		appointmentId: appointment.appointmentId,
		patientId: appointment.patientId,
		authorizeIdempotencyKey: newIdempotencyKey("medical-authorize"),
		feesIdempotencyKey: newIdempotencyKey("medical-fees"),
		settleIdempotencyKey: newIdempotencyKey("medical-settle"),
		mode,
		phase: "authorization",
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

type WechatMedicalInsurancePayParams = {
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
	mixTradeNo: string;
};

type MedicalWechatPayment = {
	orderId: string;
	status: string;
	paymentState:
		| "not_started"
		| "prepay_ready"
		| "cash_paid"
		| "failed"
		| "unknown";
	cashFen: number;
	mixTradeNo?: string;
	payParams?: WechatMedicalInsurancePayParams;
};

type SelfPayParams = {
	appId: string;
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
};

type RegistrationSelfPayment = {
	appointmentId: string;
	orderId: string;
	status: "prepay_ready" | "awaiting_confirmation" | "cash_paid" | "failed";
	paymentState: string;
	totalFen: number;
	payParams?: SelfPayParams;
};

async function orderCommand(
	path: string,
	idempotencyKey: string,
): Promise<MedicalOrder> {
	return request<MedicalOrder>({ path, method: "POST", idempotencyKey });
}

function requestWechatPayment(
	params: WechatMedicalInsurancePayParams,
): Promise<void> {
	type RequestMedicalInsurancePayOption = WechatMedicalInsurancePayParams & {
		success?: (result: unknown) => void;
		fail?: (error: { errMsg?: string }) => void;
	};
	const medicalWechat = wx as typeof wx & {
		requestMedicalInsurancePay?: (
			option: RequestMedicalInsurancePayOption,
		) => void;
	};
	if (typeof medicalWechat.requestMedicalInsurancePay !== "function") {
		return Promise.reject(
			new Error("当前微信版本不支持医保混合支付，请升级微信后重试"),
		);
	}
	return new Promise((resolve, reject) => {
		medicalWechat.requestMedicalInsurancePay?.({
			...params,
			success: () => resolve(),
			fail: (error) => {
				const message = String(error?.errMsg || "");
				reject(
					/取消|cancel/i.test(message)
						? new WechatPaymentCancelledError()
						: error,
				);
			},
		});
	});
}

function requestWechatSelfPayment(params: {
	appId: string;
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
}): Promise<void> {
	return new Promise((resolve, reject) => {
		wx.requestPayment({
			...params,
			success: () => resolve(),
			fail: (error) => {
				const message = String(error?.errMsg || "");
				reject(
					/取消|cancel/i.test(message)
						? new WechatPaymentCancelledError()
						: error,
				);
			},
		});
	});
}

function saveCashPaymentPhase(pending: PendingPayment): CashPaymentPending {
	const orderId = pending.orderId?.trim();
	if (!orderId) throw new Error("医保订单引用为空，无法继续微信支付");
	const next: CashPaymentPending = {
		...pending,
		orderId,
		phase: "cash_payment" as const,
		wechatPayIdempotencyKey:
			pending.wechatPayIdempotencyKey ??
			newIdempotencyKey("medical-wechat-pay"),
		wechatQueryIdempotencyKey:
			pending.wechatQueryIdempotencyKey ??
			newIdempotencyKey("medical-wechat-query"),
	};
	savePending(next);
	return next;
}

function finishMedicalPayment(
	pending: PendingPayment,
	orderId: string,
	onProgress: Progress,
	message = "挂号和医保支付成功",
): void {
	clearPendingPayment();
	wx.setStorageSync(STORAGE_KEYS.lastResult, {
		appointmentId: pending.appointmentId,
		orderId,
		completedAt: Date.now(),
	});
	onProgress("success", message);
}

/** 微信调起成功后仍需服务端查混合订单，再回到医保后置完成结算。 */
export async function continueMedicalCashPayment(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	const orderId = pending.orderId?.trim();
	if (!orderId) throw new Error("医保订单引用为空，无法继续微信支付");
	const current = saveCashPaymentPhase(pending);
	const payment = await request<MedicalWechatPayment>({
		path: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/wechat-pay`,
		method: "POST",
		idempotencyKey: current.wechatPayIdempotencyKey,
	});
	let paymentWasCancelled = false;
	if (payment.payParams) {
		onProgress("cash-paying", "正在打开微信支付收银台");
		try {
			await requestWechatPayment(payment.payParams);
		} catch (error) {
			if (!(error instanceof WechatPaymentCancelledError)) throw error;
			paymentWasCancelled = true;
		}
	}
	if (payment.paymentState === "failed") throw new Error("微信医保支付已失败");
	for (
		let index = 0;
		index < PAY_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		onProgress("cash-confirming", "正在确认微信医保混合支付结果");
		const result = await request<MedicalWechatPayment>({
			path: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/wechat-pay`,
			idempotencyKey: current.wechatQueryIdempotencyKey,
		});
		if (
			result.status === "insurance_settled" &&
			result.paymentState === "cash_paid"
		) {
			finishMedicalPayment(current, orderId, onProgress);
			return;
		}
		if (result.status === "failed" || result.status === "manual_review") {
			throw new Error("医保后置结算未成功，请查看后台订单日志");
		}
		if (result.paymentState === "failed")
			throw new Error("微信医保支付已失败，请不要重复预约");
		if (paymentWasCancelled) throw new WechatPaymentCancelledError();
		await new Promise((resolve) =>
			setTimeout(resolve, PAY_CONFIG.insurancePollDelaysMs[index] || 1500),
		);
	}
	throw new Error(
		"微信医保支付已提交，医保后置结算仍在确认，请稍后点击继续医保支付",
	);
}

function selfPaymentPending(
	appointment: CreatedAppointment,
): SelfPaymentPending {
	const pending: SelfPaymentPending = {
		appointmentId: appointment.appointmentId,
		patientId: appointment.patientId,
		authorizeIdempotencyKey: newIdempotencyKey("self-pay-authorize"),
		feesIdempotencyKey: newIdempotencyKey("self-pay-fees"),
		settleIdempotencyKey: newIdempotencyKey("self-pay-settle"),
		mode: "self",
		phase: "self_payment",
		orderId: "pending",
		selfPayIdempotencyKey: newIdempotencyKey("registration-self-pay"),
		selfQueryIdempotencyKey: newIdempotencyKey("registration-self-query"),
	};
	return pending;
}

/** 纯自费挂号不进入医保授权，只创建普通微信支付单并按微信查单确认。 */
export async function startSelfPayment(
	appointment: CreatedAppointment,
	onProgress: Progress,
): Promise<PendingPayment> {
	const pending = selfPaymentPending(appointment);
	savePending(pending);
	const result = await continueSelfPayment(pending, onProgress, true);
	return result;
}

async function continueSelfPayment(
	pending: SelfPaymentPending,
	onProgress: Progress,
	initial = false,
): Promise<PendingPayment> {
	if (!pending.selfPayIdempotencyKey || !pending.selfQueryIdempotencyKey)
		throw new Error("自费支付上下文不完整，无法继续支付");
	const payment = await request<RegistrationSelfPayment>({
		path: `/payments/appointments/${encodeURIComponent(pending.appointmentId)}/self-pay`,
		method: "POST",
		idempotencyKey: pending.selfPayIdempotencyKey,
	});
	const current: SelfPaymentPending = {
		...pending,
		orderId: payment.orderId,
		phase: "self_payment",
	};
	savePending(current);
	if (payment.status === "cash_paid") {
		finishMedicalPayment(
			current,
			payment.orderId,
			onProgress,
			"挂号和自费支付成功",
		);
		return current;
	}
	let paymentWasCancelled = false;
	if (payment.payParams) {
		onProgress("self-paying", "正在打开微信自费支付收银台");
		try {
			await requestWechatSelfPayment(payment.payParams);
		} catch (error) {
			if (!(error instanceof WechatPaymentCancelledError)) throw error;
			paymentWasCancelled = true;
		}
	}
	for (
		let index = 0;
		index < PAY_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		onProgress("self-confirming", "正在确认微信自费支付结果");
		const result = await request<RegistrationSelfPayment>({
			path: `/payments/appointments/${encodeURIComponent(current.appointmentId)}/self-pay`,
			idempotencyKey: current.selfQueryIdempotencyKey,
		});
		if (result.status === "cash_paid") {
			finishMedicalPayment(
				current,
				result.orderId,
				onProgress,
				"挂号和自费支付成功",
			);
			return current;
		}
		if (result.status === "failed")
			throw new Error("微信自费支付已失败，请不要重复预约");
		if (paymentWasCancelled) throw new WechatPaymentCancelledError();
		await new Promise((resolve) =>
			setTimeout(resolve, PAY_CONFIG.insurancePollDelaysMs[index] || 1500),
		);
	}
	if (initial) {
		throw new Error("微信自费支付已提交，请稍后点击继续自费支付");
	}
	throw new Error("微信自费支付仍在确认，请稍后点击继续自费支付");
}

export async function continueSelfPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	if (
		pending.phase !== "self_payment" ||
		!pending.orderId ||
		!pending.selfPayIdempotencyKey ||
		!pending.selfQueryIdempotencyKey
	)
		throw new Error("自费支付上下文不完整，无法继续支付");
	await continueSelfPayment(
		{
			...pending,
			orderId: pending.orderId,
			phase: "self_payment",
			selfPayIdempotencyKey: pending.selfPayIdempotencyKey,
			selfQueryIdempotencyKey: pending.selfQueryIdempotencyKey,
		},
		onProgress,
	);
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
		if (order.status === "cash_pending") {
			pending.orderId = orderId;
			if (pending.mode === "medical") {
				pending.phase = "medical_cash_required";
				savePending(pending);
				throw new MedicalCashRequiredError();
			}
			return continueMedicalCashPayment(pending, onProgress);
		}
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
	finishMedicalPayment(pending, orderId, onProgress);
}
