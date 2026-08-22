import type {
	AppointmentDepartmentListPayload,
	AppointmentRecordListPayload,
	AppointmentScheduleListPayload,
} from "@hospital/contracts";
import {
	type AdapterCallContext,
	type AppointmentDepartmentQuery,
	type AppointmentDirectoryGateway,
	AppointmentDirectoryResultValidationError,
	type AppointmentProviderSchedule,
	type AppointmentRecord,
	type AppointmentRecordDirectoryGateway,
	type AppointmentRecordQuery,
	AppointmentRecordResultValidationError,
	type AppointmentSchedule,
	type AppointmentScheduleQuery,
	type AppointmentScheduleSnapshotRepository,
	adapterContextTraceId,
	DependencyNotConfiguredError,
	type ExternalTrace,
	ExternalTraceReadModelValidationError,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeAppointmentDepartmentResults,
	normalizeAppointmentRecordResults,
	normalizeAppointmentScheduleResults,
	normalizeExternalTrace,
	type PatientRepository,
	parseIsoCalendarDate,
	validatePatientProviderReference,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";

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
 * 排班快照单次批量持久化的并发上限。
 *
 * 这是平台数据库资源策略，不是 Provider 的分页或号源数量合同。目录仍
 * 会尝试保存全部已验证排班，但不会因为一次只读响应就同时打满 MySQL
 * 连接；未来预约写入也不能仅凭快照已落库而绕过自己的合同门禁。
 */
const SCHEDULE_SNAPSHOT_CONCURRENCY = 4;

/**
 * 以固定并发度处理快照，同时保留目录顺序并在异常后停止领取新任务。
 *
 * 不能改成串行循环，否则一个慢写入会拖住整批观察；也不能继续使用无界
 * `Promise.all`，因为它会让异常 Provider 响应放大成大量数据库写入。已经
 * 在途的任务仍需完成，外层才会统一记录 `unavailable`；这样日志不会在
 * 实际写入尚未收尾时提前宣称批次已经结束。
 */
async function mapWithConcurrency<T, R>(
	items: readonly T[],
	concurrency: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const results = new Array<R>(items.length);
	let nextIndex = 0;
	let failed = false;
	let failure: unknown;

	const worker = async (): Promise<void> => {
		while (!failed) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) return;
			try {
				results[index] = await mapper(items[index] as T, index);
			} catch (error) {
				failed = true;
				failure = error;
				return;
			}
		}
	};

	const workerCount = Math.min(Math.max(1, concurrency), items.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	if (failed) throw failure;
	return results;
}

/**
 * 预约记录成功日志只记录状态数量，不记录预约号、患者标识或 Provider 原文。
 *
 * 线上页面的“在线挂号”会排除已取消记录；仅记录总数无法解释“Provider 返回
 * 多条、页面却显示空态”的合法情况。状态计数能帮助排障和验收，同时仍保持
 * 低敏日志边界，不把逐条记录重新写入 journald。
 */
function countAppointmentRecordStatuses(
	records: readonly AppointmentRecord[],
): Partial<Record<AppointmentRecord["status"], number>> {
	const statusCounts: Partial<Record<AppointmentRecord["status"], number>> = {};
	for (const record of records) {
		statusCounts[record.status] = (statusCounts[record.status] ?? 0) + 1;
	}
	return statusCounts;
}

/**
 * 将预约 gateway 的外部请求链投影成统一的低敏日志字段。
 *
 * `requestId` 兼容现有单请求检索；当目录或未来的预约读取由多个 Provider
 * 请求组成时，必须同时保留已经通过 domain 校验的完整 `requestIds`。这里
 * 只复制请求号，不把 Provider 原文、患者号或响应字段带入 journald。
 */
function traceLogFields(
	trace: Pick<ExternalTrace, "requestId" | "requestIds">,
): Record<string, unknown> {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

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

/**
 * HTTP schema 不是预约服务唯一的调用入口。
 *
 * 组合根、回放任务和未来 Worker 都可能直接调用 service；这些调用绕过
 * Elysia 的 query schema，不能把 TypeScript 的 `Appointment*Query` 类型当成
 * 运行时事实。先确认对象和日期字段的基本形状，再进入 `parseIsoCalendarDate`，
 * 避免 null/数组/非字符串值变成未映射的 TypeError 或 Provider 请求。
 */
function hasDateRangeShape(
	value: unknown,
): value is { startDate: string; endDate: string } {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		typeof record.startDate === "string" && typeof record.endDate === "string"
	);
}

