import {
	type HisPaymentReference,
	HisPaymentReferenceConflictError,
	HisPaymentReferenceExhaustedError,
	HisPaymentReferenceNotInitializedError,
	type HisPaymentReferenceRepository,
	type HisPaymentReferenceScope,
	MAX_HIS_PAYMENT_REFERENCE,
	normalizeHisPaymentReference,
} from "@hospital/domain";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { PersistenceNotConfiguredError } from "./errors";

function validateScope(scope: HisPaymentReferenceScope): void {
	for (const value of [scope.ownerUserId, scope.medicalOrderId]) {
		if (!/^[A-Za-z0-9._:-]{1,64}$/u.test(value))
			throw new Error("Invalid HIS payment scope");
	}
	if (
		!/^[A-Za-z0-9._:-]{1,128}$/u.test(scope.paymentScopeId) ||
		(scope.source !== "plugin" && scope.source !== "component")
	)
		throw new Error("Invalid HIS payment scope");
}

function scopeKey(scope: HisPaymentReferenceScope): string {
	return JSON.stringify([
		scope.medicalOrderId,
		scope.source,
		scope.paymentScopeId,
	]);
}

function sameScope(
	left: HisPaymentReferenceScope,
	right: HisPaymentReferenceScope,
): boolean {
	return (
		left.ownerUserId === right.ownerUserId && scopeKey(left) === scopeKey(right)
	);
}

export function createNotConfiguredHisPaymentReferenceRepository(): HisPaymentReferenceRepository {
	const fail = async (): Promise<never> => {
		throw new PersistenceNotConfiguredError("his-payment-references");
	};
	return {
		allocate: fail,
		confirm: fail,
		findByReferenceId: fail,
		findByScope: fail,
		initializeNewNumbering: fail,
		quarantineReferenceId: fail,
	};
}

/** 测试工厂默认可分配；门禁专项测试显式 false 模拟生产默认值。 */
export function createInMemoryHisPaymentReferenceRepository(
	options: { numberingInitialized?: boolean } = {},
): HisPaymentReferenceRepository {
	const scopes = new Map<string, HisPaymentReference>();
	const aliases = new Map<string, HisPaymentReference>();
	const conflicted = new Set<string>();
	let initialized = options.numberingInitialized ?? true;
	let next = 1n;
	return {
		async allocate(scope) {
			validateScope(scope);
			if (!initialized) throw new HisPaymentReferenceNotInitializedError();
			const existing = scopes.get(scopeKey(scope));
			if (existing) {
				if (!sameScope(existing, scope))
					throw new HisPaymentReferenceConflictError();
				if (conflicted.has(existing.referenceId))
					throw new HisPaymentReferenceConflictError();
				return { ...existing };
			}
			while (aliases.has(next.toString())) next++;
			if (next > BigInt(MAX_HIS_PAYMENT_REFERENCE))
				throw new HisPaymentReferenceExhaustedError();
			const referenceId = normalizeHisPaymentReference(next++);
			const record: HisPaymentReference = {
				...scope,
				referenceId,
				requestReferenceId: referenceId,
				status: "allocated",
				createdAt: new Date().toISOString(),
			};
			scopes.set(scopeKey(scope), record);
			aliases.set(referenceId, record);
			return { ...record };
		},
		async confirm(input) {
			const receiptId = normalizeHisPaymentReference(input.referenceId);
			validateScope(input);
			const existing = scopes.get(scopeKey(input));
			if (
				existing &&
				(!sameScope(existing, input) ||
					(existing.receiptId && existing.receiptId !== receiptId))
			)
				throw new HisPaymentReferenceConflictError();
			const alias = aliases.get(receiptId);
			if (conflicted.has(receiptId))
				throw new HisPaymentReferenceConflictError();
			if (alias && !sameScope(alias, input)) {
				// 保留原归属用于审计，但这个号从此不能定位任何支付进行退款。
				conflicted.add(receiptId);
				throw new HisPaymentReferenceConflictError();
			}
			const { referenceId: _inputReferenceId, ...scope } = input;
			const record: HisPaymentReference = existing ?? {
				...scope,
				referenceId: receiptId,
				status: "confirmed",
				receiptId,
				createdAt: new Date().toISOString(),
			};
			Object.assign(record, { status: "confirmed", receiptId });
			scopes.set(scopeKey(scope), record);
			aliases.set(receiptId, record);
			return { ...record };
		},
		async findByReferenceId(value) {
			const referenceId = normalizeHisPaymentReference(value);
			if (conflicted.has(referenceId))
				throw new HisPaymentReferenceConflictError();
			const record = aliases.get(referenceId);
			return record ? { ...record } : undefined;
		},
		async findByScope(scope) {
			validateScope(scope);
			const record = scopes.get(scopeKey(scope));
			return record && sameScope(record, scope) ? { ...record } : undefined;
		},
		async initializeNewNumbering() {
			if (conflicted.size) throw new HisPaymentReferenceConflictError();
			initialized = true;
		},
		async quarantineReferenceId(value) {
			const referenceId = normalizeHisPaymentReference(value);
			if (aliases.has(referenceId)) conflicted.add(referenceId);
		},
	};
}

