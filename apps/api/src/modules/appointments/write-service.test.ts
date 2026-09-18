import { expect, test } from "bun:test";
import { createInMemoryAppointmentWriteRepository } from "@hospital/persistence";
import {
	AppointmentCancellationPaymentActiveError,
	AppointmentHoldExpiredError,
	AppointmentWriteInputError,
	AppointmentWriteService,
} from "./write-service";

const ownerUserId = "fixture-user-0001";
const patientId = "patient-001";
const providerPatientId = "8481567861861908740";

function createTestDependencies(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		repository: createInMemoryAppointmentWriteRepository(),
		patients: {
			listByOwner: async () => [
				{
					id: patientId,
					ownerUserId,
					displayName: "测试患者",
					relationship: "self",
					cardNumberMasked: "****001",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
			],
			resolveProviderReference: async () => ({
				patientId,
				provider: "zhongyang",
				providerPatientId,
				referenceKind: "directory",
			}),
		},
		identityUsers: {
			findByUserId: async () => ({ userId: ownerUserId, unionId: "union-001" }),
		},
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId,
					name: "测试患者",
					cardNo: "P000001",
					idNo: "11010519900101007X",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang",
					operation: "patient-profile",
					requestId: "profile-001",
				},
			}),
		},
		snapshots: {
			findActive: async () => ({
				schedule: {
					scheduleId: "schedule-001",
					departmentId: "department-001",
					departmentName: "测试科室",
					doctorId: "doctor-001",
					doctorName: "测试医生",
					workDate: "2026-09-20",
					shiftName: "上午",
					totalSlots: 10,
					availableSlots: 2,
					timeGroup: "point",
				},
				providerScheduleId: "provider-schedule-001",
			}),
		},
		gateway: {
			resolveSource: async () => ({
				providerSourceId: "provider-source-001",
				sourceSerialNumber: "1",
				trace: {
					provider: "zhongyang",
					operation: "appointment-source-resolve",
					requestId: "source-001",
				},
			}),
			getFactRegisterFee: async () => ({
				totalFen: 1000,
				trace: {
					provider: "zhongyang",
					operation: "appointment-fee",
					requestId: "fee-001",
				},
			}),
			listActive: async () => ({
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "records-001",
				},
			}),
			create: async () => ({
				providerAppointmentId: "provider-appointment-001",
				trace: {
					provider: "zhongyang",
					operation: "appointment-create",
					requestId: "create-001",
				},
			}),
			cancel: async () => ({
				trace: {
					provider: "zhongyang",
					operation: "appointment-cancel",
					requestId: "cancel-001",
				},
			}),
		},
		now: () => new Date("2026-09-16T10:00:00.000Z"),
		createId: () => "generated-appointment-001",
		...overrides,
	};
}

test("挂号结算在众阳未返回 registerId 时沿用 hisRegisterId", async () => {
	const providerHisRegisterId = "8842077739088012808";
	const repository = createInMemoryAppointmentWriteRepository(
		[],
		[
			{
				appointmentId: "appointment-001",
				ownerUserId,
				patientId,
				holdId: "hold-001",
				idempotencyKey: "appointment-register-001",
				providerAppointmentId: "8842077739014441351",
				providerPatientId,
				providerHisRegisterId,
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-09",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: "2026-09-07T00:00:00.000Z",
				updatedAt: "2026-09-07T00:00:00.000Z",
			},
		],
	);
	const service = new AppointmentWriteService({
		repository,
		patients: {
			listByOwner: async () => [
				{
					id: patientId,
					ownerUserId,
					displayName: "测试患者",
					relationship: "self",
					cardNumberMasked: "****001",
					source: "hospital-his",
					clinicalAccess: "ready",
				},
			],
			resolveProviderReference: async () => ({
				patientId,
				provider: "zhongyang",
				providerPatientId,
				referenceKind: "directory",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({ userId: ownerUserId, unionId: "union-001" }),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId,
					name: "测试患者",
					cardNo: "P000001",
					idNo: "11010519900101007X",
					phone: "13800000000",
				},
				trace: {
					provider: "zhongyang",
					operation: "patient-profile",
					requestId: "profile-001",
				},
			}),
		},
		gateway: {} as never,
		snapshots: {} as never,
	});

	const context = await service.getProviderPaymentContext(
		ownerUserId,
		"appointment-001",
		{ traceId: "trace-001", idempotencyKey: "self-pay-001" },
	);

	expect(context.providerRegisterId).toBe(providerHisRegisterId);
	expect(context.providerPatientId).toBe(providerPatientId);
});

