import { expect, test } from "bun:test";
import { join } from "node:path";
import {
	createFixtureWechatIdentityGateway,
	createFixtureWechatPaymentGateway,
	createNotConfiguredGateways,
	ProviderRequestError,
} from "@hospital/adapters";
import {
	type AppointmentDepartmentTreeGateway,
	type AppointmentDirectoryGateway,
	type AppointmentRecordDirectoryGateway,
	HealthKnowledgeContentUnavailableError,
	type HealthKnowledgeRepository,
	type OutpatientPaymentGateway,
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
import { createDefaultApplicationServices } from "./application";
import { createReadinessService } from "./infrastructure/readiness";
import { AppointmentService } from "./modules/appointments";
import {
	AuthService,
	authModule,
	createInMemorySessionTokenService,
} from "./modules/auth";
import { HealthKnowledgeService } from "./modules/knowledge";
import { OutpatientPaymentService } from "./modules/outpatient-payments";
import { PatientService } from "./modules/patients";
import {
	WechatPaymentNotificationService,
	WechatPrepayService,
} from "./modules/payments";
import { UserProfileService } from "./modules/profile";
import { ReportService } from "./modules/reports";
import { adapterContextFromHeaders } from "./plugins/request-context";

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
		"/api/v1/appointments/clinic-departments",
		"/api/v1/appointments/departments",
		"/api/v1/appointments/department-tree",
		"/api/v1/appointments/records",
		"/api/v1/appointments/schedules",
		"/api/v1/auth/wechat",
		"/api/v1/knowledge/health/crowd/list",
		"/api/v1/knowledge/health/department/list",
		"/api/v1/knowledge/health/disease/detail/{diseaseId}",
		"/api/v1/knowledge/health/disease/list/crowd/{crowdId}",
		"/api/v1/knowledge/health/disease/list/department/{departmentId}",
		"/api/v1/knowledge/health/disease/list/part/{partId}",
		"/api/v1/knowledge/health/disease/list/symptoms",
		"/api/v1/knowledge/health/drug/detail/{drugId}",
		"/api/v1/knowledge/health/part/list",
		"/api/v1/knowledge/health/symptoms/list/part/{partId}",
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
		Bun.file(join(import.meta.dir, "../../../docs/公共API-v2.md")).text(),
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
		Bun.file(join(import.meta.dir, "../../../docs/公共API-v2.md")).text(),
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
			"../../../docs/迁移/剩余迁移清单.md",
		),
	).text();

	// 生产复核记录属于带版本的历史证据；如果不标明边界，新会话很容易把旧快照
	// 当作当前 main 或线上实时状态，进而错误地跳过发布、回滚和真机验收。
	expect(inventory).toContain("证据快照，不代表当前 `main` 或当前线上状态");
	// 当前 release 观察必须成为盘点入口的一部分；否则 capability 表很容易
	// 继续保留旧 release 的“当前 API”描述，让下一次业务验收使用错误版本。
	expect(inventory).toContain(
		"release/current-runtime-coexistence-readonly-2026-08-18-2136.md",
	);
	// 当前盘点必须明确记录当前 release 的运行层观察范围；不能把上一 release
	// 的登录/患者日志计入当前版本，也不能把健康探针成功扩展成业务完成。
	expect(inventory).toContain(
		"`687690e` 切换后的 journald 低敏启动窗口 `parseErrors=0`、`systemdWarningCount=0`，只有服务启动、健康探针和预期未登录 401；",
	);
	expect(inventory).toContain(
		"历史 release `9acdaf2` 曾观察到预约历史 `itemCount=60`、`statusCounts={cancelled:60}`",
	);
	expect(inventory).not.toContain("当前 API 已切换到 `0b6f38f`");
	expect(inventory).not.toContain("当前生产只读复核仍为");
});

