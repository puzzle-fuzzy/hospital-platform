import { expect, test } from "bun:test";
import type {
	OutpatientMedicalRecordGateway,
	PatientRepository,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	MedicalRecordPatientNotFoundError,
	MedicalRecordQueryError,
	OutpatientMedicalRecordService,
} from "./service";

const context = {
	traceId: "medical-service-trace-001",
	idempotencyKey: "medical-service-key-001",
};

function repositoryWithReference(): PatientRepository {
	return {
		resolveProviderReference: async () => ({
			patientId: "patient-001",
			provider: "zhongyang",
			providerPatientId: "provider-patient-001",
		}),
	} as unknown as PatientRepository;
}

test("门诊病历 service 先做 owner 患者映射，再返回安全摘要和日志", async () => {
	let providerInput:
		| {
				providerPatientId: string;
				query: { startDate: string; endDate: string };
		  }
		| undefined;
	const lines: string[] = [];
	const gateway: OutpatientMedicalRecordGateway = {
		listRecords: async (input) => {
			providerInput = input;
			return {
				records: [
					{
						visitTime: "2026-08-28 09:30:00",
						departmentName: "心内科",
						diagnosis: "高血压",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-medical-records",
					requestId: "provider-medical-record-001",
				},
			};
		},
	};
	const service = new OutpatientMedicalRecordService({
		repository: repositoryWithReference(),
		directory: gateway,
		logger: createLogger({
			service: "medical-record-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-07-29", endDate: "2026-08-28" },
			context,
		),
	).resolves.toEqual({
		items: [
			{
				visitTime: "2026-08-28 09:30:00",
				departmentName: "心内科",
				diagnosis: "高血压",
			},
		],
		total: 1,
	});
	expect(providerInput).toEqual({
		providerPatientId: "provider-patient-001",
		query: { startDate: "2026-07-29", endDate: "2026-08-28" },
	});
	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "medical.records.requested",
			traceId: context.traceId,
			patientId: "patient-001",
		}),
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "medical.records.loaded",
			providerRequestId: "provider-medical-record-001",
			itemCount: 1,
		}),
	);
});

test("门诊病历 service 拒绝超范围日期、未映射患者并且不调用 Provider", async () => {
	let providerCalls = 0;
	const service = new OutpatientMedicalRecordService({
		repository: {
			resolveProviderReference: async () => undefined,
		} as unknown as PatientRepository,
		directory: {
			listRecords: async () => {
				providerCalls += 1;
				throw new Error("must not call provider");
			},
		},
	});

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-07-01", endDate: "2026-08-28" },
			context,
		),
	).rejects.toBeInstanceOf(MedicalRecordQueryError);
	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-08-01", endDate: "2026-08-28" },
			context,
		),
	).rejects.toBeInstanceOf(MedicalRecordPatientNotFoundError);
	expect(providerCalls).toBe(0);
});
