import { MEDICAL_INSURANCE_CONFIG, MINIPROGRAM_STORAGE_KEYS } from "../config";
import type {
	AppointmentRegistrationResponse,
	RegistrationSelfPayResponse,
} from "../types";
import {
	ApiError,
	createIdempotencyKey,
	queryAppointmentSelfPay,
	requestAppointmentPaymentExit,
	requestAppointmentSelfPay,
	requestWithSession,
	requireSuccessDataResponse,
	toWechatPaymentLaunch,
} from "./api-client";

export type PaymentMode = "medical" | "mixed" | "self";

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

export type PendingPayment = {
	appointmentId: string;
	patientId: string;
	createdAt: number;
	orderId?: string;
	authorizeIdempotencyKey: string;
	feesIdempotencyKey: string;
	settleIdempotencyKey: string;
	mode?: PaymentMode;
	phase?:
		| "authorization"
		| "cash_payment"
		| "medical_cashier"
		| "medical_cash_required"
		| "self_payment";
	wechatPayIdempotencyKey?: string;
	wechatQueryIdempotencyKey?: string;
	selfPayIdempotencyKey?: string;
	selfQueryIdempotencyKey?: string;
	cashierUrl?: string;
	cashierConfirmIdempotencyKey?: string;
};

type Progress = (stage: PaymentProgress, message: string) => void;
type CashPaymentPending = PendingPayment & {
	orderId: string;
	phase: "cash_payment";
	wechatPayIdempotencyKey: string;
	wechatQueryIdempotencyKey: string;
};
type AppointmentPaymentContext = Pick<
	AppointmentRegistrationResponse["data"],
	"appointmentId" | "patientId"
>;

type MedicalOrderStatus =
	| "created"
	| "fee_uploaded"
	| "order_placed"
	| "insurance_settled"
	| "cash_pending"
	| "awaiting_confirmation"
	| "manual_review"
	| "failed"
	| "cancelled";

type MedicalOrder = {
	orderId: string;
	status: MedicalOrderStatus;
	amounts?: { totalFen: number; insuranceFen: number; cashFen: number };
	cashierUrl?: string;
};

type MedicalCancellation = {
	orderId: string;
	status: "cancelled" | "awaiting_confirmation" | "manual_review";
	restartAllowed: boolean;
};

type MedicalWechatPayParams = {
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
	mixTradeNo: string;
};

type MedicalWechatPayment = {
	orderId: string;
	status:
		| "cash_pending"
		| "insurance_settled"
		| "awaiting_confirmation"
		| "manual_review"
		| "failed";
	paymentState:
		| "not_started"
		| "prepay_ready"
		| "cash_paid"
		| "his_written_back"
		| "completed"
		| "failed"
		| "unknown";
	cashFen: number;
	medInsFailReason?: string;
	payParams?: MedicalWechatPayParams;
};

/** 仅服务端确认医保部分失败且返回医保局原因时展示，不与自费失败混用。 */
export class MedicalInsurancePaymentFailureError extends Error {
	readonly userMessage: string;

	constructor(reason: string) {
		const userMessage = `医保扣款失败：${reason}\n系统已停止继续结算。退款状态需由医院核实，请勿重复付款，并联系医院确认后续处理。`;
		super(userMessage);
		this.name = "MedicalInsurancePaymentFailureError";
		this.userMessage = userMessage;
	}
}

export class MedicalAuthNavigationCancelledError extends Error {
	constructor() {
		super("用户取消了医保授权跳转");
		this.name = "MedicalAuthNavigationCancelledError";
	}
}

export class WechatPaymentCancelledError extends Error {
	constructor() {
		super("用户取消了微信支付");
		this.name = "WechatPaymentCancelledError";
	}
}

export class MedicalCashRequiredError extends Error {
	constructor() {
		super("当前医保结算包含自费金额，请选择医保混合支付");
		this.name = "MedicalCashRequiredError";
	}
}

/** 微信收银台没有回调时必须自动结束等待；订单仍保留，后续通过查单确认。 */
const WECHAT_PAYMENT_RESPONSE_TIMEOUT_MS = 60_000;

