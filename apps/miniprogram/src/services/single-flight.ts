/**
 * 同一业务操作的单飞执行器。
 *
 * 小程序生命周期回调、下拉刷新和重复点击可能同时触发同一个异步操作。
 * 单飞执行器在操作完成或失败后都会释放引用，下一次调用才会重新执行。
 * 这只是当前小程序进程内的并发优化；跨页面、跨进程和重启后的幂等仍必须
 * 由服务端的 owner、幂等键和持久化状态机保证。
 */
export type SingleFlight<T> = {
	/** 等待中的操作直接复用；没有等待操作时才调用 factory。 */
	run(factory: () => Promise<T>): Promise<T>;
	/** 仅用于页面状态或测试观察当前是否有操作在途。 */
	isRunning(): boolean;
};

export function createSingleFlight<T>(): SingleFlight<T> {
	let inFlight: Promise<T> | undefined;

	return {
		run(factory): Promise<T> {
			if (inFlight) return inFlight;

			// 通过微任务调用 factory，既能把同步异常转成 rejected Promise，
			// 也能保证同一调用栈内的第二次 run 已经看到 inFlight。
			const request = Promise.resolve().then(factory);
			inFlight = request;
			void request.then(
				() => {
					if (inFlight === request) inFlight = undefined;
				},
				() => {
					if (inFlight === request) inFlight = undefined;
				},
			);
			return request;
		},
		isRunning(): boolean {
			return inFlight !== undefined;
		},
	};
}
