import { createHash } from "node:crypto";
import type {
	ReportDetailPayload,
	ReportListPayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	PatientRepository,
	ReportDetailGateway,
	ReportDirectoryGateway,
	ReportDirectoryQuery,
	ReportReferenceRepository,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	InvalidReportKindError,
	isBoundedOpaqueIdentifier,
	isReportKind,
	parseIsoCalendarDate,
	REPORT_REFERENCE_MAX_TTL_MS,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type ReportServiceDependencies = {
	repository: PatientRepository;
	directory: ReportDirectoryGateway;
	/** 详情 gate 打开时才由组合根提供短期引用仓储。 */
	references?: ReportReferenceRepository;
	/** 当前只实现 LIS 详情；PACS/ECG 仍不通过此端口。 */
	detail?: ReportDetailGateway;
	logger?: AppLogger;
	/**
	 * 统一报告引用的观察时间；生产使用服务端时钟，测试注入固定时间。
	 *
	 * 报告目录和详情查询必须使用同一时间基准，否则目录刚生成的引用
	 * 可能在详情查询时被另一台机器的本地时钟提前判定为过期。
	 */
	now?: () => Date;
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
	if (input.kind !== undefined && !isReportKind(input.kind)) {
		throw new InvalidReportKindError();
	}
	const start = parseIsoCalendarDate(input.startDate);
	const end = parseIsoCalendarDate(input.endDate);
	// 当前 API 限制的是起止日期 UTC 零点的时间跨度，而不是“首尾都计入的
	// 日期数量”。provider 对 endDate 的包含规则必须等拿到合同后再冻结。
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
	private readonly now: () => Date;

	constructor(private readonly dependencies: ReportServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	async list(
		ownerUserId: string,
		patientId: string,
		query: ReportDirectoryQuery,
		context: AdapterCallContext,
	): Promise<ReportListPayload["data"]> {
		try {
			// 查询校验也必须进入统一失败出口。否则非法日期虽然会正确返回
			// 400，但没有 `report.directory.failed`，日志链路会缺少业务模块事实。
			validateQuery(query);
			if (!isBoundedOpaqueIdentifier(patientId)) {
				throw new ReportQueryError("Report patient identifier is invalid");
			}

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

			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
					// 报告 provider 与旧端一致，使用 patInfosFind 返回的 HIS patId。
					referenceKind: "his-patient",
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
			// 一次目录响应代表同一个 provider 观察快照；所有短期详情引用必须
			// 使用同一个服务端时间样本计算 TTL。若在每条报告上分别读取时钟，
			// 批量处理跨过时间边界时会产生不同的 expiresAt，甚至让同一批刚返回
			// 的报告出现“一个可点、一个已过期”的不可解释结果。
			const observedNow = this.now();
			const items = await Promise.all(
				result.reports.map(async (entry) => {
					if (
						!this.dependencies.detail ||
						entry.summary.kind !== "laboratory" ||
						!entry.providerReportId ||
						!this.dependencies.references
					) {
						// 目录摘要和详情引用是两个独立能力：provider 没有稳定报告号、
						// 详情 gate 未开启或引用仓储未注入时，仍应保留安全摘要，
						// 不能把“详情不可用”扩大成“整批报告不可用”。
						return entry.summary;
					}
					try {
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
								observedNow.getTime() + REPORT_REFERENCE_TTL_MS,
							).toISOString(),
							createdAt: observedNow.toISOString(),
						});
						return { reportId: reference.reportId, ...entry.summary };
					} catch (error) {
						// 详情引用是可选的增强能力：单条引用持久化失败时，
						// 必须隐藏详情入口但保留目录摘要，避免把数据库短暂抖动
						// 错误地展示成“患者没有报告”。Provider 聚合本身的失败
						// 仍由外层 catch 处理，继续保持整批 fail-closed。
						this.logger.warn(
							{
								event: "report.detail_reference.failed",
								traceId: context.traceId,
								provider: result.trace.provider,
								providerRequestId: result.trace.requestId,
								patientId,
								errorType: error instanceof Error ? error.name : "unknown",
							},
							"Report detail reference unavailable; summary retained",
						);
						return entry.summary;
					}
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
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
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
		try {
			if (!isBoundedOpaqueIdentifier(reportId)) {
				throw new ReportQueryError("Report reference identifier is invalid");
			}
			// 详情依赖缺失也必须留在 `report.detail.failed` 中；否则页面拿到
			// `dependency-not-configured` 时，服务日志会看起来像没有收到请求。
			this.logger.info(
				{
					event: "report.detail.requested",
					traceId: context.traceId,
					reportId,
				},
				"Report detail requested",
			);
			if (!this.dependencies.detail || !this.dependencies.references) {
				throw new DependencyNotConfiguredError("report-detail");
			}

			const reference = await this.dependencies.references.findByOwnerAndId(
				ownerUserId,
				reportId,
				this.now().toISOString(),
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
					reportId: isBoundedOpaqueIdentifier(reportId) ? reportId : "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Report detail request failed",
			);
			throw error;
		}
	}
}
