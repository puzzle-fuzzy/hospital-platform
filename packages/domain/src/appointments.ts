import { isAppointmentRecordWorkTime } from "@hospital/contracts";
import { parseIsoCalendarDate, parseStrictIsoInstant } from "./date-range";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 患者端可展示的科室最小读模型；provider 机构字段不直接透传。 */
export type AppointmentDepartment = {
	departmentId: string;
	departmentCode?: string;
	displayName: string;
	location?: string;
};

/**
 * 挂号页的一级目录及其二级科室。
 *
 * 这是独立于“可排班科室”扁平目录的展示层级：`groupId` 和二级
 * `departmentId` 都是 Provider 的受控引用，只能由服务端目录读取生成，
 * 不能把名称或任意搜索词作为后续 Provider 查询条件。
 */
export type AppointmentDepartmentGroup = {
	groupId: string;
	displayName: string;
	departments: AppointmentDepartment[];
};

/** 患者端可展示的排班详情；不包含 provider 标识或费用事实。 */
export type AppointmentScheduleDetails = {
	departmentId: string;
	departmentName: string;
	/** 旧端医生名片使用的受控职称、简介、擅长和科室位置字段。 */
	titleName?: string;
	introduction?: string;
	expertise?: string;
	departmentLocation?: string;
	doctorId: string;
	doctorName: string;
	/**
	 * 旧端 `doctorPic` 的受控照片展示字段：只允许完整 http(s) URL。
	 * 域名可用性由小程序平台的图片域名白名单约束，不接受相对路径、
	 * 任意协议或携带空白的值；空值合法（无图医生用占位展示）。
	 */
	doctorPhotoUrl?: string;
	workDate: string;
	shiftName: string;
	startTime?: string;
	endTime?: string;
	totalSlots: number;
	availableSlots: number;
	timeGroup: "point" | "range" | "unknown";
};

/**
 * 患者端公共排班读模型。
 *
 * `scheduleId` 是 API 生成的 opaque 平台引用；adapter 收到的 provider
 * schedule id 必须在 API 组合边界前被替换，不能作为客户端写入指令。
 */
export type AppointmentSchedule = AppointmentScheduleDetails & {
	scheduleId: string;
};

/** adapter 内部使用的排班事实；providerScheduleId 不得进入 contracts。 */
export type AppointmentProviderSchedule = AppointmentScheduleDetails & {
	providerScheduleId: string;
};

/**
 * 预约只读目录的单次资源上限。
 *
 * 这些是平台资源防护，不是医院业务上的科室、号源或历史记录数量上限，
 * 也不是 Provider 分页契约。超过上限必须整批拒绝，不能截断后把不完整
 * 的目录当作“暂无更多结果”；Provider 正式分页到位后再设计有界合并。
 */
export const MAX_APPOINTMENT_DEPARTMENT_ITEMS = 256;
export const MAX_APPOINTMENT_SCHEDULE_ITEMS = 512;
export const MAX_APPOINTMENT_RECORD_ITEMS = 512;
/**
 * 单个排班可返回的分时段号源上限。
 *
 * 这是平台资源防护，不是 Provider 的号源契约。超量必须整批拒绝，
 * 不能截断后把不完整的时段目录当作“当前可约时段”。
 */
export const MAX_APPOINTMENT_SOURCE_ITEMS = 512;

/**
 * 分时段号源的公共只读展示模型。
 *
 * 只保留旧端页面已确认的安全展示字段：挂号序号和归一化后的时段。
 * Provider 的 `sourceId` 只能留在 adapter 边界内，供未来写入合同在
 * 服务端重新解析；它不出现在公共读模型，客户端也不得提交它。
 */
export type AppointmentScheduleSource = {
	serialNumber: string;
	/** adapter 归一化后的时间点 HH:mm 或时间段 HH:mm-HH:mm。 */
	timeLabel: string;
	timeGroup: "point" | "range";
};

/**
 * 排班快照的服务端安全有效期上限。
 *
 * 当前只读目录 service 实际使用 60 秒，但 persistence/domain 入口不能只
 * 相信某一个调用方的常量。快照未来可能被预约命令复核；如果任意直接调用
 * 方把它写成数小时有效，过期的号源就会被误当成近期观察事实。这个上限是
 * 平台资源与安全边界，不是 Provider 的分页或预约合同；未来合同需要更长
 * 有效期时，必须同时重新审计预约写入前置条件和补充回归测试。
 */
