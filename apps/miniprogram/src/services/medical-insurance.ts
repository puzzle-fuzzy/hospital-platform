import { MEDICAL_INSURANCE_CONFIG } from "../config";
import type {
	AppointmentRegistrationResponse,
	RegistrationSelfPayResponse,
} from "../types";
import {
	ApiError,
	createIdempotencyKey,
	queryAppointmentSelfPay,
	requestAppointmentSelfPay,
	requestWithSession,
	requireSuccessDataResponse,
	toWechatPaymentLaunch,
} from "./api-client";
import {
	beginMedicalInsuranceAuthHandoff,
	clearMedicalInsuranceAuthHandoff,
} from "./medical-insurance-auth-handoff";

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
	/** 旧版本默认 registration；门诊支付显式使用 outpatient。 */
	businessType?: "registration" | "outpatient";
	appointmentId: string;
	patientId: string;
	recordId?: string;
	createdAt: number;
	orderId?: string;
	/** 6202 已确认的金额快照；用于微信收银台返回后结果页的即时展示。 */
	amounts?: MedicalPaymentAmounts;
	authorizeIdempotencyKey: string;
	feesIdempotencyKey: string;
	settleIdempotencyKey: string;
	mode?: PaymentMode;
	phase?:
		| "authorization"
		| "authorization_unknown"
		| "medical_processing"
		| "cash_payment"
		| "medical_cashier"
		| "medical_cash_required";
	wechatPayIdempotencyKey?: string;
	wechatQueryIdempotencyKey?: string;
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
	| "fee_upload_pending"
	| "fee_uploaded"
	| "order_placed"
	| "insurance_settled"
	| "cash_pending"
	| "awaiting_confirmation"
	| "manual_review"
	| "failed"
	| "cancelled";

export type MedicalPaymentAmounts = {
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
};

/**
 * 医保授权和 6201/6202 结算完成后，门诊支付必须先停在结算明细页。
 * 只有用户点击“去支付”，调用方才允许继续执行 `.2` 及后续查单/回写。
 */
export type MedicalPaymentContinuation = {
	kind: "settlement";
	orderId: string;
	amounts: MedicalPaymentAmounts;
};

export type MedicalOrder = {
	orderId: string;
	status: MedicalOrderStatus;
	amounts?: MedicalPaymentAmounts;
	cashierUrl?: string;
};

export type MedicalBusinessRecovery = MedicalOrder & {
	authorizationReady: boolean;
	authorizationPending: boolean;
	recoveryAllowed: boolean;
};

export type RegistrationSelfPaymentResult = {
	orderId: string;
	totalFen: number;
};

type MedicalWechatPayParams = {
	mixTradeNo?: string;
	appId?: string;
	timeStamp?: string;
	nonceStr?: string;
	package?: string;
	signType?: "RSA";
	paySign?: string;
};

type WechatSelfPayParams = NonNullable<
	RegistrationSelfPayResponse["data"]["payParams"]
>;

export type MedicalInsurancePaymentEligibility =
	| "unknown"
	| "supported"
	| "unsupported";

export const MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE =
	"当前参保地暂未开通医保支付，请选择微信支付";

type MedicalAuthorizationContext = (
	| { payForRelatives: false }
	| { payForRelatives: true; familyId: string }
) & { medicalInsurancePaymentEligibility: MedicalInsurancePaymentEligibility };

export function isMedicalInsuranceRegionUnsupported(error: unknown): boolean {
	if (!isRecord(error)) return false;
	// 小程序编译及跨 bundle 传递可能丢失 Error 原型；只识别稳定公共码，
	// 数字码回退仍要求 ApiError 形态，不能从提示文本或任意对象猜测资格。
	return (
		error.code === "medical-insurance-region-unsupported" ||
		(error.name === "ApiError" && error.numericCode === 30580)
	);
}

