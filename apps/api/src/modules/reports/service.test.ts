import { expect, test } from "bun:test";
import type {
	LaboratoryReportDetail,
	PatientRepository,
	ReportDetailGateway,
	ReportDirectoryEntry,
	ReportDirectoryGateway,
	ReportReferenceRepository,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	InvalidReportKindError,
	MAX_REPORT_DIRECTORY_ITEMS,
	ReportResultValidationError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createInMemoryReportReferenceRepository } from "@hospital/persistence";
import {
	ReportNotFoundError,
	ReportPatientNotFoundError,
	ReportQueryError,
	ReportService,
} from "./service";

test("报告目录空结果是成功，非法查询和详情依赖缺失保留失败日志", async () => {
	const lines: string[] = [];
	let directoryCalls = 0;
	const logger = createLogger({
		service: "report-test",
		environment: "test",
		level: "info",
		destination: { write: (chunk) => lines.push(chunk) },
	});
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				directoryCalls += 1;
				return {
					reports: [],
					trace: {
						provider: "zhongyang" as const,
						operation: "reports-directory",
						requestId: "report-empty",
					},
				};
			},
		},
		logger,
	});
	const context = {
		traceId: "trace-report-empty",
		idempotencyKey: "key-report-empty",
	};

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			context,
		),
	).resolves.toEqual({ items: [], total: 0 });

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-02-30", endDate: "2026-03-01" },
			{ traceId: "trace-report-invalid", idempotencyKey: "key-report-invalid" },
		),
	).rejects.toBeInstanceOf(ReportQueryError);

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "unknown" as never,
			},
			{
				traceId: "trace-report-invalid-kind",
				idempotencyKey: "key-report-invalid-kind",
			},
		),
	).rejects.toBeInstanceOf(InvalidReportKindError);
	expect(directoryCalls).toBe(1);

	const detailDisabledService = new ReportService({
		repository: {
			resolveProviderReference: async () => undefined,
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "unused",
				},
			}),
		},
		logger,
	});
	await expect(
		detailDisabledService.detail("user-001", "patient-001", "report-001", {
			traceId: "trace-report-detail-disabled",
			idempotencyKey: "key-report-detail-disabled",
		}),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.directory.synced",
			traceId: "trace-report-empty",
			itemCount: 0,
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.directory.failed",
			traceId: "trace-report-invalid",
			errorType: "ReportQueryError",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.directory.failed",
			traceId: "trace-report-invalid-kind",
			errorType: "InvalidReportKindError",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.detail.failed",
			traceId: "trace-report-detail-disabled",
			errorType: "DependencyNotConfiguredError",
		}),
	);
});

test("报告 service 在 owner 映射、引用仓储和 Provider 前拒绝非法调用上下文", async () => {
	let repositoryCalls = 0;
	let directoryCalls = 0;
	let detailCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				return undefined;
			},
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				directoryCalls += 1;
				throw new Error("must not be called");
			},
		},
		detail: {
			getLaboratoryDetail: async () => {
				detailCalls += 1;
				throw new Error("must not be called");
			},
		},
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-02" },
			null as never,
		),
	).rejects.toBeInstanceOf(ReportQueryError);
	await expect(
		service.detail("user-001", "patient-001", "report-001", null as never),
	).rejects.toBeInstanceOf(ReportQueryError);
	await expect(
		service.list(
			"\u0000owner",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-02" },
			{ traceId: "trace-owner-invalid", idempotencyKey: "key-owner-invalid" },
		),
	).rejects.toBeInstanceOf(ReportQueryError);
	await expect(
		service.detail("\u0000owner", "patient-001", "report-001", {
			traceId: "trace-owner-invalid-detail",
			idempotencyKey: "key-owner-invalid-detail",
		}),
	).rejects.toBeInstanceOf(ReportQueryError);
	expect(repositoryCalls).toBe(0);
	expect(directoryCalls).toBe(0);
	expect(detailCalls).toBe(0);
});

test("报告目录拒绝异常 Provider trace 并只记录固定原因", async () => {
	const lines: string[] = [];
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [],
				trace: {
					provider: "zhongyang",
					operation: "report-directory",
					requestId: "bad\n-request-id",
				},
			}),
		},
		logger: createLogger({
			service: "report-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			{
				traceId: "trace-invalid-report-trace",
				idempotencyKey: "key-invalid-report-trace",
			},
		),
	).rejects.toBeInstanceOf(ExternalTraceReadModelValidationError);

	const output = lines.join("");
	expect(output).toContain('"resultViolation":"request-id-invalid"');
	expect(output).not.toContain("bad\\n-request-id");
});

