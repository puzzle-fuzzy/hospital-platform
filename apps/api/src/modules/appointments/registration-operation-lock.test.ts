import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { DependencyNotConfiguredError } from "@hospital/domain";
import {
	guardRegistrationOperations,
	type RegistrationOperationLock,
	type RegistrationOperationReference,
} from "./registration-operation-lock";

const reference = {
	ownerUserId: "fixture-owner",
	appointmentId: "fixture-appointment",
};
const resolve = async () => reference;

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

/** Test-only lock; production durable locking and reentry belong to the repo. */
function locking() {
	const pending = new Map<string, Promise<void>>();
	const asyncOwner = new AsyncLocalStorage<ReadonlySet<string>>();
	const entries: string[] = [];
	const exits: string[] = [];
	const run: RegistrationOperationLock = async (
		owner,
		appointment,
		operation,
	) => {
		const key = `${owner}:${appointment}`;
		const current = asyncOwner.getStore();
		if (current?.has(key)) return operation();
		const previous = pending.get(key) ?? Promise.resolve();
		const complete = deferred();
		pending.set(key, complete.promise);
		await previous;
		entries.push(key);
		try {
			return await asyncOwner.run(
				new Set([...(current ?? []), key]),
				operation,
			);
		} finally {
			exits.push(key);
			complete.resolve();
			if (pending.get(key) === complete.promise) pending.delete(key);
		}
	};
	return { run, entries, exits };
}

test("preserves class identity, private fields, getters and cached method identity", async () => {
	class Service {
		#value = 3;
		get value() {
			return this.#value;
		}
		async write(_input: unknown, increment: number) {
			this.#value += increment;
			return this.#value;
		}
		read() {
			return this.#value;
		}
	}
	const original = new Service();
	const locks = locking();
	const guarded = guardRegistrationOperations(
		original,
		["write"],
		resolve,
		locks.run,
	);
	expect(guarded).toBeInstanceOf(Service);
	expect(guarded.constructor).toBe(Service);
	expect(Object.getPrototypeOf(guarded)).toBe(Service.prototype);
	expect(guarded.write).toBe(guarded.write);
	expect(guarded.read).toBe(guarded.read);
	const extracted = guarded.write;
	expect(await extracted({ owner: "ignored" }, 4)).toBe(7);
	expect(guarded.value).toBe(7);
	expect(guarded.read()).toBe(7);
	expect(original.value).toBe(7);
	expect(locks.entries).toEqual(["fixture-owner:fixture-appointment"]);
});

test("only explicit methods resolve references and acquire the lock", async () => {
	let resolutions = 0;
	const locks = locking();
	const service = guardRegistrationOperations(
		{
			async write() {
				return "write";
			},
			read() {
				return "read";
			},
			label: "fixture",
		},
		["write"],
		async () => {
			resolutions++;
			return reference;
		},
		locks.run,
	);
	expect(service.read()).toBe("read");
	expect(service.label).toBe("fixture");
	expect(resolutions).toBe(0);
	expect(await service.write()).toBe("write");
	expect(resolutions).toBe(1);
	expect(locks.entries).toHaveLength(1);
});

test("registration without durable lock fails closed before entering service", async () => {
	let calls = 0;
	const service = guardRegistrationOperations(
		{
			async write() {
				calls++;
			},
		},
		["write"],
		resolve,
	);
	await expect(service.write()).rejects.toMatchObject({
		name: "DependencyNotConfiguredError",
		dependency: "appointment-operation-lock",
	});
	await expect(service.write()).rejects.toBeInstanceOf(
		DependencyNotConfiguredError,
	);
	expect(calls).toBe(0);
});

test("nonregistration calls retain all arguments and values without a lock", async () => {
	const value = { marker: "original-value" };
	let received: unknown[] = [];
	const service = guardRegistrationOperations(
		{
			async write(...args: unknown[]) {
				received = args;
				return value;
			},
		},
		["write"],
		async () => undefined,
	);
	const input = { business: "outpatient" };
	expect(await service.write(input, 2, "third")).toBe(value);
	expect(received).toEqual([input, 2, "third"]);
});

