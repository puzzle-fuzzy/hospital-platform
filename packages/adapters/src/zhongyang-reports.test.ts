import { expect, test } from "bun:test";
import {
	MAX_REPORT_ATTACHMENTS,
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	MAX_REPORT_TITLE_LENGTH,
	normalizeLaboratoryReportDetail,
	normalizeReportDirectoryResults,
} from "@hospital/domain";
import { createZhongyangReportGateway } from "./zhongyang-reports";

const context = {
	traceId: "report-trace-001",
	idempotencyKey: "report-key-001",
};

function syntheticLaboratoryTitleGateway(
	testList: string,
	overrides: Record<string, unknown> = {},
) {
	return createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const path = new URL(String(input)).pathname;
			const laboratory = {
				reportId: "synthetic-long-title-lis",
				testList,
				reportTime: "2026-08-15 10:00:00",
				details: [{ itemName: "合成检验指标", itemResult: "1.0" }],
				...overrides,
			};
			const detail = path.endsWith("/details");
			const kind = path.includes("lis-reports")
				? "lis"
				: path.includes("pacs")
					? "pacs"
					: "ecg";
			const data = detail
				? laboratory
				: kind === "lis"
					? [laboratory]
					: kind === "pacs"
						? [
								{
									reportId: "synthetic-long-title-pacs",
									modality: "CT",
									reportAuditTime: "2026-08-15 11:00:00",
									finding: "合成所见\r\n第二行",
									reportImgPath: Array.from(
										{ length: 8 },
										(_, index) =>
											`https://zhongyang.example.test/synthetic/${index}.png`,
									),
									reportPdfPath:
										"https://zhongyang.example.test/synthetic/report.pdf",
								},
							]
						: [
								{
									ecgReportId: "synthetic-long-title-ecg",
									diagnosis: "合成心电诊断",
									diagnoseTime: "2026-08-15 12:00:00",
								},
							];
			return new Response(JSON.stringify({ success: true, data }), {
				status: 200,
				headers: {
					"x-request-id": `synthetic-title-${detail ? "detail" : kind}`,
				},
			});
		},
	});
}

test("274字符及上限检验组合标题完整通过三来源目录与详情，不截断或遗漏其他报告", async () => {
	const combinedTitle = `${"合成检验项目".repeat(45)}终项合成`;
	expect(combinedTitle).toHaveLength(274);
	for (const title of [combinedTitle, "检".repeat(MAX_REPORT_TITLE_LENGTH)]) {
		const gateway = syntheticLaboratoryTitleGateway(title);
		const result = await gateway.listReports(
			{
				providerPatientId: "synthetic-long-title-patient",
				query: { startDate: "2026-08-01", endDate: "2026-08-15" },
			},
			context,
		);
		const reports = normalizeReportDirectoryResults(result.reports);
		expect(reports).toHaveLength(3);
		expect(reports.map((report) => report.summary.kind).sort()).toEqual([
			"ecg",
			"imaging",
			"laboratory",
		]);
		expect(
			reports.find((report) => report.summary.kind === "laboratory")?.summary
				.title,
		).toBe(title);
		const imaging = reports.find((report) => report.summary.kind === "imaging");
		if (!imaging || !("attachments" in imaging))
			throw new Error("Missing imaging report");
		expect(imaging.attachments).toHaveLength(9);
		expect(result.trace.requestIds).toHaveLength(3);
		const detail = await gateway.getLaboratoryDetail(
			{ providerReportId: "synthetic-long-title-lis" },
			context,
		);
		expect(normalizeLaboratoryReportDetail(detail.detail).title).toBe(title);
	}
});

