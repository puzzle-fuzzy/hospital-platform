import { expect, test } from "bun:test";
import type {
	OutpatientElectronicInvoiceGateway,
	OutpatientElectronicInvoiceQueryGateway,
	OutpatientElectronicInvoiceResourceGateway,
	PatientRepository,
} from "@hospital/domain";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { createInMemorySessionTokenService } from "../auth/service";
import {
	OutpatientElectronicInvoiceService,
	outpatientElectronicInvoicesModule,
} from "./index";

const context = {
	traceId: "invoice-service-trace-001",
	idempotencyKey: "invoice-service-key-001",
};

function resourceService(
	options: { issued?: boolean; patientAvailable?: boolean } = {},
) {
	let issueCount = 0;
	let queryCount = 0;
	let resourceCount = 0;
	let queriedResources:
		| Parameters<OutpatientElectronicInvoiceResourceGateway["fetchResource"]>[0]
		| undefined;
	const source =
		"http://111.111.111.52:18003/medical-web/industryMain.do?method=displayH5&ciphertext=aabb";
	const service = new OutpatientElectronicInvoiceService({
		repository: {
			...repository(),
			resolveProviderReference: async (input) =>
				options.patientAvailable === false
					? undefined
					: {
							patientId: input.patientId,
							provider: "zhongyang",
							providerPatientId: "provider-patient-001",
						},
		},
		query: {
			listRecords: async () => {
				queryCount += 1;
				return {
					records: [
						{
							outInvoiceMainId: "1900000000000000001",
							outSettleMainId: "1900000000000000002",
							...(options.issued === false
								? {}
								: { billBatchCode: "14060126", billNo: "0123456789" }),
							pictureUrl: source,
						},
					],
					trace: {
						provider: "zhongyang",
						operation: "outpatient-electronic-invoice-records",
						requestId: "resource-query-001",
					},
				};
			},
		},
		issue: {
			issue: async () => {
				issueCount += 1;
				throw new Error("must never issue when viewing");
			},
		},
		resourceGateway: {
			fetchResource: async (input) => {
				resourceCount += 1;
				queriedResources = input;
				return { body: new Uint8Array([1, 2, 3]), contentType: "image/png" };
			},
		},
	});
	return {
		service,
		source,
		counts: () => ({ issueCount, queryCount, resourceCount }),
		queriedResources: () => queriedResources,
	};
}

test("查看票据重新查询2.6.17且只把医院资源交网关，绝不开票", async () => {
	const fixture = resourceService();
	const listed = await fixture.service.list("user-001", "patient-001", context);
	const result = await fixture.service.resource(
		"user-001",
		"patient-001",
		listed.items[0]?.recordId ?? "missing",
		context,
	);
	expect(result).toEqual({
		body: new Uint8Array([1, 2, 3]),
		contentType: "image/png",
	});
	expect(fixture.queriedResources()).toEqual({ pictureUrl: fixture.source });
	expect(fixture.counts()).toEqual({
		queryCount: 2,
		issueCount: 0,
		resourceCount: 1,
	});
});

for (const [owner, patient, fakeRecord] of [
	["other-user", "patient-001", false],
	["user-001", "other-patient", false],
	["user-001", "patient-001", true],
] as const) {
	test("其他用户、其他患者或伪造recordId不能下载票据", async () => {
		const fixture = resourceService();
		const listed = await fixture.service.list(
			"user-001",
			"patient-001",
			context,
		);
		await expect(
			fixture.service.resource(
				owner,
				patient,
				fakeRecord ? "inv_fake" : (listed.items[0]?.recordId ?? "missing"),
				context,
			),
		).rejects.toMatchObject({
			name: "OutpatientElectronicInvoiceRecordNotFoundError",
		});
		expect(fixture.counts().resourceCount).toBe(0);
		expect(fixture.counts().issueCount).toBe(0);
	});
}

test("未开票记录只读查看不触发开票或下载", async () => {
	const fixture = resourceService({ issued: false });
	const listed = await fixture.service.list("user-001", "patient-001", context);
	await expect(
		fixture.service.resource(
			"user-001",
			"patient-001",
			listed.items[0]?.recordId ?? "missing",
			context,
		),
	).rejects.toMatchObject({
		name: "OutpatientElectronicInvoiceRecordNotFoundError",
	});
	expect(fixture.counts()).toEqual({
		queryCount: 2,
		issueCount: 0,
		resourceCount: 0,
	});
});

test("患者归属不存在时不查询医院或下载票据", async () => {
	const fixture = resourceService({ patientAvailable: false });
	await expect(
		fixture.service.resource("user-001", "patient-001", "inv_fake", context),
	).rejects.toMatchObject({ name: "OutpatientElectronicInvoiceQueryError" });
	expect(fixture.counts()).toEqual({
		queryCount: 0,
		issueCount: 0,
		resourceCount: 0,
	});
});

test("票据资源HTTP接口先鉴权，成功后以no-store/nosniff返回原始字节", async () => {
	const fixture = resourceService();
	const sessions = createInMemorySessionTokenService();
	const app = new Elysia()
		.use(errorHandlerPlugin())
		.use(outpatientElectronicInvoicesModule(fixture.service, sessions));
	const unauthenticated = await app.handle(
		new Request(
			"http://localhost/payments/outpatient/invoices/missing/resource",
		),
	);
	expect(unauthenticated.status).toBe(401);
	expect(fixture.counts()).toEqual({
		queryCount: 0,
		issueCount: 0,
		resourceCount: 0,
	});
	const listed = await fixture.service.list("user-001", "patient-001", context);
	const session = await sessions.issue("user-001");
	const response = await app.handle(
		new Request(
			`http://localhost/payments/outpatient/invoices/${listed.items[0]?.recordId}/resource?patientId=patient-001`,
			{ headers: { authorization: `Bearer ${session.accessToken}` } },
		),
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	expect(response.headers.get("x-content-type-options")).toBe("nosniff");
	expect(response.headers.get("content-type")).toBe("image/png");
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(
		new Uint8Array([1, 2, 3]),
	);
	expect(fixture.counts()).toEqual({
		queryCount: 2,
		issueCount: 0,
		resourceCount: 1,
	});
});

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
