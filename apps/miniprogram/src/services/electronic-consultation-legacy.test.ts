import { expect, test } from "bun:test";
import {
	filterLegacyElectronicConsultationRecords,
	toLegacyElectronicConsultationRecordView,
} from "./electronic-consultation-legacy";

const now = new Date("2026-09-16T12:00:00+08:00");

test("旧端电子导诊兼容层只保留近 30 天预约摘要", () => {
	const records = filterLegacyElectronicConsultationRecords(
		[
			{ workDate: "2026-08-17", workTime: "08:00", status: "completed" },
			{ workDate: "2026-08-16", workTime: "08:00", status: "completed" },
			{ workDate: "2026-09-16", workTime: "08:00", status: "scheduled" },
			{ workDate: "2026-09-17", workTime: "08:00", status: "scheduled" },
		],
		now,
	);

	expect(records.map((record) => record.workDate)).toEqual([
		"2026-08-17",
		"2026-09-16",
	]);
});

test("兼容卡片保留安全预约摘要并使用受控预约类型兜底", () => {
	const view = toLegacyElectronicConsultationRecordView(
		{
			departmentName: "心内科",
			doctorName: "李医生",
			workDate: "2026-09-16",
			workTime: "08:00-12:00",
			location: "门诊二楼",
			serialNumber: "A-01",
			status: "scheduled",
		},
		0,
		1,
	);

	expect(view).toMatchObject({
		departmentName: "心内科",
		doctorName: "李医生",
		workDate: "2026-09-16",
		workTime: "08:00-12:00",
		location: "门诊二楼",
		serialNumber: "A-01",
		statusLabel: "已预约",
		sourceTypeLabel: "预约",
	});
	expect(Object.keys(view)).not.toContain("appointmentInfoId");
});
