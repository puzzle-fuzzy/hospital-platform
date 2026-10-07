import { expect, test } from "bun:test";
import type {
	MedicalInsuranceGateway,
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import {
	PaymentNotificationConflictError,
	PaymentPrepayAttemptInProgressError,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceCredentialRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
} from "@hospital/persistence";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationService,
} from "./registration-service";

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

function settlementContext(
	overrides: Partial<MedicalInsuranceSettlementContext> = {},
): MedicalInsuranceSettlementContext {
	return {
		businessId: "appointment-service-001",
		businessCode: "registration-service-001",
		hospitalId: "10389001",
		patientId: "provider-patient-service-001",
		chrgBchno: "charge-service-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		insuredAreaCode: "140581",
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
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
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

test("业务恢复只使用唯一服务端订单并从持久化授权修复订单引用", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-business-recovery-001",
			patientId: "patient-business-recovery-001",
			appointmentId: "appointment-business-recovery-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-business-recovery-001",
			authorizationId: null,
			feeUploadId: null,
			payOrdId: null,
			status: "created",
		}),
	);
	await authorizations.put({
		authorizationId: "authorization-business-recovery-001",
		ownerUserId: "user-service-001",
		medicalOrderId: "medical-business-recovery-001",
		providerSubject: "openid-business-recovery-001",
		payAuthNo: "pay-auth-business-recovery-001",
		patient: {
			idNo: "140581199001010011",
			userName: "业务恢复测试人",
			idType: "01",
		},
		psnNo: "psn-business-recovery-001",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "140581",
		expiresAt: "2026-09-03T00:15:00.000Z",
		createdAt: now.toISOString(),
	});
	let providerCalls = 0;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations,
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			authorize: async () => {
				providerCalls += 1;
				throw new Error("business recovery must not replay authorization");
			},
		} as never,
		now: () => now,
	});

	await expect(
		service.recoverBusinessOrder({
			ownerUserId: "user-service-001",
			businessType: "registration",
			businessId: "appointment-business-recovery-001",
			patientId: "patient-business-recovery-001",
			context: {
				traceId: "business-recovery-trace-001",
				idempotencyKey: "business-recovery-idempotency-001",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-business-recovery-001",
		status: "created",
		authorizationReady: true,
		recoveryAllowed: true,
	});
	expect(providerCalls).toBe(0);
	await expect(
		orders.findByMedicalOrderId("medical-business-recovery-001"),
	).resolves.toMatchObject({
		authorizationId: "authorization-business-recovery-001",
	});
});

test("业务恢复遇到多笔活动订单时拒绝客户端挑单", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	for (const suffix of ["a", "b"]) {
		await orders.insert(
			order({
				medicalOrderId: `medical-ambiguous-${suffix}`,
				patientId: "patient-ambiguous-001",
				appointmentId: "appointment-ambiguous-001",
				businessType: "registration",
				orderType: "RegPay",
				businessId: "appointment-ambiguous-001",
				authorizationId: null,
				feeUploadId: null,
				payOrdId: null,
				idempotencyKey: `medical-ambiguous-idempotency-${suffix}`,
				medOrgOrd: `medical-ambiguous-${suffix}`,
				chrgBchno: `charge-ambiguous-${suffix}`,
				status: "created",
			}),
		);
	}
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {} as never,
		now: () => now,
	});

	await expect(
		service.recoverBusinessOrder({
			ownerUserId: "user-service-001",
			businessType: "registration",
			businessId: "appointment-ambiguous-001",
			patientId: "patient-ambiguous-001",
			context: {
				traceId: "business-recovery-ambiguous-trace",
				idempotencyKey: "business-recovery-ambiguous-idempotency",
			},
		}),
	).rejects.toBeInstanceOf(PaymentNotificationConflictError);
	await expect(
		service.recoverBusinessOrder({
			ownerUserId: "user-service-001",
			businessType: "registration",
			businessId: "appointment-missing-001",
			patientId: "patient-ambiguous-001",
			context: {
				traceId: "business-recovery-missing-trace",
				idempotencyKey: "business-recovery-missing-idempotency",
			},
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceOrderNotFoundError);

	const authorizationService = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-ambiguous-001",
				ownerUserId: "user-service-001",
				patientId: "patient-ambiguous-001",
				providerPatientId: "provider-patient-ambiguous-001",
				providerAppointmentId: "provider-appointment-ambiguous-001",
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
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			authorize: async () => {
				throw new Error("ambiguous order must not reach Provider");
			},
		} as never,
		now: () => now,
	});
	await expect(
		authorizationService.authorize({
			ownerUserId: "user-service-001",
			appointmentId: "appointment-ambiguous-001",
			authCode: "auth-code-ambiguous-001",
			context: {
				traceId: "authorization-ambiguous-trace",
				idempotencyKey: "authorization-ambiguous-idempotency",
			},
		}),
	).rejects.toBeInstanceOf(PaymentNotificationConflictError);
});

