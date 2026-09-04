import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type {
	AppointmentDepartment,
	AppointmentDirectoryGateway,
	type AppointmentRegistration,
	AppointmentProviderSchedule,
	AppointmentRecord,
	AppointmentScheduleQuery,
	AppointmentScheduleSnapshotRepository,
	PatientRepository,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	MAX_APPOINTMENT_SCHEDULE_ITEMS,
} from "@hospital/domain";
import { createLogger, createNoopLogger } from "@hospital/observability";
import { createInMemoryAppointmentScheduleSnapshotRepository } from "@hospital/persistence";
import {
	AppointmentRecordPatientNotFoundError,
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
	const lines: string[] = [];
	const service = new AppointmentService({
		directory,
		snapshots,
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
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

	expect(lines.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({
			event: "appointment.schedule_snapshots.persisted",
			traceId: "trace-001",
		}),
	);
});

test("预约 service 在 Provider 和快照仓储前拒绝非法调用上下文", async () => {
	let directoryCalls = 0;
	const directory: AppointmentDirectoryGateway = {
		listDepartments: async () => {
			directoryCalls += 1;
			return {
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "departments",
					requestId: "unused",
				},
			};
		},
		listSchedules: async () => {
			directoryCalls += 1;
			return {
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "schedules",
					requestId: "unused",
				},
			};
		},
	};
	const service = new AppointmentService({ directory });

	await expect(service.listDepartments(null as never)).rejects.toBeInstanceOf(
		AppointmentScheduleQueryError,
	);
	await expect(
		service.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			null as never,
		),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			null as never,
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);
	await expect(
		service.listRecords(
			"\u0000owner",
			"patient-001",
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{ traceId: "trace-owner-invalid", idempotencyKey: "key-owner-invalid" },
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	expect(directoryCalls).toBe(0);
});

test("预约排班快照保持目录顺序且不超过固定持久化并发度", async () => {
	let activeSnapshots = 0;
	let maximumSnapshots = 0;
	const requestedProviderScheduleIds: string[] = [];
	const schedules: AppointmentProviderSchedule[] = Array.from(
		{ length: 8 },
		(_, index) => ({
			providerScheduleId: `provider-schedule-${index}`,
			departmentId: `dept-${index}`,
			departmentName: `科室${index}`,
			doctorId: `doctor-${index}`,
			doctorName: `医生${index}`,
			workDate: "2026-08-20",
			shiftName: "上午",
			totalSlots: 30,
			availableSlots: 12,
			timeGroup: "range" as const,
		}),
	);
	const snapshotStore = createInMemoryAppointmentScheduleSnapshotRepository();
	const snapshots: AppointmentScheduleSnapshotRepository = {
		upsert: async (input) => {
			activeSnapshots += 1;
			maximumSnapshots = Math.max(maximumSnapshots, activeSnapshots);
			requestedProviderScheduleIds.push(input.providerScheduleId);
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeSnapshots -= 1;
			return snapshotStore.upsert(input);
		},
		findActive: (scheduleId, now) => snapshotStore.findActive(scheduleId, now),
	};
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-departments",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules,
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-schedules",
					requestId: "appointment-concurrency",
				},
			}),
		},
		snapshots,
		createScheduleId: (() => {
			let index = 0;
			return () => `platform-schedule-${index++}`;
		})(),
	});

	const result = await service.listSchedules(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		{
			traceId: "trace-appointment-concurrency",
			idempotencyKey: "key-appointment-concurrency",
		},
	);

	expect(maximumSnapshots).toBe(4);
	expect(requestedProviderScheduleIds).toEqual(
		Array.from({ length: 8 }, (_, index) => `provider-schedule-${index}`),
	);
	expect(result.items.map((item) => item.doctorName)).toEqual(
		Array.from({ length: 8 }, (_, index) => `医生${index}`),
	);
});

