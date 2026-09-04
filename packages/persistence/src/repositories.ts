import type {
	AppointmentHold,
	AppointmentRegistration,
	AppointmentWriteRepository,
	AppointmentScheduleSnapshot,
	AppointmentScheduleSnapshotRepository,
	IdentityUser,
	ManualReviewRepository,
	MedicalInsuranceCredentialContext,
	MedicalInsuranceCredentialHandle,
	MedicalInsuranceCredentialRepository,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceAuthorizationRepository,
	MedicalInsuranceProviderQueryIdentity,
	MedicalInsuranceOrder,
	MedicalInsuranceOrderRepository,
	MedicalInsuranceSettlementContext,
	MedicalInsuranceQueryTask,
	MedicalInsuranceQueryTaskRepository,
	MyDoctor,
	MyDoctorRepository,
	PatientDirectorySnapshotInput,
	PatientDirectorySnapshotResult,
	PatientDirectorySyncStart,
	PatientDirectorySyncStartInput,
	PatientDirectoryUpsertInput,
	PatientProviderReference,
	PatientRecord,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	PaymentQuote,
	PaymentQuoteRepository,
	ReportReference,
	ReportReferenceRepository,
	UserIdentityRepository,
	UserProfile,
	UserProfileRepository,
	UserProfileUpdate,
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
} from "@hospital/domain";
import {
	MyDoctorAlreadyExistsError,
	PatientDirectoryReferenceConflictError,
	PatientDirectorySnapshotStaleError,
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
	normalizeMyDoctorReadModel,
	validateMyDoctorCreateInput,
	UserProfileVersionConflictError,
	validateAppointmentScheduleSnapshot,
	validateReportReference,
	isValidMedicalInsuranceProviderQueryIdentity,
} from "@hospital/domain";
import { PersistenceNotConfiguredError } from "./errors";
import { createNotConfiguredHealthKnowledgeRepository } from "./knowledge";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

/** 仅用于单元测试和本地组合测试；它不提供生产持久化保证。 */
export function createInMemoryIdentityUserRepository(
	seed: readonly IdentityUser[] = [],
): UserIdentityRepository {
	const users = new Map(seed.map((user) => [user.providerSubject, user]));
	let sequence = seed.length;

	return {
		async findOrCreateByWechat(input) {
			const existing = users.get(input.providerSubject);
			if (existing) {
				// 与 MySQL 实现保持一致：只补齐延迟出现的 unionId，不覆盖已有绑定。
				if (input.unionId && !existing.unionId) {
					const updated = { ...existing, unionId: input.unionId };
					users.set(input.providerSubject, updated);
					return updated;
				}
				return existing;
			}

			sequence += 1;
			const userId = `fixture-user-${String(sequence).padStart(4, "0")}`;
			const user: IdentityUser = input.unionId
				? {
						userId,
						providerSubject: input.providerSubject,
						unionId: input.unionId,
					}
				: { userId, providerSubject: input.providerSubject };
			users.set(input.providerSubject, user);
			return user;
		},
		async findByUserId(userId) {
			return [...users.values()].find((user) => user.userId === userId);
		},
	};
}

/** 普通个人资料的内存仓储；只用于测试，生产必须使用带版本条件的 MySQL 实现。 */
export function createInMemoryUserProfileRepository(
	seed: readonly UserProfile[] = [],
): UserProfileRepository {
	const profiles = new Map(seed.map((profile) => [profile.userId, profile]));

	return {
		async findByUserId(userId) {
			return profiles.get(userId);
		},
		async update(input: UserProfileUpdate) {
			const existing = profiles.get(input.userId);
			const currentVersion = existing?.version ?? 0;
			if (currentVersion !== input.expectedVersion) {
				throw new UserProfileVersionConflictError();
			}

			const next: UserProfile = {
				userId: input.userId,
				displayName: input.displayName ?? existing?.displayName ?? "微信用户",
				gender: input.gender ?? existing?.gender ?? "unknown",
				age: input.age !== undefined ? input.age : (existing?.age ?? null),
				email:
					input.email !== undefined ? input.email : (existing?.email ?? null),
				version: currentVersion + 1,
			};
			profiles.set(input.userId, next);
			return next;
		},
	};
}

