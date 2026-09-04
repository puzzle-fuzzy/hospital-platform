import { STORAGE_KEYS } from "../config";
import { request } from "./request";

export type Session = {
	accessToken: string;
	userId: string;
};

function readStored(): Session | null {
	const accessToken = String(
		wx.getStorageSync(STORAGE_KEYS.accessToken) || "",
	).trim();
	const user = wx.getStorageSync(STORAGE_KEYS.userInfo);
	const userId =
		user && typeof user === "object"
			? String((user as Record<string, unknown>).id || "").trim()
			: "";
	return accessToken && userId ? { accessToken, userId } : null;
}

export async function ensureSession(): Promise<Session> {
	const cached = readStored();
	if (cached) return cached;
	const login = await new Promise<{ code: string }>((resolve, reject) =>
		wx.login({ success: resolve, fail: reject }),
	);
	const data = await request<{ accessToken: string; user: { id: string } }>({
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
