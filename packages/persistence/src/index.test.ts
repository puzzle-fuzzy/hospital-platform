import { expect, test } from "bun:test";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
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
	expect(await patients.listByOwner(first.userId)).toHaveLength(1);
});
