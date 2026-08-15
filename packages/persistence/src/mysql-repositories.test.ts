import { expect, test } from "bun:test";
import type { Pool } from "mysql2/promise";
import type {
	OutboxEvent,
	PaymentOrder,
	PaymentPrepayAttempt,
	WechatPaymentNotification,
} from "@hospital/domain";
import { createWechatPaymentNotificationEvent } from "@hospital/domain";
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

test("MySQL patient directory upsert stores provider mapping but returns internal id", async () => {
	const { pool, state } = createFakePool([[], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.upsertFromDirectory({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			profile: {
				providerPatientId: "provider-patient-001",
				displayName: "张三",
				relationship: "self",
				cardNumberMasked: "******7890",
			},
		}),
	).resolves.toEqual({
		id: "internal-patient-001",
		ownerUserId: "user-001",
		displayName: "张三",
		relationship: "self",
		cardNumberMasked: "******7890",
		source: "hospital-his",
	});
	expect(state.statements[0]).toContain("provider_patient_id = ?");
	expect(state.statements[1]).toContain("INSERT INTO hp_patients");
	expect(state.values[1]).toContain("provider-patient-001");
});

test("MySQL patient provider lookup is owner-scoped and server-only", async () => {
	const { pool, state } = createFakePool([
		[
			{
				patient_id: "internal-patient-001",
				provider_name: "zhongyang",
				provider_patient_id: "provider-patient-001",
			},
		],
	]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
		}),
	).resolves.toEqual({
		patientId: "internal-patient-001",
		provider: "zhongyang",
		providerPatientId: "provider-patient-001",
	});
	expect(state.statements[0]).toContain("owner_user_id = ?");
	expect(state.statements[0]).toContain("provider_patient_id IS NOT NULL");
	expect(state.values[0]).toEqual([
		"user-001",
		"internal-patient-001",
		"zhongyang",
	]);
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
		queryAttempts: 0,
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

test("MySQL notification repository commits the safe fact and outbox together", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);
	const notification: WechatPaymentNotification = {
		notificationId: "notification-mysql-001",
		eventType: "TRANSACTION.SUCCESS",
		orderId: "order-001",
		tradeState: "SUCCESS",
		totalFen: 300,
		providerTransactionId: "4200000000000300",
		receivedAt: "2026-08-15T00:00:01.000Z",
	};

	await expect(
		repositories.wechatPaymentNotifications.record(
			notification,
			createWechatPaymentNotificationEvent(notification),
		),
	).resolves.toMatchObject({ status: "inserted", notification });
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain(
		"INSERT INTO hp_wechat_payment_notifications",
	);
	expect(state.statements[1]).toContain("INSERT INTO hp_outbox_events");
});

test("MySQL prepay repository atomically claims due query schedules", async () => {
	const row = {
		attempt_id: "attempt-due-001",
		owner_user_id: "user-001",
		order_id: "order-001",
		provider: "wechat-pay",
		idempotency_key: "prepay-due-001",
		status: "succeeded",
		version: 3,
		query_attempts: 2,
		last_queried_at: "2026-08-15 00:00:15.000",
		next_query_at: "2026-08-15 00:01:00.000",
		query_claimed_until: null,
		prepay_id_hash: null,
		pay_params_ciphertext: null,
		provider_request_id: "request-001",
		last_error_code: null,
		created_at: "2026-08-15 00:00:00.000",
		updated_at: "2026-08-15 00:00:15.000",
	};
	const { pool, state } = createFakePool([[row], { affectedRows: 1 }]);
	const repositories = createMySqlRepositories(pool, {
		prepayCipher: createAesGcmSecretValueCipher(
			Buffer.alloc(32, 7).toString("base64"),
		),
	});

	await expect(
		repositories.paymentPrepayAttempts.claimDueForQuery(
			new Date("2026-08-15T00:01:00.000Z"),
			1,
			60_000,
		),
	).resolves.toMatchObject([
		{
			attemptId: "attempt-due-001",
			queryAttempts: 2,
			version: 4,
			lastQueriedAt: "2026-08-15 00:00:15.000",
			nextQueryAt: "2026-08-15 00:01:00.000",
			queryClaimedUntil: "2026-08-15 00:02:00.000",
		},
	]);
	expect(state.committed).toBe(true);
	expect(state.statements[0]).toContain("FOR UPDATE SKIP LOCKED");
	expect(state.statements[1]).toContain("query_claimed_until = ?");
});

