import { expect, test } from "bun:test";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createNotConfiguredRepositories,
	createUnconfiguredPersistence,
} from "./index";

test("unconfigured persistence never reports a dependency as ready", async () => {
	const ports = createUnconfiguredPersistence();

	expect(await ports.database.check()).toBe("not_configured");
	expect(await ports.redis.check()).toBe("not_configured");
});

test("in-memory repositories preserve owner isolation", async () => {
	const users = createInMemoryIdentityUserRepository();
	const first = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-001",
	});
	const same = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-001",
	});
	const patients = createInMemoryPatientRepository([
		{
			id: "patient-001",
			ownerUserId: first.userId,
			displayName: "测试患者",
			relationship: "self",
			cardNumberMasked: "****001",
			source: "legacy-record",
		},
		{
			id: "patient-002",
			ownerUserId: "other-user",
			displayName: "其他患者",
			relationship: "self",
			cardNumberMasked: "****002",
			source: "legacy-record",
		},
	]);

	expect(same.userId).toBe(first.userId);
	expect(await users.findByUserId(first.userId)).toEqual(first);
	expect(await patients.listByOwner(first.userId)).toHaveLength(1);
});

test("in-memory payment repository enforces owner lookup", async () => {
	const orders = createInMemoryPaymentOrderRepository([
		{
			orderId: "order-001",
			ownerUserId: "user-001",
			patientId: "patient-001",
			idempotencyKey: "key-001",
			amounts: { totalFen: 100, insuranceFen: 70, cashFen: 30 },
			state: "created",
			version: 1,
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:00.000Z",
		},
	]);

	expect(await orders.findByOwnerAndId("user-001", "order-001")).toBeDefined();
	expect(
		await orders.findByOwnerAndId("user-002", "order-001"),
	).toBeUndefined();
});

test("not-configured payment persistence fails closed", async () => {
	const repositories = createNotConfiguredRepositories();

	expect(
		repositories.paymentOrders.findByOwnerAndId("user-001", "order-001"),
	).rejects.toThrow("Dependency is not configured");
});

test("in-memory prepay attempts replay by owner, order and idempotency key", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository([
		{
			attemptId: "attempt-001",
			ownerUserId: "user-001",
			orderId: "order-001",
			provider: "wechat-pay",
			idempotencyKey: "prepay-001",
			status: "succeeded",
			version: 2,
			queryAttempts: 0,
			prepayId: "prepay-001",
			payParams: {
				appId: "app-001",
				timeStamp: "1700000000",
				nonceStr: "nonce-001",
				package: "prepay_id=prepay-001",
				signType: "RSA",
				paySign: "sign-001",
			},
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:01.000Z",
		},
	]);

	expect(
		await attempts.findByOwnerOrderAndIdempotencyKey(
			"user-001",
			"order-001",
			"prepay-001",
		),
	).toMatchObject({ attemptId: "attempt-001", status: "succeeded" });
	expect(
		await attempts.findByOwnerOrderAndIdempotencyKey(
			"user-002",
			"order-001",
			"prepay-001",
		),
	).toBeUndefined();
});

test("in-memory prepay attempts claim due work once until the lease expires", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository([
		{
			attemptId: "attempt-claim-001",
			ownerUserId: "user-claim-001",
			orderId: "order-claim-001",
			provider: "wechat-pay",
			idempotencyKey: "prepay-claim-001",
			status: "succeeded",
			version: 2,
			queryAttempts: 1,
			nextQueryAt: "2026-08-15T00:00:00.000Z",
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:00.000Z",
		},
	]);
	const claimAt = new Date("2026-08-15T00:00:00.000Z");
	const staleAttempt = await attempts.findByOwnerOrderAndIdempotencyKey(
		"user-claim-001",
		"order-claim-001",
		"prepay-claim-001",
	);
	if (!staleAttempt) throw new Error("Claim test seed was not found");

	expect(await attempts.claimDueForQuery(claimAt, 1, 60_000)).toMatchObject([
		{ version: 3, queryClaimedUntil: "2026-08-15T00:01:00.000Z" },
	]);
	await expect(
		attempts.update(staleAttempt, staleAttempt.version),
	).rejects.toThrow("Payment prepay attempt was changed by another request");
	expect(await attempts.claimDueForQuery(claimAt, 1, 60_000)).toEqual([]);
	expect(
		await attempts.claimDueForQuery(
			new Date("2026-08-15T00:01:00.000Z"),
			1,
			60_000,
		),
	).toMatchObject([
		{ version: 4, queryClaimedUntil: "2026-08-15T00:02:00.000Z" },
	]);
});