test("whole asynchronous operation stays locked until it finishes", async () => {
	const entered = deferred();
	const finish = deferred();
	const locks = locking();
	let calls = 0;
	const service = guardRegistrationOperations(
		{
			async write() {
				calls++;
				if (calls === 1) {
					entered.resolve();
					await finish.promise;
				}
				return calls;
			},
		},
		["write"],
		resolve,
		locks.run,
	);
	const first = service.write();
	await entered.promise;
	const second = service.write();
	await Promise.resolve();
	expect(calls).toBe(1);
	expect(locks.exits).toHaveLength(0);
	finish.resolve();
	await first;
	await second;
	expect(calls).toBe(2);
	expect(locks.entries).toHaveLength(2);
	expect(locks.exits).toHaveLength(2);
});

test("payment winning the shared lock is seen by cancellation before gateway write", async () => {
	const locks = locking();
	const entered = deferred();
	const finish = deferred();
	let paid = false;
	let cancellations = 0;
	const payment = guardRegistrationOperations(
		{
			async create() {
				entered.resolve();
				await finish.promise;
				paid = true;
			},
		},
		["create"],
		resolve,
		locks.run,
	);
	const cancellation = guardRegistrationOperations(
		{
			async cancel() {
				if (paid) throw new Error("payment-already-paid");
				cancellations++;
			},
		},
		["cancel"],
		resolve,
		locks.run,
	);
	const paying = payment.create();
	await entered.promise;
	const cancelling = cancellation.cancel();
	finish.resolve();
	await paying;
	await expect(cancelling).rejects.toThrow("payment-already-paid");
	expect(cancellations).toBe(0);
});

test("cancellation winning the lock prevents queued authorization and creation gateways", async () => {
	const locks = locking();
	const entered = deferred();
	const finish = deferred();
	let cancelled = false;
	let gatewayCalls = 0;
	const cancellation = guardRegistrationOperations(
		{
			async cancel() {
				entered.resolve();
				await finish.promise;
				cancelled = true;
			},
		},
		["cancel"],
		resolve,
		locks.run,
	);
	const payment = guardRegistrationOperations(
		{
			async authorize() {
				if (cancelled) throw new Error("appointment-cancelled");
				gatewayCalls++;
			},
			async create() {
				if (cancelled) throw new Error("appointment-cancelled");
				gatewayCalls++;
			},
		},
		["authorize", "create"],
		resolve,
		locks.run,
	);
	const cancelling = cancellation.cancel();
	await entered.promise;
	const authorization = payment.authorize().then(
		() => undefined,
		(error: unknown) => error,
	);
	const creation = payment.create().then(
		() => undefined,
		(error: unknown) => error,
	);
	await Promise.resolve();
	expect(gatewayCalls).toBe(0);
	finish.resolve();
	await cancelling;
	expect(await authorization).toMatchObject({
		message: "appointment-cancelled",
	});
	expect(await creation).toMatchObject({ message: "appointment-cancelled" });
	expect(gatewayCalls).toBe(0);
});

test("trusted repository async reentry supports nested guarded cancellation callbacks", async () => {
	const locks = locking();
	let gatewayCalls = 0;
	const target = guardRegistrationOperations(
		{
			async cancel(input: unknown) {
				gatewayCalls++;
				return input;
			},
		},
		["cancel"],
		resolve,
		locks.run,
	);
	const orchestration = guardRegistrationOperations(
		{
			async abandon(input: unknown) {
				return target.cancel(input);
			},
		},
		["abandon"],
		resolve,
		locks.run,
	);
	const input = { paymentMode: "auto" };
	expect(await orchestration.abandon(input)).toBe(input);
	expect(locks.entries).toHaveLength(1);
	expect(locks.exits).toHaveLength(1);
	expect(gatewayCalls).toBe(1);
});

