import { expect, test } from "bun:test";
import {
	MAX_REPORT_ATTACHMENTS,
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	MAX_REPORT_TITLE_LENGTH,
	normalizeLaboratoryReportDetail,
	normalizeReportDirectoryResults,
	parseReportTimestamp,
	ReportReferenceValidationError,
	ReportResultValidationError,
	validateReportDirectoryResultWindow,
	validateReportReference,
} from "./reports";

test("报告目录与各类详情标题共享1024上限且保留274字符完整标题", () => {
	for (const title of [
		"检".repeat(274),
		"检".repeat(MAX_REPORT_TITLE_LENGTH),
	]) {
		const imaging = syntheticImagingResult("合成临床正文");
		const report = imaging[0];
		if (!report) throw new Error("Missing synthetic imaging report");
		report.summary.title = title;
		report.detail.title = title;
		const result = normalizeReportDirectoryResults(imaging);
		expect(result[0]?.summary.title).toBe(title);
		const normalized = result[0];
		if (!normalized || !("detail" in normalized))
			throw new Error("Missing normalized detail");
		expect(normalized.detail.title).toBe(title);
		expect(
			normalizeLaboratoryReportDetail({
				kind: "laboratory",
				title,
				reportedAt: "2026-08-15 10:00:00",
				items: [],
				hasAttachment: false,
			}).title,
		).toBe(title);
	}
});

test("报告标题超限、C0/DEL或首尾空白仍拒绝，其他字段长度不随标题放宽", () => {
	for (const title of [
		"检".repeat(MAX_REPORT_TITLE_LENGTH + 1),
		"标题\n",
		"标\u0000题",
		"标\u007f题",
		" 标题",
		"标题 ",
	]) {
		const imaging = syntheticImagingResult("合成临床正文");
		const report = imaging[0];
		if (!report) throw new Error("Missing synthetic imaging report");
		report.summary.title = title;
		report.detail.title = title;
		expect(() => normalizeReportDirectoryResults(imaging)).toThrow(
			new ReportResultValidationError("title-invalid"),
		);
		// 摘要合法而详情单独损坏时，也不能越过详情标题边界。
		report.summary.title = "合成摘要";
		expect(() => normalizeReportDirectoryResults(imaging)).toThrow(
			new ReportResultValidationError("detail-title-invalid"),
		);
		expect(() =>
			normalizeLaboratoryReportDetail({
				kind: "laboratory",
				title,
				reportedAt: "2026-08-15 10:00:00",
				items: [],
				hasAttachment: false,
			}),
		).toThrow(new ReportResultValidationError("detail-title-invalid"));
	}
	for (const field of ["name", "result"]) {
		expect(() =>
			normalizeLaboratoryReportDetail({
				kind: "laboratory",
				title: "检".repeat(274),
				reportedAt: "2026-08-15 10:00:00",
				items: [
					{
						name: "合成指标",
						result: "1",
						flag: "normal",
						[field]: "值".repeat(257),
					},
				],
				hasAttachment: false,
			}),
		).toThrow(new ReportResultValidationError("detail-field-invalid"));
	}
});

function syntheticImagingResult(content: unknown, count = 0) {
	return [
		{
			summary: {
				kind: "imaging",
				title: "合成影像报告",
				reportedAt: "2026-08-15 10:00:00",
				status: "available",
				hasAttachment: count > 0,
			},
			providerReportId: "synthetic-imaging-report",
			detail: {
				kind: "imaging",
				title: "合成影像报告",
				reportedAt: "2026-08-15 10:00:00",
				fields: [],
				sections: [{ title: "检查所见", content }],
				hasAttachment: count > 0,
			},
			attachments: Array.from({ length: count }, (_, index) => ({
				sourceUrl: `https://provider.example.test/synthetic/image-${index}.png`,
				kind: "image",
				label: `报告图片 ${index + 1}`,
			})),
		},
	];
}