/**
 * service 也必须拒绝未知预约查询字段。
 *
 * Elysia 的 TypeBox schema 已经限制 HTTP query，但组合根、回放任务或未来
 * Worker 可以直接调用 service。若这里只解构已知字段，旧端传入的
 * `requestChannel=4` 等意图会被静默丢弃，service 仍按固定渠道 3 查询，
 * 调用方会把另一种业务意图误认为已经生效。字段名本身不进入错误日志，
 * 只返回稳定的输入错误，避免把 Provider 参数扩散到日志。
 */
function hasOnlyQueryFields(
	value: Record<string, unknown>,
	allowedFields: ReadonlySet<string>,
): boolean {
	return Object.keys(value).every((field) => allowedFields.has(field));
}

/** 排班目录的 canonical 查询字段；不包含旧端未确认的渠道或患者字段。 */
const APPOINTMENT_SCHEDULE_QUERY_FIELDS = new Set([
	"startDate",
	"endDate",
	"departmentId",
	"doctorId",
]);

/** 挂号历史只读查询的 canonical 字段；渠道筛选需单独完成 contract 后再开放。 */
const APPOINTMENT_RECORD_QUERY_FIELDS = new Set(["startDate", "endDate"]);

/**
 * 预约 service 的所有入口共用同一份上下文门禁。
 *
 * 目录、排班和预约历史虽然是只读操作，但都会把 trace/idempotency 交给
 * Provider 或日志链。直接调用方不能绕过 HTTP schema；非法上下文必须在
 * Provider、快照仓储和错误日志之前停止，并由各方法选择对应的公共查询错误。
 */
function requireAppointmentContext(
	value: unknown,
	error: Error,
): AdapterCallContext {
	const normalized = normalizeAdapterCallContext(value);
	if (!normalized) throw error;
	return normalized;
}

