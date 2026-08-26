import { parseIsoCalendarDate } from "./date-range";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 当前已取得安全查询边界的报告来源；体检报告需要额外身份证合同，暂不纳入。 */
export type ReportKind = "laboratory" | "imaging" | "ecg";

/**
 * 报告来源查询的运行时边界错误。
 *
 * HTTP query schema 会拦截普通外部请求，但内部任务和 adapter 仍可能绕过
 * Elysia 进入领域层。未知来源不能落入 adapter 的默认 ECG 分支，否则查询
 * 语义会被静默改变，必须在 Provider 请求前直接拒绝。
 */
export class InvalidReportKindError extends Error {
	constructor() {
		super("Invalid report kind");
		this.name = "InvalidReportKindError";
	}
}

/** 供报告 service 与 adapter 共用的来源白名单守卫。 */
export function isReportKind(value: unknown): value is ReportKind {
	return value === "laboratory" || value === "imaging" || value === "ecg";
}

/** 报告目录只返回患者端需要的最小摘要，不把 provider 原始报文带出 adapter。 */
export type ReportSummary = {
	kind: ReportKind;
	title: string;
	reportedAt: string;
	status: "available" | "abnormal";
	hasAttachment: boolean;
};

/**
 * provider 目录项的服务端内部形态。
 *
 * 只有 LIS 当前取得了详情字段合同，因此只有检验摘要可以携带
 * providerReportId。影像/心电即使 provider 返回了报告号，也必须在 adapter
 * 边界丢弃；这样未来新增详情路由时，类型系统不会允许它们被误当成可查详情。
 * providerReportId 不能直接复用 ReportSummary 作为 HTTP response，避免报告
 * 详情凭证意外泄漏到小程序。
 */
type ReportSummaryForKind<K extends ReportKind> = Omit<
	ReportSummary,
	"kind"
> & {
	kind: K;
};

export type ReportDirectoryEntry =
	| {
			summary: ReportSummaryForKind<"laboratory">;
			providerReportId?: string;
	  }
	| {
			summary: ReportSummaryForKind<"imaging" | "ecg">;
			/** 非 LIS 来源禁止携带 provider 报告号。 */
			providerReportId?: never;
	  };

export type ReportDirectoryQuery = {
	startDate: string;
	endDate: string;
	kind?: ReportKind;
};

/** 服务端先解析 provider 患者号，再把受限引用交给报告 adapter。 */
export type ReportDirectoryInput = {
	providerPatientId: string;
	query: ReportDirectoryQuery;
};

/**
 * 报告目录和 LIS 明细的单次资源上限。
 *
 * 这是平台资源防护，不是患者实际报告数量上限，也不是 Provider 分页契约。
 * 报告目录超量时不能截断后继续生成短期详情引用；明细超量时不能让异常
 * 响应放大内存、序列化和页面渲染。Provider 分页契约确认后再设计有界合并。
 */
export const MAX_REPORT_DIRECTORY_ITEMS = 512;
export const MAX_REPORT_DETAIL_ITEMS = 1024;

/** 服务端短期报告引用；provider id 永远不进入客户端，也不是授权凭证。 */
export type ReportReference = {
	reportId: string;
	ownerUserId: string;
	patientId: string;
	provider: "zhongyang";
	kind: "laboratory";
	providerReportId: string;
	expiresAt: string;
	createdAt: string;
};

export type ReportReferenceInput = Omit<ReportReference, "createdAt"> & {
	createdAt?: string;
};

/** 报告 provider 引用的持久化硬上限；业务服务使用更短的 10 分钟 TTL。 */
export const REPORT_REFERENCE_MAX_TTL_MS = 15 * 60 * 1000;

export type ReportReferenceValidationReason =
	| "invalid_reference"
	| "invalid_owner"
	| "invalid_window";

export class ReportReferenceValidationError extends Error {
	readonly reason: ReportReferenceValidationReason;

	constructor(reason: ReportReferenceValidationReason) {
		super(`Invalid report reference: ${reason}`);
		this.name = "ReportReferenceValidationError";
		this.reason = reason;
	}
}

/**
 * 报告引用是跨请求的安全边界，不能只依赖 MySQL VARCHAR/FOREIGN KEY。
 * 该校验同时被内存和 MySQL repository 调用，保证 fixture 不会放宽生产语义。
 */
