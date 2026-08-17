import { expect, test } from "bun:test";
import { join } from "node:path";
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
	createInMemoryUserProfileRepository,
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
import { UserProfileService } from "./modules/profile";
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

/** 将 Elysia 内部路径映射为文档中的公网版本路径，避免接口新增后漏改文档。 */
function publicPathForDocumentation(internalPath: string): string {
	if (internalPath.startsWith("/api/v1")) {
		return `/api/v2${internalPath.slice("/api/v1".length)}`;
	}
	if (internalPath.startsWith("/health/")) {
		return `/api/v2${internalPath}`;
	}
	return internalPath;
}

/** OpenAPI path item 中允许出现的 HTTP 操作；`parameters` 等元数据不是公共接口。 */
const OPENAPI_HTTP_METHODS = [
	"get",
	"post",
	"put",
	"patch",
	"delete",
	"options",
	"head",
	"trace",
] as const;

test("liveness endpoint returns a contract response", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/health/live"),
	);
	const body = (await response.json()) as {
		success: boolean;
		data: { status: string; service: string; version: string };
	};

	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
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
		"/api/v1/me/profile",
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

test("public API documentation covers every registered OpenAPI method and path", async () => {
	const [openApiResponse, documentation] = await Promise.all([
		createApp().handle(new Request("http://localhost/openapi/json")),
		Bun.file(join(import.meta.dir, "../../../docs/api-v2-public.md")).text(),
	]);
	const document = (await openApiResponse.json()) as {
		paths: Record<string, Record<string, unknown>>;
	};

	// OpenAPI 只描述实际注册的患者端路由；每个 method/path 成对项都必须能在公网
	// `/api/v2` 文档表格中找到，防止同一路径新增 POST 后只补了 GET 说明。
	for (const [internalPath, pathItem] of Object.entries(document.paths)) {
		for (const method of OPENAPI_HTTP_METHODS) {
			if (!(method in pathItem)) continue;
			expect(documentation).toContain(
				`| \`${method.toUpperCase()}\` | \`${publicPathForDocumentation(internalPath)}\` |`,
			);
		}
	}
});

test("public API route table contains no unregistered method or path", async () => {
	const [openApiResponse, documentation] = await Promise.all([
		createApp().handle(new Request("http://localhost/openapi/json")),
		Bun.file(join(import.meta.dir, "../../../docs/api-v2-public.md")).text(),
	]);
	const document = (await openApiResponse.json()) as {
		paths: Record<string, Record<string, unknown>>;
	};

	const expectedRoutes = Object.entries(document.paths).flatMap(
		([internalPath, pathItem]) =>
			OPENAPI_HTTP_METHODS.flatMap((method) =>
				method in pathItem
					? [
							`${method.toUpperCase()} ${publicPathForDocumentation(internalPath)}`,
						]
					: [],
			),
	);

	// 只解析“当前公共接口”表格，故意不把后文列出的 404 冻结候选路径当作已注册路由。
	// 双向比较同时防止：代码新增路由漏写文档，以及文档残留已删除/尚未注册的接口。
	const currentRouteTable =
		documentation.split("### 3.1 患者目录响应", 1)[0] ?? "";
	const documentedRoutes = [
		...currentRouteTable.matchAll(
			/^\| `(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|TRACE)` \| `([^`]+)` \|/gmu,
		),
	].map((match) => `${match[1]} ${match[2]}`);

	expect(documentedRoutes.sort()).toEqual(expectedRoutes.sort());
});

test("migration inventory labels production observations as evidence snapshots", async () => {
	const inventory = await Bun.file(
		join(
			import.meta.dir,
			"../../../docs/migration/remaining-migration-inventory.md",
		),
	).text();

	// 生产复核记录属于带版本的历史证据；如果不标明边界，新会话很容易把旧快照
	// 当作当前 main 或线上实时状态，进而错误地跳过发布、回滚和真机验收。
	expect(inventory).toContain("证据快照，不代表当前 `main` 或当前线上状态");
	expect(inventory).not.toContain("当前生产只读复核仍为");
});

test("medical record draft preserves source evidence and fail-closed semantics", async () => {
	const draft = await Bun.file(
		join(
			import.meta.dir,
			"../../../docs/migration/medical-record-directory-contract-draft.md",
		),
	).text();

	// 病历是最容易把“旧端声明过接口”误认为“新端可以直接复用”的业务域。
	// 这里把源码真实调用入口、旧端异常折叠方式和新端禁止事项固定成文档门禁；
	// 后续若旧源码或迁移边界变化，必须先更新证据和 contract 草案，再改路由。
	const requiredEvidence = [
		"状态：`draft`",
		"页面真实导入 `@/api/modules/ZY`",
		"响应只要不是数组就被替换为空数组",
		"页面只调用 `out-visit-records`，没有调用 `out-emrs`",
		"失败、权限拒绝、映射缺失和真实空列表必须使用不同状态码和页面态",
		"不能把 `regId` 或 `patId` 返回给小程序",
		"住院病历与门诊就诊记录都保持独立未开放状态",
	] as const;

	for (const evidence of requiredEvidence) expect(draft).toContain(evidence);
});

test("public API documentation lists every stable public error code", async () => {
	const documentation = await Bun.file(
		join(import.meta.dir, "../../../docs/api-v2-public.md"),
	).text();
	const publicErrorCodes = [
		"validation",
		"parse",
		"not-found",
		"unknown",
		"unauthorized",
		"appointment-query-invalid",
		"appointment-record-query-invalid",
		"appointment-record-patient-not-found",
		"report-query-invalid",
		"report-patient-not-found",
		"report-not-found",
		"outpatient-payment-patient-not-found",
		"provider-request-rejected",
		"provider-temporarily-unavailable",
		"dependency-not-configured",
		"persistence-temporarily-unavailable",
		"payment-order-invalid",
		"payment-order-not-found",
		"payment-quote-not-found",
		"payment-quote-expired",
		"payment-idempotency-conflict",
		"payment-order-conflict",
		"payment-notification-rejected",
		"payment-notification-conflict",
		"payment-cash-prepay-not-allowed",
		"payment-identity-not-found",
		"payment-prepay-in-progress",
		"payment-prepay-unknown",
		"patient-sync-in-progress",
		"user-profile-invalid",
		"user-profile-conflict",
	] as const;

	for (const code of publicErrorCodes) {
		expect(documentation).toContain(`\`${code}\``);
	}
});

