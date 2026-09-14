import {
	type AdapterCallContext,
	type ExternalTrace,
	InvalidReportKindError,
	isReportKind,
	type LaboratoryReportDetail,
	MAX_REPORT_DETAIL_ITEMS,
	MAX_REPORT_DIRECTORY_ITEMS,
	normalizeAdapterCallContext,
	parseIsoCalendarDate,
	type ReportAttachmentContent,
	type ReportAttachmentGateway,
	type ReportDetailGateway,
	type ReportDirectoryEntry,
	type ReportDirectoryGateway,
	type ReportDirectoryInput,
	type ReportDirectoryQuery,
	type ReportKind,
	type ReportProviderAttachment,
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
const PEIS_PATH = "/msun-peis-app-peis-new/v1/find-report-list-for-wechat";
const REPORT_DIRECTORY_INPUT_FIELDS = new Set([
	"providerPatientId",
	"providerIdentityNumber",
	"hospitalId",
	"query",
]);
const REPORT_DIRECTORY_QUERY_FIELDS = new Set(["startDate", "endDate", "kind"]);
const MAX_REPORT_ATTACHMENT_BYTES = 20 * 1024 * 1024;

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

function invalidInput(operation: string, message: string): never {
	// service 层已经校验过报告日期和来源，但 adapter 也会被回放任务、Worker
	// 或未来组合根直接调用。错误输入必须在 Provider 请求之前停止，不能让
	// 缺失日期、未知字段或 undefined 患者号改变三路报告查询语义。
	throw providerError(operation, message, undefined, false);
}

function normalizeProviderReportInput(
	value: unknown,
	operation: string,
): { providerReportId: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidInput(operation, "Zhongyang report input is invalid");
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((field) => field !== "providerReportId")) {
		return invalidInput(
			operation,
			"Zhongyang report input contains an unknown field",
		);
	}
	if (typeof record.providerReportId !== "string") {
		return invalidInput(
			operation,
			"Zhongyang report provider report reference is invalid",
		);
	}
	return { providerReportId: record.providerReportId };
}

/**
 * 报告目录 adapter 的运行时查询门禁。
 *
 * `ReportDirectoryInput` 是 TypeScript 类型，不会在运行时阻止组合根传入
 * null、未知字段、非法自然日或倒序日期。这里保留未知字符串 kind 给下面
 * 的 `InvalidReportKindError`，这样现有错误分类不变；其它形状错误统一在
 * 触网前以不可重试的 ProviderRequestError 结束。
 */
function normalizeDirectoryInput(value: unknown): ReportDirectoryInput {
	const operation = "reports-directory";
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidInput(
			operation,
			"Zhongyang report directory input is invalid",
		);
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(field) => !REPORT_DIRECTORY_INPUT_FIELDS.has(field),
		)
	) {
		return invalidInput(
			operation,
			"Zhongyang report directory input contains an unknown field",
		);
	}
	if (typeof record.providerPatientId !== "string") {
		return invalidInput(
			operation,
			"Zhongyang report provider patient reference is invalid",
		);
	}
	const queryValue = record.query;
	if (
		typeof queryValue !== "object" ||
		queryValue === null ||
		Array.isArray(queryValue)
	) {
		return invalidInput(
			operation,
			"Zhongyang report directory query is invalid",
		);
	}
	const queryRecord = queryValue as Record<string, unknown>;
	if (
		Object.keys(queryRecord).some(
			(field) => !REPORT_DIRECTORY_QUERY_FIELDS.has(field),
		)
	) {
		return invalidInput(
			operation,
			"Zhongyang report directory query contains an unknown field",
		);
	}
	if (
		typeof queryRecord.startDate !== "string" ||
		typeof queryRecord.endDate !== "string"
	) {
		return invalidInput(
			operation,
			"Zhongyang report directory date range is invalid",
		);
	}
	const start = parseIsoCalendarDate(queryRecord.startDate);
	const end = parseIsoCalendarDate(queryRecord.endDate);
	if (start === undefined || end === undefined || start > end) {
		return invalidInput(
			operation,
			"Zhongyang report directory date range is invalid",
		);
	}
	if (queryRecord.kind !== undefined && typeof queryRecord.kind !== "string") {
		return invalidInput(
			operation,
			"Zhongyang report directory kind is invalid",
		);
	}
	const query: ReportDirectoryQuery = {
		startDate: queryRecord.startDate,
		endDate: queryRecord.endDate,
	};
	if (queryRecord.kind !== undefined) {
		query.kind = queryRecord.kind as Exclude<
			ReportDirectoryQuery["kind"],
			undefined
		>;
	}
	return {
		providerPatientId: record.providerPatientId,
		...(record.providerIdentityNumber === undefined
			? {}
			: typeof record.providerIdentityNumber === "string"
				? { providerIdentityNumber: record.providerIdentityNumber }
				: invalidInput(operation, "Zhongyang PEIS identity number is invalid")),
		...(record.hospitalId === undefined
			? {}
			: typeof record.hospitalId === "number" &&
					Number.isSafeInteger(record.hospitalId) &&
					record.hospitalId > 0
				? { hospitalId: record.hospitalId }
				: invalidInput(operation, "Zhongyang PEIS hospital id is invalid")),
		query,
	};
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

