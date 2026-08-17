import type {
	AdapterCallContext,
	ExternalTrace,
	ReportDetailGateway,
	ReportDirectoryGateway,
	ReportDirectoryEntry,
	ReportDirectoryInput,
	LaboratoryReportDetail,
	ReportKind,
	ReportSummary,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const LABORATORY_PATH = "/msun-middle-business-lis/v1/lis-reports-filter";
const LABORATORY_DETAIL_PATH =
	"/msun-middle-business-lis/v1/lis-reports/details";
const IMAGING_PATH =
	"/msun-middle-business-pacs/v1/exclude-privacy-patient-reports";
const ECG_PATH = "/msun-middle-business-ecg/v2/ecg-reports";

type ProviderObject = Record<string, unknown>;

function providerError(
	operation: string,
	message: string,
	requestId?: string,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation,
		message,
		retryable: false,
		...(requestId ? { requestId } : {}),
	});
}

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function objectValue(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			operation,
			"Zhongyang report response item was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

/** 兼容 provider 的数组响应和 { success, data } 包装，但不接受任意对象透传。 */
function responseItems(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject[] {
	if (Array.isArray(value)) {
		return value.map((item) => objectValue(item, operation, requestId));
	}
	const envelope = objectValue(value, operation, requestId);
	if (envelope.success === false) {
		throw providerError(
			operation,
			"Zhongyang report provider rejected the request",
			requestId,
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			operation,
			"Zhongyang report response data was invalid",
			requestId,
		);
	}
	return envelope.data.map((item) => objectValue(item, operation, requestId));
}

/** 详情接口返回单个对象；只接受明确的 object/envelope，不透传原始响应。 */
function responseObject(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject {
	const envelope = objectValue(value, operation, requestId);
	if (envelope.success === false) {
		throw providerError(
			operation,
			"Zhongyang report provider rejected the request",
			requestId,
		);
	}
	if ("data" in envelope && envelope.data !== undefined) {
		return objectValue(envelope.data, operation, requestId);
	}
	return envelope;
}

function requiredText(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
	maxLength = 256,
): string {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			operation,
			`Zhongyang report field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (!normalized || normalized.length > maxLength) {
		throw providerError(
			operation,
			`Zhongyang report field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

function optionalText(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
	maxLength = 256,
): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	return requiredText(value, field, operation, requestId, maxLength);
}

/**
 * 同一报告来源内的 provider 报告号必须唯一。
 *
 * API 会依据 providerReportId 生成 owner-scoped opaque 引用；重复报告号
 * 会让两条摘要共享同一个详情引用，后写入的 TTL 或 provider 元数据可能
 * 覆盖前一条。没有报告号的摘要不能凭标题和时间猜测唯一性，只能保持
 * 摘要展示并暂不开放详情。
 */
function ensureUniqueReportIds(
	entries: readonly ReportDirectoryEntry[],
	operation: string,
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const entry of entries) {
		if (!entry.providerReportId) continue;
		if (seen.has(entry.providerReportId)) {
			throw providerError(
				operation,
				"Zhongyang report response contained duplicate report ids",
				requestId,
			);
		}
		seen.add(entry.providerReportId);
	}
}

function flag(value: unknown): boolean {
	if (value === true || value === 1 || value === "1") return true;
	return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function reportStatus(abnormal: boolean): ReportSummary["status"] {
	return abnormal ? "abnormal" : "available";
}

function mapLaboratory(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportDirectoryEntry {
	const title =
		optionalText(value.testList, "testList", operation, requestId) ??
		optionalText(
			value.reportTypeName,
			"reportTypeName",
			operation,
			requestId,
		) ??
		optionalText(
			value.sampleClassName,
			"sampleClassName",
			operation,
			requestId,
		) ??
		"检验报告";
	const reportedAt = requiredText(
		value.reportTime ?? value.collectTime ?? value.regTime,
		"reportTime",
		operation,
		requestId,
		64,
	);
	const providerReportId = optionalText(
		value.reportId,
		"reportId",
		operation,
		requestId,
		256,
	);
	return {
		summary: {
			kind: "laboratory",
			title,
			reportedAt,
			status: reportStatus(flag(value.criticalFlag) || flag(value.flagGerm)),
			hasAttachment:
				Array.isArray(value.pdfUrlList) && value.pdfUrlList.length > 0,
		},
		...(providerReportId ? { providerReportId } : {}),
	};
}

function mapImaging(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportDirectoryEntry {
	const title =
		optionalText(value.reportDocName, "reportDocName", operation, requestId) ??
		optionalText(value.stuBodypart, "stuBodypart", operation, requestId) ??
		optionalText(value.modality, "modality", operation, requestId) ??
		"影像检查报告";
	// PACS 当前只有目录摘要合同；provider 报告号不能进入内部目录项，
	// 否则后续新增详情路由时可能绕过“仅 LIS 可查详情”的业务边界。
	return {
		summary: {
			kind: "imaging",
			title,
			reportedAt: requiredText(
				value.reportAuditTime,
				"reportAuditTime",
				operation,
				requestId,
				64,
			),
			status: "available",
			hasAttachment: Boolean(value.reportPdfPath || value.reportImgPath),
		},
	};
}

function mapEcg(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportDirectoryEntry {
	const title =
		optionalText(value.diagnosis, "diagnosis", operation, requestId) ??
		optionalText(value.reportDocName, "reportDocName", operation, requestId) ??
		"心电报告";
	// ECG 当前没有可审计的详情端口；即使 provider 返回 ecgReportId，
	// 也不能把它保存在目录项中，避免把“有报告号”误判为“可查询详情”。
	return {
		summary: {
			kind: "ecg",
			title,
			reportedAt: requiredText(
				value.auditDocTime ?? value.diagnoseTime,
				"auditDocTime",
				operation,
				requestId,
				64,
			),
			status: "available",
			hasAttachment: Boolean(value.pdfPath),
		},
	};
}

function detailFlag(
	value: ProviderObject,
): LaboratoryReportDetail["items"][number]["flag"] {
	if (flag(value.flagCritical)) return "critical";
	const mark =
		typeof value.mark === "string" ? value.mark.trim().toLowerCase() : "";
	if (["h", "high", "↑", "up"].includes(mark)) return "high";
	if (["l", "low", "↓", "down"].includes(mark)) return "low";
	if (["n", "normal", "正常"].includes(mark)) return "normal";
	return "unknown";
}

function mapLaboratoryDetail(
	value: ProviderObject,
	operation: string,
	requestId: string,
): LaboratoryReportDetail {
	const title =
		optionalText(value.testList, "testList", operation, requestId) ??
		optionalText(
			value.reportTypeName,
			"reportTypeName",
			operation,
			requestId,
		) ??
		optionalText(
			value.sampleClassName,
			"sampleClassName",
			operation,
			requestId,
		) ??
		"检验报告";
	const reportedAt = requiredText(
		value.reportTime ?? value.collectTime ?? value.regTime,
		"reportTime",
		operation,
		requestId,
		64,
	);
	if (!Array.isArray(value.details)) {
		throw providerError(
			operation,
			"Zhongyang laboratory detail items were invalid",
			requestId,
		);
	}
	return {
		kind: "laboratory",
		title,
		reportedAt,
		items: value.details.map((item) => {
			const detail = objectValue(item, operation, requestId);
			// 公开 contract 将单位限制为 64 个字符；在 adapter 边界拒绝异常
			// Provider 文本，避免响应序列化阶段才产生不可定位的错误。
			const unit = optionalText(detail.unit, "unit", operation, requestId, 64);
			const referenceRange = optionalText(
				detail.itemRange,
				"itemRange",
				operation,
				requestId,
			);
			return {
				name: requiredText(
					detail.itemName ?? detail.itemEname,
					"itemName",
					operation,
					requestId,
				),
				result: requiredText(
					detail.itemResult ?? detail.qualitativeResult ?? detail.germResult,
					"itemResult",
					operation,
					requestId,
				),
				...(unit !== undefined ? { unit } : {}),
				...(referenceRange !== undefined ? { referenceRange } : {}),
				flag: detailFlag(detail),
			};
		}),
		hasAttachment:
			Array.isArray(value.pdfUrlList) && value.pdfUrlList.length > 0,
	};
}

function dateTime(value: string, endOfDay: boolean): string {
	return `${value} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

function slashDateTime(value: string, endOfDay: boolean): string {
	return `${value.replaceAll("-", "/")} ${endOfDay ? "23:59:59" : "00:00:00"}`;
}

/** 众阳报告目录只读 adapter；不支持详情、解读、体检身份证查询或文件下载。 */
export class ZhongyangReportApiGateway implements ReportDirectoryGateway {
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	private async requestKind(
		kind: ReportKind,
		input: ReportDirectoryInput,
		context: AdapterCallContext,
	): Promise<{ reports: ReportDirectoryEntry[]; requestId: string }> {
		const operation = `reports-${kind}`;
		const url = new URL(
			kind === "laboratory"
				? LABORATORY_PATH
				: kind === "imaging"
					? IMAGING_PATH
					: ECG_PATH,
			this.baseUrl,
		);
		url.searchParams.set("patId", input.providerPatientId);
		if (kind === "laboratory") {
			url.searchParams.set("startTime", dateTime(input.query.startDate, false));
			url.searchParams.set("endTime", dateTime(input.query.endDate, true));
		} else if (kind === "imaging") {
			url.searchParams.set("startDate", input.query.startDate);
			url.searchParams.set("endDate", input.query.endDate);
		} else {
			url.searchParams.set(
				"startTime",
				slashDateTime(input.query.startDate, false),
			);
			url.searchParams.set("endTime", slashDateTime(input.query.endDate, true));
		}
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const items = responseItems(response.data, operation, response.requestId);
		const map =
			kind === "laboratory"
				? mapLaboratory
				: kind === "imaging"
					? mapImaging
					: mapEcg;
		const reports = items.map((item) =>
			map(item, operation, response.requestId),
		);
		ensureUniqueReportIds(reports, operation, response.requestId);
		return {
			reports,
			requestId: response.requestId,
		};
	}

	async getLaboratoryDetail(
		input: { providerReportId: string },
		context: AdapterCallContext,
	): Promise<{
		detail: LaboratoryReportDetail;
		trace: ExternalTrace;
	}> {
		const operation = "reports-laboratory-detail";
		const url = new URL(LABORATORY_DETAIL_PATH, this.baseUrl);
		url.searchParams.set("reportId", requiredConfig(input.providerReportId));
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		return {
			detail: mapLaboratoryDetail(
				responseObject(response.data, operation, response.requestId),
				operation,
				response.requestId,
			),
			trace: {
				provider: "zhongyang",
				operation,
				requestId: response.requestId,
			},
		};
	}

	async listReports(
		input: ReportDirectoryInput,
		context: AdapterCallContext,
	): Promise<{
		reports: readonly ReportDirectoryEntry[];
		trace: ExternalTrace;
	}> {
		const kinds: readonly ReportKind[] = input.query.kind
			? [input.query.kind]
			: ["laboratory", "imaging", "ecg"];
		// 未指定 kind 时，调用方请求的是完整报告目录。公共 contract 没有
		// partial 状态或逐来源错误字段，因此任一来源失败都必须让整批失败；
		// 不能用 Promise.allSettled 只返回成功来源，否则页面会把不完整目录
		// 当成“患者没有其他类型报告”，形成静默漏数据。
		const results = await Promise.all(
			kinds.map((kind) => this.requestKind(kind, input, context)),
		);
		const reports = results
			.flatMap((result) => result.reports)
			.sort(
				(left, right) =>
					right.summary.reportedAt.localeCompare(left.summary.reportedAt) ||
					left.summary.kind.localeCompare(right.summary.kind) ||
					left.summary.title.localeCompare(right.summary.title),
			);
		return {
			reports,
			trace: {
				provider: "zhongyang",
				operation: "reports-directory",
				requestId: results.map((result) => result.requestId).join(","),
			},
		};
	}
}

export type ZhongyangReportGateway = ReportDirectoryGateway &
	ReportDetailGateway;
export type ZhongyangReportGatewayOptions = ZhongyangGatewayOptions;

export function createZhongyangReportGateway(
	options: ZhongyangGatewayOptions,
): ZhongyangReportGateway {
	return new ZhongyangReportApiGateway(options);
}
