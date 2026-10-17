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
	createOutpatientPaidRecordSnapshotResolver,
	OutpatientPaymentPatientNotFoundError,
	OutpatientPaymentQueryError,
	OutpatientPaymentService,
} from "./index";

function paidFee(recordId: string, amountFen: number): OutpatientPaymentRecord {
	return {
		recordId,
		amountFen,
		status: "paid",
		billDate: "2026-10-15 15:34:12",
		itemName: recordId,
	};
}

function paidDetailService(
	records: OutpatientPaymentRecord[],
	snapshot?: unknown,
) {
	return new OutpatientPaymentService({
		repository: {
			listByOwner: async () => [],
			upsertFromDirectory: async () => {
				throw new Error("unused");
			},
			resolveProviderReference: async () => ({
				patientId: "patient-paid",
				provider: "zhongyang",
				providerPatientId: "his-patient-paid",
			}),
		},
		gateway: {
			listRecords: async () => ({
				records,
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "paid-detail-request",
				},
			}),
		},
		resolvePaidRecordSnapshot: async (input) => {
			expect(input).toEqual({
				ownerUserId: "owner-paid",
				patientId: "patient-paid",
				recordId: "original-group",
			});
			return snapshot;
		},
		authSysCode: "thirdSelfMachine",
		now: () => new Date("2026-10-15T08:00:00.000Z"),
	});
}

const paidDetailContext = {
	traceId: "paid-detail-trace",
	idempotencyKey: "paid-detail-key",
};

function originalPaidGroup() {
	return {
		recordId: "original-group",
		status: "unpaid",
		billDate: "2026-10-15 15:34:12",
		amountFen: 9700,
		items: [
			{ ...paidFee("current-b", 8000), status: "unpaid" },
			{ ...paidFee("current-d", 1700), status: "unpaid" },
		],
	};
}

test("门诊成功详情从同次就诊汇总中定位本次单项，不带入历史已缴", async () => {
	const a = paidFee("previous-a", 1000),
		b = paidFee("current-b", 8000);
	const service = paidDetailService([
		{ ...paidFee("combined-paid", 9000), items: [a, b] },
	]);
	const detail = await service.detail(
		"owner-paid",
		"patient-paid",
		"current-b",
		"paid",
		paidDetailContext,
	);
	expect(detail.item).toEqual(b);
});

test("门诊成功详情按密文成员绑定恢复本次多项，金额与内容取fresh已缴明细", async () => {
	const a = paidFee("previous-a", 1000),
		b = paidFee("current-b", 7000),
		d = paidFee("current-d", 1500);
	const service = paidDetailService(
		[{ ...paidFee("combined-paid", 9500), items: [a, b, d] }],
		originalPaidGroup(),
	);
	const detail = await service.detail(
		"owner-paid",
		"patient-paid",
		"original-group",
		"paid",
		paidDetailContext,
	);
	expect(detail.item).toMatchObject({
		recordId: "original-group",
		status: "paid",
		amountFen: 8500,
		items: [b, d],
	});
	expect(JSON.stringify(detail.item)).not.toContain("previous-a");
});

test("门诊成功详情不能用旧快照补齐HIS尚未返回的成员", async () => {
	const service = paidDetailService(
		[paidFee("previous-a", 1000), paidFee("current-b", 8000)],
		originalPaidGroup(),
	);
	await expect(
		service.detail(
			"owner-paid",
			"patient-paid",
			"original-group",
			"paid",
			paidDetailContext,
		),
	).rejects.toMatchObject({ name: "OutpatientPaymentRecordNotFoundError" });
});

test("门诊成功详情拒绝快照嵌套、重复成员和当前退款状态冲突", async () => {
	const snapshot = originalPaidGroup();
	for (const invalid of [
		{
			...snapshot,
			items: snapshot.items.map((item) => ({ ...item, items: [] })),
		},
		{
			...snapshot,
			amountFen: 16000,
			items: [snapshot.items[0], snapshot.items[0]],
		},
	]) {
		await expect(
			paidDetailService(
				[paidFee("current-b", 8000), paidFee("current-d", 1700)],
				invalid,
			).detail(
				"owner-paid",
				"patient-paid",
				"original-group",
				"paid",
				paidDetailContext,
			),
		).rejects.toMatchObject({ name: "OutpatientPaymentResultValidationError" });
	}
	await expect(
		paidDetailService(
			[
				paidFee("current-b", 8000),
				{ ...paidFee("current-d", 1700), paymentStatus: "refunding" },
			],
			snapshot,
		).detail(
			"owner-paid",
			"patient-paid",
			"original-group",
			"paid",
			paidDetailContext,
		),
	).rejects.toMatchObject({
		name: "OutpatientPaymentResultValidationError",
		violation: "status-mismatch",
	});
});

