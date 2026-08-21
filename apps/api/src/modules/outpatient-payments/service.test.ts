import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import type {
	OutpatientPaymentGateway,
	OutpatientPaymentRecord,
	PatientRepository,
} from "@hospital/domain";
import {
	ExternalTraceReadModelValidationError,
	MAX_OUTPATIENT_PAYMENT_RECORDS,
	DependencyNotConfiguredError as MissingDependencyError,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import {
	OutpatientPaymentPatientNotFoundError,
	OutpatientPaymentQueryError,
	OutpatientPaymentService,
} from "./index";

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
	});
});

test("门诊费用 service 在 owner 映射和 Provider 前拒绝非法调用上下文", async () => {
	let repositoryCalls = 0;
	let gatewayCalls = 0;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				return undefined;
			},
		},
		gateway: {
			listRecords: async () => {
				gatewayCalls += 1;
				throw new Error("must not be called");
			},
		},
		authSysCode: "thirdSelfMachine",
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", null as never),
	).rejects.toBeInstanceOf(OutpatientPaymentQueryError);
	await expect(
		service.list(" ", "patient-001", "unpaid", {
			traceId: "trace-owner-invalid",
			idempotencyKey: "key-owner-invalid",
		}),
	).rejects.toBeInstanceOf(OutpatientPaymentQueryError);
	expect(repositoryCalls).toBe(0);
	expect(gatewayCalls).toBe(0);
});

test("门诊费用拒绝异常 Provider trace 并只记录固定原因", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang",
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "bad\n-request-id",
				},
			}),
		},
		authSysCode: "thirdSelfMachine",
		logger: createLogger({
			service: "outpatient-payment-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-invalid-payment-trace",
			idempotencyKey: "key-invalid-payment-trace",
		}),
	).rejects.toBeInstanceOf(ExternalTraceReadModelValidationError);

	const output = lines.join("");
	expect(output).toContain('"resultViolation":"request-id-invalid"');
	expect(output).not.toContain("bad\\n-request-id");
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

test("门诊费用查询拒绝仓储返回的非法或越界患者引用", async () => {
	for (const [reference, expectedViolation] of [
		[
			{
				patientId: "patient-other",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-other",
			},
			"reference-scope-mismatch",
		],
		[
			{
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider\u0000patient-001",
			},
			"reference-invalid",
		],
	] as const) {
		const lines: string[] = [];
		let gatewayCalled = false;
		const service = new OutpatientPaymentService({
			repository: {
				listByOwner: async () => [],
				upsertFromDirectory: async () => {
					throw new Error("not used");
				},
				resolveProviderReference: async () => reference,
			},
			gateway: {
				listRecords: async () => {
					gatewayCalled = true;
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
			service.list("user-001", "patient-001", "unpaid", {
				traceId: `trace-reference-${expectedViolation}`,
				idempotencyKey: `key-reference-${expectedViolation}`,
			}),
		).rejects.toBeInstanceOf(OutpatientPaymentPatientNotFoundError);
		expect(gatewayCalled).toBe(false);
		expect(lines.join("\n")).toContain(
			`"resultViolation":"${expectedViolation}"`,
		);
	}
});

test("门诊费用查询缺少已确认渠道码时在 provider 前 fail-closed", async () => {
	let gatewayCalled = false;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => {
				gatewayCalled = true;
				throw new Error("provider must not be called");
			},
		},
		authSysCode: "   ",
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-missing-auth-sys-code",
			idempotencyKey: "key-missing-auth-sys-code",
		}),
	).rejects.toBeInstanceOf(MissingDependencyError);
	expect(gatewayCalled).toBe(false);
});

