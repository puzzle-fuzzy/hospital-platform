import type { UserProfileResponse } from "../types";
import {
	ApiError,
	getCurrentUser,
	getUserProfile,
	safeApiErrorMessage,
	updateUserProfile,
} from "./api-client";
import {
	getSessionGeneration,
	isCurrentSessionGeneration,
} from "./session-generation";
import { restorePlatformSession } from "./session-service";
import {
	clearStoredWechatUserProfile,
	readStoredWechatUserProfile,
	requestWechatUserProfile,
	storeWechatUserProfile,
	WechatUserProfileAuthorizationError,
	WechatUserProfileUnavailableError,
} from "./wechat-user-profile";

/**
 * App 级个人资料快照。
 *
 * 这是小程序进程内唯一的资料展示来源：服务端普通资料、当前设备已获
 * 授权的微信昵称/头像和授权状态都在这里合并，页面只能订阅它，不能各自
 * 重新创建一套“当前用户信息”。这样切换原生 Tab 时不会重复请求、清空
 * 旧页面字段或把短暂的 loading 当成新的匿名用户。
 */
export type GlobalUserProfileState = {
	status: "idle" | "loading" | "ready" | "error";
	ownerId: string;
	sessionGeneration: number;
	/** 服务端普通资料的原始昵称，资料页和并发写入以它为准。 */
	serverDisplayName: string;
	/** 当前页面展示昵称；默认服务端昵称可以被本机已授权昵称补全。 */
	displayName: string;
	gender: UserProfileResponse["data"]["gender"];
	age: UserProfileResponse["data"]["age"];
	email: UserProfileResponse["data"]["email"];
	version: UserProfileResponse["data"]["version"];
	/** 头像只来自当前 owner 的微信授权本机缓存，服务端不会伪造头像。 */
	avatarUrl: string;
	wechatProfileState: "idle" | "loading" | "ready" | "declined";
	wechatProfileHint: string;
	error: string;
};

const EMPTY_PROFILE_STATE: GlobalUserProfileState = Object.freeze({
	status: "idle",
	ownerId: "",
	sessionGeneration: -1,
	serverDisplayName: "微信用户",
	displayName: "微信用户",
	gender: "unknown",
	age: null,
	email: null,
	version: 0,
	avatarUrl: "",
	wechatProfileState: "idle",
	wechatProfileHint: "",
	error: "",
});

type ProfileListener = (state: GlobalUserProfileState) => void;

let profileBootstrapInFlight: Promise<GlobalUserProfileState> | null = null;
let profileConsentInFlight: Promise<GlobalUserProfileState> | null = null;
const profileListeners = new Set<ProfileListener>();

type AppGlobalDataWithProfile = {
	globalData: {
		userProfile: GlobalUserProfileState;
	};
};

function globalData(): AppGlobalDataWithProfile["globalData"] {
	return (getApp() as unknown as AppGlobalDataWithProfile).globalData;
}

/** 读取当前 App 资料快照；返回同一份状态对象，禁止页面私自改写。 */
export function getGlobalUserProfile(): GlobalUserProfileState {
	const state = globalData().userProfile;
	return state ?? EMPTY_PROFILE_STATE;
}

function publishProfileState(
	patch: Partial<GlobalUserProfileState>,
): GlobalUserProfileState {
	const nextState = Object.freeze({
		...getGlobalUserProfile(),
		...patch,
	});
	globalData().userProfile = nextState;
	for (const listener of profileListeners) {
		// 页面监听器只负责 setData；单个页面已卸载或调试工具热重载时，
		// 不能让它的异常阻断其他页面收到最新资料。
		try {
			listener(nextState);
		} catch {
			// 微信页面生命周期没有统一的订阅异常通道，这里保持全局资料链继续。
		}
	}
	return nextState;
}

/**
 * 页面订阅全局资料。订阅建立时立即发送当前快照，避免页面必须等待下一
 * 次网络回调；返回的取消函数必须在 onUnload 调用，防止页面栈残留回调。
 */
export function subscribeGlobalUserProfile(
	listener: ProfileListener,
): () => void {
	profileListeners.add(listener);
	listener(getGlobalUserProfile());
	return () => profileListeners.delete(listener);
}

