import { expect, test } from "bun:test";
import { adapterContextTraceId, normalizeAdapterCallContext } from "./ports";

function createSignal(): AbortSignal {
	return {
		aborted: false,
		addEventListener() {},
		removeEventListener() {},
	} as unknown as AbortSignal;
}

test("adapter 调用上下文通过固定字段和可选 signal 的运行时校验", () => {
	const signal = createSignal();
	const normalized = normalizeAdapterCallContext({
		traceId: "trace-001",
		idempotencyKey: "key-001",
		signal,
		timeoutMs: 1500,
	});

	expect(normalized).toEqual({
		traceId: "trace-001",
		idempotencyKey: "key-001",
		signal,
		timeoutMs: 1500,
	});
});

test("adapter 调用上下文拒绝缺失标识、未知字段和非法可选值", () => {
	const valid = { traceId: "trace-001", idempotencyKey: "key-001" };

	for (const value of [
		null,
		[],
		{ idempotencyKey: valid.idempotencyKey },
		{ traceId: valid.traceId },
		{ ...valid, traceId: "trace-001\n" },
		{ ...valid, extra: true },
		{ ...valid, timeoutMs: 0 },
		{ ...valid, timeoutMs: Number.POSITIVE_INFINITY },
		{ ...valid, signal: { aborted: false } },
	]) {
		expect(normalizeAdapterCallContext(value)).toBeUndefined();
	}
});

test("损坏上下文只能产生安全 trace 投影", () => {
	expect(adapterContextTraceId(null)).toBe("invalid");
	expect(adapterContextTraceId({ traceId: "trace-safe" })).toBe("trace-safe");
	expect(adapterContextTraceId({ traceId: "trace-safe\n" })).toBe("invalid");
	expect(
		adapterContextTraceId({
			get traceId(): string {
				throw new Error("broken trace getter");
			},
		}),
	).toBe("invalid");
});

test("上下文校验器不会让损坏 getter 覆盖原始输入错误", () => {
	const brokenContext = {
		traceId: "trace-safe",
		idempotencyKey: "key-safe",
		get timeoutMs(): number {
			throw new Error("broken timeout getter");
		},
	};

	expect(normalizeAdapterCallContext(brokenContext)).toBeUndefined();
});
