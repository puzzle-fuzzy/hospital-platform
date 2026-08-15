import type {
	AppointmentScheduleSnapshot,
	AppointmentScheduleSnapshotRepository,
	IdentityUser,
	PatientDirectorySnapshotInput,
	PatientDirectorySnapshotResult,
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
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
	validateAppointmentScheduleSnapshot,
	validateReportReference,
} from "@hospital/domain";
import { PersistenceNotConfiguredError } from "./errors";
import { createNotConfiguredHealthKnowledgeRepository } from "./knowledge";

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

/** 仅用于单元测试和本地组合测试；生产实现应连接 MySQL/HIS 同步层。 */
export function createInMemoryPatientRepository(
	seed: readonly PatientRecord[] = [],
): PatientRepository {
	const patients = [...seed];
	const inactivePatientIds = new Set<string>();
	const directoryIndex = new Map<string, string>();
	const providerIndex = new Map<string, string>();
	const directoryKey = (input: PatientDirectoryUpsertInput) =>
		`${input.ownerUserId}:${input.provider}:${input.profile.providerPatientId}`;
	const providerReferenceKey = (input: {
		ownerUserId: string;
		provider: "zhongyang";
		patientId: string;
		referenceKind: "directory" | "his-patient";
	}) =>
		`${input.ownerUserId}:${input.provider}:${input.referenceKind}:${input.patientId}`;

	return {
		async listByOwner(ownerUserId) {
			return patients.filter(
				(patient) =>
					patient.ownerUserId === ownerUserId &&
					!inactivePatientIds.has(patient.id),
			);
		},
		async upsertFromDirectory(input) {
			const key = directoryKey(input);
			const existingId = directoryIndex.get(key);
			const existingIndex = existingId
				? patients.findIndex((patient) => patient.id === existingId)
				: -1;
			const next: PatientRecord = {
				id:
					existingIndex >= 0
						? (patients[existingIndex]?.id ?? input.patientId)
						: input.patientId,
				ownerUserId: input.ownerUserId,
				displayName: input.profile.displayName,
				relationship: input.profile.relationship,
				cardNumberMasked: input.profile.cardNumberMasked,
				source: "hospital-his",
			};
			if (existingIndex >= 0) patients[existingIndex] = next;
			else patients.push(next);
			inactivePatientIds.delete(next.id);
			directoryIndex.set(key, next.id);
			// 目录 ID 保留在旧的默认映射中；档案 patId 等专用引用单独存放，
			// 让预约、报告和门诊费用可以显式声明自己需要哪一种外部身份。
			providerIndex.set(
				providerReferenceKey({
					ownerUserId: input.ownerUserId,
					provider: input.provider,
					referenceKind: "directory",
					patientId: next.id,
				}),
				input.profile.providerPatientId,
			);
			for (const [referenceKind, providerPatientId] of Object.entries(
				input.profile.providerReferences ?? {},
			)) {
				if (!providerPatientId) continue;
				providerIndex.set(
					providerReferenceKey({
						ownerUserId: input.ownerUserId,
						provider: input.provider,
						referenceKind: referenceKind as "directory" | "his-patient",
						patientId: next.id,
					}),
					providerPatientId,
				);
			}
			return next;
		},
		async replaceDirectorySnapshot(
			input: PatientDirectorySnapshotInput,
		): Promise<PatientDirectorySnapshotResult> {
			const seenPatientIds = new Set<string>();
			for (const patient of input.patients) {
				const record = await this.upsertFromDirectory({
					ownerUserId: input.ownerUserId,
					patientId: patient.patientId,
					provider: input.provider,
					profile: patient.profile,
				});
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
					inactivePatientIds.add(patient.id);
					deactivatedPatientCount += 1;
				}
			}

			return {
				activePatients: await this.listByOwner(input.ownerUserId),
				deactivatedPatientCount,
			};
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

/**
 * 仅用于报告详情组合测试；生产实现必须把 provider 引用放在 MySQL，
 * 并通过 owner + 过期时间查询，不能依赖进程内 Map。
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
		async findByOwnerAndId(ownerUserId, reportId, now) {
			const reference = references.get(reportId);
			if (!reference || reference.ownerUserId !== ownerUserId) return undefined;
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

export function createNotConfiguredRepositories(): {
	identityUsers: UserIdentityRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
	appointmentScheduleSnapshots: AppointmentScheduleSnapshotRepository;
	reportReferences: ReportReferenceRepository;
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
		reportReferences: {
			upsert: async () => {
				throw new PersistenceNotConfiguredError("report-references");
			},
			findByOwnerAndId: async () => {
				throw new PersistenceNotConfiguredError("report-references");
			},
		},
		healthKnowledge: createNotConfiguredHealthKnowledgeRepository(),
	};
}
