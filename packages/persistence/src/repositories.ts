import type {
	IdentityUser,
	PatientRecord,
	PatientRepository,
	PaymentOrder,
	PaymentOrderRepository,
	UserIdentityRepository,
} from "@hospital/domain";
import {
	PaymentIdempotencyConflictError,
	PaymentOrderVersionConflictError,
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
	};
}

/** 仅用于单元测试和本地组合测试；生产实现应连接 MySQL/HIS 同步层。 */
export function createInMemoryPatientRepository(
	seed: readonly PatientRecord[] = [],
): PatientRepository {
	const patients = [...seed];

	return {
		async listByOwner(ownerUserId) {
			return patients.filter((patient) => patient.ownerUserId === ownerUserId);
		},
	};
}

/** 仅用于订单状态机测试；生产实现需要数据库事务和版本号条件更新。 */
export function createInMemoryPaymentOrderRepository(
	seed: readonly PaymentOrder[] = [],
): PaymentOrderRepository {
	const orders = new Map(seed.map((order) => [order.orderId, order]));

	return {
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
		async insert(order) {
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
		async update(order, expectedVersion) {
			const current = orders.get(order.orderId);
			if (!current || current.version !== expectedVersion) {
				throw new PaymentOrderVersionConflictError();
			}
			orders.set(order.orderId, order);
			return order;
		},
	};
}

export function createNotConfiguredRepositories(): {
	identityUsers: UserIdentityRepository;
	patients: PatientRepository;
	paymentOrders: PaymentOrderRepository;
} {
	return {
		identityUsers: {
			findOrCreateByWechat: async () => {
				throw new PersistenceNotConfiguredError("identity-users");
			},
		},
		patients: {
			listByOwner: async () => {
				throw new PersistenceNotConfiguredError("patients");
			},
		},
		paymentOrders: {
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
	};
}