test("报告目录 service 拒绝未知字段而不是静默丢弃查询意图", async () => {
	let providerCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				providerCalls += 1;
				throw new Error("report provider must not be called");
			},
		},
	});

	// 这类字段不属于报告目录公共查询 contract；不能因为 service 只读取
	// 日期和 kind，就把调用方的另一种患者/Provider 意图静默丢弃。
	await expect(
		service.list(
			"user-001",
			"patient-001",
			{
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				providerReportId: "provider-report-001",
			} as never,
			{
				traceId: "trace-report-unknown-query-field",
				idempotencyKey: "key-report-unknown-query-field",
			},
		),
	).rejects.toBeInstanceOf(ReportQueryError);

	expect(providerCalls).toBe(0);
});

test("报告目录 service 拒绝窗口外或无法解析的 Provider 时间并记录固定原因", async () => {
	for (const [reportedAt, violation] of [
		["2026-07-31 23:59:59", "reported-at-outside-query"],
		["未知时间", "reported-at-invalid"],
	] as const) {
		const lines: string[] = [];
		let successEvents = 0;
		const service = new ReportService({
			repository: {
				resolveProviderReference: async () => ({
					patientId: "patient-001",
					provider: "zhongyang" as const,
					providerPatientId: "provider-patient-001",
				}),
			} as unknown as PatientRepository,
			directory: {
				listReports: async () => ({
					reports: [
						{
							summary: {
								kind: "laboratory" as const,
								title: "血常规",
								reportedAt,
								status: "available" as const,
								hasAttachment: false,
							},
						},
					],
					trace: {
						provider: "zhongyang" as const,
						operation: "reports-directory",
						requestId: `report-window-${violation}`,
					},
				}),
			},
			logger: createLogger({
				service: "report-window-test",
				environment: "test",
				level: "info",
				destination: {
					write: (chunk) => {
						lines.push(chunk);
						if (chunk.includes('"event":"report.directory.synced"')) {
							successEvents += 1;
						}
					},
				},
			}),
		});

		await expect(
			service.list(
				"user-001",
				"patient-001",
				{ startDate: "2026-08-01", endDate: "2026-08-15" },
				{
					traceId: `trace-report-${violation}`,
					idempotencyKey: `key-report-${violation}`,
				},
			),
		).rejects.toMatchObject({ violation });
		const events = lines.map(
			(line) => JSON.parse(line) as Record<string, unknown>,
		);
		expect(successEvents).toBe(0);
		expect(events).toContainEqual(
			expect.objectContaining({
				event: "report.directory.failed",
				resultViolation: violation,
			}),
		);
	}
});

test("报告目录接受多 Provider 的有界请求号列表并完整写入低敏日志", async () => {
	const lines: string[] = [];
	const requestIds = ["a".repeat(70), "b".repeat(70), "c".repeat(70)];
	const primaryRequestId = requestIds[0];
	if (!primaryRequestId) throw new Error("test request id is missing");
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [],
				trace: {
					provider: "zhongyang" as const,
					operation: "reports-directory",
					requestId: primaryRequestId,
					requestIds,
				},
			}),
		},
		logger: createLogger({
			service: "report-trace-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			{
				traceId: "trace-report-multi-provider",
				idempotencyKey: "key-report-multi-provider",
			},
		),
	).resolves.toEqual({ items: [], total: 0 });

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.directory.synced",
			providerRequestId: primaryRequestId,
			providerRequestIds: requestIds,
		}),
	);
});

test("报告服务层拒绝绕过 HTTP schema 的畸形查询", async () => {
	const lines: string[] = [];
	let repositoryCalls = 0;
	let directoryCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				return undefined;
			},
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				directoryCalls += 1;
				throw new Error("provider must not be called");
			},
		},
		logger: createLogger({
			service: "report-input-test",
			environment: "test",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	for (const [query, traceId] of [
		[null, "trace-report-null-query"],
		[[], "trace-report-array-query"],
		[{ startDate: null, endDate: "2026-08-15" }, "trace-report-null-date"],
		[
			{ startDate: "2026-08-01", endDate: "2026-08-15", kind: null },
			"trace-report-null-kind",
		],
	] as const) {
		await expect(
			service.list("user-001", "patient-001", query as never, {
				traceId,
				idempotencyKey: `${traceId}-key`,
			}),
		).rejects.toBeInstanceOf(ReportQueryError);
	}

	expect(repositoryCalls).toBe(0);
	expect(directoryCalls).toBe(0);
	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	for (const traceId of [
		"trace-report-null-query",
		"trace-report-array-query",
		"trace-report-null-date",
		"trace-report-null-kind",
	]) {
		expect(events).toContainEqual(
			expect.objectContaining({
				event: "report.directory.failed",
				traceId,
				errorType: "ReportQueryError",
			}),
		);
	}
});

