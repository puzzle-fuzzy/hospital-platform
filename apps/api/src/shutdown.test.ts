import { expect, test } from "bun:test";
import {
	ShutdownDeadlineExceededError,
	withShutdownDeadline,
} from "./shutdown";

test("停机操作在 deadline 内完成时正常返回并清理计时器", async () => {
	await expect(withShutdownDeadline(async () => "stopped", 50)).resolves.toBe(
		"stopped",
	);
});

test("停机操作超过 deadline 时返回稳定超时错误", async () => {
	await expect(
		withShutdownDeadline(() => new Promise<never>(() => undefined), 5),
	).rejects.toBeInstanceOf(ShutdownDeadlineExceededError);
});

test("停机 deadline 拒绝零值和非整数配置", async () => {
	await expect(withShutdownDeadline(async () => undefined, 0)).rejects.toThrow(
		"Shutdown timeout must be a positive integer",
	);
	await expect(
		withShutdownDeadline(async () => undefined, 1.5),
	).rejects.toThrow("Shutdown timeout must be a positive integer");
});