export const MAX_APPOINTMENT_SNAPSHOT_TTL_MS = 5 * 60 * 1000;

/**
 * 预约目录/排班 gateway 结果违反公共读模型时使用的低敏原因。
 *
 * adapter 是 Provider 的第一道边界，但目录 gateway 仍然可以由回放实现、
 * 任务实现或未来真实网关注入。这里不能把 TypeScript 类型声明当成运行时
 * 事实，否则额外的患者字段、费用字段或非法号源数量可能先进入快照仓储。
 */
export type AppointmentDirectoryResultViolation =
	| "departments-not-array"
	| "departments-too-many"
	| "department-not-object"
	| "department-field-invalid"
	| "department-id-duplicate"
	| "department-groups-not-array"
	| "department-groups-too-many"
	| "department-group-not-object"
	| "department-group-field-invalid"
	| "department-group-id-duplicate"
	| "department-group-departments-not-array"
	| "schedules-not-array"
	| "schedules-too-many"
	| "schedule-not-object"
	| "schedule-field-invalid"
	| "work-date-invalid"
	| "schedule-work-date-outside-query"
	| "schedule-department-mismatch"
	| "schedule-doctor-mismatch"
	| "slot-count-invalid"
	| "time-group-invalid"
	| "provider-schedule-id-duplicate"
	/** service 生成的公共引用也属于读模型边界，不能信任生成器返回值。 */
	| "schedule-id-invalid"
	| "schedule-id-duplicate"
	| "sources-not-array"
	| "sources-too-many"
	| "source-not-object"
	| "source-field-invalid"
	| "source-serial-invalid"
	| "source-serial-duplicate"
	| "source-time-invalid";

/** 预约目录 gateway 的结果不满足平台只读 contract。 */
export class AppointmentDirectoryResultValidationError extends Error {
	readonly violation: AppointmentDirectoryResultViolation;

	constructor(violation: AppointmentDirectoryResultViolation) {
		super("Appointment directory provider result is invalid");
		this.name = "AppointmentDirectoryResultValidationError";
		this.violation = violation;
	}
}

function hasSafeAppointmentText(
	value: unknown,
	maxLength: number,
): value is string {
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

function invalidAppointmentDirectoryResult(
	violation: AppointmentDirectoryResultViolation,
): never {
	throw new AppointmentDirectoryResultValidationError(violation);
}

function optionalAppointmentText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!hasSafeAppointmentText(value, maxLength)) {
		invalidAppointmentDirectoryResult("department-field-invalid");
	}
	return value;
}

function requiredAppointmentText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
	violation: AppointmentDirectoryResultViolation,
): string {
	const value = record[field];
	if (!hasSafeAppointmentText(value, maxLength)) {
		invalidAppointmentDirectoryResult(violation);
	}
	return value;
}

/**
 * 校验并重新投影科室目录。
 *
 * 返回新对象而不是展开 gateway 条目，既防止 Provider 扩展字段进入 API，
 * 也保证重复科室 ID 不会让小程序级联选择状态指向不确定的同一个筛选键。
 */
export function normalizeAppointmentDepartmentResults(
	value: unknown,
): AppointmentDepartment[] {
	if (!Array.isArray(value)) {
		invalidAppointmentDirectoryResult("departments-not-array");
	}
	if (value.length > MAX_APPOINTMENT_DEPARTMENT_ITEMS) {
		// 不能截断科室目录：小程序的级联筛选会把截断结果当成完整科室事实。
		invalidAppointmentDirectoryResult("departments-too-many");
	}
	const departmentIds = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidAppointmentDirectoryResult("department-not-object");
		}
		const record = item as Record<string, unknown>;
		const departmentId = requiredAppointmentText(
			record,
			"departmentId",
			128,
			"department-field-invalid",
		);
		const displayName = requiredAppointmentText(
			record,
			"displayName",
			256,
			"department-field-invalid",
		);
		if (departmentIds.has(departmentId)) {
			invalidAppointmentDirectoryResult("department-id-duplicate");
		}
		departmentIds.add(departmentId);
		const departmentCode = optionalAppointmentText(
			record,
			"departmentCode",
			128,
		);
		const location = optionalAppointmentText(record, "location", 256);
		return {
			departmentId,
			...(departmentCode ? { departmentCode } : {}),
			displayName,
			...(location ? { location } : {}),
		};
	});
}

