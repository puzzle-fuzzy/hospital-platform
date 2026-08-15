import type {
	AppointmentDepartmentListPayload,
	AppointmentScheduleListPayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	AppointmentDirectoryGateway,
	AppointmentScheduleQuery,
} from "@hospital/domain";
import { createNoopLogger, type AppLogger } from "@hospital/observability";

export type AppointmentServiceDependencies = {
	directory: AppointmentDirectoryGateway;
	logger?: AppLogger;
};

/** 防止小程序把 provider 排班接口当作无限范围的数据导出端点。 */
const MAX_SCHEDULE_RANGE_DAYS = 31;

export class AppointmentScheduleQueryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AppointmentScheduleQueryError";
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
