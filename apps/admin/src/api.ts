import type {
	AdminLogPage,
	AdminLogQuery,
	AdminLogRecord,
	AdminMedicalInsuranceRefund,
	AdminPaymentOperationDetail,
	AdminPaymentRefundResult,
	AdminPaymentRefundType,
	AdminPaymentSyncTask,
	AdminRegistrationCancelResult,
	AdminRegistrationResult,
	AdminWechatRefundPaymentHistoryPage,
	AdminWechatRefundPaymentHistoryQuery,
	CaptchaState,
	LoginValues,
	PaymentDayResult,
	PaymentInterfaceDetail,
	RawLogTrace,
	Session,
	WechatRefund,
	WechatRefundSource,
} from "./types";

const SESSION_KEY = "admin.session";

type JsonObject = Record<string, unknown>;

export class ApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

function isObject(value: unknown): value is JsonObject {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function messageOf(value: unknown): string {
	if (!isObject(value)) return "请求失败，请稍后重试";
	const nestedError = isObject(value.error) ? value.error : undefined;
	return String(
		value.msg ||
			value.message ||
			value.err_msg ||
			nestedError?.message ||
			"请求失败，请稍后重试",
	);
}

async function readResponse(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new ApiError("服务返回了无法识别的数据", response.status);
	}
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(path, {
		...options,
		cache: "no-store",
		credentials: "same-origin",
	});
	const payload = await readResponse(response);
	if (!response.ok) throw new ApiError(messageOf(payload), response.status);
	if (
		isObject(payload) &&
		typeof payload.code === "number" &&
		payload.code !== 0
	) {
		throw new ApiError(messageOf(payload), response.status);
	}
	return (
		isObject(payload) && payload.data !== undefined ? payload.data : payload
	) as T;
}

export function loadSession(): Session | undefined {
	try {
		const value = sessionStorage.getItem(SESSION_KEY);
		if (!value) return undefined;
		const parsed = JSON.parse(value) as Partial<Session>;
		if (!parsed.accessToken || !parsed.username) return undefined;
		return parsed as Session;
	} catch {
		sessionStorage.removeItem(SESSION_KEY);
		return undefined;
	}
}

export function saveSession(session: Session): void {
	sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
	sessionStorage.removeItem(SESSION_KEY);
}

export async function loadCaptcha(): Promise<CaptchaState> {
	try {
		const value = await request<{
			enable?: boolean;
			key?: string;
			img_base?: string;
		}>("/api/auth/captcha");
		return {
			enabled: value.enable !== false,
			key: String(value.key || ""),
			image: String(value.img_base || ""),
		};
	} catch (error) {
		if (error instanceof ApiError && error.message.includes("未开启验证码")) {
			return { enabled: false, key: "", image: "" };
		}
		throw error;
	}
}

export async function login(
	values: LoginValues,
	captcha: CaptchaState,
): Promise<Session> {
	const value = await request<{
		access_token?: string;
		refresh_token?: string;
		token_type?: string;
		expires_in?: number;
	}>("/api/auth/login", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			username: values.username.trim(),
			password: values.password,
			captchaKey: captcha.key,
			captcha: String(values.captcha || "").trim(),
		}),
	});
	if (!value.access_token) throw new ApiError("登录成功但未返回访问令牌", 502);
	const session: Session = {
		accessToken: value.access_token,
		refreshToken: String(value.refresh_token || ""),
		tokenType: String(value.token_type || "Bearer"),
		expiresIn: Number(value.expires_in || 0),
		username: values.username.trim(),
	};
	saveSession(session);
	return session;
}

export async function logout(session: Session): Promise<void> {
	try {
		await request("/api/auth/logout", {
			method: "POST",
			headers: { Authorization: `Bearer ${session.accessToken}` },
		});
	} finally {
		clearSession();
	}
}

function logQueryString(query: AdminLogQuery): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query)) {
		if (value !== undefined && value !== "") params.set(key, String(value));
	}
	const encoded = params.toString();
	return encoded ? `?${encoded}` : "";
}

