import { expect, test } from "bun:test";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	AppointmentScheduleSnapshotValidationError,
	MAX_APPOINTMENT_RECORD_ITEMS,
	MAX_APPOINTMENT_SCHEDULE_ITEMS,
	MAX_APPOINTMENT_SNAPSHOT_TTL_MS,
	normalizeAppointmentDepartmentGroupResults,
	normalizeAppointmentRecordResults,
	normalizeAppointmentScheduleResults,
	validateAppointmentScheduleSnapshot,
} from "./appointments";

test("预约目录树只投影一级、二级白名单字段并拒绝跨分组重复二级 ID", () => {
	const groups = normalizeAppointmentDepartmentGroupResults([
		{
			groupId: "group-internal",
			displayName: "内科",
			providerOrgId: "provider-secret",
			departments: [
				{
					departmentId: "second-cardiology",
					displayName: "心血管内科",
					providerIntroduction: "provider-secret-description",
				},
			],
		},
	]);

	expect(groups).toEqual([
		{
			groupId: "group-internal",
			displayName: "内科",
			departments: [
				{ departmentId: "second-cardiology", displayName: "心血管内科" },
			],
		},
	]);
	expect(() =>
		normalizeAppointmentDepartmentGroupResults([
			{
				groupId: "group-internal",
				displayName: "内科",
				departments: [
					{ departmentId: "second-cardiology", displayName: "心血管内科" },
				],
			},
			{
				groupId: "group-surgery",
				displayName: "外科",
				departments: [
					{ departmentId: "second-cardiology", displayName: "重复科室" },
				],
			},
		]),
	).toThrow(
		new AppointmentDirectoryResultValidationError("department-id-duplicate"),
	);
});

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

	expect(() =>
		validateAppointmentScheduleSnapshot({
			...input,
			observedAt: "2026-02-30T00:00:00.000Z",
		}),
	).toThrow(
		new AppointmentScheduleSnapshotValidationError(
			"invalid_observation_window",
		),
	);
});

test("预约排班医生照片只接受完整 http(s) URL", () => {
	expect(
		normalizeAppointmentScheduleResults([
			{
				...providerSchedule(1),
				doctorPhotoUrl: "https://oss.example.test/doctors/001.jpg",
			},
		]),
	).toMatchObject([
		{ doctorPhotoUrl: "https://oss.example.test/doctors/001.jpg" },
	]);
	// 空值合法：无图医生由页面占位展示。
	expect(normalizeAppointmentScheduleResults([providerSchedule(2)])).toEqual([
		expect.not.objectContaining({ doctorPhotoUrl: expect.anything() }),
	]);

	for (const invalid of [
		"/doctors/001.jpg",
		"ftp://oss.example.test/001.jpg",
		"https://oss.example.test/ 001.jpg",
		`https://oss.example.test/${"a".repeat(512)}`,
	]) {
		expect(() =>
			normalizeAppointmentScheduleResults([
				{ ...providerSchedule(3), doctorPhotoUrl: invalid },
			]),
		).toThrow(
			new AppointmentDirectoryResultValidationError("schedule-field-invalid"),
		);
	}
});
