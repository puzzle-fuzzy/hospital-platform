import type { AdapterCallContext, ExternalTrace } from "./ports";

/**
 * 预约写入所需的完整患者资料只允许在 server -> provider 的短调用帧内出现。
 * 它不是公共 API 读模型，也不能进入日志、持久化或小程序响应。
 */
export type AppointmentRegistrationPatient = {
	providerPatientId: string;
	name: string;
	cardNo: string;
	idNo: string;
	phone: string;
};

/** 服务端从排班快照和号源响应拼出的写入目标。 */
export type AppointmentRegistrationTarget = {
	scheduleId: string;
	providerScheduleId: string;
	departmentId: string;
	departmentName: string;
	doctorId: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	sourceSerialNumber: string;
	providerSourceId: string;
};

export type AppointmentProviderRecord = {
	providerAppointmentId: string;
	providerPatientId: string;
	departmentName: string;
	workDate: string;
	status: "active" | "cancelled" | "completed" | "unknown";
	providerRegisterId?: string;
	providerHisRegisterId?: string;
};

export type AppointmentHoldStatus =
	| "held"
	| "consumed"
	| "cancelled"
	| "expired";

export type AppointmentHold = {
	holdId: string;
	ownerUserId: string;
	patientId: string;
	scheduleId: string;
	providerScheduleId: string;
	providerSourceId: string;
	sourceSerialNumber: string;
	totalFen: number;
	status: AppointmentHoldStatus;
	idempotencyKey: string;
	expiresAt: string;
	createdAt: string;
	updatedAt: string;
};

export type AppointmentRegistrationStatus = "booked" | "cancelled" | "unknown";

/** 取消预约必须依赖这个服务端映射，不能把 provider appointment id 交给小程序。 */
export type AppointmentRegistration = {
	appointmentId: string;
	ownerUserId: string;
	patientId: string;
	holdId: string;
	idempotencyKey: string;
	providerAppointmentId: string;
	providerPatientId: string;
	providerRegisterId?: string;
	providerHisRegisterId?: string;
	departmentId?: string;
	doctorId?: string;
	departmentName: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	sourceSerialNumber: string;
	totalFen: number;
	status: AppointmentRegistrationStatus;
	createdAt: string;
	updatedAt: string;
};

/** 预约命令所需的 server-side patient identity resolution。 */
export interface AppointmentPatientProfileGateway {
	resolve(
		input: { unionId: string; providerPatientId: string },
		context: AdapterCallContext,
	): Promise<{
		patient: AppointmentRegistrationPatient;
		trace: ExternalTrace;
	}>;
}

/**
 * 预约写入 provider 边界。
 *
 * `resolveSource` 会重新读取并校验指定排班的号源；客户端只提交 opaque
 * scheduleId 和序号，永远不能提交 sourceId、patId 或金额。
 */
export interface AppointmentWriteGateway {
	resolveSource(
		input: {
			providerScheduleId: string;
			sourceSerialNumber: string;
		},
		context: AdapterCallContext,
	): Promise<{
		providerSourceId: string;
		sourceSerialNumber: string;
		expiresAt?: string;
		trace: ExternalTrace;
	}>;
	getFactRegisterFee(
		input: { providerScheduleId: string; providerPatientId: string },
		context: AdapterCallContext,
	): Promise<{ totalFen: number; trace: ExternalTrace }>;
	listActive(
		input: { providerPatientId: string; workDate: string },
		context: AdapterCallContext,
	): Promise<{
		records: readonly AppointmentProviderRecord[];
		trace: ExternalTrace;
	}>;
	create(
		input: {
			patient: AppointmentRegistrationPatient;
			target: AppointmentRegistrationTarget;
			totalFen: number;
			recordId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		providerAppointmentId: string;
		providerRegisterId?: string;
		providerHisRegisterId?: string;
		trace: ExternalTrace;
	}>;
	cancel(
		input: {
			providerPatientId: string;
			providerAppointmentId: string;
		},
		context: AdapterCallContext,
	): Promise<{ trace: ExternalTrace }>;
}

/** 预约写入结果的 owner-scoped 持久化边界。 */
export interface AppointmentWriteRepository {
	findHold(
		ownerUserId: string,
		holdId: string,
	): Promise<AppointmentHold | undefined>;
	findHoldByIdempotency(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<AppointmentHold | undefined>;
	insertHold(hold: AppointmentHold): Promise<AppointmentHold>;
	updateHold(
		hold: AppointmentHold,
		expectedStatus?: AppointmentHoldStatus,
	): Promise<AppointmentHold | undefined>;
	findRegistration(
		ownerUserId: string,
		appointmentId: string,
	): Promise<AppointmentRegistration | undefined>;
	findRegistrationByIdempotency(
		ownerUserId: string,
		idempotencyKey: string,
	): Promise<AppointmentRegistration | undefined>;
	findActiveRegistration(input: {
		ownerUserId: string;
		patientId: string;
		workDate: string;
		departmentName: string;
	}): Promise<AppointmentRegistration | undefined>;
	insertRegistration(
		registration: AppointmentRegistration,
	): Promise<AppointmentRegistration>;
	updateRegistration(
		registration: AppointmentRegistration,
		expectedStatus?: AppointmentRegistrationStatus,
	): Promise<AppointmentRegistration | undefined>;
}
