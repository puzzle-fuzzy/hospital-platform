import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type {
	AppointmentDirectoryGateway,
	AppointmentRecord,
	PatientRepository,
} from "@hospital/domain";
import { DependencyNotConfiguredError } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createInMemoryAppointmentScheduleSnapshotRepository } from "@hospital/persistence";
import {
	AppointmentRecordQueryError,
	AppointmentScheduleQueryError,
	AppointmentService,
} from "./service";

test("appointment schedule reads persist a short-lived server snapshot", async () => {
	const directory: AppointmentDirectoryGateway = {
		listDepartments: async () => ({
			departments: [],
			trace: {
				provider: "zhongyang",
				operation: "appointment-departments",
				requestId: "unused",
			},
		}),
		listSchedules: async () => ({
			schedules: [
				{
					providerScheduleId: "provider-schedule-001",
					departmentId: "dept-001",
					departmentName: "心内科",
					doctorId: "doctor-001",
					doctorName: "李医生",
					workDate: "2026-08-20",
					shiftName: "上午",
					totalSlots: 30,
					availableSlots: 12,
					timeGroup: "range",
				},
			],
			trace: {
				provider: "zhongyang",
				operation: "appointment-schedules",
				requestId: "provider-request-001",
			},
		}),
	};
	const snapshots = createInMemoryAppointmentScheduleSnapshotRepository();
	const service = new AppointmentService({
		directory,
		snapshots,
		now: () => new Date("2026-08-15T00:00:00.000Z"),
		createScheduleId: () => "platform-schedule-001",
	});

	await service.listSchedules(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		{ traceId: "trace-001", idempotencyKey: "key-001" },
	);

	expect(
		await snapshots.findActive(
			"platform-schedule-001",
			"2026-08-15T00:00:30.000Z",
		),
	).toMatchObject({
		provider: "zhongyang",
		providerScheduleId: "provider-schedule-001",
		providerRequestId: "provider-request-001",
		expiresAt: "2026-08-15T00:01:00.000Z",
	});
});

test("appointment snapshot expiry uses the same observed clock sample", async () => {
	let nowCalls = 0;
	const snapshots = createInMemoryAppointmentScheduleSnapshotRepository();
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [
					{
						providerScheduleId: "provider-schedule-clock",
						departmentId: "dept-clock",
						departmentName: "心内科",
						doctorId: "doctor-clock",
						doctorName: "李医生",
						workDate: "2026-08-20",
						shiftName: "上午",
						totalSlots: 10,
						availableSlots: 5,
						timeGroup: "range" as const,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "provider-request-clock",
				},
			}),
		},
		snapshots,
		now: () => {
			nowCalls += 1;
			return new Date(
				`2026-08-15T00:00:${String(nowCalls * 5).padStart(2, "0")}.000Z`,
			);
		},
		createScheduleId: () => "platform-schedule-clock",
	});

	await service.listSchedules(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		{ traceId: "trace-clock", idempotencyKey: "key-clock" },
	);

	expect(nowCalls).toBe(1);
	expect(
		await snapshots.findActive(
			"platform-schedule-clock",
			"2026-08-15T00:00:59.999Z",
		),
	).toMatchObject({
		observedAt: "2026-08-15T00:00:05.000Z",
		expiresAt: "2026-08-15T00:01:05.000Z",
	});
});

test("appointment department reads add the provider date window on the server", async () => {
	let departmentInput: { startDate: string; endDate: string } | undefined;
	const service = new AppointmentService({
		directory: {
			listDepartments: async (input) => {
				departmentInput = input;
				return {
					departments: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-departments",
						requestId: "department-request-001",
					},
				};
			},
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		now: () => new Date("2026-08-15T16:00:00.000Z"),
	});

	await expect(
		service.listDepartments({
			traceId: "department-trace-001",
			idempotencyKey: "department-key-001",
		}),
	).resolves.toEqual({ items: [], total: 0 });
	expect(departmentInput).toEqual({
		startDate: "2026-08-16",
		endDate: "2026-08-23",
	});
});

test("appointment date ranges accept the configured span and reject anything wider", async () => {
	let scheduleProviderCalls = 0;
	let recordProviderCalls = 0;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => {
				scheduleProviderCalls += 1;
				return {
					schedules: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-schedules",
						requestId: "schedule-boundary",
					},
				};
			},
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => {
				recordProviderCalls += 1;
				return {
					records: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-records",
						requestId: "record-boundary",
					},
				};
			},
		},
	});
	const context = {
		traceId: "trace-date-boundary",
		idempotencyKey: "key-date-boundary",
	};

	// 当前校验的是起止日期差值，因此差值等于上限仍然属于合法请求。
	await expect(
		service.listSchedules(
			{ startDate: "2026-01-01", endDate: "2026-02-01" },
			context,
		),
	).resolves.toEqual({ items: [], total: 0 });
	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-01-01", endDate: "2027-01-02" },
			context,
		),
	).resolves.toEqual({ items: [], total: 0 });

	await expect(
		service.listSchedules(
			{ startDate: "2026-01-01", endDate: "2026-02-02" },
			context,
		),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-01-01", endDate: "2027-01-03" },
			context,
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	expect(scheduleProviderCalls).toBe(1);
	expect(recordProviderCalls).toBe(1);
});