test("different appointments and outpatient operations are not held by another appointment", async () => {
	const locks = locking();
	const entered = deferred();
	const finish = deferred();
	const resolver = async (
		input: unknown,
	): Promise<RegistrationOperationReference | undefined> => {
		if (input === "first") return reference;
		if (input === "second")
			return { ...reference, appointmentId: "another-appointment" };
		return undefined;
	};
	const service = guardRegistrationOperations(
		{
			async write(input: string) {
				if (input === "first") {
					entered.resolve();
					await finish.promise;
				}
				return input;
			},
		},
		["write"],
		resolver,
		locks.run,
	);
	const first = service.write("first");
	await entered.promise;
	expect(await service.write("second")).toBe("second");
	expect(await service.write("outpatient")).toBe("outpatient");
	expect(locks.entries).toHaveLength(2);
	finish.resolve();
	await first;
});

test("resolver and lock errors propagate without executing the service", async () => {
	let calls = 0;
	const original = {
		async write() {
			calls++;
		},
	};
	const resolutionError = new Error("server-binding-not-found");
	const resolverGuard = guardRegistrationOperations(
		original,
		["write"],
		async () => {
			throw resolutionError;
		},
		locking().run,
	);
	await expect(resolverGuard.write()).rejects.toBe(resolutionError);
	const busyError = new Error("durable-lock-busy");
	const lockedGuard = guardRegistrationOperations(
		original,
		["write"],
		resolve,
		async () => {
			throw busyError;
		},
	);
	await expect(lockedGuard.write()).rejects.toBe(busyError);
	expect(calls).toBe(0);
});

test("service errors propagate and repository finally releases the lock", async () => {
	const locks = locking();
	const failure = new Error("provider-result-unknown");
	let calls = 0;
	const service = guardRegistrationOperations(
		{
			async write() {
				calls++;
				if (calls === 1) throw failure;
				return "after-error";
			},
		},
		["write"],
		resolve,
		locks.run,
	);
	await expect(service.write()).rejects.toBe(failure);
	expect(await service.write()).toBe("after-error");
	expect(locks.entries).toHaveLength(2);
	expect(locks.exits).toHaveLength(2);
});

test("untrusted bypass markers are never added, consumed or forwarded as reentry authority", async () => {
	const locks = locking();
	const input = {
		orderId: "server-bound-order",
		skipLock: true,
		reentrant: true,
	};
	const snapshot = structuredClone(input);
	let received: unknown;
	const service = guardRegistrationOperations(
		{
			async write(value: unknown) {
				received = value;
			},
		},
		["write"],
		async () => reference,
		locks.run,
	);
	await service.write(input);
	expect(input).toEqual(snapshot);
	expect(received).toBe(input);
	expect(locks.entries).toHaveLength(1);
});

test("method replacement invalidates only its bound cache without editing the prototype", async () => {
	class Service {
		async write() {
			return "original";
		}
	}
	const original = new Service();
	const prototypeMethod = Service.prototype.write;
	const service = guardRegistrationOperations(
		original,
		["write"],
		resolve,
		locking().run,
	);
	const first = service.write;
	original.write = async () => "replacement";
	expect(service.write).not.toBe(first);
	expect(service.write).toBe(service.write);
	expect(await service.write()).toBe("replacement");
	expect(Service.prototype.write).toBe(prototypeMethod);
});

test("symbol-named commands can be guarded", async () => {
	const operation = Symbol("fixture-registration-command");
	const locks = locking();
	const service = guardRegistrationOperations(
		{
			async [operation]() {
				return "ok";
			},
		},
		[operation],
		resolve,
		locks.run,
	);
	expect(await service[operation]()).toBe("ok");
	expect(locks.entries).toHaveLength(1);
});
