import { createHash } from "node:crypto";
import {
	OutpatientElectronicInvoiceIssueResponse,
	OutpatientElectronicInvoiceListResponse,
	success,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientElectronicInvoice,
	OutpatientElectronicInvoiceGateway,
	OutpatientElectronicInvoicePayerType,
	OutpatientElectronicInvoiceQueryGateway,
	OutpatientElectronicInvoiceRecord,
	OutpatientElectronicInvoiceResourceContent,
	OutpatientElectronicInvoiceResourceGateway,
	PatientRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	validatePatientProviderReference,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";

const DAY_MS = 24 * 60 * 60 * 1000;
const QUERY_DAYS = 30;

export class OutpatientElectronicInvoiceQueryError extends Error {
	constructor() {
		super("Outpatient electronic invoice query is invalid");
		this.name = "OutpatientElectronicInvoiceQueryError";
	}
}

export class OutpatientElectronicInvoiceRecordNotFoundError extends Error {
	constructor() {
		super("Outpatient electronic invoice record is not available");
		this.name = "OutpatientElectronicInvoiceRecordNotFoundError";
	}
}

type PublicInvoiceItem = {
	recordId: string;
	invoiceCode?: string;
	invoiceTime?: string;
	amountFen?: number;
	billBatchCode?: string;
	billNo?: string;
	random?: string;
	pictureNetUrl?: string;
	pictureUrl?: string;
};

function providerInvoiceId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9]+$/u.test(value) && value !== "0";
}

