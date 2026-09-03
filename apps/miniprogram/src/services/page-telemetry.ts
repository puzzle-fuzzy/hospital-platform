/**
 * 页面级遥测安装器：一次性包装微信 `Page` 构造器与导航 API。
 *
 * 旧端维护时"用户点了什么"只能靠猜，因为每个页面各自写日志必然有遗漏。
 * 所有用户交互最终都会调用页面方法（WXML 的 bind/catch 直接指向页面
 * 方法名），所以在 `Page()` 注册处统一包装，比逐页面打点更完整，也避免
 * 新页面忘记接日志。
 *
 * 包装必须对页面完全透明：保持 `this`、参数、同步返回值和异常语义不变；
 * 异步 Promise 只旁路记录拒绝结果，不吞掉原始 rejection。遥测自身的
 * 任何失败都静默降级，不影响页面注册和交互。
 *
 * App 入口（app.ts 的 IIFE bundle）在任何页面模块加载前调用本函数；
 * `Page`/`wx` 是微信运行时注入的全局对象，跨 bundle 共享，因此这里的
 * 包装对后续加载的所有页面模块生效。
 */

import {
	logClientNavigation,
	logClientPageAction,
	logClientPageFailure,
	logClientPageLifecycle,
} from "./telemetry";

/**
 * 结构型生命周期：页面进出、滚动位置和主题变化等运行时事件。
 * `onTabItemTap`、`onPullDownRefresh`、`onReachBottom`、`onShareAppMessage`
 * 是用户手势，按 page.action 记录，便于和普通点击使用同一条检索语句。
 */
const PAGE_LIFECYCLE_METHODS = new Set([
	"onLoad",
	"onShow",
	"onReady",
	"onHide",
	"onUnload",
	"onError",
	"onPageScroll",
	"onResize",
	"onThemeChange",
]);

const NAVIGATION_METHOD_NAMES = [
	"navigateTo",
	"redirectTo",
	"switchTab",
	"reLaunch",
	"navigateBack",
] as const;

const PAGE_TELEMETRY_INSTALLED_KEY = "__hospitalPageTelemetryInstalled";

type PageConstructorLike = (config: unknown) => void;

type PageInstanceLike = {
	route?: unknown;
	is?: unknown;
};

function readPageRoute(pageInstance: unknown): string | undefined {
	if (typeof pageInstance !== "object" || pageInstance === null)
		return undefined;
	const instance = pageInstance as PageInstanceLike;
	if (typeof instance.route === "string" && instance.route.length > 0) {
		return instance.route;
	}
	if (typeof instance.is === "string" && instance.is.length > 0) {
		return instance.is;
	}
	return undefined;
}

function isThenable(value: unknown): value is Promise<unknown> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

function wrapPageMethod(
	name: string,
	original: (this: unknown, ...args: unknown[]) => unknown,
): (this: unknown, ...args: unknown[]) => unknown {
	const isLifecycle = PAGE_LIFECYCLE_METHODS.has(name);
	return function pageTelemetryWrapper(
		this: unknown,
		...args: unknown[]
	): unknown {
		const route = readPageRoute(this);
		// 先记录再执行：即使方法抛错或超时，"用户触发过这个操作"的事实
		// 已经落进事件流。
		if (isLifecycle) {
			logClientPageLifecycle(route, name);
		} else {
			logClientPageAction(route, name, args[0]);
		}
		const kind = isLifecycle ? "page.lifecycle" : "page.action";
		let result: unknown;
		try {
			result = original.apply(this, args);
		} catch (error) {
			logClientPageFailure(kind, route, name, error);
			throw error;
		}
		if (isThenable(result)) {
			// 只旁路记录异步拒绝；返回的仍是页面拿到的原 Promise，调用方
			// 的 then/catch 链不受影响。
			Promise.resolve(result).catch((error: unknown) => {
				logClientPageFailure(kind, route, name, error);
			});
		}
		return result;
	};
}