export function validateReportReference(input: ReportReferenceInput): void {
	const references = [
		{ value: input.reportId, maxLength: 128 },
		{ value: input.patientId, maxLength: 64 },
		{ value: input.providerReportId, maxLength: 256 },
	];
	if (
		references.some(
			({ value, maxLength }) =>
				typeof value !== "string" ||
				value.trim().length === 0 ||
				value.length > maxLength ||
				value !== value.trim() ||
				Array.from(value).some((character) => {
					const code = character.charCodeAt(0);
					return code <= 0x1f || code === 0x7f;
				}),
		)
	) {
		// 引用会落库并参与后续 owner-scoped 查询；控制字符会破坏数据库
		// 检索、日志关联和 provider 请求边界，必须在 persistence 前 fail-closed。
		throw new ReportReferenceValidationError("invalid_reference");
	}
	// ownerUserId 来自会话通常不代表所有调用方都可信；例如回放任务、
	// 测试替身或未来 Worker 都可能直接构造引用。必须复用平台 opaque
	// 标识守卫，拒绝控制字符、首尾空白和空值，才能把 owner 隔离带到
	// repository 查询与日志链路的下一层。
	if (
		input.provider !== "zhongyang" ||
		input.kind !== "laboratory" ||
		!isBoundedOpaqueIdentifier(input.ownerUserId) ||
		input.ownerUserId.length > 64
	) {
		throw new ReportReferenceValidationError("invalid_owner");
	}
	const createdAt = Date.parse(input.createdAt ?? new Date().toISOString());
	const expiresAt = Date.parse(input.expiresAt);
	if (
		!Number.isFinite(createdAt) ||
		!Number.isFinite(expiresAt) ||
		expiresAt <= createdAt ||
		expiresAt - createdAt > REPORT_REFERENCE_MAX_TTL_MS
	) {
		throw new ReportReferenceValidationError("invalid_window");
	}
}

/**
 * 报告引用必须同时按 owner、patient 和 reportId 查询，并在过期后视为不存在。
 *
 * reportId 是短期 opaque 引用，不是独立授权凭证；即使同一个用户拥有多个
 * 就诊人，也不能只凭 reportId 跨患者读取另一条报告引用。
 */
export interface ReportReferenceRepository {
	upsert(input: ReportReferenceInput): Promise<ReportReference>;
	findByOwnerPatientAndId(
		ownerUserId: string,
		patientId: string,
		reportId: string,
		now: string,
	): Promise<ReportReference | undefined>;
}

export type ReportDetailFlag =
	| "normal"
	| "high"
	| "low"
	| "critical"
	| "unknown";

/** LIS 详情白名单；不包含姓名、身份证、provider URL 或原始字段。 */
export type LaboratoryReportDetailItem = {
	name: string;
	result: string;
	unit?: string;
	referenceRange?: string;
	flag: ReportDetailFlag;
};

/** 当前只对 LIS 取得了可审计的详情字段合同，PACS/ECG 仍保持目录级别。 */
export type LaboratoryReportDetail = {
	kind: "laboratory";
	title: string;
	reportedAt: string;
	items: readonly LaboratoryReportDetailItem[];
	hasAttachment: boolean;
};

/**
 * 报告网关读模型违反公共 contract 时使用的低敏原因。
 *
 * adapter 是第一道 Provider 白名单边界，但目录和详情 gateway 仍然是可
 * 注入端口，回放实现、任务实现或未来替换的真实网关都不能仅凭 TypeScript
 * 类型被 service 当作可信事实。原因固定为有限枚举，日志可以检索，错误响应
 * 不需要携带 Provider 原文、患者字段或报告号。
 */
export type ReportResultViolation =
	| "reports-not-array"
	| "reports-too-many"
	| "report-not-object"
	| "summary-not-object"
	| "kind-invalid"
	| "report-kind-mismatch"
	| "title-invalid"
	| "reported-at-invalid"
	| "reported-at-outside-query"
	| "status-invalid"
	| "attachment-invalid"
	| "provider-report-id-invalid"
	| "provider-report-id-forbidden"
	| "provider-report-id-duplicate"
	| "detail-not-object"
	| "detail-kind-invalid"
	| "detail-title-invalid"
	| "detail-reported-at-invalid"
	| "detail-items-not-array"
	| "detail-items-too-many"
	| "detail-item-not-object"
	| "detail-field-invalid"
	| "detail-attachment-invalid";

/** Provider 返回的报告读模型不完整或越过了服务端安全边界。 */
export class ReportResultValidationError extends Error {
	readonly violation: ReportResultViolation;

	constructor(violation: ReportResultViolation) {
		super("Report provider result is invalid");
		this.name = "ReportResultValidationError";
		this.violation = violation;
	}
}

function hasSafeReportText(value: unknown, maxLength: number): value is string {
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

function invalidReportResult(violation: ReportResultViolation): never {
	throw new ReportResultValidationError(violation);
}

function optionalReportText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!hasSafeReportText(value, maxLength)) {
		invalidReportResult("detail-field-invalid");
	}
	return value;
}

