import type { UserProfileResponse } from "../types";
import {
	ApiError,
	getCurrentUser,
	getUserProfile,
	safeApiErrorMessage,
	updateUserProfile,
} from "./api-client";
import {
	getRegisteredApp,
	type MiniProgramAppContainer,
	registerBootstrapApp,
} from "./app-runtime-context";
import { registerSessionChangedListener } from "./session-events";
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
/**
 * 资料仓库访问的 App 容器最小接口。
 *
 * App.onLaunch 执行期间不能假设 `getApp()` 已经能反查到当前实例，因此
 * 启动入口必须把自己的 `globalData` 显式传入；页面 CommonJS bundle 则
 * 继续通过 `getApp()` 取得同一份对象。这里只声明资料仓库需要的字段，
 * 不把 API、患者或 provider 身份扩散到跨 bundle 的状态桥里。
 */
export type GlobalUserProfileApp = {
	globalData: {
		userProfile: GlobalUserProfileState;
		/** App.onLaunch 与页面模块共享的唯一资料初始化 Promise。 */
		userProfileBootstrapPromise?: Promise<GlobalUserProfileState> | null;
		/** 微信资料授权也必须跨 app.js 与页面 bundle 共享单飞 Promise。 */
		userProfileConsentPromise?: Promise<GlobalUserProfileState> | null;
		/** 监听器也必须跨 app.js bundle 与页面 CommonJS 模块共享。 */
		userProfileListeners?: Set<ProfileListener>;
		/** 保证同一个微信 App 容器只注册一次会话清理监听。 */
		userProfileSessionCleanupRegistered?: boolean;
	};
};

/** App IIFE 在 onLaunch 期间暂存的实例；页面 bundle 不会共享模块变量。 */
let launchApp: GlobalUserProfileApp | null = null;

function globalData(
	app?: GlobalUserProfileApp,
): GlobalUserProfileApp["globalData"] {
	if (app) {
		if (!app.globalData) {
			throw new Error("Global user profile App globalData is not initialized");
		}
		launchApp = app;
		registerBootstrapApp(app as MiniProgramAppContainer);
		return app.globalData;
	}

	// 页面脚本优先从微信容器获取最新实例；启动 IIFE 或测试环境无法反查
	// 时，由显式登记的容器兜底。两条路径都必须指向同一个 globalData 对象。
	const currentApp = getRegisteredApp<GlobalUserProfileApp>();
	if (currentApp?.globalData) {
		launchApp = currentApp;
		return currentApp.globalData;
	}

	if (launchApp?.globalData) return launchApp.globalData;
	throw new Error(
		"Global user profile requires an initialized WeChat App instance",
	);
}

/**
 * 让 token 轮换/失效立即清理旧账号的全局资料。
 *
 * 该订阅必须在第一次读取资料快照时建立，而不能只在页面 onLoad 建立：
 * App.onLaunch 的 IIFE bundle 可能比页面 CommonJS bundle 更早收到 401，
 * 只有 App 级仓库自己订阅，才能保证旧头像/昵称不会跨账号停留在全局状态。
 */
function ensureSessionChangedSubscription(): void {
	const appData = globalData();
	if (appData.userProfileSessionCleanupRegistered) return;
	appData.userProfileSessionCleanupRegistered = true;
	registerSessionChangedListener(() => {
		clearGlobalUserProfile();
	});
}

/**
 * app.js 会被构建成独立的全局脚本，页面脚本则由微信按 CommonJS 页面模块
 * 加载；两边可能各自拥有一份本文件的模块实例。因此启动 Promise 和监听器
 * 不能只放在模块级变量中，否则页面会看见同一份快照却失去单飞和更新通知。
 */
function sharedProfileListeners(): Set<ProfileListener> {
	const appData = globalData();
	if (appData.userProfileListeners instanceof Set) {
		return appData.userProfileListeners;
	}
	const listeners = new Set<ProfileListener>();
	appData.userProfileListeners = listeners;
	return listeners;
}