test("报告目录 service 拒绝仓储返回的非法或越界患者引用", async () => {
	for (const [reference, expectedViolation] of [
		[
			{
				patientId: "patient-other",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-other",
			},
			"reference-scope-mismatch",
		],
		[
			{
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider\u0000patient-001",
			},
			"reference-invalid",
		],
	] as const) {
		const lines: string[] = [];
		let directoryCalls = 0;
		const service = new ReportService({
			repository: {
				resolveProviderReference: async () => reference,
			} as unknown as PatientRepository,
			directory: {
				listReports: async () => {
					directoryCalls += 1;
					throw new Error("provider must not be called");
				},
			},
			logger: createLogger({
				service: "report-test",
				environment: "test",
				level: "info",
				destination: { write: (chunk) => lines.push(chunk) },
			}),
		});

		await expect(
			service.list(
				"user-001",
				"patient-001",
				{ startDate: "2026-08-01", endDate: "2026-08-15" },
				{
					traceId: `trace-reference-${expectedViolation}`,
					idempotencyKey: `key-reference-${expectedViolation}`,
				},
			),
		).rejects.toBeInstanceOf(ReportPatientNotFoundError);
		expect(directoryCalls).toBe(0);
		expect(lines.join("\n")).toContain(
			`"resultViolation":"${expectedViolation}"`,
		);
	}
});

test("report date ranges accept the configured span and reject anything wider", async () => {
	let providerCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				providerCalls += 1;
				return {
					reports: [],
					trace: {
						provider: "zhongyang",
						operation: "reports",
						requestId: "report-boundary",
					},
				};
			},
		},
	});
	const context = {
		traceId: "trace-report-boundary",
		idempotencyKey: "key-report-boundary",
	};

	// 报告接口当前同样按起止日期差值限制跨度，不把首尾日期数量当作上限。
	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-01-01", endDate: "2027-01-02" },
			context,
		),
	).resolves.toEqual({ items: [], total: 0 });
	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-01-01", endDate: "2027-01-03" },
			context,
		),
	).rejects.toBeInstanceOf(ReportQueryError);

	expect(providerCalls).toBe(1);
});

test("report queries reject impossible calendar dates before provider access", async () => {
	let providerCalls = 0;
	const directory: ReportDirectoryGateway = {
		listReports: async () => {
			providerCalls += 1;
			return {
				reports: [],
				trace: {
					provider: "zhongyang",
					operation: "reports",
					requestId: "unused",
				},
			};
		},
	};
	const repository = {
		resolveProviderReference: async () => undefined,
	} as unknown as PatientRepository;
	const service = new ReportService({ repository, directory });

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-02-30", endDate: "2026-03-01" },
			{ traceId: "trace-invalid-report", idempotencyKey: "key-invalid-report" },
		),
	).rejects.toBeInstanceOf(ReportQueryError);
	expect(providerCalls).toBe(0);
});

test("报告服务层拒绝非法 patientId/reportId 且不把原值写入日志", async () => {
	const lines: string[] = [];
	let repositoryCalls = 0;
	let directoryCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				return undefined;
			},
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				directoryCalls += 1;
				throw new Error("provider must not be called");
			},
		},
		logger: createLogger({
			service: "report-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});
	const oversizedPatientId = "x".repeat(129);

	await expect(
		service.list(
			"user-001",
			oversizedPatientId,
			{ startDate: "2026-08-01", endDate: "2026-08-02" },
			{ traceId: "trace-invalid-report-patient", idempotencyKey: "key-1" },
		),
	).rejects.toBeInstanceOf(ReportQueryError);
	await expect(
		service.detail("user-001", "patient-001", "\nreport-id", {
			traceId: "trace-invalid-report-reference",
			idempotencyKey: "key-2",
		}),
	).rejects.toBeInstanceOf(ReportQueryError);

	expect(repositoryCalls).toBe(0);
	expect(directoryCalls).toBe(0);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "report.directory.failed",
			traceId: "trace-invalid-report-patient",
			patientId: "invalid",
		}),
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "report.detail.failed",
			traceId: "trace-invalid-report-reference",
			reportId: "invalid",
		}),
	);
	expect(JSON.stringify(records)).not.toContain(oversizedPatientId);
	expect(JSON.stringify(records)).not.toContain("report-id");
});