test("medical record draft preserves source evidence and fail-closed semantics", async () => {
	const draft = await Bun.file(
		join(
			import.meta.dir,
			"../../../docs/迁移/病案目录契约草案.md",
		),
	).text();

	// 病历是最容易把“旧端声明过接口”误认为“新端可以直接复用”的业务域。
	// 这里把源码真实调用入口、旧端异常折叠方式和新端禁止事项固定成文档门禁；
	// 后续若旧源码或迁移边界变化，必须先更新证据和 contract 草案，再改路由。
	const requiredEvidence = [
		"状态：`implemented-pending-acceptance`",
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
		join(import.meta.dir, "../../../docs/公共API-v2.md"),
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
		"outpatient-payment-query-invalid",
		"report-query-invalid",
		"report-patient-not-found",
		"report-not-found",
		"outpatient-payment-patient-not-found",
		"provider-request-rejected",
		"provider-response-invalid",
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
		"patient-query-invalid",
		"patient-sync-in-progress",
		"patient-sync-stale",
		"patient-directory-snapshot-unsafe",
		"patient-directory-reference-conflict",
		"health-knowledge-unavailable",
		"health-knowledge-query-invalid",
		"health-knowledge-not-found",
		"persistence-invalid",
		"user-profile-invalid",
		"user-profile-conflict",
	] as const;

	for (const code of publicErrorCodes) {
		expect(documentation).toContain(`\`${code}\``);
	}

	/**
	 * 仅检查“列表中的 code 都出现在文档”仍然可能漏掉新增的文档行。
	 * 这里反向解析公共错误表并比较完整集合，让文档、API 测试和小程序
	 * 错误文案门禁共享同一份可复核事实，避免新增错误码只改了一侧。
	 */
	const documentedCodes = new Set<string>();
	const errorTable = documentation.split("## 5. 当前实现边界")[0] ?? "";
	for (const line of errorTable.split("\n")) {
		if (!/^\| \d+ \|/.test(line)) continue;
		for (const match of line.matchAll(/`([a-z0-9-]+)`/g)) {
			const code = match[1];
			if (code) documentedCodes.add(code);
		}
	}
	expect([...documentedCodes].sort()).toEqual([...publicErrorCodes].sort());
});

test("public API documentation freezes list and rendering semantics", async () => {
	const documentation = await Bun.file(
		join(import.meta.dir, "../../../docs/公共API-v2.md"),
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
		"服务端仅对通过时间窗口校验的结果按 `reportedAt` 时间倒序",
		"目录摘要与详情引用是两个独立能力",
		"不能因为单条详情引用不可用而把整批报告目录当成服务不可用",
		"不能被验收记录写成“服务端已支持分页”",
		"当前日期范围按 `endDate - startDate` 的 UTC 日历零点差值校验",
		"provider 的 `endDate` 是否包含当天仍待合同确认",
		"迁移/日期窗口边界审计.md",
		"以下候选路径当前刻意保持 `404`",
		"POST /api/v2/patients",
		"POST /api/v2/payments/insurance/authorization",
		"POST /api/v2/appointments",
		"POST /api/v2/appointments/holds",
		"POST /api/v2/appointments/{appointmentId}/cancel",
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

test("health knowledge routes remain fail-closed until reviewed content is ready", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/knowledge/health/part/list"),
	);

	// 路由先注册以冻结旧端健康百科的后端入口，但默认组合根没有会话，
	// 且没有审核发布内容；两道闸门都不能被解释为健康内容已经上线。
	expect(response.status).toBe(401);
});

test("authenticated health knowledge reads keep the unpublished gate visible", async () => {
	const unpublished: HealthKnowledgeRepository = {
		// 该 fixture 模拟“数据库可访问，但当前没有 published 版本”的真实边界；
		// 不能用空数组代替，否则小程序会把内容未发布误认为医院没有内容。
		listCatalog: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
		listDiseasesByRelation: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
		listSymptomsByPart: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
		listDiseasesBySymptoms: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
		getDiseaseDetail: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
		getDrugDetail: async () => {
			throw new HealthKnowledgeContentUnavailableError();
		},
	};
	const services = createDefaultApplicationServices({
		sessionStore: {
			async save() {},
			async findUserId() {
				return "fixture-user-0001";
			},
		},
	});
	const issued = await services.sessions.issue("fixture-user-0001");
	services.healthKnowledge = new HealthKnowledgeService({
		repository: unpublished,
	});
	const response = await createApp({ services }).handle(
		new Request("http://localhost/api/v1/knowledge/health/part/list", {
			headers: { authorization: `Bearer ${issued.accessToken}` },
		}),
	);

	// 已登录只证明用户身份，不证明内容已经经过审核发布；这里必须让
	// 客户端进入“内容暂不可用”重试态，不能返回 200 空目录或旧快照。
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "health-knowledge-unavailable",
			message: "健康知识内容暂时不可用，请稍后重试",
		},
	});
});

