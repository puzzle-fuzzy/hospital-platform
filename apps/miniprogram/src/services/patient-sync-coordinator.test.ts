import { expect, test } from "bun:test";
import {
	isPatientSyncInFlight,
	runPatientSync,
} from "./patient-sync-coordinator";
import type { Patient } from "../types";

test("患者同步协调器跨页面实例复用同一在途 Promise", async () => {
	let factoryCalls = 0;
	let resolvePending: ((patients: Array<Patient>) => void) | undefined;
	const pending = new Promise<Array<Patient>>((resolve) => {
		resolvePending = resolve;
	});

	const first = runPatientSync(async () => {
		factoryCalls += 1;
		return pending;
	});
	const second = runPatientSync(async () => {
		factoryCalls += 1;
		return [
			{
				id: "should-not-start",
				displayName: "不应发起",
				relationship: "other",
				cardNumberMasked: "******0000",
				source: "legacy-record",
			},
		];
	});

	expect(second).toBe(first);
	expect(factoryCalls).toBe(0);
	expect(isPatientSyncInFlight()).toBe(true);
	resolvePending?.([
		{
			id: "patient-001",
			displayName: "患者一",
			relationship: "self",
			cardNumberMasked: "******0001",
			source: "hospital-his",
		},
	]);
	expect(await first).toEqual([
		{
			id: "patient-001",
			displayName: "患者一",
			relationship: "self",
			cardNumberMasked: "******0001",
			source: "hospital-his",
		},
	]);
	expect(isPatientSyncInFlight()).toBe(false);
	expect(
		await runPatientSync(async () => [
			{
				id: "patient-002",
				displayName: "患者二",
				relationship: "child",
				cardNumberMasked: "******0002",
				source: "hospital-his",
			},
		]),
	).toEqual([
		{
			id: "patient-002",
			displayName: "患者二",
			relationship: "child",
			cardNumberMasked: "******0002",
			source: "hospital-his",
		},
	]);
});
