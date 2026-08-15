import type {
	AdapterCallContext,
	ExternalTrace,
	ReportDirectoryGateway,
	ReportDirectoryInput,
	ReportKind,
	ReportSummary,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const LABORATORY_PATH = "/msun-middle-business-lis/v1/lis-reports-filter";
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
): ReportSummary {
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
	return {
		kind: "laboratory",
		title,
		reportedAt,
		status: reportStatus(flag(value.criticalFlag) || flag(value.flagGerm)),
		hasAttachment:
			Array.isArray(value.pdfUrlList) && value.pdfUrlList.length > 0,
	};
}

function mapImaging(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportSummary {
	const title =
		optionalText(value.reportDocName, "reportDocName", operation, requestId) ??
		optionalText(value.stuBodypart, "stuBodypart", operation, requestId) ??
		optionalText(value.modality, "modality", operation, requestId) ??
		"影像检查报告";
	return {
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
	};
}

function mapEcg(
	value: ProviderObject,
	operation: string,
	requestId: string,
): ReportSummary {
	const title =
		optionalText(value.diagnosis, "diagnosis", operation, requestId) ??
		optionalText(value.reportDocName, "reportDocName", operation, requestId) ??
		"心电报告";
	return {
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
	): Promise<{ reports: ReportSummary[]; requestId: string }> {
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
		return {
			reports: items.map((item) => map(item, operation, response.requestId)),
			requestId: response.requestId,
		};
	}

	async listReports(
		input: ReportDirectoryInput,
		context: AdapterCallContext,
	): Promise<{
		reports: readonly ReportSummary[];
		trace: ExternalTrace;
	}> {
		const kinds: readonly ReportKind[] = input.query.kind
			? [input.query.kind]
			: ["laboratory", "imaging", "ecg"];
		const results = await Promise.all(
			kinds.map((kind) => this.requestKind(kind, input, context)),
		);
		const reports = results
			.flatMap((result) => result.reports)
			.sort(
				(left, right) =>
					right.reportedAt.localeCompare(left.reportedAt) ||
					left.kind.localeCompare(right.kind) ||
					left.title.localeCompare(right.title),
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

export type ZhongyangReportGatewayOptions = ZhongyangGatewayOptions;

export function createZhongyangReportGateway(
	options: ZhongyangGatewayOptions,
): ReportDirectoryGateway {
	return new ZhongyangReportApiGateway(options);
}
