/**
 * 客服请求按已认证用户做进程内固定窗口限流。
 *
 * 这是 MVP 的保护层，不承担跨副本配额一致性；多副本部署时仍应在
 * 网关/Redis 层配置同等或更严格的限流。进程内表有上限，避免把未知
 * owner 标识无限写入内存。
 */
export type IntelligentCustomerRateLimiter = {
	consume(ownerUserId: string): void;
};

export type InMemoryIntelligentCustomerRateLimiterOptions = {
	maxRequests?: number;
	windowMs?: number;
	maxKeys?: number;
	now?: () => number;
};

type RateLimitEntry = {
	windowStartedAt: number;
	count: number;
	lastSeenAt: number;
};

export class IntelligentCustomerRateLimitError extends Error {
	readonly code = "intelligent-customer-rate-limited" as const;
	readonly retryAfterSeconds: number;

	constructor(retryAfterSeconds: number) {
		super("Intelligent customer requests are rate limited");
		this.name = "IntelligentCustomerRateLimitError";
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

function boundedDelaySeconds(milliseconds: number): number {
	return Math.max(1, Math.ceil(milliseconds / 1_000));
}

export class InMemoryIntelligentCustomerRateLimiter
	implements IntelligentCustomerRateLimiter
{
	private readonly entries = new Map<string, RateLimitEntry>();
	private readonly maxRequests: number;
	private readonly windowMs: number;
	private readonly maxKeys: number;
	private readonly now: () => number;

	constructor(options: InMemoryIntelligentCustomerRateLimiterOptions = {}) {
		this.maxRequests = positiveInteger(
			options.maxRequests ?? 10,
			"maxRequests",
		);
		this.windowMs = positiveInteger(options.windowMs ?? 60_000, "windowMs");
		this.maxKeys = positiveInteger(options.maxKeys ?? 10_000, "maxKeys");
		this.now = options.now ?? Date.now;
	}

	consume(ownerUserId: string): void {
		const now = this.now();
		if (!Number.isFinite(now)) throw new Error("Rate limiter clock is invalid");

		this.prune(now);
		let entry = this.entries.get(ownerUserId);
		if (!entry) {
			if (this.entries.size >= this.maxKeys) this.evictLeastRecentlySeen();
			entry = { windowStartedAt: now, count: 0, lastSeenAt: now };
			this.entries.set(ownerUserId, entry);
		}

		if (now - entry.windowStartedAt >= this.windowMs) {
			entry.windowStartedAt = now;
			entry.count = 0;
		}

		entry.lastSeenAt = now;
		if (entry.count >= this.maxRequests) {
			throw new IntelligentCustomerRateLimitError(
				boundedDelaySeconds(entry.windowStartedAt + this.windowMs - now),
			);
		}
		entry.count += 1;
	}

	private prune(now: number): void {
		for (const [ownerUserId, entry] of this.entries) {
			if (now - entry.windowStartedAt >= this.windowMs) {
				this.entries.delete(ownerUserId);
			}
		}
	}

	private evictLeastRecentlySeen(): void {
		let oldestOwner: string | undefined;
		let oldestTimestamp = Number.POSITIVE_INFINITY;
		for (const [ownerUserId, entry] of this.entries) {
			if (entry.lastSeenAt < oldestTimestamp) {
				oldestOwner = ownerUserId;
				oldestTimestamp = entry.lastSeenAt;
			}
		}
		if (oldestOwner) this.entries.delete(oldestOwner);
	}
}

export function createInMemoryIntelligentCustomerRateLimiter(
	options: InMemoryIntelligentCustomerRateLimiterOptions = {},
): IntelligentCustomerRateLimiter {
	return new InMemoryIntelligentCustomerRateLimiter(options);
}