test("授权结果短暂未知时按钮只查服务端且新请求不重复调用 Provider", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-authorization-pending-001",
			patientId: "patient-authorization-pending-001",
			appointmentId: "appointment-authorization-pending-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-authorization-pending-001",
			authorizationId: null,
			feeUploadId: null,
			payOrdId: null,
			idempotencyKey: "authorization-pending-original-idempotency",
			status: "created",
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		}),
	);
	let providerCalls = 0;
	const dependencies = {
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-authorization-pending-001",
				ownerUserId: "user-service-001",
				patientId: "patient-authorization-pending-001",
				status: "booked",
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
			}),
		} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			authorize: async () => {
				providerCalls += 1;
				throw new Error("authorization pending must not replay Provider");
			},
		} as never,
	};
	const activeService = new MedicalInsuranceRegistrationService({
		...dependencies,
		now: () => now,
	});
	const recoveryInput = {
		ownerUserId: "user-service-001",
		businessType: "registration" as const,
		businessId: "appointment-authorization-pending-001",
		patientId: "patient-authorization-pending-001",
		context: {
			traceId: "authorization-pending-recovery-trace",
			idempotencyKey: "authorization-pending-recovery-idempotency",
		},
	};

	await expect(
		activeService.recoverBusinessOrder(recoveryInput),
	).resolves.toMatchObject({
		authorizationReady: false,
		authorizationPending: true,
		recoveryAllowed: true,
	});
	await expect(
		activeService.authorize({
			ownerUserId: "user-service-001",
			appointmentId: "appointment-authorization-pending-001",
			authCode: "authorization-pending-new-code",
			context: {
				traceId: "authorization-pending-new-trace",
				idempotencyKey: "authorization-pending-new-idempotency",
			},
		}),
	).rejects.toBeInstanceOf(PaymentPrepayAttemptInProgressError);
	expect(providerCalls).toBe(0);

	const staleService = new MedicalInsuranceRegistrationService({
		...dependencies,
		now: () => new Date("2026-09-03T00:03:00.000Z"),
	});
	await expect(
		staleService.recoverBusinessOrder(recoveryInput),
	).resolves.toMatchObject({
		authorizationReady: false,
		authorizationPending: false,
		recoveryAllowed: true,
	});
});

test("授权确认窗口结束后同一订单仍由服务端 CAS 阻止并发重放", async () => {
	const currentNow = new Date();
	const staleAt = new Date(currentNow.getTime() - 3 * 60_000).toISOString();
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-authorization-cas-001",
			patientId: "patient-authorization-cas-001",
			appointmentId: "appointment-authorization-cas-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-authorization-cas-001",
			authorizationId: null,
			feeUploadId: null,
			payOrdId: null,
			idempotencyKey: "authorization-cas-original-idempotency",
			status: "created",
			createdAt: staleAt,
			updatedAt: staleAt,
		}),
	);
	let providerCalls = 0;
	let notifyProviderEntered: (() => void) | undefined;
	let releaseProvider: (() => void) | undefined;
	const providerEntered = new Promise<void>((resolve) => {
		notifyProviderEntered = resolve;
	});
	const providerRelease = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations,
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-authorization-cas-001",
				ownerUserId: "user-service-001",
				patientId: "patient-authorization-cas-001",
				providerPatientId: "his-patient-authorization-cas-001",
				providerAppointmentId: "provider-appointment-authorization-cas-001",
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-03",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: currentNow.toISOString(),
				updatedAt: currentNow.toISOString(),
			}),
		} as never,
		patients: {
			resolveProviderReference: async () => ({
				patientId: "patient-authorization-cas-001",
				provider: "zhongyang",
				providerPatientId: "directory-patient-authorization-cas-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: "user-service-001",
				providerSubject: "openid-authorization-cas-001",
				unionId: "unionid-authorization-cas-001",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId: "his-patient-authorization-cas-001",
					name: "授权并发测试人",
					cardNo: "card-authorization-cas-001",
					idNo: "140581199001010011",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang",
					operation: "appointment-patient-profile",
					requestId: "profile-authorization-cas-001",
				},
			}),
		} as never,
		medicalInsurance: {
			authorize: async (input: {
				ownerUserId: string;
				orderId: string;
				providerSubject: string;
			}) => {
				providerCalls += 1;
				notifyProviderEntered?.();
				await providerRelease;
				await authorizations.put({
					authorizationId: "authorization-cas-001",
					ownerUserId: input.ownerUserId,
					medicalOrderId: input.orderId,
					providerSubject: input.providerSubject,
					payAuthNo: "pay-auth-authorization-cas-001",
					patient: {
						idNo: "140581199001010011",
						userName: "授权并发测试人",
						idType: "01",
					},
					psnNo: "psn-authorization-cas-001",
					insutype: "310",
					insuplcAdmdvs: "140581",
					insuCode: "140581",
					expiresAt: new Date(currentNow.getTime() + 15 * 60_000).toISOString(),
					createdAt: currentNow.toISOString(),
				});
				return {
					authorizationId: "authorization-cas-001",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.authorize",
						requestId: "authorize-cas-001",
					},
				};
			},
		} as never,
		now: () => currentNow,
	});
	const authorize = (suffix: string) =>
		service.authorize({
			ownerUserId: "user-service-001",
			appointmentId: "appointment-authorization-cas-001",
			authCode: `authorization-cas-code-${suffix}`,
			context: {
				traceId: `authorization-cas-trace-${suffix}`,
				idempotencyKey: `authorization-cas-idempotency-${suffix}`,
			},
		});

	const first = authorize("first");
	let firstError: unknown;
	void first.catch((error) => {
		firstError = error;
		notifyProviderEntered?.();
	});
	await providerEntered;
	if (firstError) throw firstError;
	await expect(authorize("second")).rejects.toBeInstanceOf(
		PaymentPrepayAttemptInProgressError,
	);
	expect(providerCalls).toBe(1);
	releaseProvider?.();
	await expect(first).resolves.toEqual({
		orderId: "medical-authorization-cas-001",
		status: "authorized",
	});
	expect(providerCalls).toBe(1);
});

