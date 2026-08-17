import { expect, test } from "bun:test";
import type { AppointmentRecord } from "../types";
import {
	APPOINTMENT_RECORD_STATUS_LABELS,
	isMissedAppointment,
	toAppointmentRecordView,
} from "./appointment-record-view";

function record(status: AppointmentRecord["status"]): AppointmentRecord {
	return {
		workDate: "2026-08-17",
		status,
	};
}

test("预约状态文案在所有页面保持同一套中文解释", () => {
	expect(APPOINTMENT_RECORD_STATUS_LABELS).toEqual({
		scheduled: "已预约",
		cancelled: "已取消",
		completed: "已完成",
		missed: "已爽约",
		stopped: "停诊",
		substituted: "替诊",
		registered: "已登记",
		unknown: "状态未知",
	});
});

test("爽约筛选只接受服务端明确的 missed 枚举", () => {
	expect(isMissedAppointment(record("missed"))).toBe(true);
	expect(isMissedAppointment(record("unknown"))).toBe(false);
	expect(isMissedAppointment(record("scheduled"))).toBe(false);
});

test("预约摘要视图 key 只用于渲染且不改变业务状态", () => {
	const view = toAppointmentRecordView(
		record("unknown"),
		2,
		"appointment-record",
	);

	expect(view).toMatchObject({
		viewKey: "appointment-record-2",
		status: "unknown",
		statusLabel: "状态未知",
		statusClass: "record-status-unknown",
	});
});
