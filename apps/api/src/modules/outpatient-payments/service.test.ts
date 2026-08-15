import { expect, test } from "bun:test";
import type {
	OutpatientPaymentGateway,
	PatientRepository,
} from "@hospital/domain";
import { OutpatientPaymentService } from "./index";

test("门诊费用查询由 owner-scoped patient 映射驱动，并固定服务端窗口", async () => {
	let gatewayInput: Parameters<OutpatientPaymentGateway["listRecords"]>[0];
	const repository: PatientRepository = {
		listByOwner: async () => [],
		upsertFromDirectory: async () => {
			throw new Error("not used");
		},
		resolveProviderReference: async (input) => ({
			patientId: input.patientId,
			provider: "zhongyang",
			providerPatientId: "provider-patient-001",
		}),
	};
	const gateway: OutpatientPaymentGateway = {
		listRecords: async (input) => {
			gatewayInput = input;
			return {
				records: [
					{
						recordId: "opaque-record-001",
						status: "unpaid",
						departmentName: "心内科",
						billDate: "2026-08-16 09:00:00",
						amountFen: 350,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "provider-request-001",
				},
			};
		},
	};
	const service = new OutpatientPaymentService({
		repository,
		gateway,
		authSysCode: "thirdSelfMachine",
		now: () => new Date("2026-08-16T10:20:30.000Z"),
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-001",
			idempotencyKey: "key-001",
		}),
	).resolves.toEqual({
		status: "unpaid",
		items: [
			{
				recordId: "opaque-record-001",
				status: "unpaid",
				departmentName: "心内科",
				billDate: "2026-08-16 09:00:00",
				amountFen: 350,
			},
		],
		total: 1,
	});

	expect(gatewayInput).toEqual({
		providerPatientId: "provider-patient-001",
		startTime: "2026-07-17 10:20:30",
		endTime: "2026-08-16 10:20:30",
		status: "unpaid",
		authSysCode: "thirdSelfMachine",
	});
});

test("门诊费用查询在没有 owner 映射时拒绝调用 provider", async () => {
	let gatewayCalled = false;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => undefined,
		},
		gateway: {
			listRecords: async () => {
				gatewayCalled = true;
				throw new Error("provider must not be called");
			},
		},
		authSysCode: "thirdSelfMachine",
	});

	await expect(
		service.list("user-001", "patient-001", "paid", {
			traceId: "trace-002",
			idempotencyKey: "key-002",
		}),
	).rejects.toMatchObject({
		name: "OutpatientPaymentPatientNotFoundError",
	});
	expect(gatewayCalled).toBe(false);
});
