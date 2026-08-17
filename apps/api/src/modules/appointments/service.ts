import type {
	AppointmentDepartmentListPayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentDepartmentQuery,
	type AppointmentDirectoryGateway,
	type AppointmentProviderSchedule,
	type AppointmentRecordDirectoryGateway,
	type AppointmentRecordQuery,
	type AppointmentSchedule,
	type AppointmentScheduleQuery,
	type AppointmentScheduleSnapshotRepository,
	DependencyNotConfiguredError,
	type PatientRepository,
	parseIsoCalendarDate,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type AppointmentServiceDependencies = {
	directory: AppointmentDirectoryGateway;
	/** 记录查询需要 owner-scoped provider mapping；目录查询不依赖该 repository。 */
	repository?: PatientRepository;
	records?: AppointmentRecordDirectoryGateway;
	/** 只读排班观察事实；不会因此开放预约写入。 */
	snapshots?: AppointmentScheduleSnapshotRepository;
	logger?: AppLogger;
	now?: () => Date;
	/** 测试可注入；生产使用不可预测的 UUID 作为平台排班引用。 */
	createScheduleId?: () => string;
};

/** 防止小程序把 provider 排班接口当作无限范围的数据导出端点。 */
const MAX_SCHEDULE_RANGE_DAYS = 31;
const MAX_RECORD_RANGE_DAYS = 366;
/** 众阳科室目录也要求日期窗口；平台固定为未来 7 天，避免无限查询。 */
const APPOINTMENT_DIRECTORY_RANGE_DAYS = 7;
/** 医院排班按中国标准时间计算，不能依赖服务器系统时区。 */
const APPOINTMENT_PROVIDER_TIME_ZONE = "Asia/Shanghai";
/** 排班快照只作为短期服务端观察事实，过期后不能授权后续写入。 */
const SCHEDULE_SNAPSHOT_TTL_MS = 60_000;
/**
 * 只读目录的 Provider 结果和写入前观察快照是两条不同事实链。
 *
 * `unavailable` 只表示快照没有落库，不表示 Provider 目录失败；在预约写入
 * 尚未开放时可以继续展示真实只读结果，但任何未来写入都必须拒绝使用该状态。
 */
type ScheduleSnapshotPersistenceStatus =
	| "persisted"
	| "unavailable"
	| "not-required";

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
	const start = parseIsoCalendarDate(input.startDate);
	const end = parseIsoCalendarDate(input.endDate);
	// 这里限制的是两个 UTC 日历零点之间的“跨度”，不是把首尾都计入后的日期条目数。
	// provider 对 endDate 是否包含当天仍属于外部合同，不能在这一层擅自推断。
	const maxRangeMs = MAX_SCHEDULE_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (start === undefined || end === undefined || end < start) {
		throw new AppointmentScheduleQueryError("Schedule date range is invalid");
	}
	if (end - start > maxRangeMs) {
		throw new AppointmentScheduleQueryError(
			`Schedule date range cannot exceed ${MAX_SCHEDULE_RANGE_DAYS} days`,
		);
	}
}