test("provider-contract-dependent write and detail routes remain unregistered", async () => {
	const blockedRequests = [
		{ method: "POST", path: "/api/v1/patients" },
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

test("会话 Redis 失效时返回 401，而不是把缺失 token 当作依赖故障", async () => {
	const services = createDefaultApplicationServices({
		sessionStore: {
			async save() {},
			async findUserId() {
				return undefined;
			},
		},
	});
	const response = await createApp({ services }).handle(
		new Request("http://localhost/api/v1/me", {
			headers: { authorization: "Bearer expired-session-token" },
		}),
	);

	// Redis 能正常返回“查无此会话”时，这是用户会话失效，不是基础设施故障。
	// 该边界必须保持 401，客户端才会执行有限的一次重新登录。
	expect(response.status).toBe(401);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "unauthorized",
			message: "登录状态已失效，请重新登录",
		},
	});
});

test("会话 Redis 读取故障保持持久化暂不可用 503，不能误报为登录失效", async () => {
	const services = createDefaultApplicationServices({
		sessionStore: {
			async save() {},
			async findUserId() {
				throw new Error("redis transport failure");
			},
		},
	});
	const response = await createApp({ services }).handle(
		new Request("http://localhost/api/v1/me", {
			headers: { authorization: "Bearer session-token" },
		}),
	);

	// 网络、ACL 或连接池故障不能触发客户端清理仍可能恢复的会话，
	// 也不能伪装成“服务未配置”；否则用户会被错误地当成退出状态，
	// 且运维无法区分配置缺失与 Redis 瞬态故障。
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "persistence-temporarily-unavailable",
			message: "数据服务暂时不可用，请稍后重试",
		},
	});
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

	const clearNullableFieldsResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			method: "PUT",
			headers: {
				authorization,
				"content-type": "application/json",
				"x-request-id": "profile-clear-nullable-fields",
			},
			body: JSON.stringify({
				version: 1,
				age: null,
				email: null,
			}),
		}),
	);
	// null 是页面明确清空普通资料的业务意图，不等价于省略字段；服务端
	// 必须在同一个 version 条件下持久化清空并返回新的 canonical 快照，
	// 否则用户下次进入页面仍会看到旧邮箱/年龄，形成“保存成功但事实未变”。
	expect(clearNullableFieldsResponse.status).toBe(200);
	expect(await clearNullableFieldsResponse.json()).toEqual({
		success: true,
		data: {
			displayName: "测试用户",
			gender: "female",
			age: null,
			email: null,
			version: 2,
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

	// owner 必须来自 Bearer 会话；第二个用户即使知道第一个用户的资料接口，
	// 也只能读取和修改自己的资料，不能因为 profile 表使用同一个 repository
	// 就发生跨用户串读或覆盖。
	const otherIssued = await sessions.issue("fixture-user-0002");
	const otherUpdateResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			method: "PUT",
			headers: {
				authorization: `Bearer ${otherIssued.accessToken}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ version: 0, displayName: "其他用户" }),
		}),
	);
	const originalOwnerReadResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			headers: { authorization },
		}),
	);
	const otherOwnerReadResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			headers: { authorization: `Bearer ${otherIssued.accessToken}` },
		}),
	);

	expect(otherUpdateResponse.status).toBe(200);
	expect(await otherUpdateResponse.json()).toMatchObject({
		success: true,
		data: { displayName: "其他用户", version: 1 },
	});
	expect(originalOwnerReadResponse.status).toBe(200);
	expect(await originalOwnerReadResponse.json()).toMatchObject({
		success: true,
		data: { displayName: "测试用户", age: null, email: null, version: 2 },
	});
	expect(otherOwnerReadResponse.status).toBe(200);
	expect(await otherOwnerReadResponse.json()).toMatchObject({
		success: true,
		data: { displayName: "其他用户", version: 1 },
	});

	// 旧端资料更新曾经携带 avatar/openid 等身份字段；新 contract 必须在
	// Elysia schema 层拒绝它们，不能静默丢弃后让调用方误以为资料已完整保存。
	const legacyFieldResponse = await app.handle(
		new Request("http://localhost/api/v1/me/profile", {
			method: "PUT",
			headers: {
				authorization,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				version: 1,
				displayName: "仅保存允许字段",
				avatar: "https://legacy.example/avatar.png",
				openid: "legacy-openid-must-not-enter-contract",
			}),
		}),
	);
	expect(legacyFieldResponse.status).toBe(400);
	expect(await legacyFieldResponse.json()).toMatchObject({
		success: false,
		error: { code: "validation" },
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

test("不安全的 request id 不得回显到响应或日志", async () => {
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
			headers: { "x-request-id": "request id with spaces" },
		}),
	);
	await flushAfterResponseHooks();

	const responseRequestId = response.headers.get("x-request-id");
	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	// 非法值不能原样进入响应头或 journald；生成的新 UUID 同时作为客户端
	// 后续错误关联号和服务端 request/trace 日志关联号，避免日志注入和链路分叉。
	expect(responseRequestId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
	);
	expect(responseRequestId).not.toBe("request id with spaces");
	expect(record).toMatchObject({
		event: "http.request.completed",
		requestId: responseRequestId,
		traceId: responseRequestId,
		statusCode: 200,
	});
});

test("Provider 上下文对非法关联号使用同一个安全回退值", () => {
	const context = adapterContextFromHeaders({
		"x-request-id": "trace id with spaces",
		"idempotency-key": "idem\nwith-control",
	});

	// Provider 只应收到经过同一形状校验的关联号；非法幂等键回退到本次 trace，
	// 既避免日志链分叉，也避免把未经验证的调用方值误当作跨请求幂等事实。
	expect(context.traceId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
	);
	expect(context.idempotencyKey).toBe(context.traceId);
});

test("错误响应同样保留 request id，客户端才能关联服务端失败日志", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/route-does-not-exist", {
			headers: { "x-request-id": "error-trace-001" },
		}),
	);

	// 失败响应不能因为进入统一错误处理器就丢失链路号；小程序的
	// ApiError.requestId 会从这个响应头读取它，再与 journald 中的
	// http.request.failed 及业务失败事件关联。这里只验证低敏 header，
	// 不把内部异常细节或请求体扩散到公共响应。
	expect(response.status).toBe(404);
	expect(response.headers.get("x-request-id")).toBe("error-trace-001");
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

test("wechat login rejects legacy identity fields before dependency access", async () => {
	const response = await createApp().handle(
		new Request("http://localhost/api/v1/auth/wechat", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				code: "real-wechat-code",
				openid: "must-not-enter-contract",
				session_key: "must-not-enter-contract",
			}),
		}),
	);

	// 登录一次性 code 的请求不能静默吞掉旧身份字段，否则调用方会误以为
	// openid/session_key 已被接受；必须在未配置 provider 之前就返回统一的
	// 400 输入错误，而不是继续进入 provider 依赖并返回 503。
	expect(response.status).toBe(400);
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
			clinicalAccess: "unavailable",
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
	const app = createApp({ services, wechatPaymentEnabled: true });

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
					clinicalAccess: "unavailable",
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
						providerReferences: { "his-patient": "his-patient-001" },
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
					clinicalAccess: "ready",
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
	let clinicDepartmentInput: Record<string, string | undefined> | undefined;
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
	const departmentTree: AppointmentDepartmentTreeGateway = {
		listDepartmentTree: async (context) => ({
			groups: [
				{
					groupId: "first-surgery",
					displayName: "外科",
					departments: [
						{
							departmentId: "second-general",
							displayName: "普外科门诊",
						},
					],
				},
			],
			trace: {
				provider: "zhongyang",
				operation: "appointment-department-tree",
				requestId: context.traceId,
			},
		}),
		listClinicDepartments: async (input, context) => {
			clinicDepartmentInput = input;
			return {
				departments: [
					{
						departmentId: "clinic-neurosurgery",
						displayName: "神经外科门诊",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-clinic-departments",
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
				departmentTree,
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
	const departmentTreeResponse = await app.handle(
		new Request("http://localhost/api/v1/appointments/department-tree", {
			headers: {
				authorization,
				"x-request-id": "appointment-tree-trace",
			},
		}),
	);
	const clinicDepartmentsResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/clinic-departments?parentDepartmentId=second-general",
			{
				headers: {
					authorization,
					"x-request-id": "appointment-clinics-trace",
				},
			},
		),
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
	expect(departmentTreeResponse.status).toBe(200);
	expect(await departmentTreeResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					groupId: "first-surgery",
					displayName: "外科",
					departments: [
						{
							departmentId: "second-general",
							displayName: "普外科门诊",
						},
					],
				},
			],
			total: 1,
		},
	});
	expect(clinicDepartmentsResponse.status).toBe(200);
	expect(await clinicDepartmentsResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					departmentId: "clinic-neurosurgery",
					displayName: "神经外科门诊",
				},
			],
			total: 1,
		},
	});
	expect(clinicDepartmentInput).toEqual({
		parentDepartmentId: "second-general",
		startDate: "2026-08-15",
		endDate: "2026-08-22",
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
		new Request(
			`http://localhost/api/v1/reports/${reportId}?patientId=internal-patient-001`,
			{
				headers: {
					authorization: `Bearer ${loginBody.data.accessToken}`,
					"x-request-id": "report-detail-query-trace",
				},
			},
		),
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
	const wrongPatientDetailResponse = await app.handle(
		new Request(
			`http://localhost/api/v1/reports/${reportId}?patientId=other-patient`,
			{ headers: { authorization: `Bearer ${loginBody.data.accessToken}` } },
		),
	);
	expect(wrongPatientDetailResponse.status).toBe(404);
	expect(await wrongPatientDetailResponse.json()).toEqual({
		success: false,
		error: {
			code: "report-not-found",
			message: "报告详情暂不可用",
		},
	});

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
	let recordsInput:
		| {
				providerPatientId: string;
				query: {
					scope?: "online" | "all";
					startDate?: string;
					endDate?: string;
				};
		  }
		| undefined;
	const records: AppointmentRecordDirectoryGateway = {
		listRecords: async (input, context) => {
			recordsInput = {
				providerPatientId: input.providerPatientId,
				query: input.query,
			};
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
	expect(recordsInput).toEqual({
		providerPatientId: "his-patient-001",
		query: {
			startDate: "2026-08-01",
			endDate: "2026-08-31",
		},
	});

	const allHistoryResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/records?patientId=internal-patient-001&scope=all",
			{
				headers: {
					authorization: `Bearer ${loginBody.data.accessToken}`,
				},
			},
		),
	);

	// “全部挂号”是独立的 Provider 查询范围：HTTP 只表达业务 scope，不能
	// 让客户端伪造 requestChannel，也不能悄悄沿用在线查询的日期窗口。这个
	// 集成断言把路由、service 和 gateway 之间最容易被误改的边界固定下来。
	expect(allHistoryResponse.status).toBe(200);
	expect(await allHistoryResponse.json()).toEqual({
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
	expect(recordsInput).toEqual({
		providerPatientId: "his-patient-001",
		query: { scope: "all" },
	});
});

test("explicit second patient selection keeps appointment and outpatient mappings aligned", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const identityUsers = createInMemoryIdentityUserRepository();
	const patientRepository = createInMemoryPatientRepository();
	await patientRepository.upsertFromDirectory({
		ownerUserId: "fixture-user-0001",
		patientId: "internal-patient-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "directory-patient-001",
			providerReferences: { "his-patient": "his-patient-001" },
			displayName: "本人患者",
			relationship: "self",
			cardNumberMasked: "******0001",
		},
	});
	await patientRepository.upsertFromDirectory({
		ownerUserId: "fixture-user-0001",
		patientId: "internal-patient-002",
		provider: "zhongyang",
		profile: {
			providerPatientId: "directory-patient-002",
			providerReferences: { "his-patient": "his-patient-002" },
			displayName: "家属患者",
			relationship: "other",
			cardNumberMasked: "******0002",
		},
	});

	let appointmentProviderPatientId: string | undefined;
	const appointmentRecords: AppointmentRecordDirectoryGateway = {
		listRecords: async (input, context) => {
			appointmentProviderPatientId = input.providerPatientId;
			return {
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: context.traceId,
				},
			};
		},
	};
	let outpatientProviderPatientId: string | undefined;
	const outpatientGateway: OutpatientPaymentGateway = {
		listRecords: async (input) => {
			outpatientProviderPatientId = input.providerPatientId;
			return {
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "explicit-second-patient-trace",
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
				records: appointmentRecords,
			}),
			reports: unusedReportService(),
			outpatientPayments: new OutpatientPaymentService({
				repository: patientRepository,
				gateway: outpatientGateway,
				authSysCode: "thirdSelfMachine",
				now: () => new Date("2026-08-16T10:20:30.000Z"),
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
	const authorization = `Bearer ${issued.accessToken}`;

	const patientsResponse = await app.handle(
		new Request("http://localhost/api/v1/patients", {
			headers: { authorization },
		}),
	);
	const appointmentResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/records?patientId=internal-patient-002&startDate=2026-08-01&endDate=2026-08-31",
			{ headers: { authorization } },
		),
	);
	const outpatientResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/payments/outpatient/records?patientId=internal-patient-002&status=unpaid",
			{ headers: { authorization } },
		),
	);

	// 这里模拟小程序在选择页明确点击第二位患者后的请求链路：API
	// 只能接受平台内部 patientId，再按当前用户归属解析对应的 HIS 身份。
	// 预约和门诊费用必须各自声明并使用同一位患者的临床引用，不能回退到
	// 首页默认患者，也不能让 provider 的 directory patientId 代替 his-patient。
	expect(patientsResponse.status).toBe(200);
	expect(await patientsResponse.json()).toEqual({
		success: true,
		data: {
			items: [
				{
					id: "internal-patient-001",
					displayName: "本人患者",
					relationship: "self",
					cardNumberMasked: "******0001",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
				{
					id: "internal-patient-002",
					displayName: "家属患者",
					relationship: "other",
					cardNumberMasked: "******0002",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
			],
			total: 2,
		},
	});
	expect(appointmentResponse.status).toBe(200);
	expect(await appointmentResponse.json()).toEqual({
		success: true,
		data: { items: [], total: 0 },
	});
	expect(outpatientResponse.status).toBe(200);
	expect(await outpatientResponse.json()).toEqual({
		success: true,
		data: { status: "unpaid", items: [], total: 0 },
	});
	expect(appointmentProviderPatientId).toBe("his-patient-002");
	expect(outpatientProviderPatientId).toBe("his-patient-002");
});

test("outpatient payment endpoint preserves owner mapping and empty-result semantics", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
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
	const gatewayCalls: Array<{
		providerPatientId: string;
		status: "unpaid" | "paid";
	}> = [];
	const gateway: OutpatientPaymentGateway = {
		listRecords: async (input) => {
			gatewayCalls.push({
				providerPatientId: input.providerPatientId,
				status: input.status,
			});
			return {
				records:
					input.status === "unpaid"
						? []
						: [
								{
									recordId: "opaque-payment-001",
									status: "paid",
									billDate: "2026-08-16 09:00:00",
									amountFen: 350,
									departmentName: "心内科",
								},
							],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "outpatient-payment-trace",
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
			appointments: unusedAppointmentService(),
			reports: unusedReportService(),
			outpatientPayments: new OutpatientPaymentService({
				repository: patientRepository,
				gateway,
				authSysCode: "thirdSelfMachine",
				now: () => new Date("2026-08-16T10:20:30.000Z"),
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
	const authorization = `Bearer ${issued.accessToken}`;

	const unpaidResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/payments/outpatient/records?patientId=internal-patient-001&status=unpaid",
			{ headers: { authorization } },
		),
	);
	const paidResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/payments/outpatient/records?patientId=internal-patient-001&status=paid",
			{ headers: { authorization } },
		),
	);

	expect(unpaidResponse.status).toBe(200);
	expect(await unpaidResponse.json()).toEqual({
		success: true,
		data: { status: "unpaid", items: [], total: 0 },
	});
	expect(paidResponse.status).toBe(200);
	expect(await paidResponse.json()).toEqual({
		success: true,
		data: {
			status: "paid",
			items: [
				{
					recordId: "opaque-payment-001",
					status: "paid",
					billDate: "2026-08-16 09:00:00",
					amountFen: 350,
					departmentName: "心内科",
				},
			],
			total: 1,
		},
	});
	// 公共 API 只接收平台 patientId；服务端才可以把它解析为 HIS patId。
	expect(gatewayCalls).toEqual([
		{
			providerPatientId: "his-patient-001",
			status: "unpaid",
		},
		{
			providerPatientId: "his-patient-001",
			status: "paid",
		},
	]);
});

test("patient-scoped read routes reject another owner's patient before provider access", async () => {
	const sessions = createInMemorySessionTokenService();
	const otherOwner = await sessions.issue("fixture-user-0002");
	const identityUsers = createInMemoryIdentityUserRepository();
	const patientRepository = createInMemoryPatientRepository();
	await patientRepository.upsertFromDirectory({
		ownerUserId: "fixture-user-0001",
		patientId: "patient-owned-by-user-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-patient-owner-001",
			providerReferences: { "his-patient": "his-patient-owner-001" },
			displayName: "归属用户一的患者",
			relationship: "self",
			cardNumberMasked: "******0001",
		},
	});

	let appointmentCalls = 0;
	let reportCalls = 0;
	let outpatientPaymentCalls = 0;
	const appointmentRecords: AppointmentRecordDirectoryGateway = {
		listRecords: async () => {
			appointmentCalls += 1;
			return {
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "must-not-be-called",
				},
			};
		},
	};
	const reportDirectory: ReportDirectoryGateway = {
		listReports: async () => {
			reportCalls += 1;
			return {
				reports: [],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "must-not-be-called",
				},
			};
		},
	};
	const outpatientGateway: OutpatientPaymentGateway = {
		listRecords: async () => {
			outpatientPaymentCalls += 1;
			return {
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "must-not-be-called",
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
				records: appointmentRecords,
			}),
			reports: new ReportService({
				repository: patientRepository,
				directory: reportDirectory,
			}),
			outpatientPayments: new OutpatientPaymentService({
				repository: patientRepository,
				gateway: outpatientGateway,
				authSysCode: "thirdSelfMachine",
				now: () => new Date("2026-08-16T10:20:30.000Z"),
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
	const authorization = `Bearer ${otherOwner.accessToken}`;

	const appointmentResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/appointments/records?patientId=patient-owned-by-user-001&startDate=2026-08-01&endDate=2026-08-31",
			{ headers: { authorization } },
		),
	);
	const reportResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/reports?patientId=patient-owned-by-user-001&startDate=2026-08-01&endDate=2026-08-31",
			{ headers: { authorization } },
		),
	);
	const outpatientResponse = await app.handle(
		new Request(
			"http://localhost/api/v1/payments/outpatient/records?patientId=patient-owned-by-user-001&status=paid",
			{ headers: { authorization } },
		),
	);

	expect(appointmentResponse.status).toBe(404);
	expect(await appointmentResponse.json()).toMatchObject({
		success: false,
		error: { code: "appointment-record-patient-not-found" },
	});
	expect(reportResponse.status).toBe(404);
	expect(await reportResponse.json()).toMatchObject({
		success: false,
		error: { code: "report-patient-not-found" },
	});
	expect(outpatientResponse.status).toBe(404);
	expect(await outpatientResponse.json()).toMatchObject({
		success: false,
		error: { code: "outpatient-payment-patient-not-found" },
	});

	// 越权请求必须在 owner + patient 映射边界被拒绝，不能先把用户 B 的请求
	// 转换成用户 A 的 provider 患者号再依赖 Provider 自己报错。
	expect(appointmentCalls).toBe(0);
	expect(reportCalls).toBe(0);
	expect(outpatientPaymentCalls).toBe(0);
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

