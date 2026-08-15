import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 患者端可展示的科室最小读模型；provider 机构字段不直接透传。 */
export type AppointmentDepartment = {
	departmentId: string;
	departmentCode?: string;
	displayName: string;
	location?: string;
};

/**
 * 患者端可展示的排班最小读模型。
 *
 * 挂号费暂不进入该模型：旧 provider 的金额单位和最终结算语义尚未取得
 * 新合同确认，不能把一个未验证的数字误当成人民币分或支付权威。
 */
export type AppointmentSchedule = {
	scheduleId: string;
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

export type AppointmentScheduleQuery = {
	startDate: string;
	endDate: string;
	departmentId?: string;
	doctorId?: string;
};

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
		schedules: readonly AppointmentSchedule[];
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
