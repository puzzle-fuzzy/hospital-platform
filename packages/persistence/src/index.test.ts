import { expect, test } from "bun:test";
import {
	createInMemoryAppointmentScheduleSnapshotRepository,
	createInMemoryIdentityUserRepository,
	createInMemoryPatientRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryPaymentPrepayAttemptRepository,
	createInMemoryReportReferenceRepository,
	createNotConfiguredHealthKnowledgeRepository,
	createNotConfiguredRepositories,
	createUnconfiguredPersistence,
} from "./index";

test("unconfigured persistence never reports a dependency as ready", async () => {
	const ports = createUnconfiguredPersistence();

	expect(await ports.database.check()).toBe("not_configured");
	expect(await ports.redis.check()).toBe("not_configured");
});

test("health knowledge repository stays fail-closed before reviewed content is persisted", async () => {
	const repository = createNotConfiguredHealthKnowledgeRepository();

	await expect(repository.listCatalog("part")).rejects.toMatchObject({
		name: "PersistenceNotConfiguredError",
		resource: "health-knowledge",
	});
});

test("in-memory repositories preserve owner isolation", async () => {
	const users = createInMemoryIdentityUserRepository();
	const first = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-001",
	});
	const same = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-001",
	});
	const patients = createInMemoryPatientRepository([
		{
			id: "patient-001",
			ownerUserId: first.userId,
			displayName: "测试患者",
			relationship: "self",
			cardNumberMasked: "****001",
			source: "legacy-record",
		},
		{
			id: "patient-002",
			ownerUserId: "other-user",
			displayName: "其他患者",
			relationship: "self",
			cardNumberMasked: "****002",
			source: "legacy-record",
		},
	]);

	expect(same.userId).toBe(first.userId);
	expect(await users.findByUserId(first.userId)).toEqual(first);
	expect(await patients.listByOwner(first.userId)).toHaveLength(1);
});

test("内存身份仓储补齐延迟返回的 unionId 但不覆盖既有绑定", async () => {
	const users = createInMemoryIdentityUserRepository();
	const first = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-union-001",
	});
	const enriched = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-union-001",
		unionId: "fixture-union-001",
	});
	const unchanged = await users.findOrCreateByWechat({
		providerSubject: "fixture-openid-union-001",
		unionId: "fixture-union-002",
	});

	expect(enriched).toMatchObject({
		userId: first.userId,
		unionId: "fixture-union-001",
	});
	expect(unchanged.unionId).toBe("fixture-union-001");
});

test("in-memory patient directory upsert keeps a stable internal id", async () => {
	const patients = createInMemoryPatientRepository();
	const first = await patients.upsertFromDirectory({
		ownerUserId: "user-001",
		patientId: "internal-patient-001",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-patient-001",
			providerReferences: { "his-patient": "his-patient-001" },
			displayName: "张三",
			relationship: "self",
			cardNumberMasked: "******7890",
		},
	});
	const refreshed = await patients.upsertFromDirectory({
		ownerUserId: "user-001",
		patientId: "must-not-replace-internal-id",
		provider: "zhongyang",
		profile: {
			providerPatientId: "provider-patient-001",
			providerReferences: { "his-patient": "his-patient-002" },
			displayName: "张三（更新）",
			relationship: "self",
			cardNumberMasked: "******0000",
		},
	});

	expect(first.id).toBe("internal-patient-001");
	expect(refreshed).toMatchObject({
		id: "internal-patient-001",
		displayName: "张三（更新）",
		cardNumberMasked: "******0000",
		source: "hospital-his",
	});
	expect(await patients.listByOwner("user-001")).toHaveLength(1);
	expect(
		await patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
		}),
	).toEqual({
		patientId: "internal-patient-001",
		provider: "zhongyang",
		providerPatientId: "provider-patient-001",
	});
	expect(
		await patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-001",
			provider: "zhongyang",
			referenceKind: "his-patient",
		}),
	).toEqual({
		patientId: "internal-patient-001",
		provider: "zhongyang",
		providerPatientId: "his-patient-002",
	});
	expect(
		await patients.resolveProviderReference({
			ownerUserId: "other-user",
			patientId: "internal-patient-001",
			provider: "zhongyang",
		}),
	).toBeUndefined();
});