/** 仅用于单元测试和本地组合测试；生产实现应连接 MySQL/HIS 同步层。 */
export function createInMemoryPatientRepository(
	seed: readonly PatientRecord[] = [],
): PatientRepository {
	const patients = [...seed];
	const inactivePatientIds = new Set<string>();
	/** 记录完整目录快照的发起时间，模拟 MySQL 的 directory_last_seen_at。 */
	const directoryLastSeenAt = new Map<string, string>();
	/** 记录已经提交的最新完整快照，防止过期请求重新激活新快照停用的患者。 */
	const latestDirectorySnapshotAt = new Map<string, string>();
	const directoryIndex = new Map<string, string>();
	const providerIndex = new Map<string, string>();
	/**
	 * 模拟 MySQL `hp_patient_provider_references` 的二级唯一约束：同一
	 * owner/provider/用途下，一个外部患者号只能归属于一个内部患者。
	 * 生产实现依靠 MySQL 唯一键；内存实现必须保留同样的拒绝语义，避免
	 * 测试环境把生产必然失败的跨患者映射当成成功。
	 */
	const providerExternalIndex = new Map<string, string>();
	/**
	 * 模拟生产 operation ledger；真实跨进程并发由 MySQL 唯一键和行锁保证，
	 * 这里只用于验证服务层的 replay、处理中冲突和租约接管语义。
	 */
	const syncOperations = new Map<
		string,
		{
			operationId: string;
			ownerUserId: string;
			provider: "zhongyang";
			status: "in_progress" | "succeeded";
			attemptCount: number;
			leaseUntil: string;
		}
	>();
	const syncOperationKey = (input: PatientDirectorySyncStartInput) =>
		`${input.ownerUserId}:${input.provider}:${input.idempotencyKey}`;
	const directoryKey = (
		input: Pick<
			PatientDirectoryUpsertInput,
			"ownerUserId" | "provider" | "profile"
		>,
	) =>
		`${input.ownerUserId}:${input.provider}:${input.profile.providerPatientId}`;
	const directorySnapshotKey = (input: {
		ownerUserId: string;
		provider: "zhongyang";
	}) => `${input.ownerUserId}:${input.provider}`;
	const providerReferenceKey = (input: {
		ownerUserId: string;
		provider: "zhongyang";
		patientId: string;
		referenceKind: "directory" | "his-patient";
	}) =>
		`${input.ownerUserId}:${input.provider}:${input.referenceKind}:${input.patientId}`;
	const providerExternalReferenceKey = (input: {
		ownerUserId: string;
		provider: "zhongyang";
		referenceKind: "directory" | "his-patient";
		providerPatientId: string;
	}) =>
		`${input.ownerUserId}:${input.provider}:${input.referenceKind}:${input.providerPatientId}`;

	/**
	 * 内存仓储也必须把临床可用性当作映射事实，不能沿用 seed/旧对象上的
	 * `clinicalAccess=ready`。MySQL 读模型是通过 EXISTS 查询实时计算的；如果
	 * 内存实现保留旧枚举，就会让测试里的预约、报告或费用流程绕过缺失的
	 * `his-patient` 映射，掩盖生产环境本应触发的 fail-closed 边界。
	 */
	const clinicalAccessFor = (
		patient: PatientRecord,
	): PatientRecord["clinicalAccess"] => {
		if (patient.source === "legacy-record") return "unavailable";
		return providerIndex.has(
			providerReferenceKey({
				ownerUserId: patient.ownerUserId,
				provider: "zhongyang",
				patientId: patient.id,
				referenceKind: "his-patient",
			}),
		)
			? "ready"
			: "unavailable";
	};
	const listActivePatientsByOwner = (ownerUserId: string): PatientRecord[] =>
		patients
			.filter(
				(patient) =>
					patient.ownerUserId === ownerUserId &&
					!inactivePatientIds.has(patient.id),
			)
			.map((patient) => ({
				...patient,
				clinicalAccess: clinicalAccessFor(patient),
			}));

	/**
	 * 先按生产唯一键规则检查并记录能力专用映射。
	 *
	 * `providerIndex` 按内部患者保存当前引用，`providerExternalIndex` 按
	 * 外部患者号保存归属；更新同一患者的 patId 时先释放旧外部值，才能
	 * 复现 MySQL UPDATE 后旧唯一值被释放的行为。调用方可以传入副本做整批
	 * 快照预检，确保冲突发生前不会修改任何患者状态。
	 */
	const applyProviderReferencePlan = (
		input: Pick<
			PatientDirectoryUpsertInput,
			"ownerUserId" | "provider" | "profile"
		>,
		patientId: string,
		references: Map<string, string>,
		externalReferences: Map<string, string>,
	): void => {
		for (const [referenceKind, providerPatientId] of Object.entries(
			input.profile.providerReferences ?? {},
		)) {
			if (
				(referenceKind !== "directory" && referenceKind !== "his-patient") ||
				!providerPatientId
			) {
				continue;
			}
			const referenceKey = providerReferenceKey({
				ownerUserId: input.ownerUserId,
				provider: input.provider,
				patientId,
				referenceKind,
			});
			const externalKey = providerExternalReferenceKey({
				ownerUserId: input.ownerUserId,
				provider: input.provider,
				referenceKind,
				providerPatientId,
			});
			const previousProviderPatientId = references.get(referenceKey);
			if (
				previousProviderPatientId &&
				previousProviderPatientId !== providerPatientId
			) {
				const previousExternalKey = providerExternalReferenceKey({
					ownerUserId: input.ownerUserId,
					provider: input.provider,
					referenceKind,
					providerPatientId: previousProviderPatientId,
				});
				if (externalReferences.get(previousExternalKey) === patientId) {
					externalReferences.delete(previousExternalKey);
				}
			}
			const existingPatientId = externalReferences.get(externalKey);
			if (existingPatientId && existingPatientId !== patientId) {
				throw new PatientDirectoryReferenceConflictError();
			}
			externalReferences.set(externalKey, patientId);
			references.set(referenceKey, providerPatientId);
		}
	};

	/** 清理完整快照确认失效的能力引用，并同步释放外部唯一值。 */
	const removeProviderReference = (
		input: Pick<PatientDirectoryUpsertInput, "ownerUserId" | "provider">,
		patientId: string,
		referenceKind: "directory" | "his-patient",
		references: Map<string, string>,
		externalReferences: Map<string, string>,
	): void => {
		const referenceKey = providerReferenceKey({
			ownerUserId: input.ownerUserId,
			provider: input.provider,
			patientId,
			referenceKind,
		});
		const providerPatientId = references.get(referenceKey);
		if (providerPatientId) {
			const externalKey = providerExternalReferenceKey({
				ownerUserId: input.ownerUserId,
				provider: input.provider,
				referenceKind,
				providerPatientId,
			});
			if (externalReferences.get(externalKey) === patientId) {
				externalReferences.delete(externalKey);
			}
		}
		references.delete(referenceKey);
	};

	// 这里刻意保持同步：内存仓储没有真实 I/O，快照替换必须在一次
	// JavaScript 事件循环 turn 内完成，才能模拟 MySQL 事务的“校验租约、
	// 修改快照、完成 operation”不可被同一进程内另一个调用插入的边界。
	const upsertDirectoryAt = (
		input: PatientDirectoryUpsertInput,
		observedAt: string,
	): PatientRecord => {
		const key = directoryKey(input);
		const existingId = directoryIndex.get(key);
		const existingIndex = existingId
			? patients.findIndex((patient) => patient.id === existingId)
			: -1;
		const existingPatient =
			existingIndex >= 0 ? patients[existingIndex] : undefined;
		const existingObservedAt = existingPatient
			? directoryLastSeenAt.get(existingPatient.id)
			: undefined;
		if (
			existingPatient &&
			existingObservedAt &&
			Date.parse(existingObservedAt) > Date.parse(observedAt)
		) {
			// 旧快照即使后返回，也不能覆盖更新的患者资料或临床引用。
			return existingPatient;
		}

		const nextId =
			existingIndex >= 0
				? (patients[existingIndex]?.id ?? input.patientId)
				: input.patientId;
		// 单条 upsert 也先在副本中校验所有引用，避免同一请求包含多个
		// 引用时前一个引用已经改动、后一个引用冲突而留下半状态。
		const plannedProviderIndex = new Map(providerIndex);
		const plannedProviderExternalIndex = new Map(providerExternalIndex);
		plannedProviderIndex.set(
			providerReferenceKey({
				ownerUserId: input.ownerUserId,
				provider: input.provider,
				referenceKind: "directory",
				patientId: nextId,
			}),
			input.profile.providerPatientId,
		);
		applyProviderReferencePlan(
			input,
			nextId,
			plannedProviderIndex,
			plannedProviderExternalIndex,
		);

		const next: PatientRecord = {
			id: nextId,
			ownerUserId: input.ownerUserId,
			displayName: input.profile.displayName,
			relationship: input.profile.relationship,
			cardNumberMasked: input.profile.cardNumberMasked,
			source: "hospital-his",
			clinicalAccess: input.profile.providerReferences?.["his-patient"]
				? "ready"
				: (existingPatient?.clinicalAccess ?? "unavailable"),
		};
		if (existingIndex >= 0) patients[existingIndex] = next;
		else patients.push(next);
		inactivePatientIds.delete(next.id);
		directoryLastSeenAt.set(next.id, observedAt);
		directoryIndex.set(key, next.id);
		// 目录 ID 保留在默认映射中；档案 patId 等专用引用单独存放，
		// 让预约、报告和门诊费用可以显式声明自己需要哪一种外部身份。
		providerIndex.clear();
		for (const [referenceKey, providerPatientId] of plannedProviderIndex) {
			providerIndex.set(referenceKey, providerPatientId);
		}
		providerExternalIndex.clear();
		for (const [externalKey, ownerPatientId] of plannedProviderExternalIndex) {
			providerExternalIndex.set(externalKey, ownerPatientId);
		}
		return next;
	};

	return {
		async listByOwner(ownerUserId) {
			return listActivePatientsByOwner(ownerUserId);
		},
		async beginDirectorySync(input): Promise<PatientDirectorySyncStart> {
			const key = syncOperationKey(input);
			const existing = syncOperations.get(key);
			if (existing?.status === "succeeded") {
				return {
					outcome: "replay",
					operationId: existing.operationId,
					attemptCount: existing.attemptCount,
				};
			}
			if (existing && Date.parse(existing.leaseUntil) > Date.parse(input.now)) {
				return {
					outcome: "in_progress",
					operationId: existing.operationId,
					attemptCount: existing.attemptCount,
					leaseUntil: existing.leaseUntil,
					conflictScope: "same-key",
				};
			}

			// 页面会各自生成新的幂等键；幂等键只能防止“同一次请求”重复，
			// 不能防止首页和选择页用不同 key 同时刷新。因此内存仓储也模拟
			// 生产 MySQL 的 owner/provider 活跃租约约束，避免测试错误放过跨页并发。
			const activeOperation = [...syncOperations.values()].find(
				(candidate) =>
					candidate.ownerUserId === input.ownerUserId &&
					candidate.provider === input.provider &&
					candidate.status === "in_progress" &&
					Date.parse(candidate.leaseUntil) > Date.parse(input.now) &&
					candidate.operationId !== existing?.operationId,
			);
			if (activeOperation) {
				return {
					outcome: "in_progress",
					operationId: activeOperation.operationId,
					attemptCount: activeOperation.attemptCount,
					leaseUntil: activeOperation.leaseUntil,
					conflictScope: "owner-provider",
				};
			}

			if (!existing) {
				const operationId = `fixture-sync-operation-${syncOperations.size + 1}`;
				const operation = {
					operationId,
					ownerUserId: input.ownerUserId,
					provider: input.provider,
					status: "in_progress" as const,
					attemptCount: 1,
					leaseUntil: input.leaseUntil,
				};
				syncOperations.set(key, operation);
				return {
					outcome: "started",
					operationId: operation.operationId,
					attemptCount: operation.attemptCount,
				};
			}

			existing.attemptCount += 1;
			existing.leaseUntil = input.leaseUntil;
			return {
				outcome: "started",
				operationId: existing.operationId,
				attemptCount: existing.attemptCount,
			};
		},
		async upsertFromDirectory(input) {
			return upsertDirectoryAt(input, new Date().toISOString());
		},
		async replaceDirectorySnapshot(
			input: PatientDirectorySnapshotInput,
		): Promise<PatientDirectorySnapshotResult> {
			const operation = input.operationId
				? [...syncOperations.values()].find(
						(candidate) => candidate.operationId === input.operationId,
					)
				: undefined;
			if (
				input.operationId &&
				(operation?.status !== "in_progress" ||
					operation.attemptCount !== input.operationAttemptCount)
			) {
				throw new Error("Patient directory sync operation is not active");
			}
			if (input.operationId) {
				if (!input.completedAt) {
					throw new Error("Patient directory sync completion time is required");
				}
				const leaseUntilMilliseconds = Date.parse(operation?.leaseUntil ?? "");
				const completedAtMilliseconds = Date.parse(input.completedAt ?? "");
				if (
					!Number.isFinite(leaseUntilMilliseconds) ||
					!Number.isFinite(completedAtMilliseconds)
				) {
					throw new Error("Patient directory sync timestamp is invalid");
				}
				if (leaseUntilMilliseconds <= completedAtMilliseconds) {
					// 不同幂等键接管时，旧 operation 仍可能保留为 in_progress；
					// 仅校验 status 和 attemptCount 会让旧响应继续修改患者目录。
					// 必须在任何 upsert/deactivate 前按提交时刻检查租约，避免留下
					// 一次短暂但真实可见的过期快照。
					throw new PatientDirectorySnapshotStaleError();
				}
			}
			const snapshotKey = directorySnapshotKey(input);
			const latestObservedAt = latestDirectorySnapshotAt.get(snapshotKey);
			if (
				latestObservedAt &&
				Date.parse(latestObservedAt) > Date.parse(input.observedAt)
			) {
				// 不仅患者逐条资料不能被旧时间覆盖，完整快照的“缺失即失效”
				// 结论也不能倒流。否则旧请求可能把新快照已经停用的患者重新激活。
				throw new PatientDirectorySnapshotStaleError();
			}
			// 先在副本上完整模拟本次快照的引用变更。MySQL 会在同一事务
			// 中遇到二级唯一冲突后回滚；内存实现没有数据库事务，因此必须
			// 在任何患者状态写入前完成等价预检，不能留下半个快照。
			const plannedProviderIndex = new Map(providerIndex);
			const plannedProviderExternalIndex = new Map(providerExternalIndex);
			for (const patient of input.patients) {
				const existingId = directoryIndex.get(
					directoryKey({
						ownerUserId: input.ownerUserId,
						provider: input.provider,
						profile: patient.profile,
					}),
				);
				const existingPatient = existingId
					? patients.find((candidate) => candidate.id === existingId)
					: undefined;
				const existingObservedAt = existingPatient
					? directoryLastSeenAt.get(existingPatient.id)
					: undefined;
				if (
					existingObservedAt &&
					Date.parse(existingObservedAt) > Date.parse(input.observedAt)
				) {
					continue;
				}
				const plannedPatientId = existingId ?? patient.patientId;
				applyProviderReferencePlan(
					{
						ownerUserId: input.ownerUserId,
						provider: input.provider,
						profile: patient.profile,
					},
					plannedPatientId,
					plannedProviderIndex,
					plannedProviderExternalIndex,
				);
				if (!patient.profile.providerReferences?.["his-patient"]) {
					removeProviderReference(
						{
							ownerUserId: input.ownerUserId,
							provider: input.provider,
						},
						plannedPatientId,
						"his-patient",
						plannedProviderIndex,
						plannedProviderExternalIndex,
					);
				}
			}
			const seenPatientIds = new Set<string>();
			for (const patient of input.patients) {
				const record = upsertDirectoryAt(
					{
						ownerUserId: input.ownerUserId,
						patientId: patient.patientId,
						provider: input.provider,
						profile: patient.profile,
					},
					input.observedAt,
				);
				// 完整快照对临床引用同样具有权威性：如果本次患者资料没有
				// `his-patient`，旧引用必须失效，不能继续被预约、报告或费用
				// 查询复用。目录引用由上面的 providerPatientId 单独维护，不能
				// 因为临床引用缺失而一并删除。
				const directoryLastSeen = directoryLastSeenAt.get(record.id);
				const snapshotWasAccepted =
					directoryLastSeen !== undefined &&
					Date.parse(directoryLastSeen) <= Date.parse(input.observedAt);
				if (
					snapshotWasAccepted &&
					!patient.profile.providerReferences?.["his-patient"]
				) {
					removeProviderReference(
						{
							ownerUserId: input.ownerUserId,
							provider: input.provider,
						},
						record.id,
						"his-patient",
						providerIndex,
						providerExternalIndex,
					);
					const patientIndex = patients.findIndex(
						(candidate) => candidate.id === record.id,
					);
					if (patientIndex >= 0) {
						const current = patients[patientIndex];
						if (current) {
							patients[patientIndex] = {
								...current,
								clinicalAccess: "unavailable",
							};
						}
					}
				}
				seenPatientIds.add(record.id);
			}

			let deactivatedPatientCount = 0;
			for (const patient of patients) {
				if (
					patient.ownerUserId === input.ownerUserId &&
					patient.source === "hospital-his" &&
					!seenPatientIds.has(patient.id) &&
					!inactivePatientIds.has(patient.id)
				) {
					const lastSeenAt = directoryLastSeenAt.get(patient.id);
					if (
						lastSeenAt &&
						Date.parse(lastSeenAt) > Date.parse(input.observedAt)
					) {
						// 该患者属于更新的快照；旧快照缺少它时也不能把它停用。
						continue;
					}
					inactivePatientIds.add(patient.id);
					deactivatedPatientCount += 1;
				}
			}

			const result = {
				// 不能在 operation 完成校验前 await：否则旧租约可能在
				// 快照已修改后被新代次接管，造成内存实现与 MySQL 事务语义不一致。
				activePatients: listActivePatientsByOwner(input.ownerUserId),
				deactivatedPatientCount,
			};
			if (input.operationId) {
				const activeOperation = operation;
				if (
					activeOperation === undefined ||
					activeOperation.status !== "in_progress" ||
					activeOperation.attemptCount !== input.operationAttemptCount
				) {
					throw new Error("Patient directory sync operation is not active");
				}
				// 生产 MySQL 会在同一事务中完成这一步；内存实现只需保持
				// 相同的领域状态，供 service 测试验证 replay 分支。
				activeOperation.status = "succeeded";
			}
			// 只有整批快照和 operation 成功事实都成立后才推进水位；失败请求
			// 不得留下一个会阻塞后续合法同步的伪最新时间。
			latestDirectorySnapshotAt.set(snapshotKey, input.observedAt);
			return result;
		},
		async resolveProviderReference(
			input,
		): Promise<PatientProviderReference | undefined> {
			const patient = patients.find(
				(candidate) =>
					candidate.id === input.patientId &&
					candidate.ownerUserId === input.ownerUserId,
			);
			if (!patient || inactivePatientIds.has(patient.id)) return undefined;
			const referenceKind = input.referenceKind ?? "directory";
			const providerPatientId = providerIndex.get(
				providerReferenceKey({ ...input, referenceKind }),
			);
			return providerPatientId
				? {
						patientId: input.patientId,
						provider: input.provider,
						providerPatientId,
					}
				: undefined;
		},
	};
}

