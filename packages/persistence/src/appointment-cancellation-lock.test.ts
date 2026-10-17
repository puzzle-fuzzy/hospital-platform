import { expect, test } from "bun:test";
import { AppointmentCancellationBusyError } from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createInMemoryAppointmentWriteRepository } from "./repositories";

function deferred() {
	let resolve = () => {};
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

type ConnectionState = {
	statements: string[];
	values: unknown[][];
	released: number;
	destroyed: number;
	lockName?: string;
};

function lockPool(
	options: {
		acquireResult?: 0 | null;
		acquireError?: Error;
		connectionError?: Error;
		releaseResult?: 0 | null;
		releaseError?: Error;
		returnError?: Error;
		connectionLimit?: unknown;
		connectionGate?: Promise<void>;
	} = {},
) {
	const connections: ConnectionState[] = [];
	const owners = new Map<string, ConnectionState>();
	let poolExecutions = 0;
	let connectionCalls = 0;
	const pool = {
		pool: {
			config: {
				connectionLimit:
					"connectionLimit" in options ? options.connectionLimit : 10,
			},
		},
		async getConnection() {
			connectionCalls += 1;
			if (options.connectionGate) await options.connectionGate;
			if (options.connectionError) throw options.connectionError;
			const state: ConnectionState = {
				statements: [],
				values: [],
				released: 0,
				destroyed: 0,
			};
			connections.push(state);
			return {
				async execute(sql: string, values: readonly unknown[]) {
					state.statements.push(sql);
					state.values.push([...values]);
					const key = String(values[0]);
					if (sql.includes("GET_LOCK")) {
						if (options.acquireError) throw options.acquireError;
						if (options.acquireResult !== undefined) {
							return [[{ acquired: options.acquireResult }], []];
						}
						if (owners.has(key)) return [[{ acquired: 0 }], []];
						owners.set(key, state);
						state.lockName = key;
						return [[{ acquired: 1 }], []];
					}
					if (options.releaseError) throw options.releaseError;
					if (options.releaseResult !== undefined) {
						return [[{ released: options.releaseResult }], []];
					}
					if (owners.get(key) !== state) {
						throw new Error("Lock must be released by its owning connection");
					}
					owners.delete(key);
					return [[{ released: 1 }], []];
				},
				release() {
					if (options.returnError) throw options.returnError;
					state.released += 1;
				},
				destroy() {
					state.destroyed += 1;
					if (state.lockName && owners.get(state.lockName) === state) {
						owners.delete(state.lockName);
					}
				},
			};
		},
		async execute() {
			poolExecutions += 1;
			throw new Error("Named locks must not run through the shared pool");
		},
	} as unknown as Pool;
	return {
		pool,
		connections,
		owners,
		poolExecutions: () => poolExecutions,
		connectionCalls: () => connectionCalls,
	};
}

test("in-memory cancellation rejects another order for the same appointment but permits other scopes", async () => {
	const repo = createInMemoryAppointmentWriteRepository();
	const lock = repo.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const gate = deferred();
	const started = deferred();
	const first = lock("owner-1", "appointment-1", async () => {
		started.resolve();
		await gate.promise;
		return "order-1";
	});
	await started.promise;
	let secondCalls = 0;
	await expect(
		lock("owner-1", "appointment-1", async () => {
			secondCalls += 1;
			return "order-2";
		}),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(secondCalls).toBe(0);
	await expect(
		lock("owner-1", "appointment-2", async () => "different appointment"),
	).resolves.toBe("different appointment");
	await expect(
		lock("owner-2", "appointment-1", async () => "different owner"),
	).resolves.toBe("different owner");
	gate.resolve();
	await expect(first).resolves.toBe("order-1");
	await expect(
		lock("owner-1", "appointment-1", async () => "after release"),
	).resolves.toBe("after release");
});

test("in-memory cancellation releases its lock when the operation fails", async () => {
	const lock = createInMemoryAppointmentWriteRepository().withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const failure = new Error("Provider rejected this synthetic operation");
	await expect(
		lock("owner-1", "appointment-1", async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
	await expect(
		lock("owner-1", "appointment-1", async () => "released"),
	).resolves.toBe("released");
});

test("MySQL cancellation holds an owner-scoped appointment lock across repositories and independent payment orders", async () => {
	const fake = lockPool();
	const firstRepo = createMySqlRepositories(fake.pool).appointmentWrites;
	const secondRepo = createMySqlRepositories(fake.pool).appointmentWrites;
	const firstLock = firstRepo.withCancellationLock;
	const secondLock = secondRepo.withCancellationLock;
	if (!firstLock || !secondLock) throw new Error("Cancellation lock missing");
	const gate = deferred();
	const started = deferred();
	const first = firstLock("owner-1", "appointment-1", async () => {
		started.resolve();
		await gate.promise;
		return { orderId: "first-payment-order" };
	});
	await started.promise;
	let secondCalls = 0;
	await expect(
		secondLock("owner-1", "appointment-1", async () => {
			secondCalls += 1;
			return { orderId: "second-payment-order" };
		}),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(secondCalls).toBe(0);
	await expect(
		secondLock("owner-1", "appointment-2", async () => 2),
	).resolves.toBe(2);
	await expect(
		secondLock("owner-2", "appointment-1", async () => 3),
	).resolves.toBe(3);
	expect(fake.owners.size).toBe(1);
	gate.resolve();
	await expect(first).resolves.toEqual({ orderId: "first-payment-order" });
	expect(fake.owners.size).toBe(0);
	expect(fake.poolExecutions()).toBe(0);
	for (const connection of fake.connections) {
		expect(connection.released).toBe(1);
		expect(connection.destroyed).toBe(0);
		expect(connection.statements[0]).toBe("SELECT GET_LOCK(?, 0) AS acquired");
		const name = String(connection.values[0]?.[0]);
		expect(name).toMatch(/^[a-f0-9]{64}$/);
		expect(name).not.toContain("owner-1");
		expect(name).not.toContain("appointment-1");
		if (connection.statements.length === 2) {
			expect(connection.statements[1]).toBe(
				"SELECT RELEASE_LOCK(?) AS released",
			);
			expect(connection.values[1]).toEqual(connection.values[0]);
		}
	}
});

test("MySQL cancellation lock key is bounded and keeps identifier pairs distinct", async () => {
	const fake = lockPool();
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	await lock("owner:appointment", "id", async () => undefined);
	await lock("owner", "appointment:id", async () => undefined);
	await lock("x".repeat(1000), "y".repeat(1000), async () => undefined);
	const names = fake.connections.map((item) => String(item.values[0]?.[0]));
	expect(new Set(names).size).toBe(3);
	expect(names.every((name) => name.length === 64)).toBe(true);
});

test("MySQL cancellation callback failure releases the lock and preserves its original error", async () => {
	const fake = lockPool();
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const error = new Error("Synthetic operation failed");
	await expect(
		lock("owner", "appointment", async () => {
			throw error;
		}),
	).rejects.toBe(error);
	expect(fake.connections[0]?.released).toBe(1);
	expect(fake.connections[0]?.destroyed).toBe(0);
	expect(fake.owners.size).toBe(0);
	await expect(lock("owner", "appointment", async () => 1)).resolves.toBe(1);
});

for (const acquireResult of [0, null] as const) {
	test(`MySQL GET_LOCK ${acquireResult} never enters the cancellation callback`, async () => {
		const fake = lockPool({ acquireResult });
		const lock = createMySqlRepositories(fake.pool).appointmentWrites
			.withCancellationLock;
		if (!lock) throw new Error("Cancellation lock missing");
		let calls = 0;
		const pending = lock("owner", "appointment", async () => {
			calls += 1;
		});
		if (acquireResult === 0) {
			await expect(pending).rejects.toBeInstanceOf(
				AppointmentCancellationBusyError,
			);
		} else {
			await expect(pending).rejects.toThrow(
				"Appointment cancellation lock is unavailable",
			);
		}
		expect(calls).toBe(0);
		expect(fake.connections[0]?.statements).toHaveLength(1);
		expect(fake.connections[0]?.released).toBe(acquireResult === 0 ? 1 : 0);
		expect(fake.connections[0]?.destroyed).toBe(acquireResult === 0 ? 0 : 1);
	});
}

test("MySQL uncertain acquisition destroys the connection without retry or raw driver details", async () => {
	const fake = lockPool({
		acquireError: new Error("raw SQL or connection details"),
	});
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	let calls = 0;
	await expect(
		lock("owner", "appointment", async () => {
			calls += 1;
		}),
	).rejects.toThrow("Appointment cancellation lock is unavailable");
	expect(calls).toBe(0);
	expect(fake.connections).toHaveLength(1);
	expect(fake.connections[0]?.statements).toHaveLength(1);
	expect(fake.connections[0]?.destroyed).toBe(1);
	expect(fake.connections[0]?.released).toBe(0);
});

for (const options of [
	{ releaseResult: 0 as const },
	{ releaseResult: null },
	{ releaseError: new Error("raw release driver error") },
	{ returnError: new Error("raw connection return error") },
]) {
	test(`MySQL failed lock cleanup destroys the connection (${Object.keys(options)[0]} ${"releaseResult" in options ? options.releaseResult : "error"})`, async () => {
		const fake = lockPool(options);
		const lock = createMySqlRepositories(fake.pool).appointmentWrites
			.withCancellationLock;
		if (!lock) throw new Error("Cancellation lock missing");
		let calls = 0;
		await expect(
			lock("owner", "appointment", async () => {
				calls += 1;
			}),
		).rejects.toThrow("Appointment cancellation lock release failed");
		expect(calls).toBe(1);
		expect(fake.connections[0]?.released).toBe(0);
		expect(fake.connections[0]?.destroyed).toBe(1);
		expect(fake.owners.size).toBe(0);
	});
}

test("MySQL cleanup error cannot mask a cancellation operation error", async () => {
	const fake = lockPool({
		releaseError: new Error("raw release driver error"),
	});
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const failure = new Error("Synthetic provider error");
	await expect(
		lock("owner", "appointment", async () => {
			throw failure;
		}),
	).rejects.toBe(failure);
	expect(fake.connections[0]?.destroyed).toBe(1);
	expect(fake.connections[0]?.released).toBe(0);
});

test("MySQL connection acquisition failure is sanitized before callback execution", async () => {
	const fake = lockPool({
		connectionError: new Error("raw connection details"),
	});
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	let calls = 0;
	await expect(
		lock("owner", "appointment", async () => {
			calls += 1;
		}),
	).rejects.toThrow("Appointment cancellation lock is unavailable");
	expect(calls).toBe(0);
	expect(fake.connections).toHaveLength(0);
});

test("MySQL trusted nested calls across repositories reuse only the same appointment lock", async () => {
	const fake = lockPool();
	const first = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	const second = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!first || !second) throw new Error("Cancellation lock missing");
	await expect(
		first("owner", "appointment", async () => {
			await Promise.resolve();
			await expect(
				second("owner", "appointment", async () => "nested"),
			).resolves.toBe("nested");
			await expect(
				second("owner", "other-appointment", async () => "other"),
			).resolves.toBe("other");
			return second("owner", "appointment", async () => 7);
		}),
	).resolves.toBe(7);
	expect(fake.connectionCalls()).toBe(2);
	expect(fake.connections.map((item) => item.statements.length)).toEqual([
		2, 2,
	]);
	expect(fake.owners.size).toBe(0);
});

test("memory trusted nested calls reuse their scope while independent async requests remain blocked", async () => {
	const lock = createInMemoryAppointmentWriteRepository().withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const gate = deferred();
	const started = deferred();
	const outer = lock("owner", "appointment", async () => {
		await expect(
			lock("owner", "appointment", async () => "nested"),
		).resolves.toBe("nested");
		await expect(lock("owner", "other", async () => "other")).resolves.toBe(
			"other",
		);
		started.resolve();
		await gate.promise;
	});
	await started.promise;
	await expect(
		lock("owner", "appointment", async () => undefined),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	gate.resolve();
	await outer;
});

for (const kind of ["memory", "mysql"] as const) {
	test(`${kind} inherited detached async context cannot reuse an expired token over a new lock owner`, async () => {
		const fake = lockPool();
		const lock =
			kind === "memory"
				? createInMemoryAppointmentWriteRepository().withCancellationLock
				: createMySqlRepositories(fake.pool).appointmentWrites
						.withCancellationLock;
		if (!lock) throw new Error("Cancellation lock missing");
		const startDetached = deferred();
		let detached: Promise<unknown> | undefined;
		let detachedCallbacks = 0;
		await lock("owner", "appointment", async () => {
			detached = (async () => {
				await startDetached.promise;
				return lock("owner", "appointment", async () => {
					detachedCallbacks += 1;
				});
			})();
		});
		const releaseNew = deferred();
		const newStarted = deferred();
		const newOwner = lock("owner", "appointment", async () => {
			newStarted.resolve();
			await releaseNew.promise;
		});
		await newStarted.promise;
		startDetached.resolve();
		if (!detached) throw new Error("Detached operation missing");
		await expect(detached).rejects.toBeInstanceOf(
			AppointmentCancellationBusyError,
		);
		expect(detachedCallbacks).toBe(0);
		if (kind === "mysql") expect(fake.connectionCalls()).toBe(3);
		releaseNew.resolve();
		await newOwner;
	});
}

test("MySQL admission is shared by pool and reserved before connection acquisition", async () => {
	const connectionGate = deferred();
	const fake = lockPool({ connectionGate: connectionGate.promise });
	const locks = Array.from(
		{ length: 6 },
		() =>
			createMySqlRepositories(fake.pool).appointmentWrites.withCancellationLock,
	);
	const release = deferred();
	const starts = Array.from({ length: 4 }, () => deferred());
	const active = starts.map((started, index) => {
		const lock = locks[index];
		if (!lock) throw new Error("Cancellation lock missing");
		return lock("owner", `appointment-${index}`, async () => {
			started.resolve();
			await release.promise;
		});
	});
	expect(fake.connectionCalls()).toBe(4);
	const fifth = locks[4];
	if (!fifth) throw new Error("Cancellation lock missing");
	let fifthCallbacks = 0;
	await expect(
		fifth("owner", "appointment-4", async () => {
			fifthCallbacks += 1;
		}),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(fifthCallbacks).toBe(0);
	expect(fake.connectionCalls()).toBe(4);
	connectionGate.resolve();
	await Promise.all(starts.map((start) => start.promise));
	expect(fake.owners.size).toBe(4);
	release.resolve();
	await Promise.all(active);
	await expect(
		fifth("owner", "appointment-4", async () => "slot returned"),
	).resolves.toBe("slot returned");
	expect(fake.connectionCalls()).toBe(5);
});

test("MySQL small pool reserves one connection for callback SQL", async () => {
	const fake = lockPool({ connectionLimit: 2 });
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	const release = deferred();
	const started = deferred();
	const first = lock("owner", "appointment-1", async () => {
		started.resolve();
		await release.promise;
	});
	await started.promise;
	await expect(
		lock("owner", "appointment-2", async () => undefined),
	).rejects.toBeInstanceOf(AppointmentCancellationBusyError);
	expect(fake.connectionCalls()).toBe(1);
	release.resolve();
	await first;
	await expect(lock("owner", "appointment-2", async () => 2)).resolves.toBe(2);
});

for (const connectionLimit of [0, 1, undefined, "10", Number.NaN]) {
	test(`MySQL invalid or single-connection pool fails closed (${String(connectionLimit)})`, async () => {
		const fake = lockPool({ connectionLimit });
		const lock = createMySqlRepositories(fake.pool).appointmentWrites
			.withCancellationLock;
		if (!lock) throw new Error("Cancellation lock missing");
		let calls = 0;
		await expect(
			lock("owner", "appointment", async () => {
				calls += 1;
			}),
		).rejects.toThrow("Appointment cancellation lock is unavailable");
		expect(calls).toBe(0);
		expect(fake.connectionCalls()).toBe(0);
	});
}

test("MySQL connection acquisition failure returns its admission slot", async () => {
	const options: { connectionLimit: number; connectionError?: Error } = {
		connectionLimit: 2,
		connectionError: new Error("Synthetic connection error"),
	};
	const fake = lockPool(options);
	const lock = createMySqlRepositories(fake.pool).appointmentWrites
		.withCancellationLock;
	if (!lock) throw new Error("Cancellation lock missing");
	await expect(
		lock("owner", "appointment", async () => undefined),
	).rejects.toThrow("Appointment cancellation lock is unavailable");
	delete options.connectionError;
	await expect(
		lock("owner", "appointment", async () => "slot returned"),
	).resolves.toBe("slot returned");
});
