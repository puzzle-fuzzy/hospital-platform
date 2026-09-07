import { expect, test } from "bun:test";
import { createInMemoryAppointmentWriteRepository } from "@hospital/persistence";
import { AppointmentWriteService } from "./write-service";

test("挂号结算在众阳未返回 registerId 时沿用 hisRegisterId", async () => {
	const ownerUserId = "fixture-user-0001";
	const patientId = "patient-001";
	const providerPatientId = "8481567861861908740";
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