test("6201 回包已持久化时从加密凭证恢复订单且不重放 Provider", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const credentials = createInMemoryMedicalInsuranceCredentialRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-fee-recovery-001",
			patientId: "patient-fee-recovery-001",
			appointmentId: "appointment-fee-recovery-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-fee-recovery-001",
			feeUploadId: null,
			payOrdId: null,
			payTokenHash: null,
			mdtrtId: null,
			acctUsedFlag: null,
			status: "fee_upload_pending",
		}),
	);
	await orders.saveSettlementContext(
		"user-service-001",
		"medical-fee-recovery-001",
		settlementContext({
			businessId: "appointment-fee-recovery-001",
			feeUploadStage: "fee_uploaded",
			feeUploadSubmittedAt: now.toISOString(),
			mdtrtId: "mdtrt-fee-recovery-001",
			acctUsedFlag: "1",
		}),
	);
	const credentialBase = {
		ownerUserId: "user-service-001",
		medicalOrderId: "medical-fee-recovery-001",
		payOrdId: "pay-fee-recovery-001",
		payToken: "pay-token-fee-recovery-001",
		providerQueryIdentity: {
			orgCodg: "HOSPITAL-001",
			idNo: "140581199001010011",
			userName: "费用恢复测试人",
			idType: "01",
		},
		expiresAt: "2026-09-03T00:15:00.000Z",
		createdAt: now.toISOString(),
	};
	await credentials.put({
		...credentialBase,
		credentialId: "credential-fee-recovery-settlement",
		purpose: "settlement",
	});
	await credentials.put({
		...credentialBase,
		credentialId: "credential-fee-recovery-query",
		purpose: "query",
	});
	let providerCalls = 0;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		credentials,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				providerCalls += 1;
				throw new Error("persisted 6201 must not be replayed");
			},
		} as never,
		now: () => now,
	});

	await expect(
		service.recoverBusinessOrder({
			ownerUserId: "user-service-001",
			businessType: "registration",
			businessId: "appointment-fee-recovery-001",
			patientId: "patient-fee-recovery-001",
			context: {
				traceId: "fee-recovery-trace",
				idempotencyKey: "fee-recovery-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-fee-recovery-001",
		status: "fee_uploaded",
		recoveryAllowed: true,
	});
	expect(providerCalls).toBe(0);
	await expect(
		orders.findByMedicalOrderId("medical-fee-recovery-001"),
	).resolves.toMatchObject({
		status: "fee_uploaded",
		feeUploadId: "credential-fee-recovery-settlement",
		payOrdId: "pay-fee-recovery-001",
		mdtrtId: "mdtrt-fee-recovery-001",
		acctUsedFlag: "1",
	});
});

