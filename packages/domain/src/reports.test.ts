import { expect, test } from "bun:test";
import {
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	normalizeLaboratoryReportDetail,
	normalizeReportDirectoryResults,
	parseReportTimestamp,
	ReportResultValidationError,
	validateReportDirectoryResultWindow,
} from "./reports";

test("报告时间只接受可审计格式并正确处理无效日期", () => {
	expect(parseReportTimestamp("2026-08-15")).toBe(
		Date.parse("2026-08-15T00:00:00.000Z"),
	);
	expect(parseReportTimestamp("2026/08/15 23:59:59")).toBe(
		Date.parse("2026-08-15T23:59:59.000Z"),
	);
	expect(parseReportTimestamp("2026-08-15T16:00:00+08:00")).toBe(
		Date.parse("2026-08-15T16:00:00+08:00"),
	);
	expect(parseReportTimestamp("2026-02-30 10:00:00")).toBeUndefined();
	expect(parseReportTimestamp("未知时间")).toBeUndefined();
});

test("报告目录结果必须落在请求自然日窗口内", () => {
	const report = (reportedAt: string) => [
		{
			summary: {
				kind: "laboratory" as const,
				title: "血常规",
				reportedAt,
				status: "available" as const,
				hasAttachment: false,
			},
		},
	];
	const query = { startDate: "2026-08-01", endDate: "2026-08-15" };

	expect(() =>
		validateReportDirectoryResultWindow(report("2026-08-15 23:59:59"), query),
	).not.toThrow();
	expect(() =>
		validateReportDirectoryResultWindow(report("2026-07-31 23:59:59"), query),
	).toThrow(new ReportResultValidationError("reported-at-outside-query"));
	expect(() =>
		validateReportDirectoryResultWindow(report("未知时间"), query),
	).toThrow(new ReportResultValidationError("reported-at-invalid"));
});

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

test("LIS 详情时间必须使用与目录一致的可审计格式", () => {
	const detail = {
		kind: "laboratory" as const,
		title: "血常规",
		reportedAt: "未知时间",
		items: [{ name: "白细胞", result: "10.2", flag: "normal" as const }],
		hasAttachment: false,
	};

	expect(() => normalizeLaboratoryReportDetail(detail)).toThrow(
		new ReportResultValidationError("detail-reported-at-invalid"),
	);
});
