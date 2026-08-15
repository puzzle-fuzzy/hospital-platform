import type {
	ReportDetailPayload,
	ReportListPayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	PatientRepository,
	ReportDetailGateway,
	ReportDirectoryGateway,
	ReportReferenceRepository,
	ReportDirectoryQuery,
} from "@hospital/domain";
import { createHash } from "node:crypto";
import {
	DependencyNotConfiguredError,
	parseIsoCalendarDate,
	REPORT_REFERENCE_MAX_TTL_MS,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export type ReportServiceDependencies = {
	repository: PatientRepository;
	directory: ReportDirectoryGateway;
	/** 详情 gate 打开时才由组合根提供短期引用仓储。 */
	references?: ReportReferenceRepository;
	/** 当前只实现 LIS 详情；PACS/ECG 仍不通过此端口。 */
	detail?: ReportDetailGateway;
	logger?: AppLogger;
};

export class ReportQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ReportQueryError";
	}
}

export class ReportPatientNotFoundError extends Error {
	constructor() {
		super("Report patient is not available");
		this.name = "ReportPatientNotFoundError";
	}
}

export class ReportNotFoundError extends Error {
	constructor() {
		super("Report reference is not available");
		this.name = "ReportNotFoundError";
	}
}

const MAX_REPORT_RANGE_DAYS = 366;
/** 报告详情引用是短期能力，避免 provider 资源引用长期留在平台库中。 */
const REPORT_REFERENCE_TTL_MS = Math.min(
	10 * 60 * 1000,
	REPORT_REFERENCE_MAX_TTL_MS,
);

/** reportId 只用于定位服务端记录，不是 bearer token，也不替代 owner 查询。 */
function reportReferenceId(
	ownerUserId: string,
	patientId: string,
	providerReportId: string,
): string {
	return `report_${createHash("sha256")
		.update(
			`${ownerUserId}\0${patientId}\0zhongyang\0laboratory\0${providerReportId}`,
		)
		.digest("hex")
		.slice(0, 48)}`;
}

function validateQuery(input: ReportDirectoryQuery): void {
	const start = parseIsoCalendarDate(input.startDate);
	const end = parseIsoCalendarDate(input.endDate);
	const maxRangeMs = MAX_REPORT_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (start === undefined || end === undefined || end < start) {
		throw new ReportQueryError("Report date range is invalid");
	}
	if (end - start > maxRangeMs) {
		throw new ReportQueryError(
			`Report date range cannot exceed ${MAX_REPORT_RANGE_DAYS} days`,
		);
	}
}

/**
 * 报告目录应用服务。
 *
 * 客户端只提交平台 patientId；这里先按 token 所属 owner 解析 provider 引用，
 * 再调用 adapter。providerPatientId 绝不进入日志、contract 或返回值。
 */
export class ReportService {
	private readonly logger: AppLogger;

	constructor(private readonly dependencies: ReportServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async list(
		ownerUserId: string,
		patientId: string,
		query: ReportDirectoryQuery,
		context: AdapterCallContext,
	): Promise<ReportListPayload["data"]> {
		validateQuery(query);
		if (!patientId.trim()) throw new ReportPatientNotFoundError();

		this.logger.info(
			{
				event: "report.directory.requested",
				traceId: context.traceId,
				provider: "zhongyang",
				patientId,
				...(query.kind ? { kind: query.kind } : {}),
				startDate: query.startDate,
				endDate: query.endDate,
			},
			"Report directory requested",
		);

		try {
			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
				});
			if (!reference) throw new ReportPatientNotFoundError();

			const result = await this.dependencies.directory.listReports(
				{
					// 受限引用只存在此调用帧内；不得写入日志或 API payload。
					providerPatientId: reference.providerPatientId,
					query,
				},
				context,
			);
			const items = await Promise.all(
				result.reports.map(async (entry) => {
					if (
						!this.dependencies.detail ||
						entry.summary.kind !== "laboratory"
					) {
						return entry.summary;
					}
					if (!entry.providerReportId || !this.dependencies.references) {
						throw new DependencyNotConfiguredError("report-references");
					}
					const now = new Date();
					const reference = await this.dependencies.references.upsert({
						reportId: reportReferenceId(
							ownerUserId,
							patientId,
							entry.providerReportId,
						),
						ownerUserId,
						patientId,
						provider: "zhongyang",
						kind: "laboratory",
						providerReportId: entry.providerReportId,
						expiresAt: new Date(
							now.getTime() + REPORT_REFERENCE_TTL_MS,
						).toISOString(),
						createdAt: now.toISOString(),
					});
					return { reportId: reference.reportId, ...entry.summary };
				}),
			);
			this.logger.info(
				{
					event: "report.directory.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					patientId,
					itemCount: items.length,
				},
				"Report directory loaded",
			);
			return { items, total: items.length };
		} catch (error) {
			this.logger.error(
				{
					event: "report.directory.failed",
					traceId: context.traceId,
					provider: "zhongyang",
					patientId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Report directory request failed",
			);
			throw error;
		}
	}

	async detail(
		ownerUserId: string,
		reportId: string,
		context: AdapterCallContext,
	): Promise<ReportDetailPayload["data"]> {
		if (!this.dependencies.detail || !this.dependencies.references) {
			throw new DependencyNotConfiguredError("report-detail");
		}
		this.logger.info(
			{
				event: "report.detail.requested",
				traceId: context.traceId,
				reportId,
			},
			"Report detail requested",
		);
		try {
			const reference = await this.dependencies.references.findByOwnerAndId(
				ownerUserId,
				reportId,
				new Date().toISOString(),
			);
			if (reference?.kind !== "laboratory") {
				throw new ReportNotFoundError();
			}
			const result = await this.dependencies.detail.getLaboratoryDetail(
				{ providerReportId: reference.providerReportId },
				context,
			);
			this.logger.info(
				{
					event: "report.detail.synced",
					traceId: context.traceId,
					reportId,
					providerRequestId: result.trace.requestId,
					itemCount: result.detail.items.length,
				},
				"Report detail loaded",
			);
			return { reportId, ...result.detail, items: [...result.detail.items] };
		} catch (error) {
			this.logger.error(
				{
					event: "report.detail.failed",
					traceId: context.traceId,
					reportId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Report detail request failed",
			);
			throw error;
		}
	}
}
