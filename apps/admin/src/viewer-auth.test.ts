import { describe, expect, test } from "bun:test";
import {
	type AdminViewerAudit,
	AdminViewerAuthError,
	createAdminViewerAuth,
	isAdminViewerReadRoute,
} from "./viewer-auth";

const syntheticHash = "$argon2id$synthetic-test-verifier";
const safeRoutes = [
	"/api/refunds/wechat/payments?page=1",
	`/api/refunds/payment-operations/payagg-${"a".repeat(56)}`,
	"/api/refunds/payment-sync-tasks",
	"/api/payments/day?date=2026-10-20",
	"/api/logs?page=1",
	"/api/logs/log-1",
];
const prohibitedRoutes = [
	"/api/refunds/wechat",
	"/api/refunds/payment",
	"/api/refunds/medical-insurance",
	"/api/refunds/payment-sync-tasks/paysync-1/retry",
	"/api/refunds/payment-sync-tasks/paysync-1/manual-review",
	"/api/registrations/payment_order/order-1/cancel",
	"/api/registrations/payment_order/order-1",
	"/api/refunds/payment/payment_order/order-1",
	"/api/refunds/wechat/refund-1",
	"/api/refunds/medical-insurance/refund-1",
	"/api/logs/log-1/raw",
	`/api/payments/day/2026-10-20/payment-${"a".repeat(24)}/interfaces/1`,
	"/api/auth/captcha",
	"/api/auth/login",
	"/api/v1/patients",
	"/api/v2/reports",
	"/api/future-route",
];

function fixture() {
	let time = 1_000;
	let sequence = 0;
	const auth = createAdminViewerAuth({
		username: "readonly-viewer",
		passwordHash: syntheticHash,
		now: () => time,
		verify: async (password, hash) =>
			password === " synthetic-password " && hash === syntheticHash,
		createToken: () => `synthetic-token-${++sequence}`,
	});
	return {
		auth,
		advance: (ms: number) => {
			time += ms;
		},
	};
}

async function authenticated() {
	const f = fixture();
	const session = await f.auth.login({
		username: "readonly-viewer",
		password: " synthetic-password ",
		loginMode: "viewer",
	});
	if (!session) throw new Error("fixture login missing");
	const request = (path: string, method = "GET") =>
		new Request(`https://admin.example${path}`, {
			method,
			headers: { Authorization: `Bearer ${session.access_token}` },
		});
	return { ...f, session, request };
}

