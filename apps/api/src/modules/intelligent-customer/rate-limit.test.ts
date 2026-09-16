import { expect, test } from "bun:test";
import {
	InMemoryIntelligentCustomerRateLimiter,
	IntelligentCustomerRateLimitError,
} from "./rate-limit";

test("客服限流按 owner 计数，并在窗口后恢复", () => {
	let now = 1_000;
	const limiter = new InMemoryIntelligentCustomerRateLimiter({
		maxRequests: 2,
		windowMs: 10_000,
		now: () => now,
	});

	limiter.consume("owner-a");
	limiter.consume("owner-a");
	limiter.consume("owner-b");

	expect(() => limiter.consume("owner-a")).toThrow(
		IntelligentCustomerRateLimitError,
	);
	try {
		limiter.consume("owner-a");
	} catch (error) {
		expect(error).toMatchObject({
			code: "intelligent-customer-rate-limited",
			retryAfterSeconds: 10,
		});
	}

	now += 10_000;
	limiter.consume("owner-a");
});

test("客服限流表达到上限时只淘汰最旧 owner，不无限增长", () => {
	let now = 1_000;
	const limiter = new InMemoryIntelligentCustomerRateLimiter({
		maxRequests: 1,
		windowMs: 10_000,
		maxKeys: 2,
		now: () => now,
	});

	limiter.consume("owner-a");
	now += 1;
	limiter.consume("owner-b");
	now += 1;
	limiter.consume("owner-c");

	// owner-b 仍处于当前窗口限制；随后新 owner 会淘汰最旧条目。
	expect(() => limiter.consume("owner-b")).toThrow(
		IntelligentCustomerRateLimitError,
	);
	limiter.consume("owner-a");
});