/**
 * 校验并重新投影一级/二级科室树。
 *
 * 第一层仅用于挂号页目录导航，第二层仍是服务端控制的 opaque 科室引用。
 * 这里不允许跨分组复用二级科室 ID：否则后续三级科室读取仅凭
 * `parentDepartmentId` 无法确定应使用哪一个真实名称，可能造成错误检索。
 */
export function normalizeAppointmentDepartmentGroupResults(
	value: unknown,
): AppointmentDepartmentGroup[] {
	if (!Array.isArray(value)) {
		invalidAppointmentDirectoryResult("department-groups-not-array");
	}
	if (value.length > MAX_APPOINTMENT_DEPARTMENT_ITEMS) {
		invalidAppointmentDirectoryResult("department-groups-too-many");
	}

	const groupIds = new Set<string>();
	const departmentIds = new Set<string>();
	let departmentCount = 0;

	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidAppointmentDirectoryResult("department-group-not-object");
		}
		const record = item as Record<string, unknown>;
		const groupId = requiredAppointmentText(
			record,
			"groupId",
			128,
			"department-group-field-invalid",
		);
		const displayName = requiredAppointmentText(
			record,
			"displayName",
			256,
			"department-group-field-invalid",
		);
		if (groupIds.has(groupId)) {
			invalidAppointmentDirectoryResult("department-group-id-duplicate");
		}
		groupIds.add(groupId);

		if (!Array.isArray(record.departments)) {
			invalidAppointmentDirectoryResult(
				"department-group-departments-not-array",
			);
		}
		departmentCount += record.departments.length;
		if (departmentCount > MAX_APPOINTMENT_DEPARTMENT_ITEMS) {
			invalidAppointmentDirectoryResult("departments-too-many");
		}

		const departments = record.departments.map((department) => {
			if (
				typeof department !== "object" ||
				department === null ||
				Array.isArray(department)
			) {
				invalidAppointmentDirectoryResult("department-not-object");
			}
			const departmentRecord = department as Record<string, unknown>;
			const departmentId = requiredAppointmentText(
				departmentRecord,
				"departmentId",
				128,
				"department-field-invalid",
			);
			const departmentDisplayName = requiredAppointmentText(
				departmentRecord,
				"displayName",
				256,
				"department-field-invalid",
			);
			if (departmentIds.has(departmentId)) {
				invalidAppointmentDirectoryResult("department-id-duplicate");
			}
			departmentIds.add(departmentId);
			return { departmentId, displayName: departmentDisplayName };
		});

		return { groupId, displayName, departments };
	});
}

/**
 * 校验并重新投影排班目录。
 *
 * 排班会在 service 层生成新的平台 `scheduleId`，因此这里保留的
 * `providerScheduleId` 只用于快照仓储，绝不能随着 schedule 一起返回给小程序。
 * 号源数量、日期和时间分组任一不合法都拒绝整批，不能筛掉坏排班后伪装成完整目录。
 */
