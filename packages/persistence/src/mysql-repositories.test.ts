import { expect, test } from "bun:test";
import type { Pool } from "mysql2/promise";
import type {
	OutboxEvent,
	PaymentOrder,
	PaymentPrepayAttempt,
} from "@hospital/domain";
import { createMySqlRepositories } from "./mysql-repositories";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

type FakeConnectionState = {
	statements: string[];
	values: unknown[][];
	committed: boolean;
	rolledBack: boolean;
	responses: unknown[];
};

function createFakePool(responses: unknown[] = []): {
	pool: Pool;
	state: FakeConnectionState;
} {
	const state: FakeConnectionState = {
		statements: [],
		values: [],
		committed: false,
		rolledBack: false,
		responses: [...responses],
	};
	const connection = {
		async beginTransaction() {},
		async commit() {
			state.committed = true;
		},
		async rollback() {
			state.rolledBack = true;
		},
		release() {},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			return [state.responses.shift() ?? { affectedRows: 1 }, []];
		},
	};
	const pool = {
		async getConnection() {
			return connection;
		},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			return [state.responses.shift() ?? [], []];
		},
	} as unknown as Pool;

	return { pool, state };
}

const order: PaymentOrder = {
	orderId: "order-001",
	ownerUserId: "user-001",
	patientId: "patient-001",
	idempotencyKey: "idempotency-001",
	amounts: { totalFen: 1000, insuranceFen: 700, cashFen: 300 },
	state: "created",
	version: 1,
	createdAt: "2026-08-15T00:00:00.000Z",
	updatedAt: "2026-08-15T00:00:00.000Z",
};

const createdEvent: OutboxEvent = {
	eventId: "payment-order:order-001:created",
	eventName: "payment-order.created",
	aggregateId: "order-001",
	payload: { orderId: "order-001", state: "created" },
	occurredAt: order.updatedAt,
	availableAt: order.updatedAt,
	attempts: 0,
};

test("MySQL order insert commits order and outbox in one transaction", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);

	expect(await repositories.paymentOrders.insert(order, createdEvent)).toEqual(
		order,
	);
	expect(state.committed).toBe(true);
	expect(state.rolledBack).toBe(false);
	expect(state.statements).toHaveLength(2);
	expect(state.statements[0]).toContain("INSERT INTO hp_payment_orders");
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
	expect(state.values[0]?.[9]).toBe("2026-08-15 00:00:00.000");
	expect(state.values[1]?.[4]).toBe("2026-08-15 00:00:00.000");
});

test("MySQL order update requires the expected version before writing its event", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);
	const updated = { ...order, state: "authorized" as const, version: 2 };
	const event: OutboxEvent = {
		...createdEvent,
		eventId: "payment-order:order-001:2",
		eventName: "payment-order.state-changed",
		payload: { orderId: "order-001", state: "authorized", version: 2 },
	};

	expect(
		await repositories.paymentOrders.update(updated, order.version, event),
	).toEqual(updated);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("version = ?");
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
});

test("MySQL outbox claim returns an event and commits its lease", async () => {
	const row = {
		event_id: createdEvent.eventId,
		event_name: createdEvent.eventName,
		aggregate_id: createdEvent.aggregateId,
		payload: JSON.stringify(createdEvent.payload),
		occurred_at: createdEvent.occurredAt,
		available_at: createdEvent.availableAt,
		attempts: 0,
		claimed_until: null,
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	const claimed = await repositories.outbox.claimAvailable(
		new Date("2026-08-15T00:00:00.000Z"),
	);

	expect(claimed).toMatchObject({
		eventId: createdEvent.eventId,
		eventName: createdEvent.eventName,
		aggregateId: createdEvent.aggregateId,
	});
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("FOR UPDATE SKIP LOCKED");
	expect(state.statements[1]).toContain("SET claimed_until");
});

test("MySQL prepay repository encrypts pay params and stores only prepay hash", async () => {
	const { pool, state } = createFakePool([
		{ affectedRows: 1 },
		{ affectedRows: 1 },
	]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});
	const pending: PaymentPrepayAttempt = {
		attemptId: "attempt-001",
		ownerUserId: "user-001",
		orderId: "order-001",
		provider: "wechat-pay",
		idempotencyKey: "prepay-001",
		status: "pending",
		version: 1,
		createdAt: order.createdAt,
		updatedAt: order.updatedAt,
	};
	const succeeded: PaymentPrepayAttempt = {
		...pending,
		status: "succeeded",
		version: 2,
		prepayId: "prepay-credential-001",
		payParams: {
			appId: "app-001",
			timeStamp: "1700000000",
			nonceStr: "nonce-001",
			package: "prepay_id=prepay-credential-001",
			signType: "RSA",
			paySign: "sensitive-sign-001",
		},
		providerRequestId: "request-001",
		updatedAt: "2026-08-15T00:00:01.000Z",
	};

	await repositories.paymentPrepayAttempts.insert(pending);
	await repositories.paymentPrepayAttempts.update(succeeded, pending.version);

	const updateValues = state.values[1] ?? [];
	const serialized = updateValues[3];
	expect(state.statements[0]).toContain("prepay_id_hash");
	expect(state.statements[1]).toContain("pay_params_ciphertext");
	expect(String(updateValues[2])).not.toBe("prepay-credential-001");
	expect(String(serialized)).not.toContain("sensitive-sign-001");
});