function validateScheduleQuery(input: AppointmentScheduleQuery): void {
	if (!hasDateRangeShape(input)) {
		throw new AppointmentScheduleQueryError("Schedule date range is invalid");
	}
	if (!hasOnlyQueryFields(input, APPOINTMENT_SCHEDULE_QUERY_FIELDS)) {
		throw new AppointmentScheduleQueryError(
			"Schedule query contains an unknown field",
		);
	}
	if (
		(input.departmentId !== undefined &&
			!isBoundedOpaqueIdentifier(input.departmentId)) ||
		(input.doctorId !== undefined && !isBoundedOpaqueIdentifier(input.doctorId))
	) {
		throw new AppointmentScheduleQueryError(
			"Schedule filter identifier is invalid",
		);
	}
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

/**
 * Provider 返回的排班必须与本次查询意图绑定。
 *
 * 不能只相信 Provider 已经接收了 start/end/department/doctor 参数：上游
 * 可能忽略筛选、缓存错位或把上一轮结果回放到当前请求。这里整批拒绝窗口外
 * 或筛选条件不匹配的排班，而不是过滤后继续返回；过滤会把“不完整的排班
 * 目录”伪装成完整成功，患者会误以为当前科室/医生没有其它号源。
 */
function validateAppointmentScheduleResult(
	schedules: readonly AppointmentProviderSchedule[],
	query: AppointmentScheduleQuery,
): void {
	const start = parseIsoCalendarDate(query.startDate);
	const end = parseIsoCalendarDate(query.endDate);
	if (start === undefined || end === undefined || end < start) {
		// validateScheduleQuery 已经负责入口校验；这里保留防御性分支，避免
		// 未来其它调用路径绕过入口后把异常窗口当成有效 Provider 事实。
		throw new AppointmentScheduleQueryError("Schedule date range is invalid");
	}
	if (
		schedules.some((schedule) => {
			const workDate = parseIsoCalendarDate(schedule.workDate);
			return workDate === undefined || workDate < start || workDate > end;
		})
	) {
		throw new AppointmentDirectoryResultValidationError(
			"schedule-work-date-outside-query",
		);
	}
	if (
		query.departmentId !== undefined &&
		schedules.some((schedule) => schedule.departmentId !== query.departmentId)
	) {
		throw new AppointmentDirectoryResultValidationError(
			"schedule-department-mismatch",
		);
	}
	if (
		query.doctorId !== undefined &&
		schedules.some((schedule) => schedule.doctorId !== query.doctorId)
	) {
		throw new AppointmentDirectoryResultValidationError(
			"schedule-doctor-mismatch",
		);
	}
}

function validateRecordQuery(input: AppointmentRecordQuery): void {
	if (!hasDateRangeShape(input)) {
		throw new AppointmentRecordQueryError(
			"Appointment record date range is invalid",
		);
	}
	if (!hasOnlyQueryFields(input, APPOINTMENT_RECORD_QUERY_FIELDS)) {
		throw new AppointmentRecordQueryError(
			"Appointment record query contains an unknown field",
		);
	}
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
 * Provider 返回结果必须服从本次查询窗口，不能只依赖 Provider 自己的筛选。
 *
 * 预约历史会同时查询过去和未来日期；如果上游忽略 start/end 参数，直接把
 * 窗口外记录展示出来会造成“我的挂号”事实污染。这里选择整批拒绝而不是
 * 过滤坏行：过滤会把 Provider 响应异常伪装成完整成功，患者无法知道目录不完整。
 * 查询端点由 contract 定义为包含首尾日期，因此 start/end 当天都属于合法结果。
 */
function validateAppointmentRecordWindow(
	records: readonly AppointmentRecord[],
	query: AppointmentRecordQuery,
): void {
	const start = parseIsoCalendarDate(query.startDate);
	const end = parseIsoCalendarDate(query.endDate);
	if (start === undefined || end === undefined || end < start) {
		// `validateRecordQuery` 已经负责这个入口校验；这里保留防御性分支，
		// 避免未来其它调用路径绕过入口后把无效窗口当作有效事实比较。
		throw new AppointmentRecordQueryError(
			"Appointment record date range is invalid",
		);
	}
	if (
		records.some((record) => {
			const workDate = parseIsoCalendarDate(record.workDate);
			return workDate === undefined || workDate < start || workDate > end;
		})
	) {
		throw new AppointmentRecordResultValidationError("work-date-outside-query");
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
		let trace: ExternalTrace | undefined;
		try {
			context = requireAppointmentContext(
				context,
				new AppointmentScheduleQueryError(
					"Appointment department call context is invalid",
				),
			);
			const query = createDepartmentQuery(this.now());
			this.logger.info(
				{
					event: "appointment.directory.departments.requested",
					traceId: adapterContextTraceId(context),
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
			trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			// adapter 是第一道 Provider 白名单边界；gateway 仍可能由回放或
			// 未来实现注入。service 在日志和 API 响应前重新投影，避免额外的
			// 患者字段、费用字段或重复科室键越过级联目录边界。
			const normalizedDepartments = normalizeAppointmentDepartmentResults(
				(result as { departments?: unknown } | undefined)?.departments,
			);
			this.logger.info(
				{
					event: "appointment.directory.departments.synced",
					traceId: adapterContextTraceId(context),
					provider: trace.provider,
					...traceLogFields(trace),
					itemCount: normalizedDepartments.length,
				},
				"Appointment department directory loaded",
			);
			return {
				items: normalizedDepartments,
				total: normalizedDepartments.length,
			};
		} catch (error) {
			this.logFailure(context, error, "departments", trace);
			throw error;
		}
	}

	async listSchedules(
		input: AppointmentScheduleQuery,
		context: AdapterCallContext,
	): Promise<AppointmentScheduleListPayload["data"]> {
		let trace: ExternalTrace | undefined;
		try {
			context = requireAppointmentContext(
				context,
				new AppointmentScheduleQueryError(
					"Appointment schedule call context is invalid",
				),
			);
			validateScheduleQuery(input);
			this.logger.info(
				{
					event: "appointment.directory.schedules.requested",
					traceId: adapterContextTraceId(context),
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
			trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			const normalizedSchedules = normalizeAppointmentScheduleResults(
				(result as { schedules?: unknown } | undefined)?.schedules,
			);
			validateAppointmentScheduleResult(normalizedSchedules, input);
			const scheduleIds = new Set<string>();
			const observedSchedules = normalizedSchedules.map(
				(providerSchedule: AppointmentProviderSchedule) => {
					const { providerScheduleId, ...details } = providerSchedule;
					const scheduleId = this.createScheduleId();
					// scheduleId 是服务端生成、会返回给小程序并作为未来写入
					// 前置引用的公共标识，不能把生成器的 TypeScript 返回类型
					// 当成运行时事实。空白、控制字符或超长值会破坏页面事件
					// 和持久化查询，必须在 response/快照边界前拒绝。
					if (!isBoundedOpaqueIdentifier(scheduleId)) {
						throw new AppointmentDirectoryResultValidationError(
							"schedule-id-invalid",
						);
					}
					// 同一批次的两个排班如果共享公共 ID，页面会复用错误节点，
					// 快照仓储也可能覆盖前一条事实；不能交给客户端或数据库兜底。
					if (scheduleIds.has(scheduleId)) {
						throw new AppointmentDirectoryResultValidationError(
							"schedule-id-duplicate",
						);
					}
					scheduleIds.add(scheduleId);
					return {
						providerScheduleId,
						schedule: {
							...details,
							scheduleId,
						},
					};
				},
			);
			const snapshotPersistenceStatus = await this.persistScheduleSnapshots(
				observedSchedules,
				trace,
				adapterContextTraceId(context),
			);
			this.logger.info(
				{
					event: "appointment.directory.schedules.synced",
					traceId: adapterContextTraceId(context),
					provider: trace.provider,
					...traceLogFields(trace),
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
			this.logFailure(context, error, "schedules", trace);
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
		trace: Pick<ExternalTrace, "provider" | "requestId" | "requestIds">,
		traceId: string,
	): Promise<ScheduleSnapshotPersistenceStatus> {
		const snapshots = this.dependencies.snapshots;
		if (!snapshots || schedules.length === 0) return "not-required";
		// observedAt 和 expiresAt 必须来自同一次时钟采样。若分别读取 now，
		// 请求跨过时间边界时 TTL 会被悄悄拉长，未来写入流程可能使用一条
		// 与 provider 观察时刻不一致的快照；所有过期判断都以这个基准计算。
		const observedNow = this.now();
		const observedAt = observedNow.toISOString();
		const expiresAt = new Date(
			observedNow.getTime() + SCHEDULE_SNAPSHOT_TTL_MS,
		).toISOString();
		try {
			await mapWithConcurrency(
				schedules,
				SCHEDULE_SNAPSHOT_CONCURRENCY,
				async ({ schedule, providerScheduleId }) => {
					await snapshots.upsert({
						schedule,
						provider: "zhongyang",
						// 该引用来自 adapter 的内部事实，不能被客户端提交或
						// 当作已取得 provider 写入授权。
						providerScheduleId,
						providerRequestId: trace.requestId,
						observedAt,
						expiresAt,
					});
				},
			);
			this.logger.info(
				{
					event: "appointment.schedule_snapshots.persisted",
					// 快照持久化是目录请求的一部分，必须沿用同一条平台链路，
					// 否则 P0 聚合会把“目录成功”和“快照结果”拆成无主日志。
					traceId,
					provider: trace.provider,
					...traceLogFields(trace),
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
					// 即使快照写入失败，也必须保留目录请求的 traceId，便于
					// 区分“只读目录成功但观察快照失败”和 Provider 请求失败。
					traceId,
					provider: trace.provider,
					...traceLogFields(trace),
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
		// 只保存有限枚举，供失败日志关联跨层引用校验；不保存引用原值。
		let resultViolation: string | undefined;
		let trace: ExternalTrace | undefined;
		try {
			context = requireAppointmentContext(
				context,
				new AppointmentRecordQueryError(
					"Appointment record call context is invalid",
				),
			);
			// HTTP 路由的 owner 来自已验证 session，但 service 也可能被组合根、
			// 回放任务或 Worker 直接调用。owner 是仓储授权条件的一部分，不能只
			// 依赖 TypeScript 的 string 声明；在患者映射前拒绝空白、数组或控制字符。
			if (!isBoundedOpaqueIdentifier(ownerUserId)) {
				throw new AppointmentRecordQueryError(
					"Appointment record owner identifier is invalid",
				);
			}
			// 输入校验、依赖检查、owner 映射和 Provider 请求必须共用同一个
			// 失败出口。否则“未配置”或非法日期虽然已经返回错误，业务日志却
			// 没有 `appointment.records.failed`，排障时会误以为请求从未进入该模块。
			validateRecordQuery(query);
			if (!isBoundedOpaqueIdentifier(patientId)) {
				throw new AppointmentRecordQueryError(
					"Appointment record patient identifier is invalid",
				);
			}

			this.logger.info(
				{
					event: "appointment.records.requested",
					traceId: adapterContextTraceId(context),
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
			// 仓储返回值仍是跨层运行时数据，不能只依赖 PatientProviderReference
			// 的编译期类型。发现结构或范围异常时，在 Provider 调用前 fail-closed，
			// 对客户端继续使用与“没有映射”相同的安全语义。
			const referenceViolation = validatePatientProviderReference(
				reference,
				patientId,
			);
			if (referenceViolation) {
				// 只把有限原因写入失败日志，不暴露存储中的外部患者号或字段值。
				resultViolation = referenceViolation;
				throw new AppointmentRecordPatientNotFoundError();
			}

			const result = await this.dependencies.records.listRecords(
				{
					// 受限引用只存在此调用帧内，不进入日志或 API contract。
					providerPatientId: reference.providerPatientId,
					query,
				},
				context,
			);
			trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			// adapter 已经完成 Provider 字段白名单映射，但 service 端口仍可
			// 被其它实现注入；在 `synced` 日志和 API 响应前再做一次校验并
			// 重新投影，确保患者身份、预约号、费用和支付字段不会越过边界。
			const normalizedRecords = normalizeAppointmentRecordResults(
				(result as { records?: unknown } | undefined)?.records,
			);
			validateAppointmentRecordWindow(normalizedRecords, query);
			this.logger.info(
				{
					event: "appointment.records.synced",
					traceId: adapterContextTraceId(context),
					provider: trace.provider,
					...traceLogFields(trace),
					patientId,
					itemCount: normalizedRecords.length,
					statusCounts: countAppointmentRecordStatuses(normalizedRecords),
				},
				"Appointment records loaded",
			);
			return {
				items: normalizedRecords,
				total: normalizedRecords.length,
			};
		} catch (error) {
			this.logger.error(
				{
					event: "appointment.records.failed",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					errorType: error instanceof Error ? error.name : "unknown",
					...(resultViolation ? { resultViolation } : {}),
					...(error instanceof AppointmentRecordResultValidationError
						? { resultViolation: error.violation }
						: {}),
					...(error instanceof ExternalTraceReadModelValidationError
						? { resultViolation: error.violation }
						: {}),
					...providerFailureMetadata(error),
					...(trace ? traceLogFields(trace) : {}),
				},
				"Appointment records request failed",
			);
			throw error;
		}
	}

	private logFailure(
		context: unknown,
		error: unknown,
		resource: "departments" | "schedules",
		trace?: ExternalTrace,
	): void {
		this.logger.error(
			{
				event: `appointment.directory.${resource}.failed`,
				traceId: adapterContextTraceId(context),
				provider: "zhongyang",
				errorType: error instanceof Error ? error.name : "unknown",
				...(error instanceof AppointmentDirectoryResultValidationError
					? { resultViolation: error.violation }
					: {}),
				...(error instanceof ExternalTraceReadModelValidationError
					? { resultViolation: error.violation }
					: {}),
				...providerFailureMetadata(error),
				...(trace ? traceLogFields(trace) : {}),
			},
			"Appointment directory request failed",
		);
	}
}
