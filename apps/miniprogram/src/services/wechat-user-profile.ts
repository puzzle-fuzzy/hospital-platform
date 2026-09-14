/**
 * 微信个人资料授权的最小安全边界。
 *
 * `wx.login()` 只负责换取平台会话，不会返回昵称、头像或性别；这些字段
 * 必须在用户明确点击后的 `wx.getUserProfile()` 回调中读取。这里不把
 * openid、unionid、encryptedData 或 iv 送到服务端，也不把微信临时头像 URL
 * 当成永久头像资源写入普通资料接口。
 */

import { logClientErrorTransformed } from "./telemetry";

export type WechatUserGender = "male" | "female" | "unknown";

export type WechatUserProfileSnapshot = {
	nickName: string;
	avatarUrl: string;
	gender: WechatUserGender;
};

/** 微信头像昵称填写组件返回的、由用户本次明确确认的展示资料。 */
export type WechatUserProfileSelection = {
	nickName: string;
	avatarUrl: string;
};

/** 用户拒绝授权属于可重试的用户选择，不应被页面显示成网络或登录故障。 */
export class WechatUserProfileAuthorizationError extends Error {
	readonly code = "wechat-profile-authorization-denied" as const;

	constructor() {
		super("Wechat user profile authorization was not granted");
		this.name = "WechatUserProfileAuthorizationError";
	}
}

/** 当前微信基础库不提供资料授权接口时，属于运行能力缺失，不是用户拒绝。 */
export class WechatUserProfileUnavailableError extends Error {
	readonly code = "wechat-profile-unavailable" as const;

	constructor() {
		super("Wechat user profile API is unavailable");
		this.name = "WechatUserProfileUnavailableError";
	}
}

/** 头像昵称填写组件返回空值或异常路径时，不得把默认值伪装成用户资料。 */
export class WechatUserProfileSelectionError extends Error {
	readonly code = "wechat-profile-selection-invalid" as const;

	constructor() {
		super("Wechat avatar and nickname selection is incomplete");
		this.name = "WechatUserProfileSelectionError";
	}
}

/** 微信回调的头像地址只能作为展示输入，拒绝非 HTTPS URL，避免注入任意资源。 */
function normalizeRemoteAvatarUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const avatarUrl = value.trim();
	if (!avatarUrl) return "";
	try {
		const url = new URL(avatarUrl);
		return url.protocol === "https:" ? avatarUrl : null;
	} catch {
		return null;
	}
}

/**
 * `button[open-type=chooseAvatar]` 返回的是微信沙箱内的临时/持久文件路径，
 * 不是公网 HTTPS 地址。只额外接受微信明确生成的本地协议和 `/tmp` 路径，
 * 不能把任意 HTTP 地址作为头像资源写入页面。
 */
function normalizeChosenAvatarUrl(
	value: unknown,
	allowEmpty = false,
): string | null {
	if (typeof value !== "string") return null;
	const avatarUrl = value.trim();
	if (!avatarUrl) return allowEmpty ? "" : null;
	if (/\s/u.test(avatarUrl)) return null;
	if (
		avatarUrl.startsWith("wxfile://") ||
		avatarUrl.startsWith("http://tmp/")
	) {
		return avatarUrl;
	}
	return normalizeRemoteAvatarUrl(avatarUrl);
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
	const avatarUrl = normalizeRemoteAvatarUrl(record.avatarUrl);
	// 微信可能返回空头像地址；这不是资料损坏，页面会回退到默认头像。
	// 但非字符串、非法 URL 或非 HTTPS URL 必须拒绝，不能把不安全值当作空头像。
	if (!nickName || avatarUrl === null) return null;
	const gender: WechatUserGender =
		record.gender === 1 ? "male" : record.gender === 2 ? "female" : "unknown";
	return { nickName, avatarUrl, gender };
}

/** 校验头像昵称填写组件的结果；两项都确认后才允许替换当前展示资料。 */
export function normalizeWechatUserProfileSelection(
	value: unknown,
): WechatUserProfileSelection | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const nickName = normalizeNickName(record.nickName);
	const avatarUrl = normalizeChosenAvatarUrl(record.avatarUrl);
	if (!nickName || !avatarUrl) return null;
	return { nickName, avatarUrl };
}

/**
 * 只允许在用户手势触发的页面回调中调用微信授权接口。
 * `desc` 会直接展示在微信授权弹窗中，必须准确描述用途，不能写成泛化的
 * “用于登录”或借此索取与当前页面无关的信息。
 */
export function requestWechatUserProfile(): Promise<WechatUserProfileSnapshot> {
	return new Promise((resolve, reject) => {
		if (typeof wx.getUserProfile !== "function") {
			reject(new WechatUserProfileUnavailableError());
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
			fail: (failure) => {
				// 授权失败会统一折叠为单一错误类；原始 fail 事实先留痕，
				// 否则用户拒绝与容器故障在遥测里无法区分。
				logClientErrorTransformed(
					"wechat-user-profile.get-user-profile-fail",
					failure,
				);
				reject(new WechatUserProfileAuthorizationError());
			},
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
	const nickName = normalizeNickName(record.nickName);
	const avatarUrl = normalizeChosenAvatarUrl(record.avatarUrl, true);
	if (!nickName || avatarUrl === null) return null;
	const gender: WechatUserGender =
		record.gender === "male" || record.gender === "female"
			? record.gender
			: "unknown";
	return { nickName, avatarUrl, gender };
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
