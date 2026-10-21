import { expect, test } from "bun:test";
import {
	DependencyNotConfiguredError,
	PaymentIdempotencyConflictError,
	type PaymentOrderRepository,
	PaymentOrderService,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createInMemoryPaymentOrderRepository } from "./repositories";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fakePool() {
	const owners = new Set<string>();
	const calls: string[] = [];
	let connectionCount = 0;
	let released = 0;
	const pool = {
		pool: { config: { connectionLimit: 10 } },
		async getConnection() {
			connectionCount++;
			let held: string | undefined;
			return {
				async execute(sql: string, values: readonly unknown[]) {
					calls.push(sql);
					const key = String(values[0]);
					if (sql.includes("GET_LOCK")) {
						if (owners.has(key)) return [[{ acquired: 0 }], []];
						owners.add(key);
						held = key;
						return [[{ acquired: 1 }], []];
					}
					if (!held || held !== key) throw new Error("Wrong lock connection");
					owners.delete(key);
					held = undefined;
					return [[{ released: 1 }], []];
				},
				release() {
					released++;
				},
				destroy() {
					if (held) owners.delete(held);
				},
			};
		},
		async execute() {
			throw new Error("Lock must reserve its own connection");
		},
	} as unknown as Pool;
	return {
		pool,
		owners,
		calls,
		connections: () => connectionCount,
		released: () => released,
	};
}

test("missing payment lock or invalid scope stops before the external operation", async () => {
	let calls = 0;
	const service = new PaymentOrderService({
		orders: {} as PaymentOrderRepository,
	});
	await expect(
		service.withBusinessOperationLock(
			"owner",
			"outpatient-self-pay:record",
			async () => {
				calls++;
			},
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	await expect(
		service.withBusinessOperationLock(
			"",
			"outpatient-self-pay:record",
			async () => {
				calls++;
			},
		),
	).rejects.toThrow("scope is invalid");
	expect(calls).toBe(0);
});

for (const kind of ["memory", "mysql"] as const) {
	test(`${kind} payment create/query/cancel scopes exclude each other across service instances`, async () => {
		const fake = fakePool();
		const repo =
			kind === "memory"
				? createInMemoryPaymentOrderRepository()
				: createMySqlRepositories(fake.pool).paymentOrders;
		const secondRepo =
			kind === "memory"
				? repo
				: createMySqlRepositories(fake.pool).paymentOrders;
		const first = new PaymentOrderService({ orders: repo });
		const second = new PaymentOrderService({ orders: secondRepo });
		const gate = deferred(),
			started = deferred();
		let competingCalls = 0;
		const active = first.withBusinessOperationLock(
			"owner",
			"outpatient-self-pay:record",
			async () => {
				started.resolve();
				await gate.promise;
				return "created";
			},
		);
		await started.promise;
		try {
			await expect(
				second.withBusinessOperationLock(
					"owner",
					"outpatient-self-pay:record",
					async () => {
						competingCalls++;
					},
				),
			).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
			await expect(
				second.withBusinessOperationLock(
					"other-owner",
					"outpatient-self-pay:record",
					async () => "other",
				),
			).resolves.toBe("other");
			await expect(
				second.withBusinessOperationLock(
					"owner",
					"outpatient-self-pay:other-record",
					async () => "other",
				),
			).resolves.toBe("other");
			expect(competingCalls).toBe(0);
		} finally {
			gate.resolve();
		}
		await expect(active).resolves.toBe("created");
		await expect(
			second.withBusinessOperationLock(
				"owner",
				"outpatient-self-pay:record",
				async () => "cancelled",
			),
		).resolves.toBe("cancelled");
		if (kind === "mysql") {
			expect(fake.owners.size).toBe(0);
			expect(fake.released()).toBe(fake.connections());
		}
	});
}

test("payment lock is reentrant but isolated from an appointment with the same identifier", async () => {
	const fake = fakePool();
	const repositories = createMySqlRepositories(fake.pool);
	const service = new PaymentOrderService({
		orders: repositories.paymentOrders,
	});
	await service.withBusinessOperationLock("owner", "record", async () => {
		await expect(
			service.withBusinessOperationLock(
				"owner",
				"record",
				async () => "nested",
			),
		).resolves.toBe("nested");
		expect(fake.connections()).toBe(1);
		await repositories.appointmentWrites.withCancellationLock?.(
			"owner",
			"record",
			async () => {
				expect(fake.connections()).toBe(2);
			},
		);
	});
	expect(fake.calls.filter((sql) => sql.includes("GET_LOCK"))).toHaveLength(2);
	expect(fake.owners.size).toBe(0);
});

test("failure releases the shared payment scope so a later retry can proceed", async () => {
	const fake = fakePool();
	const service = new PaymentOrderService({
		orders: createMySqlRepositories(fake.pool).paymentOrders,
	});
	await expect(
		service.withBusinessOperationLock("owner", "record", async () => {
			throw new Error("Provider result unknown");
		}),
	).rejects.toThrow("Provider result unknown");
	await expect(
		service.withBusinessOperationLock("owner", "record", async () => "retry"),
	).resolves.toBe("retry");
	expect(fake.owners.size).toBe(0);
	expect(fake.released()).toBe(2);
});
