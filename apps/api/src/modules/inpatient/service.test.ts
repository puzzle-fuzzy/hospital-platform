import { expect, test } from "bun:test";
import type {
	InpatientEpisodeGateway,
	PatientRepository,
} from "@hospital/domain";
import {
	InpatientEpisodePatientNotFoundError,
	InpatientEpisodeService,
} from "./service";

const context = {
	traceId: "inpatient-service-trace-001",
	idempotencyKey: "inpatient-service-key-001",
};

function repositoryWithReference(): PatientRepository {
	return {
		resolveProviderReference: async (input: {
			ownerUserId: string;
			patientId: string;
			provider: "zhongyang";
			referenceKind?: "his-patient" | "directory";
		}) => ({
			patientId: input.patientId,
			provider: "zhongyang",
			providerPatientId: "provider-patient-001",
		}),
	} as unknown as PatientRepository;
}

test("住院 episode service 先做 owner 患者映射再返回安全摘要", async () => {
	let providerInput: { providerPatientId: string } | undefined;
	const gateway: InpatientEpisodeGateway = {
		listEpisodes: async (input) => {
			providerInput = input;
			return {
				episodes: [
					{
						patientName: "张三",
						admittedAt: "2026-08-28 09:30:00",
						status: "inpatient",
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "inpatient-episodes",
					requestId: "provider-inpatient-001",
				},
			};
		},
	};
	const service = new InpatientEpisodeService({
		repository: repositoryWithReference(),
		directory: gateway,
	});

	await expect(
		service.list("user-001", "patient-001", context),
	).resolves.toEqual({
		items: [
			{
				patientName: "张三",
				admittedAt: "2026-08-28 09:30:00",
				status: "inpatient",
			},
		],
		total: 1,
	});
	expect(providerInput).toEqual({ providerPatientId: "provider-patient-001" });
});

test("住院 episode service 没有 owner 患者映射时不调用 Provider", async () => {
	let providerCalls = 0;
	const service = new InpatientEpisodeService({
		repository: {
			resolveProviderReference: async () => undefined,
		} as unknown as PatientRepository,
		directory: {
			listEpisodes: async () => {
				providerCalls += 1;
				throw new Error("must not call provider");
			},
		},
	});

	await expect(
		service.list("user-001", "patient-001", context),
	).rejects.toBeInstanceOf(InpatientEpisodePatientNotFoundError);
	expect(providerCalls).toBe(0);
});
