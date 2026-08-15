import type {
	AdapterCallContext,
	AppointmentDepartment,
	AppointmentDepartmentQuery,
	AppointmentDirectoryGateway,
	AppointmentProviderSchedule,
	AppointmentRecord,
	AppointmentRecordDirectoryGateway,
	AppointmentRecordQuery,
	AppointmentSchedule,
	AppointmentScheduleQuery,
	ExternalTrace,
} from "@hospital/domain";
import { parseIsoCalendarDate } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const REQUEST_CHANNEL = "4";
/** 旧 provider 记录接口把微信端渠道编码定义为 3；仅在 adapter 内固定。 */
const RECORD_REQUEST_CHANNEL = "3";
const DEPARTMENT_PATH =
	"/msun-middle-business-amc-server/v1/schedulings/scheduling-depts";
const SCHEDULE_PATH = "/msun-middle-business-amc-server/v1/schedulings";
const RECORD_PATH =
	"/msun-middle-business-appointment-server/v1/appointment-infos/";

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

function objectValue(value: unknown, operation: string, requestId: string) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			operation,
			"Zhongyang appointment response was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

function responseItems(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject[] {
	if (Array.isArray(value))
		return value.map((item) => objectValue(item, operation, requestId));
	const envelope = objectValue(value, operation, requestId);
	if (envelope.success === false) {
		throw providerError(
			operation,
			"Zhongyang appointment provider rejected the request",
			requestId,
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			operation,
			"Zhongyang appointment response data was invalid",
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
	maxLength = 128,
): string {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			operation,
			`Zhongyang appointment field ${field} is invalid`,
			requestId,
		);
	}
	const normalized = String(value).trim();
	if (!normalized || normalized.length > maxLength) {
		throw providerError(
			operation,
			`Zhongyang appointment field ${field} is invalid`,
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
	maxLength = 128,
): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	return requiredText(value, field, operation, requestId, maxLength);
}

function requiredInteger(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
): number {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw providerError(
			operation,
			`Zhongyang appointment field ${field} is invalid`,
			requestId,
		);
	}
	return parsed;
}

function timeGroup(value: unknown): AppointmentSchedule["timeGroup"] {
	if (value === 1 || value === "1") return "range";
	if (value === 0 || value === "0") return "point";
	return "unknown";
}

function recordStatus(value: unknown): AppointmentRecord["status"] {
	const normalized =
		typeof value === "number"
			? value
			: typeof value === "string" && value.trim()
				? Number(value)
				: Number.NaN;
	if (normalized === 0) return "scheduled";
	if (normalized === 1) return "cancelled";
	if (normalized === 3) return "completed";
	if (normalized === 4) return "missed";
	return "unknown";
}

function mapRecord(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentRecord {
	const workDate = requiredText(
		value.workDate,
		"workDate",
		operation,
		requestId,
		32,
	);
	if (parseIsoCalendarDate(workDate) === undefined) {
		throw providerError(
			operation,
			"Zhongyang appointment record workDate is invalid",
			requestId,
		);
	}
	const departmentName = optionalText(
		value.deptName,
		"deptName",
		operation,
		requestId,
		128,
	);
	const doctorName = optionalText(
		value.docName,
		"docName",
		operation,
		requestId,
		128,
	);
	const workTime = optionalText(
		value.workTime,
		"workTime",
		operation,
		requestId,
		64,
	);
	const location = optionalText(
		value.deptAddr,
		"deptAddr",
		operation,
		requestId,
		256,
	);
	const serialNumber = optionalText(
		value.serialNumber,
		"serialNumber",
		operation,
		requestId,
		64,
	);
	return {
		...(departmentName ? { departmentName } : {}),
		...(doctorName ? { doctorName } : {}),
		workDate,
		...(workTime ? { workTime } : {}),
		...(location ? { location } : {}),
		...(serialNumber ? { serialNumber } : {}),
		status: recordStatus(value.status),
	};
}

function mapDepartment(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentDepartment {
	const departmentCode = optionalText(
		value.deptCode,
		"deptCode",
		operation,
		requestId,
	);
	const location = optionalText(
		value.roomAddress,
		"roomAddress",
		operation,
		requestId,
	);
	return {
		departmentId: requiredText(value.deptId, "deptId", operation, requestId),
		...(departmentCode ? { departmentCode } : {}),
		displayName: requiredText(value.deptName, "deptName", operation, requestId),
		...(location ? { location } : {}),
	};
}

function mapSchedule(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentProviderSchedule {
	// 真实 AMC 排班响应中 remainingNumber 会稳定返回 null；usableSourceNum
	// 才是当前有效号源数。保留旧别名作为兼容输入，但优先使用真实字段。
	const availableValue =
		value.remainingNumber ?? value.usableNum ?? value.usableSourceNum;
	const totalSlots = requiredInteger(
		value.totalNum,
		"totalNum",
		operation,
		requestId,
	);
	const availableSlots = requiredInteger(
		availableValue,
		"remainingNumber",
		operation,
		requestId,
	);
	const workDate = requiredText(
		value.workDate,
		"workDate",
		operation,
		requestId,
		32,
	);
	if (parseIsoCalendarDate(workDate) === undefined) {
		throw providerError(
			operation,
			"Zhongyang appointment workDate is invalid",
			requestId,
		);
	}
	if (availableSlots > totalSlots) {
		throw providerError(
			operation,
			"Zhongyang appointment slot counts are inconsistent",
			requestId,
		);
	}
	const startTime = optionalText(
		value.startTime,
		"startTime",
		operation,
		requestId,
		32,
	);
	const endTime = optionalText(
		value.endTime,
		"endTime",
		operation,
		requestId,
		32,
	);
	return {
		providerScheduleId: requiredText(
			value.hisScheduleId,
			"hisScheduleId",
			operation,
			requestId,
		),
		departmentId: requiredText(value.deptId, "deptId", operation, requestId),
		departmentName: requiredText(
			value.deptName,
			"deptName",
			operation,
			requestId,
		),
		doctorId: requiredText(value.docId, "docId", operation, requestId),
		doctorName: requiredText(value.docName, "docName", operation, requestId),
		workDate,
		shiftName: requiredText(
			value.shiftName ?? value.shiftCode,
			"shiftName",
			operation,
			requestId,
		),
		...(startTime ? { startTime } : {}),
		...(endTime ? { endTime } : {}),
		totalSlots,
		availableSlots,
		timeGroup: timeGroup(value.timeGroupFlag),
	};
}

function trace(operation: string, requestId: string): ExternalTrace {
	return { provider: "zhongyang", operation, requestId };
}

/**
 * 众阳 AMC 只读预约目录 adapter。
 *
 * 这里仅迁移科室和排班查询；锁号、预约写入、取消和挂号费都留在后续
 * contract 阶段。排班 provider id 只作为内部 adapter 事实返回，由 API
 * 组合边界替换为 opaque 平台 scheduleId 后才进入公共 response。
 */
export class ZhongyangAppointmentApiGateway
	implements AppointmentDirectoryGateway, AppointmentRecordDirectoryGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	private headers(): Record<string, string> | undefined {
		return this.authorizationToken
			? { Authorization: `Bearer ${this.authorizationToken}` }
			: undefined;
	}

	async listDepartments(
		input: AppointmentDepartmentQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-departments";
		const url = new URL(DEPARTMENT_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
		// 众阳 AMC 的科室接口虽然返回科室列表，但仍要求带上有效的日期窗口；
		// 日期由 API 服务端生成，不能让小程序拼接 provider 查询参数。
		url.searchParams.set("startDate", input.startDate);
		url.searchParams.set("endDate", input.endDate);
		const headers = this.headers();
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(headers ? { headers } : {}),
			},
			this.fetcher,
		);
		const departments = responseItems(
			response.data,
			operation,
			response.requestId,
		).map((item) => mapDepartment(item, operation, response.requestId));
		return { departments, trace: trace(operation, response.requestId) };
	}

	async listSchedules(
		input: AppointmentScheduleQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-schedules";
		const url = new URL(SCHEDULE_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
		url.searchParams.set("startDate", input.startDate);
		url.searchParams.set("endDate", input.endDate);
		if (input.departmentId) url.searchParams.set("deptId", input.departmentId);
		if (input.doctorId) url.searchParams.set("docId", input.doctorId);
		const headers = this.headers();
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(headers ? { headers } : {}),
			},
			this.fetcher,
		);
		const schedules = responseItems(
			response.data,
			operation,
			response.requestId,
		).map((item) => mapSchedule(item, operation, response.requestId));
		return { schedules, trace: trace(operation, response.requestId) };
	}

	async listRecords(
		input: {
			providerPatientId: string;
			query: AppointmentRecordQuery;
		},
		context: AdapterCallContext,
	) {
		const operation = "appointment-records";
		const providerPatientId = requiredConfig(input.providerPatientId);
		const url = new URL(
			`${RECORD_PATH}${encodeURIComponent(providerPatientId)}`,
			this.baseUrl,
		);
		url.searchParams.set("requestChannel", RECORD_REQUEST_CHANNEL);
		url.searchParams.set("startDate", input.query.startDate);
		url.searchParams.set("endDate", input.query.endDate);
		url.searchParams.set("isMzFlag", "1");
		url.searchParams.set("dateFlag", "1");
		const headers = this.headers();
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(headers ? { headers } : {}),
			},
			this.fetcher,
		);
		const records = responseItems(
			response.data,
			operation,
			response.requestId,
		).map((item) => mapRecord(item, operation, response.requestId));
		return { records, trace: trace(operation, response.requestId) };
	}
}

export type ZhongyangAppointmentGatewayOptions = ZhongyangGatewayOptions;

export function createZhongyangAppointmentGateway(
	options: ZhongyangGatewayOptions,
): AppointmentDirectoryGateway & AppointmentRecordDirectoryGateway {
	return new ZhongyangAppointmentApiGateway(options);
}