/** 入口资格只接受服务端针对当前就诊人的判断，不使用定位或客户端区划缓存。 */
function readMedicalAuthorizationContext(
	value: unknown,
): MedicalAuthorizationContext {
	if (!isRecord(value) || typeof value.payForRelatives !== "boolean") {
		throw new ApiError("医保亲情付授权上下文不可用", {
			code: "provider-response-invalid",
		});
	}
	const eligibility =
		value.medicalInsurancePaymentEligibility === undefined
			? "unknown"
			: value.medicalInsurancePaymentEligibility;
	if (
		eligibility !== "unknown" &&
		eligibility !== "supported" &&
		eligibility !== "unsupported"
	) {
		throw new ApiError("医保支付资格响应不可用", {
			code: "provider-response-invalid",
		});
	}
	if (!value.payForRelatives) {
		return {
			payForRelatives: false,
			medicalInsurancePaymentEligibility: eligibility,
		};
	}
	if (
		typeof value.familyId !== "string" ||
		!/^[a-f0-9]{32}$/u.test(value.familyId)
	) {
		throw new ApiError("医保亲情付授权标识不可用", {
			code: "provider-response-invalid",
		});
	}
	return {
		payForRelatives: true,
		familyId: value.familyId,
		medicalInsurancePaymentEligibility: eligibility,
	};
}

function assertMedicalInsuranceRegionSupported(
	context: MedicalAuthorizationContext,
): void {
	if (context.medicalInsurancePaymentEligibility === "unsupported") {
		throw new ApiError(MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE, {
			code: "medical-insurance-region-unsupported",
		});
	}
}

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
		super("当前医保支付包含微信支付金额，请继续医保支付");
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
		value === "fee_upload_pending" ||
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

function readMedicalPaymentAmounts(
	value: unknown,
): MedicalPaymentAmounts | null {
	if (!isRecord(value)) return null;
	const { totalFen, insuranceFen, cashFen } = value;
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
		return null;
	}
	return { totalFen, insuranceFen, cashFen };
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
		const parsedAmounts = readMedicalPaymentAmounts(data.amounts);
		if (!parsedAmounts) {
			throw new ApiError("医保金额响应不可用", {
				code: "provider-response-invalid",
			});
		}
		amounts = parsedAmounts;
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

function readMedicalBusinessRecovery(value: unknown): MedicalBusinessRecovery {
	const order = readMedicalOrder(value);
	const payload = requireSuccessDataResponse<unknown>(value);
	const data = payload.data;
	if (
		!isRecord(data) ||
		typeof data.authorizationReady !== "boolean" ||
		typeof data.authorizationPending !== "boolean" ||
		typeof data.recoveryAllowed !== "boolean"
	) {
		throw new ApiError("医保订单恢复响应不可用", {
			code: "provider-response-invalid",
		});
	}
	return {
		...order,
		authorizationReady: data.authorizationReady,
		authorizationPending: data.authorizationPending,
		recoveryAllowed: data.recoveryAllowed,
	};
}

/**
 * 每次医保授权/支付按钮点击都从服务端按当前业务键恢复真实订单。
 * 未找到表示当前业务没有活动医保订单；本地存储不参与这个判断。
 */
export async function queryMedicalBusinessRecovery(input: {
	businessType: "registration" | "outpatient";
	businessId: string;
	patientId: string;
}): Promise<MedicalBusinessRecovery | null> {
	try {
		return readMedicalBusinessRecovery(
			await requestWithSession<unknown>({
				url: "/payments/medical-insurance/business-recovery",
				method: "POST",
				data: input,
				idempotencyKey: createIdempotencyKey("medical-business-recovery"),
			}),
		);
	} catch (error) {
		if (
			error instanceof ApiError &&
			error.code === "medical-insurance-order-not-found"
		) {
			return null;
		}
		throw error;
	}
}