export function normalizeAppointmentScheduleResults(
	value: unknown,
): AppointmentProviderSchedule[] {
	if (!Array.isArray(value)) {
		invalidAppointmentDirectoryResult("schedules-not-array");
	}
	if (value.length > MAX_APPOINTMENT_SCHEDULE_ITEMS) {
		// 排班还会生成平台 scheduleId 并写入短期快照；超量必须在这些副作用前失败。
		invalidAppointmentDirectoryResult("schedules-too-many");
	}
	const providerScheduleIds = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidAppointmentDirectoryResult("schedule-not-object");
		}
		const record = item as Record<string, unknown>;
		const providerScheduleId = requiredAppointmentText(
			record,
			"providerScheduleId",
			128,
			"schedule-field-invalid",
		);
		const departmentId = requiredAppointmentText(
			record,
			"departmentId",
			128,
			"schedule-field-invalid",
		);
		const departmentName = requiredAppointmentText(
			record,
			"departmentName",
			256,
			"schedule-field-invalid",
		);
		const titleName = optionalAppointmentScheduleText(record, "titleName", 128);
		const introduction = optionalAppointmentScheduleText(
			record,
			"introduction",
			512,
		);
		const expertise = optionalAppointmentScheduleText(record, "expertise", 255);
		const departmentLocation = optionalAppointmentScheduleText(
			record,
			"departmentLocation",
			256,
		);
		const doctorId = requiredAppointmentText(
			record,
			"doctorId",
			128,
			"schedule-field-invalid",
		);
		const doctorName = requiredAppointmentText(
			record,
			"doctorName",
			256,
			"schedule-field-invalid",
		);
		const shiftName = requiredAppointmentText(
			record,
			"shiftName",
			128,
			"schedule-field-invalid",
		);
		if (providerScheduleIds.has(providerScheduleId)) {
			invalidAppointmentDirectoryResult("provider-schedule-id-duplicate");
		}
		providerScheduleIds.add(providerScheduleId);
		const workDate = requiredAppointmentText(
			record,
			"workDate",
			32,
			"work-date-invalid",
		);
		if (parseIsoCalendarDate(workDate) === undefined) {
			invalidAppointmentDirectoryResult("work-date-invalid");
		}
		const startTime = optionalAppointmentScheduleText(record, "startTime", 32);
		const endTime = optionalAppointmentScheduleText(record, "endTime", 32);
		const doctorPhotoUrl = optionalAppointmentDoctorPhotoUrl(record);
		const totalSlots = record.totalSlots;
		const availableSlots = record.availableSlots;
		if (
			typeof totalSlots !== "number" ||
			typeof availableSlots !== "number" ||
			!Number.isSafeInteger(totalSlots) ||
			!Number.isSafeInteger(availableSlots) ||
			totalSlots < 0 ||
			availableSlots < 0 ||
			availableSlots > totalSlots
		) {
			invalidAppointmentDirectoryResult("slot-count-invalid");
		}
		const timeGroup: AppointmentSchedule["timeGroup"] =
			record.timeGroup === "point" ||
			record.timeGroup === "range" ||
			record.timeGroup === "unknown"
				? record.timeGroup
				: invalidAppointmentDirectoryResult("time-group-invalid");
		return {
			providerScheduleId,
			departmentId,
			departmentName,
			...(titleName ? { titleName } : {}),
			...(introduction ? { introduction } : {}),
			...(expertise ? { expertise } : {}),
			...(departmentLocation ? { departmentLocation } : {}),
			doctorId,
			doctorName,
			workDate,
			shiftName,
			...(doctorPhotoUrl ? { doctorPhotoUrl } : {}),
			...(startTime ? { startTime } : {}),
			...(endTime ? { endTime } : {}),
			totalSlots,
			availableSlots,
			timeGroup,
		};
	});
}

/** 医生照片只接受完整 http(s) URL；空值合法（无图医生由页面占位展示）。 */
function optionalAppointmentDoctorPhotoUrl(
	record: Record<string, unknown>,
): string | undefined {
	const value = record.doctorPhotoUrl;
	if (value === undefined || value === null || value === "") return undefined;
	if (
		typeof value !== "string" ||
		value.length > 512 ||
		!/^https?:\/\/[^\s]+$/u.test(value)
	) {
		invalidAppointmentDirectoryResult("schedule-field-invalid");
	}
	return value;
}

function optionalAppointmentScheduleText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!hasSafeAppointmentText(value, maxLength)) {
		invalidAppointmentDirectoryResult("schedule-field-invalid");
	}
	return value;
}

/**
 * 校验并重新投影单个排班的分时段号源。
 *
 * 时段展示沿用预约记录 `workTime` 的同一运行时判定：时间点或起止合法的时间段。
 * 任何一条坏号源都拒绝整批，避免页面把不完整时段当成当前可约事实；
 * 重复挂号序号同样拒绝，否则选择态会指向不确定的时段。
 */
export function normalizeAppointmentScheduleSourceResults(
	value: unknown,
): AppointmentScheduleSource[] {
	if (!Array.isArray(value)) {
		invalidAppointmentDirectoryResult("sources-not-array");
	}
	if (value.length > MAX_APPOINTMENT_SOURCE_ITEMS) {
		invalidAppointmentDirectoryResult("sources-too-many");
	}
	const serialNumbers = new Set<string>();
	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidAppointmentDirectoryResult("source-not-object");
		}
		const record = item as Record<string, unknown>;
		const serialNumber = requiredAppointmentText(
			record,
			"serialNumber",
			32,
			"source-serial-invalid",
		);
		if (serialNumbers.has(serialNumber)) {
			invalidAppointmentDirectoryResult("source-serial-duplicate");
		}
		serialNumbers.add(serialNumber);
		const timeLabel = requiredAppointmentText(
			record,
			"timeLabel",
			32,
			"source-field-invalid",
		);
		if (!isAppointmentRecordWorkTime(timeLabel)) {
			invalidAppointmentDirectoryResult("source-time-invalid");
		}
		const timeGroup: AppointmentScheduleSource["timeGroup"] =
			record.timeGroup === "point" || record.timeGroup === "range"
				? record.timeGroup
				: invalidAppointmentDirectoryResult("source-field-invalid");
		return { serialNumber, timeLabel, timeGroup };
	});
}