test("门诊费用查询拒绝运行时未知状态且不把它写入日志", async () => {
	const lines: string[] = [];
	let repositoryCalls = 0;
	let gatewayCalled = false;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => {
				repositoryCalls += 1;
				return undefined;
			},
		},
		gateway: {
			listRecords: async () => {
				gatewayCalled = true;
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
		service.list("user-001", "patient-001", "unexpected" as never, {
			traceId: "trace-invalid-status",
			idempotencyKey: "key-invalid-status",
		}),
	).rejects.toMatchObject({ name: "InvalidOutpatientPaymentStatusError" });

	expect(repositoryCalls).toBe(0);
	expect(gatewayCalled).toBe(false);
	const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
	expect(record).toMatchObject({
		event: "outpatient.payment.records.failed",
		traceId: "trace-invalid-status",
		status: "invalid",
		errorType: "InvalidOutpatientPaymentStatusError",
	});
	expect(JSON.stringify(record)).not.toContain("unexpected");
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
	).rejects.toMatchObject({ name: "OutpatientPaymentQueryError" });
	expect(repositoryCalls).toBe(0);
	await expect(
		service.list("user-001", "x".repeat(129), "unpaid", {
			traceId: "trace-oversized-patient",
			idempotencyKey: "key-oversized-patient",
		}),
	).rejects.toBeInstanceOf(OutpatientPaymentQueryError);
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
		"outpatient.payment.records.failed",
		"outpatient.payment.records.requested",
		"outpatient.payment.records.failed",
	]);
	expect(records[0]).toMatchObject({
		traceId: "trace-empty-patient",
		patientId: "invalid",
		errorType: "OutpatientPaymentQueryError",
	});
	expect(records[1]).toMatchObject({
		traceId: "trace-oversized-patient",
		patientId: "invalid",
		errorType: "OutpatientPaymentQueryError",
	});
	expect(JSON.stringify(records)).not.toContain("x".repeat(129));
	expect(JSON.stringify(records)).not.toContain("mysql connection failed");
	expect(records[3]).toMatchObject({
		traceId: "trace-repository-failure",
		patientId: "patient-001",
		status: "paid",
		errorType: "Error",
	});
});

test("门诊费用 Provider 失败日志保留关联字段但不记录原文", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => {
				throw new ProviderRequestError({
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "provider-payment-failed",
					statusCode: 429,
					retryable: true,
					message: "provider raw payment response",
				});
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
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-payment-provider-failed",
			idempotencyKey: "key-payment-provider-failed",
		}),
	).rejects.toBeInstanceOf(ProviderRequestError);

	const record = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((item) => item.event === "outpatient.payment.records.failed");
	expect(record).toMatchObject({
		providerOperation: "outpatient-payment-records",
		providerRequestId: "provider-payment-failed",
		providerStatusCode: 429,
		providerRetryable: true,
	});
	expect(JSON.stringify(record)).not.toContain("provider raw payment response");
});

test("门诊费用 service 拒绝网关返回的错状态，并记录低敏原因", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				// 网关绕过 adapter 时，不能把 paid 记录伪装成 unpaid 响应。
				records: [
					{
						recordId: "opaque-record-001",
						status: "paid",
						billDate: "2026-08-16 09:00:00",
						amountFen: 350,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "provider-request-invalid-status",
				},
			}),
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
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-result-status-mismatch",
			idempotencyKey: "key-result-status-mismatch",
		}),
	).rejects.toMatchObject({
		name: "OutpatientPaymentResultValidationError",
		violation: "status-mismatch",
	});

	const records = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(records.map((record) => record.event)).toEqual([
		"outpatient.payment.records.requested",
		"outpatient.payment.records.failed",
	]);
	expect(records[1]).toMatchObject({
		traceId: "trace-result-status-mismatch",
		errorType: "OutpatientPaymentResultValidationError",
		resultViolation: "status-mismatch",
	});
	expect(
		records.some(
			(record) => record.event === "outpatient.payment.records.loaded",
		),
	).toBe(false);
});

test("门诊费用 service 拒绝网关返回的重复费用引用", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records: [
					{
						recordId: "opaque-record-duplicate",
						status: "paid" as const,
						billDate: "2026-08-16 09:00:00",
						amountFen: 350,
					},
					{
						recordId: "opaque-record-duplicate",
						status: "paid" as const,
						billDate: "2026-08-16 09:00:00",
						amountFen: 350,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "provider-request-duplicate-id",
				},
			}),
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
		service.list("user-001", "patient-001", "paid", {
			traceId: "trace-result-duplicate-id",
			idempotencyKey: "key-result-duplicate-id",
		}),
	).rejects.toMatchObject({
		name: "OutpatientPaymentResultValidationError",
		violation: "record-id-duplicate",
	});

	const failed = lines
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.find((record) => record.event === "outpatient.payment.records.failed");
	expect(failed).toMatchObject({
		traceId: "trace-result-duplicate-id",
		resultViolation: "record-id-duplicate",
	});
});

