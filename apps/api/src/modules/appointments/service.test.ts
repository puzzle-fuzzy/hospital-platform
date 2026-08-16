import { expect, test } from "bun:test";
import type {
	AppointmentDirectoryGateway,
	PatientRepository,
} from "@hospital/domain";
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

test("snapshot persistence failure does not turn a read directory into fake success", async () => {
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
});

test("appointment queries reject impossible calendar dates before provider access", async () => {
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
});