/** 读取当前 App 资料快照；返回同一份状态对象，禁止页面私自改写。 */
export function getGlobalUserProfile(): GlobalUserProfileState {
	ensureSessionChangedSubscription();
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
	for (const listener of sharedProfileListeners()) {
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
	const listeners = sharedProfileListeners();
	listeners.add(listener);
	listener(getGlobalUserProfile());
	return () => listeners.delete(listener);
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
 * 校验微信授权异步回调仍属于当前资料快照。
 *
 * 只比较 sessionGeneration 不够：退出、账号切换或测试容器清理资料时，
 * 全局快照可能先被清空，代际号稍后才推进。若此时授权回调成功，旧回调
 * 会把头像/昵称重新写回空快照。这里同时校验 owner、代际和状态；允许
 * `error` 是因为普通资料 GET 暂时失败时，当前 owner 仍然可以主动取得
 * 微信资料，不能把可降级的资料故障误判为会话失效。
 */
function assertCurrentWechatProfileContext(
	ownerId: string,
	sessionGeneration: number,
): void {
	const latest = getGlobalUserProfile();
	if (
		!isCurrentSessionGeneration(sessionGeneration) ||
		latest.ownerId !== ownerId ||
		latest.sessionGeneration !== sessionGeneration ||
		(latest.status !== "ready" && latest.status !== "error")
	) {
		throw profileSessionChangedError();
	}
}

/**
 * 普通资料接口暂时失败不等于微信会话失效。
 *
 * `/me` 已经证明 owner 和会话代际后，即使 `/me/profile` 因持久化或网络
 * 暂时不可用，用户仍然可以通过明确手势取得头像昵称。这里不能把 `error`
 * 当成 `ready`，也不能把它一律当成未登录；授权结果先进入当前 owner 的
 * 本机展示快照，服务端同步是否成功继续由独立的 PUT 结果决定。
 */
function canAuthorizeWechatProfile(state: GlobalUserProfileState): boolean {
	return state.status === "ready" || state.status === "error";
}

/**
 * App 启动后的唯一资料读取入口。
 *
 * `restorePlatformSession` 会安全地恢复/建立微信平台会话，随后读取服务端
 * `/me/profile`，最后再次读取 `/me` 确认 owner 没有在等待期间变化。所有
 * 页面复用同一个 Promise；因此原生 Tab 切换只消费快照，不会重复读取资料。
 */
export function ensureGlobalUserProfile(
	app?: GlobalUserProfileApp,
): Promise<GlobalUserProfileState> {
	// 必须在第一次读取资料前记录 App.onLaunch 传入的实例；否则下面的
	// `getGlobalUserProfile()` 会在微信启动窗口内错误地再次调用 getApp()。
	if (app) globalData(app);
	const current = getGlobalUserProfile();
	if (
		current.status === "ready" &&
		current.ownerId &&
		isCurrentSessionGeneration(current.sessionGeneration)
	) {
		return Promise.resolve(current);
	}
	if (profileBootstrapInFlight) return profileBootstrapInFlight;
	const appBootstrap = globalData().userProfileBootstrapPromise;
	if (appBootstrap) {
		// App.onLaunch 已经启动了唯一初始化；页面模块只接管本地引用，
		// 不能再创建第二个 `/me` + `/me/profile` 请求链。
		profileBootstrapInFlight = appBootstrap;
		void appBootstrap.then(
			() => {
				if (profileBootstrapInFlight === appBootstrap) {
					profileBootstrapInFlight = null;
				}
			},
			() => {
				if (profileBootstrapInFlight === appBootstrap) {
					profileBootstrapInFlight = null;
				}
			},
		);
		return appBootstrap;
	}

	publishProfileState({ status: "loading", error: "" });
	const bootstrap = restorePlatformSession()
		.then((currentUser) => {
			const expectedOwnerId = currentUser.data.user.id;
			// `/me` 成功只证明了这一时刻的 owner；资料请求还会继续跨越
			// 异步边界，因此必须把成功验证时的会话代际固定下来。不能在
			// 后面用 `isCurrentSessionGeneration(getSessionGeneration())`
			// 进行自比较，那只会证明“当前值等于当前值”，无法发现同一
			// owner 的 token 轮换或其它会话边界变化。
			const expectedSessionGeneration = getSessionGeneration();
			// `/me` 已经证明了 owner；即使普通资料接口随后暂时不可用，
			// 页面仍可以继续读取就诊人目录，同时向资料区显示明确的重试状态。
			publishProfileState({
				status: "loading",
				ownerId: expectedOwnerId,
				sessionGeneration: expectedSessionGeneration,
			});
			return getUserProfile().then((response) =>
				getCurrentUser().then((verifiedUser) => {
					if (verifiedUser.data.user.id !== expectedOwnerId) {
						throw profileSessionChangedError();
					}
					if (!isCurrentSessionGeneration(expectedSessionGeneration)) {
						throw profileSessionChangedError();
					}
					// 必须返回已经写入 App.globalData 的冻结快照，而不是返回
					// 发布前的临时对象；否则调用方拿到的结果和订阅页面读到的
					// 全局对象字段相同但引用不同，破坏单一状态源的不变量。
					return publishProfileState(
						profileStateFromServer(expectedOwnerId, response.data),
					);
				}),
			);
		})
		.catch((error: unknown) => {
			const isSessionError =
				error instanceof ApiError &&
				(error.code === "unauthorized" || error.code === "session-changed");
			// 先保存失效前的 owner，再发布空快照。发布后 ownerId 会被清空，
			// 如果此时才读取，就无法删除旧账号的本机微信昵称/头像缓存。
			// 该缓存按 owner 隔离，但会长期保留旧账号隐私和过期头像，不能
			// 把“新账号不会直接读到”当作清理已经完成。
			const previousOwnerId = getGlobalUserProfile().ownerId;
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
			if (isSessionError && previousOwnerId) {
				clearStoredWechatUserProfile(previousOwnerId);
			}
			// 普通资料是个人中心的增强读模型，不应阻断已完成的微信会话和
			// 就诊人主流程；只有明确的会话失效才交给页面入口处理。
			if (!isSessionError) return nextState;
			throw error;
		});
	profileBootstrapInFlight = bootstrap;
	globalData().userProfileBootstrapPromise = bootstrap;
	void bootstrap.then(
		() => {
			if (profileBootstrapInFlight === bootstrap)
				profileBootstrapInFlight = null;
			if (globalData().userProfileBootstrapPromise === bootstrap) {
				globalData().userProfileBootstrapPromise = null;
			}
		},
		() => {
			if (profileBootstrapInFlight === bootstrap)
				profileBootstrapInFlight = null;
			if (globalData().userProfileBootstrapPromise === bootstrap) {
				globalData().userProfileBootstrapPromise = null;
			}
		},
	);
	return bootstrap;
}

/**
 * 页面只等待 App 启动已经建立的资料链，不主动创建网络请求。
 *
 * 页面首次创建、原生 Tab 切换和页面栈回显都使用这个入口；只有 App.onLaunch
 * 或用户明确点击“重试/下拉刷新”时才调用 `ensure/refresh`。这样“等待资料”和
 * “重新读取资料”在代码层有不同名字，避免以后又把页面生命周期误当成刷新命令。
 */
export function waitForGlobalUserProfile(): Promise<GlobalUserProfileState> {
	if (profileBootstrapInFlight) return profileBootstrapInFlight;
	const appBootstrap = globalData().userProfileBootstrapPromise;
	if (appBootstrap) return appBootstrap;

	const current = getGlobalUserProfile();
	if (current.status === "idle") {
		// 正常启动由 App.onLaunch 提前创建 bootstrap Promise；但开发者工具热
		// 重载、页面单独恢复或 App bundle 与页面 bundle 初始化交错时，页面
		// 可能先进入这里。如果 idle 状态只被当作“已完成等待”返回，首页和
		// 其它 Tab 会把尚未验证的账号误判成未登录，随后也不会自动补启动。
		// 这里仅在明确的 idle 初始态接管启动，并继续复用 ensure 内部的
		// 全局单飞；error 状态仍交给用户显式重试，避免故障时每次切 Tab
		// 都无提示地重复请求。
		return ensureGlobalUserProfile();
	}
	return Promise.resolve(current);
}

/** 强制重新读取当前 owner 的资料，供页面错误态的“重新加载”使用。 */
export function refreshGlobalUserProfile(): Promise<GlobalUserProfileState> {
	if (profileBootstrapInFlight) return profileBootstrapInFlight;
	const appBootstrap = globalData().userProfileBootstrapPromise;
	if (appBootstrap) {
		return appBootstrap;
	}
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
		!canAuthorizeWechatProfile(current) ||
		!current.ownerId ||
		!isCurrentSessionGeneration(current.sessionGeneration)
	) {
		throw profileSessionChangedError();
	}

	publishProfileState({
		wechatProfileState: "loading",
		wechatProfileHint: "正在获取头像和昵称...",
		// 普通资料读取失败只是可降级状态；授权过程中保留原错误，避免
		// 页面把“资料服务暂时不可用”误认为已经恢复。
		error: current.status === "error" ? current.error : "",
	});
	try {
		const wechatProfile = await requestWechatUserProfile();
		assertCurrentWechatProfileContext(
			current.ownerId,
			current.sessionGeneration,
		);
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
				// PUT 也跨越异步边界；即使 API 客户端没有观察到 token 变化，
				// 资料仓库被清理后也不能把旧响应提交回新的全局快照。
				assertCurrentWechatProfileContext(
					current.ownerId,
					current.sessionGeneration,
				);
				nextState = publishProfileState({
					status: "ready",
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
		// 微信授权弹窗可能在会话已经切换后才回调失败。此时当前全局状态
		// 已经属于新账号或已退出状态，不能把旧请求的“用户拒绝”写回去；
		// 否则新账号会看到旧账号的 declined 提示，甚至误以为仍可继续
		// 使用旧资料。这里同时校验代际、owner 和状态，覆盖真实运行时
		// 的 token 轮换以及测试/容器主动清理全局快照但尚未推进代际的情况。
		const latest = getGlobalUserProfile();
		if (
			!isCurrentSessionGeneration(current.sessionGeneration) ||
			latest.ownerId !== current.ownerId ||
			latest.sessionGeneration !== current.sessionGeneration ||
			(latest.status !== "ready" && latest.status !== "error")
		) {
			throw profileSessionChangedError();
		}
		// 普通资料 GET 暂时失败时，当前 owner 和会话代际仍然可能是有效的。
		// 此时微信授权被用户拒绝必须保留为 declined，让下一次用户点击进入
		// openSetting 重试链；不能因为资料接口故障把用户选择误报成会话变化。
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
			// 当前快照可能刚被其它 bundle 清空，也可能只是本次授权链收到
			// 会话变化错误；在清空 owner 之前保留并删除旧缓存，确保两条
			// 路径都不会留下旧账号的微信资料。
			const previousOwnerId = latest.ownerId;
			if (previousOwnerId) {
				clearStoredWechatUserProfile(previousOwnerId);
			}
			publishProfileState({
				status: "error",
				ownerId: "",
				sessionGeneration: -1,
				displayName: "微信用户",
				serverDisplayName: "微信用户",
				avatarUrl: "",
				wechatProfileState: "idle",
				wechatProfileHint: "登录状态需要重新确认，请稍后再试",
				error: "登录状态需要重新确认，请稍后再试",
			});
		}
		throw error;
	}
}

/**
 * 微信授权弹窗和普通资料 PUT 也必须单飞，避免多个页面同时发起两次授权或
 * 409。这里的 Promise 必须放在 App.globalData，而不是只放模块变量：App.js
 * 会被构建成 IIFE，页面脚本则由微信按 CommonJS 模块加载，两边可能各自拥有
 * 一份本文件实例。只用模块变量时，两个 bundle 会同时弹出授权并竞争同一份
 * 服务端资料版本，表现为授权闪动或偶发 409。
 */
export function authorizeGlobalWechatProfile(): Promise<GlobalUserProfileState> {
	const appData = globalData();
	if (appData.userProfileConsentPromise) {
		return appData.userProfileConsentPromise;
	}
	const promise = authorizeGlobalWechatProfileInternal();
	appData.userProfileConsentPromise = promise;
	void promise.then(
		() => {
			if (appData.userProfileConsentPromise === promise) {
				appData.userProfileConsentPromise = null;
			}
		},
		() => {
			if (appData.userProfileConsentPromise === promise) {
				appData.userProfileConsentPromise = null;
			}
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
	const appData = globalData();
	const previousOwnerId = appData.userProfile?.ownerId;
	// 全局快照清理和 owner 绑定的微信资料缓存必须是同一个会话边界。
	// 患者选择另有独立的 owner/会话代际门禁，不能在这里顺手删除；但
	// 昵称头像属于当前账号的本机隐私展示数据，账号失效后必须清掉。
	if (typeof previousOwnerId === "string" && previousOwnerId.trim()) {
		clearStoredWechatUserProfile(previousOwnerId);
	}
	appData.userProfileBootstrapPromise = null;
	appData.userProfileConsentPromise = null;
	publishProfileState({ ...EMPTY_PROFILE_STATE });
}