function wechatPaymentResponseTimeout(): ApiError {
	return new ApiError(
		"微信支付收银台响应超时，支付结果可能仍在确认，请稍后继续确认",
		{ code: "payment-prepay-unknown" },
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaque(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/u.test(value);
}

function isHttpsUrl(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 2048 &&
		/^https:\/\//iu.test(value)
	);
}

function isNavigationCancelled(value: unknown): boolean {
	const message =
		value instanceof Error
			? value.message
			: isRecord(value)
				? String(value.errMsg ?? "")
				: String(value ?? "");
	return /取消|\bcancel(?:led|ed)?\b/iu.test(message);
}

function isMedicalOrderStatus(value: unknown): value is MedicalOrderStatus {
	return (
		value === "created" ||
		value === "fee_uploaded" ||
		value === "order_placed" ||
		value === "insurance_settled" ||
		value === "cash_pending" ||
		value === "awaiting_confirmation" ||
		value === "manual_review" ||
		value === "failed" ||
		value === "cancelled"
	);
}

function readMedicalOrder(value: unknown): MedicalOrder {
	const payload = requireSuccessDataResponse<unknown>(value);
	const data = payload.data;
	if (
		!isRecord(data) ||
		!isOpaque(data.orderId) ||
		!isMedicalOrderStatus(data.status)
	) {
		throw new ApiError("医保订单响应不可用", {
			code: "provider-response-invalid",
		});
	}
	let amounts: MedicalOrder["amounts"];
	if (data.amounts !== undefined) {
		if (!isRecord(data.amounts)) {
			throw new ApiError("医保金额响应不可用", {
				code: "provider-response-invalid",
			});
		}
		const { totalFen, insuranceFen, cashFen } = data.amounts;
		if (
			typeof totalFen !== "number" ||
			typeof insuranceFen !== "number" ||
			typeof cashFen !== "number" ||
			!Number.isSafeInteger(totalFen) ||
			!Number.isSafeInteger(insuranceFen) ||
			!Number.isSafeInteger(cashFen) ||
			totalFen <= 0 ||
			insuranceFen < 0 ||
			cashFen < 0
		) {
			throw new ApiError("医保金额响应不可用", {
				code: "provider-response-invalid",
			});
		}
		amounts = { totalFen, insuranceFen, cashFen };
	}
	if (data.cashierUrl !== undefined && !isHttpsUrl(data.cashierUrl)) {
		throw new ApiError("医保收银台地址不可用", {
			code: "provider-response-invalid",
		});
	}
	return {
		orderId: data.orderId,
		status: data.status,
		...(amounts ? { amounts } : {}),
		...(data.cashierUrl ? { cashierUrl: data.cashierUrl } : {}),
	};
}

function readMedicalCancellation(value: unknown): MedicalCancellation {
	const payload = requireSuccessDataResponse<unknown>(value);
	const data = payload.data;
	if (
		!isRecord(data) ||
		!isOpaque(data.orderId) ||
		(data.status !== "cancelled" &&
			data.status !== "awaiting_confirmation" &&
			data.status !== "manual_review") ||
		typeof data.restartAllowed !== "boolean"
	) {
		throw new ApiError("医保关单响应不可用", {
			code: "provider-response-invalid",
		});
	}
	return {
		orderId: data.orderId,
		status: data.status,
		restartAllowed: data.restartAllowed,
	};
}

function readMedicalWechatPayment(value: unknown): MedicalWechatPayment {
	const payload = requireSuccessDataResponse<unknown>(value);
	const data = payload.data;
	if (!isRecord(data) || !isOpaque(data.orderId)) {
		throw new ApiError("医保微信支付响应不可用", {
			code: "provider-response-invalid",
		});
	}
	if (
		data.medInsFailReason !== undefined &&
		(typeof data.medInsFailReason !== "string" ||
			data.medInsFailReason.length < 1 ||
			data.medInsFailReason.length > 2048)
	) {
		throw new ApiError("医保支付失败原因响应不可用", {
			code: "provider-response-invalid",
		});
	}
	const validStatus = new Set([
		"cash_pending",
		"insurance_settled",
		"awaiting_confirmation",
		"manual_review",
		"failed",
	]);
	const validPaymentState = new Set([
		"not_started",
		"prepay_ready",
		"cash_paid",
		"his_written_back",
		"completed",
		"failed",
		"unknown",
	]);
	if (
		typeof data.status !== "string" ||
		!validStatus.has(data.status) ||
		typeof data.paymentState !== "string" ||
		!validPaymentState.has(data.paymentState) ||
		typeof data.cashFen !== "number" ||
		!Number.isSafeInteger(data.cashFen) ||
		(data.cashFen as number) < 0
	) {
		throw new ApiError("医保微信支付响应不可用", {
			code: "provider-response-invalid",
		});
	}
	let payParams: MedicalWechatPayParams | undefined;
	if (data.payParams !== undefined) {
		if (!isRecord(data.payParams)) {
			throw new ApiError("医保微信支付参数不可用", {
				code: "wechat-pay-params-missing",
			});
		}
		const params = data.payParams;
		if (
			typeof params.timeStamp !== "string" ||
			typeof params.nonceStr !== "string" ||
			typeof params.package !== "string" ||
			params.signType !== "RSA" ||
			typeof params.paySign !== "string" ||
			typeof params.mixTradeNo !== "string" ||
			!params.timeStamp ||
			!params.nonceStr ||
			!params.package ||
			!params.paySign ||
			!params.mixTradeNo
		) {
			throw new ApiError("医保微信支付参数不可用", {
				code: "wechat-pay-params-missing",
			});
		}
		payParams = {
			timeStamp: params.timeStamp,
			nonceStr: params.nonceStr,
			package: params.package,
			signType: "RSA",
			paySign: params.paySign,
			mixTradeNo: params.mixTradeNo,
		};
	}
	return {
		orderId: data.orderId,
		status: data.status as MedicalWechatPayment["status"],
		paymentState: data.paymentState as MedicalWechatPayment["paymentState"],
		cashFen: data.cashFen,
		...(data.medInsFailReason
			? { medInsFailReason: data.medInsFailReason }
			: {}),
		...(payParams ? { payParams } : {}),
	};
}

function readPending(value: unknown): value is PendingPayment {
	if (!isRecord(value)) return false;
	return (
		isOpaque(value.appointmentId) &&
		isOpaque(value.patientId) &&
		typeof value.createdAt === "number" &&
		Number.isSafeInteger(value.createdAt) &&
		isOpaque(value.authorizeIdempotencyKey) &&
		isOpaque(value.feesIdempotencyKey) &&
		isOpaque(value.settleIdempotencyKey) &&
		(value.orderId === undefined || isOpaque(value.orderId)) &&
		(value.mode === undefined ||
			value.mode === "medical" ||
			value.mode === "mixed" ||
			value.mode === "self") &&
		(value.phase === undefined ||
			value.phase === "authorization" ||
			value.phase === "cash_payment" ||
			value.phase === "medical_cashier" ||
			value.phase === "medical_cash_required" ||
			value.phase === "self_payment") &&
		(value.wechatPayIdempotencyKey === undefined ||
			isOpaque(value.wechatPayIdempotencyKey)) &&
		(value.wechatQueryIdempotencyKey === undefined ||
			isOpaque(value.wechatQueryIdempotencyKey)) &&
		(value.selfPayIdempotencyKey === undefined ||
			isOpaque(value.selfPayIdempotencyKey)) &&
		(value.selfQueryIdempotencyKey === undefined ||
			isOpaque(value.selfQueryIdempotencyKey)) &&
		(value.cashierUrl === undefined || isHttpsUrl(value.cashierUrl)) &&
		(value.cashierConfirmIdempotencyKey === undefined ||
			isOpaque(value.cashierConfirmIdempotencyKey))
	);
}

function savePendingPayment(value: PendingPayment): void {
	wx.setStorageSync(MINIPROGRAM_STORAGE_KEYS.pendingMedicalPayment, value);
}

export function readPendingPayment(): PendingPayment | null {
	const value = wx.getStorageSync(
		MINIPROGRAM_STORAGE_KEYS.pendingMedicalPayment,
	);
	if (!readPending(value)) return null;
	const age = Date.now() - value.createdAt;
	const maxAge =
		value.orderId || (value.phase && value.phase !== "authorization")
			? MEDICAL_INSURANCE_CONFIG.pendingPaymentRecoveryMaxAgeMs
			: MEDICAL_INSURANCE_CONFIG.pendingPaymentMaxAgeMs;
	if (age < 0 || age > maxAge) {
		clearPendingPayment();
		return null;
	}
	return value;
}

export function clearPendingPayment(): void {
	wx.removeStorageSync(MINIPROGRAM_STORAGE_KEYS.pendingMedicalPayment);
}

export function setPendingPaymentMode(
	pending: PendingPayment,
	mode: PaymentMode,
): PendingPayment {
	const next = { ...pending, mode };
	savePendingPayment(next);
	return next;
}

export function assertMedicalConfig(): void {
	const missing: string[] = [];
	for (const [key, value] of [
		["medicalAppId", MEDICAL_INSURANCE_CONFIG.medicalAppId],
		["medicalCityCode", MEDICAL_INSURANCE_CONFIG.medicalCityCode],
		["medicalChannel", MEDICAL_INSURANCE_CONFIG.medicalChannel],
		["medicalOrgCode", MEDICAL_INSURANCE_CONFIG.medicalOrgCode],
		["medicalOrgAppId", MEDICAL_INSURANCE_CONFIG.medicalOrgAppId],
		[
			"medicalOrgChannelCredential",
			MEDICAL_INSURANCE_CONFIG.medicalOrgChannelCredential,
		],
	] as const) {
		if (!value || value.includes("__MINIPROGRAM_")) missing.push(key);
	}
	if (missing.length > 0) {
		throw new ApiError("医保机构联调配置不完整", {
			code: "dependency-not-configured",
		});
	}
}

export async function navigateToMedicalAuth(): Promise<void> {
	assertMedicalConfig();
	const path =
		`auth/pages/bindcard/auth/index?openType=getAuthCode` +
		`&cityCode=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalCityCode)}` +
		`&channel=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalChannel)}` +
		`&sourceapp=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalSourceApp)}` +
		// 机构渠道凭证按医保授权页约定原样传递，不在这里二次编码。
		`&orgChnlCrtfCodg=${MEDICAL_INSURANCE_CONFIG.medicalOrgChannelCredential}` +
		`&orgCodg=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgCode)}` +
		`&bizType=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalBizType)}` +
		`&orgAppId=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgAppId)}`;
	await new Promise<void>((resolve, reject) => {
		wx.navigateToMiniProgram({
			appId: MEDICAL_INSURANCE_CONFIG.medicalAppId,
			path,
			envVersion: MEDICAL_INSURANCE_CONFIG.medicalEnvVersion,
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

export async function startMedicalPayment(
	appointment: AppointmentPaymentContext,
	onProgress: Progress,
	mode: Exclude<PaymentMode, "self"> = "mixed",
): Promise<PendingPayment> {
	const pending: PendingPayment = {
		appointmentId: appointment.appointmentId,
		patientId: appointment.patientId,
		createdAt: Date.now(),
		authorizeIdempotencyKey: createIdempotencyKey("medical-authorize"),
		feesIdempotencyKey: createIdempotencyKey("medical-fees"),
		settleIdempotencyKey: createIdempotencyKey("medical-settle"),
		mode,
		phase: "authorization",
	};
	savePendingPayment(pending);
	onProgress("authorizing", "请在医保小程序完成授权，返回后请等待页面继续处理");
	await navigateToMedicalAuth();
	return pending;
}

function requestWechatMedicalInsurancePayment(
	params: MedicalWechatPayParams,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const payment = (
			wx as unknown as {
				requestMedicalInsurancePay?: (options: {
					timeStamp: string;
					nonceStr: string;
					package: string;
					signType: "RSA";
					paySign: string;
					mixTradeNo: string;
					success?: () => void;
					fail?: (error: { errMsg?: string }) => void;
				}) => void;
			}
		).requestMedicalInsurancePay;
		if (typeof payment !== "function") {
			reject(
				new ApiError("当前微信基础库不支持医保自费支付", {
					code: "wechat-payment-launch-failed",
				}),
			);
			return;
		}
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			reject(wechatPaymentResponseTimeout());
		}, WECHAT_PAYMENT_RESPONSE_TIMEOUT_MS);
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			callback();
		};
		try {
			payment({
				...params,
				success: () => finish(resolve),
				fail: (error) =>
					finish(() => {
						if (/取消|cancel/iu.test(String(error?.errMsg ?? ""))) {
							reject(new WechatPaymentCancelledError());
							return;
						}
						reject(
							new ApiError("医保微信支付调起失败", {
								code: "wechat-payment-launch-failed",
							}),
						);
					}),
			});
		} catch {
			finish(() =>
				reject(
					new ApiError("医保微信支付调起失败", {
						code: "wechat-payment-launch-failed",
					}),
				),
			);
		}
	});
}

function requestWechatSelfPayment(
	params: NonNullable<RegistrationSelfPayResponse["data"]["payParams"]>,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			settled = true;
			reject(wechatPaymentResponseTimeout());
		}, WECHAT_PAYMENT_RESPONSE_TIMEOUT_MS);
		const finish = (callback: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			callback();
		};
		try {
			wx.requestPayment({
				...params,
				success: () => finish(resolve),
				fail: (error) =>
					finish(() => {
						if (/取消|cancel/iu.test(String(error?.errMsg ?? ""))) {
							reject(new WechatPaymentCancelledError());
							return;
						}
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
}

async function orderCommand(
	path: string,
	idempotencyKey: string,
): Promise<MedicalOrder> {
	const response = await requestWithSession<unknown>({
		url: path,
		method: "POST",
		idempotencyKey,
	});
	return readMedicalOrder(response);
}

async function cancelPaymentInProgress(
	orderId: string,
): Promise<MedicalCancellation> {
	const response = await requestWithSession<unknown>({
		url: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/cancel`,
		method: "POST",
		data: { reason: "payment_in_progress" },
		idempotencyKey: createIdempotencyKey("medical-cancel-in-progress"),
	});
	return readMedicalCancellation(response);
}

function finishMedicalPayment(
	pending: PendingPayment,
	onProgress: Progress,
	orderId: string,
	message: string,
): void {
	clearPendingPayment();
	wx.setStorageSync(MINIPROGRAM_STORAGE_KEYS.lastMedicalPaymentResult, {
		appointmentId: pending.appointmentId,
		orderId,
		completedAt: Date.now(),
	});
	onProgress("success", message);
}

function saveCashPaymentPhase(pending: PendingPayment): PendingPayment & {
	orderId: string;
	phase: "cash_payment";
	wechatPayIdempotencyKey: string;
	wechatQueryIdempotencyKey: string;
} {
	const orderId = pending.orderId?.trim();
	if (!orderId)
		throw new ApiError("医保订单引用为空", {
			code: "medical-insurance-order-not-found",
		});
	const next = {
		...pending,
		orderId,
		phase: "cash_payment" as const,
		wechatPayIdempotencyKey:
			pending.wechatPayIdempotencyKey ??
			createIdempotencyKey("medical-wechat-pay"),
		wechatQueryIdempotencyKey:
			pending.wechatQueryIdempotencyKey ??
			createIdempotencyKey("medical-wechat-query"),
	};
	savePendingPayment(next);
	return next;
}

function navigateToMedicalCashier(): Promise<void> {
	return new Promise((resolve, reject) => {
		wx.navigateTo({
			url: "/pages/medical-cashier/medical-cashier",
			success: () => resolve(),
			fail: reject,
		});
	});
}

let medicalCashConfirmation:
	| { orderId: string; promise: Promise<boolean> }
	| undefined;

async function queryMedicalCashPayment(
	current: CashPaymentPending,
	onProgress: Progress,
	maxAttempts: number,
): Promise<boolean> {
	const attempts = Math.max(
		1,
		Math.min(
			maxAttempts,
			MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
		),
	);
	for (let index = 0; index < attempts; index += 1) {
		onProgress(
			"cash-confirming",
			"正在确认微信医保支付并回写医院，请勿重复付款",
		);
		const result = readMedicalWechatPayment(
			await requestWithSession<unknown>({
				url: `/payments/medical-insurance/orders/${encodeURIComponent(current.orderId)}/wechat-pay`,
				idempotencyKey: current.wechatQueryIdempotencyKey,
			}),
		);
		if (result.medInsFailReason) {
			throw new MedicalInsurancePaymentFailureError(result.medInsFailReason);
		}
		if (
			result.status === "insurance_settled" &&
			["cash_paid", "his_written_back", "completed"].includes(
				result.paymentState,
			)
		) {
			finishMedicalPayment(
				current,
				onProgress,
				current.orderId,
				"挂号和医保混合支付成功",
			);
			return true;
		}
		if (result.status === "failed" || result.status === "manual_review") {
			throw new ApiError("微信医保支付回写未成功", {
				code: "payment-notification-conflict",
			});
		}
		if (result.paymentState === "failed") {
			throw new ApiError("微信医保自费支付已失败", {
				code: "payment-order-conflict",
			});
		}
		if (index < attempts - 1) {
			await new Promise((resolve) =>
				setTimeout(
					resolve,
					MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs[index] ?? 1500,
				),
			);
		}
	}
	return false;
}

function confirmMedicalCashPayment(
	current: CashPaymentPending,
	onProgress: Progress,
	maxAttempts: number = MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
): Promise<boolean> {
	if (medicalCashConfirmation?.orderId === current.orderId) {
		return medicalCashConfirmation.promise;
	}
	const promise = queryMedicalCashPayment(
		current,
		onProgress,
		maxAttempts,
	).finally(() => {
		if (medicalCashConfirmation?.promise === promise) {
			medicalCashConfirmation = undefined;
		}
	});
	medicalCashConfirmation = { orderId: current.orderId, promise };
	return promise;
}

/** 回到正式小程序后只查已有混合订单，避免重复预下单或再次调起收银台。 */
export function resumeMedicalCashPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
	maxAttempts: number = MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
): Promise<boolean> {
	if (pending.phase !== "cash_payment") {
		throw new ApiError("医保混合支付上下文不完整，无法确认", {
			code: "payment-order-invalid",
		});
	}
	return confirmMedicalCashPayment(
		saveCashPaymentPhase(pending),
		onProgress,
		maxAttempts,
	);
}

export async function continueMedicalCashPayment(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	const current = saveCashPaymentPhase(pending);
	const paymentResponse = await requestWithSession<unknown>({
		url: `/payments/medical-insurance/orders/${encodeURIComponent(current.orderId)}/wechat-pay`,
		method: "POST",
		idempotencyKey: current.wechatPayIdempotencyKey,
	});
	const payment = readMedicalWechatPayment(paymentResponse);
	if (payment.medInsFailReason) {
		throw new MedicalInsurancePaymentFailureError(payment.medInsFailReason);
	}
	let paymentWasCancelled = false;
	if (payment.payParams) {
		onProgress("cash-paying", "正在打开微信医保自费收银台，请勿重复点击");
		try {
			await requestWechatMedicalInsurancePayment(payment.payParams);
		} catch (error) {
			if (!(error instanceof WechatPaymentCancelledError)) throw error;
			paymentWasCancelled = true;
		}
	}
	if (paymentWasCancelled) {
		const completed = await confirmMedicalCashPayment(current, onProgress, 1);
		if (completed) return;
		throw new WechatPaymentCancelledError();
	}
	if (payment.status === "failed" || payment.paymentState === "failed") {
		throw new ApiError("微信医保自费支付已失败", {
			code: "payment-order-conflict",
		});
	}
	if (await confirmMedicalCashPayment(current, onProgress)) return;
	throw new ApiError(
		"微信医保支付仍在确认，请稍后点击医保混合支付继续，勿重复付款",
		{ code: "payment-prepay-in-progress" },
	);
}

export async function continueMedicalPayment(
	authCode: string,
	pending: PendingPayment,
	onProgress: Progress,
	restartAttempted = false,
): Promise<{ kind: "cashier_opened" } | undefined> {
	if (!authCode.trim())
		throw new ApiError("医保授权结果为空", {
			code: "medical-insurance-invalid",
		});
	const authorizeResponse = await requestWithSession<unknown>({
		url: "/payments/medical-insurance/authorize",
		method: "POST",
		data: { appointmentId: pending.appointmentId, authCode },
		idempotencyKey: pending.authorizeIdempotencyKey,
	});
	const authorize = requireSuccessDataResponse<unknown>(authorizeResponse).data;
	if (
		!isRecord(authorize) ||
		!isOpaque(authorize.orderId) ||
		authorize.status !== "authorized"
	) {
		throw new ApiError("医保授权响应不可用", {
			code: "provider-response-invalid",
		});
	}
	const orderId = authorize.orderId;
	const current = { ...pending, orderId };
	savePendingPayment(current);
	onProgress("insuring", "医保授权成功，正在上传挂号费用，请勿重复提交");
	try {
		const fees = await orderCommand(
			`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/fees`,
			pending.feesIdempotencyKey,
		);
		if (fees.cashierUrl)
			savePendingPayment({ ...current, cashierUrl: fees.cashierUrl });
	} catch (error) {
		if (
			!restartAttempted &&
			error instanceof ApiError &&
			error.code === "medical-insurance-payment-in-progress"
		) {
			onProgress("settling", "检测到已有支付进行中，正在安全关闭旧支付订单");
			const cancellation = await cancelPaymentInProgress(orderId);
			if (cancellation.status !== "cancelled" || !cancellation.restartAllowed) {
				throw new ApiError("当前支付订单未能安全关闭", {
					code: "medical-insurance-cancellation-context-missing",
				});
			}
			const {
				orderId: _oldOrderId,
				cashierUrl: _oldCashierUrl,
				...replacementBase
			} = current;
			const replacement: PendingPayment = { ...replacementBase };
			replacement.authorizeIdempotencyKey = createIdempotencyKey(
				"medical-authorize-restart",
			);
			replacement.feesIdempotencyKey = createIdempotencyKey(
				"medical-fees-restart",
			);
			replacement.settleIdempotencyKey = createIdempotencyKey(
				"medical-settle-restart",
			);
			replacement.phase = "authorization";
			savePendingPayment(replacement);
			onProgress(
				"authorizing",
				"旧支付已关闭，请重新完成医保授权；请勿重复付款或重新预约",
			);
			await navigateToMedicalAuth();
			return;
		}
		throw error;
	}

	onProgress("settling", "正在进行医保结算，请勿重复授权或付款");
	let order = await orderCommand(
		`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/settle`,
		pending.settleIdempotencyKey,
	);
	for (
		let index = 0;
		index < MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		if (order.status === "insurance_settled") break;
		if (order.status === "cash_pending") {
			const latest = readPendingPayment() ?? current;
			if (latest.mode === "medical" && latest.cashierUrl) {
				const cashierPending = {
					...latest,
					phase: "medical_cashier" as const,
					cashierConfirmIdempotencyKey:
						latest.cashierConfirmIdempotencyKey ??
						createIdempotencyKey("medical-cashier-confirm"),
				};
				savePendingPayment(cashierPending);
				onProgress("cash-paying", "正在打开医保支付收银台，请勿重复点击");
				await navigateToMedicalCashier();
				return { kind: "cashier_opened" };
			}
			if (latest.mode === "medical") {
				const required = { ...latest, phase: "medical_cash_required" as const };
				savePendingPayment(required);
				throw new MedicalCashRequiredError();
			}
			await continueMedicalCashPayment(
				{ ...latest, orderId, mode: "mixed" },
				onProgress,
			);
			return;
		}
		if (order.status === "failed" || order.status === "manual_review") {
			throw new ApiError("医保结算未成功", {
				code: "payment-notification-conflict",
			});
		}
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs[index] ?? 1500,
			),
		);
		onProgress("polling", `正在确认医保结算结果（${index + 1}），请勿重复操作`);
		order = readMedicalOrder(
			await requestWithSession<unknown>({
				url: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}`,
				idempotencyKey: createIdempotencyKey("medical-query"),
			}),
		);
	}
	if (order.status !== "insurance_settled") {
		throw new ApiError(
			"医保结算仍在处理中，请稍后点击原支付方式继续，勿重复预约",
			{ code: "payment-prepay-in-progress" },
		);
	}
	finishMedicalPayment(current, onProgress, orderId, "挂号和医保支付成功");
}

async function continueSelfPayment(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	if (!pending.selfPayIdempotencyKey || !pending.selfQueryIdempotencyKey) {
		throw new ApiError("自费支付上下文不完整", {
			code: "payment-order-invalid",
		});
	}
	const payment = await requestAppointmentSelfPay(
		pending.appointmentId,
		pending.selfPayIdempotencyKey,
	);
	const current: PendingPayment = {
		...pending,
		orderId: payment.data.orderId,
		phase: "self_payment",
	};
	savePendingPayment(current);
	if (payment.data.status === "cash_paid") {
		finishMedicalPayment(
			current,
			onProgress,
			payment.data.orderId,
			"挂号和自费支付成功",
		);
		return;
	}
	const launch = toWechatPaymentLaunch(payment);
	if (launch) {
		onProgress("self-paying", "正在打开微信自费支付收银台，请勿重复点击");
		await requestWechatSelfPayment(launch.params);
	}
	for (
		let index = 0;
		index < MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		onProgress("self-confirming", "正在确认微信自费支付结果，请勿重复付款");
		const result = await queryAppointmentSelfPay(current.appointmentId);
		if (result.data.status === "cash_paid") {
			finishMedicalPayment(
				current,
				onProgress,
				result.data.orderId,
				"挂号和自费支付成功",
			);
			return;
		}
		if (result.data.status === "failed") {
			throw new ApiError("微信自费支付已失败", {
				code: "payment-order-conflict",
			});
		}
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs[index] ?? 1500,
			),
		);
	}
	throw new ApiError(
		"微信自费支付仍在确认，请稍后点击自费支付继续，勿重复付款或预约",
		{ code: "payment-prepay-in-progress" },
	);
}