test("患者目录完整快照只停用缺失患者并保留原内部 id", async () => {
	const patients = createInMemoryPatientRepository();
	if (!patients.replaceDirectorySnapshot)
		throw new Error("snapshot unavailable");

	const first = await patients.replaceDirectorySnapshot({
		ownerUserId: "user-001",
		provider: "zhongyang",
		observedAt: "2026-08-16T00:00:00.000Z",
		patients: [
			{
				patientId: "internal-patient-001",
				profile: {
					providerPatientId: "provider-patient-001",
					displayName: "张三",
					relationship: "self",
					cardNumberMasked: "******7890",
				},
			},
			{
				patientId: "internal-patient-002",
				profile: {
					providerPatientId: "provider-patient-002",
					displayName: "李四",
					relationship: "spouse",
					cardNumberMasked: "******0001",
				},
			},
		],
	});
	const second = await patients.replaceDirectorySnapshot({
		ownerUserId: "user-001",
		provider: "zhongyang",
		observedAt: "2026-08-16T01:00:00.000Z",
		patients: [
			{
				patientId: "must-not-replace-001",
				profile: {
					providerPatientId: "provider-patient-001",
					displayName: "张三（更新）",
					relationship: "self",
					cardNumberMasked: "******1111",
				},
			},
		],
	});

	expect(first.activePatients).toHaveLength(2);
	expect(second.deactivatedPatientCount).toBe(1);
	expect(second.activePatients).toEqual([
		{
			id: "internal-patient-001",
			ownerUserId: "user-001",
			displayName: "张三（更新）",
			relationship: "self",
			cardNumberMasked: "******1111",
			source: "hospital-his",
		},
	]);
	expect(
		await patients.resolveProviderReference({
			ownerUserId: "user-001",
			patientId: "internal-patient-002",
			provider: "zhongyang",
		}),
	).toBeUndefined();

	const restored = await patients.replaceDirectorySnapshot({
		ownerUserId: "user-001",
		provider: "zhongyang",
		observedAt: "2026-08-16T02:00:00.000Z",
		patients: [
			{
				patientId: "must-not-replace-002",
				profile: {
					providerPatientId: "provider-patient-002",
					displayName: "李四（恢复）",
					relationship: "spouse",
					cardNumberMasked: "******2222",
				},
			},
		],
	});

	expect(restored.deactivatedPatientCount).toBe(1);
	expect(restored.activePatients[0]).toMatchObject({
		id: "internal-patient-002",
		displayName: "李四（恢复）",
	});
});

test("appointment schedule snapshots reject stale observations and expire", async () => {
	const snapshots = createInMemoryAppointmentScheduleSnapshotRepository();
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
	const stored = await snapshots.upsert({
		schedule,
		provider: "zhongyang",
		providerScheduleId: "provider-schedule-001",
		providerRequestId: "provider-request-001",
		observedAt: "2026-08-15T00:00:10.000Z",
		expiresAt: "2026-08-15T00:01:10.000Z",
	});

	await snapshots.upsert({
		schedule: { ...schedule, availableSlots: 1 },
		provider: "zhongyang",
		providerScheduleId: "provider-schedule-stale",
		providerRequestId: "provider-request-stale",
		observedAt: "2026-08-15T00:00:09.000Z",
		expiresAt: "2026-08-15T00:01:09.000Z",
	});

	expect(
		await snapshots.findActive("schedule-001", "2026-08-15T00:00:30.000Z"),
	).toEqual(stored);
	expect(
		await snapshots.findActive("schedule-001", "2026-08-15T00:01:10.000Z"),
	).toBeUndefined();
});

test("appointment schedule snapshots reject invalid provider facts before storage", async () => {
	const snapshots = createInMemoryAppointmentScheduleSnapshotRepository();
	const schedule = {
		scheduleId: "schedule-invalid-001",
		departmentId: "dept-001",
		departmentName: "心内科",
		doctorId: "doctor-001",
		doctorName: "李医生",
		workDate: "2026-08-20",
		shiftName: "上午",
		totalSlots: 30,
		availableSlots: 12,
		timeGroup: "range" as const,
	};

	await expect(
		snapshots.upsert({
			schedule,
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-001",
			providerRequestId: "provider-request-001",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:00:10.000Z",
		}),
	).rejects.toMatchObject({
		name: "AppointmentScheduleSnapshotValidationError",
		reason: "invalid_observation_window",
	});

	await expect(
		snapshots.upsert({
			schedule: { ...schedule, workDate: "2026-02-30" },
			provider: "zhongyang",
			providerScheduleId: "provider-schedule-001",
			providerRequestId: "provider-request-001",
			observedAt: "2026-08-15T00:00:10.000Z",
			expiresAt: "2026-08-15T00:01:10.000Z",
		}),
	).rejects.toMatchObject({
		name: "AppointmentScheduleSnapshotValidationError",
		reason: "invalid_work_date",
	});

	expect(
		await snapshots.findActive(
			"schedule-invalid-001",
			"2026-08-15T00:00:30.000Z",
		),
	).toBeUndefined();
});