export type AppointmentScheduleQuery = {
	startDate: string;
	endDate: string;
	departmentId?: string;
	doctorId?: string;
};

/** 科室目录同样需要日期窗口，但不允许客户端直接透传 provider 参数。 */
export type AppointmentDepartmentQuery = Pick<
	AppointmentScheduleQuery,
	"startDate" | "endDate"
>;

/**
 * 三级可预约科室查询的服务端输入。
 *
 * `parentDepartmentId` 来自一级/二级树的受控二级引用；adapter 必须先重新
 * 从树中解析其名称，再把该名称作为旧 Provider 的 searchCondition。客户端
 * 不得提交名称或其它 Provider 检索字段。
 */
export type AppointmentClinicDepartmentQuery = AppointmentDepartmentQuery & {
	parentDepartmentId: string;
};

/**
 * 服务端观察到的排班快照。
 *
 * 这个事实把“provider 曾经返回过一个排班”与“客户端提交了一个
 * scheduleId”区分开来。当前它只支撑只读目录和后续合同审计，不能单独
 * 授权锁号、预约或支付；写入开放前仍必须补齐 sourceId、TTL 和 provider
 * 写入合同的完整校验。
 */
export type AppointmentScheduleSnapshot = {
	scheduleId: string;
	provider: "zhongyang";
	/** provider 引用只存在服务端持久化边界，不进入 API response。 */
	providerScheduleId: string;
	schedule: AppointmentSchedule;
	providerRequestId: string;
	observedAt: string;
	expiresAt: string;
};

/** 排班快照写入端口的明确输入，供内存和 MySQL 实现共享同一校验。 */
export type AppointmentScheduleSnapshotInput = {
	schedule: AppointmentSchedule;
	provider: "zhongyang";
	providerScheduleId: string;
	providerRequestId: string;
	observedAt: string;
	expiresAt: string;
};

export type AppointmentScheduleSnapshotValidationReason =
	| "invalid_reference"
	| "invalid_provider"
	| "invalid_schedule"
	| "invalid_work_date"
	| "invalid_slot_counts"
	| "invalid_observation_window";

export class AppointmentScheduleSnapshotValidationError extends Error {
	readonly reason: AppointmentScheduleSnapshotValidationReason;

	constructor(reason: AppointmentScheduleSnapshotValidationReason) {
		super(`Invalid appointment schedule snapshot: ${reason}`);
		this.name = "AppointmentScheduleSnapshotValidationError";
		this.reason = reason;
	}
}

/**
 * 快照是未来写入链路的安全前置事实，不能只依赖 MySQL 列类型保护。
 * 这里统一校验 opaque/provider 引用、provider 请求追踪号、工作日、号源
 * 数量和 TTL；任何失败都在 persistence 边界前 fail-closed。
 */
