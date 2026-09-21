import { expect, test } from "bun:test";
import type { MedicalInsuranceRefundPayload } from "@hospital/contracts";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { requestContextPlugin } from "../../plugins/request-context";
import { hisMedicalInsuranceRefundModule, hisRefundSignature } from "./refunds";

const token = "his-token-test";
const hmacSecret = "his-hmac-secret-test";
const now = 1_758_000_000_000;

function createSecurityStore() {
	const nonces = new Set<string>();
	let count = 0;
	return {
		reserveNonce(nonce: string) {
			if (nonces.has(nonce)) return Promise.resolve(false);
			nonces.add(nonce);
			return Promise.resolve(true);
		},
		incrementRateLimit() {
			count += 1;
			return Promise.resolve(count);
		},
	};
}

function requestFor(
	method: "POST" | "GET",
	path: string,
	body: unknown,
	nonce: string,
): Request {
	const timestamp = String(Math.floor(now / 1000));
	const requestId = "his-test-request-001";
	const signature = hisRefundSignature({
		method,
		path,
		timestamp,
		nonce,
		requestId,
		body,
		hmacSecret,
	});
	return new Request(`http://localhost/api/v1${path}`, {
		method,
		headers: {
			"content-type": "application/json",
			"x-real-ip": "124.164.248.83",
			"x-his-refund-token": token,
			"x-his-timestamp": timestamp,
			"x-his-nonce": nonce,
			"x-his-signature": signature,
			"x-request-id": requestId,
		},
		...(method === "POST" ? { body: JSON.stringify(body) } : {}),
	});
}

test("HIS refund route verifies source, signature and reserves nonce", async () => {
	const security = createSecurityStore();
	const calls: unknown[] = [];
	const service = {
		async requestFullRefundByOrder(
			input: unknown,
		): Promise<MedicalInsuranceRefundPayload["data"]> {
			calls.push(input);
			return {
				orderId: "order-1",
				refundNo: "refund-1",
				status: "succeeded",
				medicalStatus: "success",
				wechatStatus: "success",
				amounts: {
					totalFen: 100,
					cashFen: 40,
					personalAccountFen: 0,
					fundFen: 60,
				},
			};
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);

	const response = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-refunds",
			{ orderId: "order-1", reason: "test" },
			"nonce-000000000001",
		),
	);
	const payload = (await response.json()) as { data: { status: string } };
	expect(response.status).toBe(200);
	expect(payload.data.status).toBe("succeeded");
	expect(calls).toHaveLength(1);
	expect(calls[0]).toMatchObject({
		orderId: "order-1",
		operatorRef: "his-refund",
		context: { traceId: "his-test-request-001" },
	});
});

test("HIS refund route rejects a replayed nonce before calling refund service", async () => {
	const security = createSecurityStore();
	let calls = 0;
	const service = {
		async requestFullRefundByOrder(): Promise<
			MedicalInsuranceRefundPayload["data"]
		> {
			calls += 1;
			return {
				orderId: "order-1",
				refundNo: "refund-1",
				status: "processing",
				medicalStatus: "processing",
				wechatStatus: "processing",
				amounts: {
					totalFen: 100,
					cashFen: 40,
					personalAccountFen: 0,
					fundFen: 60,
				},
			};
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);
	const first = requestFor(
		"POST",
		"/his/medical-insurance-refunds",
		{ orderId: "order-1" },
		"nonce-000000000002",
	);
	const firstResponse = await app.handle(first);
	const secondResponse = await app.handle(
		requestFor(
			"POST",
			"/his/medical-insurance-refunds",
			{ orderId: "order-1" },
			"nonce-000000000002",
		),
	);
	expect(firstResponse.status).toBe(200);
	expect(secondResponse.status).toBe(409);
	expect(calls).toBe(1);
});

test("HIS refund route rejects an unexpected source IP", async () => {
	const security = createSecurityStore();
	const service = {
		async requestFullRefundByOrder() {
			throw new Error("must not call service");
		},
		async query() {
			return undefined;
		},
	};
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(service, {
					token,
					hmacSecret,
					security,
					now: () => now,
				}),
			),
		);
	const request = requestFor(
		"POST",
		"/his/medical-insurance-refunds",
		{ orderId: "order-1" },
		"nonce-000000000003",
	);
	request.headers.set("x-real-ip", "10.0.0.3");
	const response = await app.handle(request);
	expect(response.status).toBe(403);
});
