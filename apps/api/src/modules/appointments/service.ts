import type {
	AppointmentDepartmentListPayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentDirectoryGateway,
	type AppointmentRecordDirectoryGateway,
	type AppointmentRecordQuery,
	type AppointmentScheduleQuery,
	DependencyNotConfiguredError,
	type PatientRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type AppointmentServiceDependencies = {
	directory: AppointmentDirectoryGateway;
	/** 记录查询需要 owner-scoped provider mapping；目录查询不依赖该 repository。 */
	repository?: PatientRepository;
	records?: AppointmentRecordDirectoryGateway;
	logger?: AppLogger;
};

/** 防止小程序把 provider 排班接口当作无限范围的数据导出端点。 */
const MAX_SCHEDULE_RANGE_DAYS = 31;
const MAX_RECORD_RANGE_DAYS = 366;

export class AppointmentScheduleQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AppointmentScheduleQueryError";
	}
}

export class AppointmentRecordQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AppointmentRecordQueryError";
	}
}

export class AppointmentRecordPatientNotFoundError extends Error {
	constructor() {
		super("Appointment record patient is not available");
		this.name = "AppointmentRecordPatientNotFoundError";
	}
}

function validateScheduleQuery(input: AppointmentScheduleQuery): void {
	const start = Date.parse(`${input.startDate}T00:00:00.000Z`);
	const end = Date.parse(`${input.endDate}T00:00:00.000Z`);
	const maxRangeMs = MAX_SCHEDULE_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		throw new AppointmentScheduleQueryError("Schedule date range is invalid");
	}
	if (end - start > maxRangeMs) {
		throw new AppointmentScheduleQueryError(
			`Schedule date range cannot exceed ${MAX_SCHEDULE_RANGE_DAYS} days`,
		);
	}
}

function validateRecordQuery(input: AppointmentRecordQuery): void {
	const start = Date.parse(`${input.startDate}T00:00:00.000Z`);
	const end = Date.parse(`${input.endDate}T00:00:00.000Z`);
	const maxRangeMs = MAX_RECORD_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
		throw new AppointmentRecordQueryError(
			"Appointment record date range is invalid",
		);
	}
	if (end - start > maxRangeMs) {
		throw new AppointmentRecordQueryError(
			`Appointment record date range cannot exceed ${MAX_RECORD_RANGE_DAYS} days`,
		);
	}
}

/**
 * 预约目录应用服务。
 *
 * 这里只读 provider 的科室/排班目录，不接收 patientId、挂号费或支付状态；
 * 预约写入必须在取得完整 provider contract 后另建命令模型。
 */
export class AppointmentService {
	private readonly logger: AppLogger;

	constructor(private readonly dependencies: AppointmentServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async listDepartments(
		context: AdapterCallContext,
	): Promise<AppointmentDepartmentListPayload["data"]> {
		this.logger.info(
			{
				event: "appointment.directory.departments.requested",
				traceId: context.traceId,
				provider: "zhongyang",
			},
			"Appointment department directory requested",
		);
		try {
			const result = await this.dependencies.directory.listDepartments(context);
			this.logger.info(
				{
					event: "appointment.directory.departments.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					itemCount: result.departments.length,
				},
				"Appointment department directory loaded",
			);
			return {
				items: [...result.departments],
				total: result.departments.length,
			};
		} catch (error) {
			this.logFailure(context, error, "departments");
			throw error;
		}
	}

	async listSchedules(
		input: AppointmentScheduleQuery,
		context: AdapterCallContext,
	): Promise<AppointmentScheduleListPayload["data"]> {
		validateScheduleQuery(input);
		this.logger.info(
			{
				event: "appointment.directory.schedules.requested",
				traceId: context.traceId,
				provider: "zhongyang",
				startDate: input.startDate,
				endDate: input.endDate,
			},
			"Appointment schedule directory requested",
		);
		try {
			const result = await this.dependencies.directory.listSchedules(
				input,
				context,
			);
			this.logger.info(
				{
					event: "appointment.directory.schedules.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					itemCount: result.schedules.length,
				},
				"Appointment schedule directory loaded",
			);
			return {
				items: [...result.schedules],
				total: result.schedules.length,
			};
		} catch (error) {
			this.logFailure(context, error, "schedules");
			throw error;
		}
	}

	/**
	 * 查询当前用户所属患者的预约历史。
	 *
	 * providerPatientId 只在 lookup 成功后的当前调用栈内使用，日志和返回值
	 * 只携带平台 patientId；没有 mapping 或 adapter 时明确失败，不返回空的“成功”。
	 */
	async listRecords(
		ownerUserId: string,
		patientId: string,
		query: AppointmentRecordQuery,
		context: AdapterCallContext,
	): Promise<AppointmentRecordListPayload["data"]> {
		validateRecordQuery(query);
		if (!patientId.trim()) throw new AppointmentRecordPatientNotFoundError();
		if (!this.dependencies.repository || !this.dependencies.records) {
			throw new DependencyNotConfiguredError("appointment-records");
		}

		this.logger.info(
			{
				event: "appointment.records.requested",
				traceId: context.traceId,
				provider: "zhongyang",
				patientId,
				startDate: query.startDate,
				endDate: query.endDate,
			},
			"Appointment records requested",
		);

		try {
			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
				});
			if (!reference) throw new AppointmentRecordPatientNotFoundError();

			const result = await this.dependencies.records.listRecords(
				{
					// 受限引用只存在此调用帧内，不进入日志或 API contract。
					providerPatientId: reference.providerPatientId,
					query,
				},
				context,
			);
			this.logger.info(
				{
					event: "appointment.records.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					patientId,
					itemCount: result.records.length,
				},
				"Appointment records loaded",
			);
			return { items: [...result.records], total: result.records.length };
		} catch (error) {
			this.logger.error(
				{
					event: "appointment.records.failed",
					traceId: context.traceId,
					provider: "zhongyang",
					patientId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Appointment records request failed",
			);
			throw error;
		}
	}

	private logFailure(
		context: AdapterCallContext,
		error: unknown,
		resource: "departments" | "schedules",
	): void {
		this.logger.error(
			{
				event: `appointment.directory.${resource}.failed`,
				traceId: context.traceId,
				provider: "zhongyang",
				errorType: error instanceof Error ? error.name : "unknown",
			},
			"Appointment directory request failed",
		);
	}
}
