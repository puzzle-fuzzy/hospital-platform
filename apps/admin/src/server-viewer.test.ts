import { expect, test } from "bun:test";

// Run the actual server handler in an isolated process with synthetic env only.
// Bun.serve and fetch are replaced before import: no sockets, DB or real HTTP.
const exerciseServer = `
import assert from "node:assert/strict";
let handler;
let sequence = 0;
const calls = [];
const audits = [];
console.info = (value) => audits.push(JSON.parse(value));
Bun.serve = (options) => { handler = options.fetch; return { hostname: "fixture", port: 0 }; };
globalThis.fetch = async (url, init) => {
  calls.push({ path: new URL(url).pathname, headers: new Headers(init.headers), body: String(init.body || "") });
  if (String(url).includes("/system/auth/login")) return Response.json({ code: 0, data: { access_token: "existing-operator-session", token_type: "Bearer", expires_in: 1800 } });
  return Response.json({ code: 0, data: { items: [], total: 0 } });
};
await import(SERVER_URL);
const request = (path, method = "GET", token, body) => {
  sequence++;
  return handler(new Request("https://admin.example" + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), { requestIP: () => ({ address: "fixture-" + sequence }) });
};
const login = (username, password, loginMode) => request("/api/auth/login", "POST", undefined, { username, password, ...(loginMode ? { loginMode } : {}) });
if (Bun.env.VIEWER_TEST_MODE === "disabled") {
  assert.equal((await login("readonly-fixture", "fixture-password", "viewer")).status, 503);
  assert.equal(calls.length, 0);
} else {
  assert.equal((await login("readonly-fixture", "wrong", "viewer")).status, 401);
  assert.equal((await login("READONLY-FIXTURE", "wrong", "operator")).status, 401);
  assert.equal((await login("different-name", "fixture-password", "viewer")).status, 401);
  assert.equal(calls.length, 0);
  const response = await login("readonly-fixture", "fixture-password", "viewer");
  assert.equal(response.status, 200);
  const session = (await response.json()).data;
  assert.deepEqual(session.capabilities, { readOnly: true });
  assert.equal(calls.length, 0);
  const token = session.access_token;
  // Exercise the real public/mini-program authentication service against an
  // isolated empty session store. Issuing a viewer never writes this store.
  const { createRedisSessionTokenService, requirePrincipal } = await import(AUTH_URL);
  let publicWrites = 0;
  const publicSessions = createRedisSessionTokenService({ async save() { publicWrites++; }, async findUserId() { return undefined; } });
  await assert.rejects(requirePrincipal("Bearer " + token, publicSessions), (error) => error.statusCode === 401);
  assert.equal(publicWrites, 0);
  const reads = ["/api/refunds/wechat/payments", "/api/refunds/payment-operations/payagg-" + "a".repeat(56), "/api/refunds/payment-sync-tasks", "/api/logs", "/api/logs/log-1"];
  for (const path of reads) assert.equal((await request(path, "GET", token)).status, 200);
  assert.equal(calls.length, reads.length);
  assert.ok(calls.every((call) => !call.headers.has("authorization")));
  const writes = ["/api/refunds/wechat", "/api/refunds/payment", "/api/refunds/medical-insurance", "/api/refunds/payment-sync-tasks/paysync-1/retry", "/api/refunds/payment-sync-tasks/paysync-1/manual-review", "/api/registrations/payment_order/order-1/cancel", "/api/future-write"];
  const restrictedReads = ["/api/registrations/payment_order/order-1", "/api/refunds/payment/payment_order/order-1", "/api/refunds/wechat/refund-1", "/api/refunds/medical-insurance/refund-1", "/api/logs/log-1/raw", "/api/payments/day/2026-10-20/payment-" + "a".repeat(24) + "/interfaces/1", "/api/v1/patients", "/api/v2/reports", "/api/auth/captcha"];
  for (const path of writes) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await request(path, method, token, { reason: "synthetic" })).status, 403);
  }
  for (const path of restrictedReads) assert.equal((await request(path, "GET", token)).status, 403);
  assert.equal(calls.length, reads.length);
  assert.equal((await request("/api/auth/logout", "POST", token)).status, 200);
  assert.equal((await request("/api/logs", "GET", token)).status, 401);
  assert.equal(calls.length, reads.length);
  assert.ok(!JSON.stringify(calls).includes("fixture-password"));
  assert.ok(audits.some((event) => event.event === "admin.viewer.access.denied"));
}
// Existing operator still authenticates against legacy and can execute the
// same fixed write endpoint with its original legacy session.
const operator = await login("existing-operator", "synthetic-operator-password", "operator");
assert.equal(operator.status, 200);
const op = (await operator.json()).data;
assert.equal(op.access_token, "existing-operator-session");
assert.equal(calls.at(-1).path, "/api/v1/system/auth/login");
const written = await request("/api/refunds/wechat", "POST", op.access_token, { source: "payment_order", orderId: "synthetic-order" });
assert.equal(written.status, 200);
assert.equal(calls.at(-1).path, "/api/v1/admin/wechat-refunds");
assert.equal(calls.at(-1).headers.get("authorization"), "Bearer existing-operator-session");
assert.equal((await request("/api/auth/logout", "POST", op.access_token)).status, 200);
assert.equal(calls.at(-1).path, "/api/v1/system/auth/logout");
assert.equal((await request("/api/logs", "GET", op.access_token)).status, 401);
assert.ok(!calls.some((call) => call.headers.get("authorization")?.includes("admin-viewer.")));
process.stdout.write(JSON.stringify({ passed: true, blockedViewerWrites: Bun.env.VIEWER_TEST_MODE === "disabled" ? 0 : 28, realIO: 0 }));
`;

for (const mode of ["configured", "disabled"] as const) {
	test(`actual admin handler: ${mode} viewer isolated from legacy and operator preserved`, async () => {
		const passwordHash = await Bun.password.hash("fixture-password", {
			algorithm: "argon2id",
			memoryCost: 1024,
			timeCost: 1,
		});
		const result = Bun.spawnSync({
			cmd: [process.execPath, "--no-env-file", "run", "-"],
			stdin: Buffer.from(
				exerciseServer
					.replace(
						"SERVER_URL",
						JSON.stringify(new URL("./server.ts", import.meta.url).href),
					)
					.replace(
						"AUTH_URL",
						JSON.stringify(
							new URL("../../api/src/modules/auth/service.ts", import.meta.url)
								.href,
						),
					),
			),
			env: {
				VIEWER_TEST_MODE: mode,
				ADMIN_VIEWER_USERNAME: mode === "configured" ? "readonly-fixture" : "",
				ADMIN_VIEWER_PASSWORD_HASH: mode === "configured" ? passwordHash : "",
				LEGACY_HOSPITAL_API_BASE_URL: "https://legacy.example/api/v1",
				ADMIN_LOGS_API_BASE_URL: "https://internal.example/api/v1",
				ADMIN_LOGS_API_TOKEN: "synthetic-internal-logs-token",
				ADMIN_REFUNDS_API_BASE_URL: "https://internal.example/api/v1",
				ADMIN_REFUNDS_API_TOKEN: "synthetic-internal-refunds-token",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.stderr.toString()).toBe("");
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.toString())).toMatchObject({
			passed: true,
			realIO: 0,
		});
	});
}
