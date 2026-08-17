import { expect, test } from "bun:test";
import type {
	OutpatientPaymentGateway,
	PatientRepository,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { OutpatientPaymentService } from "./index";

test("门诊费用查询由 owner-scoped patient 映射驱动，并固定服务端窗口", async () => {
	// 只有 provider 被真实调用后才会赋值，先显式标记未赋值状态以通过严格类型检查。
	let gatewayInput:
		| Parameters<OutpatientPaymentGateway["listRecords"]>[0]
		| undefined;
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
		// 输入时间是 UTC；provider 请求必须按 Asia/Shanghai 输出，不能随测试机时区变化。
		startTime: "2026-07-17 18:20:30",
		endTime: "2026-08-16 18:20:30",
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

test("门诊费用输入和 owner 映射失败都会留下可检索的低敏日志", async () => {
	const lines: string[] = [];
	let repositoryCalls = 0;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				throw new Error("mysql connection failed");
			},
		},
		gateway: {
			listRecords: async () => {
				throw new Error("provider must not be called");
			},
		},
		authSysCode: "thirdSelfMachine",
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("user-001", "   ", "unpaid", {
			traceId: "trace-empty-patient",
			idempotencyKey: "key-empty-patient",
		}),
	).rejects.toMatchObject({ name: "OutpatientPaymentPatientNotFoundError" });
	expect(repositoryCalls).toBe(0);

	await expect(
		service.list("user-001", "patient-001", "paid", {
			traceId: "trace-repository-failure",
			idempotencyKey: "key-repository-failure",
		}),
	).rejects.toThrow("mysql connection failed");

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"outpatient.payment.records.failed",
		"outpatient.payment.records.requested",
		"outpatient.payment.records.failed",
	]);
	expect(JSON.stringify(records)).not.toContain("mysql connection failed");
	expect(records[2]).toMatchObject({
		traceId: "trace-repository-failure",
		patientId: "patient-001",
		status: "paid",
		errorType: "Error",
	});
});