describe("independent readonly admin sessions", () => {
	test("real Argon2id verification, opaque unique tokens, and no password normalization", async () => {
		const hash = await Bun.password.hash(" synthetic-password ", {
			algorithm: "argon2id",
			memoryCost: 1024,
			timeCost: 1,
		});
		const auth = createAdminViewerAuth({
			username: "readonly-viewer",
			passwordHash: hash,
		});
		const input = {
			username: "readonly-viewer",
			password: " synthetic-password ",
			loginMode: "viewer",
		};
		const first = await auth.login(input);
		const second = await auth.login(input);
		expect(first?.access_token).toMatch(/^admin-viewer\.[A-Za-z0-9_-]{43}$/u);
		expect(second?.access_token).not.toBe(first?.access_token);
		expect(first?.capabilities).toEqual({ readOnly: true });
		expect(first?.expires_in).toBe(1800);
		await expect(
			auth.login({ ...input, password: "synthetic-password" }),
		).rejects.toMatchObject({ status: 401 });
	});

	test("viewer intent with missing, partial, invalid hash config never falls back", async () => {
		for (const config of [
			{},
			{ username: "readonly-viewer" },
			{ passwordHash: syntheticHash },
			{ username: "readonly-viewer", passwordHash: "$2b$not-argon2id" },
		]) {
			const auth = createAdminViewerAuth(config);
			await expect(
				auth.login({
					username: "readonly-viewer",
					password: "secret",
					loginMode: "viewer",
				}),
			).rejects.toMatchObject({ status: 503 });
		}
	});

	test("configured viewer username cannot use operator fallback; unrelated operator unchanged", async () => {
		const { auth } = fixture();
		await expect(
			auth.login({
				username: "READONLY-VIEWER",
				password: "wrong",
				loginMode: "operator",
			}),
		).rejects.toMatchObject({ status: 401 });
		await expect(
			auth.login({
				username: "unknown",
				password: "wrong",
				loginMode: "viewer",
			}),
		).rejects.toMatchObject({ status: 401 });
		expect(
			await auth.login({
				username: "existing-operator",
				password: "operator-secret",
			}),
		).toBeUndefined();
	});

	test("safe GETs retain a server readonly principal; every other method or route denied", async () => {
		const { auth, request } = await authenticated();
		for (const path of safeRoutes) {
			expect(auth.principal(request(path))).toMatchObject({
				kind: "viewer",
				readOnly: true,
			});
			expect(() => auth.authorize(request(path))).not.toThrow();
			for (const method of [
				"POST",
				"PUT",
				"PATCH",
				"DELETE",
				"HEAD",
				"OPTIONS",
			]) {
				expect(() => auth.authorize(request(path, method))).toThrow(
					AdminViewerAuthError,
				);
			}
		}
		for (const path of prohibitedRoutes) {
			for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
				try {
					auth.authorize(request(path, method));
					throw new Error("unexpected permission");
				} catch (error) {
					expect(error).toMatchObject({ status: 403 });
				}
			}
		}
	});

	test("expiry, fabricated tokens, and logout revoke locally; operator requests unaffected", async () => {
		const { auth, advance, request } = await authenticated();
		advance(1800_000);
		expect(() => auth.authorize(request("/api/logs"))).toThrow(
			"只读会话已失效",
		);
		const fresh = await authenticated();
		expect(() =>
			fresh.auth.authorize(fresh.request("/api/auth/logout", "POST")),
		).not.toThrow();
		expect(fresh.auth.logout(fresh.request("/api/auth/logout", "POST"))).toBe(
			true,
		);
		expect(() => fresh.auth.authorize(fresh.request("/api/logs"))).toThrow(
			"只读会话已失效",
		);
		const forged = new Request("https://admin.example/api/logs", {
			headers: { Authorization: "Bearer admin-viewer.fabricated" },
		});
		expect(() => auth.authorize(forged)).toThrow("只读会话已失效");
		const operator = new Request("https://admin.example/api/refunds/payment", {
			method: "POST",
			headers: { Authorization: "Bearer operator-session" },
		});
		expect(() => auth.authorize(operator)).not.toThrow();
		expect(auth.principal(operator)).toBeUndefined();
	});

	test("read whitelist rejects encoded and suffix route variants", () => {
		for (const path of [
			"/api/logs/",
			"/api/logs/log-1/raw",
			"/api/%6cogs",
			"/api/logs/log-0",
			"/api/logs/log-1/other",
		]) {
			expect(isAdminViewerReadRoute("GET", path)).toBe(false);
		}
	});

	test("audit events contain only fixed actor, method and resource without identifiers or query strings", async () => {
		const events: AdminViewerAudit[] = [];
		let time = 0;
		const auth = createAdminViewerAuth({
			username: "sensitive-username",
			passwordHash: syntheticHash,
			verify: async (password) => password === "sensitive-password",
			now: () => time,
			createToken: () => "sensitive-token",
			onAudit: (event) => events.push(event),
		});
		await expect(
			auth.login({
				username: "sensitive-username",
				password: "bad",
				loginMode: "viewer",
			}),
		).rejects.toThrow();
		const session = await auth.login({
			username: "sensitive-username",
			password: "sensitive-password",
			loginMode: "viewer",
		});
		if (!session) throw new Error("missing session");
		const request = (path: string, method = "GET") =>
			new Request(`https://admin.example${path}`, {
				method,
				headers: { Authorization: `Bearer ${session.access_token}` },
			});
		auth.authorize(request("/api/logs?traceId=sensitive-query"));
		expect(() =>
			auth.authorize(
				request(
					"/api/registrations/payment_order/sensitive-order/cancel",
					"POST",
				),
			),
		).toThrow();
		time = 1800_000;
		expect(() => auth.authorize(request("/api/logs/log-123"))).toThrow();
		expect(events.map((event) => event.event)).toEqual([
			"admin.viewer.login.rejected",
			"admin.viewer.login.succeeded",
			"admin.viewer.read",
			"admin.viewer.access.denied",
			"admin.viewer.session.expired",
		]);
		expect(JSON.stringify(events)).not.toContain("sensitive-");
		expect(JSON.stringify(events)).not.toContain("123");
		expect(events.every((event) => event.actor === "admin-viewer")).toBe(true);
	});
});