test("report references enforce owner isolation and expiry", async () => {
	const references = createInMemoryReportReferenceRepository();
	await references.upsert({
		reportId: "report-001",
		ownerUserId: "user-001",
		patientId: "patient-001",
		provider: "zhongyang",
		kind: "laboratory",
		providerReportId: "provider-report-001",
		createdAt: "2026-08-15T00:00:00.000Z",
		expiresAt: "2026-08-15T00:10:00.000Z",
	});

	expect(
		await references.findByOwnerAndId(
			"user-001",
			"report-001",
			"2026-08-15T00:05:00.000Z",
		),
	).toMatchObject({ providerReportId: "provider-report-001" });
	expect(
		await references.findByOwnerAndId(
			"user-002",
			"report-001",
			"2026-08-15T00:05:00.000Z",
		),
	).toBeUndefined();
	expect(
		await references.findByOwnerAndId(
			"user-001",
			"report-001",
			"2026-08-15T00:10:00.000Z",
		),
	).toBeUndefined();
	await expect(
		references.upsert({
			reportId: "report-too-long-ttl",
			ownerUserId: "user-001",
			patientId: "patient-001",
			provider: "zhongyang",
			kind: "laboratory",
			providerReportId: "provider-report-too-long-ttl",
			createdAt: "2026-08-15T00:00:00.000Z",
			expiresAt: "2026-08-15T00:16:00.000Z",
		}),
	).rejects.toMatchObject({
		name: "ReportReferenceValidationError",
		reason: "invalid_window",
	});
});

test("in-memory payment repository enforces owner lookup", async () => {
	const orders = createInMemoryPaymentOrderRepository([
		{
			orderId: "order-001",
			ownerUserId: "user-001",
			patientId: "patient-001",
			idempotencyKey: "key-001",
			amounts: { totalFen: 100, insuranceFen: 70, cashFen: 30 },
			state: "created",
			version: 1,
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:00.000Z",
		},
	]);

	expect(await orders.findByOwnerAndId("user-001", "order-001")).toBeDefined();
	expect(
		await orders.findByOwnerAndId("user-002", "order-001"),
	).toBeUndefined();
});

test("not-configured payment persistence fails closed", async () => {
	const repositories = createNotConfiguredRepositories();

	expect(
		repositories.paymentOrders.findByOwnerAndId("user-001", "order-001"),
	).rejects.toThrow("Dependency is not configured");
});

test("in-memory prepay attempts replay by owner, order and idempotency key", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository([
		{
			attemptId: "attempt-001",
			ownerUserId: "user-001",
			orderId: "order-001",
			provider: "wechat-pay",
			idempotencyKey: "prepay-001",
			status: "succeeded",
			version: 2,
			queryAttempts: 0,
			prepayId: "prepay-001",
			payParams: {
				appId: "app-001",
				timeStamp: "1700000000",
				nonceStr: "nonce-001",
				package: "prepay_id=prepay-001",
				signType: "RSA",
				paySign: "sign-001",
			},
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:01.000Z",
		},
	]);

	expect(
		await attempts.findByOwnerOrderAndIdempotencyKey(
			"user-001",
			"order-001",
			"prepay-001",
		),
	).toMatchObject({ attemptId: "attempt-001", status: "succeeded" });
	expect(
		await attempts.findByOwnerOrderAndIdempotencyKey(
			"user-002",
			"order-001",
			"prepay-001",
		),
	).toBeUndefined();
});

test("in-memory prepay attempts claim due work once until the lease expires", async () => {
	const attempts = createInMemoryPaymentPrepayAttemptRepository([
		{
			attemptId: "attempt-claim-001",
			ownerUserId: "user-claim-001",
			orderId: "order-claim-001",
			provider: "wechat-pay",
			idempotencyKey: "prepay-claim-001",
			status: "succeeded",
			version: 2,
			queryAttempts: 1,
			nextQueryAt: "2026-08-15T00:00:00.000Z",
			createdAt: "2026-08-15T00:00:00.000Z",
			updatedAt: "2026-08-15T00:00:00.000Z",
		},
	]);
	const claimAt = new Date("2026-08-15T00:00:00.000Z");
	const staleAttempt = await attempts.findByOwnerOrderAndIdempotencyKey(
		"user-claim-001",
		"order-claim-001",
		"prepay-claim-001",
	);
	if (!staleAttempt) throw new Error("Claim test seed was not found");

	expect(await attempts.claimDueForQuery(claimAt, 1, 60_000)).toMatchObject([
		{ version: 3, queryClaimedUntil: "2026-08-15T00:01:00.000Z" },
	]);
	await expect(
		attempts.update(staleAttempt, staleAttempt.version),
	).rejects.toThrow("Payment prepay attempt was changed by another request");
	expect(await attempts.claimDueForQuery(claimAt, 1, 60_000)).toEqual([]);
	expect(
		await attempts.claimDueForQuery(
			new Date("2026-08-15T00:01:00.000Z"),
			1,
			60_000,
		),
	).toMatchObject([
		{ version: 4, queryClaimedUntil: "2026-08-15T00:02:00.000Z" },
	]);
});
