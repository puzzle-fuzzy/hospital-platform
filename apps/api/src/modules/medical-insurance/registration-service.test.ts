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
		patients: {} as never,
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

test("medical authorization resolves the directory reference instead of the HIS patient id", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const appointments = {
		findRegistration: async () => ({
			appointmentId: "appointment-auth-001",
			ownerUserId: "user-auth-001",
			patientId: "patient-auth-001",
			holdId: "hold-auth-001",
			idempotencyKey: "appointment-auth-idempotency",
			// 预约记录保存的是 patInfosFind.data.patId。
			providerPatientId: "his-patient-001",
			providerAppointmentId: "provider-appointment-001",
			departmentName: "内科风湿",
			doctorName: "测试医生",
			workDate: "2026-09-07",
			shiftName: "上午",
			sourceSerialNumber: "1",
			totalFen: 1000,
			status: "booked" as const,
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		}),
	} as never;
	const patients = {
		resolveProviderReference: async (input: {
			referenceKind?: "directory" | "his-patient";
		}) => {
			expect(input.referenceKind).toBe("directory");
			return {
				patientId: "patient-auth-001",
				provider: "zhongyang" as const,
				providerPatientId: "directory-patient-001",
			};
		},
	} as never;
	const identityUsers = {
		findByUserId: async () => ({
			userId: "user-auth-001",
			providerSubject: "openid-auth-001",
			unionId: "union-auth-001",
		}),
	} as never;
	let profileInput: { unionId: string; providerPatientId: string } | undefined;
	const patientProfile = {
		resolve: async (input: { unionId: string; providerPatientId: string }) => {
			profileInput = input;
			return {
				patient: {
					providerPatientId: "his-patient-001",
					name: "张三",
					cardNo: "1234567890",
					idNo: "110101199001011234",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-patient-profile",
					requestId: "profile-auth-001",
				},
			};
		},
	} as never;
	const medicalInsurance = {
		authorize: async (input: { patientId: string }) => {
			expect(input.patientId).toBe("his-patient-001");
			return {
				authorizationId: "authorization-auth-001",
				trace: {
					provider: "medical-insurance" as const,
					operation: "medical-insurance.authorize",
					requestId: "authorize-auth-001",
				},
			};
		},
	} as never;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		appointments,
		patients,
		identityUsers,
		patientProfile,
		medicalInsurance,
		now: () => now,
	});

	expect(
		await service.authorize({
			ownerUserId: "user-auth-001",
			appointmentId: "appointment-auth-001",
			authCode: "auth-code-001",
			context: {
				traceId: "medical-auth-trace-001",
				idempotencyKey: "medical-auth-idempotency-001",
			},
		}),
	).toEqual({
		orderId: expect.any(String),
		status: "authorized",
	});
	expect(profileInput).toEqual({
		unionId: "union-auth-001",
		providerPatientId: "directory-patient-001",
	});
});
