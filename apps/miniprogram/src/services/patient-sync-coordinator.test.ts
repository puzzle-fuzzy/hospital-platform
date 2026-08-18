import { expect, test } from "bun:test";
import {
	isPatientSyncInFlight,
	runPatientSync,
} from "./patient-sync-coordinator";
import { advanceSessionGeneration } from "./session-generation";
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
				clinicalAccess: "unavailable",
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
			clinicalAccess: "ready",
		},
	]);
	expect(await first).toEqual([
		{
			id: "patient-001",
			displayName: "患者一",
			relationship: "self",
			cardNumberMasked: "******0001",
			source: "hospital-his",
			clinicalAccess: "ready",
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
				clinicalAccess: "ready",
			},
		]),
	).toEqual([
		{
			id: "patient-002",
			displayName: "患者二",
			relationship: "child",
			cardNumberMasked: "******0002",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);
});

test("患者同步协调器不会跨会话代际复用旧患者快照", async () => {
	let resolveOld: ((patients: Array<Patient>) => void) | undefined;
	const oldSession = new Promise<Array<Patient>>((resolve) => {
		resolveOld = resolve;
	});

	const oldRequest = runPatientSync(() => oldSession);
	advanceSessionGeneration();

	const newRequest = runPatientSync(async () => [
		{
			id: "new-session-patient",
			displayName: "新会话患者",
			relationship: "self",
			cardNumberMasked: "******0002",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);

	expect(newRequest).not.toBe(oldRequest);
	expect(await newRequest).toHaveLength(1);
	resolveOld?.([
		{
			id: "old-session-patient",
			displayName: "旧会话患者",
			relationship: "self",
			cardNumberMasked: "******0001",
			source: "hospital-his",
			clinicalAccess: "ready",
		},
	]);
	await expect(oldRequest).rejects.toMatchObject({ code: "session-changed" });
	expect(isPatientSyncInFlight()).toBe(false);
});