test("appointment record empty results are successful and record failures are logged", async () => {
	const lines: string[] = [];
	const logger = createLogger({
		service: "appointment-test",
		environment: "test",
		destination: { write: (chunk: string) => lines.push(chunk) },
	});
	let providerCalls = 0;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => {
				providerCalls += 1;
				return {
					records: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-records",
						requestId: "record-empty",
					},
				};
			},
		},
		logger,
	});

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{ traceId: "trace-record-empty", idempotencyKey: "key-record-empty" },
		),
	).resolves.toEqual({ items: [], total: 0 });

	const successEvents = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(successEvents).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.synced",
			itemCount: 0,
			statusCounts: {},
		}),
	);
	expect(successEvents).not.toContainEqual(
		expect.objectContaining({ event: "appointment.records.failed" }),
	);

	const failingService = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		logger,
	});
	await expect(
		failingService.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{
				traceId: "trace-record-dependency",
				idempotencyKey: "key-record-dependency",
			},
		),
	).rejects.toBeInstanceOf(DependencyNotConfiguredError);
	const dependencyFailureEvents = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(dependencyFailureEvents).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-record-dependency",
			errorType: "DependencyNotConfiguredError",
		}),
	);

	const failingProviderService = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => {
				throw new ProviderRequestError({
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "provider-record-failed",
					statusCode: 403,
					retryable: false,
					message: "provider unavailable",
				});
			},
		},
		logger,
	});
	await expect(
		failingProviderService.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{
				traceId: "trace-record-provider",
				idempotencyKey: "key-record-provider",
			},
		),
	).rejects.toThrow("provider unavailable");
	const providerFailureEvents = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(providerFailureEvents).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-record-provider",
			errorType: "ProviderRequestError",
		}),
	);
	const providerFailure = providerFailureEvents.find(
		(record) =>
			record.event === "appointment.records.failed" &&
			record.traceId === "trace-record-provider",
	);
	expect(providerFailure).toMatchObject({
		providerOperation: "appointment-records",
		providerRequestId: "provider-record-failed",
		providerStatusCode: 403,
		providerRetryable: false,
	});
	expect(JSON.stringify(providerFailure)).not.toContain("provider unavailable");
	expect(providerCalls).toBe(1);
});

test("snapshot persistence failure does not turn a read directory into fake success", async () => {
	const lines: string[] = [];
	const schedule = {
		departmentId: "dept-001",
		departmentName: "心内科",
		doctorId: "doctor-001",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 30,
		availableSlots: 12,
		timeGroup: "range" as const,
	};
	const providerSchedule = {
		...schedule,
		providerScheduleId: "provider-schedule-002",
	};
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [providerSchedule],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "provider-request-002",
				},
			}),
		},
		snapshots: {
			upsert: async () => {
				throw new Error("schema unavailable");
			},
			findActive: async () => undefined,
		},
		createScheduleId: () => "platform-schedule-002",
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{ traceId: "trace-002", idempotencyKey: "key-002" },
		),
	).resolves.toEqual({
		items: [{ ...schedule, scheduleId: "platform-schedule-002" }],
		total: 1,
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "appointment.schedule_snapshots.failed",
			errorType: "Error",
		}),
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.synced",
			snapshotPersistenceStatus: "unavailable",
		}),
	);
});

test("appointment queries reject impossible calendar dates before provider access", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listSchedules(
			{ startDate: "2026-02-30", endDate: "2026-03-01" },
			{
				traceId: "trace-invalid-schedule",
				idempotencyKey: "key-invalid-schedule",
			},
		),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-02-28", endDate: "2026-02-31" },
			{
				traceId: "trace-invalid-record",
				idempotencyKey: "key-invalid-record",
			},
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.failed",
			traceId: "trace-invalid-schedule",
			errorType: "AppointmentScheduleQueryError",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.requested",
			traceId: "trace-invalid-schedule",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-invalid-record",
			errorType: "AppointmentRecordQueryError",
		}),
	);
});

