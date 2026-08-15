import { strict as assert } from "node:assert";
import { PaymentOrderService } from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { readCoreSchemaStateFromPool } from "./migrate";
import { createMySqlRepositories } from "./mysql-repositories";
import { createPersistenceRuntime } from "./runtime";

const logger = createLogger({
	service: "hospital-persistence-integration",
	environment: Bun.env.NODE_ENV ?? "development",
	level: (Bun.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
});

function requiredLocalEnv(name: "DATABASE_URL" | "REDIS_URL"): string {
	const value = Bun.env[name];
	if (!value)
		throw new Error(`${name} is required for persistence integration`);
	const hostname = new URL(value).hostname;
	if (
		!(
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "::1"
		)
	) {
		throw new Error(
			`${name} must point to localhost; integration cleanup refuses remote databases`,
		);
	}
	return value;
}

function wait(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 只针对隔离的本地数据库执行真实依赖 smoke；不会被默认单元测试自动运行。
 *
 * 覆盖范围刻意围绕当前 Phase 5A-2 的边界：运行时探针、Redis TTL、
 * MySQL 外键写入、订单幂等竞争、订单-outbox 同事务、outbox lease 恢复、
 * 预支付查单 claim lease 恢复、排班快照 TTL/旧观察保护和 LIS 报告引用 owner/TTL 保护。
 * provider、医保、HIS 和真实微信回调不在本脚本的证明范围内。
 */
export async function runPersistenceIntegration() {
	const databaseUrl = requiredLocalEnv("DATABASE_URL");
	const redisUrl = requiredLocalEnv("REDIS_URL");
	const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
	const providerSubject = `integration-provider-${suffix}`;
	const patientId = `integration-patient-${suffix}`;
	const quoteId = `integration-quote-${suffix}`;
	const invalidQuoteId = `integration-invalid-quote-${suffix}`;
	const scheduleId = `integration-platform-schedule-${suffix}`;
	const reportId = `integration-report-${suffix}`;
	const sessionToken = `integration-session-${suffix}`;
	const orderIdPrefix = `integration-order-${suffix}`;
	const attemptId = `integration-attempt-${suffix}`;

	const runtime = createPersistenceRuntime({
		databaseUrl,
		redisUrl,
		useRepositories: true,
	});
	let pool: Pool | undefined;
	let userId: string | undefined;
	let otherUserId: string | undefined;
	let integrationOperationFailed = false;
	let integrationOperationError: unknown;
	try {
		// 并行采集两个依赖状态，失败时一次日志就能定位基础设施边界。
		const [database, redis] = await Promise.all([
			runtime.database.check(),
			runtime.redis.check(),
		]);
		logger.info(
			{
				event: "persistence.integration.dependencies",
				database,
				redis,
			},
			"Persistence integration dependency probes completed",
		);
		assert.equal(database, "ok", "MySQL dependency probe did not pass");
		assert.equal(redis, "ok", "Redis dependency probe did not pass");
		assert.ok(runtime.sessions);
		const sessionTtlSeconds = 1;
		await runtime.sessions.save(
			sessionToken,
			"integration-user",
			sessionTtlSeconds,
		);
		assert.equal(
			await runtime.sessions.findUserId(sessionToken),
			"integration-user",
		);
		// Redis EX 使用整秒 TTL；多等待一秒，避免在过期边界读取造成偶发假阴性。
		await wait((sessionTtlSeconds + 1) * 1_000);
		assert.equal(await runtime.sessions.findUserId(sessionToken), undefined);
	} finally {
		await runtime.close();
	}

	try {
		pool = createPool({
			uri: databaseUrl,
			connectionLimit: 4,
			connectTimeout: 3_000,
			dateStrings: true,
			waitForConnections: true,
		});
		// 在写入任何集成数据前先确认全部目标 migration 已登记；否则
		// 后续外键/列错误会掩盖真正的 schema readiness 问题。
		const schemaState = await readCoreSchemaStateFromPool(pool);
		logger.info(
			{
				event: "persistence.integration.schema_probe",
				status: schemaState.status,
				schemaStatus: schemaState.schemaStatus,
				expectedMigrationId: schemaState.expectedMigrationId,
				missingMigrationIds: schemaState.missingMigrationIds,
				missingSchemaObjects: schemaState.missingSchemaObjects,
			},
			"Persistence integration schema probe completed",
		);
		assert.equal(
			schemaState.status,
			"ready",
			`Persistence schema is not ready; missing migrations: ${schemaState.missingMigrationIds.join(", ")}`,
		);
		const repositories = createMySqlRepositories(pool, {
			// 短 lease 只用于证明 crash recovery；生产默认仍为 60 秒。
			outboxClaimLeaseMs: 100,
			paymentDataEncryptionKey: Buffer.alloc(32, 9).toString("base64"),
		});

		const user = await repositories.identityUsers.findOrCreateByWechat({
			providerSubject,
		});
		userId = user.userId;
		const now = new Date();
		await pool.execute(
			"INSERT INTO hp_patients (patient_id, owner_user_id, display_name, relationship, card_number_masked, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			[
				patientId,
				user.userId,
				"集成验收患者",
				"self",
				"****0000",
				"legacy-record",
				now,
				now,
			],
		);
		await pool.execute(
			"INSERT INTO hp_payment_quotes (quote_id, owner_user_id, patient_id, total_fen, insurance_fen, cash_fen, expires_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				quoteId,
				user.userId,
				patientId,
				1000,
				600,
				400,
				new Date(Date.now() + 60_000),
				"fixture",
				now,
			],
		);

		const snapshotObservedAt = new Date(now.getTime() + 1_000);
		const snapshotExpiresAt = new Date(now.getTime() + 61_000);
		const providerScheduleId = `integration-provider-schedule-${suffix}`;
		const schedule = {
			scheduleId,
			departmentId: "integration-department",
			departmentName: "集成验收科室",
			doctorId: "integration-doctor",
			doctorName: "集成验收医生",
			workDate: "2026-08-20",
			shiftName: "上午",
			startTime: "08:00",
			endTime: "12:00",
			totalSlots: 30,
			availableSlots: 12,
			timeGroup: "range" as const,
		};
		const storedSnapshot =
			await repositories.appointmentScheduleSnapshots.upsert({
				schedule,
				provider: "zhongyang",
				providerScheduleId,
				providerRequestId: `integration-provider-request-${suffix}`,
				observedAt: snapshotObservedAt.toISOString(),
				expiresAt: snapshotExpiresAt.toISOString(),
			});
		assert.equal(storedSnapshot.providerScheduleId, providerScheduleId);
		const staleSnapshot =
			await repositories.appointmentScheduleSnapshots.upsert({
				schedule: { ...schedule, availableSlots: 1 },
				provider: "zhongyang",
				providerScheduleId: `${providerScheduleId}-stale`,
				providerRequestId: `integration-provider-request-${suffix}-stale`,
				observedAt: new Date(
					snapshotObservedAt.getTime() - 1_000,
				).toISOString(),
				expiresAt: new Date(snapshotExpiresAt.getTime() - 1_000).toISOString(),
			});
		assert.equal(staleSnapshot.providerScheduleId, providerScheduleId);
		const activeSnapshot =
			await repositories.appointmentScheduleSnapshots.findActive(
				scheduleId,
				snapshotObservedAt.toISOString(),
			);
		assert.equal(activeSnapshot?.providerScheduleId, providerScheduleId);
		assert.equal(
			await repositories.appointmentScheduleSnapshots.findActive(
				scheduleId,
				snapshotExpiresAt.toISOString(),
			),
			undefined,
		);

		const reportReference = await repositories.reportReferences.upsert({
			reportId,
			ownerUserId: user.userId,
			patientId,
			provider: "zhongyang",
			kind: "laboratory",
			providerReportId: `integration-provider-report-${suffix}`,
			createdAt: now.toISOString(),
			expiresAt: new Date(now.getTime() + 60_000).toISOString(),
		});
		assert.equal(reportReference.reportId, reportId);
		assert.equal(
			(
				await repositories.reportReferences.findByOwnerAndId(
					user.userId,
					reportId,
					new Date(now.getTime() + 30_000).toISOString(),
				)
			)?.providerReportId,
			reportReference.providerReportId,
		);
		assert.equal(
			await repositories.reportReferences.findByOwnerAndId(
				"integration-other-user-not-owner",
				reportId,
				new Date(now.getTime() + 30_000).toISOString(),
			),
			undefined,
		);
		assert.equal(
			await repositories.reportReferences.findByOwnerAndId(
				user.userId,
				reportId,
				new Date(now.getTime() + 60_000).toISOString(),
			),
			undefined,
		);

		const otherUser = await repositories.identityUsers.findOrCreateByWechat({
			providerSubject: `integration-other-provider-${suffix}`,
		});
		otherUserId = otherUser.userId;
		await assert.rejects(
			pool.execute(
				"INSERT INTO hp_payment_quotes (quote_id, owner_user_id, patient_id, total_fen, insurance_fen, cash_fen, expires_at, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				[
					invalidQuoteId,
					otherUser.userId,
					patientId,
					1000,
					600,
					400,
					new Date(Date.now() + 60_000),
					"fixture",
					now,
				],
			),
			(error: unknown) =>
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error as { code?: unknown }).code === "ER_NO_REFERENCED_ROW_2",
		);

		const orderIds = [`${orderIdPrefix}-a`, `${orderIdPrefix}-b`];
		const service = new PaymentOrderService({
			orders: repositories.paymentOrders,
			quotes: repositories.paymentQuotes,
			createOrderId: () => orderIds.shift() ?? `${orderIdPrefix}-overflow`,
		});
		const createInput = {
			ownerUserId: user.userId,
			patientId,
			quoteId,
			idempotencyKey: `integration-idempotency-${suffix}`,
		};

		// 两个请求同时穿过“先查后写”；最终只能有一个数据库事实。
		const [first, replay] = await Promise.all([
			service.createFromQuote(createInput),
			service.createFromQuote(createInput),
		]);
		assert.equal(first.orderId, replay.orderId);
		assert.equal(first.amounts.totalFen, 1000);

		await repositories.paymentPrepayAttempts.insert({
			attemptId,
			ownerUserId: user.userId,
			orderId: first.orderId,
			provider: "wechat-pay",
			idempotencyKey: `integration-prepay-${suffix}`,
			status: "succeeded",
			version: 1,
			queryAttempts: 0,
			nextQueryAt: now.toISOString(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		});
		const claimNow = new Date();
		const firstClaim =
			await repositories.paymentPrepayAttempts.claimDueForQuery(
				claimNow,
				1,
				100,
			);
		assert.equal(firstClaim.length, 1);
		assert.ok(firstClaim[0]?.queryClaimedUntil);
		const [claimRows] = await pool.execute<
			(RowDataPacket & {
				attempt_id: string;
				query_claimed_until: string | null;
			})[]
		>(
			"SELECT attempt_id, query_claimed_until FROM hp_payment_prepay_attempts WHERE attempt_id = ?",
			[attemptId],
		);
		assert.equal(claimRows[0]?.attempt_id, attemptId);
		assert.ok(claimRows[0]?.query_claimed_until);
		const secondClaim =
			await repositories.paymentPrepayAttempts.claimDueForQuery(
				claimNow,
				1,
				100,
			);
		assert.equal(
			secondClaim.length,
			0,
			`Unexpected second claim: ${JSON.stringify(
				secondClaim.map((attempt) => ({
					attemptId: attempt.attemptId,
					queryClaimedUntil: attempt.queryClaimedUntil,
				})),
			)}`,
		);
		await wait(180);
		const reclaimedAttempt =
			await repositories.paymentPrepayAttempts.claimDueForQuery(
				new Date(),
				1,
				100,
			);
		assert.equal(reclaimedAttempt.length, 1);

		const authorized = await service.transition(
			user.userId,
			first.orderId,
			"authorized",
		);
		assert.equal(authorized.version, 2);

		const createdEvent = await repositories.outbox.claimAvailable(new Date());
		assert.ok(createdEvent);
		assert.equal(createdEvent.aggregateId, first.orderId);
		await repositories.outbox.markProcessed(createdEvent.eventId, new Date());

		// 不确认第二个事件，模拟 worker 在 provider 调用前崩溃；lease 到期后
		// 另一个 worker 必须能够重新领取同一个 event，而不是永久丢失。
		const leasedEvent = await repositories.outbox.claimAvailable(new Date());
		assert.ok(leasedEvent);
		await wait(180);
		const reclaimedEvent = await repositories.outbox.claimAvailable(new Date());
		assert.ok(reclaimedEvent);
		assert.equal(reclaimedEvent.eventId, leasedEvent.eventId);
		await repositories.outbox.markProcessed(reclaimedEvent.eventId, new Date());
		assert.equal(
			await repositories.outbox.claimAvailable(new Date()),
			undefined,
		);

		logger.info(
			{
				event: "persistence.integration.succeeded",
				checks: [
					"mysql-probe",
					"redis-probe",
					"redis-session-ttl-expiry",
					"mysql-owner-foreign-key",
					"owner-scoped-composite-foreign-key",
					"appointment-schedule-snapshot-ttl-and-stale-guard",
					"report-reference-owner-and-ttl-guard",
					"concurrent-idempotency",
					"prepay-query-claim-lease-recovery",
					"order-outbox-transaction",
					"outbox-lease-recovery",
				],
			},
			"Persistence integration checks passed",
		);
	} catch (error) {
		integrationOperationFailed = true;
		integrationOperationError = error;
	}

	let cleanupError: unknown;
	try {
		if (pool && userId) {
			// 该脚本只允许在本地隔离库运行；清理顺序遵循外键依赖。
			await pool.execute(
				"DELETE FROM hp_payment_prepay_attempts WHERE attempt_id = ?",
				[attemptId],
			);
			await pool.execute(
				"DELETE FROM hp_outbox_events WHERE aggregate_id LIKE ?",
				[`${orderIdPrefix}%`],
			);
			await pool.execute(
				"DELETE FROM hp_payment_orders WHERE order_id LIKE ?",
				[`${orderIdPrefix}%`],
			);
			await pool.execute("DELETE FROM hp_payment_quotes WHERE quote_id = ?", [
				quoteId,
			]);
			await pool.execute(
				"DELETE FROM hp_appointment_schedule_snapshots WHERE schedule_id = ?",
				[scheduleId],
			);
			await pool.execute(
				"DELETE FROM hp_report_references WHERE report_id = ?",
				[reportId],
			);
			await pool.execute("DELETE FROM hp_patients WHERE patient_id = ?", [
				patientId,
			]);
			if (otherUserId) {
				await pool.execute("DELETE FROM hp_identity_users WHERE user_id = ?", [
					otherUserId,
				]);
			}
			await pool.execute("DELETE FROM hp_identity_users WHERE user_id = ?", [
				userId,
			]);
		}
	} catch (error) {
		cleanupError = error;
		logger.error(
			{
				event: "persistence.integration.cleanup_failed",
				errorType: error instanceof Error ? error.name : "UnknownError",
				originalOperationFailed: integrationOperationFailed,
			},
			"Persistence integration cleanup failed",
		);
	} finally {
		// 无论主体或清理是否失败，都必须释放 MySQL 连接池。
		await pool?.end();
	}

	// 主体验收优先；只有清理本身是唯一失败时才抛出清理异常。
	if (integrationOperationFailed) throw integrationOperationError;
	if (cleanupError !== undefined) throw cleanupError;
}

if (import.meta.main) {
	await runPersistenceIntegration().catch((error) => {
		logger.error(
			{
				event: "persistence.integration.failed",
				// 集成错误可能包含驱动上下文；Pino 日志只保留错误类型，
				// 不把原始异常对象或连接信息写入标准输出。
				errorType: error instanceof Error ? error.name : "UnknownError",
			},
			"Persistence integration checks failed",
		);
		process.exitCode = 1;
	});
}
