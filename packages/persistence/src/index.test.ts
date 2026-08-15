import { expect, test } from "bun:test";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
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
