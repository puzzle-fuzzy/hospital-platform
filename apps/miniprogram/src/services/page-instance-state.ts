import {
	createLatestRequestGuard,
	type LatestRequestGuard,
} from "./latest-request-guard";
import { createSingleFlight, type SingleFlight } from "./single-flight";

/**
 * 页面实例级异步状态的统一存储。
 *
 * 微信小程序的页面脚本模块只初始化一次，但同一路径可以在页面栈中
 * 同时存在多个实例。把 guard 或 single-flight 直接放在模块顶层，会让
 * 一个页面实例的刷新淘汰另一个实例的请求，或者让不同实例错误共享
 * 患者同步 Promise。WeakMap 以页面对象为 owner，既隔离实例，也不会
 * 因为页面销毁而长期持有页面状态。
 */
const pageState = new WeakMap<object, Map<string, unknown>>();

function getOrCreate<T>(page: object, key: string, factory: () => T): T {
	let state = pageState.get(page);
	if (!state) {
		state = new Map<string, unknown>();
		pageState.set(page, state);
	}

	const existing = state.get(key);
	if (existing !== undefined) return existing as T;

	const created = factory();
	state.set(key, created);
	return created;
}

/**
 * 页面实例的生命周期状态。
 *
 * 微信小程序的异步请求不会因为页面 `onUnload` 自动停止；页面卸载后，
 * Promise 仍可能完成。所有使用页面请求守卫的回调都通过这里确认页面仍然
 * 存活，避免已销毁实例继续 `setData`。
 */
export type PageInstanceLifecycle = {
	isActive(): boolean;
	dispose(): void;
};

/** 获取当前页面实例的生命周期控制器；同一实例始终复用同一个对象。 */
export function getPageLifecycle(page: object): PageInstanceLifecycle {
	return getOrCreate(page, "lifecycle", () => {
		let active = true;
		return {
			isActive(): boolean {
				return active;
			},
			dispose(): void {
				active = false;
			},
		};
	});
}

/** 在页面 `onUnload` 中标记实例失效，使所有已有请求失去回写资格。 */
export function disposePageInstance(page: object): void {
	getPageLifecycle(page).dispose();
}

/** 获取当前页面实例专属的最后一次请求守卫。 */
export function getPageLatestRequestGuard(
	page: object,
	key: string,
): LatestRequestGuard {
	return getOrCreate(page, `guard:${key}`, () => {
		const guard = createLatestRequestGuard();
		const lifecycle = getPageLifecycle(page);
		return {
			begin: () => guard.begin(),
			isCurrent: (token: number) =>
				lifecycle.isActive() && guard.isCurrent(token),
		};
	});
}

/** 获取当前页面实例专属的单飞执行器。 */
export function getPageSingleFlight<T>(
	page: object,
	key: string,
): SingleFlight<T> {
	return getOrCreate(page, `single-flight:${key}`, createSingleFlight<T>);
}
