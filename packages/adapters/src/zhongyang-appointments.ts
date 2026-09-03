import {
	type AdapterCallContext,
	type AppointmentClinicDepartmentQuery,
	type AppointmentDepartment,
	type AppointmentDepartmentGroup,
	type AppointmentDepartmentQuery,
	type AppointmentDepartmentTreeGateway,
	type AppointmentDirectoryGateway,
	type AppointmentProviderSchedule,
	type AppointmentRecord,
	type AppointmentRecordDirectoryGateway,
	type AppointmentRecordQuery,
	type AppointmentRecordScope,
	type AppointmentSchedule,
	type AppointmentScheduleQuery,
	type AppointmentScheduleSource,
	type AppointmentScheduleSourceQuery,
	type ExternalTrace,
	isBoundedOpaqueIdentifier,
	MAX_APPOINTMENT_DEPARTMENT_ITEMS,
	MAX_APPOINTMENT_RECORD_ITEMS,
	MAX_APPOINTMENT_SCHEDULE_ITEMS,
	MAX_APPOINTMENT_SOURCE_ITEMS,
	parseIsoCalendarDate,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const REQUEST_CHANNEL = "4";
/** 旧 provider 记录接口的两个已核实只读渠道；数字不进入公共 API。 */
const RECORD_REQUEST_CHANNELS: Record<AppointmentRecordScope, string> = {
	online: "3",
	all: "4",
};
const DEPARTMENT_PATH =
	"/msun-middle-business-amc-server/v1/schedulings/scheduling-depts";
const DEPARTMENT_TREE_PATH = "/msun-middle-business-amc-server/v1/first-depts";
const SCHEDULE_PATH = "/msun-middle-business-amc-server/v1/schedulings";
const SCHEDULE_SOURCES_PATH = "/msun-middle-business-amc-server/v1/sources/";
const RECORD_PATH =
	"/msun-middle-business-appointment-server/v1/appointment-infos/";
const DEPARTMENT_QUERY_FIELDS = new Set(["startDate", "endDate"]);
const CLINIC_DEPARTMENT_QUERY_FIELDS = new Set([
	"startDate",
	"endDate",
	"parentDepartmentId",
]);
const SCHEDULE_QUERY_FIELDS = new Set([
	"startDate",
	"endDate",
	"departmentId",
	"doctorId",
]);

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

function invalidQuery(operation: string, message: string): never {
	// service 层负责生成预约日期窗口，但 adapter 也可能被回放任务、Worker
	// 或未来组合根直接调用。未知字段、非法日期或过滤标识必须在 Provider
	// 请求前拒绝，不能把 undefined 或错误渠道意图拼进上游 URL。
	throw providerError(operation, message, undefined, false);
}

function normalizeDateRange(
	value: unknown,
	operation: string,
	allowedFields: ReadonlySet<string>,
): { startDate: string; endDate: string } & Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidQuery(operation, "Zhongyang appointment query is invalid");
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((field) => !allowedFields.has(field))) {
		return invalidQuery(
			operation,
			"Zhongyang appointment query contains an unknown field",
		);
	}
	if (
		typeof record.startDate !== "string" ||
		typeof record.endDate !== "string"
	) {
		return invalidQuery(
			operation,
			"Zhongyang appointment date range is invalid",
		);
	}
	const start = parseIsoCalendarDate(record.startDate);
	const end = parseIsoCalendarDate(record.endDate);
	if (start === undefined || end === undefined || start > end) {
		return invalidQuery(
			operation,
			"Zhongyang appointment date range is invalid",
		);
	}
	return record as Record<string, unknown> & {
		startDate: string;
		endDate: string;
	};
}

function normalizeDepartmentQuery(value: unknown): AppointmentDepartmentQuery {
	const operation = "appointment-departments";
	const record = normalizeDateRange(value, operation, DEPARTMENT_QUERY_FIELDS);
	return { startDate: record.startDate, endDate: record.endDate };
}