test("report details use a short-lived opaque reference with owner and patient scope", async () => {
	const directory: ReportDirectoryGateway = {
		listReports: async () => ({
			reports: [
				{
					summary: {
						kind: "laboratory",
						title: "血常规",
						reportedAt: "2026-08-15 10:00:00",
						status: "abnormal",
						hasAttachment: true,
					},
					providerReportId: "provider-report-secret-001",
				},
			],
			trace: {
				provider: "zhongyang",
				operation: "reports-directory",
				requestId: "directory-request-001",
			},
		}),
	};
	const detail: ReportDetailGateway = {
		getLaboratoryDetail: async ({ providerReportId }) => {
			expect(providerReportId).toBe("provider-report-secret-001");
			return {
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
					requestId: "detail-request-001",
				},
			};
		},
	};
	const repository = {
		resolveProviderReference: async () => ({
			patientId: "patient-001",
			provider: "zhongyang" as const,
			providerPatientId: "provider-patient-001",
		}),
	} as unknown as PatientRepository;
	const references = createInMemoryReportReferenceRepository();
	const now = new Date("2026-08-16T00:00:00.000Z");
	const service = new ReportService({
		repository,
		directory,
		detail,
		references,
		now: () => now,
	});
	const context = {
		traceId: "trace-report-detail",
		idempotencyKey: "key-report-detail",
	};

	const list = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		context,
	);
	const reportId = list.items[0]?.reportId;
	expect(reportId).toBeDefined();
	if (!reportId) throw new Error("report reference was not created");
	expect(reportId).toMatch(/^report_[a-f0-9]{48}$/);
	expect(JSON.stringify(list)).not.toContain("provider-report-secret-001");

	expect(
		await service.detail("user-001", "patient-001", reportId, context),
	).toEqual({
		reportId,
		kind: "laboratory",
		title: "血常规",
		reportedAt: "2026-08-15 10:00:00",
		items: [{ name: "白细胞", result: "10.2", flag: "high" }],
		hasAttachment: true,
	});
	await expect(
		service.detail("user-002", "patient-001", reportId, context),
	).rejects.toBeInstanceOf(ReportNotFoundError);
	await expect(
		service.detail("user-001", "patient-002", reportId, context),
	).rejects.toBeInstanceOf(ReportNotFoundError);
});

test("报告目录短期引用保持目录顺序且不超过固定持久化并发度", async () => {
	let activeReferences = 0;
	let maximumReferences = 0;
	const requestedProviderReportIds: string[] = [];
	const reports: ReportDirectoryEntry[] = Array.from(
		{ length: 8 },
		(_, index) => ({
			summary: {
				kind: "laboratory" as const,
				title: `检验${index}`,
				reportedAt: "2026-08-15 10:00:00",
				status: "available" as const,
				hasAttachment: false,
			},
			providerReportId: `provider-report-${index}`,
		}),
	);
	const references: ReportReferenceRepository = {
		upsert: async (input) => {
			activeReferences += 1;
			maximumReferences = Math.max(maximumReferences, activeReferences);
			requestedProviderReportIds.push(input.providerReportId);
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeReferences -= 1;
			return {
				...input,
				createdAt: input.createdAt ?? "2026-08-16T00:00:00.000Z",
			};
		},
		findByOwnerPatientAndId: async () => undefined,
	};
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports,
				trace: {
					provider: "zhongyang" as const,
					operation: "reports-directory",
					requestId: "report-concurrency",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => {
				throw new Error("详情不应在目录查询中调用");
			},
		},
		references,
	});

	const result = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-concurrency",
			idempotencyKey: "key-report-concurrency",
		},
	);

	expect(maximumReferences).toBe(4);
	expect(requestedProviderReportIds).toEqual(
		Array.from({ length: 8 }, (_, index) => `provider-report-${index}`),
	);
	expect(result.items.map((item) => item.title)).toEqual(
		Array.from({ length: 8 }, (_, index) => `检验${index}`),
	);
});