function profileStateFromServer(
	ownerId: string,
	profile: UserProfileResponse["data"],
): GlobalUserProfileState {
	const storedWechatProfile = readStoredWechatUserProfile(ownerId);
	const isDefaultDisplayName = profile.displayName === "微信用户";
	return {
		status: "ready",
		ownerId,
		sessionGeneration: getSessionGeneration(),
		serverDisplayName: profile.displayName,
		displayName:
			isDefaultDisplayName && storedWechatProfile
				? storedWechatProfile.nickName
				: profile.displayName,
		gender: profile.gender,
		age: profile.age,
		email: profile.email,
		version: profile.version,
		avatarUrl: storedWechatProfile?.avatarUrl ?? "",
		wechatProfileState: storedWechatProfile ? "ready" : "idle",
		wechatProfileHint: storedWechatProfile ? "已授权头像和昵称" : "",
		error: "",
	};
}

function profileSessionChangedError(): ApiError {
	return new ApiError("User profile session changed", {
		code: "session-changed",
	});
}

/**
 * App 启动后的唯一资料读取入口。
 *
 * `restorePlatformSession` 会安全地恢复/建立微信平台会话，随后读取服务端
 * `/me/profile`，最后再次读取 `/me` 确认 owner 没有在等待期间变化。所有
 * 页面复用同一个 Promise；因此原生 Tab 切换只消费快照，不会重复读取资料。
 */
export function ensureGlobalUserProfile(): Promise<GlobalUserProfileState> {
	const current = getGlobalUserProfile();
	if (
		current.status === "ready" &&
		current.ownerId &&
		isCurrentSessionGeneration(current.sessionGeneration)
	) {
		return Promise.resolve(current);
	}
	if (profileBootstrapInFlight) return profileBootstrapInFlight;

	publishProfileState({ status: "loading", error: "" });
	const bootstrap = restorePlatformSession()
		.then((currentUser) => {
			const expectedOwnerId = currentUser.data.user.id;
			// `/me` 已经证明了 owner；即使普通资料接口随后暂时不可用，
			// 页面仍可以继续读取就诊人目录，同时向资料区显示明确的重试状态。
			publishProfileState({
				status: "loading",
				ownerId: expectedOwnerId,
				sessionGeneration: getSessionGeneration(),
			});
			return getUserProfile().then((response) =>
				getCurrentUser().then((verifiedUser) => {
					if (verifiedUser.data.user.id !== expectedOwnerId) {
						throw profileSessionChangedError();
					}
					if (!isCurrentSessionGeneration(getSessionGeneration())) {
						throw profileSessionChangedError();
					}
					const nextState = profileStateFromServer(
						expectedOwnerId,
						response.data,
					);
					publishProfileState(nextState);
					return nextState;
				}),
			);
		})
		.catch((error: unknown) => {
			const isSessionError =
				error instanceof ApiError &&
				(error.code === "unauthorized" || error.code === "session-changed");
			const nextState = publishProfileState({
				status: "error",
				...(isSessionError
					? {
							ownerId: "",
							sessionGeneration: -1,
							displayName: "微信用户",
							serverDisplayName: "微信用户",
							gender: "unknown",
							age: null,
							email: null,
							version: 0,
							avatarUrl: "",
							wechatProfileState: "idle",
							wechatProfileHint: "",
						}
					: {}),
				error: safeApiErrorMessage(error, "个人资料暂时不可用"),
			});
			const latestOwnerId = getGlobalUserProfile().ownerId;
			if (isSessionError && latestOwnerId) {
				clearStoredWechatUserProfile(latestOwnerId);
			}
			// 普通资料是个人中心的增强读模型，不应阻断已完成的微信会话和
			// 就诊人主流程；只有明确的会话失效才交给页面入口处理。
			if (!isSessionError) return nextState;
			throw error;
		});
	profileBootstrapInFlight = bootstrap;
	void bootstrap.then(
		() => {
			if (profileBootstrapInFlight === bootstrap)
				profileBootstrapInFlight = null;
		},
		() => {
			if (profileBootstrapInFlight === bootstrap)
				profileBootstrapInFlight = null;
		},
	);
	return bootstrap;
}

/** 强制重新读取当前 owner 的资料，供页面错误态的“重新加载”使用。 */
export function refreshGlobalUserProfile(): Promise<GlobalUserProfileState> {
	if (profileBootstrapInFlight) return profileBootstrapInFlight;
	// 主动重新登录可能对应另一位微信账号；开始新一轮 `/me` 之前必须
	// 原子清空旧 owner 的昵称、头像和资料版本，不能让页面短暂展示上一账号。
	publishProfileState({ ...EMPTY_PROFILE_STATE, status: "idle" });
	return ensureGlobalUserProfile();
}

