import { expect, test } from "bun:test";
import type {
	MedicalInsuranceGateway,
	MedicalInsuranceOrder,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
} from "@hospital/persistence";
import { MedicalInsuranceRegistrationService } from "./registration-service";

const now = new Date("2026-09-03T00:00:00.000Z");

function order(): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-service-001",
		ownerUserId: "user-service-001",
		patientId: "patient-service-001",
		appointmentId: "appointment-service-001",
		authorizationId: "authorization-service-001",
		feeUploadId: "fee-service-001",
		idempotencyKey: "medical-service-idempotency",
		medOrgOrd: "medical-service-001",
		chrgBchno: "charge-service-001",
		payOrdId: "pay-service-001",
		payTokenHash: "a".repeat(64),
		mdtrtId: "mdtrt-service-001",
		acctUsedFlag: "1",
		status: "fee_uploaded",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

test("non-terminal 6202 settlement is persisted and enqueued exactly once", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(order());
	const queryTasks = createInMemoryMedicalInsuranceQueryTaskRepository();
	let currentNow = now;
	let settleCalls = 0;
	const medicalInsurance = {
		settle: async () => {
			settleCalls += 1;
			return {
				state: "awaiting_confirmation" as const,
				amounts: {
					totalFen: 100,
					cashFen: 20,
					personalAccountFen: 30,
					fundFen: 50,
				},
				trace: {
					provider: "medical-insurance",
					operation: "medical-insurance.6202",
					requestId: "medical-settle-001",
				},
				source: "6202" as const,
				providerStatus: "1",
				finality: "processing" as const,
				authoritative: false,
			};
		},
	} as unknown as MedicalInsuranceGateway;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		appointments: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance,
		queryTasks,
		now: () => currentNow,
	});
	const input = {
		ownerUserId: "user-service-001",
		orderId: "medical-service-001",
		context: {
			traceId: "medical-settle-trace",
			idempotencyKey: "medical-settle-idempotency",
		},
	};

	expect(await service.settle(input)).toMatchObject({
		orderId: "medical-service-001",
		status: "awaiting_confirmation",
		amounts: { totalFen: 100, insuranceFen: 80, cashFen: 20 },
	});
	expect(settleCalls).toBe(1);

	const [claimed] = await queryTasks.claimDueForQuery(now, 1, 60_000);
	expect(claimed).toMatchObject({
		taskId: "medical-service-001",
		medicalOrderId: "medical-service-001",
		status: "in_progress",
		attempts: 0,
	});

	// A repeated settle command must not call 6202 again after the result is
	// waiting for 6301 evidence. A new enqueue timestamp must also keep the
	// existing task authoritative instead of changing its retry schedule.
	currentNow = new Date("2026-09-03T00:01:00.000Z");
	expect(await service.settle(input)).toMatchObject({
		status: "awaiting_confirmation",
	});
	expect(settleCalls).toBe(1);
});