test("预约排班快照写入失败后不再领取新的快照任务", async () => {
	const requestedProviderScheduleIds: string[] = [];
	const schedules: AppointmentProviderSchedule[] = Array.from(
		{ length: 8 },
		(_, index) => ({
			providerScheduleId: `provider-schedule-failure-${index}`,
			departmentId: `dept-failure-${index}`,
			departmentName: `科室${index}`,
			doctorId: `doctor-failure-${index}`,
			doctorName: `医生${index}`,
			workDate: "2026-08-20",
			shiftName: "上午",
			totalSlots: 30,
			availableSlots: 12,
			timeGroup: "range" as const,
		}),
	);
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-departments",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules,
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-schedules",
					requestId: "appointment-failure",
				},
			}),
		},
		snapshots: {
			upsert: async (input) => {
				requestedProviderScheduleIds.push(input.providerScheduleId);
				await new Promise((resolve) =>
					setTimeout(resolve, input.providerScheduleId.endsWith("-1") ? 5 : 30),
				);
				if (input.providerScheduleId.endsWith("-1")) {
					throw new Error("snapshot storage unavailable");
				}
				return {
					scheduleId: input.schedule.scheduleId,
					...input,
				};
			},
			findActive: async () => undefined,
		},
		createScheduleId: (() => {
			let index = 0;
			return () => `platform-failure-schedule-${index++}`;
		})(),
	});

	await expect(
		service.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{
				traceId: "trace-appointment-failure",
				idempotencyKey: "key-appointment-failure",
			},
		),
	).resolves.toMatchObject({ total: 8 });

	// 前四个任务已在途；第二个失败后，不能再把第五个及之后的排班交给仓储。
	expect(requestedProviderScheduleIds).toEqual(
		Array.from(
			{ length: 4 },
			(_, index) => `provider-schedule-failure-${index}`,
		),
	);
});

test("预约目录拒绝异常 Provider trace 并只记录固定原因", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "bad\n-request-id",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "unused",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listDepartments({
			traceId: "trace-invalid-provider-trace",
			idempotencyKey: "key-invalid-provider-trace",
		}),
	).rejects.toBeInstanceOf(ExternalTraceReadModelValidationError);

	const output = lines.join("");
	expect(output).toContain('"resultViolation":"request-id-invalid"');
	expect(output).not.toContain("bad\\n-request-id");
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

test("appointment department tree keeps hierarchy separate and resolves clinic departments by opaque parent ID", async () => {
	let clinicInput:
		| {
				startDate: string;
				endDate: string;
				parentDepartmentId: string;
		  }
		| undefined;
	let clinicCalls = 0;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "unused-flat-directory",
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "unused-schedules",
				},
			}),
		},
		departmentTree: {
			listDepartmentTree: async () => ({
				groups: [
					{
						groupId: "group-internal",
						displayName: "内科",
						departments: [
							{
								departmentId: "second-cardiology",
								displayName: "心血管内科",
								providerExtra: "provider-secret",
							},
						],
						providerExtra: "provider-secret",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-department-tree",
					requestId: "tree-request-001",
				},
			}),
			listClinicDepartments: async (input) => {
				clinicCalls += 1;
				clinicInput = input;
				return {
					departments: [
						{
							departmentId: "clinic-cardiology",
							displayName: "心内科门诊",
							providerExtra: "provider-secret",
						},
					],
					trace: {
						provider: "zhongyang",
						operation: "appointment-clinic-departments",
						requestId: "clinic-request-001",
					},
				};
			},
		},
		now: () => new Date("2026-08-15T00:00:00.000Z"),
	});
	const context = {
		traceId: "tree-trace-001",
		idempotencyKey: "tree-key-001",
	};

	await expect(service.listDepartmentTree(context)).resolves.toEqual({
		items: [
			{
				groupId: "group-internal",
				displayName: "内科",
				departments: [
					{
						departmentId: "second-cardiology",
						displayName: "心血管内科",
					},
				],
			},
		],
		total: 1,
	});
	await expect(
		service.listClinicDepartments("second-cardiology", context),
	).resolves.toEqual({
		items: [{ departmentId: "clinic-cardiology", displayName: "心内科门诊" }],
		total: 1,
	});
	expect(clinicInput).toEqual({
		startDate: "2026-08-15",
		endDate: "2026-08-22",
		parentDepartmentId: "second-cardiology",
	});
	await expect(
		service.listClinicDepartments("\ninvalid", context),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	expect(clinicCalls).toBe(1);
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

test("appointment records include registrations written by the payment flow", async () => {
	const localRegistration: AppointmentRegistration = {
		appointmentId: "appointment-local-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		holdId: "hold-local-001",
		idempotencyKey: "appointment-register-local-001",
		providerAppointmentId: "provider-appointment-local-001",
		providerPatientId: "provider-patient-001",
		departmentName: "风湿免疫门诊",
		doctorName: "温慧芬",
		workDate: "2026-09-07",
		shiftName: "上午",
		sourceSerialNumber: "1",
		totalFen: 1000,
		status: "booked",
		createdAt: "2026-09-04T12:23:00.000Z",
		updatedAt: "2026-09-04T12:23:00.000Z",
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
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "record-empty-local-fallback",
				},
			}),
		},
		appointmentWrites: {
			listRegistrationsByPatient: async () => [localRegistration],
		},
	});

	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{ startDate: "2026-09-01", endDate: "2026-09-30" },
			{ traceId: "trace-local-record", idempotencyKey: "key-local-record" },
		),
	).resolves.toEqual({
		items: [
			{
				departmentName: "风湿免疫门诊",
				doctorName: "温慧芬",
				workDate: "2026-09-07",
				serialNumber: "1",
				status: "scheduled",
			},
		],
		total: 1,
	});
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