function normalizeClinicDepartmentQuery(
	value: unknown,
): AppointmentClinicDepartmentQuery {
	const operation = "appointment-clinic-departments";
	const record = normalizeDateRange(
		value,
		operation,
		CLINIC_DEPARTMENT_QUERY_FIELDS,
	);
	if (!isBoundedOpaqueIdentifier(record.parentDepartmentId)) {
		return invalidQuery(
			operation,
			"Zhongyang appointment parent department identifier is invalid",
		);
	}
	return {
		startDate: record.startDate,
		endDate: record.endDate,
		parentDepartmentId: record.parentDepartmentId,
	};
}

function normalizeScheduleQuery(value: unknown): AppointmentScheduleQuery {
	const operation = "appointment-schedules";
	const record = normalizeDateRange(value, operation, SCHEDULE_QUERY_FIELDS);
	const query: AppointmentScheduleQuery = {
		startDate: record.startDate,
		endDate: record.endDate,
	};
	for (const field of ["departmentId", "doctorId"] as const) {
		const candidate = record[field];
		if (candidate !== undefined) {
			if (!isBoundedOpaqueIdentifier(candidate)) {
				return invalidQuery(
					operation,
					"Zhongyang appointment filter identifier is invalid",
				);
			}
			query[field] = candidate;
		}
	}
	return query;
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

/**
 * 只有 Provider 明确给出失败布尔值或可识别的失败业务码，才算“请求被拒绝”。
 * 缺少成功标志、成功标志类型错误或 code 形状异常属于响应格式问题，不能
 * 和真实业务拒绝混在一起，否则前端会给出错误的重试/提示语义。
 */
function hasExplicitBusinessFailure(envelope: ProviderObject): boolean {
	const hasSuccess = Object.hasOwn(envelope, "success");
	const success = envelope.success;
	// Provider 一旦返回 success 字段，它必须是布尔值。即使同时带有
	// 非成功 code，`success: "false"` 仍然是包络格式错误，不能把错误的
	// 类型当成明确业务拒绝，否则页面会收到错误的“外部服务拒绝”提示。
	if (hasSuccess && success !== false && success !== true) return false;
	if (success === false) return true;
	if (!Object.hasOwn(envelope, "code")) return false;
	const code = envelope.code;
	if (typeof code !== "string" && typeof code !== "number") return false;
	return !(code === 0 || code === "0" || code === "0000");
}

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
				"Zhongyang appointment response contained too many items",
				requestId,
			);
		}
		return value.map((item) => objectValue(item, operation, requestId));
	}
	const envelope = objectValue(value, operation, requestId);
	if (!hasSuccessfulBusinessEnvelope(envelope)) {
		throw providerError(
			operation,
			"Zhongyang appointment provider returned a business failure",
			requestId,
			!hasExplicitBusinessFailure(envelope),
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			operation,
			"Zhongyang appointment response data was invalid",
			requestId,
		);
	}
	if (envelope.data.length > maxItems) {
		throw providerError(
			operation,
			"Zhongyang appointment response contained too many items",
			requestId,
		);
	}
	return envelope.data.map((item) => objectValue(item, operation, requestId));
}

const RECORD_QUERY_FIELDS = new Set(["scope", "startDate", "endDate"]);

function invalidRecordQuery(operation: string, message: string): never {
	// service 层已经校验过 HTTP 输入，但 adapter 也可能被回放任务、Worker
	// 或未来组合根直接调用。这里把调用方错误挡在 Provider 之前，不能让
	// 未知 scope 变成 `requestChannel=undefined`，也不能让 all 意图带上
	// 日期后被 Provider 按另一种默认语义解释。
	throw providerError(operation, message, undefined, false);
}

/**
 * 预约记录 adapter 的运行时查询门禁。
 *
 * TypeScript 的 `AppointmentRecordQuery` 只在编译期存在；直接调用方仍可能
 * 传入 null、未知字段、非法日期或混合范围。这里重新投影为 canonical query，
 * 保证发给众阳的渠道和日期语义只有两种明确组合：在线 + 合法日期窗口，或
 * 全部 + 不带日期。HTTP/service 已经做过一次校验，但不能把 adapter 当作
 * 永远可信的最后一层。
 */