const SCOPE_COLUMNS =
	"CAST(s.allocation_id AS CHAR) AS internal_allocation_id, CAST(s.request_reference_id AS CHAR) AS request_reference_id, s.owner_user_id, s.medical_order_id, s.payment_scope_id, s.source, s.status, CAST(s.receipt_id AS CHAR) AS receipt_id, s.created_at";
type StoredReference = { allocationId: string; record: HisPaymentReference };

function fromRow(row: RowDataPacket): StoredReference {
	const scope: HisPaymentReferenceScope = {
		ownerUserId: row.owner_user_id,
		medicalOrderId: row.medical_order_id,
		paymentScopeId: row.payment_scope_id,
		source: row.source,
	};
	validateScope(scope);
	if (row.status !== "allocated" && row.status !== "confirmed")
		throw new Error("Invalid HIS reference status");
	const requestReferenceId =
		row.request_reference_id == null
			? undefined
			: normalizeHisPaymentReference(row.request_reference_id);
	const receiptId =
		row.receipt_id == null
			? undefined
			: normalizeHisPaymentReference(row.receipt_id);
	if (
		(row.status === "allocated" && (!requestReferenceId || receiptId)) ||
		(row.status === "confirmed" && !receiptId)
	)
		throw new Error("Invalid HIS reference state");
	const referenceId = requestReferenceId ?? receiptId;
	if (!referenceId) throw new Error("HIS reference has no public number");
	return {
		allocationId: normalizeHisPaymentReference(row.internal_allocation_id),
		record: {
			...scope,
			referenceId,
			...(requestReferenceId ? { requestReferenceId } : {}),
			status: row.status,
			...(receiptId ? { receiptId } : {}),
			createdAt:
				row.created_at instanceof Date
					? row.created_at.toISOString()
					: new Date(
							`${String(row.created_at).replace(" ", "T")}Z`,
						).toISOString(),
		},
	};
}

async function lockAllocator(
	connection: PoolConnection,
): Promise<RowDataPacket> {
	const [rows] = await connection.execute<RowDataPacket[]>(
		"SELECT initialized, CAST(next_reference_id AS CHAR) AS next_reference_id FROM hp_his_payment_reference_allocator WHERE singleton_id = 1 FOR UPDATE",
	);
	if (!rows[0]) throw new HisPaymentReferenceNotInitializedError();
	return rows[0];
}

async function rollbackOrDiscard(connection: PoolConnection): Promise<void> {
	try {
		await connection.rollback();
	} catch {
		connection.destroy();
	}
}

async function nextPublicReference(
	connection: PoolConnection,
	state: RowDataPacket,
): Promise<string> {
	if (Number(state.initialized) !== 1)
		throw new HisPaymentReferenceNotInitializedError();
	if (state.next_reference_id === null)
		throw new HisPaymentReferenceExhaustedError();
	let candidate = normalizeHisPaymentReference(state.next_reference_id);
	const [occupied] = await connection.execute<RowDataPacket[]>(
		"SELECT reference_id FROM hp_his_payment_references WHERE reference_id = ? LIMIT 1 FOR UPDATE",
		[candidate],
	);
	if (occupied.length) {
		// 一次查询跨过连续历史号，包含已隔离号；不靠碰撞重试数寻找空位。
		const [gaps] = await connection.execute<RowDataPacket[]>(
			`SELECT CAST(MIN(CAST(candidate.reference_id AS DECIMAL(20,0)) + 1) AS CHAR) AS next_id
			 FROM hp_his_payment_references candidate
			 LEFT JOIN hp_his_payment_references occupied
			 ON occupied.reference_id = CAST(candidate.reference_id AS DECIMAL(20,0)) + 1
			 WHERE candidate.reference_id >= ? AND candidate.reference_id < ?
			 AND occupied.reference_id IS NULL`,
			[candidate, MAX_HIS_PAYMENT_REFERENCE],
		);
		if (gaps[0]?.next_id == null) throw new HisPaymentReferenceExhaustedError();
		candidate = normalizeHisPaymentReference(gaps[0].next_id);
	}
	return candidate;
}

