import { expect, test } from "bun:test";
import {
	createFixtureWechatIdentityGateway,
	createFixtureWechatPaymentGateway,
	createNotConfiguredGateways,
	ProviderRequestError,
} from "@hospital/adapters";
import {
	type AppointmentDirectoryGateway,
	type AppointmentRecordDirectoryGateway,
	type PatientDirectoryGateway,
	PaymentOrderService,
	type ReportDetailGateway,
	type ReportDirectoryGateway,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createInMemoryPaymentQuoteRepository,
	createInMemoryReportReferenceRepository,
	createInMemoryWechatPaymentNotificationRepository,
} from "@hospital/persistence";
import { createApp } from "./app";
import { createReadinessService } from "./infrastructure/readiness";
import { AppointmentService } from "./modules/appointments";
import {
	AuthService,
	authModule,
	createInMemorySessionTokenService,
} from "./modules/auth";
import { PatientService } from "./modules/patients";
import {
	WechatPaymentNotificationService,
	WechatPrepayService,
} from "./modules/payments";
import { ReportService } from "./modules/reports";

async function flushAfterResponseHooks(): Promise<void> {
	await new Promise<void>((resolve) => setImmediate(resolve));
}

/** 该测试只覆盖登录/订单路径；通知服务用 fail-closed decoder 占位。 */
function unusedWechatNotificationService(): WechatPaymentNotificationService {
	return new WechatPaymentNotificationService({
		notifications: createInMemoryWechatPaymentNotificationRepository(),
		decoder: () => {
			throw new Error("notification decoder is not used in this test");
		},
	});
}

/** 患者端组合测试不应隐式访问真实预约 provider。 */
function unusedAppointmentService(): AppointmentService {
	return new AppointmentService({
		directory: createNotConfiguredGateways().appointmentDirectory,
	});
}

/** 报告目录组合测试不应隐式访问真实 LIS/PACS/ECG provider。 */
function unusedReportService(): ReportService {
	const gateways = createNotConfiguredGateways();
	return new ReportService({
		repository: createInMemoryPatientRepository(),
		directory: gateways.reportDirectory,
	});
}

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

test("OpenAPI route inventory matches the current public application surface", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/openapi/json"),
	);
	const document = (await response.json()) as {
		paths: Record<string, unknown>;
	};

	// 这份白名单用于发现“代码加了路由但契约文档未更新”或误开放写入接口。
	const expectedPaths = [
		"/api/v1/appointments/departments",
		"/api/v1/appointments/records",
		"/api/v1/appointments/schedules",
		"/api/v1/auth/wechat",
		"/api/v1/me",
		"/api/v1/patients",
		"/api/v1/patients/sync",
		"/api/v1/payments/orders",
		"/api/v1/payments/orders/{orderId}",
		"/api/v1/payments/orders/{orderId}/wechat-prepay",
		"/api/v1/payments/outpatient/records",
		"/api/v1/payments/wechat/notifications",
		"/api/v1/reports",
		"/api/v1/reports/{reportId}",
		"/api/v1/system/ping",
		"/health/live",
		"/health/ready",
	].sort();

	expect(response.status).toBe(200);
	expect(Object.keys(document.paths).sort()).toEqual(expectedPaths);
});

test("appointment write routes remain absent while provider contract is blocked", async () => {
	const writeRequests = [
		{ method: "POST", path: "/api/v1/appointments/holds" },
		{ method: "POST", path: "/api/v1/appointments" },
		{ method: "POST", path: "/api/v1/appointments/appointment-001/cancel" },
	] as const;

	for (const request of writeRequests) {
		const requestInit: RequestInit = {
			method: request.method,
			headers: { "content-type": "application/json" },
		};
		if (!request.path.endsWith("/cancel")) requestInit.body = "{}";

		const response = await createApp().handle(
			new Request(`http://localhost${request.path}`, requestInit),
		);

		expect(response.status).toBe(404);
	}
});

test("health knowledge routes remain unregistered until reviewed content is ready", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/knowledge/health/part/list"),
	);

	expect(response.status).toBe(404);
});

test("current user endpoint only returns the platform session user id", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const auth = authModule(
		new AuthService({
			identityGateway: createFixtureWechatIdentityGateway(),
			identityUsers: createInMemoryIdentityUserRepository(),
			sessions,
		}),
		sessions,
	);

	const response = await auth.handle(
		new Request("http://localhost/me", {
			headers: { authorization: `Bearer ${issued.accessToken}` },
		}),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		success: true,
		data: { user: { id: "fixture-user-0001" } },
	});
});