test("payment routes fail closed before persistence while the payment gate is disabled", async () => {
	const sessions = createInMemorySessionTokenService();
	const issued = await sessions.issue("fixture-user-0001");
	const orderRepository = createInMemoryPaymentOrderRepository();
	let quoteLookups = 0;
	const paymentOrders = new PaymentOrderService({
		orders: orderRepository,
		quotes: {
			async findByOwnerAndId() {
				quoteLookups += 1;
				return {
					quoteId: "quote-disabled-001",
					ownerUserId: "fixture-user-0001",
					patientId: "patient-001",
					amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
					expiresAt: "2099-08-15T00:00:00.000Z",
					source: "fixture",
				};
			},
		},
	});
	const app = createApp({
		services: {
			auth: new AuthService({
				identityGateway: createFixtureWechatIdentityGateway(),
				identityUsers: createInMemoryIdentityUserRepository(),
				sessions,
			}),
			patients: new PatientService(createInMemoryPatientRepository()),
			paymentOrders,
			wechatPrepay: new WechatPrepayService({
				orders: paymentOrders,
				identityUsers: createInMemoryIdentityUserRepository(),
				attempts: createInMemoryPaymentPrepayAttemptRepository(),
				wechatPayment: createNotConfiguredGateways().wechatPayment,
			}),
			wechatPaymentNotifications: unusedWechatNotificationService(),
			appointments: unusedAppointmentService(),
			reports: unusedReportService(),
			sessions,
		},
	});
	const authorization = `Bearer ${issued.accessToken}`;

	const createResponse = await app.handle(
		new Request("http://localhost/api/v1/payments/orders", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization,
				"idempotency-key": "disabled-payment-order-001",
			},
			body: JSON.stringify({
				patientId: "patient-001",
				quoteId: "quote-disabled-001",
			}),
		}),
	);
	const readResponse = await app.handle(
		new Request("http://localhost/api/v1/payments/orders/order-never-created", {
			headers: { authorization },
		}),
	);

	// 支付关闭时必须在 quote 读取、订单写入和订单读取之前失败；否则即使
	// 预支付后续被拒绝，也会留下用户看得到但无法完成的半成品订单。
	expect(createResponse.status).toBe(503);
	expect(await createResponse.json()).toEqual({
		success: false,
		error: {
			code: "dependency-not-configured",
			message: "该服务暂未配置完成，请稍后重试",
		},
	});
	expect(readResponse.status).toBe(503);
	expect(await readResponse.json()).toEqual({
		success: false,
		error: {
			code: "dependency-not-configured",
			message: "该服务暂未配置完成，请稍后重试",
		},
	});
	expect(quoteLookups).toBe(0);
	expect(
		await orderRepository.findByOwnerAndIdempotencyKey(
			"fixture-user-0001",
			"disabled-payment-order-001",
		),
	).toBeUndefined();
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
		wechatPaymentEnabled: true,
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
