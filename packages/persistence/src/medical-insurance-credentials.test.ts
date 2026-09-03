import { expect, test } from "bun:test";
import { createInMemoryMedicalInsuranceCredentialRepository } from "./repositories";

const key = Buffer.alloc(32, 5).toString("base64");
const context = {
	credentialId: "credential-001",
	ownerUserId: "user-001",
	medicalOrderId: "medical-order-001",
	payOrdId: "pay-ord-001",
	payToken: "provider-pay-token-secret",
	providerQueryIdentity: {
		orgCodg: "org-001",
		idNo: "masked-id-001",
		userName: "测试用户",
		idType: "01",
	},
	purpose: "query" as const,
	expiresAt: "2026-09-03T12:00:00.000Z",
	createdAt: "2026-09-03T10:00:00.000Z",
};

test("medical insurance credential context is encrypted and owner scoped", async () => {
	const repository = createInMemoryMedicalInsuranceCredentialRepository(key);
	await expect(repository.put(context)).resolves.toEqual({
		credentialId: context.credentialId,
		ownerUserId: context.ownerUserId,
		medicalOrderId: context.medicalOrderId,
		payOrdId: context.payOrdId,
		purpose: context.purpose,
		expiresAt: context.expiresAt,
		createdAt: context.createdAt,
	});

	await expect(
		repository.get({
			credentialId: context.credentialId,
			ownerUserId: context.ownerUserId,
			medicalOrderId: context.medicalOrderId,
			purpose: context.purpose,
			now: "2026-09-03T11:00:00.000Z",
		}),
	).resolves.toMatchObject(context);
	await expect(
		repository.get({
			credentialId: context.credentialId,
			ownerUserId: "another-user",
			medicalOrderId: context.medicalOrderId,
			purpose: context.purpose,
			now: "2026-09-03T11:00:00.000Z",
		}),
	).resolves.toBeUndefined();
});

test("medical insurance credential context expires and can be revoked", async () => {
	const repository = createInMemoryMedicalInsuranceCredentialRepository(key);
	await repository.put(context);

	await expect(
		repository.get({
			credentialId: context.credentialId,
			ownerUserId: context.ownerUserId,
			medicalOrderId: context.medicalOrderId,
			purpose: context.purpose,
			now: "2026-09-03T12:00:00.000Z",
		}),
	).resolves.toBeUndefined();
	await expect(
		repository.revoke({
			credentialId: context.credentialId,
			ownerUserId: context.ownerUserId,
			medicalOrderId: context.medicalOrderId,
			now: "2026-09-03T11:30:00.000Z",
		}),
	).resolves.toBe(true);
	await expect(
		repository.get({
			credentialId: context.credentialId,
			ownerUserId: context.ownerUserId,
			medicalOrderId: context.medicalOrderId,
			purpose: context.purpose,
			now: "2026-09-03T11:31:00.000Z",
		}),
	).resolves.toBeUndefined();
});

test("medical insurance credential context rejects idempotency drift", async () => {
	const repository = createInMemoryMedicalInsuranceCredentialRepository(key);
	await repository.put(context);

	await expect(
		repository.put({ ...context, payToken: "different-token" }),
	).rejects.toThrow("idempotency payload changed");
});
