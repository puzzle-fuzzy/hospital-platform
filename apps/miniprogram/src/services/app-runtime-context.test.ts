import { afterEach, expect, test } from "bun:test";
import {
	getRegisteredApp,
	type MiniProgramAppContainer,
	registerBootstrapApp,
} from "./app-runtime-context";

type TestGlobal = typeof globalThis & {
	getApp?: () => unknown;
};

const testGlobal = globalThis as TestGlobal;
const originalGetApp = testGlobal.getApp;

afterEach(() => {
	// 测试不能把 Bun 中的微信 App 替身留给其它用例，否则会把“启动阶段
	// getApp 尚未可用”的边界污染成页面运行阶段的假环境。
	if (originalGetApp) {
		testGlobal.getApp = originalGetApp;
	} else {
		delete testGlobal.getApp;
	}
});

test("App 启动阶段 getApp 不可用时仍能读取显式启动容器", () => {
	delete testGlobal.getApp;
	const globalData = { accessToken: "" };
	const bootstrapApp: MiniProgramAppContainer = { globalData };

	registerBootstrapApp(bootstrapApp);

	// 这是 app.ts 先于 App() 登记容器时的真实时序：不能因为 getApp()
	// 暂时不存在，就让全局资料初始化访问 undefined.globalData。
	expect(getRegisteredApp()).toBe(bootstrapApp);
});

test("页面运行阶段优先使用微信返回的完整 App 实例", () => {
	const bootstrapApp: MiniProgramAppContainer = {
		globalData: { accessToken: "bootstrap" },
	};
	const runtimeApp: MiniProgramAppContainer = {
		globalData: { accessToken: "runtime" },
	};
	registerBootstrapApp(bootstrapApp);
	testGlobal.getApp = () => runtimeApp;

	// 页面 CommonJS bundle 进入正常生命周期后，微信实例是权威状态源；
	// 启动容器只负责覆盖 App 尚未注册的短窗口。
	expect(getRegisteredApp()).toBe(runtimeApp);
});

test("不完整的微信 App 实例不会覆盖有效的启动容器", () => {
	const bootstrapApp: MiniProgramAppContainer = {
		globalData: { accessToken: "bootstrap" },
	};
	registerBootstrapApp(bootstrapApp);
	testGlobal.getApp = () => ({});

	// 开发者工具热重载期间可能短暂返回空对象；此时必须回退到同一份
	// globalData，而不是继续解引用不完整实例。
	expect(getRegisteredApp()).toBe(bootstrapApp);
});

test("getApp 返回 undefined 时仍回退到启动容器", () => {
	const bootstrapApp: MiniProgramAppContainer = {
		globalData: { accessToken: "bootstrap-undefined-app" },
	};
	registerBootstrapApp(bootstrapApp);
	testGlobal.getApp = () => undefined;

	// 某些启动窗口中 getApp() 不是抛错，而是直接返回 undefined；这和
	// `getApp().globalData` 一样危险，必须在上下文桥内统一变成安全回退。
	expect(getRegisteredApp()).toBe(bootstrapApp);
});
