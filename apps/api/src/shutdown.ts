/**
 * 给 API 停机钩子设置明确的服务端 deadline。
 *
 * Elysia 的 `app.stop()` 会等待 onStop 里的 MySQL/Redis 连接回收；如果底层连接
 * 永远不结束，systemd 只能等到自己的硬超时再 SIGKILL，导致发布切换出现不必要的
 * 长空窗。这里的 timeout 只负责通知调用方超时，不能取消原操作；入口在记录低敏
 * 失败日志后会主动结束进程，避免让 systemd 再次等待同一份悬挂连接。
 */
export class ShutdownDeadlineExceededError extends Error {
	readonly timeoutMs: number;

	constructor(timeoutMs: number) {
		super(`API shutdown exceeded ${timeoutMs}ms`);
		this.name = "ShutdownDeadlineExceededError";
		this.timeoutMs = timeoutMs;
	}
}

/**
 * 在有限时间内等待一个不可取消的停机操作。
 * timeout 必须是正整数，避免把配置错误解释成“立即成功停机”。
 */
export async function withShutdownDeadline<T>(
	operation: () => Promise<T>,
	timeoutMs: number,
): Promise<T> {
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error("Shutdown timeout must be a positive integer");
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new ShutdownDeadlineExceededError(timeoutMs)),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