/** 为单次前台操作构造临时参数；不会写入 storage，也不能作为订单事实。 */
export function createMedicalPaymentContext(input: {
	businessType: "registration" | "outpatient";
	businessId: string;
	patientId: string;
	mode?: Exclude<PaymentMode, "self">;
	order?: MedicalBusinessRecovery | MedicalOrder;
	phase?: PendingPayment["phase"];
}): PendingPayment {
	return {
		...(input.businessType === "outpatient"
			? { businessType: "outpatient" as const, recordId: input.businessId }
			: { businessType: "registration" as const }),
		appointmentId: input.businessId,
		patientId: input.patientId,
		createdAt: Date.now(),
		...(input.order?.orderId ? { orderId: input.order.orderId } : {}),
		...(input.order?.amounts ? { amounts: input.order.amounts } : {}),
		authorizeIdempotencyKey: createIdempotencyKey("medical-authorize"),
		feesIdempotencyKey: createIdempotencyKey("medical-fees"),
		settleIdempotencyKey: createIdempotencyKey("medical-settle"),
		mode: input.mode ?? "mixed",
		phase:
			input.phase ?? (input.order ? "medical_processing" : "authorization"),
	};
}

/** 结果页按已完成订单读取 6202/6301 最终金额，不从门诊账单重新推算。 */
export async function queryMedicalOrder(
	orderId: string,
): Promise<MedicalOrder> {
	if (!isOpaque(orderId)) {
		throw new ApiError("医保订单引用无效", {
			code: "payment-order-invalid",
		});
	}
	return readMedicalOrder(
		await requestWithSession<unknown>({
			url: `/payments/medical-insurance/orders/${encodeURIComponent(orderId)}`,
			idempotencyKey: createIdempotencyKey("medical-result-query"),
		}),
	);
}

