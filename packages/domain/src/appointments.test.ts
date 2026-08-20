import { expect, test } from "bun:test";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	MAX_APPOINTMENT_RECORD_ITEMS,
	MAX_APPOINTMENT_SCHEDULE_ITEMS,
	normalizeAppointmentRecordResults,
	normalizeAppointmentScheduleResults,
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
