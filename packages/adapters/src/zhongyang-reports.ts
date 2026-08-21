import {
	type AdapterCallContext,
	type ExternalTrace,
	InvalidReportKindError,
	isReportKind,
	type LaboratoryReportDetail,
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	type ReportDetailGateway,
	type ReportDirectoryEntry,
	type ReportDirectoryGateway,
	type ReportDirectoryInput,
	type ReportKind,
	type ReportSummary,
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
	/** 默认是响应读模型异常；明确的 Provider 业务拒绝由调用方传 false。 */
	responseInvalid = true,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation,
		message,
		retryable: false,
		responseInvalid,
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

/**
 * 校验报告接口的成功包络。
 *
 * 报告目录和 LIS 详情都可能返回裸数组/裸对象，也可能返回 `{ success,
 * data }` 包装。只有包装形态才允许从 `data` 读取业务内容；一旦上游带出
 * `success` 或 `data`，就必须明确 `success=true`。否则 `{ data: [] }` 会被
 * 误当成“没有报告”，把 Provider 格式异常隐藏成合法空目录。
 */
function requireSuccessfulEnvelope(
	envelope: ProviderObject,
	operation: string,
	requestId: string,
): void {
	if (envelope.success === false) {
		throw providerError(
			operation,
			"Zhongyang report provider rejected the request",
			requestId,
			false,
		);
	}
	if (envelope.success !== true) {
		throw providerError(
			operation,
			"Zhongyang report response success flag was invalid",
			requestId,
		);
	}
}

/** 兼容 provider 的数组响应和 `{ success, data }` 包装，但不接受任意对象透传。 */
function responseItems(
	value: unknown,
	operation: string,
	requestId: string,
	maxItems: number,
): ProviderObject[] {
	if (Array.isArray(value)) {
		if (value.length > maxItems) {
			throw providerError(
				operation,
				"Zhongyang report response contained too many items",
				requestId,
			);
		}
		return value.map((item) => objectValue(item, operation, requestId));
	}
	const envelope = objectValue(value, operation, requestId);
	requireSuccessfulEnvelope(envelope, operation, requestId);
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			operation,
			"Zhongyang report response data was invalid",
			requestId,
		);
	}
	if (envelope.data.length > maxItems) {
		throw providerError(
			operation,
			"Zhongyang report response contained too many items",
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
	// 没有 success/data 的对象是已兼容的裸详情形态；只要响应带出包络
	// 字段，就必须走同一成功事实校验，不能让缺失 success 的 data 对象进入
	// 临床详情映射。
	if (Object.hasOwn(envelope, "data") || Object.hasOwn(envelope, "success")) {
		requireSuccessfulEnvelope(envelope, operation, requestId);
		if (!Object.hasOwn(envelope, "data") || envelope.data === undefined) {
			throw providerError(
				operation,
				"Zhongyang report detail data was invalid",
				requestId,
			);
		}
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
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		// Provider 文本会进入患者端摘要、详情和结构化日志；控制字符会破坏
		// 页面排版、日志检索以及下游请求边界。这里直接拒绝整条 Provider
		// 响应，而不是静默删除字符，避免把临床原始数据改写成另一种含义。
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
 * 只把已经确认是非空字符串的 Provider 文件字段计为“有附件”。
 *
 * 这里故意不返回 URL，也不负责下载授权；`hasAttachment` 只是目录和详情
 * 的存在性提示。旧端 PACS/ECG 类型将文件字段定义为 `string | null`，因此
 * 对象、数组和布尔值都属于响应结构异常，不能用 JavaScript 的 truthy 规则
 * 把它们误报成患者可用的附件。
 */
function hasAttachmentText(
	value: ProviderObject,
	field: string,
	operation: string,
	requestId: string,
): boolean {
	const marker = value[field];
	if (marker === undefined || marker === null) return false;
	if (typeof marker !== "string") {
		throw providerError(
			operation,
			`Zhongyang report attachment field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = marker.trim();
	if (
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw providerError(
			operation,
			`Zhongyang report attachment field ${field} is invalid`,
			requestId,
		);
	}
	return normalized.length > 0;
}

/**
 * LIS 的附件字段是字符串数组。数组为空或只包含空字符串时没有可用附件；
 * 数组元素出现对象或控制字符等未知形态则整条响应失败，避免把不明结构
 * 降级成“有附件”。即使附件地址当前不下发，异常值也不能绕过 Provider
 * 响应边界进入未来的下载/授权逻辑。
 */
function hasAttachmentTextList(
	value: ProviderObject,
	field: string,
	operation: string,
	requestId: string,
): boolean {
	const marker = value[field];
	if (marker === undefined || marker === null) return false;
	if (
		!Array.isArray(marker) ||
		marker.some(
			(item) =>
				typeof item !== "string" ||
				Array.from(item).some((character) => {
					const code = character.charCodeAt(0);
					return code <= 0x1f || code === 0x7f;
				}),
		)
	) {
		throw providerError(
			operation,
			`Zhongyang report attachment field ${field} is invalid`,
			requestId,
		);
	}
	return marker.some((item) => item.trim().length > 0);
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

/**
 * 只为目录排序解析已经确认过结构的日期文本，不改变患者端展示值。
 *
 * LIS、PACS、ECG 的旧端返回值可能分别使用 `yyyy-MM-dd`、带时间的
 * `yyyy-MM-dd HH:mm:ss` 或斜杠日期。不能直接依赖 `Date.parse`，因为部分
 * JavaScript 运行时会把 `2026-02-30` 自动进位，也不能把未知格式猜成
 * 医疗事实。无法严格解析的时间返回 undefined，由比较器稳定地放到末尾。
 */
function reportTimestampForOrder(value: string): number | undefined {
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

	// 带时区的 ISO 时间可以安全交给 Date.parse；其结构先经过白名单限制，
	// 避免不同运行时对任意自然语言日期作出不同解释。
	if (
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
			trimmed,
		)
	) {
		const timestamp = Date.parse(trimmed);
		return Number.isFinite(timestamp) ? timestamp : undefined;
	}
	return undefined;
}

/**
 * 跨 LIS/PACS/ECG 合并目录时按可验证时间倒序；未知时间永远排在末尾。
 *
 * 这里不把排序键加入公开 contract：报告原始时间仍按 Provider 文本展示，
 * 等院方冻结统一时间格式后再考虑是否把标准化时间纳入接口版本。
 */
function compareReportEntries(
	left: ReportDirectoryEntry,
	right: ReportDirectoryEntry,
): number {
	const leftTimestamp = reportTimestampForOrder(left.summary.reportedAt);
	const rightTimestamp = reportTimestampForOrder(right.summary.reportedAt);
	if (leftTimestamp === undefined && rightTimestamp !== undefined) return 1;
	if (leftTimestamp !== undefined && rightTimestamp === undefined) return -1;
	if (
		leftTimestamp !== undefined &&
		rightTimestamp !== undefined &&
		leftTimestamp !== rightTimestamp
	) {
		return rightTimestamp - leftTimestamp;
	}
	return (
		left.summary.reportedAt.localeCompare(right.summary.reportedAt) ||
		left.summary.kind.localeCompare(right.summary.kind) ||
		left.summary.title.localeCompare(right.summary.title)
	);
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
			hasAttachment: hasAttachmentTextList(
				value,
				"pdfUrlList",
				operation,
				requestId,
			),
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
			hasAttachment:
				hasAttachmentText(value, "reportPdfPath", operation, requestId) ||
				hasAttachmentText(value, "reportImgPath", operation, requestId),
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
			hasAttachment: hasAttachmentText(value, "pdfPath", operation, requestId),
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
	if (value.details.length > MAX_REPORT_DETAIL_ITEMS) {
		throw providerError(
			operation,
			"Zhongyang laboratory detail contained too many items",
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
		hasAttachment: hasAttachmentTextList(
			value,
			"pdfUrlList",
			operation,
			requestId,
		),
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
		// 患者号通常来自 service 的 owner-scoped 映射，但 adapter 也必须
		// 独立拒绝空引用：任务、回放器或可注入仓储不能仅凭 TypeScript 类型
		// 把 `patId=` 发给 Provider。预约 adapter 也使用同一条边界规则。
		const providerPatientId = requiredConfig(input.providerPatientId);
		const url = new URL(
			kind === "laboratory"
				? LABORATORY_PATH
				: kind === "imaging"
					? IMAGING_PATH
					: ECG_PATH,
			this.baseUrl,
		);
		url.searchParams.set("patId", providerPatientId);
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
		const items = responseItems(
			response.data,
			operation,
			response.requestId,
			MAX_REPORT_DIRECTORY_ITEMS,
		);
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
		if (input.query.kind !== undefined && !isReportKind(input.query.kind)) {
			// 不能把未知来源交给下面的三路分支；默认 ECG 只适用于“未指定 kind”，
			// 不适用于调用方传入了一个不认识的值。
			throw new InvalidReportKindError();
		}
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
			.sort(compareReportEntries);
		const requestIds = results.map((result) => result.requestId);
		const primaryRequestId = requestIds[0];
		if (!primaryRequestId) {
			// `kinds` 当前至少包含一个来源；这里仍显式保护未来调用方扩展，
			// 避免把 undefined 断言成请求号并污染错误日志或内部引用。
			throw providerError(
				"reports-directory",
				"Zhongyang report directory returned no request id",
			);
		}
		if (reports.length > MAX_REPORT_DIRECTORY_ITEMS) {
			// 未指定来源时三路 Provider 结果会合并成一个公共目录，不能让
			// 每一路各自通过上限后再把超大总结果交给 service 和引用持久化。
			throw providerError(
				"reports-directory",
				"Zhongyang report directory contained too many items",
				primaryRequestId,
			);
		}
		return {
			reports,
			trace: {
				provider: "zhongyang",
				operation: "reports-directory",
				// 兼容旧日志查询保留第一条 requestId；完整三路关联号
				// 放入有界 requestIds，避免逗号拼接后超过 128 字符并被
				// service 错误地判定为 trace 损坏。
				requestId: primaryRequestId,
				...(requestIds.length > 1 ? { requestIds } : {}),
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