test("预约记录 service 拒绝仓储返回的非法或越界患者引用", async () => {
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
				resolveProviderReference: async () => reference,
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
				level: "info",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		});

		await expect(
			service.listRecords(
				"user-001",
				"patient-001",
				{ startDate: "2026-08-01", endDate: "2026-08-31" },
				{
					traceId: `trace-reference-${expectedViolation}`,
					idempotencyKey: `key-reference-${expectedViolation}`,
				},
			),
		).rejects.toBeInstanceOf(AppointmentRecordPatientNotFoundError);
		expect(providerCalls).toBe(0);
		expect(lines.join("\n")).toContain(
			`"resultViolation":"${expectedViolation}"`,
		);
	}
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
			traceId: "trace-002",
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

test("预约服务拒绝绕过 HTTP schema 的畸形查询对象", async () => {
	const lines: string[] = [];
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
			listSchedules: async () => {
				providerCalls += 1;
				throw new Error("schedule provider must not be called");
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
				throw new Error("record provider must not be called");
			},
		},
		logger: createLogger({
			service: "appointment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});
	const context = {
		traceId: "trace-malformed-query",
		idempotencyKey: "key-malformed-query",
	};

	await expect(
		service.listSchedules(undefined as never, context),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	await expect(
		service.listRecords("user-001", "patient-001", null as never, context),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	expect(providerCalls).toBe(0);
	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.failed",
			traceId: "trace-malformed-query",
			errorType: "AppointmentScheduleQueryError",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.records.failed",
			traceId: "trace-malformed-query",
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

test("预约 service 拒绝未知字段而不是静默丢弃渠道意图", async () => {
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
			listSchedules: async () => {
				providerCalls += 1;
				throw new Error("schedule provider must not be called");
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
				throw new Error("record provider must not be called");
			},
		},
	});
	const context = {
		traceId: "trace-unknown-query-field",
		idempotencyKey: "key-unknown-query-field",
	};

	// `requestChannel=4` 目前不是公开查询字段；如果未来调用方把它带进
	// service，必须明确失败，不能静默使用已固定的微信渠道 3。
	await expect(
		service.listSchedules(
			{
				startDate: "2026-08-01",
				endDate: "2026-08-02",
				requestChannel: "4",
			} as never,
			context,
		),
	).rejects.toBeInstanceOf(AppointmentScheduleQueryError);
	await expect(
		service.listRecords(
			"user-001",
			"patient-001",
			{
				startDate: "2026-08-01",
				endDate: "2026-08-02",
				requestChannel: "4",
			} as never,
			context,
		),
	).rejects.toBeInstanceOf(AppointmentRecordQueryError);

	expect(providerCalls).toBe(0);
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

test("预约目录 service 二次校验并重新投影科室和排班", async () => {
	const department = {
		departmentId: "dept-001",
		departmentCode: "CARDIO",
		displayName: "心内科",
		location: "门诊楼二层",
		providerPatientName: "provider-secret",
	} as unknown as AppointmentDepartment;
	const schedule = {
		providerScheduleId: "provider-schedule-projection",
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
		timeGroup: "range" as const,
		providerFee: 12.5,
	} as unknown as AppointmentProviderSchedule;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [department],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "directory-projection",
				},
			}),
			listSchedules: async () => ({
				schedules: [schedule],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "schedule-projection",
				},
			}),
		},
		createScheduleId: () => "platform-schedule-projection",
	});

	const departments = await service.listDepartments({
		traceId: "trace-department-projection",
		idempotencyKey: "key-department-projection",
	});
	const schedules = await service.listSchedules(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		{
			traceId: "trace-schedule-projection",
			idempotencyKey: "key-schedule-projection",
		},
	);

	expect(departments).toEqual({
		items: [
			{
				departmentId: "dept-001",
				departmentCode: "CARDIO",
				displayName: "心内科",
				location: "门诊楼二层",
			},
		],
		total: 1,
	});
	expect(schedules).toEqual({
		items: [
			{
				scheduleId: "platform-schedule-projection",
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
	});
	const output = JSON.stringify({ departments, schedules });
	expect(output).not.toContain("provider-secret");
	expect(output).not.toContain("providerFee");
	expect(output).not.toContain("provider-schedule-projection");
});