test("检验标题超过1024或带控制字符时整批拒绝，编号和检测结果长度不放宽", async () => {
	for (const title of [
		"检".repeat(MAX_REPORT_TITLE_LENGTH + 1),
		"合成标题\n",
		"合成\t标题",
		"合成\u007f标题",
	]) {
		const gateway = syntheticLaboratoryTitleGateway(title);
		await expect(
			gateway.listReports(
				{
					providerPatientId: "synthetic-long-title-patient",
					query: { startDate: "2026-08-01", endDate: "2026-08-15" },
				},
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-laboratory",
			responseInvalid: true,
		});
		await expect(
			gateway.getLaboratoryDetail(
				{ providerReportId: "synthetic-long-title-lis" },
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-laboratory-detail",
			responseInvalid: true,
		});
	}
	const longTitle = "检".repeat(274);
	await expect(
		syntheticLaboratoryTitleGateway(longTitle, {
			reportId: "r".repeat(257),
		}).listReports(
			{
				providerPatientId: "synthetic-long-title-patient",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "laboratory",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		responseInvalid: true,
	});
	await expect(
		syntheticLaboratoryTitleGateway(longTitle, {
			details: [{ itemName: "合成指标", itemResult: "1".repeat(257) }],
		}).getLaboratoryDetail(
			{ providerReportId: "synthetic-long-title-lis" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		responseInvalid: true,
	});
});

function syntheticImagingQuery(overrides: Record<string, unknown>) {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					code: "0000",
					data: [
						{
							reportId: "synthetic-imaging-report",
							stuBodypart: "合成影像检查",
							reportAuditTime: "2026-08-15 10:00:00",
							...overrides,
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "synthetic-imaging-request" },
				},
			),
	});
	return gateway.listReports(
		{
			providerPatientId: "synthetic-patient",
			query: {
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "imaging",
			},
		},
		context,
	);
}

test("PACS 图片字符串和四页、八页数组均保留全部附件与原始多行正文", async () => {
	const finding = "  合成所见第一行\r\n\t合成所见第二行\n第三行\r第四行  ";
	const conclusion = "\n合成结论一\r\n合成结论二\t \n";
	for (const count of [1, 4, 8]) {
		const imageUrls = Array.from(
			{ length: count },
			(_, index) =>
				`https://zhongyang.example.test/synthetic/image-${index + 1}.png`,
		);
		const result = await syntheticImagingQuery({
			reportImgPath: count === 1 ? imageUrls[0] : imageUrls,
			reportPdfPath: "https://zhongyang.example.test/synthetic/report.pdf",
			finding,
			conclusion,
		});
		const reports = normalizeReportDirectoryResults(result.reports);
		const report = reports[0];
		if (!report || !("detail" in report))
			throw new Error("Missing imaging detail");
		expect(
			report?.attachments?.map((attachment) => attachment.sourceUrl),
		).toEqual([
			"https://zhongyang.example.test/synthetic/report.pdf",
			...imageUrls,
		]);
		expect(report?.detail?.sections).toEqual([
			{ title: "检查所见", content: finding },
			{ title: "检查结论", content: conclusion },
		]);
		expect(report?.summary.hasAttachment).toBe(true);
	}
});

test("PACS 图片空数组保持无附件，附件数量恰好到上限时完整返回", async () => {
	const empty = await syntheticImagingQuery({ reportImgPath: [] });
	expect(empty.reports[0]?.summary.hasAttachment).toBe(false);
	const emptyReport = empty.reports[0];
	if (!emptyReport || !("attachments" in emptyReport))
		throw new Error("Missing imaging attachments");
	expect(emptyReport.attachments).toEqual([]);
	const result = await syntheticImagingQuery({
		reportImgPath: Array.from(
			{ length: MAX_REPORT_ATTACHMENTS - 1 },
			(_, index) =>
				`https://zhongyang.example.test/synthetic/image-${index}.png`,
		),
		reportPdfPath: "https://zhongyang.example.test/synthetic/report.pdf",
	});
	const report = normalizeReportDirectoryResults(result.reports)[0];
	if (!report || !("attachments" in report))
		throw new Error("Missing imaging attachments");
	expect(report.attachments).toHaveLength(MAX_REPORT_ATTACHMENTS);
});

test("PACS 图片数组拒绝未知元素、不安全URL、超长地址与超限数组", async () => {
	for (const reportImgPath of [
		{},
		true,
		[null],
		[{}],
		[["https://zhongyang.example.test/image.png"]],
		["https://zhongyang.example.test/image.png", 1],
		["https://zhongyang.example.test/image.png\n"],
		"\thttps://zhongyang.example.test/image.png",
		["https://zhongyang.example.test/image\u0000.png"],
		[`https://zhongyang.example.test/${"x".repeat(2048)}`],
		["javascript:alert(1)"],
		["data:image/png;base64,AA"],
		["/relative/image.png"],
		["https://user:secret@zhongyang.example.test/image.png"],
		["https://zhongyang.example.test/image.png#fragment"],
		Array.from({ length: MAX_REPORT_ATTACHMENTS + 1 }, () => ""),
	]) {
		await expect(
			syntheticImagingQuery({ reportImgPath }),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-imaging",
			responseInvalid: true,
		});
	}
});

