import { createHash } from "node:crypto";
import type {
	ReportDetailPayload,
	ReportListPayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	LaboratoryReportDetail,
	PatientRepository,
	ReportDetailGateway,
	ReportDirectoryEntry,
	ReportDirectoryGateway,
	ReportDirectoryQuery,
	ReportReference,
	ReportReferenceInput,
	ReportReferenceRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	InvalidReportKindError,
	isBoundedOpaqueIdentifier,
	isReportKind,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	normalizeLaboratoryReportDetail,
	normalizeReportDirectoryResults,
	parseIsoCalendarDate,
	REPORT_REFERENCE_MAX_TTL_MS,
	ReportResultValidationError,
	validatePatientProviderReference,
	validateReportDirectoryResultWindow,
	validateReportReference,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

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

/** 报告目录允许的最大自然日窗口；这是平台资源边界，不是 Provider 历史查询上限。 */
const MAX_REPORT_RANGE_DAYS = 366;
/** 报告详情引用是短期能力，避免 provider 资源引用长期留在平台库中。 */
const REPORT_REFERENCE_TTL_MS = Math.min(
	10 * 60 * 1000,
	REPORT_REFERENCE_MAX_TTL_MS,
);
/**
 * 报告目录短期引用的单次持久化并发上限。
 *
 * 详情引用是只读目录的可选增强，不应因为一份异常大的报告目录而一次性
 * 打满 MySQL 连接。这个数值是平台资源策略，不是 Provider 业务分页或
 * 报告数量上限；所有报告仍会尝试创建引用，结果顺序也保持不变。
 */
const REPORT_REFERENCE_CONCURRENCY = 4;

/**
 * 报告目录 service 的 canonical 查询字段。
 *
 * HTTP schema 会先做同样的限制，但内部回放、Worker 或组合根也能直接调用
 * service；未知字段必须拒绝，不能把旧端未确认的来源、渠道或患者参数静默
 * 丢弃后继续查询，避免调用方误以为完整意图已经生效。
 */
const REPORT_DIRECTORY_QUERY_FIELDS = new Set(["startDate", "endDate", "kind"]);

/**
 * 报告目录和详情共用调用上下文门禁。
 *
 * 报告 service 可能被回放任务或组合根直接调用；如果上下文只靠 HTTP
 * schema 保证，损坏的 trace/idempotency 会在 owner 映射、引用仓储或 Provider
 * 之后才暴露。统一先投影并拒绝未知字段，失败日志再读取安全 trace。
 */
function requireReportContext(value: unknown): AdapterCallContext {
	const normalized = normalizeAdapterCallContext(value);
	if (!normalized) {
		throw new ReportQueryError("Report call context is invalid");
	}
	return normalized;
}

/**
 * 以固定并发度映射目录项并保留输入顺序。
 *
 * 这里不能简单改成串行循环，否则一个慢引用会拖住整个目录；也不能继续
 * 使用无界 `Promise.all`，否则一次只读请求就可能制造大量并发写入。单项
 * mapper 的已知失败由调用方自行转换为安全摘要；若出现未预期异常，调度器
 * 会停止领取新任务并把异常交给外层统一处理，避免继续扩大一次失败请求的影响。
 */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let failed = false;
	let failure: unknown;

	const worker = async (): Promise<void> => {
		while (!failed) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			try {
				results[index] = await mapper(items[index] as T, index);
			} catch (error) {
				failed = true;
				failure = error;
				return;
			}
		}
	};

	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (failed) throw failure;
	return results;
}

/**
 * 将报告目录查询收敛为服务层可以安全读取的运行时形状。
 *
 * Elysia 的 HTTP query schema 只保护路由入口；组合根、回放任务或未来
 * Worker 直接调用 service 时仍可能绕过它。这里先拒绝 null、数组、缺少
 * 日期和非字符串 kind，避免在读取 `input.kind` 或日期解析时产生未映射
 * TypeError，也避免错误查询进入患者映射和 Provider 请求。
 */
