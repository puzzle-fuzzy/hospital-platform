import { expect, test } from "bun:test";
import type {
	OutpatientElectronicInvoiceGateway,
	OutpatientElectronicInvoiceQueryGateway,
	PatientRepository,
} from "@hospital/domain";
import { OutpatientElectronicInvoiceService } from "./index";

const context = {
	traceId: "invoice-service-trace-001",
	idempotencyKey: "invoice-service-key-001",
};

function repository(): PatientRepository {
	return {
		listByOwner: async () => [],
		upsertFromDirectory: async () => {
			throw new Error("not used");
		},
		resolveProviderReference: async (input) => ({
			patientId: input.patientId,
			provider: "zhongyang",
			providerPatientId: "1952638941030000200",
		}),
	};
}

function queryGateway(
	onList?: (
		input: Parameters<
			OutpatientElectronicInvoiceQueryGateway["listRecords"]
		>[0],
	) => void,
): OutpatientElectronicInvoiceQueryGateway {
	return {
		listRecords: async (input) => {
			onList?.(input);
			return {
				records: [
					{
						outInvoiceMainId: "1900000000000000001",
						outSettleMainId: "1900000000000000002",
						invoiceCode: "044001900111",
						amountFen: 1230,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-electronic-invoice-records",
					requestId: "invoice-query-001",
				},
			};
		},
	};
}

test("电子发票列表只返回平台 recordId，不泄露 Provider 主键", async () => {
	const service = new OutpatientElectronicInvoiceService({
		repository: repository(),
		query: queryGateway(),
		issue: {
			issue: async () => {
				throw new Error("not used");
			},
		},
		now: () => new Date("2026-09-22T01:00:00.000Z"),
	});

	const result = await service.list("user-001", "patient-001", context);
	expect(result.items).toHaveLength(1);
	expect(result.items[0]).toMatchObject({
		invoiceCode: "044001900111",
		amountFen: 1230,
	});
	expect(result.items[0]?.recordId).toMatch(/^inv_[0-9a-f]{64}$/u);
	expect(JSON.stringify(result)).not.toContain("1900000000000000001");
});

test("开票前重新查询并把服务端解析的两个主键交给 2.6.29", async () => {
	let queryCount = 0;
	let issueInput:
		| Parameters<OutpatientElectronicInvoiceGateway["issue"]>[0]
		| undefined;
	const query = queryGateway(() => {
		queryCount += 1;
	});
	const service = new OutpatientElectronicInvoiceService({
		repository: repository(),
		query,
		issue: {
			issue: async (input) => {
				issueInput = input;
				return {
					invoice: {
						outInvoiceMainId: input.invoiceMainId,
						outSettleMainId: input.outSettleMainId,
						billNo: "12345678",
					},
					trace: {
						provider: "zhongyang",
						operation: "outpatient-electronic-invoice-issue",
						requestId: "invoice-issue-001",
					},
				};
			},
		},
	});

	const listed = await service.list("user-001", "patient-001", context);
	const listedRecord = listed.items[0];
	expect(listedRecord).toBeDefined();
	const result = await service.issue({
		ownerUserId: "user-001",
		patientId: "patient-001",
		recordId: listedRecord?.recordId ?? "missing",
		payerType: "1",
		context,
	});

	expect(queryCount).toBe(2);
	expect(issueInput).toEqual({
		invoiceMainId: "1900000000000000001",
		outSettleMainId: "1900000000000000002",
		payerType: "1",
	});
	expect(result.invoice.billNo).toBe("12345678");
});