test("public API documentation freezes list and rendering semantics", async () => {
	const documentation = await Bun.file(
		join(import.meta.dir, "../../../docs/api-v2-public.md"),
	).text();

	// 路由存在门禁只能发现“有没有写接口”，这里额外固定列表的数量、空态、
	// 排序和本地分批边界，避免后续把小程序的渲染优化误写成 provider 分页。
	const requiredDocumentation = [
		"### 3.6 列表、空结果和大结果集语义",
		"`data.total` 必须等于 `items.length`",
		"当前没有公开 `page`、`pageSize`、`cursor` 或 `hasMore` 字段",
		"HTTP `200`、`items: []` 和 `total: 0`",
		"右栏每次最多渲染 12 条；这是本地渲染分页",
		"每次渲染 10 条；这是本地渲染分页",
		"adapter 按 `reportedAt` 倒序",
		"目录摘要与详情引用是两个独立能力",
		"不能因为单条详情引用不可用而把整批报告目录当成服务不可用",
		"不能被验收记录写成“服务端已支持分页”",
		"当前日期范围按 `endDate - startDate` 的 UTC 日历零点差值校验",
		"provider 的 `endDate` 是否包含当天仍待合同确认",
		"migration/date-window-boundary-audit.md",
		"以下候选路径当前刻意保持 `404`",
		"POST /api/v2/patients",
		"GET /api/v2/medical-records",
		"POST /api/v2/payments/insurance/authorization",
	] as const;

	for (const statement of requiredDocumentation) {
		expect(documentation).toContain(statement);
	}
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

test("provider-contract-dependent patient routes remain unregistered", async () => {
	const blockedRequests = [
		{ method: "POST", path: "/api/v1/patients" },
		{ method: "GET", path: "/api/v1/medical-records" },
		{ method: "GET", path: "/api/v1/medical-records/visit-001" },
		{ method: "POST", path: "/api/v1/payments/insurance/authorization" },
	] as const;

	// 这些路径代表仍在草案或最后处理阶段的业务；没有 provider/HIS 文档时，
	// 404 是刻意的 fail-closed 结果，不允许以旧接口转发或空实现伪造迁移完成。
	for (const request of blockedRequests) {
		const response = await createApp().handle(
			new Request(`http://localhost${request.path}`, {
				method: request.method,
				headers: { "content-type": "application/json" },
				...(request.method === "POST" ? { body: "{}" } : {}),
			}),
		);

		expect(response.status).toBe(404);
	}
});

test("protected routes authenticate before query validation", async () => {
	const protectedRequests = [
		"/api/v1/appointments/records",
		"/api/v1/payments/outpatient/records?status=unpaid",
		"/api/v1/reports",
		"/api/v1/me/profile",
	] as const;

	for (const path of protectedRequests) {
		const response = await createApp().handle(
			new Request(`http://localhost${path}`),
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			success: false,
			error: {
				code: "unauthorized",
				message: "请先登录后再继续操作",
			},
		});
	}
});

test("patient sync authenticates before validating its idempotency header", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/patients/sync", { method: "POST" }),
	);

	// 患者同步同时受 Bearer 和 Idempotency-Key 约束；未登录时必须先返回
	// 统一认证错误，不能让调用方借 schema 错误判断接口内部字段。
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "unauthorized",
			message: "请先登录后再继续操作",
		},
	});
});