test("MySQL appointment schedule snapshots persist provider evidence and enforce expiry reads", async () => {
	const row = {
		schedule_id: "schedule-001",
		provider: "zhongyang",
		provider_schedule_id: "provider-schedule-001",
		department_id: "dept-001",
		department_name: "心内科",
		doctor_id: "doctor-001",
		doctor_name: "李医生",
		work_date: "2026-08-20",
		shift_name: "上午",
		start_time: "08:00",
		end_time: "12:00",
		total_slots: 30,
		available_slots: 12,
		time_group: "range",
		provider_request_id: "provider-request-001",
		observed_at: "2026-08-15 00:00:10.000",
		expires_at: "2026-08-15 00:01:10.000",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }, [row], [row]]);
	const repositories = createMySqlRepositories(pool);
	const schedule = {
		scheduleId: "schedule-001",
		departmentId: "dept-001",
		departmentName: "心内科",
		doctorId: "doctor-001",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		startTime: "08:00",
		endTime: "12:00",
		totalSlots: 30,
		availableSlots: 12,
		timeGroup: "range" as const,
	};

	await expect(
		repositories.appointmentScheduleSnapshots.upsert({
			schedule,
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-001",
			providerRequestId: "provider-request-001",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:01:10.000Z",
		}),
	).resolves.toMatchObject({
		scheduleId: "schedule-001",
		providerScheduleId: "provider-schedule-001",
	});
	await expect(
		repositories.appointmentScheduleSnapshots.findActive(
			"schedule-001",
			"2026-08-15T00:00:30.000Z",
		),
	).resolves.toMatchObject({ providerRequestId: "provider-request-001" });
	expect(state.statements[0]).toContain(
		"INSERT INTO hp_appointment_schedule_snapshots",
	);
	expect(state.statements[0]).toContain("ON DUPLICATE KEY UPDATE");
	expect(state.statements[2]).toContain("expires_at > ?");
});

test("MySQL appointment snapshot validation fails before SQL execution", async () => {
	const { pool, state } = createFakePool();
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.appointmentScheduleSnapshots.upsert({
			schedule: {
				scheduleId: "schedule-invalid-mysql",
				departmentId: "dept-001",
				departmentName: "心内科",
				doctorId: "doctor-001",
				doctorName: "李医生",
				workDate: "2026-08-20",
				shiftName: "上午",
				totalSlots: 1,
				availableSlots: 2,
				timeGroup: "range",
			},
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-invalid",
			providerRequestId: "provider-request-invalid",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:01:10.000Z",
		}),
	).rejects.toMatchObject({
		name: "AppointmentScheduleSnapshotValidationError",
		reason: "invalid_slot_counts",
	});

	expect(state.statements).toHaveLength(0);
});

test("MySQL report references persist provider ids but read them owner-scoped", async () => {
	const row = {
		report_id: "report-001",
		owner_user_id: "user-001",
		patient_id: "patient-001",
		provider: "zhongyang",
		kind: "laboratory",
		provider_report_id: "provider-report-001",
		expires_at: "2026-08-15 00:10:00.000",
		created_at: "2026-08-15 00:00:00.000",
	};
	const { pool, state } = createFakePool([{ affectedRows: 1 }, [row]]);
	const repositories = createMySqlRepositories(pool);

	await expect(
		repositories.reportReferences.upsert({
			reportId: "report-001",
			ownerUserId: "user-001",
			patientId: "patient-001",
			provider: "zhongyang",
			kind: "laboratory",
			providerReportId: "provider-report-001",
			createdAt: "2026-08-15T00:00:00.000Z",
			expiresAt: "2026-08-15T00:10:00.000Z",
		}),
	).resolves.toMatchObject({ reportId: "report-001" });
	await expect(
		repositories.reportReferences.findByOwnerAndId(
			"user-001",
			"report-001",
			"2026-08-15T00:05:00.000Z",
		),
	).resolves.toMatchObject({ providerReportId: "provider-report-001" });
	expect(state.statements[0]).toContain("INSERT INTO hp_report_references");
	expect(state.statements[0]).toContain("created_at = VALUES(created_at)");
	expect(state.statements[1]).toContain("owner_user_id = ? AND report_id = ?");
});
