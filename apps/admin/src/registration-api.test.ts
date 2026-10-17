import { afterEach, expect, test } from "bun:test";
import { cancelRegistration, fetchRegistrationStatus } from "./api";
import type { Session } from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});
const session: Session = {
	accessToken: "test-session",
	refreshToken: "",
	tokenType: "Bearer",
	expiresIn: 3600,
	username: "test-admin",
};

test("registration status reads one encoded order with current session and no body", async () => {
	let captured: { path: unknown; options?: RequestInit } | undefined;
	globalThis.fetch = (async (path, options) => {
		captured = { path, ...(options ? { options } : {}) };
		return Response.json({
			code: 0,
			data: {
				source: "payment_order",
				orderId: "order-1",
				registration: { localStatus: "booked" },
			},
		});
	}) as typeof fetch;
	await fetchRegistrationStatus("payment_order", "order:1", session);
	expect(captured?.path).toBe("/api/registrations/payment_order/order%3A1");
	expect(new Headers(captured?.options?.headers).get("authorization")).toBe(
		"Bearer test-session",
	);
	expect(captured?.options?.body).toBeUndefined();
	expect(captured?.options?.cache).toBe("no-store");
});

test("explicit cancellation retries send the original command key and reason only", async () => {
	const calls: RequestInit[] = [];
	globalThis.fetch = (async (path, options) => {
		expect(path).toBe("/api/registrations/medical_insurance/order-1/cancel");
		calls.push(options || {});
		if (calls.length === 1) throw new TypeError("network response lost");
		return Response.json({
			code: 0,
			data: {
				source: "medical_insurance",
				orderId: "order-1",
				outcome: "already_cancelled",
				registration: { localStatus: "cancelled" },
			},
		});
	}) as typeof fetch;
	await expect(
		cancelRegistration(
			"medical_insurance",
			"order-1",
			"患者申请取消",
			"admin-cancel:original",
			session,
		),
	).rejects.toThrow("network response lost");
	await cancelRegistration(
		"medical_insurance",
		"order-1",
		"患者申请取消",
		"admin-cancel:original",
		session,
	);
	for (const call of calls) {
		expect(call.method).toBe("POST");
		expect(new Headers(call.headers).get("idempotency-key")).toBe(
			"admin-cancel:original",
		);
		expect(new Headers(call.headers).get("x-admin-operator-ref")).toBeNull();
		expect(new Headers(call.headers).get("x-admin-refund-token")).toBeNull();
		expect(JSON.parse(String(call.body))).toEqual({ reason: "患者申请取消" });
	}
});