test("6201 发送门禁在途时只观察，超时缺证据后转人工且都不重放", async () => {
	const activeOrders = createInMemoryMedicalInsuranceOrderRepository();
	await activeOrders.insert(
		order({
			medicalOrderId: "medical-fee-pending-active",
			feeUploadId: null,
			payOrdId: null,
			status: "fee_upload_pending",
			updatedAt: now.toISOString(),
		}),
	);
	let activeProviderCalls = 0;
	const activeService = new MedicalInsuranceRegistrationService({
		orders: activeOrders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				activeProviderCalls += 1;
				throw new Error("in-flight 6201 must not be replayed");
			},
		} as never,
		now: () => now,
	});
	await expect(
		activeService.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-fee-pending-active",
			context: {
				traceId: "fee-pending-active-trace",
				idempotencyKey: "fee-pending-active-idempotency",
			},
		}),
	).resolves.toMatchObject({ status: "fee_upload_pending" });
	expect(activeProviderCalls).toBe(0);

	const staleOrders = createInMemoryMedicalInsuranceOrderRepository();
	await staleOrders.insert(
		order({
			medicalOrderId: "medical-fee-pending-stale",
			feeUploadId: null,
			payOrdId: null,
			status: "fee_upload_pending",
			updatedAt: now.toISOString(),
		}),
	);
	let staleProviderCalls = 0;
	const staleService = new MedicalInsuranceRegistrationService({
		orders: staleOrders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				staleProviderCalls += 1;
				throw new Error("stale unknown 6201 must not be replayed");
			},
		} as never,
		now: () => new Date("2026-09-03T00:03:00.000Z"),
	});
	await expect(
		staleService.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-fee-pending-stale",
			context: {
				traceId: "fee-pending-stale-trace",
				idempotencyKey: "fee-pending-stale-idempotency",
			},
		}),
	).resolves.toMatchObject({ status: "manual_review" });
	expect(staleProviderCalls).toBe(0);

	const preparedOrders = createInMemoryMedicalInsuranceOrderRepository();
	await preparedOrders.insert(
		order({
			medicalOrderId: "medical-fee-prepared-stale",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-fee-prepared-stale",
			appointmentId: "appointment-fee-prepared-stale",
			feeUploadId: null,
			payOrdId: null,
			status: "fee_upload_pending",
			updatedAt: now.toISOString(),
		}),
	);
	await preparedOrders.saveSettlementContext(
		"user-service-001",
		"medical-fee-prepared-stale",
		settlementContext({
			businessId: "appointment-fee-prepared-stale",
			feeUploadStage: "pre_6201",
		}),
	);
	let preparedProviderCalls = 0;
	const preparedService = new MedicalInsuranceRegistrationService({
		orders: preparedOrders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				preparedProviderCalls += 1;
				throw new Error("stale pre-6201 must not be resumed without fencing");
			},
		} as never,
		now: () => new Date("2026-09-03T00:03:00.000Z"),
	});
	await expect(
		preparedService.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-fee-prepared-stale",
			context: {
				traceId: "fee-prepared-stale-trace",
				idempotencyKey: "fee-prepared-stale-idempotency",
			},
		}),
	).resolves.toMatchObject({ status: "manual_review" });
	expect(preparedProviderCalls).toBe(0);
});

test("并发 6201 请求只有 CAS 胜者可以调用 Provider", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-fee-concurrent-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-service-001",
			feeUploadId: null,
			payOrdId: null,
			payTokenHash: null,
			mdtrtId: null,
			acctUsedFlag: null,
			status: "created",
		}),
	);
	let providerCalls = 0;
	let releaseProvider!: () => void;
	let markProviderStarted!: () => void;
	const providerStarted = new Promise<void>((resolve) => {
		markProviderStarted = resolve;
	});
	const providerRelease = new Promise<void>((resolve) => {
		releaseProvider = resolve;
	});
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-service-001",
				ownerUserId: "user-service-001",
				patientId: "patient-service-001",
				providerPatientId: "provider-patient-service-001",
				providerAppointmentId: "provider-appointment-service-001",
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-03",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}),
		} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				providerCalls += 1;
				markProviderStarted();
				await providerRelease;
				return {
					feeUploadId: "fee-concurrent-001",
					payOrdId: "pay-concurrent-001",
					payTokenHash: "c".repeat(64),
					mdtrtId: "mdtrt-concurrent-001",
					acctUsedFlag: "1",
					trace: {
						provider: "medical-insurance",
						operation: "medical-insurance.6201",
						requestId: "6201-concurrent-001",
					},
				};
			},
		} as never,
		now: () => new Date(),
	});
	const input = {
		ownerUserId: "user-service-001",
		orderId: "medical-fee-concurrent-001",
		context: {
			traceId: "fee-concurrent-trace",
			idempotencyKey: "fee-concurrent-idempotency",
		},
	};
	const winner = service.uploadFees(input);
	await providerStarted;
	await expect(service.uploadFees(input)).resolves.toMatchObject({
		status: "fee_upload_pending",
	});
	expect(providerCalls).toBe(1);
	releaseProvider();
	await expect(winner).resolves.toMatchObject({ status: "fee_uploaded" });
	expect(providerCalls).toBe(1);
});