test("readiness reports configured dependencies as unavailable until probes pass", async () => {
	const readiness = createReadinessService({
		databaseConfigured: true,
		redisConfigured: false,
		schemaReady: false,
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
				schema: "not_configured",
			},
		},
	});
});

test("readiness becomes ready only after the schema gate opens", async () => {
	const readiness = createReadinessService({
		databaseConfigured: true,
		redisConfigured: true,
		schemaReady: true,
		databaseProbe: async () => "ok",
		redisProbe: async () => "ok",
	});

	expect(await readiness.snapshot()).toEqual({
		status: "ready",
		dependencies: {
			database: "ok",
			redis: "ok",
			schema: "ok",
		},
	});
});

test("readiness does not trust an open schema gate when the migration probe is incomplete", async () => {
	const readiness = createReadinessService({
		databaseConfigured: true,
		redisConfigured: true,
		schemaReady: true,
		databaseProbe: async () => "ok",
		redisProbe: async () => "ok",
		schemaProbe: async () => "unavailable",
	});

	expect(await readiness.snapshot()).toEqual({
		status: "not_ready",
		dependencies: {
			database: "ok",
			redis: "ok",
			schema: "unavailable",
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

test("request logger records trace, route, status and duration without headers", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const response = await createApp({ logger }).handle(
		new Request("http://localhost/health/live", {
			headers: {
				"x-request-id": "log-trace-001",
				authorization: "Bearer should-not-be-logged",
			},
		}),
	);
	await flushAfterResponseHooks();

	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(response.status).toBe(200);
	expect(record).toMatchObject({
		event: "http.request.completed",
		requestId: "log-trace-001",
		traceId: "log-trace-001",
		method: "GET",
		path: "/health/live",
		statusCode: 200,
	});
	expect(record.authorization).toBeUndefined();
	expect(typeof record.durationMs).toBe("number");
});

test("request logger records sanitized failure metadata", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const response = await createApp({ logger }).handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "failure-trace-001",
				authorization: "Bearer should-not-be-logged",
			},
			body: JSON.stringify({ code: "real-wechat-code" }),
		}),
	);
	await flushAfterResponseHooks();

	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(response.status).toBe(503);
	expect(record).toMatchObject({
		event: "http.request.failed",
		requestId: "failure-trace-001",
		traceId: "failure-trace-001",
		path: "/api/v1/auth/wechat",
		statusCode: 503,
		errorName: "AdapterNotConfiguredError",
	});
	expect(record.authorization).toBeUndefined();
});

