import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createAdminRegistrationProxy } from "./registration-proxy";

function fixture(
	options: { authenticated?: boolean; configured?: boolean } = {},
) {
	const calls: Array<{ path: string; init: RequestInit }> = [];
	let bodyReads = 0;
	const handler = createAdminRegistrationProxy({
		authorize(request) {
			if (
				options.authenticated === false ||
				request.headers.get("authorization") !== "Bearer valid-session"
			)
				throw new Error("UNAUTHORIZED");
			return "Bearer valid-session";
		},
		async readBody(request) {
			bodyReads++;
			return (await request.json()) as Record<string, unknown>;
		},
		upstream:
			options.configured === false
				? undefined
				: new URL("https://internal.example/api/v1"),
		token: "internal-only-secret",
		async forward(_base, path, init) {
			calls.push({ path, init });
			return Response.json({ code: 0, data: { outcome: "cancelled" } });
		},
		error(message, status) {
			return Response.json({ message }, { status });
		},
	});
	const request = (
		body: unknown = { reason: "患者申请取消" },
		headers: Record<string, string> = {},
	) =>
		new Request(
			"https://admin.example/api/registrations/payment_order/order-1/cancel",
			{
				method: "POST",
				headers: {
					authorization: "Bearer valid-session",
					"idempotency-key": "admin-cancel:stable-1",
					...headers,
				},
				body: JSON.stringify(body),
			},
		);
	return { handler, calls, request, bodyReads: () => bodyReads };
}

describe("fixed admin registration proxy", () => {
	test("requires an active session before inspecting body or upstream configuration", async () => {
		const f = fixture({ authenticated: false, configured: false });
		await expect(
			f.handler(f.request(), "payment_order", "order-1", true),
		).rejects.toThrow("UNAUTHORIZED");
		expect(f.bodyReads()).toBe(0);
		expect(f.calls).toHaveLength(0);
	});
	test("overwrites forged operator and internal-token headers and forwards only reason", async () => {
		const f = fixture();
		const response = await f.handler(
			f.request(
				{ reason: "  患者申请取消  " },
				{
					"x-admin-operator-ref": "forged-admin",
					"x-admin-refund-token": "forged-token",
				},
			),
			"payment_order",
			"order:1",
			true,
		);
		expect(response.status).toBe(200);
		expect(await response.text()).not.toContain("internal-only-secret");
		expect(f.calls[0]?.path).toBe(
			"/admin/registrations/payment_order/order%3A1/cancel",
		);
		const headers = new Headers(f.calls[0]?.init.headers);
		expect(headers.get("authorization")).toBeNull();
		expect(headers.get("x-admin-refund-token")).toBe("internal-only-secret");
		expect(headers.get("x-admin-operator-ref")).toBe(
			`admin-session:${createHash("sha256").update("valid-session").digest("hex").slice(0, 40)}`,
		);
		expect(headers.get("idempotency-key")).toBe("admin-cancel:stable-1");
		expect(JSON.parse(String(f.calls[0]?.init.body))).toEqual({
			reason: "患者申请取消",
		});
	});
	test("retains the same command identity across an explicit retry", async () => {
		const f = fixture();
		await f.handler(f.request(), "medical_insurance", "medical-1", true);
		await f.handler(f.request(), "medical_insurance", "medical-1", true);
		expect(
			f.calls.map((call) =>
				new Headers(call.init.headers).get("idempotency-key"),
			),
		).toEqual(["admin-cancel:stable-1", "admin-cancel:stable-1"]);
	});
	test.each([
		{ reason: "短" },
		{ reason: "   " },
		{ reason: "长".repeat(81) },
		{ reason: "原因\n注入" },
		{ reason: 12 },
		{ reason: "取消申请", ownerUserId: "forged-owner" },
	])("rejects non-whitelisted or invalid bodies: %j", async (body) => {
		const f = fixture();
		expect(
			(await f.handler(f.request(body), "payment_order", "order-1", true))
				.status,
		).toBe(400);
		expect(f.calls).toHaveLength(0);
	});
	test("requires a bounded idempotency key before reading cancellation body", async () => {
		for (const key of ["", "bad/key", "x".repeat(129)]) {
			const f = fixture();
			expect(
				(
					await f.handler(
						f.request(undefined, { "idempotency-key": key }),
						"payment_order",
						"order-1",
						true,
					)
				).status,
			).toBe(400);
			expect(f.bodyReads()).toBe(0);
			expect(f.calls).toHaveLength(0);
		}
	});
	test.each([
		["other", "order-1"],
		["payment_order", "../cancel"],
		["payment_order", "%2Fadmin%2Felse"],
		["payment_order", "%"],
		["payment_order", "x".repeat(65)],
	])("rejects arbitrary target %s %s", async (source, orderId) => {
		const f = fixture();
		expect((await f.handler(f.request(), source, orderId, true)).status).toBe(
			400,
		);
		expect(f.calls).toHaveLength(0);
	});
	test("GET forwards a fixed read path without a body, and rejects extra queries", async () => {
		const f = fixture();
		expect(
			(
				await f.handler(
					new Request(
						"https://admin.example/api/registrations/payment_order/order-1",
						{ headers: { authorization: "Bearer valid-session" } },
					),
					"payment_order",
					"order-1",
					false,
				)
			).status,
		).toBe(200);
		expect(f.calls[0]?.path).toBe("/admin/registrations/payment_order/order-1");
		expect(f.calls[0]?.init.method).toBe("GET");
		expect(f.calls[0]?.init.body).toBeUndefined();
		expect(f.bodyReads()).toBe(0);
		expect(
			(
				await f.handler(
					new Request(
						"https://admin.example/api/registrations/payment_order/order-1?ownerUserId=someone",
						{ headers: { authorization: "Bearer valid-session" } },
					),
					"payment_order",
					"order-1",
					false,
				)
			).status,
		).toBe(400);
		expect(f.calls).toHaveLength(1);
	});
});
