import type { AppointmentRecord, AppointmentRecordView } from "../types";
import {
	createPastDateRange,
	loadAppointmentRecords,
} from "./dashboard-service";
import { toAppointmentRecordView } from "./appointment-record-view";

/** 复刻旧端电子导诊单页面的近 30 天展示窗口。 */
export const LEGACY_ELECTRONIC_CONSULTATION_DAYS = 30;

/**
 * 旧端页面把预约历史当作电子导诊单来源；这里明确保留为兼容适配层。
 * `sourceType` 不在新端预约公共模型中，因此只能显示受控兜底文案，不能
 * 从科室名、地点或状态猜测 PACS/LIS/心电等号源类型。
 */
export type LegacyElectronicConsultationRecordView = AppointmentRecordView & {
	sourceTypeLabel: "预约";
};

/** 按旧端近 30 天自然日筛选已读取的预约摘要。 */
export function filterLegacyElectronicConsultationRecords(
	records: readonly AppointmentRecord[],
	now = new Date(),
): AppointmentRecord[] {
	const range = createPastDateRange(LEGACY_ELECTRONIC_CONSULTATION_DAYS, now);
	return records.filter(
		(record) =>
			record.workDate >= range.startDate && record.workDate <= range.endDate,
	);
}

/** 将预约摘要投影为旧电子导诊单卡片，不增加 Provider 原始字段。 */
export function toLegacyElectronicConsultationRecordView(
	record: AppointmentRecord,
	index: number,
	renderGeneration: number,
): LegacyElectronicConsultationRecordView {
	return {
		...toAppointmentRecordView(
			record,
			index,
			"consult-record",
			renderGeneration,
		),
		sourceTypeLabel: "预约",
	};
}

/**
 * 旧端兼容读取：沿用平台已存在的预约历史 owner/patient 保护，再在页面
 * 边界截取近 30 天。该函数不是电子导诊单正式 Provider adapter。
 */
export function loadLegacyElectronicConsultationRecords(
	patientId: string,
	now: Date,
	expectedSessionGeneration: number,
): Promise<AppointmentRecord[]> {
	return loadAppointmentRecords(
		patientId,
		now,
		"history",
		expectedSessionGeneration,
		"all",
	).then((records) => filterLegacyElectronicConsultationRecords(records, now));
}
