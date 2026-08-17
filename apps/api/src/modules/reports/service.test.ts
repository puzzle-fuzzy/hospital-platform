import { expect, test } from "bun:test";
import type {
	PatientRepository,
	ReportDetailGateway,
	ReportDirectoryGateway,
	ReportReferenceRepository,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	InvalidReportKindError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createInMemoryReportReferenceRepository } from "@hospital/persistence";
import {
	ReportNotFoundError,
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
		detailDisabledService.detail("user-001", "report-001", {
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

test("report details use a short-lived opaque reference and owner-scoped lookup", async () => {
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

	expect(await service.detail("user-001", reportId, context)).toEqual({
		reportId,
		kind: "laboratory",
		title: "血常规",
		reportedAt: "2026-08-15 10:00:00",
		items: [{ name: "白细胞", result: "10.2", flag: "high" }],
		hasAttachment: true,
	});
	await expect(
		service.detail("user-002", reportId, context),
	).rejects.toBeInstanceOf(ReportNotFoundError);
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
		findByOwnerAndId: async (
			_ownerUserId: string,
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
		service.detail("user-001", "report_missing", {
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
			findByOwnerAndId: async () => undefined,
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
