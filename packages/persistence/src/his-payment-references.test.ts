import { expect, test } from "bun:test";
import {
	HisPaymentReferenceConflictError,
	HisPaymentReferenceNotInitializedError,
	type HisPaymentReferenceScope,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import {
	createInMemoryHisPaymentReferenceRepository,
	createMySqlHisPaymentReferenceRepository,
} from "./his-payment-references";

const scope: HisPaymentReferenceScope = {
	ownerUserId: "owner-a",
	medicalOrderId: "medical-a",
	paymentScopeId: "cash-a",
	source: "component",
};

test("concurrent allocation reuses one number without marking HIS success", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const records = await Promise.all(
		Array.from({ length: 32 }, () => repository.allocate(scope)),
	);
	expect(new Set(records.map((record) => record.referenceId)).size).toBe(1);
	expect(records[0]?.status).toBe("allocated");
	expect(records[0]?.receiptId).toBeUndefined();
});

test("HIS can return a different Long receipt; both aliases resolve to the same payment", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const allocated = await repository.allocate(scope);
	const confirmed = await repository.confirm({
		...scope,
		referenceId: "9223372036854775807",
	});
	expect(confirmed.referenceId).toBe(allocated.referenceId);
	expect(confirmed.status).toBe("confirmed");
	expect(confirmed.receiptId).toBe("9223372036854775807");
	expect(await repository.findByReferenceId(allocated.referenceId)).toEqual(
		confirmed,
	);
	expect(await repository.findByReferenceId("9223372036854775807")).toEqual(
		confirmed,
	);
});

test("historical receipt import is idempotent without changing its external number", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const first = await repository.confirm({
		...scope,
		referenceId: "9007199254740993",
	});
	expect(
		await repository.confirm({ ...scope, referenceId: "9007199254740993" }),
	).toEqual(first);
	expect(await repository.allocate(scope)).toEqual(first);
	expect(
		(await repository.allocate({ ...scope, paymentScopeId: "cash-b" }))
			.referenceId,
	).toBe("1");
});

