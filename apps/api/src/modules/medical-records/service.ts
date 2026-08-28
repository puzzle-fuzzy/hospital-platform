import type { OutpatientMedicalRecordListPayload } from "@hospital/contracts";
import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientMedicalRecordGateway,
	OutpatientMedicalRecordQuery,
	PatientRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	normalizeOutpatientMedicalRecords,
	parseIsoCalendarDate,
	validateMedicalRecordProviderReference,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

export type OutpatientMedicalRecordServiceDependencies = {
	repository: PatientRepository;
	directory: OutpatientMedicalRecordGateway;
	logger?: AppLogger;
};

export class MedicalRecordQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MedicalRecordQueryError";
	}
}

export class MedicalRecordPatientNotFoundError extends Error {
	constructor() {
		super("Medical record patient is not available");
		this.name = "MedicalRecordPatientNotFoundError";
	}
}

function requireContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context)
		throw new MedicalRecordQueryError("Medical record context is invalid");
	return context;
}

function validateQuery(value: unknown): OutpatientMedicalRecordQuery {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new MedicalRecordQueryError("Medical record query is invalid");
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(field) => field !== "startDate" && field !== "endDate",
		) ||
		typeof record.startDate !== "string" ||
		typeof record.endDate !== "string" ||
		parseIsoCalendarDate(record.startDate) === undefined ||
		parseIsoCalendarDate(record.endDate) === undefined ||
		record.startDate > record.endDate
	) {
		throw new MedicalRecordQueryError("Medical record date range is invalid");
	}
	const start = parseIsoCalendarDate(record.startDate);
	const end = parseIsoCalendarDate(record.endDate);
	if (start === undefined || end === undefined) {
		throw new MedicalRecordQueryError("Medical record date range is invalid");
	}
	// 原版只读页面固定查询近 30 天；服务端再次限制，防止其它调用方
	// 把门诊病历接口变成无限历史导出端点。
	if (end - start > 30 * 86_400_000) {
		throw new MedicalRecordQueryError("Medical record date range is too large");
	}
	return { startDate: record.startDate, endDate: record.endDate };
}

/** 门诊病历的 Provider trace 只允许固定字段进入日志。 */
function traceLogFields(trace: ExternalTrace) {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

export class OutpatientMedicalRecordService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: OutpatientMedicalRecordServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	/**
	 * 查询当前 owner 明确选择的门诊病历摘要。
	 *
	 * 先解析 owner-scoped 的 `his-patient` 引用，再调用 Provider；病历接口
	 * 不接受客户端提交的 patId，也不把 Provider 主键、原始姓名或身份证
	 * 写进日志和响应。
	 */
	async list(
		ownerUserId: string,
		patientId: string,
		query: OutpatientMedicalRecordQuery,
		context: AdapterCallContext,
	): Promise<OutpatientMedicalRecordListPayload["data"]> {
		let trace: ExternalTrace | undefined;
		try {
			const normalizedContext = requireContext(context);
			if (
				!isBoundedOpaqueIdentifier(ownerUserId) ||
				!isBoundedOpaqueIdentifier(patientId)
			) {
				throw new MedicalRecordQueryError(
					"Medical record owner or patient is invalid",
				);
			}
			const normalizedQuery = validateQuery(query);
			this.logger.info(
				{
					event: "medical.records.requested",
					traceId: adapterContextTraceId(normalizedContext),
					provider: "zhongyang",
					patientId,
					startDate: normalizedQuery.startDate,
					endDate: normalizedQuery.endDate,
				},
				"Outpatient medical records requested",
			);

			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
					referenceKind: "his-patient",
				});
			if (
				!reference ||
				!validateMedicalRecordProviderReference(reference, patientId)
			) {
				throw new MedicalRecordPatientNotFoundError();
			}

			const result = await this.dependencies.directory.listRecords(
				{
					providerPatientId: reference.providerPatientId,
					query: normalizedQuery,
				},
				normalizedContext,
			);
			trace = normalizeExternalTrace(result?.trace, {
				expectedProvider: "zhongyang",
			});
			const items = normalizeOutpatientMedicalRecords(result?.records);
			this.logger.info(
				{
					event: "medical.records.loaded",
					traceId: adapterContextTraceId(normalizedContext),
					provider: trace.provider,
					...traceLogFields(trace),
					patientId,
					itemCount: items.length,
				},
				"Outpatient medical records loaded",
			);
			return { items, total: items.length };
		} catch (error) {
			this.logger.error(
				{
					event: "medical.records.failed",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
					...providerFailureMetadata(error),
					...(trace ? traceLogFields(trace) : {}),
				},
				"Outpatient medical records request failed",
			);
			throw error;
		}
	}
}
