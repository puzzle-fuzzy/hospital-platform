import { describe, expect, test } from "bun:test";
import type { AppointmentRecord } from "../types";
import {
	filterConsultRecords,
	getConsultRecordWindow,
} from "./consult-record-view";

function record(
	workDate: string,
	status: AppointmentRecord["status"] = "scheduled",
): AppointmentRecord {
	return { workDate, status };
}

describe("就诊页预约历史展示边界", () => {
	test("当天预约只作为摘要进入今日列表，不冒充实时就诊", () => {
		const records = [
			record("2026-08-25"),
			record("2026-08-26"),
			record("2026-08-24", "completed"),
		];

		expect(filterConsultRecords(records, "2026-08-25", "today")).toEqual([
			record("2026-08-25"),
		]);
		expect(filterConsultRecords(records, "2026-08-25", "upcoming")).toEqual([
			record("2026-08-26"),
		]);
		expect(filterConsultRecords(records, "2026-08-25", "history")).toEqual([
			record("2026-08-24", "completed"),
		]);
	});

	test("今日窗口沿用固定业务日快照并支持分批展开", () => {
		const records = [
			record("2026-08-25"),
			record("2026-08-25", "cancelled"),
			record("2026-08-26"),
		];

		const window = getConsultRecordWindow(records, "today", "2026-08-25", 1);

		expect(window.totalRecords).toBe(2);
		expect(window.visibleRecords).toEqual([record("2026-08-25")]);
		expect(window.hasMoreRecords).toBe(true);
	});

	test("取消和爽约仍保留为预约事实，不由客户端改变状态", () => {
		const records = [
			record("2026-08-26", "cancelled"),
			record("2026-08-24", "missed"),
		];

		expect(filterConsultRecords(records, "2026-08-25", "upcoming")).toEqual([
			record("2026-08-26", "cancelled"),
		]);
		expect(filterConsultRecords(records, "2026-08-25", "history")).toEqual([
			record("2026-08-24", "missed"),
		]);
	});

	test("标签切换和加载更多使用同一业务日快照", () => {
		const records = [
			record("2026-08-27"),
			record("2026-08-26"),
			record("2026-08-24", "completed"),
		];

		const upcoming = getConsultRecordWindow(
			records,
			"upcoming",
			"2026-08-25",
			1,
		);
		const upcomingAfterLoadMore = getConsultRecordWindow(
			records,
			"upcoming",
			"2026-08-25",
			2,
		);

		expect(upcoming.totalRecords).toBe(2);
		expect(upcoming.visibleRecords).toEqual([record("2026-08-27")]);
		expect(upcoming.hasMoreRecords).toBe(true);
		expect(upcomingAfterLoadMore.visibleRecords).toEqual([
			record("2026-08-27"),
			record("2026-08-26"),
		]);
		expect(upcomingAfterLoadMore.hasMoreRecords).toBe(false);

		// 如果页面重新建立了 8 月 26 日快照，8 月 26 日记录才会变成当天，
		// 这必须由刷新触发，而不能由标签点击隐式触发。
		expect(
			getConsultRecordWindow(records, "upcoming", "2026-08-26", 8)
				.visibleRecords,
		).toEqual([record("2026-08-27")]);
		expect(
			getConsultRecordWindow(records, "history", "2026-08-26", 8)
				.visibleRecords,
		).toEqual([record("2026-08-24", "completed")]);
	});

	test("没有业务日快照时不渲染记录，避免空快照把全部日期判成未来", () => {
		const result = getConsultRecordWindow(
			[record("2026-08-26")],
			"upcoming",
			"",
			8,
		);

		expect(result).toEqual({
			visibleRecords: [],
			totalRecords: 0,
			hasMoreRecords: false,
		});
	});
});
