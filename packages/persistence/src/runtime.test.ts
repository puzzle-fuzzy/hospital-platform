import { expect, test } from "bun:test";
import { createLogger } from "@hospital/observability";
import {
	createPersistenceProbeStateTracker,
	createPersistenceRuntime,
	probeMySqlReadOnly,
	safeErrorMetadata,
} from "./runtime";

test("persistence runtime stays explicit when URLs are not configured", async () => {
	const runtime = createPersistenceRuntime({
		databaseUrl: undefined,
		redisUrl: undefined,
		useRepositories: false,
	});

	expect(await runtime.database.check()).toBe("not_configured");
	expect(await runtime.redis.check()).toBe("not_configured");
	expect(await runtime.schema.check()).toBe("not_configured");
	await runtime.close();
});

test("persistence probe logs only unavailable and recovery transitions", () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "persistence-test",
		environment: "test",
		level: "info",
		destination: { write: (chunk: string) => lines.push(chunk) },
	});
	const trackProbeState = createPersistenceProbeStateTracker(
		logger,
		"database",
	);

	trackProbeState("ok");
	trackProbeState("ok");
	trackProbeState("unavailable", {
		errorType: "Error",
		operation: "mysql.health_check",
	});
	trackProbeState("unavailable", {
		errorType: "LeakedError",
		operation: "mysql.health_check",
	});
	trackProbeState("ok");
	trackProbeState("ok");

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toHaveLength(2);
	expect(records[0]).toMatchObject({
		event: "persistence.probe.unavailable",
		dependency: "database",
		errorType: "Error",
		operation: "mysql.health_check",
	});
	expect(records[1]).toMatchObject({
		event: "persistence.probe.recovered",
		dependency: "database",
	});
	expect(JSON.stringify(records)).not.toContain("LeakedError");
});

test("persistence probe keeps only a safe infrastructure error code", () => {
	const transientError = Object.assign(new Error("connection details"), {
		code: "PROTOCOL_CONNECTION_LOST",
	});
	const unsafeError = Object.assign(new Error("password=must-not-log"), {
		code: "password=must-not-log",
	});

	expect(safeErrorMetadata(transientError)).toEqual({
		errorType: "Error",
		errorCode: "PROTOCOL_CONNECTION_LOST",
	});
	expect(safeErrorMetadata(unsafeError)).toEqual({ errorType: "Error" });
});

test("MySQL read-only probes retry once without replaying a business operation", async () => {
	let calls = 0;
	const attempts = await probeMySqlReadOnly(
		async () => {
			calls += 1;
			if (calls === 1) throw new Error("stale pooled connection");
		},
		{ attempts: 2, delayMs: 0 },
	);

	expect(attempts).toBe(2);
	expect(calls).toBe(2);
});

test("MySQL read-only probes remain failed after the bounded retry", async () => {
	let calls = 0;
	await expect(
		probeMySqlReadOnly(
			async () => {
				calls += 1;
				throw new Error("database unavailable");
			},
			{ attempts: 2, delayMs: 0 },
		),
	).rejects.toThrow("database unavailable");
	expect(calls).toBe(2);
});
