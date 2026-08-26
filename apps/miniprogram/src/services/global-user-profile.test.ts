import { afterEach, describe, expect, test } from "bun:test";
import type { GlobalUserProfileState } from "./global-user-profile";
import {
	authorizeGlobalWechatProfile,
	clearGlobalUserProfile,
	ensureGlobalUserProfile,
	getGlobalUserProfile,
	subscribeGlobalUserProfile,
	waitForGlobalUserProfile,
} from "./global-user-profile";
import { notifySessionChanged } from "./session-events";
import {
	advanceSessionGeneration,
	getSessionGeneration,
} from "./session-generation";

describe("App 全局个人资料仓库", () => {
	const runtime = globalThis as typeof globalThis & {
		getApp?: () => unknown;
		wx?: typeof wx;
	};
	const originalGetApp = runtime.getApp;
	const originalWx = runtime.wx;

	afterEach(() => {
		if (originalGetApp) runtime.getApp = originalGetApp;
		else delete runtime.getApp;
		if (originalWx) runtime.wx = originalWx;
		else delete runtime.wx;
	});

	test("微信资料授权在 App 内单飞并同步给订阅页面", async () => {
		const storage = new Map<string, unknown>();
		let updateRequestCount = 0;
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "global-profile-test-token",
			sessionStatus: "signed_in",
			userProfileConsentPromise: null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "ready" as const,
				ownerId: "owner-global-profile-test",
				sessionGeneration: getSessionGeneration(),
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getStorageSync: (key: string) => storage.get(key),
			setStorageSync: (key: string, value: unknown) => storage.set(key, value),
			removeStorageSync: (key: string) => storage.delete(key),
			getUserProfile: (options: WechatMiniprogram.GetUserProfileOption) => {
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				success?.({
					userInfo: {
						nickName: "测试昵称",
						avatarUrl: "https://wx.qlogo.cn/test-avatar/132",
						gender: 1,
						city: "",
						country: "",
						language: "zh_CN",
						province: "",
					},
				});
			},
			request: (options: WechatMiniprogram.RequestOption) => {
				updateRequestCount += 1;
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				success?.({
					statusCode: 200,
					data: {
						success: true,
						data: {
							displayName: "测试昵称",
							gender: "male",
							age: null,
							email: null,
							version: 1,
						},
					},
					header: {},
				} as unknown);
			},
		} as unknown as typeof wx;

		const observedStates: Array<string> = [];
		const unsubscribe = subscribeGlobalUserProfile((state) => {
			observedStates.push(`${state.wechatProfileState}:${state.displayName}`);
		});
		const first = authorizeGlobalWechatProfile();
		const second = authorizeGlobalWechatProfile();
		expect(first).toBe(second);
		// 授权中的 Promise 必须进入 globalData，页面 CommonJS bundle 才能和
		// App IIFE bundle 共享同一个锁；模块变量单飞只能覆盖单个 bundle。
		expect(globalData.userProfileConsentPromise).toBe(first);
		const state = await first;
		unsubscribe();

		expect(state.displayName).toBe("测试昵称");
		expect(state.avatarUrl).toBe("https://wx.qlogo.cn/test-avatar/132");
		expect(state.wechatProfileState).toBe("ready");
		expect(updateRequestCount).toBe(1);
		expect(observedStates).toContain("loading:微信用户");
		expect(observedStates.at(-1)).toBe("ready:测试昵称");
		expect(
			storage.get("wechat-user-profile:owner-global-profile-test"),
		).toEqual({
			ownerId: "owner-global-profile-test",
			nickName: "测试昵称",
			avatarUrl: "https://wx.qlogo.cn/test-avatar/132",
			gender: "male",
		});

		expect(getGlobalUserProfile().displayName).toBe("测试昵称");
		expect(globalData.userProfileConsentPromise).toBeNull();
	});

	test("多个主 Tab 启动时只读取一次服务端资料并复用全局快照", async () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "bootstrap-session-token",
			sessionStatus: "signed_in" as const,
			userProfile: {
				status: "idle" as const,
				ownerId: "",
				sessionGeneration: -1,
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		let currentUserRequestCount = 0;
		let profileRequestCount = 0;
		runtime.wx = {
			getStorageSync: (key: string) =>
				key === "access_token" ? "bootstrap-session-token" : undefined,
			setStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			request: (options: WechatMiniprogram.RequestOption) => {
				const isProfileRequest = options.url.endsWith("/me/profile");
				if (isProfileRequest) profileRequestCount += 1;
				else if (options.url.endsWith("/me")) currentUserRequestCount += 1;
				setTimeout(() => {
					const success = options.success as
						| ((result: unknown) => void)
						| undefined;
					success?.({
						statusCode: 200,
						data: isProfileRequest
							? {
									success: true,
									data: {
										displayName: "服务端昵称",
										gender: "female",
										age: 32,
										email: "profile@example.test",
										version: 3,
									},
								}
							: {
									success: true,
									data: { user: { id: "owner-bootstrap-test" } },
								},
					} as unknown);
				}, 5);
			},
		} as unknown as typeof wx;

		// 首页、我的页或资料页可能在首帧同时触发；这里必须复用同一个
		// Promise，而不是仅仅依赖“最后结果相同”来掩盖重复请求。
		const first = ensureGlobalUserProfile();
		const second = ensureGlobalUserProfile();
		expect(first).toBe(second);
		const firstState = await first;
		const thirdState = await ensureGlobalUserProfile();

		expect(firstState.status).toBe("ready");
		expect(firstState.ownerId).toBe("owner-bootstrap-test");
		expect(firstState.displayName).toBe("服务端昵称");
		expect(firstState.email).toBe("profile@example.test");
		expect(thirdState).toBe(firstState);
		expect(currentUserRequestCount).toBe(2);
		expect(profileRequestCount).toBe(1);
	});

	test("页面先于 App 启动时，idle 状态会接管同一条全局初始化链", async () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "page-first-session-token",
			sessionStatus: "signed_in" as const,
			userProfileBootstrapPromise:
				null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "idle" as const,
				ownerId: "",
				sessionGeneration: -1,
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		let currentUserRequestCount = 0;
		let profileRequestCount = 0;
		runtime.wx = {
			getStorageSync: (key: string) =>
				key === "access_token" ? "page-first-session-token" : undefined,
			setStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			request: (options: WechatMiniprogram.RequestOption) => {
				const isProfileRequest = options.url.endsWith("/me/profile");
				if (isProfileRequest) profileRequestCount += 1;
				else if (options.url.endsWith("/me")) currentUserRequestCount += 1;
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				success?.({
					statusCode: 200,
					data: isProfileRequest
						? {
								success: true,
								data: {
									displayName: "页面先行昵称",
									gender: "unknown",
									age: null,
									email: null,
									version: 0,
								},
							}
						: {
								success: true,
								data: { user: { id: "owner-page-first-test" } },
							},
				} as unknown);
			},
		} as unknown as typeof wx;

		const state = await waitForGlobalUserProfile();

		expect(state.status).toBe("ready");
		expect(state.ownerId).toBe("owner-page-first-test");
		expect(state.displayName).toBe("页面先行昵称");
		expect(currentUserRequestCount).toBe(2);
		expect(profileRequestCount).toBe(1);
		expect(globalData.userProfileBootstrapPromise).toBeNull();
	});

	test("资料初始化错误不会在切换页面时静默重试", async () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "profile-error-session-token",
			sessionStatus: "signed_in" as const,
			userProfileBootstrapPromise:
				null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "error" as const,
				ownerId: "owner-profile-error-test",
				sessionGeneration: getSessionGeneration(),
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "个人资料暂不可用，点击重新加载",
				error: "依赖暂时不可用",
			},
		};
		runtime.getApp = () => ({ globalData });
		let requestCount = 0;
		runtime.wx = {
			getStorageSync: () => "profile-error-session-token",
			request: () => {
				requestCount += 1;
			},
		} as unknown as typeof wx;

		const state = await waitForGlobalUserProfile();

		expect(state).toBe(globalData.userProfile);
		expect(requestCount).toBe(0);
	});

	test("普通资料暂时失败时仍允许当前 owner 主动授权微信资料", async () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "profile-error-consent-token",
			sessionStatus: "signed_in" as const,
			userProfileConsentPromise: null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "error" as const,
				ownerId: "owner-profile-error-consent-test",
				sessionGeneration: getSessionGeneration(),
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "普通资料暂不可用",
				error: "依赖暂时不可用",
			},
		};
		runtime.getApp = () => ({ globalData });
		let updateRequestCount = 0;
		runtime.wx = {
			getStorageSync: () => undefined,
			setStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			getUserProfile: (options: WechatMiniprogram.GetUserProfileOption) => {
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				success?.({
					userInfo: {
						nickName: "资料故障时昵称",
						avatarUrl: "https://wx.qlogo.cn/profile-error-consent/132",
						gender: 1,
						city: "",
						country: "",
						language: "zh_CN",
						province: "",
					},
				});
			},
			request: (options: WechatMiniprogram.RequestOption) => {
				if (options.url.endsWith("/me/profile")) updateRequestCount += 1;
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				success?.({
					statusCode: 200,
					data: {
						success: true,
						data: {
							displayName: "资料故障时昵称",
							gender: "male",
							age: null,
							email: null,
							version: 1,
						},
					},
					header: {},
				} as unknown);
			},
		} as unknown as typeof wx;

		const state = await authorizeGlobalWechatProfile();

		// `/me` 已确认 owner 后，普通资料 GET 的暂时失败不应吞掉用户的
		// 明确授权手势；PUT 成功后全局状态也必须恢复为可用，而不是长期停留 error。
		expect(state.status).toBe("ready");
		expect(state.displayName).toBe("资料故障时昵称");
		expect(state.avatarUrl).toBe(
			"https://wx.qlogo.cn/profile-error-consent/132",
		);
		expect(state.wechatProfileState).toBe("ready");
		expect(state.version).toBe(1);
		expect(updateRequestCount).toBe(1);
	});

	test("普通资料失败时用户拒绝微信授权仍保留可重试的拒绝状态", async () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "profile-error-denied-token",
			sessionStatus: "signed_in" as const,
			userProfileConsentPromise: null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "error" as const,
				ownerId: "owner-profile-error-denied-test",
				sessionGeneration: getSessionGeneration(),
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "普通资料暂不可用",
				error: "依赖暂时不可用",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getStorageSync: () => undefined,
			getUserProfile: (options: WechatMiniprogram.GetUserProfileOption) => {
				(options.fail as (() => void) | undefined)?.();
			},
		} as unknown as typeof wx;

		await expect(authorizeGlobalWechatProfile()).rejects.toMatchObject({
			name: "WechatUserProfileAuthorizationError",
		});
		expect(getGlobalUserProfile()).toMatchObject({
			status: "error",
			wechatProfileState: "declined",
			wechatProfileHint: "未授权，可点击此处重新获取",
		});
	});

	test("资料读取期间会话代际变化时，旧资料不能回写", async () => {
		let releaseProfile: ((result: unknown) => void) | undefined;
		const generation = getSessionGeneration();
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "rotating-session-token",
			sessionStatus: "signed_in" as const,
			userProfileBootstrapPromise:
				null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "idle" as const,
				ownerId: "",
				sessionGeneration: -1,
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getStorageSync: () => "rotating-session-token",
			setStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			request: (options: WechatMiniprogram.RequestOption) => {
				const success = options.success as
					| ((result: unknown) => void)
					| undefined;
				if (options.url.endsWith("/me/profile")) {
					releaseProfile = success;
					return;
				}
				success?.({
					statusCode: 200,
					data: {
						success: true,
						data: { user: { id: "owner-rotation-test" } },
					},
				} as unknown);
			},
		} as unknown as typeof wx;

		const bootstrap = ensureGlobalUserProfile();
		expect(getSessionGeneration()).toBe(generation);
		advanceSessionGeneration();
		notifySessionChanged();
		releaseProfile?.({
			statusCode: 200,
			data: {
				success: true,
				data: {
					displayName: "旧会话昵称",
					gender: "unknown",
					age: null,
					email: null,
					version: 0,
				},
			},
		} as unknown);

		await expect(bootstrap).rejects.toMatchObject({ code: "session-changed" });
		expect(getGlobalUserProfile().ownerId).toBe("");
		expect(getGlobalUserProfile().displayName).toBe("微信用户");
	});

	test("会话凭证变化会清理旧账号的全局昵称和头像", () => {
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "old-account-token",
			sessionStatus: "signed_in" as const,
			sessionGeneration: getSessionGeneration(),
			userProfile: {
				status: "ready" as const,
				ownerId: "owner-old-account",
				sessionGeneration: getSessionGeneration(),
				serverDisplayName: "旧账号昵称",
				displayName: "旧账号昵称",
				gender: "female" as const,
				age: 32,
				email: "old@example.test",
				version: 4,
				avatarUrl: "https://wx.qlogo.cn/old-avatar/132",
				wechatProfileState: "ready" as const,
				wechatProfileHint: "已授权头像和昵称",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getStorageSync: () => "old-account-token",
			removeStorageSync: () => undefined,
			setStorageSync: () => undefined,
		} as unknown as typeof wx;

		const observedStates: Array<string> = [];
		const unsubscribe = subscribeGlobalUserProfile((state) => {
			observedStates.push(`${state.status}:${state.displayName}`);
		});
		notifySessionChanged();
		unsubscribe();

		const state = getGlobalUserProfile();
		expect(state.status).toBe("idle");
		expect(state.ownerId).toBe("");
		expect(state.displayName).toBe("微信用户");
		expect(state.avatarUrl).toBe("");
		expect(observedStates.at(-1)).toBe("idle:微信用户");
	});

	test("旧授权回调不能把新会话污染成授权拒绝", async () => {
		let rejectWechatProfile: (() => void) | undefined;
		const generation = getSessionGeneration();
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "old-account-token",
			sessionStatus: "signed_in" as const,
			sessionGeneration: generation,
			userProfile: {
				status: "ready" as const,
				ownerId: "owner-stale-consent-test",
				sessionGeneration: generation,
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getUserProfile: (options: WechatMiniprogram.GetUserProfileOption) => {
				rejectWechatProfile = options.fail as () => void;
			},
			getStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			setStorageSync: () => undefined,
		} as unknown as typeof wx;

		const pendingAuthorization = authorizeGlobalWechatProfile();
		// 模拟 API 客户端完成 token 轮换：先推进共享代际，再通知资料仓库
		// 清理旧快照。旧微信弹窗稍后才失败，不能覆盖这次清理结果。
		advanceSessionGeneration();
		notifySessionChanged();
		rejectWechatProfile?.();

		await expect(pendingAuthorization).rejects.toMatchObject({
			code: "session-changed",
		});
		const state = getGlobalUserProfile();
		expect(state.status).toBe("idle");
		expect(state.ownerId).toBe("");
		expect(state.wechatProfileState).toBe("idle");
		expect(state.wechatProfileHint).toBe("");
	});

	test("资料快照被清理但代际尚未推进时，旧授权成功回调也不能回写", async () => {
		let resolveWechatProfile: ((result: unknown) => void) | undefined;
		let updateRequestCount = 0;
		const generation = getSessionGeneration();
		const globalData = {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "stale-consent-success-token",
			sessionStatus: "signed_in" as const,
			userProfileConsentPromise: null as Promise<GlobalUserProfileState> | null,
			userProfile: {
				status: "ready" as const,
				ownerId: "owner-stale-consent-success-test",
				sessionGeneration: generation,
				serverDisplayName: "微信用户",
				displayName: "微信用户",
				gender: "unknown" as const,
				age: null,
				email: null,
				version: 0,
				avatarUrl: "",
				wechatProfileState: "idle" as const,
				wechatProfileHint: "",
				error: "",
			},
		};
		runtime.getApp = () => ({ globalData });
		runtime.wx = {
			getUserProfile: (options: WechatMiniprogram.GetUserProfileOption) => {
				resolveWechatProfile = options.success as
					| ((result: unknown) => void)
					| undefined;
			},
			getStorageSync: () => undefined,
			setStorageSync: () => undefined,
			removeStorageSync: () => undefined,
			request: () => {
				updateRequestCount += 1;
			},
		} as unknown as typeof wx;

		const pendingAuthorization = authorizeGlobalWechatProfile();
		// 模拟资料仓库先于会话代际推进被清理；真实运行中这可能发生在
		// 退出、重新登录或另一个 bundle 收到会话失效事件的交界处。
		clearGlobalUserProfile();
		resolveWechatProfile?.({
			userInfo: {
				nickName: "旧回调昵称",
				avatarUrl: "https://wx.qlogo.cn/stale-consent-success/132",
				gender: 1,
				city: "",
				country: "",
				language: "zh_CN",
				province: "",
			},
		});

		await expect(pendingAuthorization).rejects.toMatchObject({
			code: "session-changed",
		});
		const state = getGlobalUserProfile();
		expect(state.status).toBe("idle");
		expect(state.ownerId).toBe("");
		expect(state.displayName).toBe("微信用户");
		expect(state.avatarUrl).toBe("");
		expect(updateRequestCount).toBe(0);
	});
});