test("报告详情引用的 TTL 使用注入的服务端时间基准", async () => {
	const captured: {
		createdAt?: string;
		expiresAt?: string;
		lookupAt?: string;
	} = {};
	const references: ReportReferenceRepository = {
		upsert: async (input) => {
			if (input.createdAt !== undefined) captured.createdAt = input.createdAt;
			captured.expiresAt = input.expiresAt;
			return {
				...input,
				createdAt: input.createdAt ?? "2026-08-16T00:00:00.000Z",
			};
		},
		findByOwnerPatientAndId: async (
			_ownerUserId: string,
			_patientId: string,
			_reportId: string,
			now: string,
		) => {
			captured.lookupAt = now;
			return undefined;
		},
	};
	const fixedNow = new Date("2026-08-16T00:00:00.000Z");
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "血常规",
							reportedAt: "2026-08-15 10:00:00",
							status: "available",
							hasAttachment: false,
						},
						providerReportId: "provider-report-001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "directory-request-001",
				},
			}),
		},
		references,
		detail: {
			getLaboratoryDetail: async () => {
				throw new Error("详情不应在本测试中调用");
			},
		},
		now: () => fixedNow,
	});

	await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{ traceId: "trace-report-clock", idempotencyKey: "key-report-clock" },
	);
	await expect(
		service.detail("user-001", "patient-001", "report_missing", {
			traceId: "trace-report-clock-detail",
			idempotencyKey: "key-report-clock-detail",
		}),
	).rejects.toBeInstanceOf(ReportNotFoundError);

	expect(captured.createdAt).toBe(fixedNow.toISOString());
	expect(captured.expiresAt).toBe(
		new Date(fixedNow.getTime() + 10 * 60 * 1000).toISOString(),
	);
	expect(captured.lookupAt).toBe(fixedNow.toISOString());
});

test("报告 service 拒绝仓储返回的跨患者详情引用", async () => {
	let detailCalls = 0;
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "血常规",
							reportedAt: "2026-08-15 10:00:00",
							status: "available",
							hasAttachment: true,
						},
						providerReportId: "provider-report-001",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "report-mismatched-reference",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => {
				detailCalls += 1;
				throw new Error("错误引用不应访问详情 Provider");
			},
		},
		references: {
			upsert: async (input) => ({
				...input,
				reportId: "report_foreign_reference",
				patientId: "patient-002",
				providerReportId: "provider-report-foreign",
				createdAt: input.createdAt ?? "2026-08-16T00:00:00.000Z",
			}),
			findByOwnerPatientAndId: async () => undefined,
		} satisfies ReportReferenceRepository,
		now: () => new Date("2026-08-16T00:00:00.000Z"),
	});

	const result = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-mismatched-reference",
			idempotencyKey: "key-report-mismatched-reference",
		},
	);

	// 引用写入返回了另一位患者的 scope，目录仍可安全展示，但不能带出
	// 错误 reportId，也不能因此访问详情 Provider。
	expect(result).toEqual({
		items: [
			{
				kind: "laboratory",
				title: "血常规",
				reportedAt: "2026-08-15 10:00:00",
				status: "available",
				hasAttachment: true,
			},
		],
		total: 1,
	});
	expect(detailCalls).toBe(0);
});

test("报告详情 service 拒绝仓储返回的跨范围引用且不调用 Provider", async () => {
	let detailCalls = 0;
	const now = new Date("2026-08-16T00:00:00.000Z");
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => {
				throw new Error("目录不应在详情查询中调用");
			},
		},
		detail: {
			getLaboratoryDetail: async () => {
				detailCalls += 1;
				throw new Error("跨范围引用不应访问详情 Provider");
			},
		},
		references: {
			upsert: async (input) => ({
				...input,
				createdAt: input.createdAt ?? now.toISOString(),
			}),
			findByOwnerPatientAndId: async () => ({
				reportId: "report_foreign",
				ownerUserId: "user-002",
				patientId: "patient-002",
				provider: "zhongyang" as const,
				kind: "laboratory" as const,
				providerReportId: "provider-report-foreign",
				expiresAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
				createdAt: now.toISOString(),
			}),
		},
		now: () => now,
	});

	await expect(
		service.detail("user-001", "patient-001", "report_requested", {
			traceId: "trace-report-detail-scope",
			idempotencyKey: "key-report-detail-scope",
		}),
	).rejects.toBeInstanceOf(ReportNotFoundError);
	// 读取到错误范围引用后必须在 Provider 调用前 fail-closed，避免跨患者临床数据泄漏。
	expect(detailCalls).toBe(0);
});