test("报告正文保留首尾空白和CR/LF/TAB，附件上限与公共契约一致", () => {
	const content = " \n合成所见一\r\n\t合成所见二\r第三行\n ";
	const result = normalizeReportDirectoryResults(
		syntheticImagingResult(content, MAX_REPORT_ATTACHMENTS),
	);
	const report = result[0];
	if (!report || !("detail" in report))
		throw new Error("Missing imaging detail");
	expect(report.detail.sections[0]?.content).toBe(content);
	expect(report.attachments).toHaveLength(MAX_REPORT_ATTACHMENTS);
	expect(() =>
		normalizeReportDirectoryResults(
			syntheticImagingResult(content, MAX_REPORT_ATTACHMENTS + 1),
		),
	).toThrow(new ReportResultValidationError("attachment-too-many"));
});

test("报告正文继续拒绝未知结构、空白正文、超长文本和其他控制字符", () => {
	for (const content of [
		null,
		{},
		[],
		1,
		"",
		" \t\r\n",
		"文".repeat(10_001),
		...Array.from({ length: 33 }, (_, index) => (index === 32 ? 0x7f : index))
			.filter((code) => ![0x09, 0x0a, 0x0d].includes(code))
			.map((code) => `临床正文${String.fromCharCode(code)}尾部`),
	]) {
		expect(() =>
			normalizeReportDirectoryResults(syntheticImagingResult(content)),
		).toThrow(new ReportResultValidationError("detail-field-invalid"));
	}
});

test("报告正文兼容不放宽标题、编号、字段和附件URL的单行校验", () => {
	for (const change of [
		(value: ReturnType<typeof syntheticImagingResult>[number]) => {
			value.summary.title += "\n";
		},
		(value: ReturnType<typeof syntheticImagingResult>[number]) => {
			value.providerReportId += "\t";
		},
		(value: ReturnType<typeof syntheticImagingResult>[number]) => {
			value.detail.sections = [
				{ title: "检查所见\r", content: "合成临床正文" },
			];
		},
		(value: ReturnType<typeof syntheticImagingResult>[number]) => {
			const attachment = value.attachments[0];
			if (!attachment) throw new Error("Missing imaging attachment");
			attachment.sourceUrl += "\n";
		},
	]) {
		const result = syntheticImagingResult("合成临床正文", 1);
		const report = result[0];
		if (!report) throw new Error("Missing imaging report");
		change(report);
		expect(() => normalizeReportDirectoryResults(result)).toThrow(
			ReportResultValidationError,
		);
	}
});

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

test("报告引用拒绝带控制字符的 owner，避免越过 owner 隔离边界", () => {
	const reference = {
		reportId: "report-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		provider: "zhongyang" as const,
		kind: "laboratory" as const,
		providerReportId: "provider-report-001",
		createdAt: "2026-08-15T00:00:00.000Z",
		expiresAt: "2026-08-15T00:10:00.000Z",
	};

	for (const ownerUserId of ["user-\n001", " user-001", "user-001 "]) {
		expect(() =>
			validateReportReference({ ...reference, ownerUserId }),
		).toThrow(new ReportReferenceValidationError("invalid_owner"));
	}
});

test("LIS 引用保留有效原查询窗口并兼容没有窗口的旧引用", () => {
	const reference = {
		reportId: "report-window-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		provider: "zhongyang" as const,
		kind: "laboratory" as const,
		providerReportId: "provider-report-window-001",
		createdAt: "2026-08-15T00:00:00.000Z",
		expiresAt: "2026-08-15T00:10:00.000Z",
	};
	expect(() => validateReportReference(reference)).not.toThrow();
	expect(() =>
		validateReportReference({
			...reference,
			startDate: "2026-08-01",
			endDate: "2026-08-15",
		}),
	).not.toThrow();
	for (const window of [
		{ startDate: "2026-08-01" },
		{ endDate: "2026-08-15" },
		{ startDate: "2026-08-16", endDate: "2026-08-15" },
		{ startDate: "2026-02-30", endDate: "2026-03-01" },
	]) {
		expect(() => validateReportReference({ ...reference, ...window })).toThrow(
			new ReportReferenceValidationError("invalid_reference"),
		);
	}
});