test("request logger classifies client errors as failed warn events", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const response = await createApp({ logger }).handle(
		new Request("http://localhost/route-does-not-exist", {
			headers: { "x-request-id": "not-found-trace-001" },
		}),
	);
	await flushAfterResponseHooks();

	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(response.status).toBe(404);
	expect(record).toMatchObject({
		event: "http.request.failed",
		level: 40,
		requestId: "not-found-trace-001",
		statusCode: 404,
	});
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
	const paymentOrders = new PaymentOrderService({
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
	});
	const services = {
		auth: new AuthService({ identityGateway, identityUsers, sessions }),
		patients: new PatientService(patientRepository),
		paymentOrders,
		wechatPrepay: new WechatPrepayService({
			orders: paymentOrders,
			identityUsers,
			attempts: createInMemoryPaymentPrepayAttemptRepository(),
			wechatPayment: createFixtureWechatPaymentGateway(),
		}),
		wechatPaymentNotifications: unusedWechatNotificationService(),
		appointments: unusedAppointmentService(),
		reports: unusedReportService(),
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
	const currentUserResponse = await app.handle(
		new Request("http://localhost/api/v1/me", {
			headers: { authorization: `Bearer ${loginBody.data.accessToken}` },
		}),
	);

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
	const prepayStatusResponse = await app.handle(
		new Request(
			`http://localhost/api/v1/payments/orders/${orderBody.data.orderId}/wechat-prepay`,
			{
				headers: {
					authorization: `Bearer ${loginBody.data.accessToken}`,
					"idempotency-key": "fixture-prepay-key-001",
				},
			},
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
	expect(currentUserResponse.status).toBe(200);
	expect(await currentUserResponse.json()).toEqual({
		success: true,
		data: { user: { id: "fixture-user-0001" } },
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
	expect(prepayStatusResponse.status).toBe(200);
	expect(await prepayStatusResponse.json()).toEqual({
		success: true,
		data: {
			orderId: orderBody.data.orderId,
			state: "created",
			status: "not_started",
		},
	});
});

test("patient sync resolves provider identity on the server and returns only internal fields", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const patientRepository = createInMemoryPatientRepository();
	const identityGateway = createFixtureWechatIdentityGateway();
	let directoryInput: { unionId: string } | undefined;
	let directoryContext: { traceId: string; idempotencyKey: string } | undefined;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async (input, context) => {
			directoryInput = input;
			directoryContext = context;
			return {
				patients: [
					{
						providerPatientId: "provider-patient-001",
						displayName: "服务端同步患者",
						relationship: "self",
						cardNumberMasked: "******0001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "patient-list",
					requestId: "provider-request-001",
				},
			};
		},
	};
	const lines: string[] = [];
	const logger = createLogger({
		service: "hospital-api-test",
		environment: "test",
		level: "info",
		destination: {
			write(chunk: string) {
				lines.push(chunk);
			},
		},
	});
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		quotes: createInMemoryPaymentQuoteRepository(),
	});
	const services = {
		auth: new AuthService({ identityGateway, identityUsers, sessions }),
		patients: new PatientService(patientRepository, {
			identityUsers,
			directory,
			logger,
			createPatientId: () => "internal-patient-001",
		}),
		paymentOrders,
		wechatPrepay: new WechatPrepayService({
			orders: paymentOrders,
			identityUsers,
			attempts: createInMemoryPaymentPrepayAttemptRepository(),
			wechatPayment: createFixtureWechatPaymentGateway(),
		}),
		wechatPaymentNotifications: unusedWechatNotificationService(),
		appointments: unusedAppointmentService(),
		reports: unusedReportService(),
		sessions,
	};
	const app = createApp({ services, logger });

	const loginResponse = await app.handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "patient-login-trace",
				"idempotency-key": "patient-login-key",
			},
			body: JSON.stringify({ code: "fixture-code" }),
		}),
	);
	const loginBody = (await loginResponse.json()) as {
		data: { accessToken: string };
	};

	const syncResponse = await app.handle(
		new Request("http://localhost/api/v1/patients/sync", {
			method: "POST",
			headers: {
				authorization: `Bearer ${loginBody.data.accessToken}`,
				"x-request-id": "patient-sync-trace",
				"idempotency-key": "patient-sync-key",
				"x-union-id": "attacker-controlled-union-id",
			},
		}),
	);
	const syncBody = (await syncResponse.json()) as {
		success: boolean;
		data: {
			items: Array<Record<string, unknown>>;
			total: number;
		};
	};
	await flushAfterResponseHooks();

	const syncLog = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((record) => record.event === "patient.directory.synced");

	expect(loginResponse.status).toBe(200);
	expect(syncResponse.status).toBe(200);
	expect(directoryInput).toEqual({ unionId: "fixture-unionid-001" });
	expect(directoryContext).toEqual({
		traceId: "patient-sync-trace",
		idempotencyKey: "patient-sync-key",
	});
	expect(syncBody).toEqual({
		success: true,
		data: {
			items: [
				{
					id: "internal-patient-001",
					displayName: "服务端同步患者",
					relationship: "self",
					cardNumberMasked: "******0001",
					source: "hospital-his",
				},
			],
			total: 1,
		},
	});
	expect(JSON.stringify(syncBody)).not.toContain("provider-patient-001");
	expect(syncLog).toMatchObject({
		event: "patient.directory.synced",
		traceId: "patient-sync-trace",
		provider: "zhongyang",
		providerRequestId: "provider-request-001",
		patientCount: 1,
	});
	expect(syncLog?.unionId).toBeUndefined();
});