function normalizeReportDirectoryQuery(value: unknown): ReportDirectoryQuery {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new ReportQueryError("Report query is invalid");
	}
	const record = value as Record<string, unknown>;
	/**
	 * HTTP 的 TypeBox schema 不是 service 的唯一输入边界。
	 *
	 * 组合根、回放任务或未来 Worker 可以直接调用 service；如果这里只
	 * 解构已知字段，调用方带入 `providerReportId`、`patientId` 等错误意图
	 * 时会被静默丢弃，随后仍以当前患者和日期发起报告查询。报告查询必须
	 * 明确拒绝未知字段，不能把“输入被忽略”伪装成“查询已按调用方意图执行”。
	 */
	if (
		Object.keys(record).some(
			(field) => !REPORT_DIRECTORY_QUERY_FIELDS.has(field),
		)
	) {
		throw new ReportQueryError("Report query contains an unknown field");
	}
	if (
		typeof record.startDate !== "string" ||
		typeof record.endDate !== "string"
	) {
		throw new ReportQueryError("Report query date range is invalid");
	}
	if (record.kind !== undefined && typeof record.kind !== "string") {
		throw new ReportQueryError("Report query kind is invalid");
	}
	const query: ReportDirectoryQuery = {
		startDate: record.startDate,
		endDate: record.endDate,
	};
	if (record.kind !== undefined) {
		// exactOptionalPropertyTypes 下不能把 `undefined` 写进可选字段；只有
		// 调用方确实提供 kind 时才写入，未知字符串仍交给枚举校验拒绝。
		query.kind = record.kind as Exclude<
			ReportDirectoryQuery["kind"],
			undefined
		>;
	}
	return query;
}

type ReportDetailReferenceViolation =
	| "reference-invalid"
	| "reference-scope-mismatch";

/**
 * 将单 Provider 与多 Provider 聚合 trace 统一投影为低敏日志字段。
 *
 * `providerRequestIds` 来自 domain 的有界运行时校验，不把原始响应或患者
 * 字段带入日志；保留兼容的 `providerRequestId` 方便现有检索脚本继续工作。
 */
