import { expect, test } from "bun:test";
import type { AppointmentSchedule } from "../types";
import {
	buildAppointmentDateStrip,
	filterAppointmentSchedulesByDoctor,
	formatAppointmentDateLabel,
	groupAppointmentDoctorCards,
	groupAppointmentSchedules,
	visibleAppointmentSchedules,
} from "./appointment-directory-view";

test("预约目录日期标签按医院业务日历显示星期且不受设备时区影响", () => {
	expect(formatAppointmentDateLabel("2026-08-21")).toBe("8月21日 周五");
	// 纯日期不是真实瞬时点；非法日期不能被 Date 自动滚动成另一天。
	expect(formatAppointmentDateLabel("2026-02-30")).toBe("2026-02-30");
	expect(formatAppointmentDateLabel("not-a-date")).toBe("not-a-date");
});

test("独立门诊页日期条固定按医院自然日递增，并尊重日历上限", () => {
	expect(buildAppointmentDateStrip("2026-08-30", 6, "2026-09-02")).toEqual([
		{
			workDate: "2026-08-30",
			dateLabel: "08-30",
			weekdayLabel: "周日",
		},
		{
			workDate: "2026-08-31",
			dateLabel: "08-31",
			weekdayLabel: "周一",
		},
		{
			workDate: "2026-09-01",
			dateLabel: "09-01",
			weekdayLabel: "周二",
		},
		{
			workDate: "2026-09-02",
			dateLabel: "09-02",
			weekdayLabel: "周三",
		},
	]);
	expect(buildAppointmentDateStrip("2026-02-30")).toEqual([]);
	expect(buildAppointmentDateStrip("2026-08-30", 0)).toEqual([]);
});

test("预约目录日期分组按日期排序并统计同日号源", () => {
	const groups = groupAppointmentSchedules([
		{ workDate: "2026-08-23" },
		{ workDate: "2026-08-21" },
		{ workDate: "2026-08-23" },
	]);

	expect(groups).toEqual([
		{ workDate: "2026-08-21", label: "8月21日 周五", count: 1 },
		{ workDate: "2026-08-23", label: "8月23日 周日", count: 2 },
	]);
});

test("预约目录本地窗口只展示当前日期并拒绝异常窗口值", () => {
	const schedules = [
		{ scheduleId: "schedule-1", workDate: "2026-08-21" },
		{ scheduleId: "schedule-2", workDate: "2026-08-22" },
		{ scheduleId: "schedule-3", workDate: "2026-08-21" },
	] as unknown as AppointmentSchedule[];

	expect(
		visibleAppointmentSchedules(schedules, "2026-08-21", 1).map(
			(schedule) => schedule.scheduleId,
		),
	).toEqual(["schedule-1"]);
	expect(visibleAppointmentSchedules(schedules, "2026-08-21", -1)).toEqual([]);
	expect(
		visibleAppointmentSchedules(schedules, "2026-08-21", Number.NaN),
	).toEqual([]);
});

test("预约目录按医生卡片只聚合已公开的排班、日期和余号", () => {
	const schedules = [
		{
			doctorId: "doctor-2",
			doctorName: "李医生",
			workDate: "2026-08-22",
			availableSlots: 2,
		},
		{
			doctorId: "doctor-1",
			doctorName: "王医生",
			workDate: "2026-08-21",
			availableSlots: 3,
		},
		{
			doctorId: "doctor-1",
			doctorName: "王医生",
			workDate: "2026-08-21",
			availableSlots: 1,
		},
		{
			doctorId: "doctor-1",
			doctorName: "王医生",
			workDate: "2026-08-23",
			availableSlots: 4,
		},
	] as unknown as AppointmentSchedule[];

	expect(groupAppointmentDoctorCards(schedules)).toEqual([
		{
			doctorId: "doctor-2",
			doctorName: "李医生",
			avatarLabel: "李",
			scheduleCount: 1,
			availableSlots: 2,
			dates: [
				{
					workDate: "2026-08-22",
					label: "8月22日 周六",
					availableSlots: 2,
				},
			],
		},
		{
			doctorId: "doctor-1",
			doctorName: "王医生",
			avatarLabel: "王",
			scheduleCount: 3,
			availableSlots: 8,
			dates: [
				{
					workDate: "2026-08-21",
					label: "8月21日 周五",
					availableSlots: 4,
				},
				{
					workDate: "2026-08-23",
					label: "8月23日 周日",
					availableSlots: 4,
				},
			],
		},
	]);
});

test("预约目录医生筛选只收窄本地已读取的排班窗口", () => {
	const schedules = [
		{ scheduleId: "schedule-1", doctorId: "doctor-1", workDate: "2026-08-21" },
		{ scheduleId: "schedule-2", doctorId: "doctor-2", workDate: "2026-08-21" },
		{ scheduleId: "schedule-3", doctorId: "doctor-1", workDate: "2026-08-22" },
	] as unknown as AppointmentSchedule[];

	expect(
		filterAppointmentSchedulesByDoctor(schedules, "doctor-1").map(
			(schedule) => schedule.scheduleId,
		),
	).toEqual(["schedule-1", "schedule-3"]);
	expect(groupAppointmentSchedules(schedules, "doctor-1")).toEqual([
		{ workDate: "2026-08-21", label: "8月21日 周五", count: 1 },
		{ workDate: "2026-08-22", label: "8月22日 周六", count: 1 },
	]);
	expect(
		visibleAppointmentSchedules(schedules, "2026-08-21", 12, "doctor-1").map(
			(schedule) => schedule.scheduleId,
		),
	).toEqual(["schedule-1"]);
});

test("按医生卡片取该医生排班中首个非空照片，无图时保留本地头像", () => {
	const schedules = [
		{
			scheduleId: "s-1",
			doctorId: "doctor-9",
			doctorName: "赵医生",
			workDate: "2026-08-21",
			availableSlots: 3,
		},
		{
			scheduleId: "s-2",
			doctorId: "doctor-9",
			doctorName: "赵医生",
			doctorPhotoUrl: "https://oss.example.test/doctors/zhao.jpg",
			workDate: "2026-08-22",
			availableSlots: 1,
		},
	] as unknown as AppointmentSchedule[];

	const [card] = groupAppointmentDoctorCards(schedules);
	expect(card).toMatchObject({
		doctorId: "doctor-9",
		avatarLabel: "赵",
		doctorPhotoUrl: "https://oss.example.test/doctors/zhao.jpg",
	});

	const [noPhotoCard] = groupAppointmentDoctorCards([
		{
			scheduleId: "s-3",
			doctorId: "doctor-10",
			doctorName: "钱医生",
			workDate: "2026-08-21",
			availableSlots: 2,
		},
	] as unknown as AppointmentSchedule[]);
	if (!noPhotoCard) throw new Error("no-photo card missing");
	expect(noPhotoCard.doctorPhotoUrl).toBeUndefined();
	expect(noPhotoCard.avatarLabel).toBe("钱");
});