test("appointment department date generation failures are logged before provider access", async () => {
	const lines: string[] = [];
	let providerCalls = 0;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => {
				providerCalls += 1;
				return {
					departments: [],
					trace: {
						provider: "zhongyang" as const,
						operation: "appointment-departments",
						requestId: "must-not-call",
					},
				};
			},
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang" as const,
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		now: () => new Date(Number.NaN),
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listDepartments({
			traceId: "trace-invalid-department-clock",
			idempotencyKey: "key-invalid-department-clock",
		}),
	).rejects.toThrow();

	expect(providerCalls).toBe(0);
	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.departments.failed",
			traceId: "trace-invalid-department-clock",
			errorType: "RangeError",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.departments.requested",
			traceId: "trace-invalid-department-clock",
		}),
	);
});

test("预约服务层拒绝越过 HTTP schema 的非法 opaque 标识", async () => {
	const lines: string[] = [];
	let providerCalls = 0;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "must-not-call",
				},
			}),
			listSchedules: async () => {
				providerCalls += 1;
				throw new Error("provider must not be called");
			},
		},
		repository: {
			resolveProviderReference: async () => {
				providerCalls += 1;
				return undefined;
			},
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => {
				providerCalls += 1;
				throw new Error("provider must not be called");
			},
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});
	const oversizedPatientId = "x".repeat(129);

	await expect(
		service.listSchedules(
			{
				startDate: "2026-08-01",
				endDate: "2026-08-02",
				departmentId: "   ",
			},
			{ traceId: "trace-invalid-department-id", idempotencyKey: "key-1" },
		),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	await expect(
		service.listRecords(
			"user-001",
			oversizedPatientId,
			{ startDate: "2026-08-01", endDate: "2026-08-02" },
			{ traceId: "trace-invalid-patient-id", idempotencyKey: "key-2" },
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	expect(providerCalls).toBe(0);
	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-invalid-patient-id",
			patientId: "invalid",
			errorType: "AppointmentRecordQueryError",
		}),
	);
	expect(JSON.stringify(records)).not.toContain(oversizedPatientId);
});

test("预约记录 service 二次校验并只投影公共字段", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => ({
				records: [
					{
						departmentName: "心内科",
						doctorName: "李医生",
						workDate: "2026-08-20",
						workTime: "08:00",
						location: "门诊楼二层",
						serialNumber: "12",
						status: "scheduled",
						// 模拟错误网关夹带的字段；service 必须重新投影，不能泄露。
						appointmentInfoId: "provider-record-secret",
						patId: "provider-patient-secret",
						registrationFee: 99,
					} as unknown as AppointmentRecord,
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "record-projection",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{
				traceId: "trace-record-projection",
				idempotencyKey: "key-record-projection",
			},
		),
	).resolves.toEqual({
		items: [
			{
				departmentName: "心内科",
				doctorName: "李医生",
				workDate: "2026-08-20",
				workTime: "08:00",
				location: "门诊楼二层",
				serialNumber: "12",
				status: "scheduled",
			},
		],
		total: 1,
	});

	const successEvent = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((record) => record.event === "appointment.records.synced");
	expect(successEvent).toMatchObject({
		itemCount: 1,
		statusCounts: { scheduled: 1 },
	});
});

test("预约记录 service 拒绝非法网关结果并保留低敏失败原因", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => ({
				records: [
					{
						workDate: "2026-02-30",
						status: "scheduled",
					} as unknown as AppointmentRecord,
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "record-invalid-result",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{ traceId: "trace-invalid-result", idempotencyKey: "key-invalid-result" },
		),
	).rejects.toMatchObject({
		name: "AppointmentRecordResultValidationError",
		violation: "work-date-invalid",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-invalid-result",
			errorType: "AppointmentRecordResultValidationError",
			resultViolation: "work-date-invalid",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({ event: "appointment.records.synced" }),
	);
});

test("预约记录 service 拒绝查询窗口外结果且不筛掉坏行伪装成功", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "unused",
					requestId: "unused",
				},
			}),
		},
		repository: {
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		} as unknown as PatientRepository,
		records: {
			listRecords: async () => ({
				// 一条在窗口内、一条在窗口外；整批拒绝才能避免目录不完整。
				records: [
					{ workDate: "2026-08-31", status: "scheduled" },
					{ workDate: "2026-09-01", status: "scheduled" },
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "record-outside-window",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-31" },
			{
				traceId: "trace-outside-window",
				idempotencyKey: "key-outside-window",
			},
		),
	).rejects.toMatchObject({
		name: "AppointmentRecordResultValidationError",
		violation: "work-date-outside-query",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-outside-window",
			errorType: "AppointmentRecordResultValidationError",
			resultViolation: "work-date-outside-query",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({ event: "appointment.records.synced" }),
	);
});