test("PACS 合并PDF与图片后超过总附件上限时整批拒绝", async () => {
	await expect(
		syntheticImagingQuery({
			reportImgPath: Array.from(
				{ length: MAX_REPORT_ATTACHMENTS },
				(_, index) =>
					`https://zhongyang.example.test/synthetic/image-${index}.png`,
			),
			reportPdfPath: "https://zhongyang.example.test/synthetic/report.pdf",
		}),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-imaging",
		responseInvalid: true,
	});
});

test("PACS 仅正文放行排版字符，标题、编号、URL及其他控制字符继续拒绝", async () => {
	for (const overrides of [
		{ finding: { content: "不能吞掉的未知结构" } },
		{ conclusion: ["不能吞掉的未知结构"] },
		{ finding: "\t\r\n  " },
		{ finding: "文".repeat(10_001) },
		{ stuBodypart: "检查\n标题" },
		{ reportId: "report\tidentifier" },
		{ reportPdfPath: "https://zhongyang.example.test/report.pdf\r\n" },
		...Array.from({ length: 33 }, (_, index) => (index === 32 ? 0x7f : index))
			.filter((code) => ![0x09, 0x0a, 0x0d].includes(code))
			.map((code) => ({ finding: `合成正文${String.fromCharCode(code)}尾部` })),
	]) {
		await expect(syntheticImagingQuery(overrides)).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-imaging",
			responseInvalid: true,
		});
	}
});

test("众阳报告目录按来源查询并映射为安全摘要", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const url = String(input);
			requestUrls.push(url);
			return new Response(
				JSON.stringify({
					success: true,
					data: url.includes("lis-reports")
						? [
								{
									reportId: "provider-report-001-lis",
									testList: "血常规",
									reportTime: "2026-08-15 10:00:00",
									criticalFlag: "1",
									pdfUrlList: ["https://provider.invalid/private.pdf"],
									patientName: "不应返回的姓名",
									details: [{ itemName: "不应返回的明细" }],
								},
							]
						: [],
				}),
				{ status: 200, headers: { "x-request-id": "provider-report-001" } },
			);
		},
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "provider-patient-001",
			query: {
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "laboratory",
			},
		},
		context,
	);

	expect(requestUrls[0]).toBe(
		"https://zhongyang.example.test/msun-middle-business-lis/v1/lis-reports-filter?patId=provider-patient-001&startTime=2026-08-01+00%3A00%3A00&endTime=2026-08-15+23%3A59%3A59",
	);
	expect(result).toEqual({
		reports: [
			{
				summary: {
					kind: "laboratory",
					title: "血常规",
					reportedAt: "2026-08-15 10:00:00",
					status: "abnormal",
					hasAttachment: true,
				},
				providerReportId: "provider-report-001-lis",
			},
		],
		trace: {
			provider: "zhongyang",
			operation: "reports-directory",
			requestId: "provider-report-001",
		},
	});
	expect(JSON.stringify(result)).not.toContain("不应返回");
});

test("众阳报告时间缺失时不使用其它时间字段猜测医疗事实", async () => {
	const createGateway = (kind: "laboratory" | "ecg", data: unknown) =>
		createZhongyangReportGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify([data]), {
					status: 200,
					headers: { "x-request-id": `missing-${kind}-report-time` },
				}),
		});

	await expect(
		createGateway("laboratory", {
			testList: "血常规",
			collectTime: "2026-08-15 09:00:00",
			regTime: "2026-08-15 09:30:00",
		}).listReports(
			{
				providerPatientId: "provider-patient-report-time",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "laboratory",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory",
		responseInvalid: true,
	});

	await expect(
		createGateway("ecg", {
			diagnosis: "窦性心律",
			auditDocTime: "2026-08-15 11:00:00",
		}).listReports(
			{
				providerPatientId: "provider-patient-report-time",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "ecg",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-ecg",
		responseInvalid: true,
	});
});

