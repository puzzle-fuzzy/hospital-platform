import {
	AppointmentCancellationBusyError,
	PaymentIdempotencyConflictError,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import {
	createInMemoryAppointmentCancellationLock,
	withMySqlAppointmentCancellationLock,
} from "./appointment-cancellation-lock";

function scopeKey(businessKey: string): string {
	// A distinct prefix isolates payment records from appointment UUID scopes while
	// reusing the tested dedicated-connection, admission and reentrant lock code.
	return `payment-business:${businessKey}`;
}

async function paymentConflict<T>(operation: () => Promise<T>): Promise<T> {
	try {
		return await operation();
	} catch (error) {
		if (error instanceof AppointmentCancellationBusyError)
			throw new PaymentIdempotencyConflictError();
		throw error;
	}
}

export function withMySqlPaymentBusinessOperationLock<T>(
	pool: Pool,
	ownerUserId: string,
	businessKey: string,
	operation: () => Promise<T>,
): Promise<T> {
	return paymentConflict(() =>
		withMySqlAppointmentCancellationLock(
			pool,
			ownerUserId,
			scopeKey(businessKey),
			operation,
		),
	);
}

export function createInMemoryPaymentBusinessOperationLock() {
	const lock = createInMemoryAppointmentCancellationLock();
	return <T>(
		ownerUserId: string,
		businessKey: string,
		operation: () => Promise<T>,
	): Promise<T> =>
		paymentConflict(() => lock(ownerUserId, scopeKey(businessKey), operation));
}
