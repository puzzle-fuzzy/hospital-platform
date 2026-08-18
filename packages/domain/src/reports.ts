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
	if (
		input.provider !== "zhongyang" ||
		input.kind !== "laboratory" ||
		typeof input.ownerUserId !== "string" ||
		input.ownerUserId.trim().length === 0 ||
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