test("众阳心电报告优先使用旧端展示的诊断时间", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify([
					{
						ecgReportId: "ecg-report-time-priority",
						diagnosis: "窦性心律",
						diagnoseTime: "2026-08-15 10:00:00",
						auditDocTime: "2026-08-15 11:00:00",
					},
				]),
				{
					status: 200,
					headers: { "x-request-id": "ecg-report-time-priority" },
				},
			),
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "provider-patient-report-time-priority",
			query: {
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "ecg",
			},
		},
		context,
	);

	expect(result.reports[0]?.summary.reportedAt).toBe("2026-08-15 10:00:00");
});

test("众阳 PEIS 使用服务端身份证与静态医院参数并映射体检详情和附件", async () => {
	let requestUrl = "";
	let requestBody = "";
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestBody = String(init?.body ?? "");
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						report: [
							{
								peisRegInfoId: "peis-provider-001",
								packageNames: "入职体检",
								summaryTime: "2026-08-15 09:00:00",
								doctor: "王医生",
								pdfUrl: "https://zhongyang.example.test/private/peis-001.pdf",
							},
						],
					},
				}),
				{
					status: 200,
					headers: { "x-request-id": "peis-request-001" },
				},
			);
		},
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "his-patient-001",
			providerIdentityNumber: "140581199001010001",
			hospitalId: 10389001,
			query: {
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				kind: "peis",
			},
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-peis-app-peis-new/v1/find-report-list-for-wechat",
	);
	expect(JSON.parse(requestBody)).toEqual({
		idcard: "140581199001010001",
		hospitalId: 10389001,
		startTime: "2026-08-01 00:00:00",
		endTime: "2026-08-15 23:59:59",
	});
	expect(result.reports[0]).toMatchObject({
		providerReportId: "peis-provider-001",
		summary: {
			kind: "peis",
			title: "入职体检",
			hasAttachment: true,
		},
		detail: {
			kind: "peis",
			fields: expect.arrayContaining([
				{ label: "体检套餐", value: "入职体检" },
			]),
		},
	});
	expect(JSON.stringify(result)).not.toContain("140581199001010001");
});

test("众阳附件代理只读取允许来源并限制为声明的 PDF 或图片类型", async () => {
	let fetchCount = 0;
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "provider-token",
		fetcher: async (_input, init) => {
			fetchCount += 1;
			expect(init?.redirect).toBe("manual");
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer provider-token",
			);
			return new Response(new TextEncoder().encode("%PDF-1.7"), {
				status: 200,
				headers: {
					"content-type": "application/pdf",
					"x-request-id": "attachment-request-001",
				},
			});
		},
	});

	await expect(
		gateway.fetchAttachment(
			{
				sourceUrl: "https://zhongyang.example.test/private/report.pdf",
				kind: "pdf",
				label: "报告 PDF",
			},
			context,
		),
	).resolves.toEqual({
		body: new TextEncoder().encode("%PDF-1.7"),
		contentType: "application/pdf",
	});
	await expect(
		gateway.fetchAttachment(
			{
				sourceUrl: "https://untrusted.example.test/private/report.pdf",
				kind: "pdf",
				label: "报告 PDF",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-attachment",
		responseInvalid: false,
	});
	expect(fetchCount).toBe(1);
});

test("众阳报告目录默认读取 LIS、PACS 和 ECG 三个来源并仅在内部保留详情引用", async () => {
	const requestUrls: string[] = [];
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const url = String(input);
			requestUrls.push(url);
			const data = url.includes("lis-reports")
				? [
						{
							reportTypeName: "检验",
							reportTime: "2026-08-10",
						},
					]
				: url.includes("pacs")
					? [
							{
								reportId: "pacs-provider-secret",
								modality: "CT",
								reportAuditTime: "2026-08-11",
							},
						]
					: [
							{
								ecgReportId: "ecg-provider-secret",
								diagnosis: "窦性心律",
								diagnoseTime: "2026-08-12",
							},
						];
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "x-request-id": `request-${requestUrls.length}` },
			});
		},
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "provider-patient-002",
			query: { startDate: "2026-08-01", endDate: "2026-08-15" },
		},
		context,
	);

	expect(requestUrls).toHaveLength(3);
	expect(result.reports.map((report) => report.summary.kind).sort()).toEqual([
		"ecg",
		"imaging",
		"laboratory",
	]);
	expect(result.trace.requestId).toBe("request-1");
	expect(result.trace.requestIds).toEqual([
		"request-1",
		"request-2",
		"request-3",
	]);
	expect(
		result.reports.find((report) => report.summary.kind === "imaging")
			?.providerReportId,
	).toBe("pacs-provider-secret");
	expect(
		result.reports.find((report) => report.summary.kind === "ecg")
			?.providerReportId,
	).toBe("ecg-provider-secret");
	expect(
		JSON.stringify(result.reports.map((report) => report.summary)),
	).not.toContain("provider-secret");
});

