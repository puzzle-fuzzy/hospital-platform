/**
 * 微信个人资料授权的最小安全边界。
 *
 * `wx.login()` 只负责换取平台会话，不会返回昵称、头像或性别；这些字段
 * 必须在用户明确点击后的 `wx.getUserProfile()` 回调中读取。这里不把
 * openid、unionid、encryptedData 或 iv 送到服务端，也不把微信临时头像 URL
 * 当成永久头像资源写入普通资料接口。
 */

export type WechatUserGender = "male" | "female" | "unknown";

export type WechatUserProfileSnapshot = {
	nickName: string;
	avatarUrl: string;
	gender: WechatUserGender;
};

/** 用户拒绝授权属于可重试的用户选择，不应被页面显示成网络或登录故障。 */
export class WechatUserProfileAuthorizationError extends Error {
	readonly code = "wechat-profile-authorization-denied" as const;

	constructor() {
		super("Wechat user profile authorization was not granted");
		this.name = "WechatUserProfileAuthorizationError";
	}
}

/** 微信回调的头像地址只能作为展示输入，拒绝非 HTTPS URL，避免注入任意资源。 */
function normalizeAvatarUrl(value: unknown): string {
	if (typeof value !== "string") return "";
	const avatarUrl = value.trim();
	if (!avatarUrl) return "";
	try {
		const url = new URL(avatarUrl);
		return url.protocol === "https:" ? avatarUrl : "";
	} catch {
		return "";
	}
}

/** 昵称只用于页面展示和普通资料同步，拒绝空值、控制字符和异常超长值。 */
function normalizeNickName(value: unknown): string {
	if (typeof value !== "string") return "";
	if (Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f)) {
		return "";
	}
	const nickName = value.trim();
	if (nickName.length === 0 || Array.from(nickName).length > 64) {
		return "";
	}
	return nickName;
}

/** 把微信 0/1/2 性别枚举转换成服务端普通资料的内部枚举。 */
export function normalizeWechatUserProfile(
	value: unknown,
): WechatUserProfileSnapshot | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const nickName = normalizeNickName(record.nickName);
	const avatarUrl = normalizeAvatarUrl(record.avatarUrl);
	if (!nickName || !avatarUrl) return null;
	const gender: WechatUserGender =
		record.gender === 1 ? "male" : record.gender === 2 ? "female" : "unknown";
	return { nickName, avatarUrl, gender };
}

/**
 * 只允许在用户手势触发的页面回调中调用微信授权接口。
 * `desc` 会直接展示在微信授权弹窗中，必须准确描述用途，不能写成泛化的
 * “用于登录”或借此索取与当前页面无关的信息。
 */
export function requestWechatUserProfile(): Promise<WechatUserProfileSnapshot> {
	return new Promise((resolve, reject) => {
		if (typeof wx.getUserProfile !== "function") {
			reject(new WechatUserProfileAuthorizationError());
			return;
		}
		wx.getUserProfile({
			desc: "用于完善个人中心的头像、昵称和性别",
			lang: "zh_CN",
			success: (result) => {
				const snapshot = normalizeWechatUserProfile(result.userInfo);
				if (!snapshot) {
					reject(new Error("微信个人资料返回内容不完整"));
					return;
				}
				resolve(snapshot);
			},
			fail: () => reject(new WechatUserProfileAuthorizationError()),
		});
	});
}

function storageKey(ownerId: string): string {
	return `wechat-user-profile:${ownerId}`;
}

/**
 * 微信头像 URL 会随着用户换头像而失效，因此缓存只服务于当前设备的短期
 * 展示，不是服务端头像事实。key 和值都绑定平台 owner，账号切换时不会
 * 把上一位用户的头像昵称拼到当前账号上。
 */
export function readStoredWechatUserProfile(
	ownerId: string,
): WechatUserProfileSnapshot | null {
	if (!ownerId.trim()) return null;
	const value = wx.getStorageSync(storageKey(ownerId));
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	if (record.ownerId !== ownerId) return null;
	return normalizeWechatUserProfile(record);
}

/** 保存经过运行时校验、且已经关联当前 owner 的头像昵称快照。 */
export function storeWechatUserProfile(
	ownerId: string,
	profile: WechatUserProfileSnapshot,
): void {
	if (!ownerId.trim()) return;
	wx.setStorageSync(storageKey(ownerId), { ownerId, ...profile });
}

/** 会话明确失效时清理当前 owner 的本地展示资料，避免旧账号残留。 */
export function clearStoredWechatUserProfile(ownerId: string): void {
	if (ownerId.trim()) wx.removeStorageSync(storageKey(ownerId));
}