function wrapPageConfig<TConfig>(config: TConfig): TConfig {
	if (typeof config !== "object" || config === null) return config;
	const source = config as Record<string, unknown>;
	const wrapped: Record<string, unknown> = {};
	for (const key of Object.keys(source)) {
		const value = source[key];
		wrapped[key] =
			typeof value === "function"
				? wrapPageMethod(
						key,
						value as (this: unknown, ...args: unknown[]) => unknown,
					)
				: value;
	}
	return wrapped as TConfig;
}

type NavigationOptions = {
	url?: unknown;
	fail?: unknown;
};

function wrapNavigationFailCallback(options: unknown, action: string): unknown {
	if (typeof options !== "object" || options === null) return options;
	const source = options as NavigationOptions;
	if (typeof source.fail !== "function") return options;
	const originalFail = source.fail as (error: unknown) => void;
	return {
		...source,
		fail: (error: unknown): void => {
			logClientNavigation(
				action,
				source.url,
				"failed",
				navigationErrorName(error),
			);
			originalFail(error);
		},
	};
}

function navigationErrorName(error: unknown): string {
	if (typeof error === "object" && error !== null) {
		const message = (error as { errMsg?: unknown }).errMsg;
		if (typeof message === "string" && message.length > 0) {
			return message.split(":", 1)[0] || "NavigationError";
		}
	}
	return "NavigationError";
}

function installNavigationTelemetry(): void {
	if (typeof wx === "undefined") return;
	const wxHolder = wx as unknown as Record<string, unknown>;
	for (const action of NAVIGATION_METHOD_NAMES) {
		const original = wxHolder[action];
		if (typeof original !== "function") continue;
		const wrapped = (options: unknown): unknown => {
			const url =
				typeof options === "object" && options !== null
					? (options as NavigationOptions).url
					: undefined;
			logClientNavigation(action, url);
			const enhanced = wrapNavigationFailCallback(options, action);
			return (original as (this: unknown, ...args: unknown[]) => unknown).apply(
				wx,
				[enhanced],
			);
		};
		try {
			wxHolder[action] = wrapped;
		} catch {
			// wx 实现只读时放弃该 API 的导航观测；页面导航本身不受影响。
		}
	}
}

/**
 * 安装页面与导航遥测。必须在第一个页面模块加载前调用（app.ts 模块顶层
 * 即可）。重复调用、`Page` 不可用（单元测试环境）或全局对象只读时静默
 * 降级，绝不影响小程序启动。
 */
export function installClientPageTelemetry(): void {
	const holder = globalThis as typeof globalThis & {
		[PAGE_TELEMETRY_INSTALLED_KEY]?: boolean;
		Page?: unknown;
	};
	if (holder[PAGE_TELEMETRY_INSTALLED_KEY]) return;
	const originalPage = holder.Page;
	if (typeof originalPage !== "function") return;

	try {
		holder.Page = ((config: unknown): void => {
			(originalPage as PageConstructorLike)(wrapPageConfig(config));
		}) as unknown as typeof Page;
		holder[PAGE_TELEMETRY_INSTALLED_KEY] = true;
	} catch {
		// 运行时禁止改写 Page 时保持未安装状态；不阻断小程序启动。
		return;
	}

	try {
		installNavigationTelemetry();
	} catch {
		// 导航观测是可选增强；失败不回滚 Page 包装。
	}
}

/** 测试专用：还原安装标记与已包装的全局，便于用例之间隔离。 */
export function resetClientPageTelemetryForTests(
	originalPage: unknown,
	originalNavigation: Record<string, unknown> = {},
): void {
	const holder = globalThis as typeof globalThis & {
		[PAGE_TELEMETRY_INSTALLED_KEY]?: boolean;
		Page?: unknown;
	};
	holder[PAGE_TELEMETRY_INSTALLED_KEY] = false;
	if (originalPage !== undefined) {
		holder.Page = originalPage;
	}
	if (typeof wx !== "undefined") {
		const wxHolder = wx as unknown as Record<string, unknown>;
		for (const [name, value] of Object.entries(originalNavigation)) {
			wxHolder[name] = value;
		}
	}
}
