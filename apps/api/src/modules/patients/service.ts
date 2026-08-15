import { randomUUID } from "node:crypto";
import type { PatientListPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	DependencyNotConfiguredError,
	type PatientDirectoryGateway,
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
};

export class PatientService {
	private readonly logger: AppLogger;
	private readonly createPatientId: () => string;
	private readonly now: () => Date;

	constructor(
		private readonly repository: PatientRepository,
		private readonly dependencies: PatientServiceDependencies = {},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.createPatientId = dependencies.createPatientId ?? randomUUID;
		this.now = dependencies.now ?? (() => new Date());
	}

	/** 只按服务端解析出的 ownerUserId 查询，避免客户端传 userId 越权。 */
	async list(ownerUserId: string): Promise<PatientListPayload["data"]> {
		const items = await this.repository.listByOwner(ownerUserId);
		return {
			items: items.map(
				({ id, displayName, relationship, cardNumberMasked, source }) => ({
					id,
					displayName,
					relationship,
					cardNumberMasked,
					source,
				}),
			),
			total: items.length,
		};
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
			if (!identityUsers || !directory) {
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
				patients: snapshotPatients,
			});

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
				},
				"Patient directory synchronized",
			);

			return this.list(ownerUserId);
		} catch (error) {
			this.logger.error(
				{
					event: "patient.directory.failed",
					traceId: context.traceId,
					provider: "zhongyang",
					errorType: error instanceof Error ? error.name : "unknown",
				},
				"Patient directory synchronization failed",
			);
			throw error;
		}
	}
}