test("appointment directory keeps provider fields behind a server read model", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const identityGateway = createFixtureWechatIdentityGateway();
	let departmentInput: Record<string, string | undefined> | undefined;
	let scheduleInput: Record<string, string | undefined> | undefined;
	let failDepartments = false;
	const directory: AppointmentDirectoryGateway = {
		listDepartments: async (input, context) => {
			departmentInput = input;
			if (failDepartments) {
				throw new ProviderRequestError({
					provider: "zhongyang",
					operation: "appointment-departments",
					message: "fixture provider failure",
					retryable: false,
				});
			}
			return {
				departments: [
					{
						departmentId: "dept-001",
						departmentCode: "cardiology",
						displayName: "心内科",
						location: "门诊楼二层",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: context.traceId,
				},
			};
		},
		listSchedules: async (input, context) => {
			scheduleInput = input;
			return {
				schedules: [
					{
						providerScheduleId: "schedule-001",
						departmentId: "dept-001",
						departmentName: "心内科",
						doctorId: "doctor-001",
						doctorName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						startTime: "08:00",
						endTime: "12:00",
						totalSlots: 30,
						availableSlots: 12,
						timeGroup: "range",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: context.traceId,
				},
			};
		},
	};
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		quotes: createInMemoryPaymentQuoteRepository(),
	});
	const app = createApp({
		services: {
			auth: new AuthService({ identityGateway, identityUsers, sessions }),
			patients: new PatientService(createInMemoryPatientRepository()),
			appointments: new AppointmentService({
				directory,
				now: () => new Date("2026-08-15T00:00:00.000Z"),
				createScheduleId: () => "platform-schedule-001",
			}),
			reports: unusedReportService(),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createFixtureWechatPaymentGateway(),
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			sessions,
		},
	});

	const loginResponse = await app.handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "appointment-login-trace",
				"idempotency-key": "appointment-login-key",
			},
			body: JSON.stringify({ code: "fixture-code" }),
		}),
	);
	const loginBody = (await loginResponse.json()) as {
		data: { accessToken: string };
	};
	const authorization = `Bearer ${loginBody.data.accessToken}`;

	const departmentsResponse = await app.handle(
		new Request("http://localhost/api/v1/appointments/departments", {
			headers: {
				authorization,
				"x-request-id": "appointment-departments-trace",
			},
		}),
	);
	const schedulesResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/schedules?startDate=2026-08-20&endDate=2026-08-21&departmentId=dept-001&doctorId=doctor-001",
			{
				headers: {
					authorization,
					"x-request-id": "appointment-schedules-trace",
				},
			},
		),
	);

	expect(loginResponse.status).toBe(200);
	expect(departmentsResponse.status).toBe(200);
	expect(departmentInput).toEqual({
		startDate: "2026-08-15",
		endDate: "2026-08-22",
	});
	expect(await departmentsResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					departmentId: "dept-001",
					departmentCode: "cardiology",
					displayName: "心内科",
					location: "门诊楼二层",
				},
			],
			total: 1,
		},
	});
	expect(schedulesResponse.status).toBe(200);
	expect(await schedulesResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					scheduleId: "platform-schedule-001",
					departmentId: "dept-001",
					departmentName: "心内科",
					doctorId: "doctor-001",
					doctorName: "李医生",
					workDate: "2026-08-20",
					shiftName: "上午",
					startTime: "08:00",
					endTime: "12:00",
					totalSlots: 30,
					availableSlots: 12,
					timeGroup: "range",
				},
			],
			total: 1,
		},
	});
	expect(scheduleInput).toEqual({
		startDate: "2026-08-20",
		endDate: "2026-08-21",
		departmentId: "dept-001",
		doctorId: "doctor-001",
	});
	scheduleInput = undefined;
	const invalidRangeResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/schedules?startDate=2026-08-20&endDate=2026-09-30",
			{ headers: { authorization } },
		),
	);
	expect(invalidRangeResponse.status).toBe(400);
	expect(await invalidRangeResponse.json()).toEqual({
		success: false,
		error: {
			code: "appointment-query-invalid",
			message: "Schedule date range cannot exceed 31 days",
		},
	});
	expect(scheduleInput).toBeUndefined();

	failDepartments = true;
	const failedDepartmentsResponse = await app.handle(
		new Request("http://localhost/api/v1/appointments/departments", {
			headers: { authorization },
		}),
	);
	expect(failedDepartmentsResponse.status).toBe(502);
	expect(await failedDepartmentsResponse.json()).toEqual({
		success: false,
		error: {
			code: "provider-request-rejected",
			message: "External service rejected the request",
		},
	});
});