export function readMedicalWechatPayment(value: unknown): MedicalWechatPayment {
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
		const jsapiValues = [
			params.timeStamp,
			params.nonceStr,
			params.package,
			params.signType,
			params.paySign,
		];
		const hasJsapiParams = jsapiValues.some((value) => value !== undefined);
		const hasMixTradeNo =
			typeof params.mixTradeNo === "string" && Boolean(params.mixTradeNo);
		const hasAppId = typeof params.appId === "string" && Boolean(params.appId);
		const hasCompleteJsapiParams =
			typeof params.timeStamp === "string" &&
			typeof params.nonceStr === "string" &&
			typeof params.package === "string" &&
			params.signType === "RSA" &&
			typeof params.paySign === "string" &&
			Boolean(params.timeStamp) &&
			Boolean(params.nonceStr) &&
			Boolean(params.package) &&
			Boolean(params.paySign);
		if (
			(!hasMixTradeNo && !hasAppId) ||
			(hasJsapiParams && !hasCompleteJsapiParams) ||
			(hasAppId && (!hasCompleteJsapiParams || hasMixTradeNo)) ||
			(!hasAppId && !hasMixTradeNo)
		) {
			throw new ApiError("医保微信支付参数不可用", {
				code: "wechat-pay-params-missing",
			});
		}
		payParams = hasAppId
			? {
					appId: params.appId as string,
					timeStamp: params.timeStamp as string,
					nonceStr: params.nonceStr as string,
					package: params.package as string,
					signType: params.signType as "RSA",
					paySign: params.paySign as string,
				}
			: hasJsapiParams
				? {
						timeStamp: params.timeStamp as string,
						nonceStr: params.nonceStr as string,
						package: params.package as string,
						signType: params.signType as "RSA",
						paySign: params.paySign as string,
						mixTradeNo: params.mixTradeNo as string,
					}
				: { mixTradeNo: params.mixTradeNo as string };
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

export async function medicalAuthorizationContext(
	appointmentId: string,
): Promise<MedicalAuthorizationContext> {
	const response = requireSuccessDataResponse<unknown>(
		await requestWithSession<unknown>({
			url: `/payments/medical-insurance/appointments/${encodeURIComponent(appointmentId)}/authorization-context`,
			idempotencyKey: createIdempotencyKey("medical-authorization-context"),
		}),
	).data;
	return readMedicalAuthorizationContext(response);
}

export async function outpatientMedicalAuthorizationContext(
	recordId: string,
	patientId: string,
): Promise<MedicalAuthorizationContext> {
	const response = requireSuccessDataResponse<unknown>(
		await requestWithSession<unknown>({
			url: `/payments/medical-insurance/outpatient-records/${encodeURIComponent(recordId)}/authorization-context?patientId=${encodeURIComponent(patientId)}`,
			idempotencyKey: createIdempotencyKey(
				"medical-outpatient-authorization-context",
			),
		}),
	).data;
	return readMedicalAuthorizationContext(response);
}

export async function navigateToMedicalAuth(
	appointmentId: string,
	patientId: string,
): Promise<void> {
	assertMedicalConfig();
	const business = {
		businessType: "registration" as const,
		businessId: appointmentId,
		patientId,
	};
	const authorizationContext = await medicalAuthorizationContext(appointmentId);
	assertMedicalInsuranceRegionSupported(authorizationContext);
	const path =
		`auth/pages/bindcard/auth/index?openType=getAuthCode` +
		`&cityCode=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalCityCode)}` +
		`&channel=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalChannel)}` +
		`&sourceapp=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalSourceApp)}` +
		// 机构渠道凭证按医保授权页约定原样传递，不在这里二次编码。
		`&orgChnlCrtfCodg=${MEDICAL_INSURANCE_CONFIG.medicalOrgChannelCredential}` +
		`&orgCodg=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgCode)}` +
		`&bizType=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalBizType)}` +
		`&orgAppId=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgAppId)}` +
		(authorizationContext.payForRelatives
			? `&familyid=${encodeURIComponent(authorizationContext.familyId)}`
			: "");
	beginMedicalInsuranceAuthHandoff(business);
	try {
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
	} catch (error) {
		clearMedicalInsuranceAuthHandoff(business);
		throw error;
	}
}

export async function navigateToOutpatientMedicalAuth(
	recordId: string,
	patientId: string,
): Promise<void> {
	assertMedicalConfig();
	const business = {
		businessType: "outpatient" as const,
		businessId: recordId,
		patientId,
	};
	const authorizationContext = await outpatientMedicalAuthorizationContext(
		recordId,
		patientId,
	);
	assertMedicalInsuranceRegionSupported(authorizationContext);
	const path =
		`auth/pages/bindcard/auth/index?openType=getAuthCode` +
		`&cityCode=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalCityCode)}` +
		`&channel=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalChannel)}` +
		`&sourceapp=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalSourceApp)}` +
		`&orgChnlCrtfCodg=${MEDICAL_INSURANCE_CONFIG.medicalOrgChannelCredential}` +
		`&orgCodg=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgCode)}` +
		`&bizType=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalBizType)}` +
		`&orgAppId=${encodeURIComponent(MEDICAL_INSURANCE_CONFIG.medicalOrgAppId)}` +
		(authorizationContext.payForRelatives
			? `&familyid=${encodeURIComponent(authorizationContext.familyId)}`
			: "");
	beginMedicalInsuranceAuthHandoff(business);
	try {
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
	} catch (error) {
		clearMedicalInsuranceAuthHandoff(business);
		throw error;
	}
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
	onProgress("authorizing", "请在医保小程序完成授权，返回后请等待页面继续处理");
	await navigateToMedicalAuth(appointment.appointmentId, appointment.patientId);
	return pending;
}

export async function startOutpatientMedicalPayment(
	recordId: string,
	patientId: string,
	onProgress: Progress,
	mode: Exclude<PaymentMode, "self"> = "mixed",
): Promise<PendingPayment> {
	const pending: PendingPayment = {
		businessType: "outpatient",
		// 统一上下文仍要求 appointmentId 字段；门诊分支始终以 recordId 为业务键，
		// 该对象只在当前调用栈内传递，不写入 storage。
		appointmentId: recordId,
		recordId,
		patientId,
		createdAt: Date.now(),
		authorizeIdempotencyKey: createIdempotencyKey("medical-authorize"),
		feesIdempotencyKey: createIdempotencyKey("medical-fees"),
		settleIdempotencyKey: createIdempotencyKey("medical-settle"),
		mode,
		phase: "authorization",
	};
	onProgress("authorizing", "请在医保小程序完成授权，返回后请等待页面继续处理");
	await navigateToOutpatientMedicalAuth(recordId, patientId);
	return pending;
}

function requestWechatMedicalInsurancePayment(
	params: MedicalWechatPayParams & { mixTradeNo: string },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const payment = (
			wx as unknown as {
				requestMedicalInsurancePay?: (options: {
					timeStamp?: string;
					nonceStr?: string;
					package?: string;
					signType?: "RSA";
					paySign?: string;
					mixTradeNo: string;
					success?: () => void;
					fail?: (error: { errMsg?: string }) => void;
				}) => void;
			}
		).requestMedicalInsurancePay;
		if (typeof payment !== "function") {
			reject(
				new ApiError("当前微信基础库不支持医保支付", {
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

function requestWechatSelfPayment(params: WechatSelfPayParams): Promise<void> {
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

function finishMedicalPayment(
	pending: PendingPayment,
	onProgress: Progress,
	message: string,
): void {
	onProgress(
		"success",
		pending.businessType === "outpatient"
			? message.replaceAll("挂号", "门诊")
			: message,
	);
}

function createCashPaymentContext(pending: PendingPayment): PendingPayment & {
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
	return next;
}

type MedicalCashConfirmation = {
	completed: boolean;
	payment?: MedicalWechatPayment;
};

async function queryMedicalCashPayment(
	current: CashPaymentPending,
	onProgress: Progress,
	maxAttempts: number,
): Promise<MedicalCashConfirmation> {
	const attempts = Math.max(
		1,
		Math.min(
			maxAttempts,
			MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
		),
	);
	let latest: MedicalWechatPayment | undefined;
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
		latest = result;
		if (result.medInsFailReason) {
			throw new MedicalInsurancePaymentFailureError(result.medInsFailReason);
		}
		if (
			result.status === "insurance_settled" &&
			["cash_paid", "his_written_back", "completed"].includes(
				result.paymentState,
			)
		) {
			finishMedicalPayment(current, onProgress, "挂号和医保支付成功");
			return { completed: true, payment: result };
		}
		if (result.status === "failed" || result.status === "manual_review") {
			throw new ApiError("微信医保支付回写未成功", {
				code: "payment-notification-conflict",
			});
		}
		if (result.paymentState === "failed") {
			throw new ApiError("微信医保支付已失败", {
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
	return { completed: false, ...(latest ? { payment: latest } : {}) };
}

/** 回到正式小程序后只查已有混合订单，避免重复预下单或再次调起收银台。 */
export function resumeMedicalCashPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
	maxAttempts: number = MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
): Promise<boolean> {
	if (pending.phase !== "cash_payment") {
		throw new ApiError("医保支付上下文不完整，无法确认", {
			code: "payment-order-invalid",
		});
	}
	const current = createCashPaymentContext(pending);
	// 查询窗口结束只代表“暂未读到最终状态”，不能清除仍可恢复的订单。
	// 明确失败也保留原订单，由医院和服务端依据权威状态继续处置。
	return queryMedicalCashPayment(current, onProgress, maxAttempts).then(
		(result) => result.completed,
	);
}

/**
 * 用户明确点击“继续支付”时先查原微信/医保混合订单。只有服务端确认仍处于
 * not_started/prepay_ready，才用同一个微信订单和幂等键重新打开收银台；
 * unknown 状态只继续等待，不能用“没有查到成功”推导为可以再次支付。
 */
export async function resumeOrContinueMedicalCashPaymentFromPending(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	if (pending.phase !== "cash_payment") {
		throw new ApiError("医保支付上下文不完整，无法继续", {
			code: "payment-order-invalid",
		});
	}
	const current = createCashPaymentContext(pending);
	const confirmation = await queryMedicalCashPayment(current, onProgress, 1);
	if (confirmation.completed) return;
	if (
		confirmation.payment?.status === "cash_pending" &&
		["not_started", "prepay_ready"].includes(confirmation.payment.paymentState)
	) {
		await continueMedicalCashPayment(current, onProgress);
		return;
	}
	throw new ApiError(
		"微信医保支付仍在确认，请稍后点击医保支付继续，勿重复付款",
		{ code: "payment-prepay-in-progress" },
	);
}

export async function continueMedicalCashPayment(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	const current = createCashPaymentContext(pending);
	let paymentResponse: unknown;
	let paymentResponseUnknown = false;
	try {
		paymentResponse = await requestWithSession<unknown>({
			url: `/payments/medical-insurance/orders/${encodeURIComponent(current.orderId)}/wechat-pay`,
			method: "POST",
			idempotencyKey: current.wechatPayIdempotencyKey,
		});
	} catch (error) {
		// 50250 只表示本次预支付响应未知/已过期，不能清除仍可查单的
		// 医保订单。先直接查官方混合订单，若 .32 已成功则会进入结果页。
		if (error instanceof ApiError && error.code === "payment-prepay-unknown") {
			paymentResponseUnknown = true;
		} else {
			// 已有 orderId 的写命令失败不能推导为“未支付”；保留原单供查单。
			throw error;
		}
	}
	if (paymentResponseUnknown && paymentResponse === undefined) {
		onProgress(
			"cash-confirming",
			"支付参数已过期或未返回，正在确认医保订单结果，请勿重复付款",
		);
		const confirmation = await queryMedicalCashPayment(
			current,
			onProgress,
			MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
		);
		if (confirmation.completed) return;
		throw new ApiError(
			"微信医保支付仍在确认，请稍后点击医保支付继续，勿重复付款",
			{ code: "payment-prepay-in-progress" },
		);
	}
	const payment = readMedicalWechatPayment(paymentResponse);
	if (payment.medInsFailReason) {
		throw new MedicalInsurancePaymentFailureError(payment.medInsFailReason);
	}
	if (current.mode === "medical" && payment.cashFen > 0) {
		throw new MedicalCashRequiredError();
	}
	let paymentWasCancelled = false;
	if (payment.payParams) {
		const isOwnWechatSelfPay = !payment.payParams.mixTradeNo;
		onProgress(
			"cash-paying",
			isOwnWechatSelfPay
				? "正在打开微信自费支付收银台，请勿重复点击"
				: "正在打开微信医保支付收银台，请勿重复点击",
		);
		try {
			if (isOwnWechatSelfPay) {
				await requestWechatSelfPayment(
					payment.payParams as WechatSelfPayParams,
				);
			} else {
				await requestWechatMedicalInsurancePayment(
					payment.payParams as MedicalWechatPayParams & { mixTradeNo: string },
				);
			}
		} catch (error) {
			if (error instanceof WechatPaymentCancelledError) {
				paymentWasCancelled = true;
			} else {
				throw error;
			}
		}
	}
	if (paymentWasCancelled) {
		const confirmation = await queryMedicalCashPayment(current, onProgress, 1);
		if (confirmation.completed) return;
		throw new WechatPaymentCancelledError();
	}
	if (
		payment.status === "failed" ||
		payment.status === "manual_review" ||
		payment.paymentState === "failed"
	) {
		throw new ApiError("医保支付结果需要医院核实，请勿重复付款", {
			statusCode: 409,
			code: "payment-notification-conflict",
		});
	}
	const confirmation = await queryMedicalCashPayment(
		current,
		onProgress,
		MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length,
	);
	if (confirmation.completed) return;
	// 查询窗口结束不代表失败；无论收银台是否正常返回，都保留原订单供续查。
	throw new ApiError(
		"微信医保支付仍在确认，请稍后点击医保支付继续，勿重复付款",
		{ code: "payment-prepay-in-progress" },
	);
}

type MedicalProcessingPending = PendingPayment & {
	orderId: string;
	phase: "medical_processing";
};

function createMedicalProcessingContext(
	pending: PendingPayment,
	orderId: string,
): MedicalProcessingPending {
	if (!isOpaque(orderId)) {
		throw new ApiError("医保订单引用无效", {
			code: "payment-order-invalid",
		});
	}
	return {
		...pending,
		orderId,
		phase: "medical_processing",
	};
}

async function finishOrContinueMedicalSettlement(
	current: MedicalProcessingPending,
	initialOrder: MedicalOrder,
	onProgress: Progress,
): Promise<MedicalPaymentContinuation | undefined> {
	const outpatient = current.businessType === "outpatient";
	const { orderId } = current;
	let order = initialOrder;
	for (
		let index = 0;
		index < MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		if (order.status === "insurance_settled") {
			finishMedicalPayment(current, onProgress, "挂号和医保支付成功");
			return;
		}
		if (order.status === "cash_pending") {
			if (!order.amounts) {
				throw new ApiError("医保结算金额不可用", {
					code: "provider-response-invalid",
				});
			}
			if (outpatient) {
				onProgress("settling", "医保结算已完成，请确认结算明细后点击去支付");
				return { kind: "settlement", orderId, amounts: order.amounts };
			}
			if (current.mode === "medical" && order.amounts.cashFen > 0) {
				throw new MedicalCashRequiredError();
			}
			await continueMedicalCashPayment(
				{ ...current, orderId, amounts: order.amounts },
				onProgress,
			);
			return;
		}
		if (order.status === "failed" || order.status === "manual_review") {
			// 服务端仍保留可审计订单；后续按钮点击会再次查询该状态，客户端
			// 不保存本地门禁，也不能绕过服务端后重付。
			throw new ApiError("医保结算未成功，请勿重复付款并联系医院核实", {
				statusCode: 409,
				code: "payment-notification-conflict",
			});
		}
		if (order.status === "cancelled") {
			throw new ApiError("原医保订单已取消，请重新完成医保授权", {
				statusCode: 409,
				code: "payment-order-conflict",
			});
		}
		if (
			order.status === "created" ||
			order.status === "fee_upload_pending" ||
			order.status === "fee_uploaded"
		) {
			throw new ApiError("医保结算命令结果尚未确认，请稍后查询原订单", {
				code: "payment-prepay-in-progress",
			});
		}
		await new Promise((resolve) =>
			setTimeout(
				resolve,
				MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs[index] ?? 1500,
			),
		);
		onProgress("polling", `正在确认医保结算结果（${index + 1}），请勿重复操作`);
		order = await queryMedicalOrder(orderId);
	}
	throw new ApiError(
		"医保结算仍在处理中，请稍后点击原支付方式继续，勿重复预约",
		{ code: "payment-prepay-in-progress" },
	);
}

/**
 * 已形成服务端订单后的统一恢复入口。6201 和 6202 均复用原 orderId 与幂等键；
 * 服务端状态守卫决定是继续当前阶段还是只查单，客户端不得另建医保订单。
 */
export async function resumeMedicalSettlementFromPending(
	pending: PendingPayment,
	onProgress: Progress,
): Promise<MedicalPaymentContinuation | undefined> {
	const orderId = pending.orderId?.trim();
	if (
		!orderId ||
		(pending.phase !== "medical_processing" &&
			pending.phase !== "authorization")
	) {
		throw new ApiError("医保结算恢复上下文不完整", {
			code: "payment-order-invalid",
		});
	}
	let current = createMedicalProcessingContext(pending, orderId);
	onProgress(
		"insuring",
		current.businessType === "outpatient"
			? "正在恢复原门诊医保订单并核对费用，请勿重复提交"
			: "正在恢复原挂号医保订单并核对费用，请勿重复提交",
	);
	const fees = await orderCommand(
		`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/fees`,
		current.feesIdempotencyKey,
	);
	if (fees.cashierUrl) {
		current = createMedicalProcessingContext(
			{ ...current, cashierUrl: fees.cashierUrl },
			orderId,
		);
	}
	let order = fees;
	if (order.status === "fee_uploaded") {
		onProgress("settling", "正在进行医保结算，请勿重复授权或付款");
		order = await orderCommand(
			`/payments/medical-insurance/orders/${encodeURIComponent(orderId)}/settle`,
			current.settleIdempotencyKey,
		);
	}
	return finishOrContinueMedicalSettlement(current, order, onProgress);
}

export async function continueMedicalPayment(
	authCode: string,
	pending: PendingPayment,
	onProgress: Progress,
): Promise<MedicalPaymentContinuation | undefined> {
	if (!authCode.trim())
		throw new ApiError("医保授权结果为空", {
			code: "medical-insurance-invalid",
		});
	const outpatient = pending.businessType === "outpatient";
	let authorize: unknown;
	try {
		const authorizationResponse = await requestWithSession<unknown>({
			url: outpatient
				? "/payments/medical-insurance/outpatient/authorize"
				: "/payments/medical-insurance/authorize",
			method: "POST",
			data: outpatient
				? {
						recordId: pending.recordId ?? pending.appointmentId,
						patientId: pending.patientId,
						authCode,
					}
				: { appointmentId: pending.appointmentId, authCode },
			idempotencyKey: pending.authorizeIdempotencyKey,
		});
		authorize = requireSuccessDataResponse<unknown>(authorizationResponse).data;
	} catch (error) {
		if (
			isMedicalInsuranceRegionUnsupported(error) ||
			pending.phase !== "authorization" ||
			pending.orderId
		) {
			throw error;
		}
		// 仅新授权、费用上传前复核当次业务的服务端资格。已有订单和后续
		// 支付异常不能因参保地提示而引导改付，避免尚未确认的订单重复扣款。
		let authorizationContext: MedicalAuthorizationContext;
		try {
			authorizationContext = outpatient
				? await outpatientMedicalAuthorizationContext(
						pending.recordId ?? pending.appointmentId,
						pending.patientId,
					)
				: await medicalAuthorizationContext(pending.appointmentId);
		} catch {
			throw error;
		}
		if (
			authorizationContext.medicalInsurancePaymentEligibility === "unsupported"
		) {
			throw new ApiError(MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE, {
				code: "medical-insurance-region-unsupported",
			});
		}
		throw error;
	}
	if (
		!isRecord(authorize) ||
		!isOpaque(authorize.orderId) ||
		authorize.status !== "authorized"
	) {
		throw new ApiError("医保授权响应不可用", {
			code: "provider-response-invalid",
		});
	}
	const current = createMedicalProcessingContext(pending, authorize.orderId);
	return resumeMedicalSettlementFromPending(current, onProgress);
}

async function continueSelfPayment(
	appointmentId: string,
	onProgress: Progress,
): Promise<RegistrationSelfPaymentResult> {
	// 每次点击都向服务端恢复同一 appointmentId 对应的确定性订单。客户端
	// 不保存 pending、订单号或按钮状态；重复点击由服务端业务键保证幂等。
	const payment = await requestAppointmentSelfPay(appointmentId);
	if (payment.data.status === "cash_paid") {
		onProgress("success", "挂号和微信支付成功");
		return {
			orderId: payment.data.orderId,
			totalFen: payment.data.totalFen,
		};
	}
	if (payment.data.status === "failed") {
		throw new ApiError("微信支付已失败", {
			code: "payment-order-conflict",
		});
	}
	const launch = toWechatPaymentLaunch(payment);
	if (launch) {
		onProgress("self-paying", "正在打开微信支付收银台，请勿重复点击");
		await requestWechatSelfPayment(launch.params);
	}
	for (
		let index = 0;
		index < MEDICAL_INSURANCE_CONFIG.insurancePollDelaysMs.length;
		index += 1
	) {
		onProgress("self-confirming", "正在确认微信支付结果，请勿重复付款");
		const result = await queryAppointmentSelfPay(appointmentId);
		if (result.data.status === "cash_paid") {
			onProgress("success", "挂号和微信支付成功");
			return {
				orderId: result.data.orderId,
				totalFen: result.data.totalFen,
			};
		}
		if (result.data.status === "failed") {
			throw new ApiError("微信支付已失败", {
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
		"微信支付仍在确认，请稍后点击微信支付继续，勿重复付款或预约",
		{ code: "payment-prepay-in-progress" },
	);
}

export async function startSelfPayment(
	appointment: AppointmentPaymentContext,
	onProgress: Progress,
): Promise<RegistrationSelfPaymentResult> {
	return continueSelfPayment(appointment.appointmentId, onProgress);
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
		finishMedicalPayment(current, onProgress, "挂号和医保支付成功");
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