test("众阳心电报告将已确认的 0001 未查询到数据包络映射为空列表", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const url = String(input);
			if (url.includes("ecg-reports")) {
				return new Response(
					JSON.stringify({
						success: false,
						code: "0001",
						message: "未查询到数据",
						data: null,
					}),
					{ status: 200, headers: { "x-request-id": "ecg-empty" } },
				);
			}
			return new Response(
				JSON.stringify({ success: true, code: "0000", data: [] }),
				{
					status: 200,
					headers: {
						"x-request-id": url.includes("lis-reports")
							? "lis-empty"
							: "pacs-empty",
					},
				},
			);
		},
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "provider-patient-empty-ecg",
			query: { startDate: "2026-08-15", endDate: "2026-09-14" },
		},
		context,
	);

	expect(result.reports).toEqual([]);
	expect(result.trace.requestIds).toEqual([
		"lis-empty",
		"pacs-empty",
		"ecg-empty",
	]);
});

test("众阳心电报告不会把其它 0001 业务拒绝误判为空列表", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: false,
					code: "0001",
					message: "心电服务异常",
					data: null,
				}),
				{ status: 200, headers: { "x-request-id": "ecg-rejected" } },
			),
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-rejected-ecg",
				query: {
					startDate: "2026-08-15",
					endDate: "2026-09-14",
					kind: "ecg",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-ecg",
		requestId: "ecg-rejected",
		responseInvalid: false,
	});
});

test("众阳 PEIS 将已确认的 10002 未查询到数据包络映射为空列表", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: false,
					code: "10002",
					msg: "未查询到数据",
					data: { patientName: "", report: [] },
				}),
				{ status: 200, headers: { "x-request-id": "peis-empty" } },
			),
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "his-patient-empty-peis",
			providerIdentityNumber: "140581199001010001",
			hospitalId: 10389001,
			query: {
				startDate: "2026-08-15",
				endDate: "2026-09-14",
				kind: "peis",
			},
		},
		context,
	);

	expect(result.reports).toEqual([]);
	expect(result.trace).toEqual({
		provider: "zhongyang",
		operation: "reports-directory",
		requestId: "peis-empty",
	});
});

test("众阳跨来源报告按严格可解析时间倒序，未知时间放在末尾", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const url = String(input);
			const data = url.includes("lis-reports")
				? [{ reportTypeName: "检验", reportTime: "2026/9/30 10:00:00" }]
				: url.includes("pacs")
					? [
							{
								reportId: "pacs-order",
								modality: "CT",
								reportAuditTime: "2026-10-01",
							},
						]
					: [
							{
								ecgReportId: "ecg-order",
								diagnosis: "窦性心律",
								diagnoseTime: "未知时间",
							},
						];
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "x-request-id": `order-${url}` },
			});
		},
	});

	const result = await gateway.listReports(
		{
			providerPatientId: "provider-patient-order",
			query: { startDate: "2026-09-01", endDate: "2026-10-02" },
		},
		context,
	);

	// 斜杠日期和短日期都能严格排序；未知 Provider 文本不参与猜测，放到末尾。
	expect(result.reports.map((report) => report.summary.kind)).toEqual([
		"imaging",
		"laboratory",
		"ecg",
	]);
});