/** 仅用于订单状态机测试；生产实现需要数据库事务和版本号条件更新。 */
export function createInMemoryPaymentOrderRepository(
	seed: readonly PaymentOrder[] = [],
): PaymentOrderRepository {
	const orders = new Map(seed.map((order) => [order.orderId, order]));

	return {
		async findById(orderId) {
			return orders.get(orderId);
		},
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			return [...orders.values()].find(
				(order) =>
					order.ownerUserId === ownerUserId &&
					order.idempotencyKey === idempotencyKey,
			);
		},
		async findByOwnerAndId(ownerUserId, orderId) {
			const order = orders.get(orderId);
			return order?.ownerUserId === ownerUserId ? order : undefined;
		},
		async insert(order, _event) {
			const existing = [...orders.values()].find(
				(current) =>
					current.ownerUserId === order.ownerUserId &&
					current.idempotencyKey === order.idempotencyKey,
			);
			if (existing && existing.orderId !== order.orderId) {
				throw new PaymentIdempotencyConflictError();
			}
			orders.set(order.orderId, order);
			return order;
		},
		async update(order, expectedVersion, _event) {
			const current = orders.get(order.orderId);
			if (!current || current.version !== expectedVersion) {
				throw new PaymentOrderVersionConflictError();
			}
			orders.set(order.orderId, order);
			return order;
		},
	};
}

