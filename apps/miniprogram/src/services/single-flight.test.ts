import { expect, test } from "bun:test";
import { createSingleFlight } from "./single-flight";

test("single-flight reuses a pending operation and releases after success", async () => {
	const flight = createSingleFlight<number>();
	let calls = 0;
	let resolvePending: ((value: number) => void) | undefined;
	const pending = new Promise<number>((resolve) => {
		resolvePending = resolve;
	});

	const first = flight.run(async () => {
		calls += 1;
		return pending;
	});
	const second = flight.run(async () => {
		calls += 1;
		return 99;
	});

	expect(second).toBe(first);
	expect(calls).toBe(0);
	expect(flight.isRunning()).toBe(true);
	resolvePending?.(7);
	expect(await first).toBe(7);
	expect(flight.isRunning()).toBe(false);

	await expect(
		flight.run(async () => {
			calls += 1;
			return 8;
		}),
	).resolves.toBe(8);
	expect(calls).toBe(2);
});

test("single-flight releases after rejection so a later retry can run", async () => {
	const flight = createSingleFlight<number>();
	let calls = 0;
	const failure = new Error("temporary failure");

	await expect(
		flight.run(async () => {
			calls += 1;
			throw failure;
		}),
	).rejects.toBe(failure);
	expect(flight.isRunning()).toBe(false);

	await expect(
		flight.run(async () => {
			calls += 1;
			return 1;
		}),
	).resolves.toBe(1);
	expect(calls).toBe(2);
});