test("allocated and historical numbers share one namespace and never overwrite another payment", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const first = await repository.allocate(scope);
	const otherScope = { ...scope, paymentScopeId: "cash-b" };
	const second = await repository.allocate(otherScope);
	await expect(
		repository.confirm({ ...otherScope, referenceId: first.referenceId }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	expect((await repository.findByReferenceId(second.referenceId))?.status).toBe(
		"allocated",
	);
	await repository.confirm({ ...scope, referenceId: "50" });
	await expect(
		repository.confirm({ ...otherScope, referenceId: "50" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	await expect(
		repository.confirm({ ...scope, referenceId: "51" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
});

test("historical small aliases are skipped by future allocations", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	await repository.confirm({ ...scope, referenceId: "2" });
	expect(
		(await repository.allocate({ ...scope, paymentScopeId: "cash-b" }))
			.referenceId,
	).toBe("1");
	expect(
		(await repository.allocate({ ...scope, paymentScopeId: "cash-c" }))
			.referenceId,
	).toBe("3");
});

test("historical A receipt 2 and B receipt 1 never register hidden internal IDs", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository({
		numberingInitialized: false,
	});
	const other = { ...scope, paymentScopeId: "cash-b" };
	const first = await repository.confirm({ ...scope, referenceId: "2" });
	expect(first.referenceId).toBe("2");
	expect(first.requestReferenceId).toBeUndefined();
	expect(await repository.findByReferenceId("1")).toBeUndefined();
	const second = await repository.confirm({ ...other, referenceId: "1" });
	expect(second.requestReferenceId).toBeUndefined();
	expect(await repository.findByReferenceId("2")).toEqual(first);
	expect(await repository.findByReferenceId("1")).toEqual(second);
	await expect(
		repository.allocate({ ...scope, paymentScopeId: "new" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceNotInitializedError);
	await repository.initializeNewNumbering();
	expect(
		(await repository.allocate({ ...scope, paymentScopeId: "new" }))
			.requestReferenceId,
	).toBe("3");
});

test("historical maximum Long and duplicate imports never advance the new public sequence", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	await repository.confirm({ ...scope, referenceId: "9223372036854775807" });
	await repository.confirm({ ...scope, referenceId: "9223372036854775807" });
	const next = await repository.allocate({ ...scope, paymentScopeId: "new" });
	expect(next.requestReferenceId).toBe("1");
	expect(next.referenceId).toBe("1");
});

test("long contiguous historical aliases are skipped in one allocation", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository({
		numberingInitialized: false,
	});
	for (let i = 1; i <= 64; i++)
		await repository.confirm({
			...scope,
			paymentScopeId: `historical-${i}`,
			referenceId: String(i),
		});
	await repository.initializeNewNumbering();
	expect((await repository.allocate(scope)).requestReferenceId).toBe("65");
});

test("findByScope is owner isolated and detects a prior receipt before an alias lookup", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const first = await repository.confirm({
		...scope,
		referenceId: "9007199254740993",
	});
	expect(await repository.findByScope(scope)).toEqual(first);
	expect(
		await repository.findByScope({ ...scope, ownerUserId: "other-owner" }),
	).toBeUndefined();
	expect(
		await repository.findByScope({ ...scope, paymentScopeId: "other" }),
	).toBeUndefined();
});

test("a later true receipt colliding with another payment request quarantines only that alias", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const allocated = await repository.allocate(scope);
	expect(allocated.requestReferenceId).toBe("1");
	const first = await repository.confirm({ ...scope, referenceId: "10" });
	const other = { ...scope, paymentScopeId: "cash-b" };
	await expect(
		repository.confirm({ ...other, referenceId: "1" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	await expect(repository.findByReferenceId("1")).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	expect(await repository.findByReferenceId("10")).toEqual(first);
	expect(await repository.findByScope(other)).toBeUndefined();
	await expect(repository.initializeNewNumbering()).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	await expect(
		repository.confirm({ ...scope, referenceId: "11" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	expect(await repository.findByReferenceId("10")).toEqual(first);
});

test("same-scope receipt change is rejected without quarantining existing public aliases", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	await repository.allocate(scope);
	const record = await repository.confirm({ ...scope, referenceId: "10" });
	await expect(
		repository.confirm({ ...scope, referenceId: "11" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	expect(await repository.findByReferenceId("1")).toEqual(record);
	expect(await repository.findByReferenceId("10")).toEqual(record);
});

test("explicit quarantine is persistent and missing aliases do not occupy new numbers", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	await repository.quarantineReferenceId("1");
	expect((await repository.allocate(scope)).referenceId).toBe("1");
	await repository.quarantineReferenceId("1");
	await expect(repository.findByReferenceId("1")).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	await expect(repository.allocate(scope)).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	await expect(repository.initializeNewNumbering()).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	expect((await repository.findByScope(scope))?.requestReferenceId).toBe("1");
});

test("failed rollback discards the connection and preserves the original error without retry", async () => {
	const original = new Error("local transaction failure");
	let destroyed = 0;
	let released = 0;
	let attempts = 0;
	const repository = createMySqlHisPaymentReferenceRepository({
		async getConnection() {
			attempts++;
			return {
				async beginTransaction() {
					throw original;
				},
				async rollback() {
					throw new Error("rollback failed");
				},
				destroy() {
					destroyed++;
				},
				release() {
					released++;
				},
			};
		},
	} as unknown as Pool);
	await expect(repository.allocate(scope)).rejects.toBe(original);
	expect(attempts).toBe(1);
	expect(destroyed).toBe(1);
	expect(released).toBe(1);
});

test("owner conflicts and invalid numeric references leave the existing mapping untouched", async () => {
	const repository = createInMemoryHisPaymentReferenceRepository();
	const first = await repository.allocate(scope);
	await expect(
		repository.allocate({ ...scope, ownerUserId: "owner-b" }),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	await expect(
		repository.confirm({
			...scope,
			ownerUserId: "owner-b",
			referenceId: "100",
		}),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	for (const referenceId of [
		"0",
		"01",
		"1e3",
		"9223372036854775808",
		"uuid-not-a-number",
	]) {
		await expect(
			repository.confirm({ ...scope, referenceId }),
		).rejects.toThrow();
	}
	expect(await repository.findByReferenceId(first.referenceId)).toEqual(first);
});