test("报告目录批量引用共享同一次观察时钟", async () => {
	let nowCalls = 0;
	const captured: Array<{ createdAt: string; expiresAt: string }> = [];
	const fixedNow = new Date("2026-08-16T00:00:00.000Z");
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory" as const,
							title: "血常规",
							reportedAt: "2026-08-15 10:00:00",
							status: "available" as const,
							hasAttachment: false,
						},
						providerReportId: "provider-report-001",
					},
					{
						summary: {
							kind: "laboratory" as const,
							title: "肝功能",
							reportedAt: "2026-08-15 10:01:00",
							status: "available" as const,
							hasAttachment: false,
						},
						providerReportId: "provider-report-002",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "directory-clock-shared",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => {
				throw new Error("详情不应在本测试中调用");
			},
		},
		references: {
			upsert: async (input) => {
				captured.push({
					createdAt: input.createdAt ?? "",
					expiresAt: input.expiresAt,
				});
				return {
					...input,
					createdAt: input.createdAt ?? fixedNow.toISOString(),
				};
			},
			findByOwnerPatientAndId: async () => undefined,
		},
		now: () => {
			nowCalls += 1;
			return new Date(fixedNow);
		},
	});

	await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-clock-shared",
			idempotencyKey: "key-report-clock-shared",
		},
	);

	expect(nowCalls).toBe(1);
	expect(captured).toHaveLength(2);
	expect(new Set(captured.map(({ createdAt }) => createdAt))).toEqual(
		new Set([fixedNow.toISOString()]),
	);
	expect(new Set(captured.map(({ expiresAt }) => expiresAt))).toEqual(
		new Set([new Date(fixedNow.getTime() + 10 * 60 * 1000).toISOString()]),
	);
});

test("report directory keeps a summary when a provider detail reference is missing", async () => {
	const summary = {
		kind: "laboratory" as const,
		title: "血常规",
		reportedAt: "2026-08-15 10:00:00",
		status: "available" as const,
		hasAttachment: false,
	};
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [{ summary }],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "directory-without-detail-reference",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => {
				throw new Error("详情不应在缺少 provider 报告号时被调用");
			},
		} as ReportDetailGateway,
		references: createInMemoryReportReferenceRepository(),
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			{
				traceId: "trace-report-summary-only",
				idempotencyKey: "key-report-summary-only",
			},
		),
	).resolves.toEqual({ items: [summary], total: 1 });
});

test("报告详情引用持久化失败时保留摘要并记录低敏告警", async () => {
	const lines: string[] = [];
	const providerReportId = "provider-report-secret-002";
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory" as const,
							title: "肝功能",
							reportedAt: "2026-08-15 10:01:00",
							status: "available" as const,
							hasAttachment: true,
						},
						providerReportId,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "directory-reference-write-failed",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => {
				throw new Error("详情引用失败时不应调用 provider 详情");
			},
		},
		references: {
			upsert: async () => {
				throw new Error("mysql temporarily unavailable");
			},
			findByOwnerPatientAndId: async () => undefined,
		},
		logger: createLogger({
			service: "report-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	const result = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-reference-write-failed",
			idempotencyKey: "key-report-reference-write-failed",
		},
	);

	expect(result).toEqual({
		items: [
			{
				kind: "laboratory",
				title: "肝功能",
				reportedAt: "2026-08-15 10:01:00",
				status: "available",
				hasAttachment: true,
			},
		],
		total: 1,
	});
	const output = lines.join("\n");
	expect(output).toContain("report.detail_reference.failed");
	expect(output).toContain("trace-report-reference-write-failed");
	expect(output).not.toContain(providerReportId);
	expect(output).not.toContain("mysql temporarily unavailable");
});

