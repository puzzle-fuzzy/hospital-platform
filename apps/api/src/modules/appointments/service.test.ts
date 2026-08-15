import { expect, test } from "bun:test";
import type { AppointmentDirectoryGateway } from "@hospital/domain";
import { createInMemoryAppointmentScheduleSnapshotRepository } from "@hospital/persistence";
import { AppointmentService } from "./service";

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