test("6201 回包落库被并发恢复抢先推进时原请求返回同一订单事实", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-fee-persist-race-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-fee-persist-race-001",
			appointmentId: "appointment-fee-persist-race-001",
			feeUploadId: null,
			payOrdId: null,
			payTokenHash: null,
			mdtrtId: null,
			acctUsedFlag: null,
			status: "created",
		}),
	);
	const result = {
		feeUploadId: "fee-persist-race-001",
		payOrdId: "pay-persist-race-001",
		payTokenHash: "d".repeat(64),
		mdtrtId: "mdtrt-persist-race-001",
		acctUsedFlag: "1",
		trace: {
			provider: "medical-insurance" as const,
			operation: "medical-insurance.6201",
			requestId: "6201-persist-race-001",
		},
	};
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-fee-persist-race-001",
				ownerUserId: "user-service-001",
				patientId: "patient-service-001",
				providerPatientId: "provider-patient-persist-race-001",
				providerAppointmentId: "provider-appointment-persist-race-001",
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
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				const claimed = await orders.findByMedicalOrderId(
					"medical-fee-persist-race-001",
				);
				expect(claimed?.status).toBe("fee_upload_pending");
				const recovered = await orders.applySettlement(
					"medical-fee-persist-race-001",
					claimed?.version ?? -1,
					{
						status: "fee_uploaded",
						ordStas: null,
						amounts: null,
						setlType: null,
						revsTokenHash: null,
						revsTokenExpiresAt: null,
						businessType: "registration",
						orderType: "RegPay",
						businessId: "appointment-fee-persist-race-001",
						appointmentId: "appointment-fee-persist-race-001",
						feeUploadId: result.feeUploadId,
						payOrdId: result.payOrdId,
						payTokenHash: result.payTokenHash,
						mdtrtId: result.mdtrtId,
						acctUsedFlag: result.acctUsedFlag,
					},
				);
				expect(recovered?.status).toBe("fee_uploaded");
				return result;
			},
		} as never,
		now: () => now,
	});

	await expect(
		service.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-fee-persist-race-001",
			context: {
				traceId: "fee-persist-race-trace",
				idempotencyKey: "fee-persist-race-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-fee-persist-race-001",
		status: "fee_uploaded",
	});
});

test("medical authorization resolves the directory reference instead of the HIS patient id", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
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
		authorize: async (input: {
			patientId: string;
			ownerUserId: string;
			orderId: string;
			providerSubject: string;
		}) => {
			expect(input.patientId).toBe("his-patient-001");
			await authorizations.put({
				authorizationId: "authorization-auth-001",
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				providerSubject: input.providerSubject,
				payAuthNo: "pay-auth-001",
				patient: {
					idNo: "110101199001011234",
					userName: "张三",
					idType: "01",
				},
				psnNo: "psn-001",
				insutype: "310",
				insuplcAdmdvs: "140500",
				insuCode: "140500",
				expiresAt: "2026-09-03T00:15:00.000Z",
				createdAt: now.toISOString(),
			});
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
		authorizations,
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

test("关系为空的就诊人按临时验收规则视为本人", async () => {
	const service = new MedicalInsuranceRegistrationService({
		orders: createInMemoryMedicalInsuranceOrderRepository(),
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-unknown-relation-001",
				ownerUserId: "user-unknown-relation-001",
				patientId: "patient-unknown-relation-001",
				status: "booked",
				createdAt: now.toISOString(),
			}),
		} as never,
		patients: {
			listByOwner: async () => [
				{
					id: "patient-unknown-relation-001",
					ownerUserId: "user-unknown-relation-001",
					displayName: "关系字段为空的就诊人",
					relationship: "unknown",
					cardNumberMasked: "******0011",
					source: "hospital-his",
					clinicalAccess: "unavailable",
				},
			],
		} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {} as never,
		now: () => now,
	});

	await expect(
		service.authorizationContext({
			ownerUserId: "user-unknown-relation-001",
			appointmentId: "appointment-unknown-relation-001",
			context: {
				traceId: "authorization-context-unknown-relation-001",
				idempotencyKey: "authorization-context-unknown-relation-001",
			},
		}),
	).resolves.toEqual({ payForRelatives: false });
});