/**
 * 校验并重新投影报告目录读模型。
 *
 * 不能直接把 gateway 返回的 `reports` 浅拷贝给 API：运行时对象即使被
 * TypeScript 标注为 `ReportDirectoryEntry`，仍可能携带患者姓名、身份证、
 * Provider URL 或其它未审计字段。这里整批校验后只构造公共摘要；任何坏项、
 * 非 LIS 详情号或重复详情号都会拒绝整批，不能过滤坏行伪装成成功。
 */
export function normalizeReportDirectoryResults(
	value: unknown,
): ReportDirectoryEntry[] {
	if (!Array.isArray(value)) invalidReportResult("reports-not-array");
	if (value.length > MAX_REPORT_DIRECTORY_ITEMS) {
		// 不能 slice：被截断的报告目录可能继续生成部分快照引用，
		// 让患者误以为不存在未返回的报告。
		invalidReportResult("reports-too-many");
	}
	const providerReportIds = new Set<string>();

	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidReportResult("report-not-object");
		}
		const record = item as Record<string, unknown>;
		const rawSummary = record.summary;
		if (
			typeof rawSummary !== "object" ||
			rawSummary === null ||
			Array.isArray(rawSummary)
		) {
			invalidReportResult("summary-not-object");
		}
		const summary = rawSummary as Record<string, unknown>;
		const kind = summary.kind;
		if (!isReportKind(kind)) invalidReportResult("kind-invalid");
		if (!hasSafeReportText(summary.title, 256)) {
			invalidReportResult("title-invalid");
		}
		if (!hasSafeReportText(summary.reportedAt, 64)) {
			invalidReportResult("reported-at-invalid");
		}
		const status: ReportSummary["status"] =
			summary.status === "available" || summary.status === "abnormal"
				? summary.status
				: invalidReportResult("status-invalid");
		const hasAttachment = summary.hasAttachment;
		if (typeof hasAttachment !== "boolean") {
			invalidReportResult("attachment-invalid");
		}

		const providerReportId = record.providerReportId;
		if (kind !== "laboratory" && providerReportId !== undefined) {
			// 影像和心电尚无详情字段合同，不能把 Provider 报告号留在
			// 内部结果中等待未来页面“顺手”消费，必须在当前边界拒绝。
			invalidReportResult("provider-report-id-forbidden");
		}
		if (providerReportId !== undefined) {
			if (!hasSafeReportText(providerReportId, 256)) {
				invalidReportResult("provider-report-id-invalid");
			}
			if (providerReportIds.has(providerReportId)) {
				invalidReportResult("provider-report-id-duplicate");
			}
			providerReportIds.add(providerReportId);
		}

		const safeSummary = {
			title: summary.title,
			reportedAt: summary.reportedAt,
			status,
			hasAttachment,
		};
		if (kind === "laboratory") {
			return {
				summary: { kind, ...safeSummary },
				...(providerReportId !== undefined ? { providerReportId } : {}),
			};
		}
		return { summary: { kind, ...safeSummary } };
	});
}

/**
 * 解析报告摘要时间，返回用于窗口比较的时间戳。
 *
 * 旧端 LIS/PACS/ECG 的报告时间可能是 `yyyy-MM-dd`、带时间的本地文本、
 * 斜杠日期或带明确时区的 ISO 文本。自然日文本按 UTC 伪时间线比较，避免
 * 服务部署机器的时区改变查询结果；带时区的 ISO 文本则按其明确偏移解析。
 * 未知格式和不存在的日历日期都返回 undefined，调用方必须 fail-closed。
 */
export function parseReportTimestamp(value: string): number | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	const localMatch =
		/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(
			trimmed,
		);
	if (localMatch) {
		const year = Number(localMatch[1]);
		const month = Number(localMatch[2]);
		const day = Number(localMatch[3]);
		const hour = Number(localMatch[4] ?? 0);
		const minute = Number(localMatch[5] ?? 0);
		const second = Number(localMatch[6] ?? 0);
		const millisecond = Number((localMatch[7] ?? "").padEnd(3, "0") || 0);
		const timestamp = Date.UTC(
			year,
			month - 1,
			day,
			hour,
			minute,
			second,
			millisecond,
		);
		const date = new Date(timestamp);
		if (
			date.getUTCFullYear() !== year ||
			date.getUTCMonth() !== month - 1 ||
			date.getUTCDate() !== day ||
			hour > 23 ||
			minute > 59 ||
			second > 59
		) {
			return undefined;
		}
		return timestamp;
	}

	// 先校验 ISO 日期部分，避免某些运行时把 2 月 30 日自动进位后当成合法值。
	if (
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
			trimmed,
		) &&
		parseIsoCalendarDate(trimmed.slice(0, 10)) !== undefined
	) {
		const timestamp = Date.parse(trimmed);
		return Number.isFinite(timestamp) ? timestamp : undefined;
	}
	return undefined;
}

