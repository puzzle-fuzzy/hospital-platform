import { randomUUID } from "node:crypto";
import type { PatientListPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	DependencyNotConfiguredError,
	type PatientDirectoryGateway,
	PatientDirectorySnapshotUnsafeError,
	PatientDirectorySyncInProgressError,
	type PatientRepository,
	type UserIdentityRepository,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type PatientServiceDependencies = {
	/** 由服务端会话解析出的 userId 映射到 provider unionId。 */
	identityUsers?: UserIdentityRepository;
	/** 患者目录 adapter；默认组合根保持 fail-closed。 */
	directory?: PatientDirectoryGateway;
	/** 只记录同步结果元数据，不记录 unionId 或 provider 原始字段。 */
	logger?: AppLogger;
	/** 测试可注入稳定 id；生产默认使用 Bun/Node 的 UUID。 */
	createPatientId?: () => string;
	/** 记录快照发起时间；生产使用服务端时钟，测试可注入固定时间。 */
	now?: () => Date;
	/**
	 * 同步 operation 的租约时长；必须大于 provider 请求超时，不能由小程序提交。
	 * 默认 60 秒，测试可缩短以覆盖租约接管。
	 */
	syncLeaseMs?: number;
};

export class PatientService {
	private readonly logger: AppLogger;
	private readonly createPatientId: () => string;
	private readonly now: () => Date;
	private readonly syncLeaseMs: number;

	constructor(
		private readonly repository: PatientRepository,
		private readonly dependencies: PatientServiceDependencies = {},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.createPatientId = dependencies.createPatientId ?? randomUUID;
		this.now = dependencies.now ?? (() => new Date());
		this.syncLeaseMs = dependencies.syncLeaseMs ?? 60_000;
		if (!Number.isSafeInteger(this.syncLeaseMs) || this.syncLeaseMs < 1_000) {
			throw new Error("Patient directory sync lease must be at least 1000ms");
		}
	}

	/** 只按服务端解析出的 ownerUserId 查询，避免客户端传 userId 越权。 */
	async list(
		ownerUserId: string,
		context: AdapterCallContext,
	): Promise<PatientListPayload["data"]> {
		// 患者目录读取是独立的业务事实：它可能只是读取已有快照，也可能是
		// 同步成功后返回读模型。不能只依赖 HTTP 200，否则“数据库读取失败”
		// 会和“没有患者”都表现成没有业务日志。
		this.logger.info(
			{
				event: "patient.directory.read.requested",
				traceId: context.traceId,
			},
			"Patient directory read requested",
		);
		try {
			const items = await this.repository.listByOwner(ownerUserId);
			const payload = {
				items: items.map(
					({
						id,
						displayName,
						relationship,
						cardNumberMasked,
						source,
						clinicalAccess,
					}) => ({
						id,
						displayName,
						relationship,
						cardNumberMasked,
						source,
						clinicalAccess,
					}),
				),
				total: items.length,
			};
			this.logger.info(
				{
					event: "patient.directory.read.loaded",
					traceId: context.traceId,
					itemCount: payload.total,
				},
				"Patient directory read loaded",
			);
			return payload;
		} catch (error) {
			this.logger.error(
				{
					event: "patient.directory.read.failed",
					traceId: context.traceId,
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Patient directory read failed",
			);
			throw error;
		}
	}

	/**
	 * 从服务端身份读取 unionId，再同步成平台内部患者档案。
	 *
	 * provider 患者号只进入 repository 的映射边界；返回值始终复用平台
	 * patient id，避免小程序依赖或猜测众阳/HIS 的外部标识。
	 */
	async sync(
		ownerUserId: string,
		context: AdapterCallContext,
	): Promise<PatientListPayload["data"]> {
		let operationId: string | undefined;
		let operationAttemptCount: number | undefined;
		// 一旦 replay 或快照事务成功，后续 list 失败只能归类为读模型失败，
		// 不能再追加 `patient.directory.failed` 覆盖已经成立的同步事实。
		let syncOutcomeCommitted = false;
		this.logger.info(
			{
				event: "patient.directory.requested",
				traceId: context.traceId,
				provider: "zhongyang",
			},
			"Patient directory synchronization requested",
		);

		try {
			const identityUsers = this.dependencies.identityUsers;
			const directory = this.dependencies.directory;
			const beginDirectorySync = this.repository.beginDirectorySync;
			if (!identityUsers || !directory || !beginDirectorySync) {
				throw new DependencyNotConfiguredError("patient-directory");
			}

			const identity = await identityUsers.findByUserId(ownerUserId);
			if (!identity?.unionId) {
				// 没有 unionId 时不能猜测 provider 身份，也不能降级为客户端传参。
				throw new DependencyNotConfiguredError("patient-directory-identity");
			}

			// 快照时间必须在 provider 请求发出前记录。若用户连续刷新，较早发起
			// 但较晚返回的旧响应只能作为旧快照处理，不能凭“返回得更晚”覆盖
			// 已经落库的新目录状态或重新激活已失效患者。
			const observedAt = this.now().toISOString();
			const leaseUntil = new Date(
				Date.parse(observedAt) + this.syncLeaseMs,
			).toISOString();
			// 幂等键负责网络重试的 replay；同一 owner/provider 的跨页面并发互斥
			// 由持久化层的 owner 行锁和活跃租约查询负责。不能把客户端传来的 key
			// 当成用户级锁，也不能在这里发现冲突后再次盲目调用 provider。
			const operation = await beginDirectorySync.call(this.repository, {
				ownerUserId,
				provider: "zhongyang",
				idempotencyKey: context.idempotencyKey,
				now: observedAt,
				leaseUntil,
			});
			operationId = operation.operationId;
			operationAttemptCount = operation.attemptCount;
			if (operation.outcome === "replay") {
				syncOutcomeCommitted = true;
				this.logger.info(
					{
						event: "patient.directory.operation.replayed",
						traceId: context.traceId,
						operationId: operation.operationId,
						provider: "zhongyang",
						attemptCount: operation.attemptCount,
					},
					"Patient directory synchronization replayed from durable state",
				);
				return this.list(ownerUserId, context);
			}
			if (operation.outcome === "in_progress") {
				this.logger.warn(
					{
						event: "patient.directory.operation.in_progress",
						traceId: context.traceId,
						operationId: operation.operationId,
						provider: "zhongyang",
						attemptCount: operation.attemptCount,
						conflictScope: operation.conflictScope,
					},
					"Patient directory synchronization is already in progress",
				);
				throw new PatientDirectorySyncInProgressError();
			}

			this.logger.info(
				{
					event:
						operation.attemptCount > 1
							? "patient.directory.operation.lease_taken_over"
							: "patient.directory.operation.started",
					traceId: context.traceId,
					operationId: operation.operationId,
					provider: "zhongyang",
					attemptCount: operation.attemptCount,
				},
				"Patient directory synchronization operation started",
			);
			const result = await directory.listByIdentity(
				{ unionId: identity.unionId },
				context,
			);
			if (result.complete !== true) {
				// 不完整目录不能触发失效回收；provider contract 若未来引入分页，
				// 必须先在 adapter 层合并完全部分页再返回 complete=true。
				throw new DependencyNotConfiguredError("patient-directory-snapshot");
			}
			const replaceDirectorySnapshot = this.repository.replaceDirectorySnapshot;
			if (!replaceDirectorySnapshot) {
				// 生产仓储必须具备事务快照能力；逐条 upsert 会留下半套目录。
				throw new DependencyNotConfiguredError("patient-directory-snapshot");
			}
			if (result.patients.length === 0) {
				// 这里不能只相信 Provider 返回的 `complete=true`：当前 Provider
				// contract 没有证明空数组一定代表“用户确实没有绑定患者”，也没有
				// 证明权限过滤、临时异常或响应截断会返回什么形状。先读取当前 owner
				// 的读模型，只在已有医院目录患者时拒绝破坏性替换；首次登录且确实
				// 没有医院目录患者的用户仍允许得到合法的空列表。
				const currentPatients = await this.repository.listByOwner(ownerUserId);
				const hasExistingDirectoryPatients = currentPatients.some(
					(patient) => patient.source === "hospital-his",
				);
				if (hasExistingDirectoryPatients) {
					throw new PatientDirectorySnapshotUnsafeError();
				}
			}
			let hisPatientReferenceCount = 0;
			const snapshotPatients = result.patients.map((profile) => ({
				patientId: this.createPatientId(),
				profile,
			}));
			for (const { profile } of snapshotPatients) {
				if (profile.providerReferences?.["his-patient"]) {
					hisPatientReferenceCount += 1;
				}
			}
			const snapshot = await replaceDirectorySnapshot.call(this.repository, {
				ownerUserId,
				provider: "zhongyang",
				observedAt,
				operationId: operation.operationId,
				operationAttemptCount: operation.attemptCount,
				patients: snapshotPatients,
			});
			syncOutcomeCommitted = true;

			this.logger.info(
				{
					event: "patient.directory.synced",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					patientCount: result.patients.length,
					activePatientCount: snapshot.activePatients.length,
					deactivatedPatientCount: snapshot.deactivatedPatientCount,
					hisPatientReferenceCount,
					operationId,
					attemptCount: operationAttemptCount,
				},
				"Patient directory synchronized",
			);

			return this.list(ownerUserId, context);
		} catch (error) {
			// `in_progress` 是已定义的并发分支，不是 provider/数据库失败。
			// 上面已经记录了带 conflictScope 的 409 事件；如果这里再记录
			// `failed`，监控会把正常的重复刷新误报成同步故障。
			if (
				!syncOutcomeCommitted &&
				!(error instanceof PatientDirectorySyncInProgressError)
			) {
				this.logger.error(
					{
						event: "patient.directory.failed",
						traceId: context.traceId,
						provider: "zhongyang",
						operationId,
						errorType: error instanceof Error ? error.name : "unknown",
					},
					"Patient directory synchronization failed",
				);
			}
			throw error;
		}
	}
}