test("预约目录 service 拒绝非法科室和排班并记录有限原因", async () => {
	const lines: string[] = [];
	const invalidDepartment = {
		departmentId: "dept-invalid",
		displayName: "",
	} as unknown as AppointmentDepartment;
	const invalidSchedule = {
		providerScheduleId: "schedule-invalid",
		departmentId: "dept-invalid",
		departmentName: "心内科",
		doctorId: "doctor-invalid",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 1,
		availableSlots: 2,
		timeGroup: "range" as const,
	} as unknown as AppointmentProviderSchedule;
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [invalidDepartment],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "invalid-department-result",
				},
			}),
			listSchedules: async () => ({
				schedules: [invalidSchedule],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "invalid-schedule-result",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-directory-validation-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listDepartments({
			traceId: "trace-invalid-department-result",
			idempotencyKey: "key-invalid-department-result",
		}),
	).rejects.toMatchObject({
		name: "AppointmentDirectoryResultValidationError",
		violation: "department-field-invalid",
	});
	await expect(
		service.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{
				traceId: "trace-invalid-schedule-result",
				idempotencyKey: "key-invalid-schedule-result",
			},
		),
	).rejects.toMatchObject({
		name: "AppointmentDirectoryResultValidationError",
		violation: "slot-count-invalid",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.departments.failed",
			traceId: "trace-invalid-department-result",
			resultViolation: "department-field-invalid",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.failed",
			traceId: "trace-invalid-schedule-result",
			resultViolation: "slot-count-invalid",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.departments.synced",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.synced",
		}),
	);
});

test("预约排班 service 超过资源上限时不生成引用或写入快照", async () => {
	const schedules = Array.from(
		{ length: MAX_APPOINTMENT_SCHEDULE_ITEMS + 1 },
		(_, index) => ({
			providerScheduleId: `provider-schedule-too-many-${index}`,
			departmentId: "department-001",
			departmentName: "心内科",
			doctorId: "doctor-001",
			doctorName: "李医生",
			workDate: "2026-08-20",
			shiftName: "上午",
			totalSlots: 30,
			availableSlots: 12,
			timeGroup: "range" as const,
		}),
	);
	const snapshotStore = createInMemoryAppointmentScheduleSnapshotRepository();
	let snapshotWrites = 0;
	const snapshots: AppointmentScheduleSnapshotRepository = {
		upsert: async (input) => {
			snapshotWrites += 1;
			return snapshotStore.upsert(input);
		},
		findActive: snapshotStore.findActive,
	};
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules,
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "schedule-too-many-service",
				},
			}),
		},
		snapshots,
	});

	await expect(
		service.listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{
				traceId: "trace-schedule-too-many",
				idempotencyKey: "key-schedule-too-many",
			},
		),
	).rejects.toMatchObject({
		name: "AppointmentDirectoryResultValidationError",
		violation: "schedules-too-many",
	});
	expect(snapshotWrites).toBe(0);
});

