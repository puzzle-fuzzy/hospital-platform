import { expect, test } from "bun:test";
import { createFixtureWechatIdentityGateway } from "@hospital/adapters";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentQuoteRepository,
} from "@hospital/persistence";
import { PaymentOrderService } from "@hospital/domain";
import { createApp } from "./app";
import { createReadinessService } from "./infrastructure/readiness";
import { AuthService, createInMemorySessionTokenService } from "./modules/auth";
import { PatientService } from "./modules/patients";

test("liveness endpoint returns a contract response", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/health/live"),
	);
	const body = (await response.json()) as {
		success: boolean;
		data: { status: string; service: string; version: string };
	};

	expect(response.status).toBe(200);
	expect(body).toEqual({
		success: true,
		data: {
			status: "ok",
			service: "hospital-api",
			version: "0.1.0",
		},
	});
});

test("versioned ping endpoint is available", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/system/ping"),
	);

	expect(response.status).toBe(200);
	expect((await response.json()).success).toBe(true);
});

test("readiness reports configured dependencies as unavailable until probes pass", async () => {
	const readiness = createReadinessService({
		databaseConfigured: true,
		redisConfigured: false,
	});
	const response = await createApp({ readiness }).handle(
		new Request("http://localhost/health/ready"),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		success: true,
		data: {
			status: "not_ready",
			dependencies: {
				database: "unavailable",
				redis: "not_configured",
			},
		},
	});
});

test("request context preserves a safe incoming request id", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/health/live", {
			headers: { "x-request-id": "test-trace-001" },
		}),
	);

	expect(response.headers.get("x-request-id")).toBe("test-trace-001");
});

test("default auth dependency fails closed instead of issuing a fake token", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: "real-wechat-code" }),
		}),
	);

	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "dependency-not-configured",
			message: "Required service dependency is not configured",
		},
	});
});

test("wechat login and patient list keep identity ownership on the server", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const identityGateway = createFixtureWechatIdentityGateway();
	const patientRepository = createInMemoryPatientRepository([
		{
			id: "patient-001",
			ownerUserId: "fixture-user-0001",
			displayName: "测试患者",
			relationship: "self",
			cardNumberMasked: "****001",
			source: "legacy-record",
		},
	]);
	const services = {
		auth: new AuthService({ identityGateway, identityUsers, sessions }),
		patients: new PatientService(patientRepository),
		paymentOrders: new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository(),
			quotes: createInMemoryPaymentQuoteRepository([
				{
					quoteId: "quote-001",
					ownerUserId: "fixture-user-0001",
					patientId: "patient-001",
					amounts: {
						totalFen: 1000,
						insuranceFen: 700,
						cashFen: 300,
					},
					expiresAt: "2099-08-15T00:00:00.000Z",
					source: "fixture",
				},
			]),
		}),
		sessions,
	};
	const app = createApp({ services });

	const loginResponse = await app.handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "fixture-login-trace",
				"idempotency-key": "fixture-login-idempotency",
			},
			body: JSON.stringify({ code: "fixture-code" }),
		}),
	);
	const loginBody = (await loginResponse.json()) as {
		success: boolean;
		data: { accessToken: string; user: { id: string } };
	};

	const patientsResponse = await app.handle(
		new Request("http://localhost/api/v1/patients", {
			headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
		}),
	);
	const orderResponse = await app.handle(
		new Request("http://localhost/api/v1/payments/orders", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${loginBody.data.accessToken}`,
				"idempotency-key": "fixture-payment-order-001",
			},
			body: JSON.stringify({
				patientId: "patient-001",
				quoteId: "quote-001",
			}),
		}),
	);
	const orderBody = (await orderResponse.json()) as {
		success: boolean;
		data: {
			orderId: string;
			state: string;
			amounts: {
				totalFen: number;
				insuranceFen: number;
				cashFen: number;
			};
		};
	};
	const replayResponse = await app.handle(
		new Request("http://localhost/api/v1/payments/orders", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${loginBody.data.accessToken}`,
				"idempotency-key": "fixture-payment-order-001",
			},
			body: JSON.stringify({
				patientId: "patient-001",
				quoteId: "quote-001",
			}),
		}),
	);
	const replayBody = (await replayResponse.json()) as {
		success: boolean;
		data: { orderId: string };
	};
	const orderQueryResponse = await app.handle(
		new Request(
			`http://localhost/api/v1/payments/orders/${orderBody.data.orderId}`,
			{ headers: { authorization: `Bearer ${loginBody.data.accessToken}` } },
		),
	);

	expect(loginResponse.status).toBe(200);
	expect(loginBody).toMatchObject({
		success: true,
		data: {
			accessToken: "fixture-session-0001",
			user: { id: "fixture-user-0001" },
		},
	});
	expect(patientsResponse.status).toBe(200);
	expect(await patientsResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					id: "patient-001",
					displayName: "测试患者",
					relationship: "self",
					cardNumberMasked: "****001",
					source: "legacy-record",
				},
			],
			total: 1,
		},
	});
	expect(orderResponse.status).toBe(200);
	expect(orderBody).toMatchObject({
		success: true,
		data: {
			state: "created",
			amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
		},
	});
	expect(replayResponse.status).toBe(200);
	expect(replayBody.data.orderId).toBe(orderBody.data.orderId);
	expect(orderQueryResponse.status).toBe(200);
});
