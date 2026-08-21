import { expect, test } from "bun:test";
import type { AppointmentSchedule } from "../types";
import {
	formatAppointmentDateLabel,
	groupAppointmentSchedules,
	visibleAppointmentSchedules,
} from "./appointment-directory-view";

test("预约目录日期标签按医院业务日历显示星期且不受设备时区影响", () => {
	expect(formatAppointmentDateLabel("2026-08-21")).toBe("8月21日 周五");
	// 纯日期不是真实瞬时点；非法日期不能被 Date 自动滚动成另一天。
	expect(formatAppointmentDateLabel("2026-02-30")).toBe("2026-02-30");
	expect(formatAppointmentDateLabel("not-a-date")).toBe("not-a-date");
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
