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

/**
 * 众阳旧接口存在两种已确认成功包络：新 HTTP 封装使用 `success=true` 与
 * `code=0`，旧预约记录链路也使用 `code="0000"`。只看 HTTP 200 或只看
 * `data` 会把 `code=5000,data=[]` 误报成“暂无预约”；这里要求至少有一个
 * 明确成功标志，并拒绝未知业务码。裸数组是已确认的列表响应形态，不带包络，
 * 由 HTTP 层负责状态码校验后直接进入项目映射。
 */
function hasSuccessfulBusinessEnvelope(envelope: ProviderObject): boolean {
	const hasSuccess = Object.hasOwn(envelope, "success");
	const hasCode = Object.hasOwn(envelope, "code");
	const success = envelope.success;
	const code = envelope.code;
	const successfulCode = code === 0 || code === "0" || code === "0000";

	if (hasSuccess && success !== true) return false;
	if (hasCode && !successfulCode) return false;
	return success === true || successfulCode;
}

function responseItems(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject[] {
	if (Array.isArray(value))
		return value.map((item) => objectValue(item, operation, requestId));
	const envelope = objectValue(value, operation, requestId);
	if (!hasSuccessfulBusinessEnvelope(envelope)) {
		throw providerError(
			operation,
			"Zhongyang appointment provider returned a business failure",
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
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		// Provider 文本会进入小程序页面和服务端读模型；换行、制表或
		// 其它控制字符不是合法的科室/医生/预约展示事实，必须整批拒绝。
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

/**
 * provider 排班号必须在一次完整响应中唯一。
 *
 * API 层会为每条排班生成 opaque `scheduleId`；如果 provider 自己的
 * `hisScheduleId` 重复，平台就会为同一个号源生成多个外部引用，页面看似
 * 出现两条排班，未来写入时却无法判断哪一条是同一个锁号事实。因此先在
 * adapter 边界拒绝整个响应，不让重复号源进入快照或公共读模型。
 */
function ensureUniqueScheduleIds(
	schedules: readonly AppointmentProviderSchedule[],
	operation: string,
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const schedule of schedules) {
		if (seen.has(schedule.providerScheduleId)) {
			throw providerError(
				operation,
				"Zhongyang appointment response contained duplicate schedule ids",
				requestId,
			);
		}
		seen.add(schedule.providerScheduleId);
	}
}

/**
 * 科室 ID 是客户端级联选择和后续排班筛选的关联键，不能允许同一次
 * provider 响应中出现重复值。否则客户端看到的可能是两个同名/不同名
 * 科室，但点击后实际请求会落到同一个内部筛选条件，造成选择状态漂移。
 */
function ensureUniqueDepartmentIds(
	departments: readonly AppointmentDepartment[],
	operation: string,
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const department of departments) {
		if (seen.has(department.departmentId)) {
			throw providerError(
				operation,
				"Zhongyang appointment response contained duplicate department ids",
				requestId,
			);
		}
		seen.add(department.departmentId);
	}
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
	// 5/6/7 是旧预约接口仍在使用的确定状态：停诊、替诊、已登记。
	// 这些状态不能折叠为 unknown，否则患者会看到“状态未知”，而运营人员
	// 也无法区分医院停诊与患者爽约。只有未在 Provider 合同中确认的数字才保留 unknown。
	if (normalized === 5) return "stopped";
	if (normalized === 6) return "substituted";
	if (normalized === 7) return "registered";
	return "unknown";
}

/**
 * 同一预约历史响应中如果带有重复 `appointmentInfoId`，必须拒绝整批结果。
 *
 * 这个 ID 只用于 adapter 内部判断，不进入公共读模型；但如果忽略重复值，
 * 原生页面虽然可以用数组下标渲染两行，后续详情、取消或状态刷新却无法
 * 判断它们是否是同一条预约。Provider 没有返回预约号时不人为生成 ID，
 * 继续保持只读摘要，避免把标题、日期和流水号拼成伪业务主键。
 */
function ensureUniqueAppointmentIds(
	items: readonly ProviderObject[],
	operation: string,
	requestId: string,
): void {
	const seen = new Set<string>();
	for (const item of items) {
		const appointmentId = optionalText(
			item.appointmentInfoId,
			"appointmentInfoId",
			operation,
			requestId,
			128,
		);
		if (!appointmentId) continue;
		if (seen.has(appointmentId)) {
			throw providerError(
				operation,
				"Zhongyang appointment response contained duplicate appointment ids",
				requestId,
			);
		}
		seen.add(appointmentId);
	}
}

/**
 * 从 provider 的完整日期时间中提取患者端需要的 HH:mm。
 *
 * 旧端会用 groupStart/groupEnd 展示时间段，但这些字段可能携带完整日期、
 * 秒或时区信息，不能直接透传到公共读模型。只接受明确的时钟片段；解析
 * 失败时由调用方回退 workTime，避免一个非关键展示字段让整批历史记录失败。
 */
function clockTime(value: unknown): string | undefined {
	if (typeof value !== "string" || value.trim().length > 128) return undefined;
	const match = value.match(/(?:^|[T\s])(\d{2}):(\d{2})(?::\d{2})?/);
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (
		!Number.isInteger(hour) ||
		!Number.isInteger(minute) ||
		hour > 23 ||
		minute > 59
	) {
		return undefined;
	}
	return `${match[1]}:${match[2]}`;
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
	const rawWorkTime = optionalText(
		value.workTime,
		"workTime",
		operation,
		requestId,
		64,
	);
	const groupStart = clockTime(value.groupStart);
	const groupEnd = clockTime(value.groupEnd);
	// 两端都能解析时才组成时间段；只拿到一端不能猜测结束时间，
	// 继续使用 provider 已给出的 workTime，避免把不完整事实展示成完整时段。
	const workTime =
		groupStart && groupEnd
			? groupStart === groupEnd
				? groupStart
				: `${groupStart}-${groupEnd}`
			: rawWorkTime;
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
	// 当前 AMC 排班响应中 remainingNumber 可能为 null，平台已确认的可用号源
	// 字段是 usableSourceNum。旧端不同接口中的 usableNum/remainingNumber 不能
	// 被当作同一个事实回退使用；缺少 usableSourceNum 时拒绝整条响应，避免把
	// 未确认的数量带入页面，更不能据此开放未来锁号。
	const availableValue = value.usableSourceNum;
	const totalSlots = requiredInteger(
		value.totalNum,
		"totalNum",
		operation,
		requestId,
	);
	const availableSlots = requiredInteger(
		availableValue,
		"usableSourceNum",
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
		ensureUniqueDepartmentIds(departments, operation, response.requestId);
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
		ensureUniqueScheduleIds(schedules, operation, response.requestId);
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
		const records = responseItems(response.data, operation, response.requestId);
		ensureUniqueAppointmentIds(records, operation, response.requestId);
		const mappedRecords = records.map((item) =>
			mapRecord(item, operation, response.requestId),
		);
		return {
			records: mappedRecords,
			trace: trace(operation, response.requestId),
		};
	}
}

export type ZhongyangAppointmentGatewayOptions = ZhongyangGatewayOptions;

export function createZhongyangAppointmentGateway(
	options: ZhongyangGatewayOptions,
): AppointmentDirectoryGateway & AppointmentRecordDirectoryGateway {
	return new ZhongyangAppointmentApiGateway(options);
}
