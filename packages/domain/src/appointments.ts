import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 患者端可展示的科室最小读模型；provider 机构字段不直接透传。 */
export type AppointmentDepartment = {
	departmentId: string;
	departmentCode?: string;
	displayName: string;
	location?: string;
};

/** 患者端可展示的排班详情；不包含 provider 标识或费用事实。 */
export type AppointmentScheduleDetails = {
	departmentId: string;
	departmentName: string;
	doctorId: string;
	doctorName: string;
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

export type AppointmentScheduleQuery = {
	startDate: string;
	endDate: string;
	departmentId?: string;
	doctorId?: string;
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

/** 只读排班目录将已验证结果写入快照仓储，供未来写入前做服务端复核。 */
export interface AppointmentScheduleSnapshotRepository {
	upsert(input: {
		schedule: AppointmentSchedule;
		provider: "zhongyang";
		providerScheduleId: string;
		providerRequestId: string;
		observedAt: string;
		expiresAt: string;
	}): Promise<AppointmentScheduleSnapshot>;
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
	| "unknown";

/** 患者端可展示的预约记录摘要，不含 provider 记录 id、支付字段或身份字段。 */
export type AppointmentRecord = {
	departmentName?: string;
	doctorName?: string;
	workDate: string;
	workTime?: string;
	location?: string;
	serialNumber?: string;
	status: AppointmentRecordStatus;
};

/** 预约记录查询必须有明确日期范围，避免把 provider 历史表当作无限导出接口。 */
export type AppointmentRecordQuery = {
	startDate: string;
	endDate: string;
};

/** 服务端先解析内部 patientId，再把短生命周期的 provider 引用交给 adapter。 */
export type AppointmentRecordDirectoryInput = {
	providerPatientId: string;
	query: AppointmentRecordQuery;
};

/** 预约读目录只允许通过服务端 provider adapter 访问。 */
export interface AppointmentDirectoryGateway {
	listDepartments(context: AdapterCallContext): Promise<{
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