test("预约目录 service 拒绝异常或重复的平台 scheduleId", async () => {
	const lines: string[] = [];
	const baseSchedule = {
		providerScheduleId: "provider-schedule-platform-id",
		departmentId: "dept-platform-id",
		departmentName: "心内科",
		doctorId: "doctor-platform-id",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 10,
		availableSlots: 5,
		timeGroup: "range" as const,
	} as unknown as AppointmentProviderSchedule;
	const makeService = (
		schedules: readonly AppointmentProviderSchedule[],
		createScheduleId: () => string,
	) =>
		new AppointmentService({
			directory: {
				listDepartments: async () => ({
					departments: [],
					trace: {
						provider: "zhongyang",
						operation: "appointment-departments",
						requestId: "platform-id-departments",
					},
				}),
				listSchedules: async () => ({
					schedules,
					trace: {
						provider: "zhongyang",
						operation: "appointment-schedules",
						requestId: "platform-id-schedules",
					},
				}),
			},
			createScheduleId,
			logger: createLogger({
				service: "appointment-platform-id-test",
				environment: "test",
				destination: { write: (chunk: string) => lines.push(chunk) },
			}),
		});

	await expect(
		makeService([baseSchedule], () => " ").listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{
				traceId: "trace-platform-id-invalid",
				idempotencyKey: "key-platform-id-invalid",
			},
		),
	).rejects.toMatchObject({
		name: "AppointmentDirectoryResultValidationError",
		violation: "schedule-id-invalid",
	});

	await expect(
		makeService(
			[
				baseSchedule,
				{
					...baseSchedule,
					providerScheduleId: "provider-schedule-platform-id-2",
				},
			],
			() => "platform-schedule-duplicate",
		).listSchedules(
			{ startDate: "2026-08-20", endDate: "2026-08-21" },
			{
				traceId: "trace-platform-id-duplicate",
				idempotencyKey: "key-platform-id-duplicate",
			},
		),
	).rejects.toMatchObject({
		name: "AppointmentDirectoryResultValidationError",
		violation: "schedule-id-duplicate",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.failed",
			traceId: "trace-platform-id-invalid",
			resultViolation: "schedule-id-invalid",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.failed",
			traceId: "trace-platform-id-duplicate",
			resultViolation: "schedule-id-duplicate",
		}),
	);
});

test("预约排班 service 绑定日期窗口和科室医生筛选", async () => {
	const lines: string[] = [];
	let currentSchedule: AppointmentProviderSchedule = {
		providerScheduleId: "provider-schedule-filter-binding",
		departmentId: "dept-expected",
		departmentName: "心内科",
		doctorId: "doctor-expected",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 10,
		availableSlots: 5,
		timeGroup: "range",
	};
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				departments: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "unused",
				},
			}),
			listSchedules: async () => ({
				schedules: [currentSchedule],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "schedule-filter-binding",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-filter-binding-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
		createScheduleId: () => "platform-filter-binding",
	});

	const expectViolation = async (
		query: AppointmentScheduleQuery,
		traceId: string,
		violation: string,
	) => {
		await expect(
			service.listSchedules(query, {
				traceId,
				idempotencyKey: `key-${traceId}`,
			}),
		).rejects.toMatchObject({
			name: "AppointmentDirectoryResultValidationError",
			violation,
		});
	};

	currentSchedule = { ...currentSchedule, workDate: "2026-08-22" };
	await expectViolation(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		"trace-schedule-window-mismatch",
		"schedule-work-date-outside-query",
	);

	currentSchedule = { ...currentSchedule, workDate: "2026-08-20" };
	await expectViolation(
		{
			startDate: "2026-08-20",
			endDate: "2026-08-21",
			departmentId: "dept-requested",
		},
		"trace-schedule-department-mismatch",
		"schedule-department-mismatch",
	);

	currentSchedule = { ...currentSchedule, departmentId: "dept-expected" };
	await expectViolation(
		{
			startDate: "2026-08-20",
			endDate: "2026-08-21",
			doctorId: "doctor-requested",
		},
		"trace-schedule-doctor-mismatch",
		"schedule-doctor-mismatch",
	);

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	for (const [traceId, violation] of [
		["trace-schedule-window-mismatch", "schedule-work-date-outside-query"],
		["trace-schedule-department-mismatch", "schedule-department-mismatch"],
		["trace-schedule-doctor-mismatch", "schedule-doctor-mismatch"],
	] as const) {
		expect(events).toContainEqual(
			expect.objectContaining({
				event: "appointment.directory.schedules.failed",
				traceId,
				resultViolation: violation,
			}),
		);
	}
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.schedules.synced",
		}),
	);
});