export function validateAppointmentScheduleSnapshot(
	input: AppointmentScheduleSnapshotInput,
): void {
	// persistence 入口也可能被任务、回放器或错误的组合根直接调用；不能
	// 依赖 TypeScript 的非空类型，否则 null/数组会在读取字段时抛出无上下文
	// 的 TypeError，或者把不完整的排班事实交给 SQL 层自行截断。
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new AppointmentScheduleSnapshotValidationError("invalid_reference");
	}
	const runtimeInput = input as unknown as Record<string, unknown>;
	if (runtimeInput.provider !== "zhongyang") {
		throw new AppointmentScheduleSnapshotValidationError("invalid_provider");
	}
	const runtimeSchedule = runtimeInput.schedule;
	if (
		typeof runtimeSchedule !== "object" ||
		runtimeSchedule === null ||
		Array.isArray(runtimeSchedule)
	) {
		throw new AppointmentScheduleSnapshotValidationError("invalid_schedule");
	}
	const schedule = runtimeSchedule as Record<string, unknown>;
	const requiredScheduleTexts: readonly [unknown, number][] = [
		[schedule.scheduleId, 128],
		[schedule.departmentId, 128],
		[schedule.departmentName, 256],
		[schedule.doctorId, 128],
		[schedule.doctorName, 256],
		[schedule.workDate, 32],
		[schedule.shiftName, 128],
	];
	const optionalScheduleTexts: readonly [unknown, number][] = [
		[schedule.titleName, 128],
		[schedule.introduction, 512],
		[schedule.expertise, 255],
		[schedule.departmentLocation, 256],
	];
	if (
		requiredScheduleTexts.some(
			([value, maxLength]) => !hasSafeAppointmentText(value, maxLength),
		) ||
		optionalScheduleTexts.some(
			([value, maxLength]) =>
				value !== undefined && !hasSafeAppointmentText(value, maxLength),
		) ||
		(schedule.doctorPhotoUrl !== undefined &&
			schedule.doctorPhotoUrl !== null &&
			(typeof schedule.doctorPhotoUrl !== "string" ||
				schedule.doctorPhotoUrl.length > 512 ||
				!/^https?:\/\/[^\s]+$/u.test(schedule.doctorPhotoUrl))) ||
		(schedule.startTime !== undefined &&
			!hasSafeAppointmentText(schedule.startTime, 32)) ||
		(schedule.endTime !== undefined &&
			!hasSafeAppointmentText(schedule.endTime, 32)) ||
		(schedule.timeGroup !== "point" &&
			schedule.timeGroup !== "range" &&
			schedule.timeGroup !== "unknown")
	) {
		// 这些字段会被保存并在未来复核/展示；快照边界必须和 adapter/service
		// 的公开读模型使用同一套文本、时间分组规则，不能只依赖 VARCHAR 列型。
		throw new AppointmentScheduleSnapshotValidationError("invalid_schedule");
	}

	const references = [
		{ value: schedule.scheduleId, maxLength: 128 },
		{ value: runtimeInput.providerScheduleId, maxLength: 128 },
		{ value: runtimeInput.providerRequestId, maxLength: 256 },
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
		// 快照会在未来写入前作为服务端事实复用；控制字符会破坏数据库
		// 检索、日志关联和下游请求边界，不能只依赖列长度把它保存下来。
		throw new AppointmentScheduleSnapshotValidationError("invalid_reference");
	}
	if (parseIsoCalendarDate(schedule.workDate as string) === undefined) {
		throw new AppointmentScheduleSnapshotValidationError("invalid_work_date");
	}
	if (
		!Number.isSafeInteger(schedule.totalSlots) ||
		!Number.isSafeInteger(schedule.availableSlots) ||
		(schedule.totalSlots as number) < 0 ||
		(schedule.availableSlots as number) < 0 ||
		(schedule.availableSlots as number) > (schedule.totalSlots as number)
	) {
		throw new AppointmentScheduleSnapshotValidationError("invalid_slot_counts");
	}
	// 排班快照的有效期是“最近 Provider 事实”的边界，不能只依赖
	// Date.parse；非法日历日期被自动进位后会改变 TTL 和页面可见状态。
	const observedAt =
		typeof runtimeInput.observedAt === "string"
			? parseStrictIsoInstant(runtimeInput.observedAt)
			: undefined;
	const expiresAt =
		typeof runtimeInput.expiresAt === "string"
			? parseStrictIsoInstant(runtimeInput.expiresAt)
			: undefined;
	const observedAtMillis = observedAt ?? Number.NaN;
	const expiresAtMillis = expiresAt ?? Number.NaN;
	if (
		!Number.isFinite(observedAtMillis) ||
		!Number.isFinite(expiresAtMillis) ||
		expiresAtMillis <= observedAtMillis ||
		expiresAtMillis - observedAtMillis > MAX_APPOINTMENT_SNAPSHOT_TTL_MS
	) {
		// 过长 TTL 和非递进时间都属于同一观察窗口错误：它们都不能形成
		// “近期 Provider 事实”。服务层当前写入 60 秒，domain 再加上硬上限，
		// 防止未来新增调用方绕过服务层常量延长快照寿命。
		throw new AppointmentScheduleSnapshotValidationError(
			"invalid_observation_window",
		);
	}
}

/** 只读排班目录将已验证结果写入快照仓储，供未来写入前做服务端复核。 */
export interface AppointmentScheduleSnapshotRepository {
	upsert(
		input: AppointmentScheduleSnapshotInput,
	): Promise<AppointmentScheduleSnapshot>;
	findActive(
		scheduleId: string,
		now: string,
	): Promise<AppointmentScheduleSnapshot | undefined>;
}