test("预约占位对同一幂等键复用结果并拒绝参数冲突", async () => {
	let sourceCalls = 0;
	let feeCalls = 0;
	const dependencies = createTestDependencies({
		gateway: {
			...(createTestDependencies().gateway as Record<string, unknown>),
			resolveSource: async () => {
				sourceCalls += 1;
				return {
					providerSourceId: "provider-source-001",
					sourceSerialNumber: "1",
					trace: {
						provider: "zhongyang",
						operation: "appointment-source-resolve",
						requestId: "source-001",
					},
				};
			},
			getFactRegisterFee: async () => {
				feeCalls += 1;
				return {
					totalFen: 1000,
					trace: {
						provider: "zhongyang",
						operation: "appointment-fee",
						requestId: "fee-001",
					},
				};
			},
		},
	});
	const service = new AppointmentWriteService(dependencies as never);
	const first = await service.hold({
		ownerUserId,
		patientId,
		scheduleId: "schedule-001",
		sourceSerialNumber: "1",
		context: { traceId: "trace-001", idempotencyKey: "hold-key-001" },
	});
	const second = await service.hold({
		ownerUserId,
		patientId,
		scheduleId: "schedule-001",
		sourceSerialNumber: "1",
		context: { traceId: "trace-002", idempotencyKey: "hold-key-001" },
	});

	expect(second).toEqual(first);
	expect(sourceCalls).toBe(1);
	expect(feeCalls).toBe(1);
	await expect(
		service.hold({
			ownerUserId,
			patientId,
			scheduleId: "schedule-002",
			sourceSerialNumber: "1",
			context: { traceId: "trace-003", idempotencyKey: "hold-key-001" },
		}),
	).rejects.toBeInstanceOf(AppointmentWriteInputError);
});

test("预约注册保留排班号别和院区到写入结果", async () => {
	let id = 0;
	const defaults = createTestDependencies();
	const service = new AppointmentWriteService({
		...defaults,
		snapshots: {
			findActive: async () => ({
				schedule: {
					scheduleId: "schedule-001",
					departmentId: "department-001",
					departmentName: "测试科室",
					registrationClassName: "专家号",
					hospitalAreaName: "本部院区",
					doctorId: "doctor-001",
					doctorName: "测试医生",
					workDate: "2026-09-20",
					shiftName: "上午",
					totalSlots: 10,
					availableSlots: 2,
					timeGroup: "point" as const,
				},
				providerScheduleId: "provider-schedule-001",
			}),
		},
		createId: () => `generated-appointment-${++id}`,
	} as never);

	const hold = await service.hold({
		ownerUserId,
		patientId,
		scheduleId: "schedule-001",
		sourceSerialNumber: "1",
		context: {
			traceId: "trace-context-001",
			idempotencyKey: "hold-key-context-001",
		},
	});
	const registration = await service.register({
		ownerUserId,
		patientId,
		holdId: hold.holdId,
		context: {
			traceId: "trace-context-002",
			idempotencyKey: "register-key-context-001",
		},
	});

	expect(registration).toMatchObject({
		status: "booked",
		registrationClassName: "专家号",
		hospitalAreaName: "本部院区",
	});
});