/** 仅用于 API 集成测试；生产实现应读取 HIS/结算服务生成的短期报价。 */
export function createInMemoryPaymentQuoteRepository(
	seed: readonly PaymentQuote[] = [],
): PaymentQuoteRepository {
	const quotes = new Map(seed.map((quote) => [quote.quoteId, quote]));

	return {
		async findByOwnerAndId(ownerUserId, quoteId) {
			const quote = quotes.get(quoteId);
			return quote?.ownerUserId === ownerUserId ? quote : undefined;
		},
	};
}

/** 仅用于应用层和并发语义测试；生产实现必须使用数据库唯一键和版本更新。 */
export function createInMemoryPaymentPrepayAttemptRepository(
	seed: readonly PaymentPrepayAttempt[] = [],
): PaymentPrepayAttemptRepository {
	const attempts = new Map(seed.map((attempt) => [attempt.attemptId, attempt]));

	return {
		async findByOwnerOrderAndIdempotencyKey(
			ownerUserId,
			orderId,
			idempotencyKey,
		) {
			return [...attempts.values()].find(
				(attempt) =>
					attempt.ownerUserId === ownerUserId &&
					attempt.orderId === orderId &&
					attempt.idempotencyKey === idempotencyKey,
			);
		},
		async insert(attempt) {
			const existing = [...attempts.values()].find(
				(current) =>
					current.ownerUserId === attempt.ownerUserId &&
					current.orderId === attempt.orderId &&
					current.idempotencyKey === attempt.idempotencyKey,
			);
			if (existing) return existing;
			attempts.set(attempt.attemptId, attempt);
			return attempt;
		},
		async update(attempt, expectedVersion) {
			const current = attempts.get(attempt.attemptId);
			if (!current || current.version !== expectedVersion) {
				throw new PaymentPrepayAttemptVersionConflictError();
			}
			attempts.set(attempt.attemptId, attempt);
			return attempt;
		},
		async claimDueForQuery(now, limit, leaseMs) {
			if (
				!Number.isSafeInteger(limit) ||
				limit <= 0 ||
				!Number.isSafeInteger(leaseMs) ||
				leaseMs <= 0
			) {
				return [];
			}
			const nowMs = now.getTime();
			const claimedUntil = new Date(nowMs + leaseMs).toISOString();
			const due = [...attempts.values()]
				.filter((attempt) => {
					if (attempt.status === "manual_review") return false;
					if (!attempt.nextQueryAt) return false;
					const nextQueryMs = new Date(attempt.nextQueryAt).getTime();
					if (!Number.isFinite(nextQueryMs) || nextQueryMs > nowMs) {
						return false;
					}
					if (!attempt.queryClaimedUntil) return true;
					const claimedUntilMs = new Date(attempt.queryClaimedUntil).getTime();
					return !Number.isFinite(claimedUntilMs) || claimedUntilMs <= nowMs;
				})
				.sort((left, right) => {
					const leftMs = new Date(left.nextQueryAt ?? 0).getTime();
					const rightMs = new Date(right.nextQueryAt ?? 0).getTime();
					return (
						leftMs - rightMs || left.attemptId.localeCompare(right.attemptId)
					);
				})
				.slice(0, limit)
				.map((attempt) => ({
					...attempt,
					version: attempt.version + 1,
					queryClaimedUntil: claimedUntil,
					updatedAt: now.toISOString(),
				}));
			for (const attempt of due) attempts.set(attempt.attemptId, attempt);
			return due;
		},
	};
}

/** 仅用于 webhook 幂等和应用层测试；生产实现必须与 outbox 同事务。 */
export function createInMemoryWechatPaymentNotificationRepository(
	seed: readonly WechatPaymentNotification[] = [],
): WechatPaymentNotificationRepository {
	const notifications = new Map(
		seed.map((notification) => [notification.notificationId, notification]),
	);

	return {
		async record(notification) {
			const existingById = notifications.get(notification.notificationId);
			const existingByTransaction = [...notifications.values()].find(
				(current) =>
					current.providerTransactionId === notification.providerTransactionId,
			);
			const existing = existingById ?? existingByTransaction;
			if (existing) {
				return { status: "duplicate", notification: existing };
			}
			notifications.set(notification.notificationId, notification);
			return { status: "inserted", notification };
		},
	};
}

/**
 * 仅用于目录组合测试；真实实现把快照写入 MySQL，并由 expiresAt 限制未来
 * 写入流程只能使用最近观察到的排班事实。
 */