function normalizeRecordQuery(
	value: unknown,
	operation: string,
): AppointmentRecordQuery {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment query is invalid",
		);
	}
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((field) => !RECORD_QUERY_FIELDS.has(field))) {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment query contains an unknown field",
		);
	}

	const rawScope = record.scope;
	const scope: AppointmentRecordScope =
		rawScope === undefined
			? "online"
			: rawScope === "online" || rawScope === "all"
				? rawScope
				: invalidRecordQuery(
						operation,
						"Zhongyang appointment query scope is invalid",
					);

	if (scope === "all") {
		if (record.startDate !== undefined || record.endDate !== undefined) {
			return invalidRecordQuery(
				operation,
				"Zhongyang appointment all-scope query cannot include a date range",
			);
		}
		return { scope: "all" };
	}

	const startDate = record.startDate;
	const endDate = record.endDate;
	const start =
		typeof startDate === "string" ? parseIsoCalendarDate(startDate) : undefined;
	const end =
		typeof endDate === "string" ? parseIsoCalendarDate(endDate) : undefined;
	if (
		typeof startDate !== "string" ||
		typeof endDate !== "string" ||
		start === undefined ||
		end === undefined ||
		start > end
	) {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment online date range is invalid",
		);
	}
	return {
		...(rawScope === "online" ? { scope: "online" } : {}),
		startDate,
		endDate,
	};
}

/** 先校验 adapter 入参外壳，避免错误对象在属性读取时变成普通 TypeError。 */
function normalizeRecordInput(
	value: unknown,
	operation: string,
): { providerPatientId: string; query: AppointmentRecordQuery } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment record input is invalid",
		);
	}
	const record = value as Record<string, unknown>;
	if (
		Object.keys(record).some(
			(field) => field !== "providerPatientId" && field !== "query",
		)
	) {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment record input contains an unknown field",
		);
	}
	if (typeof record.providerPatientId !== "string") {
		return invalidRecordQuery(
			operation,
			"Zhongyang appointment provider patient reference is invalid",
		);
	}
	return {
		providerPatientId: record.providerPatientId,
		query: normalizeRecordQuery(record.query, operation),
	};
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

/**
 * 旧端分时段号源响应的逐项白名单映射。
 *
 * 旧页面的展示规则：`groupStart`/`groupEnd` 都存在且不同时显示时间段，
 * 否则显示 `workTime` 时间点。`sourceId` 是 provider 写入凭证，只在
 * adapter 内校验存在性后丢弃，绝不进入公共读模型或客户端路由。
 */