function traceLogFields(trace: {
	requestId: string;
	requestIds?: readonly string[];
}): Record<string, unknown> {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

/**
 * 详情读取前的引用二次门禁。
 *
 * repository 的查询条件属于第一道 owner/patient 过滤，但缓存、历史脏数据
 * 或未来的其它实现仍可能返回错误记录。这里把“结构不合法”和“范围不一致”
 * 固定成有限原因，既能在 Provider 调用前 fail-closed，也不会把存储字段写进日志。
 */
function validateStoredDetailReference(
	reference: ReportReference,
	ownerUserId: string,
	patientId: string,
	reportId: string,
): ReportDetailReferenceViolation | undefined {
	try {
		validateReportReference(reference);
	} catch {
		return "reference-invalid";
	}
	if (
		reference.reportId !== reportId ||
		reference.ownerUserId !== ownerUserId ||
		reference.patientId !== patientId ||
		reference.provider !== "zhongyang" ||
		reference.kind !== "laboratory"
	) {
		return "reference-scope-mismatch";
	}
	return undefined;
}

/** reportId 只用于定位短期引用，不是 bearer token，也不替代 owner/patient 查询。 */
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
 * 指定报告来源时，响应中的每一条摘要都必须属于该来源。
 *
 * Provider adapter 会按来源选择接口，但 gateway 仍是可替换的运行时边界；
 * 回放数据或缓存错位不能把影像/心电报告混进检验查询。这里整批拒绝而不是
 * 过滤其它来源，避免返回一个看似成功但缺少真实数据的目录。
 */
function validateReportKindFilter(
	reports: readonly ReportDirectoryEntry[],
	query: ReportDirectoryQuery,
): void {
	if (
		query.kind !== undefined &&
		reports.some((report) => report.summary.kind !== query.kind)
	) {
		throw new ReportResultValidationError("report-kind-mismatch");
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
		let resultViolation: string | undefined;
		try {
			context = requireReportContext(context);
			// owner 是报告引用和 Provider 患者映射的授权根；不能因为 HTTP
			// 已从 session 解析 owner，就让 direct-call 绕过运行时形状校验。
			if (!isBoundedOpaqueIdentifier(ownerUserId)) {
				throw new ReportQueryError("Report owner identifier is invalid");
			}
			// 查询校验也必须进入统一失败出口。否则非法日期虽然会正确返回
			// 400，但没有 `report.directory.failed`，日志链路会缺少业务模块事实。
			const normalizedQuery = normalizeReportDirectoryQuery(query);
			validateQuery(normalizedQuery);
			if (!isBoundedOpaqueIdentifier(patientId)) {
				throw new ReportQueryError("Report patient identifier is invalid");
			}

			this.logger.info(
				{
					event: "report.directory.requested",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					patientId,
					...(normalizedQuery.kind ? { kind: normalizedQuery.kind } : {}),
					startDate: normalizedQuery.startDate,
					endDate: normalizedQuery.endDate,
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
			// 仓储返回值仍是跨层运行时数据，不能只依赖 PatientProviderReference
			// 的编译期类型。发现结构或范围异常时，在 Provider 调用前 fail-closed，
			// 对客户端继续使用与“没有映射”相同的安全语义。
			const referenceViolation = validatePatientProviderReference(
				reference,
				patientId,
			);
			if (referenceViolation) {
				resultViolation = referenceViolation;
				throw new ReportPatientNotFoundError();
			}

			const result = await this.dependencies.directory.listReports(
				{
					// 受限引用只存在此调用帧内；不得写入日志或 API payload。
					providerPatientId: reference.providerPatientId,
					query: normalizedQuery,
				},
				context,
			);
			const trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			let normalizedReports: ReportDirectoryEntry[];
			try {
				normalizedReports = normalizeReportDirectoryResults(
					(result as { reports?: unknown } | undefined)?.reports,
				);
				validateReportKindFilter(normalizedReports, normalizedQuery);
				validateReportDirectoryResultWindow(normalizedReports, normalizedQuery);
			} catch (error) {
				if (error instanceof ReportResultValidationError) {
					resultViolation = error.violation;
				}
				if (error instanceof ExternalTraceReadModelValidationError) {
					resultViolation = error.violation;
				}
				throw error;
			}
			// 一次目录响应代表同一个 provider 观察快照；所有短期详情引用必须
			// 使用同一个服务端时间样本计算 TTL。若在每条报告上分别读取时钟，
			// 批量处理跨过时间边界时会产生不同的 expiresAt，甚至让同一批刚返回
			// 的报告出现“一个可点、一个已过期”的不可解释结果。
			const observedNow = this.now();
			const items = await mapWithConcurrency(
				normalizedReports,
				REPORT_REFERENCE_CONCURRENCY,
				async (entry) => {
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
						const referenceInput: ReportReferenceInput = {
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
						};
						const reference =
							await this.dependencies.references.upsert(referenceInput);
						// 仓储返回值仍是跨层边界，不能只相信 TypeScript 类型。若实现
						// 返回了另一位患者、另一位 owner、另一个 Provider 报告引用或
						// 不同的时间窗口，必须隐藏详情入口并保留安全摘要，不能把错误引用
						// 交给客户端。尤其不能只调用 validateReportReference：它只能证明
						// 返回引用自身的 TTL 不超过硬上限，不能证明仓储没有把本次 10 分钟
						// 能力延长成另一段更长或更晚的有效窗口。
						validateReportReference(reference);
						if (
							reference.reportId !== referenceInput.reportId ||
							reference.ownerUserId !== referenceInput.ownerUserId ||
							reference.patientId !== referenceInput.patientId ||
							reference.provider !== referenceInput.provider ||
							reference.kind !== referenceInput.kind ||
							reference.providerReportId !== referenceInput.providerReportId ||
							reference.createdAt !== referenceInput.createdAt ||
							reference.expiresAt !== referenceInput.expiresAt
						) {
							throw new Error(
								"Report reference repository returned a mismatched scope or window",
							);
						}
						return { reportId: reference.reportId, ...entry.summary };
					} catch (error) {
						// 详情引用是可选的增强能力：单条引用持久化失败时，
						// 必须隐藏详情入口但保留目录摘要，避免把数据库短暂抖动
						// 错误地展示成“患者没有报告”。Provider 聚合本身的失败
						// 仍由外层 catch 处理，继续保持整批 fail-closed。
						this.logger.warn(
							{
								event: "report.detail_reference.failed",
								traceId: adapterContextTraceId(context),
								provider: trace.provider,
								...traceLogFields(trace),
								patientId,
								errorType: error instanceof Error ? error.name : "unknown",
							},
							"Report detail reference unavailable; summary retained",
						);
						return entry.summary;
					}
				},
			);
			this.logger.info(
				{
					event: "report.directory.synced",
					traceId: adapterContextTraceId(context),
					provider: trace.provider,
					...traceLogFields(trace),
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
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
					...(error instanceof ExternalTraceReadModelValidationError
						? { resultViolation: error.violation }
						: {}),
					...(resultViolation ? { resultViolation } : {}),
					...providerFailureMetadata(error),
				},
				"Report directory request failed",
			);
			throw error;
		}
	}

	async detail(
		ownerUserId: string,
		patientId: string,
		reportId: string,
		context: AdapterCallContext,
	): Promise<ReportDetailPayload["data"]> {
		let resultViolation: string | undefined;
		try {
			context = requireReportContext(context);
			// 详情引用必须同时绑定 owner、patient 和 reportId；先校验 owner
			// 的形状，避免非法值进入引用仓储或成为错误的授权条件。
			if (!isBoundedOpaqueIdentifier(ownerUserId)) {
				throw new ReportQueryError("Report owner identifier is invalid");
			}
			if (!isBoundedOpaqueIdentifier(patientId)) {
				throw new ReportQueryError("Report patient identifier is invalid");
			}
			if (!isBoundedOpaqueIdentifier(reportId)) {
				throw new ReportQueryError("Report reference identifier is invalid");
			}
			// 详情依赖缺失也必须留在 `report.detail.failed` 中；否则页面拿到
			// `dependency-not-configured` 时，服务日志会看起来像没有收到请求。
			this.logger.info(
				{
					event: "report.detail.requested",
					traceId: adapterContextTraceId(context),
					patientId,
					reportId,
				},
				"Report detail requested",
			);
			if (!this.dependencies.detail || !this.dependencies.references) {
				throw new DependencyNotConfiguredError("report-detail");
			}

			// reportId 本身只是不透明定位符，不能单独承担患者授权。
			// 这里再次绑定 owner 和当前就诊人，即使旧页面栈或手工请求带入
			// 另一个患者的 reportId，也只能得到“详情不存在”，不会访问 Provider。
			const reference =
				await this.dependencies.references.findByOwnerPatientAndId(
					ownerUserId,
					patientId,
					reportId,
					this.now().toISOString(),
				);
			if (reference?.kind !== "laboratory") {
				throw new ReportNotFoundError();
			}
			// 仓储查询已经按 owner/patient/reportId 加了条件，但它仍是跨层返回值，
			// 不能把 SQL 条件当成唯一授权证明。这里再次校验引用完整性和范围，
			// 防止错误实现、历史脏数据或未来缓存层把别的患者 providerReportId
			// 送进详情 Provider；一旦不一致，必须在 Provider 调用前结束。
			const referenceViolation = validateStoredDetailReference(
				reference,
				ownerUserId,
				patientId,
				reportId,
			);
			if (referenceViolation) {
				// 对客户端统一收敛为“详情不可用”，不暴露存储层究竟是哪一列
				// 损坏；有限原因只进入低敏服务日志，便于定位数据或缓存问题。
				resultViolation = referenceViolation;
				throw new ReportNotFoundError();
			}
			const result = await this.dependencies.detail.getLaboratoryDetail(
				{ providerReportId: reference.providerReportId },
				context,
			);
			const trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			let normalizedDetail: LaboratoryReportDetail;
			try {
				normalizedDetail = normalizeLaboratoryReportDetail(
					(result as { detail?: unknown } | undefined)?.detail,
				);
			} catch (error) {
				if (error instanceof ReportResultValidationError) {
					resultViolation = error.violation;
				}
				if (error instanceof ExternalTraceReadModelValidationError) {
					resultViolation = error.violation;
				}
				throw error;
			}
			this.logger.info(
				{
					event: "report.detail.synced",
					traceId: adapterContextTraceId(context),
					patientId,
					reportId,
					...traceLogFields(trace),
					itemCount: normalizedDetail.items.length,
				},
				"Report detail loaded",
			);
			return {
				reportId,
				...normalizedDetail,
				items: [...normalizedDetail.items],
			};
		} catch (error) {
			this.logger.error(
				{
					event: "report.detail.failed",
					traceId: adapterContextTraceId(context),
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					reportId: isBoundedOpaqueIdentifier(reportId) ? reportId : "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
					...(error instanceof ExternalTraceReadModelValidationError
						? { resultViolation: error.violation }
						: {}),
					...(resultViolation ? { resultViolation } : {}),
					...providerFailureMetadata(error),
				},
				"Report detail request failed",
			);
			throw error;
		}
	}
}