export function createInMemoryAppointmentScheduleSnapshotRepository(
	seed: readonly AppointmentScheduleSnapshot[] = [],
): AppointmentScheduleSnapshotRepository {
	const snapshots = new Map(
		seed.map((snapshot) => [snapshot.scheduleId, snapshot]),
	);

	return {
		async upsert(input) {
			validateAppointmentScheduleSnapshot(input);
			const existing = snapshots.get(input.schedule.scheduleId);
			const existingObservedAt = existing
				? Date.parse(existing.observedAt)
				: Number.NEGATIVE_INFINITY;
			const observedAt = Date.parse(input.observedAt);
			if (!Number.isFinite(observedAt)) {
				throw new Error("Appointment schedule snapshot observedAt is invalid");
			}
			if (observedAt < existingObservedAt && existing) return existing;
			const snapshot: AppointmentScheduleSnapshot = {
				scheduleId: input.schedule.scheduleId,
				provider: input.provider,
				providerScheduleId: input.providerScheduleId,
				schedule: input.schedule,
				providerRequestId: input.providerRequestId,
				observedAt: input.observedAt,
				expiresAt: input.expiresAt,
			};
			snapshots.set(snapshot.scheduleId, snapshot);
			return snapshot;
		},
		async findActive(scheduleId, now) {
			const snapshot = snapshots.get(scheduleId);
			if (!snapshot) return undefined;
			const expiresAt = Date.parse(snapshot.expiresAt);
			const nowAt = Date.parse(now);
			return Number.isFinite(expiresAt) &&
				Number.isFinite(nowAt) &&
				expiresAt > nowAt
				? snapshot
				: undefined;
		},
	};
}

/** 预约写入命令的内存仓储；只用于本地组合，生产由 MySQL 实现。 */
export function createInMemoryAppointmentWriteRepository(
	seed: readonly AppointmentHold[] = [],
	registrations: readonly AppointmentRegistration[] = [],
): AppointmentWriteRepository {
	const holds = new Map(seed.map((hold) => [hold.holdId, { ...hold }]));
	const appointmentRegistrations = new Map(
		registrations.map((registration) => [
			registration.appointmentId,
			{ ...registration },
		]),
	);
	return {
		async findHold(ownerUserId, holdId) {
			const hold = holds.get(holdId);
			return hold?.ownerUserId === ownerUserId ? { ...hold } : undefined;
		},
		async findHoldByIdempotency(ownerUserId, idempotencyKey) {
			const hold = [...holds.values()].find(
				(item) =>
					item.ownerUserId === ownerUserId &&
					item.idempotencyKey === idempotencyKey,
			);
			return hold ? { ...hold } : undefined;
		},
		async insertHold(hold) {
			const existing = [...holds.values()].find(
				(item) =>
					item.ownerUserId === hold.ownerUserId &&
					item.idempotencyKey === hold.idempotencyKey,
			);
			if (existing) return { ...existing };
			holds.set(hold.holdId, { ...hold });
			return { ...hold };
		},
		async updateHold(hold, expectedStatus) {
			const current = holds.get(hold.holdId);
			if (
				!current ||
				current.ownerUserId !== hold.ownerUserId ||
				(expectedStatus !== undefined && current.status !== expectedStatus)
			)
				return undefined;
			holds.set(hold.holdId, { ...hold });
			return { ...hold };
		},
		async findRegistration(ownerUserId, appointmentId) {
			const registration = appointmentRegistrations.get(appointmentId);
			return registration?.ownerUserId === ownerUserId
				? { ...registration }
				: undefined;
		},
		async findRegistrationByIdempotency(ownerUserId, idempotencyKey) {
			const registration = [...appointmentRegistrations.values()].find(
				(item) =>
					item.ownerUserId === ownerUserId &&
					item.idempotencyKey === idempotencyKey,
			);
			return registration ? { ...registration } : undefined;
		},
		async findActiveRegistration(input) {
			const registration = [...appointmentRegistrations.values()].find(
				(item) =>
					item.ownerUserId === input.ownerUserId &&
					item.patientId === input.patientId &&
					item.workDate === input.workDate &&
					item.departmentName === input.departmentName &&
					item.status === "booked",
			);
			return registration ? { ...registration } : undefined;
		},
		async listRegistrationsByPatient(input) {
			return [...appointmentRegistrations.values()]
				.filter(
					(item) =>
						item.ownerUserId === input.ownerUserId &&
						item.patientId === input.patientId &&
						(input.startDate === undefined ||
							item.workDate >= input.startDate) &&
						(input.endDate === undefined || item.workDate <= input.endDate),
				)
				.sort((left, right) =>
					`${right.workDate}:${right.createdAt}`.localeCompare(
						`${left.workDate}:${left.createdAt}`,
					),
				)
				.map((item) => ({ ...item }));
		},
		async insertRegistration(registration) {
			appointmentRegistrations.set(registration.appointmentId, {
				...registration,
			});
			return { ...registration };
		},
		async updateRegistration(registration, expectedStatus) {
			const current = appointmentRegistrations.get(registration.appointmentId);
			if (
				!current ||
				current.ownerUserId !== registration.ownerUserId ||
				(expectedStatus !== undefined && current.status !== expectedStatus)
			)
				return undefined;
			appointmentRegistrations.set(registration.appointmentId, {
				...registration,
			});
			return { ...registration };
		},
	};
}

/**
 * 仅用于报告详情组合测试；生产实现必须把 provider 引用放在 MySQL，
 * 并通过 owner + patient + 过期时间查询，不能依赖进程内 Map。
 */
export function createInMemoryReportReferenceRepository(
	seed: readonly ReportReference[] = [],
): ReportReferenceRepository {
	for (const reference of seed) validateReportReference(reference);
	const references = new Map(
		seed.map((reference) => [reference.reportId, reference]),
	);

	return {
		async upsert(input) {
			const existing = references.get(input.reportId);
			const reference: ReportReference = {
				...input,
				createdAt:
					input.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
			};
			validateReportReference(reference);
			references.set(reference.reportId, reference);
			return reference;
		},
		async findByOwnerPatientAndId(ownerUserId, patientId, reportId, now) {
			const reference = references.get(reportId);
			if (
				!reference ||
				reference.ownerUserId !== ownerUserId ||
				reference.patientId !== patientId
			) {
				return undefined;
			}
			const expiresAt = Date.parse(reference.expiresAt);
			const nowAt = Date.parse(now);
			return Number.isFinite(expiresAt) &&
				Number.isFinite(nowAt) &&
				expiresAt > nowAt
				? reference
				: undefined;
		},
	};
}

/** 我的医生关系内存仓储；仅用于单元测试和本地组合测试。 */
export function createInMemoryMyDoctorRepository(
	seed: readonly MyDoctor[] = [],
): MyDoctorRepository {
	const doctors = new Map<string, MyDoctor>();
	const keyFor = (ownerUserId: string, doctorId: string): string =>
		`${ownerUserId}:${doctorId}`;
	for (const doctor of seed) {
		const normalized = normalizeMyDoctorReadModel(doctor);
		const key = keyFor(normalized.ownerUserId, normalized.doctorId);
		if (doctors.has(key)) throw new MyDoctorAlreadyExistsError();
		doctors.set(key, { ...normalized });
	}

	return {
		async listByOwner(ownerUserId) {
			return [...doctors.values()]
				.filter((doctor) => doctor.ownerUserId === ownerUserId)
				.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
				.map((doctor) => ({ ...doctor }));
		},
		async findByOwnerAndDoctor(ownerUserId, doctorId) {
			const doctor = doctors.get(keyFor(ownerUserId, doctorId));
			return doctor ? { ...doctor } : undefined;
		},
		async create(input) {
			validateMyDoctorCreateInput(input);
			const normalized = normalizeMyDoctorReadModel({
				...input,
				createdAt: input.createdAt ?? new Date().toISOString(),
			});
			const key = keyFor(normalized.ownerUserId, normalized.doctorId);
			if (doctors.has(key)) throw new MyDoctorAlreadyExistsError();
			doctors.set(key, { ...normalized });
			return { ...normalized };
		},
		async deleteByOwnerAndDoctor(ownerUserId, doctorId) {
			return doctors.delete(keyFor(ownerUserId, doctorId));
		},
	};
}