function mapSource(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentScheduleSource {
	// 校验 sourceId 存在只为确认响应形状；写入合同必须在服务端重新解析。
	requiredText(value.sourceId, "sourceId", operation, requestId, 128);
	const serialNumber = requiredInteger(
		value.serialNumber,
		"serialNumber",
		operation,
		requestId,
	);
	if (serialNumber < 0) {
		throw providerError(
			operation,
			"Zhongyang appointment source serialNumber is invalid",
			requestId,
		);
	}
	const workTime = optionalText(
		value.workTime,
		"workTime",
		operation,
		requestId,
		32,
	);
	const groupStart = optionalText(
		value.groupStart,
		"groupStart",
		operation,
		requestId,
		32,
	);
	const groupEnd = optionalText(
		value.groupEnd,
		"groupEnd",
		operation,
		requestId,
		32,
	);
	if (groupStart && groupEnd && groupStart !== groupEnd) {
		return {
			serialNumber: String(serialNumber),
			timeLabel: `${groupStart}-${groupEnd}`,
			timeGroup: "range",
		};
	}
	if (!workTime) {
		throw providerError(
			operation,
			"Zhongyang appointment source workTime is missing",
			requestId,
		);
	}
	return {
		serialNumber: String(serialNumber),
		timeLabel: workTime,
		timeGroup: "point",
	};
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

/**
 * `/first-depts` 的二级条目只允许进入挂号目录所需的关联键和展示名称。
 * 它和 `/schedulings/scheduling-depts` 的可预约科室是两种 Provider 事实，
 * 不能因为字段名相同就把简介、机构或 HIS 创建人字段混到公共目录中。
 */
function mapTreeDepartment(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentDepartment {
	return {
		departmentId: requiredText(value.deptId, "deptId", operation, requestId),
		displayName: requiredText(value.deptName, "deptName", operation, requestId),
	};
}

function mapDepartmentGroup(
	value: ProviderObject,
	operation: string,
	requestId: string,
): AppointmentDepartmentGroup {
	if (!Array.isArray(value.secondDeptList)) {
		throw providerError(
			operation,
			"Zhongyang appointment department tree secondDeptList is invalid",
			requestId,
		);
	}
	if (value.secondDeptList.length > MAX_APPOINTMENT_DEPARTMENT_ITEMS) {
		throw providerError(
			operation,
			"Zhongyang appointment department tree contained too many second departments",
			requestId,
		);
	}
	return {
		groupId: requiredText(
			value.firstDeptId,
			"firstDeptId",
			operation,
			requestId,
		),
		displayName: requiredText(
			value.firstDeptName,
			"firstDeptName",
			operation,
			requestId,
			256,
		),
		departments: value.secondDeptList.map((department) =>
			mapTreeDepartment(
				objectValue(department, operation, requestId),
				operation,
				requestId,
			),
		),
	};
}

/**
 * 一级/二级目录中二级 ID 必须在整棵树内唯一。
 *
 * 三级接口只接受二级 ID，而不是名称；如果 ID 同时属于两个一级分类，adapter
 * 无法安全决定应使用哪一个真实 `deptName` 检索排班科室，因此整批拒绝。
 */
function ensureUniqueDepartmentTreeIds(
	groups: readonly AppointmentDepartmentGroup[],
	operation: string,
	requestId: string,
): void {
	const groupIds = new Set<string>();
	const departmentIds = new Set<string>();
	let departmentCount = 0;
	for (const group of groups) {
		if (groupIds.has(group.groupId)) {
			throw providerError(
				operation,
				"Zhongyang appointment response contained duplicate first department ids",
				requestId,
			);
		}
		groupIds.add(group.groupId);
		departmentCount += group.departments.length;
		if (departmentCount > MAX_APPOINTMENT_DEPARTMENT_ITEMS) {
			throw providerError(
				operation,
				"Zhongyang appointment response contained too many second departments",
				requestId,
			);
		}
		for (const department of group.departments) {
			if (departmentIds.has(department.departmentId)) {
				throw providerError(
					operation,
					"Zhongyang appointment response contained duplicate second department ids",
					requestId,
				);
			}
			departmentIds.add(department.departmentId);
		}
	}
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
	// 旧端 doctorPic 是排班响应里的医生照片展示字段；空值合法，非空但
	// 不是完整 http(s) URL 时拒绝整批，不能把相对路径或脚本串带给 <image>。
	const rawDoctorPhotoUrl = optionalText(
		value.doctorPic,
		"doctorPic",
		operation,
		requestId,
		512,
	);
	if (rawDoctorPhotoUrl && !/^https?:\/\/[^\s]+$/u.test(rawDoctorPhotoUrl)) {
		throw providerError(
			operation,
			"Zhongyang appointment doctorPic is not a usable http(s) URL",
			requestId,
		);
	}
	const titleName = optionalText(
		value.postTitleName,
		"postTitleName",
		operation,
		requestId,
		128,
	);
	const introduction = optionalText(
		value.introduce,
		"introduce",
		operation,
		requestId,
		512,
	);
	const expertise = optionalText(
		value.specialty,
		"specialty",
		operation,
		requestId,
		255,
	);
	const departmentLocation = optionalText(
		value.deptAddr,
		"deptAddr",
		operation,
		requestId,
		256,
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
		...(titleName ? { titleName } : {}),
		...(introduction ? { introduction } : {}),
		...(expertise ? { expertise } : {}),
		...(departmentLocation ? { departmentLocation } : {}),
		doctorId: requiredText(value.docId, "docId", operation, requestId),
		doctorName: requiredText(value.docName, "docName", operation, requestId),
		...(rawDoctorPhotoUrl ? { doctorPhotoUrl: rawDoctorPhotoUrl } : {}),
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

function trace(
	operation: string,
	requestId: string,
	requestIds?: readonly string[],
): ExternalTrace {
	return {
		provider: "zhongyang",
		operation,
		requestId,
		...(requestIds && requestIds.length > 1 ? { requestIds } : {}),
	};
}

/**
 * 众阳 AMC 只读预约目录 adapter。
 *
 * 这里仅迁移科室和排班查询；锁号、预约写入、取消和挂号费都留在后续
 * contract 阶段。排班 provider id 只作为内部 adapter 事实返回，由 API
 * 组合边界替换为 opaque 平台 scheduleId 后才进入公共 response。
 */
export class ZhongyangAppointmentApiGateway
	implements
		AppointmentDirectoryGateway,
		AppointmentDepartmentTreeGateway,
		AppointmentRecordDirectoryGateway
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

	/**
	 * 读取旧挂号页的一级/二级目录。
	 *
	 * 渠道、当日挂号和查询模式由服务端冻结。调用方只能获得白名单投影，
	 * 不会把院区、就诊类型、名称或 Provider 的其它筛选参数带到旧端。
	 */
	private async requestDepartmentTree(
		context: AdapterCallContext,
		operation: string,
	): Promise<{
		groups: AppointmentDepartmentGroup[];
		requestId: string;
	}> {
		const url = new URL(DEPARTMENT_TREE_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", "3");
		url.searchParams.set("todayRegisterFlag", "0");
		url.searchParams.set("queryMode", "0");
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
		const groups = responseItems(
			response.data,
			operation,
			response.requestId,
			MAX_APPOINTMENT_DEPARTMENT_ITEMS,
		).map((item) => mapDepartmentGroup(item, operation, response.requestId));
		ensureUniqueDepartmentTreeIds(groups, operation, response.requestId);
		return { groups, requestId: response.requestId };
	}

	async listDepartments(
		input: AppointmentDepartmentQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-departments";
		const normalizedInput = normalizeDepartmentQuery(input);
		const url = new URL(DEPARTMENT_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
		// 众阳 AMC 的科室接口虽然返回科室列表，但仍要求带上有效的日期窗口；
		// 日期由 API 服务端生成，不能让小程序拼接 provider 查询参数。
		url.searchParams.set("startDate", normalizedInput.startDate);
		url.searchParams.set("endDate", normalizedInput.endDate);
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
			MAX_APPOINTMENT_DEPARTMENT_ITEMS,
		).map((item) => mapDepartment(item, operation, response.requestId));
		ensureUniqueDepartmentIds(departments, operation, response.requestId);
		return { departments, trace: trace(operation, response.requestId) };
	}

	async listDepartmentTree(context: AdapterCallContext) {
		const operation = "appointment-department-tree";
		const result = await this.requestDepartmentTree(context, operation);
		return {
			groups: result.groups,
			trace: trace(operation, result.requestId),
		};
	}

	async listClinicDepartments(
		input: AppointmentClinicDepartmentQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-clinic-departments";
		const normalizedInput = normalizeClinicDepartmentQuery(input);
		const tree = await this.requestDepartmentTree(context, operation);
		const parent = tree.groups
			.flatMap((group) => group.departments)
			.find(
				(department) =>
					department.departmentId === normalizedInput.parentDepartmentId,
			);
		if (!parent) {
			// 只接受当前服务端树中存在的二级 ID。未知/过期引用不得回退为
			// 客户端名称或空 searchCondition，否则会扩大成任意 Provider 检索。
			throw providerError(
				operation,
				"Zhongyang appointment parent department is not available",
				tree.requestId,
				false,
			);
		}

		const url = new URL(DEPARTMENT_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
		url.searchParams.set("startDate", normalizedInput.startDate);
		url.searchParams.set("endDate", normalizedInput.endDate);
		// 旧端只支持名称筛选；此名称严格来自刚刚验证的一级/二级目录，
		// 而不是 HTTP query、页面文本或任何 Provider 原样字段。
		url.searchParams.set("searchCondition", parent.displayName);
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
			MAX_APPOINTMENT_DEPARTMENT_ITEMS,
		).map((item) => mapDepartment(item, operation, response.requestId));
		ensureUniqueDepartmentIds(departments, operation, response.requestId);
		const requestIds =
			tree.requestId === response.requestId
				? undefined
				: [tree.requestId, response.requestId];
		return {
			departments,
			trace: trace(operation, response.requestId, requestIds),
		};
	}

	async listSchedules(
		input: AppointmentScheduleQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-schedules";
		const normalizedInput = normalizeScheduleQuery(input);
		const url = new URL(SCHEDULE_PATH, this.baseUrl);
		url.searchParams.set("requestChannel", REQUEST_CHANNEL);
		url.searchParams.set("startDate", normalizedInput.startDate);
		url.searchParams.set("endDate", normalizedInput.endDate);
		if (normalizedInput.departmentId)
			url.searchParams.set("deptId", normalizedInput.departmentId);
		if (normalizedInput.doctorId)
			url.searchParams.set("docId", normalizedInput.doctorId);
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
			MAX_APPOINTMENT_SCHEDULE_ITEMS,
		).map((item) => mapSchedule(item, operation, response.requestId));
		ensureUniqueScheduleIds(schedules, operation, response.requestId);
		return { schedules, trace: trace(operation, response.requestId) };
	}

	async listSources(
		input: AppointmentScheduleSourceQuery,
		context: AdapterCallContext,
	) {
		const operation = "appointment-schedule-sources";
		const providerScheduleId = requiredConfig(input?.providerScheduleId);
		// 与记录接口一样只接受服务端快照解析出的 provider 排班引用；
		// URL 编码防止引用中意外出现路径分隔符改变请求目标。
		const url = new URL(
			`${SCHEDULE_SOURCES_PATH}${encodeURIComponent(providerScheduleId)}`,
			this.baseUrl,
		);
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
		const sources = responseItems(
			response.data,
			operation,
			response.requestId,
			MAX_APPOINTMENT_SOURCE_ITEMS,
		).map((item) => mapSource(item, operation, response.requestId));
		return { sources, trace: trace(operation, response.requestId) };
	}

	async listRecords(
		input: {
			providerPatientId: string;
			query: AppointmentRecordQuery;
		},
		context: AdapterCallContext,
	) {
		const operation = "appointment-records";
		const normalizedInput = normalizeRecordInput(input, operation);
		const providerPatientId = requiredConfig(normalizedInput.providerPatientId);
		const url = new URL(
			`${RECORD_PATH}${encodeURIComponent(providerPatientId)}`,
			this.baseUrl,
		);
		const query = normalizedInput.query;
		const scope = query.scope ?? "online";
		url.searchParams.set("requestChannel", RECORD_REQUEST_CHANNELS[scope]);
		// 旧端的全部挂号调用渠道 4 时省略日期参数，Provider 才会返回
		// 完整历史；在线渠道仍必须携带平台限制的日期窗口。
		if (scope === "online") {
			url.searchParams.set("startDate", query.startDate ?? "");
			url.searchParams.set("endDate", query.endDate ?? "");
		}
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
			MAX_APPOINTMENT_RECORD_ITEMS,
		);
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
): AppointmentDirectoryGateway &
	AppointmentDepartmentTreeGateway &
	AppointmentRecordDirectoryGateway {
	return new ZhongyangAppointmentApiGateway(options);
}
