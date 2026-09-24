import { expect, test } from "bun:test";
import { createZhongyangOutpatientElectronicInvoiceGateway } from "./zhongyang-outpatient-invoices";

const context = {
	traceId: "outpatient-invoice-trace-001",
	idempotencyKey: "outpatient-invoice-key-001",
};

test("众阳 2.6.29 发送精确的院内 ID 和固定配置参数", async () => {
	let requestUrl = "";
	let requestInit: RequestInit | undefined;
	const gateway = createZhongyangOutpatientElectronicInvoiceGateway({
		baseUrl: "https://zhongyang.example.test",
		authSysCode: "WeChatSmallProg",
		workStationId: "",
		hospitalId: "10389001",
		operatorType: 2,
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			requestInit = init;
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						billBatchCode: "044001900111",
						billNo: "12345678",
						billQrCode: "data:image/png;base64,qr-data",
						createTime: "2026-09-22 09:00:00",
						hospitalId: "10389001",
						invalidFlag: "0",
						outElectronicInvoiceId: "1900000000000000003",
						outInvoiceMainId: "1900000000000000001",
						outSettleMainId: "1900000000000000002",
						pictureNetUrl: "-1",
						pictureUrl: "data:image/png;base64,invoice-data",
						random: "987654",
					},
				}),
				{ status: 200, headers: { "x-request-id": "provider-invoice-001" } },
			);
		},
	});

	const result = await gateway.issue(
		{
			invoiceMainId: "1900000000000000001",
			outSettleMainId: "1900000000000000002",
			payerType: "1",
		},
		context,
	);

	expect(requestUrl).toBe(
		"https://zhongyang.example.test/msun-middle-open-settlepay/v1/invoices/out-electrionic-invoices",
	);
	expect(requestInit?.method).toBe("POST");
	expect(new Headers(requestInit?.headers).get("authorization")).toBe(
		"Bearer server-token",
	);
	expect(requestInit?.body).toBe(
		'{"invoiceMainId":1900000000000000001,"outSettleMainId":1900000000000000002,"payerType":"1","authSysCode":"WeChatSmallProg","workStationId":"","hospitalId":10389001,"operatorType":2}',
	);
	expect(result).toEqual({
		invoice: {
			billBatchCode: "044001900111",
			billNo: "12345678",
			billQrCode: "data:image/png;base64,qr-data",
			createTime: "2026-09-22 09:00:00",
			hospitalId: "10389001",
			invalidFlag: "0",
			outElectronicInvoiceId: "1900000000000000003",
			outInvoiceMainId: "1900000000000000001",
			outSettleMainId: "1900000000000000002",
			pictureNetUrl: "-1",
			pictureUrl: "data:image/png;base64,invoice-data",
			random: "987654",
		},
		trace: {
			provider: "zhongyang",
			operation: "outpatient-electronic-invoice-issue",
			requestId: "provider-invoice-001",
		},
	});
});

test("众阳 2.6.29 无设备对账时允许空工作站配置", () => {
	expect(() =>
		createZhongyangOutpatientElectronicInvoiceGateway({
			baseUrl: "https://zhongyang.example.test",
			authSysCode: "WeChatSmallProg",
			workStationId: "",
			hospitalId: "10389001",
			operatorType: 2,
		}),
	).not.toThrow();
});

test("众阳 2.6.29 明确业务拒绝和响应结构异常分开处理", async () => {
	const createGateway = (payload: unknown, requestId: string) =>
		createZhongyangOutpatientElectronicInvoiceGateway({
			baseUrl: "https://zhongyang.example.test",
			authSysCode: "thirdSelfMachine",
			workStationId: "machine-001",
			hospitalId: "10389001",
			operatorType: 2,
			fetcher: async () =>
				new Response(JSON.stringify(payload), {
					status: 200,
					headers: { "x-request-id": requestId },
				}),
		});
	const input = {
		invoiceMainId: "1001",
		outSettleMainId: "1002",
		payerType: "1" as const,
	};

	await expect(
		createGateway(
			{ success: false, message: "invoice rejected" },
			"invoice-rejected",
		).issue(input, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		requestId: "invoice-rejected",
		responseInvalid: false,
		operation: "outpatient-electronic-invoice-issue",
	});

	await expect(
		createGateway(
			{ success: true, data: { outInvoiceMainId: "not-a-number" } },
			"invoice-invalid-data",
		).issue(input, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		requestId: "invoice-invalid-data",
		responseInvalid: true,
	});
});

test("众阳 2.6.29 拒绝非法请求 ID、交款人类型和未知字段", async () => {
	const gateway = createZhongyangOutpatientElectronicInvoiceGateway({
		baseUrl: "https://zhongyang.example.test",
		authSysCode: "thirdSelfMachine",
		workStationId: "machine-001",
		hospitalId: "10389001",
		operatorType: 2,
		fetcher: async () => {
			throw new Error("provider must not be called");
		},
	});

	for (const input of [
		{ invoiceMainId: "0", outSettleMainId: "1002", payerType: "1" },
		{ invoiceMainId: "1001", outSettleMainId: "1002", payerType: "3" },
		{
			invoiceMainId: "1001",
			outSettleMainId: "1002",
			payerType: "1",
			unexpected: true,
		},
	] as const) {
		await expect(gateway.issue(input as never, context)).rejects.toMatchObject({
			name: "ProviderRequestError",
			responseInvalid: true,
		});
	}
});