test("亲属授权上下文按预约选中就诊人生成 familyId 并先验证本人付款档案", async () => {
	const profileInputs: string[] = [];
	const service = new MedicalInsuranceRegistrationService({
		orders: createInMemoryMedicalInsuranceOrderRepository(),
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-relative-001",
				ownerUserId: "user-relative-001",
				patientId: "patient-child-001",
				status: "booked",
				createdAt: now.toISOString(),
			}),
		} as never,
		patients: {
			listByOwner: async () => [
				{
					id: "patient-self-001",
					ownerUserId: "user-relative-001",
					displayName: "当前微信本人",
					relationship: "self",
					cardNumberMasked: "******0022",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
				{
					id: "patient-child-001",
					ownerUserId: "user-relative-001",
					displayName: "选中儿童",
					relationship: "child",
					cardNumberMasked: "******0011",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
			],
			resolveProviderReference: async (input: { patientId: string }) => ({
				patientId: input.patientId,
				provider: "zhongyang",
				providerPatientId:
					input.patientId === "patient-self-001"
						? "provider-self-001"
						: "provider-child-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: "user-relative-001",
				providerSubject: "openid-relative-001",
				unionId: "union-relative-001",
			}),
		} as never,
		patientProfile: {
			resolve: async (input: { providerPatientId: string }) => {
				profileInputs.push(input.providerPatientId);
				const selected = input.providerPatientId === "provider-child-001";
				return {
					patient: {
						providerPatientId: input.providerPatientId,
						name: selected ? "选中儿童" : "当前微信本人",
						cardNo: selected ? "CARD-CHILD" : "CARD-SELF",
						idNo: selected ? "140581201501010011" : "140581198001010022",
						phone: "13800000000",
					},
					trace: {
						provider: "zhongyang",
						operation: "appointment-patient-profile",
						requestId: `profile-${input.providerPatientId}`,
					},
				};
			},
		} as never,
		medicalInsurance: {} as never,
		now: () => now,
	});

	await expect(
		service.authorizationContext({
			ownerUserId: "user-relative-001",
			appointmentId: "appointment-relative-001",
			context: {
				traceId: "authorization-context-relative-001",
				idempotencyKey: "authorization-context-relative-001",
			},
		}),
	).resolves.toEqual({
		payForRelatives: true,
		familyId: "62725109a76555072ba458cf4e122aa4",
	});
	expect(profileInputs).toEqual(["provider-child-001", "provider-self-001"]);
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
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
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

test("挂号终态恢复先返回权威状态，不因授权上下文已清理而重跑 6201", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-cancelled-recovery-001",
			businessType: "registration",
			orderType: "RegPay",
			businessId: "appointment-service-001",
			status: "cancelled",
			authorizationId: null,
			feeUploadId: null,
			payOrdId: null,
		}),
	);
	let providerCalls = 0;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {
			findRegistration: async () => {
				throw new Error("terminal order must not reload appointment");
			},
		} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		medicalInsurance: {
			uploadFees: async () => {
				providerCalls += 1;
				throw new Error("terminal order must not replay 6201");
			},
		} as never,
	});

	await expect(
		service.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-cancelled-recovery-001",
			context: {
				traceId: "medical-cancelled-recovery-trace",
				idempotencyKey: "medical-cancelled-recovery-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-cancelled-recovery-001",
		status: "cancelled",
	});
	expect(providerCalls).toBe(0);
});

test("门诊人工复核恢复保留原状态，不因授权上下文已清理而重跑 6201", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(
		order({
			medicalOrderId: "medical-outpatient-review-recovery-001",
			businessType: "outpatient",
			orderType: "DiagPay",
			businessId: "outpatient-review-record-001",
			status: "manual_review",
			authorizationId: null,
			feeUploadId: null,
			payOrdId: null,
		}),
	);
	let providerCalls = 0;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: createInMemoryMedicalInsuranceAuthorizationRepository(),
		appointments: {} as never,
		patients: {} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		outpatientPayments: {
			resolvePaymentContext: async () => {
				throw new Error("manual review must not reload outpatient fees");
			},
		} as never,
		medicalInsurance: {
			uploadFees: async () => {
				providerCalls += 1;
				throw new Error("manual review must not replay 6201");
			},
		} as never,
	});

	await expect(
		service.uploadOutpatientFees({
			ownerUserId: "user-service-001",
			orderId: "medical-outpatient-review-recovery-001",
			context: {
				traceId: "medical-outpatient-review-recovery-trace",
				idempotencyKey: "medical-outpatient-review-recovery-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-outpatient-review-recovery-001",
		status: "manual_review",
	});
	expect(providerCalls).toBe(0);
});