test("patient sync validates idempotency before calling the provider", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const identityUsers = createInMemoryIdentityUserRepository();
	const identityGateway = createFixtureWechatIdentityGateway();
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		quotes: createInMemoryPaymentQuoteRepository(),
	});
	let providerCallCount = 0;
	const directory: PatientDirectoryGateway = {
		listByIdentity: async () => {
			providerCallCount += 1;
			return {
				complete: true,
				patients: [],
				trace: {
					provider: "fixture",
					operation: "patient-list",
					requestId: "provider-request-001",
				},
			};
		},
	};
	const app = createApp({
		services: {
			auth: new AuthService({ identityGateway, identityUsers, sessions }),
			patients: new PatientService(createInMemoryPatientRepository(), {
				identityUsers,
				directory,
			}),
			appointments: unusedAppointmentService(),
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
	const authorization = `Bearer ${issued.accessToken}`;

	const missingKeyResponse = await app.handle(
		new Request("http://localhost/api/v1/patients/sync", {
			method: "POST",
			headers: { authorization },
		}),
	);
	const malformedKeyResponse = await app.handle(
		new Request("http://localhost/api/v1/patients/sync", {
			method: "POST",
			headers: {
				authorization,
				"idempotency-key": "patient sync key with spaces",
			},
		}),
	);

	// 认证成功后才进入 schema 校验；两种非法请求都必须在 provider 之前终止。
	expect(missingKeyResponse.status).toBe(400);
	expect(malformedKeyResponse.status).toBe(400);
	expect((await missingKeyResponse.json()).error.code).toBe("validation");
	expect((await malformedKeyResponse.json()).error.code).toBe("validation");
	expect(providerCallCount).toBe(0);
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

test("profile endpoint is owner-scoped and rejects stale versions", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const identityUsers = createInMemoryIdentityUserRepository();
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
			patients: new PatientService(createInMemoryPatientRepository()),
			appointments: unusedAppointmentService(),
			reports: unusedReportService(),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers,
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createFixtureWechatPaymentGateway(),
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			profile: new UserProfileService(createInMemoryUserProfileRepository()),
			sessions,
		},
	});
	const authorization = `Bearer ${issued.accessToken}`;

	const initialResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			headers: { authorization },
		}),
	);
	const initialBody = await initialResponse.json();
	expect(initialResponse.status).toBe(200);
	expect(initialBody).toEqual({
		success: true,
		data: {
			displayName: "微信用户",
			gender: "unknown",
			age: null,
			email: null,
			version: 0,
		},
	});

	const updateResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			method: "PUT",
			headers: {
				authorization,
				"content-type": "application/json",
				"x-request-id": "profile-update-test",
			},
			body: JSON.stringify({
				version: 0,
				displayName: "  测试用户  ",
				gender: "female",
				age: 32,
				email: "test@example.com",
			}),
		}),
	);
	expect(updateResponse.status).toBe(200);
	expect(await updateResponse.json()).toEqual({
		success: true,
		data: {
			displayName: "测试用户",
			gender: "female",
			age: 32,
			email: "test@example.com",
			version: 1,
		},
	});

	const staleResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			method: "PUT",
			headers: {
				authorization,
				"content-type": "application/json",
			},
			body: JSON.stringify({ version: 0, displayName: "旧设备" }),
		}),
	);
	expect(staleResponse.status).toBe(409);
	expect(await staleResponse.json()).toEqual({
		success: false,
		error: {
			code: "user-profile-conflict",
			message: "个人资料已被其他设备修改，请刷新后重试",
		},
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
	expect(response.headers.get("cache-control")).toBe("no-store");
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
			message: "该服务暂未配置完成，请稍后重试",
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
				complete: true,
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
			message: "预约排班查询条件不合法",
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
			message: "外部服务拒绝了本次请求，请稍后重试",
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
			message: "当前就诊人暂无可查询的报告",
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
			message: "该服务暂未配置完成，请稍后重试",
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