test("众阳 LIS 详情只映射白名单检测项并保留 provider 引用在请求内", async () => {
	let requestUrl = "";
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			requestUrl = String(input);
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						reportId: "provider-report-detail-001",
						testList: "血常规",
						reportTime: "2026-08-15 10:00:00",
						patName: "不应返回的姓名",
						pdfUrlList: ["https://provider.invalid/private.pdf"],
						details: [
							{
								itemName: "白细胞计数",
								itemResult: "10.2",
								unit: "10^9/L",
								itemRange: "3.5-9.5",
								expertOpinion: "结合临床情况复核",
								mark: "H",
							},
							{
								itemName: "血红蛋白",
								itemResult: "120",
								flagCritical: "1",
							},
						],
					},
				}),
				{
					status: 200,
					headers: { "x-request-id": "provider-report-detail-001" },
				},
			);
		},
	});

	const result = await gateway.getLaboratoryDetail(
		{ providerReportId: "provider-report-detail-001" },
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-business-lis/v1/lis-reports/details?reportId=provider-report-detail-001",
	);
	expect(result.detail).toEqual({
		kind: "laboratory",
		title: "血常规",
		reportedAt: "2026-08-15 10:00:00",
		items: [
			{
				name: "白细胞计数",
				result: "10.2",
				unit: "10^9/L",
				referenceRange: "3.5-9.5",
				expertOpinion: "结合临床情况复核",
				flag: "high",
			},
			{ name: "血红蛋白", result: "120", flag: "critical" },
		],
		hasAttachment: true,
	});
	expect(JSON.stringify(result)).not.toContain("不应返回");
});

test("众阳 LIS 详情在公开 contract 边界拒绝超长单位", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: {
						testList: "血常规",
						reportTime: "2026-08-15 10:00:00",
						details: [
							{
								itemName: "白细胞计数",
								itemResult: "10.2",
								unit: "单位".repeat(33),
							},
						],
					},
				}),
				{
					status: 200,
					headers: { "x-request-id": "oversized-report-unit" },
				},
			),
	});

	await expect(
		gateway.getLaboratoryDetail(
			{ providerReportId: "provider-report-detail-oversized-unit" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory-detail",
		requestId: "oversized-report-unit",
		retryable: false,
		responseInvalid: true,
	});
});

test("众阳报告 adapter 拒绝带控制字符的 Provider 文本", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							testList: "血常规\n异常",
							reportTime: "2026-08-15 10:00:00",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "control-character-report" },
				},
			),
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-control-character",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "laboratory",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory",
		requestId: "control-character-report",
		retryable: false,
		responseInvalid: true,
	});
});

test("众阳报告异常标记遇到未知形状时拒绝而不是默认为正常", async () => {
	const directoryCases = [
		{
			value: {
				testList: "血常规",
				reportTime: "2026-08-15 10:00:00",
				criticalFlag: {},
			},
			requestId: "invalid-report-critical-flag",
		},
		{
			value: {
				testList: "血常规",
				reportTime: "2026-08-15 10:00:00",
				flagGerm: "2",
			},
			requestId: "invalid-report-germ-flag",
		},
	] as const;

	for (const item of directoryCases) {
		const gateway = createZhongyangReportGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify({ success: true, data: [item.value] }), {
					status: 200,
					headers: { "x-request-id": item.requestId },
				}),
		});

		await expect(
			gateway.listReports(
				{
					providerPatientId: "provider-patient-invalid-flag",
					query: {
						startDate: "2026-08-01",
						endDate: "2026-08-15",
						kind: "laboratory",
					},
				},
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-laboratory",
			requestId: item.requestId,
			retryable: false,
			responseInvalid: true,
		});
	}

	const detailGateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: {
						testList: "血常规",
						reportTime: "2026-08-15 10:00:00",
						details: [
							{
								itemName: "白细胞计数",
								itemResult: "10.2",
								flagCritical: [],
							},
						],
					},
				}),
				{
					status: 200,
					headers: { "x-request-id": "invalid-report-detail-flag" },
				},
			),
	});

	await expect(
		detailGateway.getLaboratoryDetail(
			{ providerReportId: "provider-report-invalid-flag" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory-detail",
		requestId: "invalid-report-detail-flag",
		retryable: false,
		responseInvalid: true,
	});
});