export async function fetchLogPage(
	query: AdminLogQuery,
	session: Session,
): Promise<AdminLogPage> {
	try {
		return await request<AdminLogPage>(`/api/logs${logQueryString(query)}`, {
			headers: { Authorization: `Bearer ${session.accessToken}` },
		});
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchLogDetail(
	id: string,
	session: Session,
): Promise<AdminLogRecord> {
	try {
		return await request<AdminLogRecord>(
			`/api/logs/${encodeURIComponent(id)}`,
			{
				headers: { Authorization: `Bearer ${session.accessToken}` },
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchLogRaw(
	id: string,
	session: Session,
): Promise<RawLogTrace> {
	try {
		return await request<RawLogTrace>(
			`/api/logs/${encodeURIComponent(id)}/raw`,
			{
				headers: { Authorization: `Bearer ${session.accessToken}` },
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchPaymentDay(
	date: string,
	session: Session,
): Promise<PaymentDayResult> {
	try {
		return await request<PaymentDayResult>(
			`/api/payments/day?date=${encodeURIComponent(date)}`,
			{
				headers: { Authorization: `Bearer ${session.accessToken}` },
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchPaymentInterface(
	date: string,
	flowId: string,
	ordinal: number,
	session: Session,
): Promise<PaymentInterfaceDetail> {
	try {
		return await request<PaymentInterfaceDetail>(
			`/api/payments/day/${encodeURIComponent(date)}/${encodeURIComponent(flowId)}/interfaces/${ordinal}`,
			{
				headers: { Authorization: `Bearer ${session.accessToken}` },
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function requestWechatRefund(
	input: {
		source: "payment_order";
		orderId: string;
		refundFen: number;
		idempotencyKey: string;
		reason?: string;
	},
	session: Session,
): Promise<WechatRefund> {
	try {
		return await request<WechatRefund>("/api/refunds/wechat", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(input),
		});
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function queryWechatRefund(
	merchantRefundNo: string,
	session: Session,
): Promise<WechatRefund> {
	try {
		return await request<WechatRefund>(
			`/api/refunds/wechat/${encodeURIComponent(merchantRefundNo)}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchWechatRefundPaymentHistory(
	input: AdminWechatRefundPaymentHistoryQuery,
	session: Session,
): Promise<AdminWechatRefundPaymentHistoryPage> {
	const query = new URLSearchParams();
	if (input.source) query.set("source", input.source);
	if (input.business) query.set("business", input.business);
	if (input.businessDay) query.set("businessDay", input.businessDay);
	if (input.status) query.set("status", input.status);
	if (input.orderId?.trim()) query.set("orderId", input.orderId.trim());
	if (input.page !== undefined) query.set("page", String(input.page));
	if (input.pageSize !== undefined)
		query.set("pageSize", String(input.pageSize));
	if (input.limit !== undefined) query.set("limit", String(input.limit));
	const suffix = query.size > 0 ? `?${query.toString()}` : "";
	try {
		return await request<AdminWechatRefundPaymentHistoryPage>(
			`/api/refunds/wechat/payments${suffix}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchPaymentOperationDetail(
	aggregateId: string,
	session: Session,
): Promise<AdminPaymentOperationDetail> {
	try {
		return await request<AdminPaymentOperationDetail>(
			`/api/refunds/payment-operations/${encodeURIComponent(aggregateId)}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export type AdminPaymentSyncTaskQuery = {
	limit?: number;
	status?: AdminPaymentSyncTask["status"];
	source?: AdminPaymentSyncTask["source"];
	kind?: AdminPaymentSyncTask["kind"];
	aggregateId?: string;
};

export async function fetchPaymentSyncTasks(
	input: AdminPaymentSyncTaskQuery,
	session: Session,
): Promise<readonly AdminPaymentSyncTask[]> {
	const query = new URLSearchParams();
	if (input.limit !== undefined) query.set("limit", String(input.limit));
	if (input.status) query.set("status", input.status);
	if (input.source) query.set("source", input.source);
	if (input.kind) query.set("kind", input.kind);
	if (input.aggregateId?.trim())
		query.set("aggregateId", input.aggregateId.trim());
	try {
		return await request<readonly AdminPaymentSyncTask[]>(
			`/api/refunds/payment-sync-tasks${query.size ? `?${query.toString()}` : ""}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

async function postPaymentSyncTaskAction<T>(
	path: string,
	session: Session,
	body?: unknown,
): Promise<T> {
	try {
		return await request<T>(path, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				...(body !== undefined ? { "Content-Type": "application/json" } : {}),
			},
			...(body !== undefined ? { body: JSON.stringify(body) } : {}),
		});
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export function retryPaymentSyncTask(
	taskId: string,
	session: Session,
): Promise<AdminPaymentSyncTask> {
	return postPaymentSyncTaskAction<AdminPaymentSyncTask>(
		`/api/refunds/payment-sync-tasks/${encodeURIComponent(taskId)}/retry`,
		session,
	);
}

export function markPaymentSyncTaskManualReview(
	taskId: string,
	reason: string,
	session: Session,
): Promise<AdminPaymentSyncTask> {
	return postPaymentSyncTaskAction<AdminPaymentSyncTask>(
		`/api/refunds/payment-sync-tasks/${encodeURIComponent(taskId)}/manual-review`,
		session,
		{ reason },
	);
}

export async function requestMedicalInsuranceRefund(
	input: { orderId: string; idempotencyKey: string; reason?: string },
	session: Session,
): Promise<AdminMedicalInsuranceRefund> {
	try {
		return await request<AdminMedicalInsuranceRefund>(
			"/api/refunds/medical-insurance",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${session.accessToken}`,
					"Content-Type": "application/json",
					"Idempotency-Key": input.idempotencyKey,
				},
				body: JSON.stringify({
					orderId: input.orderId,
					...(input.reason ? { reason: input.reason } : {}),
				}),
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function requestPaymentRefund(
	input: {
		source: WechatRefundSource;
		orderId: string;
		refundType: AdminPaymentRefundType;
		reason?: string;
	},
	session: Session,
): Promise<AdminPaymentRefundResult> {
	try {
		return await request<AdminPaymentRefundResult>("/api/refunds/payment", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(input),
		});
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function queryPaymentRefund(
	source: WechatRefundSource,
	orderId: string,
	session: Session,
	refundType: AdminPaymentRefundType = "ALL",
): Promise<AdminPaymentRefundResult> {
	try {
		return await request<AdminPaymentRefundResult>(
			`/api/refunds/payment/${encodeURIComponent(source)}/${encodeURIComponent(orderId)}?refundType=${encodeURIComponent(refundType)}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function queryMedicalInsuranceRefund(
	refundNo: string,
	session: Session,
): Promise<AdminMedicalInsuranceRefund> {
	try {
		return await request<AdminMedicalInsuranceRefund>(
			`/api/refunds/medical-insurance/${encodeURIComponent(refundNo)}`,
			{ headers: { Authorization: `Bearer ${session.accessToken}` } },
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function fetchRegistrationStatus(
	source: WechatRefundSource,
	orderId: string,
	session: Session,
): Promise<AdminRegistrationResult> {
	try {
		return await request<AdminRegistrationResult>(
			`/api/registrations/${encodeURIComponent(source)}/${encodeURIComponent(orderId)}`,
			{
				headers: { Authorization: `Bearer ${session.accessToken}` },
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}

export async function cancelRegistration(
	source: WechatRefundSource,
	orderId: string,
	reason: string,
	idempotencyKey: string,
	session: Session,
): Promise<AdminRegistrationCancelResult> {
	try {
		return await request<AdminRegistrationCancelResult>(
			`/api/registrations/${encodeURIComponent(source)}/${encodeURIComponent(orderId)}/cancel`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${session.accessToken}`,
					"Content-Type": "application/json",
					"Idempotency-Key": idempotencyKey,
				},
				body: JSON.stringify({ reason }),
			},
		);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
	}
}