export async function startSelfPayment(
	appointment: AppointmentPaymentContext,
	onProgress: Progress,
): Promise<PendingPayment> {
	const pending: PendingPayment = {
		appointmentId: appointment.appointmentId,
		patientId: appointment.patientId,
		createdAt: Date.now(),
		authorizeIdempotencyKey: createIdempotencyKey("self-pay-authorize"),
		feesIdempotencyKey: createIdempotencyKey("self-pay-fees"),
		settleIdempotencyKey: createIdempotencyKey("self-pay-settle"),
		mode: "self",
		phase: "self_payment",
		orderId: "pending",
		selfPayIdempotencyKey: createIdempotencyKey("registration-self-pay"),
		selfQueryIdempotencyKey: createIdempotencyKey("registration-self-query"),
	};
	savePendingPayment(pending);
	await continueSelfPayment(pending, onProgress);
	return pending;
}

export async function continueSelfPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	if (pending.phase !== "self_payment" || !pending.orderId) {
		throw new ApiError("自费支付上下文不完整", {
			code: "payment-order-invalid",
		});
	}
	await continueSelfPayment(pending, onProgress);
}

export async function continueMedicalCashierPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<boolean> {
	if (pending.phase !== "medical_cashier" || !pending.orderId) {
		throw new ApiError("医保收银台上下文不完整", {
			code: "payment-order-invalid",
		});
	}
	const idempotencyKey =
		pending.cashierConfirmIdempotencyKey ??
		createIdempotencyKey("medical-cashier-confirm");
	const current = { ...pending, cashierConfirmIdempotencyKey: idempotencyKey };
	savePendingPayment(current);
	onProgress(
		"cash-confirming",
		"正在确认医保收银台支付并回写医院，请勿重复付款",
	);
	const result = readMedicalOrder(
		await requestWithSession<unknown>({
			url: `/payments/medical-insurance/orders/${encodeURIComponent(pending.orderId)}/cashier-confirm`,
			method: "POST",
			idempotencyKey,
		}),
	);
	if (result.status === "insurance_settled") {
		finishMedicalPayment(
			current,
			onProgress,
			pending.orderId,
			"挂号和医保支付成功",
		);
		return true;
	}
	if (result.status === "failed" || result.status === "manual_review") {
		throw new ApiError("医保收银台支付回写未成功", {
			code: "payment-notification-conflict",
		});
	}
	onProgress(
		"cash-confirming",
		"收银台已返回，医院结算仍在确认，请稍后点击医保支付继续；请勿重复付款",
	);
	return false;
}

/** 支付退出必须走服务端统一编排；成功后才清除本地 pending。 */
export async function exitPayment(pending: PendingPayment): Promise<void> {
	await requestAppointmentPaymentExit(
		pending.appointmentId,
		pending.mode ?? "mixed",
	);
	clearPendingPayment();
}