test("预约注册在 Provider 已有同日同科室记录时不重复写入", async () => {
	let createCalls = 0;
	const repository = createInMemoryAppointmentWriteRepository([
		{
			holdId: "hold-001",
			ownerUserId,
			patientId,
			scheduleId: "schedule-001",
			providerScheduleId: "provider-schedule-001",
			providerSourceId: "provider-source-001",
			sourceSerialNumber: "1",
			totalFen: 1000,
			status: "held",
			idempotencyKey: "hold-key-001",
			expiresAt: "2026-09-16T10:01:00.000Z",
			createdAt: "2026-09-16T10:00:00.000Z",
			updatedAt: "2026-09-16T10:00:00.000Z",
		},
	]);
	const defaults = createTestDependencies();
	const service = new AppointmentWriteService({
		...defaults,
		repository,
		gateway: {
			...(defaults.gateway as Record<string, unknown>),
			listActive: async () => ({
				records: [
					{
						providerAppointmentId: "provider-existing-001",
						providerPatientId,
						departmentName: "测试科室",
						workDate: "2026-09-20",
						status: "active",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "appointment-records",
					requestId: "records-duplicate-001",
				},
			}),
			create: async () => {
				createCalls += 1;
				return {
					providerAppointmentId: "must-not-be-created",
					trace: {
						provider: "zhongyang",
						operation: "appointment-create",
						requestId: "create-unused-001",
					},
				};
			},
		},
	} as never);

	const result = await service.register({
		ownerUserId,
		patientId,
		holdId: "hold-001",
		context: {
			traceId: "trace-duplicate-001",
			idempotencyKey: "register-key-001",
		},
	});

	expect(result.status).toBe("duplicate");
	expect(result.appointmentId).toBe("generated-appointment-001");
	expect(createCalls).toBe(0);
});

test("预约注册拒绝已过期占位并将占位标记为 expired", async () => {
	const repository = createInMemoryAppointmentWriteRepository([
		{
			holdId: "hold-expired-001",
			ownerUserId,
			patientId,
			scheduleId: "schedule-001",
			providerScheduleId: "provider-schedule-001",
			providerSourceId: "provider-source-001",
			sourceSerialNumber: "1",
			totalFen: 1000,
			status: "held",
			idempotencyKey: "hold-key-expired-001",
			expiresAt: "2026-09-16T09:59:00.000Z",
			createdAt: "2026-09-16T09:58:00.000Z",
			updatedAt: "2026-09-16T09:58:00.000Z",
		},
	]);
	const service = new AppointmentWriteService({
		...createTestDependencies(),
		repository,
	} as never);

	await expect(
		service.register({
			ownerUserId,
			patientId,
			holdId: "hold-expired-001",
			context: {
				traceId: "trace-expired-001",
				idempotencyKey: "register-key-expired-001",
			},
		}),
	).rejects.toBeInstanceOf(AppointmentHoldExpiredError);
	await expect(
		service.register({
			ownerUserId,
			patientId,
			holdId: "hold-expired-001",
			context: {
				traceId: "trace-expired-002",
				idempotencyKey: "register-key-expired-002",
			},
		}),
	).rejects.toBeInstanceOf(AppointmentHoldExpiredError);
});

test("预约存在活动自费支付关联时禁止取消", async () => {
	const repository = createInMemoryAppointmentWriteRepository(
		[],
		[
			{
				appointmentId: "appointment-cancel-001",
				ownerUserId,
				patientId,
				holdId: "hold-001",
				idempotencyKey: "register-key-001",
				providerAppointmentId: "provider-appointment-001",
				providerPatientId,
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-20",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: "2026-09-16T10:00:00.000Z",
				updatedAt: "2026-09-16T10:00:00.000Z",
			},
		],
	);
	let cancelCalls = 0;
	const defaults = createTestDependencies();
	const service = new AppointmentWriteService({
		...defaults,
		repository,
		paymentOrders: {
			findByOwnerAndIdempotencyKey: async () => ({
				state: "awaiting_confirmation",
			}),
		},
		gateway: {
			...(defaults.gateway as Record<string, unknown>),
			cancel: async () => {
				cancelCalls += 1;
				return {
					trace: {
						provider: "zhongyang",
						operation: "cancel",
						requestId: "cancel-unused-001",
					},
				};
			},
		},
	} as never);

	await expect(
		service.cancel({
			ownerUserId,
			appointmentId: "appointment-cancel-001",
			context: {
				traceId: "trace-cancel-001",
				idempotencyKey: "cancel-key-001",
			},
		}),
	).rejects.toBeInstanceOf(AppointmentCancellationPaymentActiveError);
	expect(cancelCalls).toBe(0);
});

test("仅退款编排可在已完成自费订单仍保留时取消预约", async () => {
	const repository = createInMemoryAppointmentWriteRepository(
		[],
		[
			{
				appointmentId: "appointment-cancel-refunded-001",
				ownerUserId,
				patientId,
				holdId: "hold-refunded-001",
				idempotencyKey: "register-key-refunded-001",
				providerAppointmentId: "provider-appointment-refunded-001",
				providerPatientId,
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-20",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: "2026-09-16T10:00:00.000Z",
				updatedAt: "2026-09-16T10:00:00.000Z",
			},
		],
	);
	let cancelCalls = 0;
	const defaults = createTestDependencies();
	const service = new AppointmentWriteService({
		...defaults,
		repository,
		paymentOrders: {
			findByOwnerAndIdempotencyKey: async () => ({ state: "completed" }),
		},
		gateway: {
			...(defaults.gateway as Record<string, unknown>),
			cancel: async () => {
				cancelCalls += 1;
				return {
					trace: {
						provider: "zhongyang",
						operation: "cancel",
						requestId: "cancel-refunded-001",
					},
				};
			},
		},
	} as never);

	await expect(
		service.cancel({
			ownerUserId,
			appointmentId: "appointment-cancel-refunded-001",
			context: {
				traceId: "trace-cancel-refunded-direct",
				idempotencyKey: "cancel-refunded-direct",
			},
		}),
	).rejects.toBeInstanceOf(AppointmentCancellationPaymentActiveError);
	expect(cancelCalls).toBe(0);

	await expect(
		service.cancelAfterConfirmedSelfPayRefund({
			ownerUserId,
			appointmentId: "appointment-cancel-refunded-001",
			context: {
				traceId: "trace-cancel-refunded-internal",
				idempotencyKey: "cancel-refunded-internal",
			},
		}),
	).resolves.toEqual({
		appointmentId: "appointment-cancel-refunded-001",
		status: "cancelled",
	});
	expect(cancelCalls).toBe(1);
});

test("医保订单本地状态不再阻断预约取消", async () => {
	const repository = createInMemoryAppointmentWriteRepository(
		[],
		[
			{
				appointmentId: "appointment-cancel-medical-001",
				ownerUserId,
				patientId,
				holdId: "hold-medical-001",
				idempotencyKey: "register-key-medical-001",
				providerAppointmentId: "provider-appointment-medical-001",
				providerPatientId,
				departmentName: "测试科室",
				doctorName: "测试医生",
				workDate: "2026-09-20",
				shiftName: "上午",
				sourceSerialNumber: "1",
				totalFen: 1000,
				status: "booked",
				createdAt: "2026-09-16T10:00:00.000Z",
				updatedAt: "2026-09-16T10:00:00.000Z",
			},
		],
	);
	let cancelCalls = 0;
	const defaults = createTestDependencies();
	const service = new AppointmentWriteService({
		...defaults,
		repository,
		medicalInsuranceOrders: {
			findByOwnerAndAppointmentId: async () => ({
				status: "cash_pending",
				feeUploadId: "fee-upload-001",
				payOrdId: "pay-order-001",
			}),
		},
		gateway: {
			...(defaults.gateway as Record<string, unknown>),
			cancel: async () => {
				cancelCalls += 1;
				return {
					trace: {
						provider: "zhongyang",
						operation: "cancel",
						requestId: "cancel-medical-001",
					},
				};
			},
		},
	} as never);

	await expect(
		service.cancel({
			ownerUserId,
			appointmentId: "appointment-cancel-medical-001",
			context: {
				traceId: "trace-cancel-medical-001",
				idempotencyKey: "cancel-key-medical-001",
			},
		}),
	).resolves.toEqual({
		appointmentId: "appointment-cancel-medical-001",
		status: "cancelled",
	});
	expect(cancelCalls).toBe(1);
});
