import { STORAGE_KEYS } from "../config";
import { asRecord, platformRequest } from "./request";

export type Session = {
	accessToken: string;
	openid: string;
	unionid: string;
	userInfo: Record<string, any>;
};

function readStored<T>(key: string): T | null {
	const value = wx.getStorageSync(key);
	return value && typeof value === "object" ? (value as T) : null;
}

export async function ensureSession(): Promise<Session> {
	const token = String(
		wx.getStorageSync(STORAGE_KEYS.accessToken) || "",
	).trim();
	const cached = readStored<Record<string, any>>(STORAGE_KEYS.userInfo) || {};
	if (token && (cached.openid || cached.unionid || cached.unionId)) {
		return {
			accessToken: token,
			openid: String(cached.openid || ""),
			unionid: String(cached.unionid || cached.unionId || ""),
			userInfo: cached,
		};
	}

	const login = await new Promise<{ code: string }>((resolve, reject) => {
		wx.login({ success: resolve, fail: reject });
	});
	const loginResult = asRecord(
		await platformRequest<unknown>({
			path: "/system/auth/login/wechat",
			method: "POST",
			data: {
				code: login.code,
				login_type: "小程序端",
				auto_register: true,
			},
			contentType: "application/json",
		}),
	);
	const nextToken = String(
		loginResult.access_token ||
			loginResult.accessToken ||
			loginResult.token ||
			asRecord(loginResult.data).access_token ||
			asRecord(loginResult.data).accessToken ||
			asRecord(loginResult.data).token ||
			"",
	).trim();
	if (!nextToken) throw new Error("微信登录未返回 access_token");
	wx.setStorageSync(STORAGE_KEYS.accessToken, nextToken);

	const current = asRecord(
		await platformRequest<unknown>({ path: "/system/user/current/info" }),
	);
	const userInfo = {
		...asRecord(loginResult.user),
		...asRecord(current.data || current),
	};
	const openid = String(userInfo.openid || userInfo.openId || "").trim();
	const unionid = String(userInfo.unionid || userInfo.unionId || "").trim();
	if (!openid || !unionid) {
		throw new Error("当前用户资料缺少 openid/unionid，无法读取就诊人");
	}
	wx.setStorageSync(STORAGE_KEYS.userInfo, userInfo);
	return { accessToken: nextToken, openid, unionid, userInfo };
}

export async function refreshSession(): Promise<Session> {
	wx.removeStorageSync(STORAGE_KEYS.accessToken);
	wx.removeStorageSync(STORAGE_KEYS.userInfo);
	return ensureSession();
}

/** 让调用方明确 provider 也复用当前登录态，避免测试项目出现第二套 token。 */
export async function assertProviderSession(): Promise<Session> {
	const session = await ensureSession();
	if (!session.accessToken) throw new Error("未取得医院接口登录态");
	return session;
}