function validateRecordQuery(input: AppointmentRecordQuery): void {
	const start = parseIsoCalendarDate(input.startDate);
	const end = parseIsoCalendarDate(input.endDate);
	// 保持与排班查询一致：按起止日期差值限制查询跨度，避免不同只读接口
	// 对“最大日期范围”的理解不一致。provider 的端点包含规则由合同冻结。
	const maxRangeMs = MAX_RECORD_RANGE_DAYS * 24 * 60 * 60 * 1000;
	if (start === undefined || end === undefined || end < start) {
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
 * 生成 provider 所需的科室查询日期。
 *
 * 小程序只表达“打开预约目录”的意图，日期窗口由服务端统一生成；这样
 * provider 合同变化时只修改业务服务，不让客户端携带内部查询约定。
 */
function createDepartmentQuery(now: Date): AppointmentDepartmentQuery {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: APPOINTMENT_PROVIDER_TIME_ZONE,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(now);
	const values = Object.fromEntries(
		parts
			.filter(({ type }) => type !== "literal")
			.map(({ type, value }) => [type, value]),
	);
	const startDate = `${values.year}-${values.month}-${values.day}`;
	const startTimestamp = parseIsoCalendarDate(startDate);
	if (startTimestamp === undefined) {
		throw new AppointmentScheduleQueryError(
			"Appointment directory date is invalid",
		);
	}
	const endDate = new Date(
		startTimestamp + APPOINTMENT_DIRECTORY_RANGE_DAYS * 24 * 60 * 60 * 1000,
	)
		.toISOString()
		.slice(0, 10);
	return { startDate, endDate };
}

/**
 * 预约目录应用服务。
 *
 * 这里只读 provider 的科室/排班目录，不接收 patientId、挂号费或支付状态；
 * 预约写入必须在取得完整 provider contract 后另建命令模型。
 */
export class AppointmentService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;
	private readonly createScheduleId: () => string;

	constructor(private readonly dependencies: AppointmentServiceDependencies) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
		this.createScheduleId =
			dependencies.createScheduleId ?? (() => crypto.randomUUID());
	}

	async listDepartments(
		context: AdapterCallContext,
	): Promise<AppointmentDepartmentListPayload["data"]> {
		try {
			const query = createDepartmentQuery(this.now());
			this.logger.info(
				{
					event: "appointment.directory.departments.requested",
					traceId: context.traceId,
					provider: "zhongyang",
					startDate: query.startDate,
					endDate: query.endDate,
				},
				"Appointment department directory requested",
			);
			const result = await this.dependencies.directory.listDepartments(
				query,
				context,
			);
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
		try {
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
			const result = await this.dependencies.directory.listSchedules(
				input,
				context,
			);
			const observedSchedules = result.schedules.map(
				(providerSchedule: AppointmentProviderSchedule) => {
					const { providerScheduleId, ...details } = providerSchedule;
					return {
						providerScheduleId,
						schedule: {
							...details,
							scheduleId: this.createScheduleId(),
						},
					};
				},
			);
			const snapshotPersistenceStatus = await this.persistScheduleSnapshots(
				observedSchedules,
				result.trace,
			);
			this.logger.info(
				{
					event: "appointment.directory.schedules.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					itemCount: observedSchedules.length,
					// 这个字段明确区分“Provider 只读结果成功”和“写入前快照可用”，
					// 避免后续维护把一条 200 响应误当成已经具备锁号授权。
					snapshotPersistenceStatus,
				},
				"Appointment schedule directory loaded",
			);
			return {
				items: observedSchedules.map(({ schedule }) => schedule),
				total: observedSchedules.length,
			};
		} catch (error) {
			this.logFailure(context, error, "schedules");
			throw error;
		}
	}

	/**
	 * 将 provider 只读结果落成短期快照，供未来预约写入前进行服务端复核。
	 * 快照失败不阻断当前只读目录：在 provider 写入合同完成前，快照不是患者端
	 * 成功的前置条件；真正开放写入时必须把该策略升级为严格 precondition。
	 */
	private async persistScheduleSnapshots(
		schedules: readonly {
			schedule: AppointmentSchedule;
			providerScheduleId: string;
		}[],
		trace: { provider: string; requestId: string },
	): Promise<ScheduleSnapshotPersistenceStatus> {
		if (!this.dependencies.snapshots || schedules.length === 0)
			return "not-required";
		// observedAt 和 expiresAt 必须来自同一次时钟采样。若分别读取 now，
		// 请求跨过时间边界时 TTL 会被悄悄拉长，未来写入流程可能使用一条
		// 与 provider 观察时刻不一致的快照；所有过期判断都以这个基准计算。
		const observedNow = this.now();
		const observedAt = observedNow.toISOString();
		const expiresAt = new Date(
			observedNow.getTime() + SCHEDULE_SNAPSHOT_TTL_MS,
		).toISOString();
		try {
			await Promise.all(
				schedules.map(({ schedule, providerScheduleId }) =>
					this.dependencies.snapshots?.upsert({
						schedule,
						provider: "zhongyang",
						// 该引用来自 adapter 的内部事实，不能被客户端提交或
						// 当作已取得 provider 写入授权。
						providerScheduleId,
						providerRequestId: trace.requestId,
						observedAt,
						expiresAt,
					}),
				),
			);
			this.logger.info(
				{
					event: "appointment.schedule_snapshots.persisted",
					provider: trace.provider,
					providerRequestId: trace.requestId,
					itemCount: schedules.length,
					expiresAt,
				},
				"Appointment schedule snapshots persisted",
			);
			return "persisted";
		} catch (error) {
			this.logger.warn(
				{
					event: "appointment.schedule_snapshots.failed",
					provider: trace.provider,
					providerRequestId: trace.requestId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Appointment schedule snapshots were not persisted",
			);
			return "unavailable";
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
		try {
			// 输入校验、依赖检查、owner 映射和 Provider 请求必须共用同一个
			// 失败出口。否则“未配置”或非法日期虽然已经返回错误，业务日志却
			// 没有 `appointment.records.failed`，排障时会误以为请求从未进入该模块。
			validateRecordQuery(query);
			if (!patientId.trim()) throw new AppointmentRecordPatientNotFoundError();

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

			// 依赖未配置必须抛出稳定错误，不能为了让页面显示空态而返回
			// `items: []`；它也放在 try 内，确保失败日志和 HTTP 错误一致。
			if (!this.dependencies.repository || !this.dependencies.records) {
				throw new DependencyNotConfiguredError("appointment-records");
			}

			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
					// 预约接口需要档案查询返回的 HIS patId，不能使用目录 thirdPatientId。
					referenceKind: "his-patient",
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
