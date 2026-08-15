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
				kind: "laboratory",
				title: "血常规",
				reportedAt: "2026-08-15 10:00:00",
				status: "abnormal",
				hasAttachment: true,
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
								modality: "CT",
								reportAuditTime: "2026-08-11",
							},
						]
					: [
							{
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
	expect(result.reports.map((report) => report.kind).sort()).toEqual([
		"ecg",
		"imaging",
		"laboratory",
	]);
	expect(result.trace.requestId).toBe("request-1,request-2,request-3");
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
