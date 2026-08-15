import { expect, test } from "bun:test";
import type {
	PatientRepository,
	ReportDirectoryGateway,
} from "@hospital/domain";
import { ReportQueryError, ReportService } from "./service";

test("report queries reject impossible calendar dates before provider access", async () => {
	let providerCalls = 0;
	const directory: ReportDirectoryGateway = {
		listReports: async () => {
			providerCalls += 1;
			return {
				reports: [],
				trace: {
					provider: "zhongyang",
					operation: "reports",
					requestId: "unused",
				},
			};
		},
	};
	const repository = {
		resolveProviderReference: async () => undefined,
	} as unknown as PatientRepository;
	const service = new ReportService({ repository, directory });

	await expect(
		service.list(
			"user-001",
			"patient-001",
			{ startDate: "2026-02-30", endDate: "2026-03-01" },
			{ traceId: "trace-invalid-report", idempotencyKey: "key-invalid-report" },
		),
	).rejects.toBeInstanceOf(ReportQueryError);
	expect(providerCalls).toBe(0);
});