export function createNotConfiguredRepositories(): {
	identityUsers: UserIdentityRepository;
	userProfiles: UserProfileRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	medicalInsuranceOrders: MedicalInsuranceOrderRepository;
	medicalInsuranceQueryTasks: MedicalInsuranceQueryTaskRepository;
	medicalInsuranceCredentials: MedicalInsuranceCredentialRepository;
	medicalInsuranceAuthorizations: MedicalInsuranceAuthorizationRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
	appointmentScheduleSnapshots: AppointmentScheduleSnapshotRepository;
	appointmentWrites: AppointmentWriteRepository;
	myDoctors: MyDoctorRepository;
	reportReferences: ReportReferenceRepository;
	operations: ManualReviewRepository;
	healthKnowledge: ReturnType<
		typeof createNotConfiguredHealthKnowledgeRepository
	>;
} {
	return {
		identityUsers: {
			findOrCreateByWechat: async () => {
				throw new PersistenceNotConfiguredError("identity-users");
			},
			findByUserId: async () => {
				throw new PersistenceNotConfiguredError("identity-users");
			},
		},
		userProfiles: {
			findByUserId: async () => {
				throw new PersistenceNotConfiguredError("user-profiles");
			},
			update: async () => {
				throw new PersistenceNotConfiguredError("user-profiles");
			},
		},
		patients: {
			listByOwner: async () => {
				throw new PersistenceNotConfiguredError("patients");
			},
			upsertFromDirectory: async () => {
				throw new PersistenceNotConfiguredError("patients");
			},
			resolveProviderReference: async () => {
				throw new PersistenceNotConfiguredError("patients");
			},
		},
		medicalInsuranceOrders: {
			insert: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			findByMedicalOrderId: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			findByPayOrdId: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			findByOwnerAndAppointmentId: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			findByOwnerAndIdempotencyKey: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			saveSettlementContext: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			getSettlementContext: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
			applySettlement: async () => {
				throw new PersistenceNotConfiguredError("medical-insurance-orders");
			},
		},
		medicalInsuranceQueryTasks: {
			insert: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-query-tasks",
				);
			},
			claimDueForQuery: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-query-tasks",
				);
			},
			update: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-query-tasks",
				);
			},
		},
		medicalInsuranceAuthorizations: {
			put: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-authorizations",
				);
			},
			get: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-authorizations",
				);
			},
			getActiveForOrder: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-authorizations",
				);
			},
		},
		medicalInsuranceCredentials: {
			put: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-credentials",
				);
			},
			get: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-credentials",
				);
			},
			getActiveForOrder: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-credentials",
				);
			},
			revoke: async () => {
				throw new PersistenceNotConfiguredError(
					"medical-insurance-credentials",
				);
			},
		},
		paymentOrders: {
			findById: async () => {
				throw new PersistenceNotConfiguredError("payment-orders");
			},
			findByOwnerAndIdempotencyKey: async () => {
				throw new PersistenceNotConfiguredError("payment-orders");
			},
			findByOwnerAndId: async () => {
				throw new PersistenceNotConfiguredError("payment-orders");
			},
			insert: async () => {
				throw new PersistenceNotConfiguredError("payment-orders");
			},
			update: async () => {
				throw new PersistenceNotConfiguredError("payment-orders");
			},
		},
		paymentQuotes: {
			findByOwnerAndId: async () => {
				throw new PersistenceNotConfiguredError("payment-quotes");
			},
		},
		paymentPrepayAttempts: {
			findByOwnerOrderAndIdempotencyKey: async () => {
				throw new PersistenceNotConfiguredError("payment-prepay-attempts");
			},
			insert: async () => {
				throw new PersistenceNotConfiguredError("payment-prepay-attempts");
			},
			update: async () => {
				throw new PersistenceNotConfiguredError("payment-prepay-attempts");
			},
			claimDueForQuery: async () => {
				throw new PersistenceNotConfiguredError("payment-prepay-attempts");
			},
		},
		wechatPaymentNotifications: {
			record: async () => {
				throw new PersistenceNotConfiguredError("wechat-payment-notifications");
			},
		},
		appointmentScheduleSnapshots: {
			upsert: async () => {
				throw new PersistenceNotConfiguredError(
					"appointment-schedule-snapshots",
				);
			},
			findActive: async () => {
				throw new PersistenceNotConfiguredError(
					"appointment-schedule-snapshots",
				);
			},
		},
		appointmentWrites: {
			findHold: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			findHoldByIdempotency: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			insertHold: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			updateHold: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			findRegistration: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			findRegistrationByIdempotency: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			findActiveRegistration: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			listRegistrationsByPatient: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			insertRegistration: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
			updateRegistration: async () => {
				throw new PersistenceNotConfiguredError("appointment-writes");
			},
		},
		myDoctors: {
			listByOwner: async () => {
				throw new PersistenceNotConfiguredError("my-doctors");
			},
			findByOwnerAndDoctor: async () => {
				throw new PersistenceNotConfiguredError("my-doctors");
			},
			create: async () => {
				throw new PersistenceNotConfiguredError("my-doctors");
			},
			deleteByOwnerAndDoctor: async () => {
				throw new PersistenceNotConfiguredError("my-doctors");
			},
		},
		reportReferences: {
			upsert: async () => {
				throw new PersistenceNotConfiguredError("report-references");
			},
			findByOwnerPatientAndId: async () => {
				throw new PersistenceNotConfiguredError("report-references");
			},
		},
		operations: {
			list: async () => {
				throw new PersistenceNotConfiguredError("manual-review");
			},
			requeue: async () => {
				throw new PersistenceNotConfiguredError("manual-review");
			},
		},
		healthKnowledge: createNotConfiguredHealthKnowledgeRepository(),
	};
}

/** 医保查单任务内存仓储：复现 claim 租约和 version CAS 语义。 */
export function createInMemoryMedicalInsuranceQueryTaskRepository(
	seed: readonly MedicalInsuranceQueryTask[] = [],
): MedicalInsuranceQueryTaskRepository {
	const tasks = new Map(
		seed.map((task) => [
			task.taskId,
			{ ...task } satisfies MedicalInsuranceQueryTask,
		]),
	);
	return {
		async insert(task) {
			const existing = tasks.get(task.taskId);
			if (existing) {
				if (!sameMedicalInsuranceQueryTask(existing, task)) {
					throw new Error(
						"Medical insurance query task idempotency payload changed",
					);
				}
				return { ...existing };
			}
			tasks.set(task.taskId, { ...task });
			return { ...task };
		},
		async claimDueForQuery(now, limit, leaseMs) {
			if (
				!Number.isSafeInteger(limit) ||
				limit <= 0 ||
				!Number.isSafeInteger(leaseMs) ||
				leaseMs <= 0
			) {
				return [];
			}
			const nowMs = now.getTime();
			const leaseUntil = new Date(nowMs + leaseMs).toISOString();
			const due = [...tasks.values()]
				.filter((task) => {
					if (task.status !== "pending") return false;
					const nextAttemptMs = new Date(task.nextAttemptAt).getTime();
					if (!Number.isFinite(nextAttemptMs) || nextAttemptMs > nowMs) {
						return false;
					}
					if (!task.claimedUntil) return true;
					const claimedUntilMs = new Date(task.claimedUntil).getTime();
					return !Number.isFinite(claimedUntilMs) || claimedUntilMs <= nowMs;
				})
				.sort((left, right) => {
					const leftMs = new Date(left.nextAttemptAt).getTime();
					const rightMs = new Date(right.nextAttemptAt).getTime();
					return leftMs - rightMs || left.taskId.localeCompare(right.taskId);
				})
				.slice(0, limit)
				.map((task) => ({
					...task,
					status: "in_progress" as const,
					version: task.version + 1,
					claimedUntil: leaseUntil,
					updatedAt: now.toISOString(),
				}));
			for (const task of due) tasks.set(task.taskId, task);
			return due;
		},
		async update(task, expectedVersion) {
			const current = tasks.get(task.taskId);
			if (!current || current.version !== expectedVersion) {
				throw new Error(
					"Medical insurance query task was changed by another worker",
				);
			}
			tasks.set(task.taskId, { ...task });
			return { ...task };
		},
	};
}