/**
 * 预约记录只读状态。
 *
 * provider 的数字状态只在 adapter 内映射到这里；未知值保留为 unknown，
 * 不能让客户端根据未验证的 provider 数字自行推导支付或就诊事实。
 */
export type AppointmentRecordStatus =
	| "scheduled"
	| "cancelled"
	| "completed"
	| "missed"
	| "stopped"
	| "substituted"
	| "registered"
	| "unknown";

/**
 * 患者端可展示的预约记录摘要，不含 provider 记录 id、支付字段或身份字段。
 * adapter 会在保留摘要前拒绝同一响应中的重复 provider 预约号，但不会为
 * 缺少预约号的摘要伪造公共业务 ID。
 */
export type AppointmentRecord = {
	departmentName?: string;
	doctorName?: string;
	workDate: string;
	/** adapter 归一化后的时间点 HH:mm 或时间段 HH:mm-HH:mm。 */
	workTime?: string;
	location?: string;
	serialNumber?: string;
	status: AppointmentRecordStatus;
};

/**
 * 预约记录网关结果违反公共读模型时使用的低敏原因。
 *
 * adapter 是第一道 Provider 白名单边界，但 `AppointmentRecordDirectoryGateway`
 * 仍然是可注入端口；真实网关、回放网关或未来任务实现都不能仅凭 TypeScript
 * 类型被 service 当作可信事实。原因固定为有限枚举，日志可以检索，错误响应
 * 不需要携带 Provider 原文、患者号或预约号。
 */
export type AppointmentRecordResultViolation =
	| "records-not-array"
	| "records-too-many"
	| "record-not-object"
	| "work-date-invalid"
	| "work-date-outside-query"
	| "status-invalid"
	| "work-time-invalid"
	| "display-text-invalid";

/** Provider 结果二次校验错误；它属于上游读模型异常，不是患者输入错误。 */
export class AppointmentRecordResultValidationError extends Error {
	readonly violation: AppointmentRecordResultViolation;

	constructor(violation: AppointmentRecordResultViolation) {
		super("Appointment record provider result is invalid");
		this.name = "AppointmentRecordResultValidationError";
		this.violation = violation;
	}
}

/** 供 service 在运行时确认已归一化的预约状态，不接受任意字符串。 */
export function isAppointmentRecordStatus(
	value: unknown,
): value is AppointmentRecordStatus {
	return (
		value === "scheduled" ||
		value === "cancelled" ||
		value === "completed" ||
		value === "missed" ||
		value === "stopped" ||
		value === "substituted" ||
		value === "registered" ||
		value === "unknown"
	);
}

function hasSafeRecordText(value: unknown, maxLength: number): value is string {
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

function invalidRecordResult(
	violation: AppointmentRecordResultViolation,
): never {
	throw new AppointmentRecordResultValidationError(violation);
}

function optionalRecordText(
	record: Record<string, unknown>,
	field: string,
	maxLength: number,
): string | undefined {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!hasSafeRecordText(value, maxLength)) {
		invalidRecordResult("display-text-invalid");
	}
	return value;
}

/**
 * 预约时间是旧端已经确认的业务字段，不是普通备注文本。
 *
 * 这里与 contracts 的公开 schema 共用同一个运行时判定：即使 gateway 绕过
 * Elysia 或 adapter 直接返回对象，也不能把完整日期、任意中文或倒序时段
 * 交给页面。缺失时间仍然合法，因为部分历史记录没有可展示的时间字段。
 */
function optionalRecordWorkTime(
	record: Record<string, unknown>,
): string | undefined {
	const value = record.workTime;
	if (value === undefined) return undefined;
	if (!isAppointmentRecordWorkTime(value)) {
		invalidRecordResult("work-time-invalid");
	}
	return value;
}

/**
 * 校验并重新投影预约记录读模型。
 *
 * 不能只返回 `result.records` 的浅拷贝：网关对象即使被 TypeScript 标注为
 * `AppointmentRecord`，运行时仍可能携带 `patId`、`appointmentInfoId`、费用
 * 或支付字段。这里整批校验后只构造公共字段；任何一条坏记录都会拒绝整批，
 * 不能过滤坏行再把不完整结果伪装成成功。
 */
