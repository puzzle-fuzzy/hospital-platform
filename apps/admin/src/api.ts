import { normalize1101Result, queryPayload } from "./insurance";
import type {
	AdminLogPage,
	AdminLogQuery,
	AdminLogRecord,
	RawLogTrace,
	CaptchaState,
	LoginValues,
	Normalized1101Result,
	QueryValues,
	Session,
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

export async function queryInsurance(
	values: QueryValues,
	session: Session,
): Promise<Normalized1101Result> {
	try {
		const result = await request<unknown>("/api/insurance/1101", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(queryPayload(values)),
		});
		return normalize1101Result(result);
	} catch (error) {
		if (error instanceof ApiError && error.status === 401) clearSession();
		throw error;
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