/** 医保凭证上下文内存实现：密文仍用同一 AES-GCM 边界，避免测试绕过安全约束。 */
export function createInMemoryMedicalInsuranceCredentialRepository(
	base64Key = Buffer.alloc(32, 1).toString("base64"),
): MedicalInsuranceCredentialRepository {
	const cipher = createAesGcmSecretValueCipher(base64Key, {
		keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
		valueName: "medical insurance credential",
	});
	type StoredCredential = MedicalInsuranceCredentialHandle & {
		payloadCiphertext: string;
		revokedAt: string | null;
	};
	type CredentialPayload = {
		payToken: string;
		providerQueryIdentity: MedicalInsuranceProviderQueryIdentity;
	};
	const serializePayload = (input: CredentialPayload): string =>
		JSON.stringify(input);
	const deserializePayload = (value: string): CredentialPayload => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(value);
		} catch (error) {
			throw new Error("Medical insurance credential payload is invalid", {
				cause: error,
			});
		}
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof (parsed as { payToken?: unknown }).payToken !== "string" ||
			!isValidMedicalInsuranceProviderQueryIdentity(
				(parsed as { providerQueryIdentity?: unknown }).providerQueryIdentity,
			)
		) {
			throw new Error("Medical insurance credential payload is invalid");
		}
		return parsed as CredentialPayload;
	};
	const credentials = new Map<string, StoredCredential>();

	return {
		async put(input) {
			const handle: MedicalInsuranceCredentialHandle = {
				credentialId: input.credentialId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.medicalOrderId,
				payOrdId: input.payOrdId,
				purpose: input.purpose,
				expiresAt: input.expiresAt,
				createdAt: input.createdAt,
			};
			const existing = credentials.get(input.credentialId);
			if (
				!isValidMedicalInsuranceProviderQueryIdentity(
					input.providerQueryIdentity,
				)
			) {
				throw new Error("Medical insurance provider query identity is invalid");
			}
			const payloadCiphertext = cipher.seal(
				serializePayload({
					payToken: input.payToken,
					providerQueryIdentity: input.providerQueryIdentity,
				}),
			);
			if (existing) {
				const existingPayload = deserializePayload(
					cipher.open(existing.payloadCiphertext),
				);
				if (
					existing.ownerUserId !== handle.ownerUserId ||
					existing.medicalOrderId !== handle.medicalOrderId ||
					existing.payOrdId !== handle.payOrdId ||
					existing.purpose !== handle.purpose ||
					existing.expiresAt !== handle.expiresAt ||
					existing.createdAt !== handle.createdAt ||
					existingPayload.payToken !== input.payToken ||
					JSON.stringify(existingPayload.providerQueryIdentity) !==
						JSON.stringify(input.providerQueryIdentity)
				) {
					throw new Error(
						"Medical insurance credential idempotency payload changed",
					);
				}
				return { ...existing };
			}
			credentials.set(input.credentialId, {
				...handle,
				payloadCiphertext,
				revokedAt: null,
			});
			return handle;
		},
		async get(input) {
			const stored = credentials.get(input.credentialId);
			if (
				!stored ||
				stored.revokedAt ||
				stored.ownerUserId !== input.ownerUserId ||
				stored.medicalOrderId !== input.medicalOrderId ||
				stored.purpose !== input.purpose ||
				Date.parse(stored.expiresAt) <= Date.parse(input.now)
			) {
				return undefined;
			}
			const payload = deserializePayload(cipher.open(stored.payloadCiphertext));
			return {
				credentialId: stored.credentialId,
				ownerUserId: stored.ownerUserId,
				medicalOrderId: stored.medicalOrderId,
				payOrdId: stored.payOrdId,
				purpose: stored.purpose,
				expiresAt: stored.expiresAt,
				createdAt: stored.createdAt,
				payToken: payload.payToken,
				providerQueryIdentity: payload.providerQueryIdentity,
			} satisfies MedicalInsuranceCredentialContext;
		},
		async getActiveForOrder(input) {
			const stored = [...credentials.values()]
				.filter(
					(candidate) =>
						!candidate.revokedAt &&
						candidate.ownerUserId === input.ownerUserId &&
						candidate.medicalOrderId === input.medicalOrderId &&
						candidate.purpose === input.purpose &&
						Date.parse(candidate.expiresAt) > Date.parse(input.now),
				)
				.sort((left, right) =>
					right.createdAt.localeCompare(left.createdAt),
				)[0];
			if (!stored) return undefined;
			const payload = deserializePayload(cipher.open(stored.payloadCiphertext));
			return {
				credentialId: stored.credentialId,
				ownerUserId: stored.ownerUserId,
				medicalOrderId: stored.medicalOrderId,
				payOrdId: stored.payOrdId,
				purpose: stored.purpose,
				expiresAt: stored.expiresAt,
				createdAt: stored.createdAt,
				payToken: payload.payToken,
				providerQueryIdentity: payload.providerQueryIdentity,
			} satisfies MedicalInsuranceCredentialContext;
		},
		async revoke(input) {
			const stored = credentials.get(input.credentialId);
			if (
				!stored ||
				stored.ownerUserId !== input.ownerUserId ||
				stored.medicalOrderId !== input.medicalOrderId ||
				stored.revokedAt
			) {
				return false;
			}
			stored.revokedAt = input.now;
			stored.payloadCiphertext = "";
			return true;
		},
	};
}

