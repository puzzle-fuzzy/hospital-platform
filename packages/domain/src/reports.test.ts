import { expect, test } from "bun:test";
import {
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	normalizeLaboratoryReportDetail,
	normalizeReportDirectoryResults,
	ReportResultValidationError,
} from "./reports";

test("报告目录读模型超过资源上限时整批拒绝", () => {
	const reports = Array.from(
		{ length: MAX_REPORT_DIRECTORY_ITEMS + 1 },
		(_, index) => ({
			summary: {
				kind: "laboratory" as const,
				title: "血常规",
				reportedAt: "2026-08-15 10:00:00",
				status: "available" as const,
				hasAttachment: false,
			},
			providerReportId: `provider-report-${index}`,
		}),
	);

	expect(() => normalizeReportDirectoryResults(reports)).toThrow(
		new ReportResultValidationError("reports-too-many"),
	);
});

test("LIS 明细读模型超过资源上限时整批拒绝", () => {
	const detail = {
		kind: "laboratory" as const,
		title: "血常规",
		reportedAt: "2026-08-15 10:00:00",
		items: Array.from({ length: MAX_REPORT_DETAIL_ITEMS + 1 }, () => ({
			name: "白细胞",
			result: "10.2",
			flag: "normal" as const,
		})),
		hasAttachment: false,
	};

	expect(() => normalizeLaboratoryReportDetail(detail)).toThrow(
		new ReportResultValidationError("detail-items-too-many"),
	);
});