test("众阳报告附件标记拒绝宽松 truthy 值", async () => {
	const cases = [
		{
			kind: "laboratory" as const,
			value: {
				testList: "血常规",
				reportTime: "2026-08-15 10:00:00",
				pdfUrlList: [{}],
			},
			requestId: "invalid-lis-attachment",
		},
		{
			kind: "laboratory" as const,
			value: {
				testList: "血常规",
				reportTime: "2026-08-15 10:00:00",
				pdfUrlList: ["https://provider.invalid/private.pdf\n"],
			},
			requestId: "invalid-lis-attachment-control",
		},
		{
			kind: "imaging" as const,
			value: {
				modality: "CT",
				reportAuditTime: "2026-08-15 10:00:00",
				reportPdfPath: {},
			},
			requestId: "invalid-pacs-attachment",
		},
		{
			kind: "ecg" as const,
			value: {
				diagnosis: "窦性心律",
				diagnoseTime: "2026-08-15 10:00:00",
				pdfPath: true,
			},
			requestId: "invalid-ecg-attachment",
		},
	] as const;

	for (const item of cases) {
		const gateway = createZhongyangReportGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify([item.value]), {
					status: 200,
					headers: { "x-request-id": item.requestId },
				}),
		});

		// 附件只读提示也必须遵守 Provider 字段类型；不能因对象、数组或布尔值
		// 是 truthy 就向患者展示“含附件”，更不能让后续资源授权建立在该误判上。
		await expect(
			gateway.listReports(
				{
					providerPatientId: "provider-patient-attachment",
					query: {
						startDate: "2026-08-01",
						endDate: "2026-08-15",
						kind: item.kind,
					},
				},
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: `reports-${item.kind}`,
			requestId: item.requestId,
			retryable: false,
			responseInvalid: true,
		});
	}
});

test("众阳报告目录拒绝业务失败或无法映射的响应", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({ success: false, message: "provider error" }),
				{
					status: 200,
					headers: { "x-request-id": "provider-report-003" },
				},
			),
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-003",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "imaging",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-imaging",
		requestId: "provider-report-003",
		retryable: false,
		responseInvalid: false,
	});
});

test("众阳报告目录包络缺少明确 success=true 时不伪装成空目录", async () => {
	const createGateway = (payload: unknown, requestId: string) =>
		createZhongyangReportGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "x-request-id": requestId },
				}),
		});
	const input = {
		providerPatientId: "provider-patient-envelope",
		query: {
			startDate: "2026-08-01",
			endDate: "2026-08-15",
			kind: "imaging" as const,
		},
	};

	for (const [payload, requestId] of [
		[{ data: [] }, "report-missing-success"],
		[{ success: "true", data: [] }, "report-non-boolean-success"],
	] as const) {
		await expect(
			createGateway(payload, requestId).listReports(input, context),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-imaging",
			requestId,
			retryable: false,
			responseInvalid: true,
		});
	}
});

test("众阳 LIS 详情包络缺少明确 success=true 时拒绝临床数据", async () => {
	const createGateway = (payload: unknown, requestId: string) =>
		createZhongyangReportGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "x-request-id": requestId },
				}),
		});
	const detail = {
		testList: "血常规",
		reportTime: "2026-08-15 10:00:00",
		details: [],
	};

	for (const [payload, requestId] of [
		[{ data: detail }, "report-detail-missing-success"],
		[{ success: "true", data: detail }, "report-detail-non-boolean-success"],
	] as const) {
		await expect(
			createGateway(payload, requestId).getLaboratoryDetail(
				{ providerReportId: "provider-report-envelope" },
				context,
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "reports-laboratory-detail",
			requestId,
			retryable: false,
			responseInvalid: true,
		});
	}
});

test("众阳默认报告目录任一来源失败时拒绝返回部分成功", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const url = String(input);
			if (url.includes("pacs")) {
				return new Response(
					JSON.stringify({ success: false, message: "pacs unavailable" }),
					{ status: 200, headers: { "x-request-id": "pacs-failed" } },
				);
			}
			return new Response(JSON.stringify({ success: true, data: [] }), {
				status: 200,
				headers: {
					"x-request-id": url.includes("lis-reports") ? "lis-ok" : "ecg-ok",
				},
			});
		},
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-004",
				query: { startDate: "2026-08-01", endDate: "2026-08-15" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-imaging",
		requestId: "pacs-failed",
		retryable: false,
	});
});