test("新授权幂等键仍复用同一业务活动订单，不创建第二笔医保订单", async () => {
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
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
		authorizations,
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
			authorize: async (input: {
				authCode: string;
				ownerUserId: string;
				orderId: string;
				providerSubject: string;
			}) => {
				calls.push(`authorize:${input.authCode}:${input.orderId}`);
				await authorizations.put({
					authorizationId: "authorization-reauth-new",
					ownerUserId: input.ownerUserId,
					medicalOrderId: input.orderId,
					providerSubject: input.providerSubject,
					payAuthNo: "pay-auth-reauth-new",
					patient: {
						idNo: "140581199001010011",
						userName: "重新授权测试人",
						idType: "01",
					},
					psnNo: "psn-reauth-new",
					insutype: "310",
					insuplcAdmdvs: "140581",
					insuCode: "140581",
					expiresAt: "2026-09-03T00:15:00.000Z",
					createdAt: now.toISOString(),
				});
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

	const authorized = await service.authorize({
		ownerUserId: "user-service-001",
		appointmentId: "appointment-reauth-001",
		authCode: "fresh-auth-code",
		context: {
			traceId: "medical-reauth-trace",
			idempotencyKey: "medical-reauth-new-idempotency",
		},
	});
	expect(authorized).toEqual({
		orderId: "medical-reauth-old",
		status: "authorized",
	});
	expect(calls).toEqual([]);
	await expect(
		service.authorize({
			ownerUserId: "user-service-001",
			appointmentId: "appointment-reauth-001",
			authCode: "must-not-be-consumed-again",
			context: {
				traceId: "medical-reauth-retry-trace",
				idempotencyKey: "medical-reauth-new-idempotency",
			},
		}),
	).resolves.toEqual({
		orderId: "medical-reauth-old",
		status: "authorized",
	});
	expect(calls).toHaveLength(0);
	await expect(
		service.uploadFees({
			ownerUserId: "user-service-001",
			orderId: "medical-reauth-old",
			context: {
				traceId: "medical-reauth-6201-trace",
				idempotencyKey: "medical-reauth-6201-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-reauth-old",
		status: "fee_uploaded",
	});
	await expect(
		service.settle({
			ownerUserId: "user-service-001",
			orderId: "medical-reauth-old",
			context: {
				traceId: "medical-reauth-6202-trace",
				idempotencyKey: "medical-reauth-6202-idempotency",
			},
		}),
	).resolves.toMatchObject({
		orderId: "medical-reauth-old",
		status: "insurance_settled",
	});
	expect(calls).toEqual(["6202:medical-reauth-old"]);
	await expect(
		orders.findByMedicalOrderId("medical-reauth-old"),
	).resolves.toMatchObject({
		status: "insurance_settled",
	});
	await expect(
		orders.findByMedicalOrderId("medical-reauth-new"),
	).resolves.toBeUndefined();
});

test("门诊医保授权复用统一订单核心并从 2.6.33 解析支付事实", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	const ordersWithoutBusinessKeyLookup = {
		...orders,
		findByOwnerAndBusinessKey: async () => {
			throw new Error(
				"outpatient authorization must not inspect previous business orders",
			);
		},
	};
	let contextInput: { recordId: string; providerPatientId: string } | undefined;
	let authorizePatientId = "";
	const service = new MedicalInsuranceRegistrationService({
		orders: ordersWithoutBusinessKeyLookup as never,
		authorizations,
		appointments: {} as never,
		patients: {
			resolveProviderReference: async (input: {
				patientId: string;
				referenceKind?: string;
			}) => {
				return {
					patientId: input.patientId,
					provider: "zhongyang" as const,
					providerPatientId:
						input.referenceKind === "directory"
							? "directory-outpatient-patient-001"
							: "his-outpatient-patient-001",
				};
			},
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: "user-outpatient-001",
				providerSubject: "openid-outpatient-001",
				unionId: "union-outpatient-001",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId: "his-outpatient-patient-001",
					name: "门诊测试人",
					cardNo: "CARD-OUTPATIENT-001",
					idNo: "140581199001010011",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang" as const,
					operation: "appointment-patient-profile",
					requestId: "profile-outpatient-001",
				},
			}),
		} as never,
		outpatientPayments: {
			resolvePaymentContext: async (input: {
				recordId: string;
				providerPatientId: string;
			}) => {
				contextInput = input;
				return {
					recordId: input.recordId,
					providerPatientId: input.providerPatientId,
					outTradeOrderIds: ["out-trade-order-001"],
					totalFen: 1000,
					trace: {
						provider: "zhongyang" as const,
						operation: "outpatient-payment-context",
						requestId: "outpatient-context-001",
					},
				};
			},
		} as never,
		medicalInsurance: {
			authorize: async (input: { patientId: string; orderId: string }) => {
				authorizePatientId = input.patientId;
				await authorizations.put({
					authorizationId: "authorization-outpatient-001",
					ownerUserId: "user-outpatient-001",
					medicalOrderId: input.orderId,
					providerSubject: "openid-outpatient-001",
					payAuthNo: "pay-auth-outpatient-001",
					patient: {
						idNo: "140581199001010011",
						userName: "门诊测试人",
						idType: "01",
					},
					psnNo: "psn-outpatient-001",
					insutype: "310",
					insuplcAdmdvs: "140581",
					insuCode: "140581",
					expiresAt: "2026-09-03T00:15:00.000Z",
					createdAt: now.toISOString(),
				});
				return {
					authorizationId: "authorization-outpatient-001",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.authorize",
						requestId: "authorize-outpatient-001",
					},
				};
			},
		} as never,
		now: () => now,
	});

	const result = await service.authorizeOutpatient({
		ownerUserId: "user-outpatient-001",
		recordId: "outpatient-record-001",
		patientId: "patient-outpatient-001",
		authCode: "auth-code-outpatient-001",
		context: {
			traceId: "medical-outpatient-trace-001",
			idempotencyKey: "medical-outpatient-idempotency-001",
		},
	});

	expect(result).toMatchObject({ status: "authorized" });
	expect(contextInput).toMatchObject({
		recordId: "outpatient-record-001",
		providerPatientId: "his-outpatient-patient-001",
	});
	expect(authorizePatientId).toBe("his-outpatient-patient-001");
	const stored = await orders.findByMedicalOrderId(result.orderId);
	expect(stored).toMatchObject({
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "outpatient-record-001",
		patientId: "patient-outpatient-001",
	});
});