test("报告 service 二次校验并重新投影目录和 LIS 详情", async () => {
	const references = createInMemoryReportReferenceRepository();
	const providerReportId = "provider-report-service-projection";
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "肝功能",
							reportedAt: "2026-08-15 10:01:00",
							status: "available",
							hasAttachment: true,
							providerPatientName: "provider-patient-name-secret",
						} as unknown as ReportDirectoryEntry["summary"],
						providerReportId,
					} as unknown as ReportDirectoryEntry,
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "report-projection-directory",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => ({
				detail: {
					kind: "laboratory",
					title: "肝功能",
					reportedAt: "2026-08-15 10:01:00",
					items: [
						{
							name: "丙氨酸氨基转移酶",
							result: "22",
							unit: "U/L",
							referenceRange: "9-50",
							flag: "normal",
							providerItemId: "provider-item-secret",
						},
					],
					hasAttachment: true,
					patientName: "provider-patient-name-secret",
					fileUrl: "https://provider.invalid/secret-file",
				} as unknown as LaboratoryReportDetail,
				trace: {
					provider: "zhongyang",
					operation: "reports-detail",
					requestId: "report-projection-detail",
				},
			}),
		},
		references,
	});

	const list = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-projection-list",
			idempotencyKey: "key-report-projection-list",
		},
	);
	const listOutput = JSON.stringify(list);
	expect(list.items).toHaveLength(1);
	expect(list.items[0]?.reportId).toMatch(/^report_/);
	expect(listOutput).not.toContain("provider-patient-name-secret");

	const reportId = list.items[0]?.reportId;
	if (!reportId) throw new Error("report reference was not created");
	const detail = await service.detail("user-001", "patient-001", reportId, {
		traceId: "trace-report-projection-detail",
		idempotencyKey: "key-report-projection-detail",
	});
	const detailOutput = JSON.stringify(detail);
	expect(detail).toEqual({
		reportId,
		kind: "laboratory",
		title: "肝功能",
		reportedAt: "2026-08-15 10:01:00",
		items: [
			{
				name: "丙氨酸氨基转移酶",
				result: "22",
				unit: "U/L",
				referenceRange: "9-50",
				flag: "normal",
			},
		],
		hasAttachment: true,
	});
	expect(detailOutput).not.toContain("provider-item-secret");
	expect(detailOutput).not.toContain("provider.invalid");
});

test("报告详情 service 拒绝无法解析的临床时间并记录固定原因", async () => {
	const lines: string[] = [];
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory" as const,
							title: "血常规",
							reportedAt: "2026-08-15 10:00:00",
							status: "available" as const,
							hasAttachment: false,
						},
						providerReportId: "provider-report-invalid-time",
					},
				],
				trace: {
					provider: "zhongyang" as const,
					operation: "reports-directory",
					requestId: "report-detail-invalid-time-directory",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => ({
				detail: {
					kind: "laboratory",
					title: "血常规",
					reportedAt: "未知时间",
					items: [{ name: "白细胞", result: "10.2", flag: "normal" }],
					hasAttachment: false,
				},
				trace: {
					provider: "zhongyang" as const,
					operation: "reports-detail",
					requestId: "report-detail-invalid-time",
				},
			}),
		},
		references: createInMemoryReportReferenceRepository(),
		logger: createLogger({
			service: "report-detail-time-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	const list = await service.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-detail-invalid-time-list",
			idempotencyKey: "key-report-detail-invalid-time-list",
		},
	);
	const reportId = list.items[0]?.reportId;
	if (!reportId) throw new Error("report reference was not created");

	await expect(
		service.detail("user-001", "patient-001", reportId, {
			traceId: "trace-report-detail-invalid-time",
			idempotencyKey: "key-report-detail-invalid-time",
		}),
	).rejects.toMatchObject({
		violation: "detail-reported-at-invalid",
	});
	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.detail.failed",
			resultViolation: "detail-reported-at-invalid",
		}),
	);
});