test("report directory resolves internal patient ownership before provider lookup", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const identityGateway = createFixtureWechatIdentityGateway();
	const patientRepository = createInMemoryPatientRepository();
	await patientRepository.upsertFromDirectory({
		ownerUserId: "fixture-user-0001",
		patientId: "internal-patient-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-patient-001",
			providerReferences: { "his-patient": "his-patient-001" },
			displayName: "张三",
			relationship: "self",
			cardNumberMasked: "******0001",
		},
	});
	let directoryInput: { providerPatientId: string } | undefined;
	const directory: ReportDirectoryGateway = {
		listReports: async (input, context) => {
			directoryInput = { providerPatientId: input.providerPatientId };
			return {
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "血常规",
							reportedAt: "2026-08-15 10:00:00",
							status: "abnormal",
							hasAttachment: true,
						},
						providerReportId: "provider-report-001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: context.traceId,
				},
			};
		},
	};
	const detail: ReportDetailGateway = {
		getLaboratoryDetail: async () => ({
			detail: {
				kind: "laboratory",
				title: "血常规",
				reportedAt: "2026-08-15 10:00:00",
				items: [{ name: "白细胞", result: "10.2", flag: "high" }],
				hasAttachment: true,
			},
			trace: {
				provider: "zhongyang",
				operation: "reports-laboratory-detail",
				requestId: "report-detail-trace",
			},
		}),
	};
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		quotes: createInMemoryPaymentQuoteRepository(),
	});
	const app = createApp({
		services: {
			auth: new AuthService({ identityGateway, identityUsers, sessions }),
			patients: new PatientService(patientRepository),
			appointments: unusedAppointmentService(),
			reports: new ReportService({
				repository: patientRepository,
				directory,
				detail,
				references: createInMemoryReportReferenceRepository(),
			}),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createFixtureWechatPaymentGateway(),
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			sessions,
		},
	});

	const loginResponse = await app.handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "report-login-trace",
				"idempotency-key": "report-login-key",
			},
			body: JSON.stringify({ code: "fixture-code" }),
		}),
	);
	const loginBody = (await loginResponse.json()) as {
		data: { accessToken: string };
	};
	const response = await app.handle(
		new Request(
			"http://localhost/api/v1/reports?patientId=internal-patient-001&startDate=2026-08-01&endDate=2026-08-15",
			{
				headers: {
					authorization: `Bearer ${loginBody.data.accessToken}`,
					"x-request-id": "report-query-trace",
				},
			},
		),
	);

	expect(response.status).toBe(200);
	const reportListBody = (await response.json()) as {
		data: { items: Array<{ reportId?: string; title: string }>; total: number };
	};
	expect(reportListBody.data.total).toBe(1);
	expect(reportListBody.data.items[0]).toMatchObject({ title: "血常规" });
	const reportId = reportListBody.data.items[0]?.reportId;
	expect(reportId).toMatch(/^report_[a-f0-9]{48}$/);
	expect(JSON.stringify(reportListBody)).not.toContain("provider-report-001");

	const detailResponse = await app.handle(
		new Request(`http://localhost/api/v1/reports/${reportId}`, {
			headers: {
				authorization: `Bearer ${loginBody.data.accessToken}`,
				"x-request-id": "report-detail-query-trace",
			},
		}),
	);
	expect(detailResponse.status).toBe(200);
	expect(await detailResponse.json()).toEqual({
		success: true,
		data: {
			reportId,
			kind: "laboratory",
			title: "血常规",
			reportedAt: "2026-08-15 10:00:00",
			items: [{ name: "白细胞", result: "10.2", flag: "high" }],
			hasAttachment: true,
		},
	});
	expect(directoryInput).toEqual({ providerPatientId: "his-patient-001" });

	directoryInput = undefined;
	const missingResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/reports?patientId=other-patient&startDate=2026-08-01&endDate=2026-08-15",
			{ headers: { authorization: `Bearer ${loginBody.data.accessToken}` } },
		),
	);
	expect(missingResponse.status).toBe(404);
	expect(await missingResponse.json()).toEqual({
		success: false,
		error: {
			code: "report-patient-not-found",
			message: "Report patient not found",
		},
	});
	expect(directoryInput).toBeUndefined();
});