test("门诊费用 service 拒绝查询窗口外账单且不筛掉坏行伪装成功", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				// 混入一条窗口内、一条窗口外的记录；必须整批拒绝，
				// 不能只留下窗口内记录后伪装为完整账单列表。
				records: [
					{
						recordId: "record-in-window",
						status: "unpaid" as const,
						billDate: "2026-08-16 08:00:00",
						amountFen: 100,
					},
					{
						recordId: "record-outside-window",
						status: "unpaid" as const,
						billDate: "2026-07-17 07:59:59",
						amountFen: 200,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "provider-request-outside-window",
				},
			}),
		},
		authSysCode: "thirdSelfMachine",
		now: () => new Date("2026-08-16T00:00:00.000Z"),
		logger: createLogger({
			service: "hospital-api-test",
			environment: "test",
			level: "info",
			destination: { write: (chunk) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-payment-outside-window",
			idempotencyKey: "key-payment-outside-window",
		}),
	).rejects.toMatchObject({
		name: "OutpatientPaymentResultValidationError",
		violation: "bill-date-outside-query",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "outpatient.payment.records.failed",
			traceId: "trace-payment-outside-window",
			resultViolation: "bill-date-outside-query",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "outpatient.payment.records.loaded",
		}),
	);
});

test("门诊费用 service 二次校验后只返回白名单字段", async () => {
	const providerRecord = {
		recordId: "payment-projection-001",
		status: "paid" as const,
		departmentName: "心内科",
		doctorName: "李医生",
		billDate: "2026-08-16 09:00:00",
		amountFen: 350,
		providerTradeNo: "provider-trade-secret",
		patientName: "provider-patient-secret",
		insuranceAmountFen: 300,
	} as unknown as OutpatientPaymentRecord;
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records: [providerRecord],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "payment-projection",
				},
			}),
		},
		authSysCode: "thirdSelfMachine",
	});

	const result = await service.list("user-001", "patient-001", "paid", {
		traceId: "trace-payment-projection",
		idempotencyKey: "key-payment-projection",
	});

	expect(result).toEqual({
		status: "paid",
		items: [
			{
				recordId: "payment-projection-001",
				status: "paid",
				departmentName: "心内科",
				doctorName: "李医生",
				billDate: "2026-08-16 09:00:00",
				amountFen: 350,
			},
		],
		total: 1,
	});
	const output = JSON.stringify(result);
	expect(output).not.toContain("provider-trade-secret");
	expect(output).not.toContain("provider-patient-secret");
	expect(output).not.toContain("insuranceAmountFen");
});

test("门诊费用 service 超过资源上限时整批拒绝且不记录 loaded", async () => {
	const lines: string[] = [];
	const records: OutpatientPaymentRecord[] = Array.from(
		{ length: MAX_OUTPATIENT_PAYMENT_RECORDS + 1 },
		(_, index) => ({
			recordId: `payment-limit-${index}`,
			status: "paid" as const,
			billDate: "2026-08-16 09:00:00",
			amountFen: 100,
		}),
	);
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records,
				trace: {
					provider: "zhongyang" as const,
					operation: "outpatient-payment-records",
					requestId: "payment-limit",
				},
			}),
		},
		authSysCode: "thirdSelfMachine",
		logger: createLogger({
			service: "outpatient-payment-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await expect(
		service.list("user-001", "patient-001", "paid", {
			traceId: "trace-payment-limit",
			idempotencyKey: "key-payment-limit",
		}),
	).rejects.toMatchObject({
		name: "OutpatientPaymentResultValidationError",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "outpatient.payment.records.failed",
			traceId: "trace-payment-limit",
			resultViolation: "records-too-many",
		}),
	);
	expect(events).not.toContainEqual(
		expect.objectContaining({
			event: "outpatient.payment.records.loaded",
		}),
	);
});

test("门诊费用日志保留经过校验的多请求 provider trace", async () => {
	const lines: string[] = [];
	const service = new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("not used");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-001",
				provider: "zhongyang" as const,
				providerPatientId: "provider-patient-001",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records: [
					{
						recordId: "payment-trace-record",
						status: "paid" as const,
						billDate: "2026-08-16 09:00:00",
						amountFen: 100,
					},
				],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "payment-trace-primary",
					requestIds: ["payment-trace-primary", "payment-trace-secondary"],
				},
			}),
		},
		authSysCode: "thirdSelfMachine",
		logger: createLogger({
			service: "outpatient-payment-trace-test",
			environment: "test",
			destination: { write: (chunk: string) => lines.push(chunk) },
		}),
	});

	await service.list("user-001", "patient-001", "paid", {
		traceId: "trace-payment-multiple-provider-requests",
		idempotencyKey: "key-payment-multiple-provider-requests",
	});

	const events = lines.map(
		(line) => JSON.parse(line) as Record<string, unknown>,
	);
	expect(events).toContainEqual(
		expect.objectContaining({
			event: "outpatient.payment.records.loaded",
			providerRequestId: "payment-trace-primary",
			providerRequestIds: ["payment-trace-primary", "payment-trace-secondary"],
		}),
	);
});
