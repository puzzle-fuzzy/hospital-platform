import { expect, test } from "bun:test";
import type { AppointmentRecord } from "../types";
import {
	APPOINTMENT_RECORD_STATUS_LABELS,
	filterAppointmentRecords,
	isAppointmentRecordTabAvailable,
	isMissedAppointment,
	isOnlineAppointmentRecord,
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

test("我的挂号在线标签只排除服务端明确的已取消记录", () => {
	const scheduled = record("scheduled");
	const completed = record("completed");
	const cancelled = record("cancelled");
	const records = [scheduled, completed, cancelled];

	expect(isOnlineAppointmentRecord(scheduled)).toBe(true);
	expect(isOnlineAppointmentRecord(cancelled)).toBe(false);
	expect(filterAppointmentRecords(records, "online")).toHaveLength(2);
});

test("全部挂号在独立渠道 contract 到齐前不可用", () => {
	const records = [record("scheduled"), record("cancelled")];

	expect(isAppointmentRecordTabAvailable("online")).toBe(true);
	expect(isAppointmentRecordTabAvailable("all")).toBe(false);
	expect(filterAppointmentRecords(records, "all")).toEqual([]);
});

test("预约摘要视图 key 只用于渲染且不改变业务状态", () => {
	const view = toAppointmentRecordView(
		record("unknown"),
		2,
		"appointment-record",
	);

	expect(view).toMatchObject({
		viewKey: "appointment-record-0-2",
		status: "unknown",
		statusLabel: "状态未知",
		statusClass: "record-status-unknown",
	});
});

test("预约记录刷新后使用新的渲染批次 key，不能复用旧索引事件", () => {
	const firstBatch = toAppointmentRecordView(
		record("scheduled"),
		0,
		"appointment-record",
		1,
	);
	const secondBatch = toAppointmentRecordView(
		record("scheduled"),
		0,
		"appointment-record",
		2,
	);

	expect(firstBatch.viewKey).not.toBe(secondBatch.viewKey);
});

test("预约卡片按旧端层级展示就诊日期和时段", () => {
	const view = toAppointmentRecordView(
		{ ...record("scheduled"), workTime: "13:30-14:00" },
		0,
		"appointment-record",
	);

	expect(view.periodLabel).toBe("下午");
	expect(view.workTime).toBe("13:30-14:00");
});
