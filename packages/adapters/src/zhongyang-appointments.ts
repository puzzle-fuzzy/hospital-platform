import type {
	AdapterCallContext,
	AppointmentDepartment,
	AppointmentDirectoryGateway,
	AppointmentSchedule,
	AppointmentScheduleQuery,
	ExternalTrace,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { requestJson, type ProviderFetcher } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const REQUEST_CHANNEL = "4";
const DEPARTMENT_PATH =
	"/msun-middle-business-amc-server/v1/schedulings/scheduling-depts";
const SCHEDULE_PATH = "/msun-middle-business-amc-server/v1/schedulings";

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
): AppointmentSchedule {
	const availableValue = value.remainingNumber ?? value.usableNum;
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
	if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
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
		scheduleId: requiredText(
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
 * contract 阶段，避免把旧页面的 provider 参数直接暴露成新 API。
 */
export class ZhongyangAppointmentApiGateway
	implements AppointmentDirectoryGateway
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

	async listDepartments(context: AdapterCallContext) {
		const operation = "appointment-departments";
		const url = new URL(DEPARTMENT_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
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
}

export type ZhongyangAppointmentGatewayOptions = ZhongyangGatewayOptions;

export function createZhongyangAppointmentGateway(
	options: ZhongyangGatewayOptions,
): AppointmentDirectoryGateway {
	return new ZhongyangAppointmentApiGateway(options);
}