/**
 * 心电目录使用失败包络表达合法空结果。
 *
 * 2026-09-14 的目标环境实证响应为
 * `{ success:false, code:"0001", message:"未查询到数据", data:null }`。
 * 这里只兼容这一个来源、错误码、文案和 data 形状的精确组合；其它
 * `success=false` 仍由 requireSuccessfulEnvelope 拒绝，不能把真实业务
 * 故障静默降级成“没有报告”。
 */
function isKnownEmptyReportEnvelope(
	envelope: ProviderObject,
	operation: string,
): boolean {
	return (
		operation === "reports-ecg" &&
		envelope.success === false &&
		envelope.code === "0001" &&
		envelope.message === "未查询到数据" &&
		envelope.data === null
	);
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
	if (isKnownEmptyReportEnvelope(envelope, operation)) return [];
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

/** PEIS 的成功数据比 LIS/PACS/ECG 多一层 `{ data: { report } }`。 */
function peisResponseItems(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject[] {
	const envelope = objectValue(value, operation, requestId);
	requireSuccessfulEnvelope(envelope, operation, requestId);
	const data = objectValue(envelope.data, operation, requestId);
	if (!Array.isArray(data.report)) {
		throw providerError(
			operation,
			"Zhongyang PEIS report response data was invalid",
			requestId,
		);
	}
	if (data.report.length > MAX_REPORT_DIRECTORY_ITEMS) {
		throw providerError(
			operation,
			"Zhongyang report response contained too many items",
			requestId,
		);
	}
	return data.report.map((item) => objectValue(item, operation, requestId));
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
function attachmentText(
	value: ProviderObject,
	field: string,
	operation: string,
	requestId: string,
): string | undefined {
	const marker = value[field];
	if (marker === undefined || marker === null || marker === "")
		return undefined;
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
	if (!normalized) return undefined;
	if (normalized.length > 2048) {
		throw providerError(
			operation,
			`Zhongyang report attachment field ${field} is invalid`,
			requestId,
		);
	}
	return normalized;
}

/**
 * LIS 的附件字段是字符串数组。数组为空或只包含空字符串时没有可用附件；
 * 数组元素出现对象或控制字符等未知形态则整条响应失败，避免把不明结构
 * 降级成“有附件”。即使附件地址当前不下发，异常值也不能绕过 Provider
 * 响应边界进入未来的下载/授权逻辑。
 */
function attachmentTextList(
	value: ProviderObject,
	field: string,
	operation: string,
	requestId: string,
): string[] {
	const marker = value[field];
	if (marker === undefined || marker === null) return [];
	if (
		!Array.isArray(marker) ||
		marker.some(
			(item) =>
				typeof item !== "string" ||
				item.trim().length > 2048 ||
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
	return marker.map((item) => item.trim()).filter(Boolean);
}

function hasAttachmentTextList(
	value: ProviderObject,
	field: string,
	operation: string,
	requestId: string,
): boolean {
	return attachmentTextList(value, field, operation, requestId).length > 0;
}

function detailField(
	label: string,
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
): { label: string; value: string } | undefined {
	const normalized = optionalText(value, field, operation, requestId, 2048);
	return normalized === undefined ? undefined : { label, value: normalized };
}

function compactFields<T>(values: readonly (T | undefined)[]): T[] {
	return values.filter((value): value is T => value !== undefined);
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

/**
 * 严格解析 Provider 的异常标记。
 *
 * 旧端类型把这些字段定义成 0/1 数字，但部分网关会把数字序列化成字符串；
 * 因此这里只兼容明确的 boolean、0/1 数字和对应字符串。字段缺失表示“没有
 * 该标记”，但对象、数组、空字符串或未知数字不能静默当成 false，否则一条
 * 损坏的临床响应可能被患者端展示为“正常报告”。
 */
function flag(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && (value === 0 || value === 1)) {
		return value === 1;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (normalized === "0" || normalized === "false") return false;
		if (normalized === "1" || normalized === "true") return true;
	}
	throw providerError(
		operation,
		`Zhongyang report flag field ${field} is invalid`,
		requestId,
	);
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
	// `reportedAt` 是患者端的报告时间，不是采样时间或登记时间。
	// 旧端对 LIS 明确展示 `reportTime`；缺失时不能退回 `collectTime/regTime`
	// 猜测，否则日期窗口、排序和患者看到的医疗事实都会被改写。
	const reportedAt = requiredText(
		value.reportTime,
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
	const criticalFlag = flag(
		value.criticalFlag,
		"criticalFlag",
		operation,
		requestId,
	);
	const germFlag = flag(value.flagGerm, "flagGerm", operation, requestId);
	return {
		summary: {
			kind: "laboratory",
			title,
			reportedAt,
			status: reportStatus(criticalFlag || germFlag),
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
		optionalText(value.stuBodypart, "stuBodypart", operation, requestId) ??
		optionalText(value.modality, "modality", operation, requestId) ??
		"影像检查报告";
	const reportedAt = requiredText(
		value.reportAuditTime,
		"reportAuditTime",
		operation,
		requestId,
		64,
	);
	const providerReportId = requiredText(
		value.reportId,
		"reportId",
		operation,
		requestId,
		256,
	);
	const attachments = compactFields([
		attachmentText(value, "reportPdfPath", operation, requestId)
			? {
					sourceUrl: attachmentText(
						value,
						"reportPdfPath",
						operation,
						requestId,
					) as string,
					kind: "pdf" as const,
					label: "影像报告 PDF",
				}
			: undefined,
		attachmentText(value, "reportImgPath", operation, requestId)
			? {
					sourceUrl: attachmentText(
						value,
						"reportImgPath",
						operation,
						requestId,
					) as string,
					kind: "image" as const,
					label: "影像报告图片",
				}
			: undefined,
	]);
	const fields = compactFields([
		detailField("检查设备", value.modality, "modality", operation, requestId),
		detailField(
			"检查部位",
			value.stuBodypart,
			"stuBodypart",
			operation,
			requestId,
		),
		detailField(
			"报告医生",
			value.reportDocName,
			"reportDocName",
			operation,
			requestId,
		),
		detailField(
			"审核医生",
			value.auditDocName,
			"auditDocName",
			operation,
			requestId,
		),
	]);
	const sections = compactFields([
		optionalText(value.finding, "finding", operation, requestId, 10_000)
			? {
					title: "检查所见",
					content: optionalText(
						value.finding,
						"finding",
						operation,
						requestId,
						10_000,
					) as string,
				}
			: undefined,
		optionalText(value.conclusion, "conclusion", operation, requestId, 10_000)
			? {
					title: "检查结论",
					content: optionalText(
						value.conclusion,
						"conclusion",
						operation,
						requestId,
						10_000,
					) as string,
				}
			: undefined,
	]);
	return {
		summary: {
			kind: "imaging",
			title,
			reportedAt,
			status: "available",
			hasAttachment: attachments.length > 0,
		},
		providerReportId,
		detail: {
			kind: "imaging",
			title,
			reportedAt,
			fields,
			sections,
			hasAttachment: attachments.length > 0,
		},
		attachments,
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
	const reportedAt = requiredText(
		value.diagnoseTime,
		"diagnoseTime",
		operation,
		requestId,
		64,
	);
	const providerReportId = requiredText(
		value.ecgReportId,
		"ecgReportId",
		operation,
		requestId,
		256,
	);
	const pdfPath = attachmentText(value, "pdfPath", operation, requestId);
	const attachments = pdfPath
		? [{ sourceUrl: pdfPath, kind: "pdf" as const, label: "心电报告 PDF" }]
		: [];
	const fields = compactFields([
		detailField("心率 HR", value.hr, "hr", operation, requestId),
		detailField("PR 间期", value.pr, "pr", operation, requestId),
		detailField("QRS 时限", value.qrs, "qrs", operation, requestId),
		detailField("QT 间期", value.qt, "qt", operation, requestId),
		detailField("QTc", value.qtc, "qtc", operation, requestId),
		detailField("QRS 轴", value.qrsAxes, "qrsAxes", operation, requestId),
		detailField("P 轴", value.paxes, "paxes", operation, requestId),
		detailField("T 轴", value.taxes, "taxes", operation, requestId),
		detailField(
			"报告医生",
			value.reportDocName,
			"reportDocName",
			operation,
			requestId,
		),
		detailField(
			"审核医生",
			value.auditDocName,
			"auditDocName",
			operation,
			requestId,
		),
	]);
	const diagnosis = optionalText(
		value.diagnosis,
		"diagnosis",
		operation,
		requestId,
		10_000,
	);
	return {
		summary: {
			kind: "ecg",
			title,
			// 旧端报告列表的可见时间使用 `diagnoseTime`。审核时间是另一
			// 个 Provider 字段，不能在缺少诊断时间时静默冒充报告时间。
			reportedAt,
			status: "available",
			hasAttachment: attachments.length > 0,
		},
		providerReportId,
		detail: {
			kind: "ecg",
			title,
			reportedAt,
			fields,
			sections: diagnosis ? [{ title: "心电诊断", content: diagnosis }] : [],
			hasAttachment: attachments.length > 0,
		},
		attachments,
	};
}

function mapPeis(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportDirectoryEntry {
	const title =
		optionalText(value.packageNames, "packageNames", operation, requestId) ??
		optionalText(value.serialNo, "serialNo", operation, requestId) ??
		optionalText(value.healthExamNo, "healthExamNo", operation, requestId) ??
		"体检报告";
	const reportedAt = requiredText(
		value.summaryTime ?? value.endTime ?? value.startTime,
		"summaryTime",
		operation,
		requestId,
		64,
	);
	const providerReportId = requiredText(
		value.peisRegInfoId,
		"peisRegInfoId",
		operation,
		requestId,
		256,
	);
	const pdfUrl = attachmentText(value, "pdfUrl", operation, requestId);
	const attachments = pdfUrl
		? [{ sourceUrl: pdfUrl, kind: "pdf" as const, label: "体检报告 PDF" }]
		: [];
	const fields = compactFields([
		detailField(
			"体检套餐",
			value.packageNames,
			"packageNames",
			operation,
			requestId,
		),
		detailField("体检开始", value.startTime, "startTime", operation, requestId),
		detailField("体检结束", value.endTime, "endTime", operation, requestId),
		detailField("总检医生", value.doctor, "doctor", operation, requestId),
		detailField(
			"完成状态",
			value.isFinished,
			"isFinished",
			operation,
			requestId,
		),
	]);
	return {
		summary: {
			kind: "peis",
			title,
			reportedAt,
			status: "available",
			hasAttachment: attachments.length > 0,
		},
		providerReportId,
		detail: {
			kind: "peis",
			title,
			reportedAt,
			fields,
			sections: [],
			hasAttachment: attachments.length > 0,
		},
		attachments,
	};
}

function detailFlag(
	value: ProviderObject,
	operation: string,
	requestId: string,
): LaboratoryReportDetail["items"][number]["flag"] {
	if (flag(value.flagCritical, "flagCritical", operation, requestId)) {
		return "critical";
	}
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
	// 详情和目录必须使用同一报告时间事实；不能因为详情接口缺少
	// `reportTime` 就用采样/登记时间补齐，避免目录与详情时间互相矛盾。
	const reportedAt = requiredText(
		value.reportTime,
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
				flag: detailFlag(detail, operation, requestId),
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

/** 众阳报告只读 adapter；非 LIS 详情复用实时列表行，不保存报告正文。 */
export type ZhongyangReportGatewayOptions = ZhongyangGatewayOptions & {
	/** 跨域附件必须由部署配置显式加入；默认仅允许众阳 base URL 同源。 */
	attachmentAllowedOrigins?: readonly string[];
};

function normalizeAttachmentOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.hash ||
		url.search ||
		(url.pathname !== "/" && url.pathname !== "")
	) {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	return url.origin;
}

function attachmentContentType(
	attachment: ReportProviderAttachment,
	url: URL,
	response: Response,
): ReportAttachmentContent["contentType"] {
	const declared = (response.headers.get("content-type") ?? "")
		.split(";", 1)[0]
		?.trim()
		.toLowerCase();
	if (attachment.kind === "pdf") {
		if (
			declared &&
			declared !== "application/pdf" &&
			declared !== "application/octet-stream"
		) {
			throw providerError(
				"reports-attachment",
				"Zhongyang report attachment content type was invalid",
				response.headers.get("x-request-id") ?? undefined,
			);
		}
		return "application/pdf";
	}
	if (declared?.startsWith("image/")) {
		return declared as `image/${string}`;
	}
	if (!declared || declared === "application/octet-stream") {
		const extension = url.pathname.split(".").pop()?.toLowerCase();
		const inferred =
			extension === "png"
				? "image/png"
				: extension === "gif"
					? "image/gif"
					: extension === "webp"
						? "image/webp"
						: extension === "jpg" || extension === "jpeg"
							? "image/jpeg"
							: undefined;
		if (inferred) return inferred;
	}
	throw providerError(
		"reports-attachment",
		"Zhongyang report attachment content type was invalid",
		response.headers.get("x-request-id") ?? undefined,
	);
}

async function boundedResponseBody(
	response: Response,
	requestId: string,
): Promise<Uint8Array> {
	const declaredLength = Number(response.headers.get("content-length"));
	if (
		Number.isFinite(declaredLength) &&
		(declaredLength < 0 || declaredLength > MAX_REPORT_ATTACHMENT_BYTES)
	) {
		throw providerError(
			"reports-attachment",
			"Zhongyang report attachment was too large",
			requestId,
		);
	}
	if (!response.body) return new Uint8Array();
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_REPORT_ATTACHMENT_BYTES) {
				await reader.cancel();
				throw providerError(
					"reports-attachment",
					"Zhongyang report attachment was too large",
					requestId,
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

export class ZhongyangReportApiGateway
	implements
		ReportDirectoryGateway,
		ReportDetailGateway,
		ReportAttachmentGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;
	private readonly attachmentAllowedOrigins: ReadonlySet<string>;

	constructor(options: ZhongyangReportGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
		this.attachmentAllowedOrigins = new Set([
			new URL(this.baseUrl).origin,
			...(options.attachmentAllowedOrigins ?? []).map(
				normalizeAttachmentOrigin,
			),
		]);
	}

	async fetchAttachment(
		attachment: ReportProviderAttachment,
		context: AdapterCallContext,
	): Promise<ReportAttachmentContent> {
		const normalizedContext = normalizeAdapterCallContext(context);
		if (!normalizedContext) {
			return invalidInput(
				"reports-attachment",
				"Zhongyang report attachment context is invalid",
			);
		}
		if (
			typeof attachment !== "object" ||
			attachment === null ||
			(attachment.kind !== "pdf" && attachment.kind !== "image") ||
			typeof attachment.sourceUrl !== "string"
		) {
			return invalidInput(
				"reports-attachment",
				"Zhongyang report attachment input is invalid",
			);
		}
		let url: URL;
		try {
			url = new URL(attachment.sourceUrl);
		} catch {
			return invalidInput(
				"reports-attachment",
				"Zhongyang report attachment URL is invalid",
			);
		}
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			url.username ||
			url.password ||
			url.hash ||
			!this.attachmentAllowedOrigins.has(url.origin)
		) {
			return invalidInput(
				"reports-attachment",
				"Zhongyang report attachment origin is not allowed",
			);
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			normalizedContext.timeoutMs ?? 20_000,
		);
		const onAbort = () => controller.abort();
		if (normalizedContext.signal?.aborted) controller.abort();
		else
			normalizedContext.signal?.addEventListener("abort", onAbort, {
				once: true,
			});
		try {
			const headers = new Headers({
				Accept: attachment.kind === "pdf" ? "application/pdf" : "image/*",
				"x-request-id": normalizedContext.traceId,
				"idempotency-key": normalizedContext.idempotencyKey,
				...(this.authorizationToken
					? { Authorization: `Bearer ${this.authorizationToken}` }
					: {}),
			});
			const response = await this.fetcher(url, {
				method: "GET",
				headers,
				// 不跟随 Provider 返回的重定向；否则一个已允许的同源 URL
				// 可以把带鉴权的下载链带到未加入白名单的外部来源。
				redirect: "manual",
				signal: controller.signal,
			});
			const requestId =
				response.headers.get("x-request-id")?.trim() ||
				normalizedContext.traceId;
			if (!response.ok) {
				throw new ProviderRequestError({
					provider: "zhongyang",
					operation: "reports-attachment",
					message: "Zhongyang report attachment request failed",
					statusCode: response.status,
					requestId,
					retryable: response.status >= 500,
					failureStage: "http",
					requestOutcome: "rejected",
				});
			}
			const contentType = attachmentContentType(attachment, url, response);
			const body = await boundedResponseBody(response, requestId);
			if (body.byteLength === 0) {
				throw providerError(
					"reports-attachment",
					"Zhongyang report attachment was empty",
					requestId,
				);
			}
			return { body, contentType };
		} catch (error) {
			if (error instanceof ProviderRequestError) throw error;
			throw new ProviderRequestError({
				provider: "zhongyang",
				operation: "reports-attachment",
				message: "Zhongyang report attachment transport failed",
				retryable: true,
				failureStage: "transport",
				requestOutcome: "unknown",
				cause: error,
			});
		} finally {
			clearTimeout(timeoutId);
			normalizedContext.signal?.removeEventListener("abort", onAbort);
		}
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
					: kind === "ecg"
						? ECG_PATH
						: PEIS_PATH,
			this.baseUrl,
		);
		if (kind !== "peis") url.searchParams.set("patId", providerPatientId);
		if (kind === "laboratory") {
			url.searchParams.set("startTime", dateTime(input.query.startDate, false));
			url.searchParams.set("endTime", dateTime(input.query.endDate, true));
		} else if (kind === "imaging") {
			url.searchParams.set("startDate", input.query.startDate);
			url.searchParams.set("endDate", input.query.endDate);
		} else if (kind === "ecg") {
			url.searchParams.set(
				"startTime",
				slashDateTime(input.query.startDate, false),
			);
			url.searchParams.set("endTime", slashDateTime(input.query.endDate, true));
		}
		let body: Record<string, unknown> | undefined;
		if (kind === "peis") {
			const identityNumber = requiredConfig(input.providerIdentityNumber ?? "");
			if (
				identityNumber.length > 32 ||
				Array.from(identityNumber).some((character) => {
					const code = character.charCodeAt(0);
					return code <= 0x1f || code === 0x7f;
				}) ||
				!Number.isSafeInteger(input.hospitalId) ||
				(input.hospitalId ?? 0) <= 0
			) {
				return invalidInput(
					operation,
					"Zhongyang PEIS query context is invalid",
				);
			}
			body = {
				idcard: identityNumber,
				hospitalId: input.hospitalId,
				startTime: dateTime(input.query.startDate, false),
				endTime: dateTime(input.query.endDate, true),
			};
		}
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: kind === "peis" ? "POST" : "GET",
				context,
				...(body ? { body } : {}),
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const items =
			kind === "peis"
				? peisResponseItems(response.data, operation, response.requestId)
				: responseItems(
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
					: kind === "ecg"
						? mapEcg
						: mapPeis;
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
		attachments: readonly {
			sourceUrl: string;
			kind: "pdf";
			label: string;
		}[];
		trace: ExternalTrace;
	}> {
		const operation = "reports-laboratory-detail";
		const normalizedInput = normalizeProviderReportInput(input, operation);
		const url = new URL(LABORATORY_DETAIL_PATH, this.baseUrl);
		url.searchParams.set(
			"reportId",
			requiredConfig(normalizedInput.providerReportId),
		);
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
		const providerDetail = responseObject(
			response.data,
			operation,
			response.requestId,
		);
		const attachmentUrls = attachmentTextList(
			providerDetail,
			"pdfUrlList",
			operation,
			response.requestId,
		);
		return {
			detail: mapLaboratoryDetail(
				providerDetail,
				operation,
				response.requestId,
			),
			attachments: attachmentUrls.map((sourceUrl, index) => ({
				sourceUrl,
				kind: "pdf" as const,
				label:
					attachmentUrls.length === 1
						? "检验报告 PDF"
						: `检验报告 PDF ${index + 1}`,
			})),
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
		const normalizedInput = normalizeDirectoryInput(input);
		if (
			normalizedInput.query.kind !== undefined &&
			!isReportKind(normalizedInput.query.kind)
		) {
			// 不能把未知来源交给下面的三路分支；默认 ECG 只适用于“未指定 kind”，
			// 不适用于调用方传入了一个不认识的值。
			throw new InvalidReportKindError();
		}
		const kinds: readonly ReportKind[] = normalizedInput.query.kind
			? [normalizedInput.query.kind]
			: ["laboratory", "imaging", "ecg"];
		// 未指定 kind 时，调用方请求的是完整报告目录。公共 contract 没有
		// partial 状态或逐来源错误字段，因此任一来源失败都必须让整批失败；
		// 不能用 Promise.allSettled 只返回成功来源，否则页面会把不完整目录
		// 当成“患者没有其他类型报告”，形成静默漏数据。
		const results = await Promise.all(
			kinds.map((kind) => this.requestKind(kind, normalizedInput, context)),
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
	ReportDetailGateway &
	ReportAttachmentGateway;

export function createZhongyangReportGateway(
	options: ZhongyangReportGatewayOptions,
): ZhongyangReportGateway {
	return new ZhongyangReportApiGateway(options);
}