test("门诊医保 6201 上送 2.6.33 的 outTradeOrderIds", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	await authorizations.put({
		authorizationId: "authorization-fees-outpatient-001",
		ownerUserId: "user-fees-outpatient-001",
		medicalOrderId: "medical-fees-outpatient-001",
		providerSubject: "openid-fees-outpatient-001",
		payAuthNo: "pay-auth-fees-outpatient-001",
		patient: {
			idNo: "140581199001010011",
			userName: "门诊费用测试人",
			idType: "01",
		},
		psnNo: "psn-fees-outpatient-001",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "140581",
		expiresAt: "2026-09-03T00:15:00.000Z",
		createdAt: now.toISOString(),
	});
	await orders.insert(
		order({
			medicalOrderId: "medical-fees-outpatient-001",
			ownerUserId: "user-fees-outpatient-001",
			patientId: "patient-fees-outpatient-001",
			businessType: "outpatient",
			orderType: "DiagPay",
			businessId: "outpatient-record-fees-001",
			authorizationId: "authorization-fees-outpatient-001",
			feeUploadId: null,
			payOrdId: null,
			status: "created",
		}),
	);
	let uploaded: unknown;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations,
		appointments: {} as never,
		patients: {
			resolveProviderReference: async () => ({
				patientId: "patient-fees-outpatient-001",
				provider: "zhongyang" as const,
				providerPatientId: "his-fees-outpatient-001",
			}),
		} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		outpatientPayments: {
			resolvePaymentContext: async () => ({
				recordId: "outpatient-record-fees-001",
				providerPatientId: "his-fees-outpatient-001",
				outTradeOrderIds: ["out-trade-fees-001", "out-trade-fees-002"],
				totalFen: 2000,
				trace: {
					provider: "zhongyang" as const,
					operation: "outpatient-payment-context",
					requestId: "outpatient-fees-context-001",
				},
			}),
		} as never,
		medicalInsurance: {
			uploadFees: async (input: { appointment: unknown }) => {
				uploaded = input.appointment;
				return {
					feeUploadId: "fee-upload-outpatient-001",
					payOrdId: "pay-outpatient-001",
					payTokenHash: "b".repeat(64),
					mdtrtId: "mdtrt-outpatient-001",
					acctUsedFlag: "0",
					trace: {
						provider: "medical-insurance" as const,
						operation: "medical-insurance.6201",
						requestId: "6201-outpatient-001",
					},
				};
			},
		} as never,
		now: () => now,
	});

	const result = await service.uploadOutpatientFees({
		ownerUserId: "user-fees-outpatient-001",
		orderId: "medical-fees-outpatient-001",
		context: {
			traceId: "medical-fees-outpatient-trace-001",
			idempotencyKey: "medical-fees-outpatient-idempotency-001",
		},
	});
	expect(result).toMatchObject({
		orderId: "medical-fees-outpatient-001",
		status: "fee_uploaded",
	});
	expect(uploaded).toEqual({
		businessType: "outpatient",
		recordId: "outpatient-record-fees-001",
		providerPatientId: "his-fees-outpatient-001",
		outTradeOrderIds: ["out-trade-fees-001", "out-trade-fees-002"],
		totalFen: 2000,
	});
});
