import { expect, test } from "bun:test";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	AppointmentScheduleSnapshotValidationError,
	MAX_APPOINTMENT_RECORD_ITEMS,
	MAX_APPOINTMENT_SCHEDULE_ITEMS,
	MAX_APPOINTMENT_SNAPSHOT_TTL_MS,
	normalizeAppointmentRecordResults,
	normalizeAppointmentScheduleResults,
	validateAppointmentScheduleSnapshot,
} from "./appointments";

function providerSchedule(index: number) {
	return {
		providerScheduleId: `provider-schedule-${index}`,
		departmentId: "department-001",
		departmentName: "心内科",
		doctorId: "doctor-001",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 30,
		availableSlots: 12,
		timeGroup: "range" as const,
	};
}

test("预约排班读模型超过资源上限时整批拒绝", () => {
	const schedules = Array.from(
		{ length: MAX_APPOINTMENT_SCHEDULE_ITEMS + 1 },
		(_, index) => providerSchedule(index),
	);

	expect(() => normalizeAppointmentScheduleResults(schedules)).toThrow(
		new AppointmentDirectoryResultValidationError("schedules-too-many"),
	);
});

test("预约历史读模型超过资源上限时整批拒绝", () => {
	const records = Array.from(
		{ length: MAX_APPOINTMENT_RECORD_ITEMS + 1 },
		(_, index) => ({
			workDate: "2026-08-20",
			status: "scheduled" as const,
			appointmentId: `appointment-${index}`,
		}),
	);

	expect(() => normalizeAppointmentRecordResults(records)).toThrow(
		new AppointmentRecordResultValidationError("records-too-many"),
	);
});

test("预约历史只接受合法时间点或不倒序的时间段", () => {
	const base = { workDate: "2026-08-20", status: "scheduled" as const };
	expect(
		normalizeAppointmentRecordResults([
			{ ...base, workTime: "08:00" },
			{ ...base, workTime: "08:00-12:00" },
		]),
	).toHaveLength(2);

	for (const workTime of [
		"上午",
		"08:60",
		"12:00-08:00",
		"2026-08-20 08:00:00",
	]) {
		expect(() =>
			normalizeAppointmentRecordResults([{ ...base, workTime }]),
		).toThrow(new AppointmentRecordResultValidationError("work-time-invalid"));
	}
});

function appointmentSnapshotInput() {
	return {
		schedule: {
			scheduleId: "schedule-001",
			departmentId: "department-001",
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
		},
		provider: "zhongyang" as const,
		providerScheduleId: "provider-schedule-001",
		providerRequestId: "provider-request-001",
		observedAt: "2026-08-15T00:00:00.000Z",
		expiresAt: "2026-08-15T00:01:00.000Z",
	};
}

test("排班快照 persistence 边界拒绝未知来源、坏排班和过长 TTL", () => {
	const input = appointmentSnapshotInput();

	expect(() =>
		validateAppointmentScheduleSnapshot({
			...input,
			provider: "other" as never,
		}),
	).toThrow(new AppointmentScheduleSnapshotValidationError("invalid_provider"));

	expect(() =>
		validateAppointmentScheduleSnapshot({
			...input,
			schedule: { ...input.schedule, departmentName: "\n心内科" },
		}),
	).toThrow(new AppointmentScheduleSnapshotValidationError("invalid_schedule"));

	const longExpiry = new Date(
		Date.parse(input.observedAt) + MAX_APPOINTMENT_SNAPSHOT_TTL_MS + 1,
	).toISOString();
	expect(() =>
		validateAppointmentScheduleSnapshot({
			...input,
			expiresAt: longExpiry,
		}),
	).toThrow(
		new AppointmentScheduleSnapshotValidationError(
			"invalid_observation_window",
		),
	);
});