async function bindAlias(
	connection: PoolConnection,
	referenceId: string,
	allocationId: string,
): Promise<void> {
	await connection.execute(
		"INSERT INTO hp_his_payment_references (reference_id, allocation_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE allocation_id = allocation_id",
		[referenceId, allocationId],
	);
	const [rows] = await connection.execute<RowDataPacket[]>(
		"SELECT CAST(allocation_id AS CHAR) AS allocation_id, conflicted FROM hp_his_payment_references WHERE reference_id = ? FOR UPDATE",
		[referenceId],
	);
	if (
		rows[0]?.allocation_id !== allocationId ||
		Number(rows[0]?.conflicted) !== 0
	)
		throw new HisPaymentReferenceConflictError();
}

/** 所有映射写事务先锁单行 allocator，再锁订单/别名，统一锁顺序。 */
export function createMySqlHisPaymentReferenceRepository(
	pool: Pool,
): HisPaymentReferenceRepository {
	async function write(
		scope: HisPaymentReferenceScope,
		receiptId?: string,
	): Promise<HisPaymentReference> {
		validateScope(scope);
		const connection = await pool.getConnection();
		let committed = false;
		try {
			await connection.beginTransaction();
			const allocator = await lockAllocator(connection);
			if (!receiptId && Number(allocator.initialized) !== 1)
				throw new HisPaymentReferenceNotInitializedError();
			const [orders] = await connection.execute<RowDataPacket[]>(
				"SELECT medical_order_id FROM hp_medical_insurance_orders WHERE medical_order_id = ? AND owner_user_id = ? FOR UPDATE",
				[scope.medicalOrderId, scope.ownerUserId],
			);
			if (orders.length !== 1)
				throw new Error("HIS payment reference order not found");
			const [existing] = await connection.execute<RowDataPacket[]>(
				`SELECT ${SCOPE_COLUMNS} FROM hp_his_payment_reference_scopes s WHERE s.medical_order_id = ? AND s.source = ? AND s.payment_scope_id = ? FOR UPDATE`,
				[scope.medicalOrderId, scope.source, scope.paymentScopeId],
			);
			let stored = existing[0] ? fromRow(existing[0]) : undefined;
			if (stored && !sameScope(stored.record, scope))
				throw new HisPaymentReferenceConflictError();
			if (
				stored?.record.receiptId &&
				receiptId &&
				stored.record.receiptId !== receiptId
			)
				throw new HisPaymentReferenceConflictError();
			if (receiptId) {
				const [aliases] = await connection.execute<RowDataPacket[]>(
					"SELECT CAST(allocation_id AS CHAR) AS allocation_id, conflicted FROM hp_his_payment_references WHERE reference_id = ? FOR UPDATE",
					[receiptId],
				);
				const alias = aliases[0];
				if (alias && Number(alias.conflicted) !== 0)
					throw new HisPaymentReferenceConflictError();
				if (alias && alias.allocation_id !== stored?.allocationId) {
					// 本事务尚未创建/改写 scope：只提交隔离标记，不能在 throw 后撤回。
					await connection.execute(
						"UPDATE hp_his_payment_references SET conflicted = 1 WHERE reference_id = ?",
						[receiptId],
					);
					await connection.commit();
					committed = true;
					throw new HisPaymentReferenceConflictError();
				}
			}
			if (!receiptId && stored) {
				const [aliases] = await connection.execute<RowDataPacket[]>(
					"SELECT conflicted FROM hp_his_payment_references WHERE reference_id = ? FOR UPDATE",
					[stored.record.referenceId],
				);
				if (!aliases[0] || Number(aliases[0].conflicted) !== 0)
					throw new HisPaymentReferenceConflictError();
			}
			let requestReferenceId: string | undefined;
			if (!stored && !receiptId)
				requestReferenceId = await nextPublicReference(connection, allocator);
			if (!stored) {
				await connection.execute(
					"INSERT INTO hp_his_payment_reference_scopes (owner_user_id, medical_order_id, payment_scope_id, source, request_reference_id, status, receipt_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
					[
						scope.ownerUserId,
						scope.medicalOrderId,
						scope.paymentScopeId,
						scope.source,
						requestReferenceId ?? null,
						receiptId ? "confirmed" : "allocated",
						receiptId ?? null,
					],
				);
				const [created] = await connection.execute<RowDataPacket[]>(
					`SELECT ${SCOPE_COLUMNS} FROM hp_his_payment_reference_scopes s WHERE s.medical_order_id = ? AND s.source = ? AND s.payment_scope_id = ? FOR UPDATE`,
					[scope.medicalOrderId, scope.source, scope.paymentScopeId],
				);
				if (!created[0])
					throw new Error("HIS payment scope allocation missing");
				stored = fromRow(created[0]);
			}
			if (requestReferenceId) {
				await bindAlias(connection, requestReferenceId, stored.allocationId);
				const next =
					BigInt(requestReferenceId) < BigInt(MAX_HIS_PAYMENT_REFERENCE)
						? (BigInt(requestReferenceId) + 1n).toString()
						: null;
				await connection.execute(
					"UPDATE hp_his_payment_reference_allocator SET next_reference_id = ? WHERE singleton_id = 1",
					[next],
				);
			}
			if (receiptId) {
				await bindAlias(connection, receiptId, stored.allocationId);
				await connection.execute(
					"UPDATE hp_his_payment_reference_scopes SET status = 'confirmed', receipt_id = ? WHERE allocation_id = ?",
					[receiptId, stored.allocationId],
				);
			}
			await connection.commit();
			committed = true;
			return receiptId
				? { ...stored.record, status: "confirmed", receiptId }
				: stored.record;
		} catch (error) {
			if (!committed) await rollbackOrDiscard(connection);
			throw error;
		} finally {
			connection.release();
		}
	}
	return {
		allocate: (scope) => write(scope),
		async confirm({ referenceId, ...scope }) {
			return write(scope, normalizeHisPaymentReference(referenceId));
		},
		async findByReferenceId(value) {
			const referenceId = normalizeHisPaymentReference(value);
			const [rows] = await pool.execute<RowDataPacket[]>(
				`SELECT ${SCOPE_COLUMNS}, r.conflicted AS reference_conflicted FROM hp_his_payment_references r INNER JOIN hp_his_payment_reference_scopes s ON s.allocation_id = r.allocation_id WHERE r.reference_id = ?`,
				[referenceId],
			);
			if (!rows[0]) return undefined;
			if (Number(rows[0].reference_conflicted) !== 0)
				throw new HisPaymentReferenceConflictError();
			const record = fromRow(rows[0]).record;
			return record.requestReferenceId === referenceId ||
				record.receiptId === referenceId
				? record
				: undefined;
		},
		async findByScope(scope) {
			validateScope(scope);
			const [rows] = await pool.execute<RowDataPacket[]>(
				`SELECT ${SCOPE_COLUMNS} FROM hp_his_payment_reference_scopes s WHERE s.medical_order_id = ? AND s.owner_user_id = ? AND s.source = ? AND s.payment_scope_id = ? LIMIT 1`,
				[
					scope.medicalOrderId,
					scope.ownerUserId,
					scope.source,
					scope.paymentScopeId,
				],
			);
			const record = rows[0] ? fromRow(rows[0]).record : undefined;
			return record && sameScope(record, scope) ? record : undefined;
		},
		async initializeNewNumbering() {
			const connection = await pool.getConnection();
			try {
				await connection.beginTransaction();
				await lockAllocator(connection);
				const [blocked] = await connection.execute<RowDataPacket[]>(
					"SELECT reference_id FROM hp_his_payment_references WHERE conflicted = 1 LIMIT 1",
				);
				if (blocked.length) throw new HisPaymentReferenceConflictError();
				await connection.execute(
					"UPDATE hp_his_payment_reference_allocator SET initialized = 1, initialized_at = COALESCE(initialized_at, NOW(3)) WHERE singleton_id = 1",
				);
				await connection.commit();
			} catch (error) {
				await rollbackOrDiscard(connection);
				throw error;
			} finally {
				connection.release();
			}
		},
		async quarantineReferenceId(value) {
			const referenceId = normalizeHisPaymentReference(value);
			const connection = await pool.getConnection();
			try {
				await connection.beginTransaction();
				await lockAllocator(connection);
				await connection.execute(
					"UPDATE hp_his_payment_references SET conflicted = 1 WHERE reference_id = ?",
					[referenceId],
				);
				await connection.commit();
			} catch (error) {
				await rollbackOrDiscard(connection);
				throw error;
			} finally {
				connection.release();
			}
		},
	};
}
