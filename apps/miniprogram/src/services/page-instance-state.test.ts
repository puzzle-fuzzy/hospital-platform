import { expect, test } from "bun:test";
import {
	disposePageInstance,
	getPageLatestRequestGuard,
	getPageLifecycle,
	getPageSingleFlight,
	invalidatePageRequests,
} from "./page-instance-state";

test("page request guards are isolated between page instances", () => {
	const firstPage = {};
	const secondPage = {};
	const firstGuard = getPageLatestRequestGuard(firstPage, "patients");
	const secondGuard = getPageLatestRequestGuard(secondPage, "patients");

	const firstToken = firstGuard.begin();
	secondGuard.begin();

	// 第二个页面实例的刷新不能让第一个实例的请求失去回写资格。
	expect(firstGuard.isCurrent(firstToken)).toBe(true);
	expect(firstGuard).toBe(getPageLatestRequestGuard(firstPage, "patients"));
	expect(firstGuard).not.toBe(secondGuard);
});

test("page single-flight locks are isolated between page instances", async () => {
	const firstPage = {};
	const secondPage = {};
	const firstFlight = getPageSingleFlight<number>(firstPage, "patient-sync");
	const secondFlight = getPageSingleFlight<number>(secondPage, "patient-sync");

	let resolveFirst: ((value: number) => void) | undefined;
	const firstPending = new Promise<number>((resolve) => {
		resolveFirst = resolve;
	});
	const firstRequest = firstFlight.run(() => firstPending);
	const secondRequest = secondFlight.run(async () => 2);

	expect(firstRequest).not.toBe(secondRequest);
	expect(await secondRequest).toBe(2);
	resolveFirst?.(1);
	expect(await firstRequest).toBe(1);
	// 同一页面实例内仍然复用同一个对象，下一次请求才会重新执行。
	expect(firstFlight).toBe(
		getPageSingleFlight<number>(firstPage, "patient-sync"),
	);
});

test("disposing a page invalidates its pending request guards", () => {
	const page = {};
	const guard = getPageLatestRequestGuard(page, "patients");
	const token = guard.begin();

	expect(getPageLifecycle(page).isActive()).toBe(true);
	expect(guard.isCurrent(token)).toBe(true);

	disposePageInstance(page);

	expect(getPageLifecycle(page).isActive()).toBe(false);
	expect(guard.isCurrent(token)).toBe(false);
});

test("invalidating page requests keeps the page alive but rejects old tokens", () => {
	const page = {};
	const firstGuard = getPageLatestRequestGuard(page, "patients");
	const secondGuard = getPageLatestRequestGuard(page, "profile");
	const firstToken = firstGuard.begin();
	const secondToken = secondGuard.begin();

	invalidatePageRequests(page);

	expect(getPageLifecycle(page).isActive()).toBe(true);
	expect(firstGuard.isCurrent(firstToken)).toBe(false);
	expect(secondGuard.isCurrent(secondToken)).toBe(false);
	const nextToken = firstGuard.begin();
	expect(firstGuard.isCurrent(nextToken)).toBe(true);
});