test("appointment records resolve internal patient ownership and return only summaries", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const patientRepository = createInMemoryPatientRepository();
	await patientRepository.upsertFromDirectory({
		ownerUserId: "fixture-user-0001",
		patientId: "internal-patient-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-patient-001",
			providerReferences: { "his-patient": "his-patient-001" },
			displayName: "张三",
			relationship: "self",
			cardNumberMasked: "******0001",
		},
	});
	let recordsInput: { providerPatientId: string } | undefined;
	const records: AppointmentRecordDirectoryGateway = {
		listRecords: async (input, context) => {
			recordsInput = { providerPatientId: input.providerPatientId };
			return {
				records: [
					{
						departmentName: "心内科",
						doctorName: "李医生",
						workDate: "2026-08-20",
						status: "scheduled",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: context.traceId,
				},
			};
		},
	};
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		quotes: createInMemoryPaymentQuoteRepository(),
	});
	const app = createApp({
		services: {
			auth: new AuthService({
				identityGateway: createFixtureWechatIdentityGateway(),
				identityUsers,
				sessions,
			}),
			patients: new PatientService(patientRepository),
			appointments: new AppointmentService({
				directory: createNotConfiguredGateways().appointmentDirectory,
				repository: patientRepository,
				records,
			}),
			reports: unusedReportService(),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createFixtureWechatPaymentGateway(),
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			sessions,
		},
	});

	const loginResponse = await app.handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-request-id": "appointment-record-login",
				"idempotency-key": "appointment-record-login-key",
			},
			body: JSON.stringify({ code: "fixture-code" }),
		}),
	);
	const loginBody = (await loginResponse.json()) as {
		data: { accessToken: string };
	};
	const response = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/records?patientId=internal-patient-001&startDate=2026-08-01&endDate=2026-08-31",
			{
				headers: {
					authorization: `Bearer ${loginBody.data.accessToken}`,
				},
			},
		),
	);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					departmentName: "心内科",
					doctorName: "李医生",
					workDate: "2026-08-20",
					status: "scheduled",
				},
			],
			total: 1,
		},
	});
	expect(recordsInput).toEqual({ providerPatientId: "his-patient-001" });
});

test("wechat prepay endpoint fails closed while the payment gate is disabled", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository([
		{
			userId: "fixture-user-0001",
			providerSubject: "fixture-openid-001",
		},
	]);
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository([
			{
				orderId: "order-cash-001",
				ownerUserId: "fixture-user-0001",
				patientId: "patient-001",
				idempotencyKey: "order-key-001",
				amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
				state: "cash_pending",
				version: 4,
				createdAt: "2026-08-15T00:00:00.000Z",
				updatedAt: "2026-08-15T00:00:00.000Z",
			},
		]),
	});
	const issued = await sessions.issue("fixture-user-0001");
	const notConfigured = createNotConfiguredGateways();
	const app = createApp({
		services: {
			auth: new AuthService({
				identityGateway: createFixtureWechatIdentityGateway(),
				identityUsers,
				sessions,
			}),
			patients: new PatientService(createInMemoryPatientRepository()),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: notConfigured.wechatPayment,
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			appointments: unusedAppointmentService(),
			reports: unusedReportService(),
			sessions,
		},
	});

	const response = await app.handle(
		new Request(
			"http://localhost/api/v1/payments/orders/order-cash-001/wechat-prepay",
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${issued.accessToken}`,
					"idempotency-key": "prepay-key-001",
				},
			},
		),
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

test("wechat payment notification route preserves the raw body and returns provider ack", async () => {
	const sessions = createInMemorySessionTokenService();
	const identityUsers = createInMemoryIdentityUserRepository();
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
	});
	const receivedBodies: string[] = [];
	const notification = new WechatPaymentNotificationService({
		notifications: createInMemoryWechatPaymentNotificationRepository(),
		decoder: ({ rawBody, headers, receivedAt }) => {
			receivedBodies.push(new TextDecoder().decode(rawBody));
			expect(headers.get("Wechatpay-Signature")).toBe("fixture-signature");
			return {
				notificationId: "fixture-notification-001",
				eventType: "TRANSACTION.SUCCESS",
				orderId: "fixture-order-001",
				tradeState: "SUCCESS",
				totalFen: 300,
				providerTransactionId: "fixture-transaction-001",
				receivedAt,
			};
		},
	});
	const app = createApp({
		services: {
			auth: new AuthService({
				identityGateway: createFixtureWechatIdentityGateway(),
				identityUsers,
				sessions,
			}),
			patients: new PatientService(createInMemoryPatientRepository()),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createFixtureWechatPaymentGateway(),
			}),
			wechatPaymentNotifications: notification,
			appointments: unusedAppointmentService(),
			reports: unusedReportService(),
			sessions,
		},
	});
	const request = () =>
		new Request("http://localhost/api/v1/payments/wechat/notifications", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"Wechatpay-Signature": "fixture-signature",
			},
			body: JSON.stringify({ id: "raw-notification-body" }),
		});

	const first = await app.handle(request());
	const replay = await app.handle(request());

	expect(first.status).toBe(200);
	expect(await first.json()).toEqual({ code: "SUCCESS", message: "成功" });
	expect(replay.status).toBe(200);
	expect(receivedBodies).toEqual([
		'{"id":"raw-notification-body"}',
		'{"id":"raw-notification-body"}',
	]);
});
