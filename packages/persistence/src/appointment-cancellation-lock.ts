import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { AppointmentCancellationBusyError } from "@hospital/domain";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

type LockToken = { active: boolean };
type LockScope = Map<string, LockToken>;
type PoolLockState = {
	context: AsyncLocalStorage<LockScope>;
	admitted: number;
};

const poolLockStates = new WeakMap<Pool, PoolLockState>();

function poolLockState(pool: Pool): PoolLockState {
	const existing = poolLockStates.get(pool);
	if (existing) return existing;
	const state = {
		context: new AsyncLocalStorage<LockScope>(),
		admitted: 0,
	};
	poolLockStates.set(pool, state);
	return state;
}

async function inOwnedLockScope<T>(
	context: AsyncLocalStorage<LockScope>,
	key: string,
	operation: () => Promise<T>,
): Promise<T> {
	const scope = new Map(context.getStore());
	const token = { active: true };
	scope.set(key, token);
	try {
		return await context.run(scope, operation);
	} finally {
		// Detached async work keeps the same token object, which must stop being
		// valid once the owning operation has completed and its lock is released.
		token.active = false;
	}
}

function lockAdmissionLimit(pool: Pool): number {
	const configured = (
		pool as unknown as {
			pool?: { config?: { connectionLimit?: unknown } };
		}
	).pool?.config?.connectionLimit;
	if (
		typeof configured !== "number" ||
		!Number.isSafeInteger(configured) ||
		configured <= 1
	) {
		throw new Error("Appointment cancellation lock is unavailable");
	}
	// A named lock reserves a connection while its operation uses normal pool
	// queries. Reserve capacity for those queries and bound held lock frames.
	return Math.max(1, Math.min(4, configured - 1));
}

export async function withMySqlAppointmentCancellationLock<T>(
	pool: Pool,
	ownerUserId: string,
	appointmentId: string,
	operation: () => Promise<T>,
): Promise<T> {
	const state = poolLockState(pool);
	const lockName = createHash("sha256")
		.update("hospital:appointment-cancellation:")
		.update(JSON.stringify([ownerUserId, appointmentId]))
		.digest("hex");
	if (state.context.getStore()?.get(lockName)?.active) return operation();
	if (state.admitted >= lockAdmissionLimit(pool)) {
		throw new AppointmentCancellationBusyError();
	}
	// Claim before awaiting a connection; parallel callers cannot fill the pool
	// with lock holders that are all waiting for their own nested SQL query.
	state.admitted += 1;
	try {
		let connection: PoolConnection;
		try {
			connection = await pool.getConnection();
		} catch {
			throw new Error("Appointment cancellation lock is unavailable");
		}
		let acquired = false;
		let reusable = true;
		let failed = false;
		let failure: unknown;
		let result: { value: T } | undefined;
		try {
			let rows: (RowDataPacket & { acquired: number | null })[];
			try {
				[rows] = await connection.execute<
					(RowDataPacket & { acquired: number | null })[]
				>("SELECT GET_LOCK(?, 0) AS acquired", [lockName]);
			} catch {
				reusable = false;
				throw new Error("Appointment cancellation lock is unavailable");
			}
			if (rows[0]?.acquired === 0) {
				throw new AppointmentCancellationBusyError();
			}
			if (rows[0]?.acquired !== 1) {
				reusable = false;
				throw new Error("Appointment cancellation lock is unavailable");
			}
			acquired = true;
			result = {
				value: await inOwnedLockScope(state.context, lockName, operation),
			};
		} catch (error) {
			failed = true;
			failure = error;
		} finally {
			if (acquired) {
				try {
					const [rows] = await connection.execute<
						(RowDataPacket & { released: number | null })[]
					>("SELECT RELEASE_LOCK(?) AS released", [lockName]);
					if (rows[0]?.released !== 1) reusable = false;
				} catch {
					reusable = false;
				}
			}
			if (reusable) {
				try {
					connection.release();
				} catch {
					reusable = false;
				}
			}
			if (!reusable) {
				try {
					connection.destroy();
				} catch {
					// Never put an uncertain lock owner back into the connection pool.
				}
			}
		}
		if (failed) throw failure;
		if (!reusable) {
			throw new Error("Appointment cancellation lock release failed");
		}
		if (!result) {
			throw new Error("Appointment cancellation lock is unavailable");
		}
		return result.value;
	} finally {
		state.admitted -= 1;
	}
}

export function createInMemoryAppointmentCancellationLock() {
	const context = new AsyncLocalStorage<LockScope>();
	const held = new Set<string>();
	return async function withCancellationLock<T>(
		ownerUserId: string,
		appointmentId: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const key = JSON.stringify([ownerUserId, appointmentId]);
		if (context.getStore()?.get(key)?.active) return operation();
		if (held.has(key)) throw new AppointmentCancellationBusyError();
		held.add(key);
		try {
			return await inOwnedLockScope(context, key, operation);
		} finally {
			held.delete(key);
		}
	};
}
