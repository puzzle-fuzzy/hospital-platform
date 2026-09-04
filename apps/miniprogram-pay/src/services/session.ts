import { STORAGE_KEYS } from "../config";
import { registerSessionRecovery, request } from "./request";

export type Session = {
	accessToken: string;
	userId: string;
};

function readStored(): Session | null {
	const accessToken = String(
		wx.getStorageSync(STORAGE_KEYS.accessToken) || "",
	).trim();
	const value = wx.getStorageSync(STORAGE_KEYS.userInfo);
	const userId =
		value && typeof value === "object"
			? String((value as Record<string, unknown>).id || "").trim()
			: "";
	return accessToken && userId ? { accessToken, userId } : null;
}

export async function ensureSession(): Promise<Session> {
	const cached = readStored();
	if (cached) return cached;
	const login = await new Promise<{ code: string }>((resolve, reject) =>
		wx.login({ success: resolve, fail: reject }),
	);
	const data = await request<{
		accessToken: string;
		user: { id: string };
	}>({
		path: "/auth/wechat",
		method: "POST",
		data: { code: login.code },
	});
	const accessToken = String(data.accessToken || "").trim();
	const userId = String(data.user?.id || "").trim();
	if (!accessToken || !userId) throw new Error("新版平台登录未返回有效会话");
	wx.setStorageSync(STORAGE_KEYS.accessToken, accessToken);
	wx.setStorageSync(STORAGE_KEYS.userInfo, { id: userId });
	return { accessToken, userId };
}

export async function refreshSession(): Promise<Session> {
	wx.removeStorageSync(STORAGE_KEYS.accessToken);
	wx.removeStorageSync(STORAGE_KEYS.userInfo);
	return ensureSession();
}

// 请求层收到 401 时使用同一个恢复入口；注册函数只保存回调，不会在模块加载时
// 触发登录，因此不会影响正常启动，也不会让 /auth/wechat 请求递归重试。
registerSessionRecovery(refreshSession);