function safeText(value: unknown, maxLength = 8_000_000): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function formatProviderDate(value: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(value);
	const map = new Map(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${map.get("year")}-${map.get("month")}-${map.get("day")} ${map.get("hour")}:${map.get("minute")}:${map.get("second")}`;
}

function queryWindow(now: Date): { startTime: string; endTime: string } {
	return {
		startTime: formatProviderDate(
			new Date(now.getTime() - QUERY_DAYS * DAY_MS),
		),
		endTime: formatProviderDate(now),
	};
}

function invoiceRecordId(
	ownerUserId: string,
	patientId: string,
	record: Pick<
		OutpatientElectronicInvoiceRecord,
		"outInvoiceMainId" | "outSettleMainId"
	>,
): string {
	return `inv_${createHash("sha256")
		.update(
			`${ownerUserId}\u0000${patientId}\u0000${record.outInvoiceMainId}\u0000${record.outSettleMainId}`,
		)
		.digest("hex")}`;
}

function publicItem(
	ownerUserId: string,
	patientId: string,
	record: OutpatientElectronicInvoiceRecord,
): PublicInvoiceItem {
	const item: PublicInvoiceItem = {
		recordId: invoiceRecordId(ownerUserId, patientId, record),
	};
	for (const field of [
		"invoiceCode",
		"invoiceTime",
		"billBatchCode",
		"billNo",
		"random",
		"pictureNetUrl",
		"pictureUrl",
	] as const) {
		const value = record[field];
		if (value !== undefined && safeText(value)) item[field] = value;
	}
	if (record.amountFen !== undefined) item.amountFen = record.amountFen;
	return item;
}

/** 开票结果只返回患者查看电子票据所需字段，Provider 主键留在服务端。 */
function publicIssuedInvoice(value: OutpatientElectronicInvoice) {
	const invoice: Omit<
		OutpatientElectronicInvoice,
		| "hospitalId"
		| "outElectronicInvoiceId"
		| "outInvoiceMainId"
		| "outSettleMainId"
	> = {};
	for (const field of [
		"billBatchCode",
		"billNo",
		"billQrCode",
		"createTime",
		"invalidFlag",
		"pictureNetUrl",
		"pictureUrl",
		"random",
	] as const) {
		const candidate = value[field];
		if (candidate !== undefined && safeText(candidate))
			invoice[field] = candidate;
	}
	return invoice;
}

function validateQueryRecords(
	value: unknown,
): OutpatientElectronicInvoiceRecord[] {
	if (!Array.isArray(value) || value.length > 500) {
		throw new Error("outpatient-electronic-invoice-records-invalid");
	}
	const keys = new Set<string>();
	return value.map((value) => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error("outpatient-electronic-invoice-record-invalid");
		}
		const record = value as Record<string, unknown>;
		if (
			!providerInvoiceId(record.outInvoiceMainId) ||
			!providerInvoiceId(record.outSettleMainId)
		) {
			throw new Error("outpatient-electronic-invoice-reference-invalid");
		}
		const key = `${record.outInvoiceMainId}:${record.outSettleMainId}`;
		if (keys.has(key))
			throw new Error("outpatient-electronic-invoice-duplicate");
		keys.add(key);
		if (
			record.amountFen !== undefined &&
			(typeof record.amountFen !== "number" ||
				!Number.isSafeInteger(record.amountFen) ||
				record.amountFen < 0)
		) {
			throw new Error("outpatient-electronic-invoice-amount-invalid");
		}
		for (const field of [
			"invoiceCode",
			"invoiceTime",
			"billBatchCode",
			"billNo",
			"random",
		] as const) {
			if (record[field] !== undefined && !safeText(record[field], 512)) {
				throw new Error("outpatient-electronic-invoice-text-invalid");
			}
		}
		for (const field of ["pictureNetUrl", "pictureUrl"] as const) {
			if (record[field] !== undefined && !safeText(record[field])) {
				throw new Error("outpatient-electronic-invoice-resource-invalid");
			}
		}
		return record as unknown as OutpatientElectronicInvoiceRecord;
	});
}

function traceLogFields(
	trace: Pick<ExternalTrace, "requestId" | "requestIds">,
) {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

export type OutpatientElectronicInvoiceServiceDependencies = {
	repository: PatientRepository;
	query: OutpatientElectronicInvoiceQueryGateway;
	issue: OutpatientElectronicInvoiceGateway;
	resourceGateway?: OutpatientElectronicInvoiceResourceGateway;
	logger?: AppLogger;
	now?: () => Date;
};

export class OutpatientElectronicInvoiceService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: OutpatientElectronicInvoiceServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	private async resolve(ownerUserId: string, patientId: string) {
		if (
			!isBoundedOpaqueIdentifier(ownerUserId) ||
			!isBoundedOpaqueIdentifier(patientId)
		) {
			throw new OutpatientElectronicInvoiceQueryError();
		}
		const reference =
			await this.dependencies.repository.resolveProviderReference({
				ownerUserId,
				patientId,
				provider: "zhongyang",
				referenceKind: "his-patient",
			});
		if (
			!reference ||
			validatePatientProviderReference(reference, patientId) ||
			!isBoundedOpaqueIdentifier(reference.providerPatientId)
		) {
			throw new OutpatientElectronicInvoiceQueryError();
		}
		return reference.providerPatientId;
	}

	private async query(
		ownerUserId: string,
		patientId: string,
		context: AdapterCallContext,
	) {
		const providerPatientId = await this.resolve(ownerUserId, patientId);
		const result = await this.dependencies.query.listRecords(
			{
				providerPatientId,
				...queryWindow(this.now()),
				settleStatus: "4",
				pageNum: 1,
				pageSize: 500,
			},
			context,
		);
		const trace = normalizeExternalTrace(result?.trace, {
			expectedProvider: "zhongyang",
		});
		return {
			providerPatientId,
			records: validateQueryRecords(result?.records),
			trace,
		};
	}

	async list(
		ownerUserId: string,
		patientId: string,
		context: AdapterCallContext,
	) {
		const normalizedContext = normalizeAdapterCallContext(context);
		if (!normalizedContext) throw new OutpatientElectronicInvoiceQueryError();
		const result = await this.query(ownerUserId, patientId, normalizedContext);
		this.logger.info(
			{
				event: "outpatient.electronic-invoice.records.loaded",
				traceId: adapterContextTraceId(normalizedContext),
				businessType: "outpatient",
				capability: "electronic-invoice-records-read",
				...traceLogFields(result.trace),
				itemCount: result.records.length,
			},
			"Outpatient electronic invoice records loaded",
		);
		return {
			items: result.records.map((record) =>
				publicItem(ownerUserId, patientId, record),
			),
			total: result.records.length,
		};
	}

	async issue(input: {
		ownerUserId: string;
		patientId: string;
		recordId: string;
		payerType: OutpatientElectronicInvoicePayerType;
		context: AdapterCallContext;
	}) {
		const normalizedContext = normalizeAdapterCallContext(input.context);
		if (
			!normalizedContext ||
			!isBoundedOpaqueIdentifier(input.recordId) ||
			(input.payerType !== "1" && input.payerType !== "2")
		) {
			throw new OutpatientElectronicInvoiceQueryError();
		}
		const result = await this.query(
			input.ownerUserId,
			input.patientId,
			normalizedContext,
		);
		const record = result.records.find(
			(candidate) =>
				invoiceRecordId(input.ownerUserId, input.patientId, candidate) ===
				input.recordId,
		);
		if (!record) throw new OutpatientElectronicInvoiceRecordNotFoundError();
		// 2.6.17 已带电子票据号时视为已开具，重复点击不再次触发 2.6.29。
		// 这也是 Provider 未提供独立幂等语义时的第一道重复开票保护。
		if (record.billBatchCode && record.billNo) {
			return {
				recordId: input.recordId,
				invoice: publicIssuedInvoice({
					billBatchCode: record.billBatchCode,
					billNo: record.billNo,
					...(record.random ? { random: record.random } : {}),
					...(record.pictureNetUrl
						? { pictureNetUrl: record.pictureNetUrl }
						: {}),
					...(record.pictureUrl ? { pictureUrl: record.pictureUrl } : {}),
				}),
			};
		}
		const issued = await this.dependencies.issue.issue(
			{
				invoiceMainId: record.outInvoiceMainId,
				outSettleMainId: record.outSettleMainId,
				payerType: input.payerType,
			},
			normalizedContext,
		);
		this.logger.info(
			{
				event: "outpatient.electronic-invoice.issued",
				traceId: adapterContextTraceId(normalizedContext),
				businessType: "outpatient",
				capability: "electronic-invoice-issue",
				...traceLogFields(issued.trace),
			},
			"Outpatient electronic invoice issued",
		);
		return {
			recordId: input.recordId,
			invoice: publicIssuedInvoice(issued.invoice),
		};
	}

	/** 查看始终重新确认患者和票据归属；不调用 2.6.29 开票。 */
	async resource(
		ownerUserId: string,
		patientId: string,
		recordId: string,
		context: AdapterCallContext,
	): Promise<OutpatientElectronicInvoiceResourceContent> {
		const normalizedContext = normalizeAdapterCallContext(context);
		if (!normalizedContext || !isBoundedOpaqueIdentifier(recordId)) {
			throw new OutpatientElectronicInvoiceQueryError();
		}
		const result = await this.query(ownerUserId, patientId, normalizedContext);
		const record = result.records.find(
			(candidate) =>
				invoiceRecordId(ownerUserId, patientId, candidate) === recordId,
		);
		if (!record?.billBatchCode || !record.billNo) {
			throw new OutpatientElectronicInvoiceRecordNotFoundError();
		}
		if (!this.dependencies.resourceGateway) {
			throw new DependencyNotConfiguredError(
				"outpatient-electronic-invoice-resource",
			);
		}
		const content = await this.dependencies.resourceGateway.fetchResource(
			{
				...(record.pictureNetUrl
					? { pictureNetUrl: record.pictureNetUrl }
					: {}),
				...(record.pictureUrl ? { pictureUrl: record.pictureUrl } : {}),
			},
			normalizedContext,
		);
		if (
			!(content.body instanceof Uint8Array) ||
			content.body.byteLength === 0 ||
			content.body.byteLength > 8 * 1024 * 1024 ||
			!["image/png", "image/jpeg", "application/pdf"].includes(
				content.contentType,
			)
		) {
			throw new Error("outpatient-electronic-invoice-resource-invalid");
		}
		this.logger.info(
			{
				event: "outpatient.electronic-invoice.resource.loaded",
				traceId: adapterContextTraceId(normalizedContext),
				businessType: "outpatient",
				capability: "electronic-invoice-resource-read",
				...traceLogFields(result.trace),
				contentType: content.contentType,
				byteLength: content.body.byteLength,
			},
			"Outpatient electronic invoice resource loaded",
		);
		return { body: content.body, contentType: content.contentType };
	}
}

const AuthorizationHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(t.String({ maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const IssueHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.String({ minLength: 1, maxLength: 128 }),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const InvoiceQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
});

export function outpatientElectronicInvoicesModule(
	service: OutpatientElectronicInvoiceService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "outpatient-electronic-invoices-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/payments/outpatient/invoices",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				return success(
					await service.list(
						principal.userId,
						query.patientId,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AuthorizationHeaders,
				query: InvoiceQuery,
				response: { 200: OutpatientElectronicInvoiceListResponse },
				tags: ["payments"],
			},
		)
		.get(
			"/payments/outpatient/invoices/:recordId/resource",
			async ({ request, headers, params, query }) => {
				const principal = await authentication.get(request);
				const content = await service.resource(
					principal.userId,
					query.patientId,
					params.recordId,
					adapterContextFromHeaders(headers),
				);
				return new Response(Uint8Array.from(content.body).buffer, {
					headers: {
						"content-type": content.contentType,
						"content-disposition": "inline",
						"cache-control": "no-store",
						"x-content-type-options": "nosniff",
					},
				});
			},
			{
				headers: AuthorizationHeaders,
				query: InvoiceQuery,
				params: t.Object({
					recordId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				tags: ["payments"],
			},
		)
		.post(
			"/payments/outpatient/invoices/:recordId/issue",
			async ({ request, headers, params, body }) => {
				const principal = await authentication.get(request);
				return success(
					await service.issue({
						ownerUserId: principal.userId,
						recordId: params.recordId,
						patientId: body.patientId,
						payerType: body.payerType,
						context: adapterContextFromHeaders(headers),
					}),
				);
			},
			{
				headers: IssueHeaders,
				params: t.Object({
					recordId: t.String({ minLength: 1, maxLength: 128 }),
				}),
				body: t.Object({
					patientId: t.String({ minLength: 1, maxLength: 128 }),
					payerType: t.Union([t.Literal("1"), t.Literal("2")]),
				}),
				response: { 200: OutpatientElectronicInvoiceIssueResponse },
				tags: ["payments"],
			},
		);
}