test("众阳报告目录拒绝同一来源中的重复报告号", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async (input) => {
			const requestUrl = String(input);
			if (requestUrl.includes("lis-reports-filter")) {
				return new Response(
					JSON.stringify({
						success: true,
						data: [
							{
								reportId: "duplicate-report",
								testList: "血常规",
								reportTime: "2026-08-16 10:00:00",
							},
							{
								reportId: "duplicate-report",
								testList: "血常规复核",
								reportTime: "2026-08-16 10:01:00",
							},
						],
					}),
					{ status: 200, headers: { "x-request-id": "duplicate-report" } },
				);
			}
			return new Response(JSON.stringify({ success: true, data: [] }), {
				status: 200,
				headers: { "x-request-id": `empty-${requestUrl}` },
			});
		},
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "his-patient-001",
				query: { startDate: "2026-08-01", endDate: "2026-08-16" },
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory",
		requestId: "duplicate-report",
		retryable: false,
	});
});

test("众阳报告 adapter 拒绝运行时未知来源且不访问 Provider", async () => {
	let fetchCalled = false;
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			fetchCalled = true;
			throw new Error("provider must not be called");
		},
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-unknown-kind",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "unknown" as never,
				},
			},
			context,
		),
	).rejects.toMatchObject({ name: "InvalidReportKindError" });
	expect(fetchCalled).toBe(false);
});

test("众阳报告 adapter 在触网前拒绝畸形目录和详情输入", async () => {
	let providerCalls = 0;
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			providerCalls += 1;
			return new Response(JSON.stringify([]), { status: 200 });
		},
	});

	const directoryCases = [
		null,
		{
			providerPatientId: "provider-patient-invalid-report-query",
			query: { startDate: "2026-02-30", endDate: "2026-03-01" },
		},
		{
			providerPatientId: "provider-patient-invalid-report-query",
			query: { startDate: "2026-08-16", endDate: "2026-08-01" },
		},
		{
			providerPatientId: "provider-patient-invalid-report-query",
			query: {
				startDate: "2026-08-01",
				endDate: "2026-08-15",
				unexpected: true,
			},
		},
	] as const;

	for (const input of directoryCases) {
		await expect(
			gateway.listReports(input as never, context),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			responseInvalid: false,
		});
	}
	await expect(
		gateway.getLaboratoryDetail(null as never, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		responseInvalid: false,
	});
	// 报告目录三路查询和 LIS 详情都必须在患者/日期/引用形状明确后才触网。
	expect(providerCalls).toBe(0);
});

test("众阳报告 adapter 拒绝空 Provider 患者引用且不发起请求", async () => {
	let fetchCalled = false;
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			fetchCalled = true;
			throw new Error("provider must not be called");
		},
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "   ",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "laboratory",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "AdapterNotConfiguredError",
		dependency: "adapter:zhongyang",
	});
	expect(fetchCalled).toBe(false);
});

test("众阳报告目录超过资源上限时在摘要映射前整批拒绝", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: Array.from(
						{ length: MAX_REPORT_DIRECTORY_ITEMS + 1 },
						(_, index) => ({
							reportId: `report-too-many-${index}`,
							testList: "血常规",
							reportTime: "2026-08-15 10:00:00",
						}),
					),
				}),
				{ status: 200, headers: { "x-request-id": "report-too-many" } },
			),
	});

	await expect(
		gateway.listReports(
			{
				providerPatientId: "provider-patient-too-many",
				query: {
					startDate: "2026-08-01",
					endDate: "2026-08-15",
					kind: "laboratory",
				},
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory",
		requestId: "report-too-many",
		responseInvalid: true,
	});
});

test("众阳 LIS 明细超过资源上限时不映射部分临床结果", async () => {
	const gateway = createZhongyangReportGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: {
						testList: "血常规",
						reportTime: "2026-08-15 10:00:00",
						details: Array.from(
							{ length: MAX_REPORT_DETAIL_ITEMS + 1 },
							() => ({ itemName: "白细胞", itemResult: "10.2" }),
						),
					},
				}),
				{ status: 200, headers: { "x-request-id": "detail-too-many" } },
			),
	});

	await expect(
		gateway.getLaboratoryDetail(
			{ providerReportId: "provider-report-detail-too-many" },
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "reports-laboratory-detail",
		requestId: "detail-too-many",
		responseInvalid: true,
	});
});
