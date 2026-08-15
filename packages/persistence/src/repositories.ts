import type {
	IdentityUser,
	PatientDirectoryUpsertInput,
	PatientRecord,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	PaymentPrepayAttempt,
	PaymentPrepayAttemptRepository,
	PaymentQuote,
	PaymentQuoteRepository,
	WechatPaymentNotification,
	WechatPaymentNotificationRepository,
	UserIdentityRepository,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptVersionConflictError,
} from "@hospital/domain";
import { PersistenceNotConfiguredError } from "./errors";

/** 仅用于单元测试和本地组合测试；它不提供生产持久化保证。 */
export function createInMemoryIdentityUserRepository(
	seed: readonly IdentityUser[] = [],
): UserIdentityRepository {
	const users = new Map(seed.map((user) => [user.providerSubject, user]));
	let sequence = seed.length;

	return {
		async findOrCreateByWechat(input) {
			const existing = users.get(input.providerSubject);
			if (existing) return existing;

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
	const directoryIndex = new Map<string, string>();
	const directoryKey = (input: PatientDirectoryUpsertInput) =>
		`${input.ownerUserId}:${input.provider}:${input.profile.providerPatientId}`;

	return {
		async listByOwner(ownerUserId) {
			return patients.filter((patient) => patient.ownerUserId === ownerUserId);
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
			directoryIndex.set(key, next.id);
			return next;
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

export function createNotConfiguredRepositories(): {
	identityUsers: UserIdentityRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
	paymentQuotes: PaymentQuoteRepository;
	paymentPrepayAttempts: PaymentPrepayAttemptRepository;
	wechatPaymentNotifications: WechatPaymentNotificationRepository;
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
	};
}
