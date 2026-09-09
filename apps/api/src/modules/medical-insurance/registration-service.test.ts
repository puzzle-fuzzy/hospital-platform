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

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
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
		...overrides,
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

test("关系为空时按所选就诊人生成 familyid 并继续医保授权", async () => {
	const service = new MedicalInsuranceRegistrationService({
		orders: createInMemoryMedicalInsuranceOrderRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-unknown-001",
				ownerUserId: "user-unknown-001",
				patientId: "patient-unknown-001",
				status: "booked",
			}),
		} as never,
		patients: {
			listByOwner: async () => [
				{
					id: "patient-unknown-001",
					ownerUserId: "user-unknown-001",
					relationship: "unknown",
				},
			],
			resolveProviderReference: async () => ({
				patientId: "patient-unknown-001",
				provider: "zhongyang",
				providerPatientId: "directory-unknown-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: "user-unknown-001",
				providerSubject: "openid-unknown-001",
				unionId: "union-unknown-001",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId: "his-unknown-001",
					name: "选中儿童",
					cardNo: "CARD-UNKNOWN-001",
					idNo: "140581201501010011",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang",
					operation: "appointment-patient-profile",
					requestId: "profile-unknown-001",
				},
			}),
		} as never,
		medicalInsurance: {} as never,
		now: () => now,
	});

	await expect(
		service.authorizationContext({
			ownerUserId: "user-unknown-001",
			appointmentId: "appointment-unknown-001",
			context: {
				traceId: "authorization-context-unknown-001",
				idempotencyKey: "authorization-context-unknown-001",
			},
		}),
	).resolves.toEqual({
		payForRelatives: true,
		familyId: "62725109a76555072ba458cf4e122aa4",
	});
});

test("医保授权后尚未产生 6201 支付流水时可以直接作废订单", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-cancel-before-fees",
			status: "created",
			feeUploadId: null,
			payOrdId: null,
		}),
	);
	const service = new MedicalInsuranceRegistrationService({
		orders,
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {} as never,
	});

	await expect(
		service.cancel({
			ownerUserId: "user-service-001",
			orderId: "medical-cancel-before-fees",
			reason: "payment_in_progress",
			context: {
				traceId: "medical-cancel-before-fees-trace",
				idempotencyKey: "medical-cancel-before-fees-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-cancel-before-fees",
		status: "cancelled",
	});
	await expect(
		orders.findByMedicalOrderId("medical-cancel-before-fees"),
	).resolves.toMatchObject({ status: "cancelled" });
});

test("重新展码使用新授权并在安全关闭旧单后重新执行 6201 和 6202", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-reauth-old",
			patientId: "patient-reauth-001",
			appointmentId: "appointment-reauth-001",
			businessType: "registration",
			businessId: "appointment-reauth-001",
			authorizationId: "authorization-reauth-old",
			feeUploadId: "fee-reauth-old",
			payOrdId: "pay-reauth-old",
			status: "fee_uploaded",
		}),
	);
	const calls: string[] = [];
	const ids = ["medical-reauth-new", "charge-reauth-new"];
	const service = new MedicalInsuranceRegistrationService({
		orders,
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-reauth-001",
				ownerUserId: "user-service-001",
				patientId: "patient-reauth-001",
				providerPatientId: "his-patient-reauth-001",
				providerAppointmentId: "provider-appointment-reauth-001",
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-03",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			}),
		} as never,
		patients: {
			resolveProviderReference: async () => ({
				patientId: "patient-reauth-001",
				provider: "zhongyang",
				providerPatientId: "directory-patient-reauth-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: "user-service-001",
				providerSubject: "openid-reauth-001",
				unionId: "unionid-reauth-001",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId: "his-patient-reauth-001",
					name: "重新授权测试人",
					cardNo: "card-reauth-001",
					idNo: "140581199001010011",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang",
					operation: "appointment-patient-profile",
					requestId: "profile-reauth-001",
				},
			}),
		} as never,
		medicalInsurance: {
			cancel: async (input: { orderId: string; reason: string }) => {
				calls.push(`cancel:${input.reason}:${input.orderId}`);
				return {
					state: "cancelled" as const,
					paymentState: "closed" as const,
					settlementState: "cancelled" as const,
					providerStatus: "closed_for_reauthorization",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.cancellation",
						requestId: "cancel-reauth-old",
					},
				};
			},
			authorize: async (input: { authCode: string; orderId: string }) => {
				calls.push(`authorize:${input.authCode}:${input.orderId}`);
				return {
					authorizationId: "authorization-reauth-new",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.authorize",
						requestId: "authorize-reauth-new",
					},
				};
			},
			uploadFees: async (input: { orderId: string }) => {
				calls.push(`6201:${input.orderId}`);
				return {
					feeUploadId: "fee-reauth-new",
					payOrdId: "pay-reauth-new",
					payTokenHash: "b".repeat(64),
					mdtrtId: "mdtrt-reauth-new",
					acctUsedFlag: "0",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.6201",
						requestId: "6201-reauth-new",
					},
				};
			},
			settle: async (input: { orderId: string }) => {
				calls.push(`6202:${input.orderId}`);
				return {
					state: "insurance_settled" as const,
					amounts: {
						totalFen: 1000,
						cashFen: 0,
						personalAccountFen: 0,
						fundFen: 1000,
					},
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.6202",
						requestId: "6202-reauth-new",
					},
					source: "6202" as const,
					providerStatus: "6",
					finality: "succeeded" as const,
					authoritative: true,
				};
			},
		} as unknown as MedicalInsuranceGateway,
		now: () => now,
		createId: () => ids.shift() ?? "unexpected-id",
	});

	await expect(
		service.authorize({
			ownerUserId: "user-service-001",
			appointmentId: "appointment-reauth-001",
			authCode: "fresh-auth-code",
			context: {
				traceId: "medical-reauth-trace",
				idempotencyKey: "medical-reauth-new-idempotency",
			},
		}),
	).resolves.toEqual({ orderId: "medical-reauth-new", status: "authorized" });
	expect(calls).toEqual([
		"cancel:reauthorization:medical-reauth-old",
		"authorize:fresh-auth-code:medical-reauth-new",
	]);
	await expect(
		service.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-reauth-new",
			context: {
				traceId: "medical-reauth-6201-trace",
				idempotencyKey: "medical-reauth-6201-idempotency",
			},
		}),
	).resolves.toMatchObject({ status: "fee_uploaded" });
	await expect(
		service.settle({
			ownerUserId: "user-service-001",
			orderId: "medical-reauth-new",
			context: {
				traceId: "medical-reauth-6202-trace",
				idempotencyKey: "medical-reauth-6202-idempotency",
			},
		}),
	).resolves.toMatchObject({ status: "insurance_settled" });
	expect(calls).toEqual([
		"cancel:reauthorization:medical-reauth-old",
		"authorize:fresh-auth-code:medical-reauth-new",
		"6201:medical-reauth-new",
		"6202:medical-reauth-new",
	]);
	await expect(
		orders.findByMedicalOrderId("medical-reauth-old"),
	).resolves.toMatchObject({ status: "cancelled" });
	await expect(
		orders.findByMedicalOrderId("medical-reauth-new"),
	).resolves.toMatchObject({
		authorizationId: "authorization-reauth-new",
		feeUploadId: "fee-reauth-new",
		payOrdId: "pay-reauth-new",
		status: "insurance_settled",
	});
});