test("预约目录失败日志保留经过校验的多请求 provider trace", async () => {
	const lines: string[] = [];
	const service = new AppointmentService({
		directory: {
			listDepartments: async () => ({
				// 重复 ID 触发 service 二次校验；trace 已先通过 domain 校验，
				// 因此失败日志仍必须保留完整的外部请求关联链。
				departments: [
					{ departmentId: "duplicate-department", displayName: "心内科" },
					{ departmentId: "duplicate-department", displayName: "消化科" },
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-departments",
					requestId: "appointment-trace-primary",
					requestIds: [
						"appointment-trace-primary",
						"appointment-trace-secondary",
					],
				},
			}),
			listSchedules: async () => ({
				schedules: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedules",
					requestId: "unused-schedule-trace",
				},
			}),
		},
		logger: createLogger({
			service: "appointment-trace-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.listDepartments({
			traceId: "trace-appointment-multiple-provider-requests",
			idempotencyKey: "key-appointment-multiple-provider-requests",
		}),
	).rejects.toThrow("Appointment directory provider result is invalid");

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "appointment.directory.departments.failed",
			providerRequestId: "appointment-trace-primary",
			providerRequestIds: [
				"appointment-trace-primary",
				"appointment-trace-secondary",
			],
		}),
	);
});

test("appointment schedule sources resolve an active snapshot and whitelist slots", async () => {
	const seenProviderScheduleIds: string[] = [];
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
					providerScheduleId: "provider-schedule-77",
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
				requestId: "provider-request-001",
			},
		}),
		listSources: async (input) => {
			seenProviderScheduleIds.push(input.providerScheduleId);
			return {
				sources: [
					{
						serialNumber: "3",
						timeLabel: "08:00-09:00",
						timeGroup: "range",
					},
					{ serialNumber: "4", timeLabel: "09:30", timeGroup: "point" },
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-schedule-sources",
					requestId: "provider-request-sources-001",
				},
			};
		},
	};
	const snapshots = createInMemoryAppointmentScheduleSnapshotRepository();
	const service = new AppointmentService({
		directory,
		snapshots,
		logger: createNoopLogger(),
		now: () => new Date("2026-08-15T00:00:00.000Z"),
		createScheduleId: () => "platform-schedule-001",
	});

	// 先读取排班目录生成 opaque scheduleId 与服务端快照。
	await service.listSchedules(
		{ startDate: "2026-08-20", endDate: "2026-08-21" },
		{ traceId: "trace-001", idempotencyKey: "key-001" },
	);

	const payload = await service.listScheduleSources("platform-schedule-001", {
		traceId: "trace-002",
		idempotencyKey: "key-002",
	});

	expect(seenProviderScheduleIds).toEqual(["provider-schedule-77"]);
	expect(payload.schedule).toMatchObject({
		scheduleId: "platform-schedule-001",
		doctorName: "李医生",
	});
	expect(payload.items).toEqual([
		{ serialNumber: "3", timeLabel: "08:00-09:00", timeGroup: "range" },
		{ serialNumber: "4", timeLabel: "09:30", timeGroup: "point" },
	]);
	expect(payload.total).toBe(2);
});

test("appointment schedule sources reject expired or unknown schedule references", async () => {
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
			schedules: [],
			trace: {
				provider: "zhongyang",
				operation: "appointment-schedules",
				requestId: "unused",
			},
		}),
		listSources: async () => {
			throw new Error("listSources must not be called");
		},
	};
	const service = new AppointmentService({
		directory,
		snapshots: createInMemoryAppointmentScheduleSnapshotRepository(),
		logger: createNoopLogger(),
		now: () => new Date("2026-08-15T00:00:00.000Z"),
		createScheduleId: () => "platform-schedule-001",
	});

	await expect(
		service.listScheduleSources("platform-schedule-404", {
			traceId: "trace-003",
			idempotencyKey: "key-003",
		}),
	).rejects.toMatchObject({
		name: "AppointmentScheduleReferenceExpiredError",
	});
});