/**
 * 报告目录不能只验证请求日期本身，还必须证明 Provider 返回的每条摘要
 * 属于这次查询的自然日窗口。窗口首日和末日均包含；未知时间、窗口外
 * 结果和整批混合结果一律拒绝，不能过滤坏行后伪装成完整目录。
 */
export function validateReportDirectoryResultWindow(
	reports: readonly ReportDirectoryEntry[],
	query: ReportDirectoryQuery,
): void {
	const start = parseIsoCalendarDate(query.startDate);
	const end = parseIsoCalendarDate(query.endDate);
	if (start === undefined || end === undefined || end < start) {
		// service 已经有更具体的 ReportQueryError；这里仍保留防御性门禁，
		// 防止未来的内部调用绕过 service 后把非法窗口交给比较逻辑。
		invalidReportResult("reported-at-invalid");
	}
	const endExclusive = (end as number) + 24 * 60 * 60 * 1000;

	for (const report of reports) {
		const timestamp = parseReportTimestamp(report.summary.reportedAt);
		if (timestamp === undefined) {
			invalidReportResult("reported-at-invalid");
		}
		if (timestamp < (start as number) || timestamp >= endExclusive) {
			invalidReportResult("reported-at-outside-query");
		}
	}
}

/**
 * 校验并重新投影 LIS 详情读模型，只保留已冻结的检测项字段。
 *
 * 报告详情含有临床结果，不能依靠 API schema 在最后一层兜底；service
 * 必须在记录日志、计算条目数量和返回 payload 之前完成同样的运行时校验。
 */
export function normalizeLaboratoryReportDetail(
	value: unknown,
): LaboratoryReportDetail {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalidReportResult("detail-not-object");
	}
	const record = value as Record<string, unknown>;
	if (record.kind !== "laboratory") {
		invalidReportResult("detail-kind-invalid");
	}
	if (!hasSafeReportText(record.title, 256)) {
		invalidReportResult("detail-title-invalid");
	}
	if (!hasSafeReportText(record.reportedAt, 64)) {
		invalidReportResult("detail-reported-at-invalid");
	}
	if (parseReportTimestamp(record.reportedAt) === undefined) {
		// 目录和详情的时间必须使用同一套可审计格式；只校验非空会让
		// 详情页出现无法和目录窗口、旧端时间事实对照的临床时间文本。
		invalidReportResult("detail-reported-at-invalid");
	}
	if (!Array.isArray(record.items)) {
		invalidReportResult("detail-items-not-array");
	}
	if (record.items.length > MAX_REPORT_DETAIL_ITEMS) {
		// 明细是临床结果，必须整批 fail-closed，不能只返回前一部分检测项。
		invalidReportResult("detail-items-too-many");
	}
	if (typeof record.hasAttachment !== "boolean") {
		invalidReportResult("detail-attachment-invalid");
	}

	const items = record.items.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidReportResult("detail-item-not-object");
		}
		const detailItem = item as Record<string, unknown>;
		if (!hasSafeReportText(detailItem.name, 256)) {
			invalidReportResult("detail-field-invalid");
		}
		if (!hasSafeReportText(detailItem.result, 256)) {
			invalidReportResult("detail-field-invalid");
		}
		const flag: ReportDetailFlag =
			detailItem.flag === "normal" ||
			detailItem.flag === "high" ||
			detailItem.flag === "low" ||
			detailItem.flag === "critical" ||
			detailItem.flag === "unknown"
				? detailItem.flag
				: invalidReportResult("detail-field-invalid");
		const unit = optionalReportText(detailItem, "unit", 64);
		const referenceRange = optionalReportText(
			detailItem,
			"referenceRange",
			256,
		);
		return {
			name: detailItem.name,
			result: detailItem.result,
			...(unit ? { unit } : {}),
			...(referenceRange ? { referenceRange } : {}),
			flag,
		};
	});

	return {
		kind: "laboratory",
		title: record.title,
		reportedAt: record.reportedAt,
		items,
		hasAttachment: record.hasAttachment,
	};
}

/** 报告详情 provider 端口只接受服务端已 owner 校验的受限引用。 */
export interface ReportDetailGateway {
	getLaboratoryDetail(
		input: { providerReportId: string },
		context: AdapterCallContext,
	): Promise<{
		detail: LaboratoryReportDetail;
		trace: ExternalTrace;
	}>;
}

/** 报告目录、详情、解读和下载分别建端口，避免目录接口顺手扩大权限。 */
export interface ReportDirectoryGateway {
	listReports(
		input: ReportDirectoryInput,
		context: AdapterCallContext,
	): Promise<{
		reports: readonly ReportDirectoryEntry[];
		trace: ExternalTrace;
	}>;
}
