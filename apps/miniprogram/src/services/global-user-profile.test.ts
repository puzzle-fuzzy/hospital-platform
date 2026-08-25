import { afterEach, describe, expect, test } from "bun:test";
import {
	authorizeGlobalWechatProfile,
	ensureGlobalUserProfile,
	getGlobalUserProfile,
	subscribeGlobalUserProfile,
} from "./global-user-profile";
import type { GlobalUserProfileState } from "./global-user-profile";
import { notifySessionChanged } from "./session-events";
import { getSessionGeneration } from "./session-generation";

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
});