test.each(["cash", "medical"])(
	"门诊快照解析仅允许同owner/患者/业务的成功%s订单",
	async (kind) => {
		const snapshot = originalPaidGroup();
		let cashContextReads = 0,
			medicalContextReads = 0;
		const matchingCash = {
			ownerUserId: "owner-paid",
			patientId: "patient-paid",
			idempotencyKey: "outpatient-self-pay:original-group",
			state: "completed",
			orderId: "cash-order",
		};
		const matchingMedical = {
			ownerUserId: "owner-paid",
			patientId: "patient-paid",
			businessId: "original-group",
			businessType: "outpatient",
			orderType: "DiagPay",
			status: "insurance_settled",
			medicalOrderId: "medical-order",
		};
		let cash: Record<string, unknown> | undefined =
			kind === "cash" ? matchingCash : undefined;
		let medical: Record<string, unknown> | undefined =
			kind === "medical" ? matchingMedical : undefined;
		const resolver = createOutpatientPaidRecordSnapshotResolver({
			paymentOrders: {
				findByOwnerAndIdempotencyKey: async () => cash,
				getRegistrationSelfPayContext: async () => {
					cashContextReads++;
					return { outpatientPaymentRecord: snapshot };
				},
			},
			medicalInsuranceOrders: {
				findByOwnerAndBusinessKey: async () => medical,
				getSettlementContext: async () => {
					medicalContextReads++;
					return { outpatientPaymentRecord: snapshot };
				},
			},
		} as never);
		const input = {
			ownerUserId: "owner-paid",
			patientId: "patient-paid",
			recordId: "original-group",
		};
		expect(await resolver(input)).toEqual(snapshot);
		for (const mismatch of [
			{ ownerUserId: "another-owner" },
			{ patientId: "another-patient" },
			kind === "cash"
				? { idempotencyKey: "another-key" }
				: { businessId: "another-record" },
			kind === "cash" ? { state: "cash_pending" } : { status: "cash_pending" },
		]) {
			cash = kind === "cash" ? { ...matchingCash, ...mismatch } : undefined;
			medical =
				kind === "medical" ? { ...matchingMedical, ...mismatch } : undefined;
			expect(await resolver(input)).toBeUndefined();
		}
		expect(cashContextReads).toBe(kind === "cash" ? 1 : 0);
		expect(medicalContextReads).toBe(kind === "medical" ? 1 : 0);
	},
);

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

test("门诊费用查询把运行时非字符串渠道码收敛为依赖未配置", async () => {
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
		// 配置对象来自运行时边界，专门覆盖绕过 TypeScript 后的错误值。
		authSysCode: undefined as never,
	});

	await expect(
		service.list("user-001", "patient-001", "unpaid", {
			traceId: "trace-invalid-auth-sys-code-type",
			idempotencyKey: "key-invalid-auth-sys-code-type",
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

test.each([false, true])(
	"门诊费用 service 拒绝窗口外账单及合并明细（合并=%s）",
	async (grouped) => {
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
					records: grouped
						? [
								{
									recordId: "record-group-in-window",
									status: "unpaid" as const,
									billDate: "2026-08-16 08:00:00",
									amountFen: 300,
									items: [
										{
											recordId: "child-in-window",
											status: "unpaid" as const,
											billDate: "2026-08-16 08:00:00",
											amountFen: 100,
										},
										{
											recordId: "child-outside-window",
											status: "unpaid" as const,
											billDate: "2026-07-17 07:59:59",
											amountFen: 200,
										},
									],
								},
							]
						: [
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
	},
);

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
		now: () => new Date("2026-08-17T12:00:00+08:00"),
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
		now: () => new Date("2026-08-17T12:00:00+08:00"),
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
