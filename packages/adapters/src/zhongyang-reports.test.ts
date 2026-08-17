import { expect, test } from "bun:test";
import { createZhongyangReportGateway } from "./zhongyang-reports";

const context = {
	traceId: "report-trace-001",
	idempotencyKey: "report-key-001",
};

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

test("众阳报告目录默认读取 LIS、PACS 和 ECG 三个来源", async () => {
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
	expect(result.trace.requestId).toBe("request-1,request-2,request-3");
	expect(JSON.stringify(result)).not.toContain("pacs-provider-secret");
	expect(JSON.stringify(result)).not.toContain("ecg-provider-secret");
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
	});
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
	});
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
