import { expect, test } from "bun:test";
import { createZhongyangOutpatientElectronicInvoiceQueryGateway } from "./zhongyang-outpatient-invoice-query";

const context = {
	traceId: "outpatient-invoice-query-trace-001",
	idempotencyKey: "outpatient-invoice-query-key-001",
};

test("2.6.17 使用服务端患者号查询已支付发票并保留主键字符串", async () => {
	let requestUrl = "";
	const gateway = createZhongyangOutpatientElectronicInvoiceQueryGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer server-token",
			);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							outInvoiceMainId: "1900000000000000001",
							outSettleMainId: "1900000000000000002",
							invoiceCode: "044001900111",
							invoiceTime: "2026-09-22 09:00:00",
							amount: "12.30",
							billBatchCode: "044001900111",
							billNo: "12345678",
							random: "987654",
							pictureNetUrl: "-1",
							pictureUrl: "data:image/png;base64,invoice-data",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "invoice-query-001" } },
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "1952638941030000200",
			startTime: "2026-08-23 00:00:00",
			endTime: "2026-09-22 23:59:59",
			settleStatus: "4",
			pageNum: 1,
			pageSize: 500,
		},
		context,
	);

	const url = new URL(requestUrl);
	expect(url.pathname).toBe(
		"/msun-middle-open-settlepay/v1/out-invoice-mains/main-lists",
	);
	expect(url.searchParams.get("patId")).toBe("1952638941030000200");
	expect(url.searchParams.get("settleStatus")).toBe("4");
	expect(url.searchParams.get("pageSize")).toBe("500");
	expect(result.records).toEqual([
		{
			outInvoiceMainId: "1900000000000000001",
			outSettleMainId: "1900000000000000002",
			invoiceCode: "044001900111",
			invoiceTime: "2026-09-22 09:00:00",
			amountFen: 1230,
			billBatchCode: "044001900111",
			billNo: "12345678",
			random: "987654",
			pictureNetUrl: "-1",
			pictureUrl: "data:image/png;base64,invoice-data",
		},
	]);
	expect(JSON.stringify(result)).not.toContain("1952638941030000200");
});

test("2.6.17 拒绝重复主键和非法分页", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceQueryGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{ outInvoiceMainId: "1", outSettleMainId: "2" },
						{ outInvoiceMainId: "1", outSettleMainId: "2" },
					],
				}),
				{ status: 200, headers: { "x-request-id": "invoice-query-duplicate" } },
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "pat-001",
				startTime: "2026-09-01 00:00:00",
				endTime: "2026-09-02 00:00:00",
				pageSize: 501,
			},
			context,
		),
	).rejects.toMatchObject({ responseInvalid: false });

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "pat-001",
				startTime: "2026-09-01 00:00:00",
				endTime: "2026-09-02 00:00:00",
			},
			context,
		),
	).rejects.toMatchObject({
		responseInvalid: true,
		requestId: "invoice-query-duplicate",
	});
});
