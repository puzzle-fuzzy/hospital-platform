import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	cancelRegistration,
	fetchLogPage,
	fetchLogRaw,
	fetchPaymentDay,
	fetchPaymentInterface,
	fetchPaymentOperationDetail,
	fetchPaymentSyncTasks,
	fetchRegistrationStatus,
	fetchWechatRefundPaymentHistory,
	isReadOnlySession,
	loadSession,
	login,
	markPaymentSyncTaskManualReview,
	queryMedicalInsuranceRefund,
	queryPaymentRefund,
	queryWechatRefund,
	requestMedicalInsuranceRefund,
	requestPaymentRefund,
	requestWechatRefund,
	retryPaymentSyncTask,
	saveSession,
} from "./api";
import type { Session } from "./types";

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(
	globalThis,
	"sessionStorage",
);
let stored: Map<string, string>;
beforeEach(() => {
	stored = new Map();
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => stored.get(key) ?? null,
			setItem: (key: string, value: string) => stored.set(key, value),
			removeItem: (key: string) => stored.delete(key),
		},
	});
	globalThis.fetch = (() => {
		throw new Error("Unexpected external request");
	}) as unknown as typeof fetch;
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalStorage)
		Object.defineProperty(globalThis, "sessionStorage", originalStorage);
	else Reflect.deleteProperty(globalThis, "sessionStorage");
});

const operator: Session = {
	accessToken: "synthetic-session",
	refreshToken: "",
	tokenType: "Bearer",
	expiresIn: 3600,
	username: "synthetic-user",
};
const viewer: Session = { ...operator, capabilities: { readOnly: true } };
const captcha = { enabled: true, key: "synthetic-captcha", image: "" };

test("viewer login omits legacy captcha and preserves trusted capability in storage", async () => {
	const calls: { path: unknown; body: unknown }[] = [];
	globalThis.fetch = (async (path, options) => {
		calls.push({ path, body: JSON.parse(String(options?.body)) });
		return Response.json({
			code: 0,
			data: {
				access_token: "synthetic-viewer-session",
				capabilities: { readOnly: true },
			},
		});
	}) as typeof fetch;
	const session = await login(
		{
			loginMode: "viewer",
			username: " synthetic-viewer ",
			password: "synthetic-value",
			captcha: "ignored",
		},
		captcha,
	);
	expect(calls).toEqual([
		{
			path: "/api/auth/login",
			body: {
				loginMode: "viewer",
				username: "synthetic-viewer",
				password: "synthetic-value",
			},
		},
	]);
	expect(isReadOnlySession(session)).toBe(true);
	expect(loadSession()?.capabilities).toEqual({ readOnly: true });
});

test("operator login keeps captcha and legacy sessions without capability keep operator behavior", async () => {
	let body: unknown;
	globalThis.fetch = (async (_path, options) => {
		body = JSON.parse(String(options?.body));
		return Response.json({
			code: 0,
			data: { access_token: "synthetic-operator" },
		});
	}) as typeof fetch;
	const session = await login(
		{ username: "operator", password: "synthetic-value", captcha: " 3 " },
		captcha,
	);
	expect(body).toEqual({
		loginMode: "operator",
		username: "operator",
		password: "synthetic-value",
		captchaKey: "synthetic-captcha",
		captcha: "3",
	});
	expect(isReadOnlySession(session)).toBe(false);
	saveSession(operator);
	expect(loadSession()).toEqual(operator);
});

test.each([undefined, {}, { readOnly: "true" }, { readOnly: false }, null])(
	"viewer login rejects missing or invalid read-only capability: %j",
	async (capabilities) => {
		globalThis.fetch = (async () =>
			Response.json({
				code: 0,
				data: { access_token: "synthetic-session", capabilities },
			})) as unknown as typeof fetch;
		await expect(
			login(
				{ loginMode: "viewer", username: "viewer", password: "synthetic" },
				captcha,
			),
		).rejects.toThrow("权限信息不可用");
		expect(stored.size).toBe(0);
	},
);

test("malformed persisted capabilities discard the session instead of enabling operator UI", () => {
	stored.set(
		"admin.session",
		JSON.stringify({ ...operator, capabilities: { readOnly: "false" } }),
	);
	expect(loadSession()).toBeUndefined();
	expect(stored.has("admin.session")).toBe(false);
});

test("viewer commands, provider-refresh GETs and raw reads stop before fetch", async () => {
	let calls = 0;
	globalThis.fetch = (() => {
		calls++;
		throw new Error("Forbidden request escaped client guard");
	}) as unknown as typeof fetch;
	const operations = [
		() => fetchLogRaw("synthetic-log", viewer),
		() => fetchPaymentInterface("2026-10-20", "synthetic-flow", 1, viewer),
		() => queryWechatRefund("synthetic-refund", viewer),
		() => queryMedicalInsuranceRefund("synthetic-refund", viewer),
		() => queryPaymentRefund("payment_order", "synthetic-order", viewer),
		() => fetchRegistrationStatus("payment_order", "synthetic-order", viewer),
		() =>
			cancelRegistration(
				"payment_order",
				"synthetic-order",
				"合成原因",
				"synthetic-key",
				viewer,
			),
		() =>
			requestWechatRefund(
				{
					source: "payment_order",
					orderId: "synthetic-order",
					refundFen: 1,
					idempotencyKey: "synthetic-key",
				},
				viewer,
			),
		() =>
			requestMedicalInsuranceRefund(
				{ orderId: "synthetic-order", idempotencyKey: "synthetic-key" },
				viewer,
			),
		() =>
			requestPaymentRefund(
				{
					source: "payment_order",
					orderId: "synthetic-order",
					refundType: "ALL",
				},
				viewer,
			),
		() => retryPaymentSyncTask("synthetic-task", viewer),
		() => markPaymentSyncTaskManualReview("synthetic-task", "合成原因", viewer),
	];
	for (const operation of operations) {
		await expect(operation()).rejects.toMatchObject({ status: 403 });
	}
	expect(calls).toBe(0);
});

test("viewer keeps safe logs, payment history, ledger, day metadata and sync list", async () => {
	const paths: string[] = [];
	globalThis.fetch = (async (path) => {
		paths.push(String(path));
		return Response.json({ code: 0, data: { items: [] } });
	}) as typeof fetch;
	await fetchLogPage({ page: 1 }, viewer);
	await fetchWechatRefundPaymentHistory({}, viewer);
	await fetchPaymentOperationDetail("synthetic-aggregate", viewer);
	await fetchPaymentDay("2026-10-20", viewer);
	await fetchPaymentSyncTasks({}, viewer);
	expect(paths).toEqual([
		"/api/logs?page=1",
		"/api/refunds/wechat/payments",
		"/api/refunds/payment-operations/synthetic-aggregate",
		"/api/payments/day?date=2026-10-20",
		"/api/refunds/payment-sync-tasks",
	]);
});

test("operator command remains available without a capability field", async () => {
	let captured: RequestInit | undefined;
	globalThis.fetch = (async (_path, options) => {
		captured = options;
		return Response.json({ code: 0, data: {} });
	}) as typeof fetch;
	await requestPaymentRefund(
		{ source: "payment_order", orderId: "synthetic-order", refundType: "ALL" },
		operator,
	);
	expect(captured?.method).toBe("POST");
	expect(new Headers(captured?.headers).get("authorization")).toBe(
		"Bearer synthetic-session",
	);
});