export function normalizeAppointmentRecordResults(
	value: unknown,
): AppointmentRecord[] {
	if (!Array.isArray(value)) invalidRecordResult("records-not-array");
	if (value.length > MAX_APPOINTMENT_RECORD_ITEMS) {
		// 历史记录不能截断后伪装成完整“我的挂号”，否则患者会误判没有更早记录。
		invalidRecordResult("records-too-many");
	}

	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalidRecordResult("record-not-object");
		}
		const record = item as Record<string, unknown>;
		if (
			typeof record.workDate !== "string" ||
			parseIsoCalendarDate(record.workDate) === undefined
		) {
			invalidRecordResult("work-date-invalid");
		}
		if (!isAppointmentRecordStatus(record.status)) {
			invalidRecordResult("status-invalid");
		}

		const departmentName = optionalRecordText(record, "departmentName", 128);
		const doctorName = optionalRecordText(record, "doctorName", 128);
		const workTime = optionalRecordWorkTime(record);
		const location = optionalRecordText(record, "location", 256);
		const serialNumber = optionalRecordText(record, "serialNumber", 64);

		return {
			...(departmentName ? { departmentName } : {}),
			...(doctorName ? { doctorName } : {}),
			workDate: record.workDate,
			...(workTime ? { workTime } : {}),
			...(location ? { location } : {}),
			...(serialNumber ? { serialNumber } : {}),
			status: record.status,
		};
	});
}

/** 预约记录对应旧端的两个只读渠道；渠道由服务端选择，不能透传 Provider 数字。 */
export type AppointmentRecordScope = "online" | "all";

/**
 * 预约记录查询契约。
 *
 * 在线挂号使用微信渠道并带有服务端限制的日期窗口；全部挂号使用旧端
 * 已核实的渠道 4，Provider 端点不带日期参数，以保留历史记录。两种意图
 * 在领域层明确区分，避免把同一批在线结果在客户端复制成“全部挂号”。
 */
export type AppointmentRecordQuery = {
	scope?: AppointmentRecordScope;
	startDate?: string;
	endDate?: string;
};

/** 服务端先解析内部 patientId，再把短生命周期的 provider 引用交给 adapter。 */
export type AppointmentRecordDirectoryInput = {
	providerPatientId: string;
	query: AppointmentRecordQuery;
};

/** 预约读目录只允许通过服务端 provider adapter 访问。 */
export interface AppointmentDirectoryGateway {
	listDepartments(
		input: AppointmentDepartmentQuery,
		context: AdapterCallContext,
	): Promise<{
		departments: readonly AppointmentDepartment[];
		trace: ExternalTrace;
	}>;
	listSchedules(
		input: AppointmentScheduleQuery,
		context: AdapterCallContext,
	): Promise<{
		schedules: readonly AppointmentProviderSchedule[];
		trace: ExternalTrace;
	}>;
	/**
	 * 读取单个排班的分时段号源（可选能力）。
	 *
	 * 输入是服务端快照中保存的 provider 排班引用；网关返回的号源只包含
	 * 公共展示字段。Provider 号源 ID 与锁号状态不出网关，未来写入合同
	 * 必须在服务端重新解析并校验，不能依赖这次只读结果。未实现该能力
	 * 的网关保持 undefined，service 必须 fail-closed。
	 */
	listSources?(
		input: AppointmentScheduleSourceQuery,
		context: AdapterCallContext,
	): Promise<{
		sources: readonly AppointmentScheduleSource[];
		trace: ExternalTrace;
	}>;
}

/** 分时段号源查询只接受服务端解析出的 provider 排班引用。 */
export type AppointmentScheduleSourceQuery = {
	providerScheduleId: string;
};

/**
 * 一级/二级目录和其下三级可预约科室的独立读取能力。
 *
 * 保持它与既有扁平 `AppointmentDirectoryGateway` 分离，避免新目录协议改变
 * 已发布的 `/appointments/departments` 公共响应。
 */
export interface AppointmentDepartmentTreeGateway {
	listDepartmentTree(context: AdapterCallContext): Promise<{
		groups: readonly AppointmentDepartmentGroup[];
		trace: ExternalTrace;
	}>;
	listClinicDepartments(
		input: AppointmentClinicDepartmentQuery,
		context: AdapterCallContext,
	): Promise<{
		departments: readonly AppointmentDepartment[];
		trace: ExternalTrace;
	}>;
}

/** 预约历史独立于 AMC 排班目录，使用单独的 provider endpoint 和验收边界。 */
export interface AppointmentRecordDirectoryGateway {
	listRecords(
		input: AppointmentRecordDirectoryInput,
		context: AdapterCallContext,
	): Promise<{
		records: readonly AppointmentRecord[];
		trace: ExternalTrace;
	}>;
}