test("报告 service 拒绝异常目录和详情读模型并记录有限原因", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "report-result-validation-test",
		environment: "test",
		level: "info",
		destination: { write: (chunk) => lines.push(chunk) },
	});
	const createRepository = (): PatientRepository =>
		({
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		}) as unknown as PatientRepository;

	const invalidDirectoryService = new ReportService({
		repository: createRepository(),
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "肝功能",
							reportedAt: "2026-08-15 10:01:00",
							status: "provider-pending",
							hasAttachment: false,
							providerRaw: "provider-raw-secret",
						} as unknown as ReportDirectoryEntry["summary"],
					} as unknown as ReportDirectoryEntry,
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "report-invalid-directory",
				},
			}),
		},
		logger,
	});

	const directoryError = await invalidDirectoryService
		.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			{
				traceId: "trace-report-invalid-directory",
				idempotencyKey: "key-report-invalid-directory",
			},
		)
		.catch((error: unknown) => error);
	expect(directoryError).toBeInstanceOf(ReportResultValidationError);
	expect((directoryError as ReportResultValidationError).violation).toBe(
		"status-invalid",
	);

	const references = createInMemoryReportReferenceRepository();
	const invalidDetailService = new ReportService({
		repository: createRepository(),
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "laboratory",
							title: "肝功能",
							reportedAt: "2026-08-15 10:01:00",
							status: "available",
							hasAttachment: false,
						},
						providerReportId: "provider-report-invalid-detail",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "report-valid-directory-for-invalid-detail",
				},
			}),
		},
		detail: {
			getLaboratoryDetail: async () => ({
				detail: {
					kind: "laboratory",
					title: "肝功能",
					reportedAt: "2026-08-15 10:01:00",
					items: [
						{
							name: "",
							result: "22",
							flag: "normal",
						},
					],
					hasAttachment: false,
				} as unknown as LaboratoryReportDetail,
				trace: {
					provider: "zhongyang",
					operation: "reports-detail",
					requestId: "report-invalid-detail",
				},
			}),
		},
		references,
		logger,
	});
	const validList = await invalidDetailService.list(
		"user-001",
		"patient-001",
		{ startDate: "2026-08-01", endDate: "2026-08-15" },
		{
			traceId: "trace-report-valid-directory",
			idempotencyKey: "key-report-valid-directory",
		},
	);
	const reportId = validList.items[0]?.reportId;
	if (!reportId) throw new Error("report reference was not created");
	const detailError = await invalidDetailService
		.detail("user-001", "patient-001", reportId, {
			traceId: "trace-report-invalid-detail",
			idempotencyKey: "key-report-invalid-detail",
		})
		.catch((error: unknown) => error);
	expect(detailError).toBeInstanceOf(ReportResultValidationError);
	expect((detailError as ReportResultValidationError).violation).toBe(
		"detail-field-invalid",
	);

	const output = lines.join("\n");
	expect(output).toContain('"resultViolation":"status-invalid"');
	expect(output).toContain('"resultViolation":"detail-field-invalid"');
	expect(output).not.toContain("provider-raw-secret");
});

test("报告 service 绑定指定来源筛选并整批拒绝错配结果", async () => {
	const lines: string[] = [];
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports: [
					{
						summary: {
							kind: "imaging",
							title: "胸部影像",
							reportedAt: "2026-08-15 10:00:00",
							status: "available",
							hasAttachment: true,
						},
					},
				] as ReportDirectoryEntry[],
				trace: {
					provider: "zhongyang" as const,
					operation: "reports-directory",
					requestId: "report-kind-mismatch",
				},
			}),
		},
		logger: createLogger({
			service: "report-kind-binding-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "laboratory",
			},
			{
				traceId: "trace-report-kind-mismatch",
				idempotencyKey: "key-report-kind-mismatch",
			},
		),
	).rejects.toMatchObject({
		name: "ReportResultValidationError",
		violation: "report-kind-mismatch",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "report.directory.failed",
			traceId: "trace-report-kind-mismatch",
			resultViolation: "report-kind-mismatch",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({ event: "report.directory.synced" }),
	);
});

test("报告目录 service 超过资源上限时不创建短期详情引用", async () => {
	const reports = Array.from(
		{ length: MAX_REPORT_DIRECTORY_ITEMS + 1 },
		(_, index) => ({
			summary: {
				kind: "laboratory" as const,
				title: "血常规",
				reportedAt: "2026-08-15 10:00:00",
				status: "available" as const,
				hasAttachment: false,
			},
			providerReportId: `provider-report-too-many-${index}`,
		}),
	);
	const referenceStore = createInMemoryReportReferenceRepository();
	let referenceWrites = 0;
	const references: ReportReferenceRepository = {
		upsert: async (input) => {
			referenceWrites += 1;
			return referenceStore.upsert(input);
		},
		findByOwnerPatientAndId: referenceStore.findByOwnerPatientAndId,
	};
	const service = new ReportService({
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		directory: {
			listReports: async () => ({
				reports,
				trace: {
					provider: "zhongyang",
					operation: "reports-directory",
					requestId: "report-too-many-service",
				},
			}),
		},
		references,
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-15" },
			{
				traceId: "trace-report-too-many",
				idempotencyKey: "key-report-too-many",
			},
		),
	).rejects.toMatchObject({
		name: "ReportResultValidationError",
		violation: "reports-too-many",
	});
	expect(referenceWrites).toBe(0);
});
