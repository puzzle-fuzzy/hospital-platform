import { describe, expect, test } from "bun:test";
import type { AppointmentRecord } from "../types";
import { filterConsultRecords } from "./consult-record-view";

function record(
	workDate: string,
	status: AppointmentRecord["status"] = "scheduled",
): AppointmentRecord {
	return { workDate, status };
}

describe("就诊页预约历史展示边界", () => {
	test("当天预约不冒充实时就诊，也不进入未来或历史列表", () => {
		const records = [
			record("2026-08-25"),
			record("2026-08-26"),
			record("2026-08-24", "completed"),
		];

		expect(filterConsultRecords(records, "2026-08-25", "upcoming")).toEqual([
			record("2026-08-26"),
		]);
		expect(filterConsultRecords(records, "2026-08-25", "history")).toEqual([
			record("2026-08-24", "completed"),
		]);
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
});