/** 医保授权上下文内存实现：与生产表使用同一 AES-GCM 密文边界。 */
export function createInMemoryMedicalInsuranceAuthorizationRepository(
	base64Key = Buffer.alloc(32, 2).toString("base64"),
): MedicalInsuranceAuthorizationRepository {
	const cipher = createAesGcmSecretValueCipher(base64Key, {
		keyName: "MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY",
		valueName: "medical insurance authorization",
	});
	type Payload = Omit<
		MedicalInsuranceAuthorizationContext,
		| "authorizationId"
		| "ownerUserId"
		| "medicalOrderId"
		| "expiresAt"
		| "createdAt"
	>;
	type Stored = Pick<
		MedicalInsuranceAuthorizationContext,
		| "authorizationId"
		| "ownerUserId"
		| "medicalOrderId"
		| "expiresAt"
		| "createdAt"
	> & { payloadCiphertext: string };
	const rows = new Map<string, Stored>();
	const handleOf = (row: Stored) => ({
		authorizationId: row.authorizationId,
		ownerUserId: row.ownerUserId,
		medicalOrderId: row.medicalOrderId,
		expiresAt: row.expiresAt,
		createdAt: row.createdAt,
	});
	const contextOf = (row: Stored): MedicalInsuranceAuthorizationContext => ({
		...handleOf(row),
		...(JSON.parse(cipher.open(row.payloadCiphertext)) as Payload),
	});
	return {
		async put(input) {
			const existing = rows.get(input.authorizationId);
			if (existing) {
				if (JSON.stringify(contextOf(existing)) !== JSON.stringify(input))
					throw new Error(
						"Medical insurance authorization idempotency payload changed",
					);
				return handleOf(existing);
			}
			const row: Stored = {
				authorizationId: input.authorizationId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.medicalOrderId,
				expiresAt: input.expiresAt,
				createdAt: input.createdAt,
				payloadCiphertext: cipher.seal(
					JSON.stringify({
						providerSubject: input.providerSubject,
						payAuthNo: input.payAuthNo,
						patient: input.patient,
						psnNo: input.psnNo,
						insutype: input.insutype,
						insuplcAdmdvs: input.insuplcAdmdvs,
						insuCode: input.insuCode,
						...(input.ecToken ? { ecToken: input.ecToken } : {}),
						...(input.regionCode ? { regionCode: input.regionCode } : {}),
					}),
				),
			};
			rows.set(row.authorizationId, row);
			return handleOf(row);
		},
		async get(input) {
			const row = rows.get(input.authorizationId);
			if (
				!row ||
				row.ownerUserId !== input.ownerUserId ||
				row.medicalOrderId !== input.medicalOrderId ||
				Date.parse(row.expiresAt) <= Date.parse(input.now)
			)
				return undefined;
			return contextOf(row);
		},
		async getActiveForOrder(input) {
			const row = [...rows.values()]
				.filter(
					(candidate) =>
						candidate.ownerUserId === input.ownerUserId &&
						candidate.medicalOrderId === input.medicalOrderId &&
						Date.parse(candidate.expiresAt) > Date.parse(input.now),
				)
				.sort((left, right) =>
					right.createdAt.localeCompare(left.createdAt),
				)[0];
			return row ? contextOf(row) : undefined;
		},
	};
}

function sameMedicalInsuranceQueryTask(
	left: MedicalInsuranceQueryTask,
	right: MedicalInsuranceQueryTask,
): boolean {
	return (
		left.taskId === right.taskId && left.medicalOrderId === right.medicalOrderId
	);
}

/** 医保订单内存仓储：测试与服务端单测使用；CAS 语义与 MySQL 实现一致。 */
export function createInMemoryMedicalInsuranceOrderRepository(): MedicalInsuranceOrderRepository {
	const orders = new Map<string, MedicalInsuranceOrder>();
	const settlementContexts = new Map<
		string,
		MedicalInsuranceSettlementContext
	>();
	return {
		async insert(order) {
			if (orders.has(order.medicalOrderId)) {
				throw new Error(`duplicate medical order ${order.medicalOrderId}`);
			}
			orders.set(order.medicalOrderId, { ...order });
			return order;
		},
		async findByPayOrdId(payOrdId) {
			return (
				[...orders.values()].find((order) => order.payOrdId === payOrdId) ??
				undefined
			);
		},
		async findByMedicalOrderId(medicalOrderId) {
			return orders.get(medicalOrderId);
		},
		async findByOwnerAndAppointmentId(ownerUserId, appointmentId) {
			return (
				[...orders.values()].find(
					(order) =>
						order.ownerUserId === ownerUserId &&
						order.appointmentId === appointmentId,
				) ?? undefined
			);
		},
		async findByOwnerAndBusinessKey(ownerUserId, businessType, businessId) {
			return (
				[...orders.values()].find(
					(order) =>
						order.ownerUserId === ownerUserId &&
						(order.businessType ?? "registration") === businessType &&
						(order.businessId ?? order.appointmentId) === businessId,
				) ?? undefined
			);
		},
		async findByOwnerAndIdempotencyKey(ownerUserId, idempotencyKey) {
			return (
				[...orders.values()].find(
					(order) =>
						order.ownerUserId === ownerUserId &&
						order.idempotencyKey === idempotencyKey,
				) ?? undefined
			);
		},
		async saveSettlementContext(ownerUserId, medicalOrderId, context) {
			const order = orders.get(medicalOrderId);
			if (!order || order.ownerUserId !== ownerUserId) {
				throw new Error(
					"Medical insurance settlement context order is unavailable",
				);
			}
			const existing = settlementContexts.get(medicalOrderId);
			if (existing && JSON.stringify(existing) !== JSON.stringify(context)) {
				throw new Error("Medical insurance settlement context changed");
			}
			settlementContexts.set(medicalOrderId, {
				...context,
				networkRegister: { ...context.networkRegister },
				outNetworkSettleMain: { ...context.outNetworkSettleMain },
				nationalUpDetailList: context.nationalUpDetailList.map((item) => ({
					...item,
				})),
				upDetailList: context.upDetailList.map((item) => ({ ...item })),
				tradeOrderIds: [...context.tradeOrderIds],
			});
		},
		async getSettlementContext(ownerUserId, medicalOrderId) {
			const order = orders.get(medicalOrderId);
			const context = settlementContexts.get(medicalOrderId);
			if (!order || order.ownerUserId !== ownerUserId || !context)
				return undefined;
			return {
				...context,
				networkRegister: { ...context.networkRegister },
				outNetworkSettleMain: { ...context.outNetworkSettleMain },
				nationalUpDetailList: context.nationalUpDetailList.map((item) => ({
					...item,
				})),
				upDetailList: context.upDetailList.map((item) => ({ ...item })),
				tradeOrderIds: [...context.tradeOrderIds],
			};
		},
		async applySettlement(medicalOrderId, expectedVersion, patch) {
			const current = orders.get(medicalOrderId);
			if (!current || current.version !== expectedVersion) return undefined;
			const updated: MedicalInsuranceOrder = {
				...current,
				...(patch.businessType ? { businessType: patch.businessType } : {}),
				...(patch.orderType ? { orderType: patch.orderType } : {}),
				...(patch.businessId ? { businessId: patch.businessId } : {}),
				...(patch.appointmentId ? { appointmentId: patch.appointmentId } : {}),
				...(patch.authorizationId
					? { authorizationId: patch.authorizationId }
					: {}),
				...(patch.feeUploadId ? { feeUploadId: patch.feeUploadId } : {}),
				...(patch.payOrdId !== undefined ? { payOrdId: patch.payOrdId } : {}),
				...(patch.payTokenHash !== undefined
					? { payTokenHash: patch.payTokenHash }
					: {}),
				...(patch.mdtrtId !== undefined ? { mdtrtId: patch.mdtrtId } : {}),
				...(patch.acctUsedFlag !== undefined
					? { acctUsedFlag: patch.acctUsedFlag }
					: {}),
				...(patch.wechatMixTradeNo !== undefined
					? { wechatMixTradeNo: patch.wechatMixTradeNo }
					: {}),
				...(patch.wechatOutTradeNo !== undefined
					? { wechatOutTradeNo: patch.wechatOutTradeNo }
					: {}),
				...(patch.wechatPayParams !== undefined
					? { wechatPayParams: patch.wechatPayParams }
					: {}),
				...(patch.wechatPaymentState !== undefined
					? { wechatPaymentState: patch.wechatPaymentState }
					: {}),
				status: patch.status,
				ordStas: patch.ordStas,
				amounts: patch.amounts,
				setlType: patch.setlType,
				revsTokenHash: patch.revsTokenHash,
				revsTokenExpiresAt: patch.revsTokenExpiresAt,
				version: current.version + 1,
				updatedAt: new Date().toISOString(),
			};
			orders.set(medicalOrderId, updated);
			return updated;
		},
	};
}
