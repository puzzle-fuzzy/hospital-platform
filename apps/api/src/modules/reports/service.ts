import type { ReportListPayload } from "@hospital/contracts";
import type {
	AdapterCallContext,
	PatientRepository,
	ReportDirectoryGateway,
	ReportDirectoryQuery,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export type ReportServiceDependencies = {
	repository: PatientRepository;
	directory: ReportDirectoryGateway;
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

const MAX_REPORT_RANGE_DAYS = 366;

function validateQuery(input: ReportDirectoryQuery): void {
	if (
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.startDate) ||
		!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(input.endDate)
	) {
		throw new ReportQueryError("Report date range is invalid");
	}
	const start = Date.parse(`${input.startDate}T00:00:00.000Z`);
	const end = Date.parse(`${input.endDate}T00:00:00.000Z`);
	const maxRangeMs = MAX_REPORT_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
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
			this.logger.info(
				{
					event: "report.directory.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					patientId,
					itemCount: result.reports.length,
				},
				"Report directory loaded",
			);
			return { items: [...result.reports], total: result.reports.length };
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
}