/**
 * 只在用户点击头像或资料提示后调用微信授权；成功结果先写本机 owner
 * 缓存，再按服务端 version 补全默认昵称/性别。所有页面会同时收到更新。
 */
async function authorizeGlobalWechatProfileInternal(): Promise<GlobalUserProfileState> {
	const current = getGlobalUserProfile();
	if (
		current.status !== "ready" ||
		!current.ownerId ||
		!isCurrentSessionGeneration(current.sessionGeneration)
	) {
		throw profileSessionChangedError();
	}

	publishProfileState({
		wechatProfileState: "loading",
		wechatProfileHint: "正在获取头像和昵称...",
		error: "",
	});
	try {
		const wechatProfile = await requestWechatUserProfile();
		if (!isCurrentSessionGeneration(current.sessionGeneration)) {
			throw profileSessionChangedError();
		}
		storeWechatUserProfile(current.ownerId, wechatProfile);

		let nextState = publishProfileState({
			avatarUrl: wechatProfile.avatarUrl,
			displayName:
				current.serverDisplayName !== "微信用户"
					? current.serverDisplayName
					: wechatProfile.nickName,
			gender: wechatProfile.gender,
			wechatProfileState: "ready",
			wechatProfileHint: "头像和昵称已获取",
		});

		if (current.serverDisplayName === "微信用户") {
			try {
				const response = await updateUserProfile({
					version: current.version,
					displayName: wechatProfile.nickName,
					gender: wechatProfile.gender,
				});
				nextState = publishProfileState({
					serverDisplayName: response.data.displayName,
					displayName: response.data.displayName,
					gender: response.data.gender,
					age: response.data.age,
					email: response.data.email,
					version: response.data.version,
					wechatProfileHint: "头像和昵称已获取",
				});
			} catch (error) {
				if (error instanceof ApiError && error.code === "session-changed") {
					throw error;
				}
				publishProfileState({
					wechatProfileHint: `头像和昵称已显示，资料同步失败：${safeApiErrorMessage(error, "请稍后重试")}`,
				});
			}
		}
		return nextState;
	} catch (error) {
		if (error instanceof WechatUserProfileAuthorizationError) {
			publishProfileState({
				wechatProfileState: "declined",
				wechatProfileHint: "未授权，可点击此处重新获取",
			});
		} else if (error instanceof WechatUserProfileUnavailableError) {
			publishProfileState({
				wechatProfileState: "idle",
				wechatProfileHint: "当前微信版本暂不支持资料授权，请升级后重试",
			});
		} else if (error instanceof ApiError && error.code === "session-changed") {
			publishProfileState({
				status: "error",
				ownerId: "",
				sessionGeneration: -1,
				displayName: "微信用户",
				serverDisplayName: "微信用户",
				avatarUrl: "",
				wechatProfileState: "idle",
				wechatProfileHint: "登录状态已变化，请重新加载",
				error: "登录状态已变化，请重新加载",
			});
		}
		throw error;
	}
}

/** 微信授权弹窗和普通资料 PUT 也必须单飞，避免多个页面同时发起两次授权或 409。 */
export function authorizeGlobalWechatProfile(): Promise<GlobalUserProfileState> {
	if (profileConsentInFlight) return profileConsentInFlight;
	const promise = authorizeGlobalWechatProfileInternal();
	profileConsentInFlight = promise;
	void promise.then(
		() => {
			if (profileConsentInFlight === promise) profileConsentInFlight = null;
		},
		() => {
			if (profileConsentInFlight === promise) profileConsentInFlight = null;
		},
	);
	return promise;
}

/** 资料页保存成功后，把服务端 canonical 快照同步给所有订阅页面。 */
export function applyServerUserProfile(
	profile: UserProfileResponse["data"],
): GlobalUserProfileState {
	return publishProfileState({
		status: "ready",
		serverDisplayName: profile.displayName,
		displayName: profile.displayName,
		gender: profile.gender,
		age: profile.age,
		email: profile.email,
		version: profile.version,
		error: "",
	});
}

/** 会话失效时清理全局资料，但不删除用户明确保存的患者选择。 */
export function clearGlobalUserProfile(): void {
	profileBootstrapInFlight = null;
	profileConsentInFlight = null;
	publishProfileState({ ...EMPTY_PROFILE_STATE });
}
