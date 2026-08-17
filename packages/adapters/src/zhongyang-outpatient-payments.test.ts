import { expect, test } from "bun:test";
import { createZhongyangOutpatientPaymentGateway } from "./zhongyang-outpatient-payments";

const context = {
	traceId: "outpatient-payment-trace-001",
	idempotencyKey: "outpatient-payment-key-001",
};

test("众阳门诊费用 adapter 只使用已确认 amount 并把元转换为分", async () => {
	let requestUrl = "";
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		authorizationToken: "server-token",
		fetcher: async (input, init) => {
			requestUrl = String(input);
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer server-token",
			);
			return new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							outTradeOrderId: "provider-order-secret",
							amount: "12.30",
							tradeStatus: "1",
							// 旧端候选字段即使存在，也不能覆盖 2.6.33 已确认的 amount。
							waitPayAmount: "3.50",
							billDeptName: "心内科",
							registerDept: "未经确认的科室",
							billDocName: "李医生",
							registerDoctor: "李医生",
							billDate: "2026-08-16 09:00:00",
						},
					],
				}),
				{ status: 200, headers: { "x-request-id": "provider-payment-001" } },
			);
		},
	});

	const result = await gateway.listRecords(
		{
			providerPatientId: "provider-patient-secret",
			startTime: "2026-07-17 00:00:00",
			endTime: "2026-08-16 23:59:59",
			status: "unpaid",
			authSysCode: "thirdSelfMachine",
		},
		context,
	);

	expect(requestUrl).toContain(
		"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records?",
	);
	expect(requestUrl).toContain("tradeStatus=1");
	expect(requestUrl).toContain("authSysCode=thirdSelfMachine");
	expect(result.records).toEqual([
		{
			recordId: expect.any(String),
			status: "unpaid",
			departmentName: "心内科",
			doctorName: "李医生",
			billDate: "2026-08-16 09:00:00",
			amountFen: 1230,
		},
	]);
	expect(JSON.stringify(result)).not.toContain("provider-order-secret");
});

test("众阳门诊费用 adapter 拒绝非对象费用条目", async () => {
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(JSON.stringify({ success: true, data: [null] }), {
				status: 200,
				headers: { "x-request-id": "invalid-payment-item" },
			}),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-secret",
				startTime: "2026-08-16 00:00:00",
				endTime: "2026-08-16 23:59:59",
				status: "unpaid",
				authSysCode: "thirdSelfMachine",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "outpatient-payment-records",
		requestId: "invalid-payment-item",
		retryable: false,
	});
});

test("众阳门诊费用 adapter 拒绝缺失金额而不是降级为零元", async () => {
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							billDate: "2026-08-16 09:00:00",
							tradeStatus: "1",
							// 未确认的旧端金额字段不能成为 amount 的 fallback。
							waitPayAmount: "3.50",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "missing-payment-amount" },
				},
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-secret",
				startTime: "2026-08-16 00:00:00",
				endTime: "2026-08-16 23:59:59",
				status: "unpaid",
				authSysCode: "thirdSelfMachine",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "outpatient-payment-records",
		requestId: "missing-payment-amount",
		retryable: false,
	});
});

test("众阳门诊费用 adapter 在公开 contract 边界拒绝超长展示字段", async () => {
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(
				JSON.stringify({
					success: true,
					data: [
						{
							outTradeOrderId: "oversized-payment-field",
							amount: "1.00",
							tradeStatus: "1",
							billDeptName: "科".repeat(129),
							billDate: "2026-08-16 09:00:00",
						},
					],
				}),
				{
					status: 200,
					headers: { "x-request-id": "oversized-payment-field" },
				},
			),
	});

	await expect(
		gateway.listRecords(
			{
				providerPatientId: "provider-patient-secret",
				startTime: "2026-08-16 00:00:00",
				endTime: "2026-08-16 23:59:59",
				status: "unpaid",
				authSysCode: "thirdSelfMachine",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "outpatient-payment-records",
		requestId: "oversized-payment-field",
		retryable: false,
	});
});

test("众阳门诊费用 recordId 不依赖返回顺序", async () => {
	let callCount = 0;
	const gateway = createZhongyangOutpatientPaymentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () => {
			callCount += 1;
			const records = [
				{
					outTradeOrderId: "provider-order-a",
					amount: "1.00",
					tradeStatus: "1",
					billDate: "2026-08-16 09:00:00",
				},
				{
					outTradeOrderId: "provider-order-b",
					amount: "2.00",
					tradeStatus: "1",
					billDate: "2026-08-16 10:00:00",
				},
			];
			return new Response(
				JSON.stringify({
					success: true,
					data: callCount === 1 ? records : [...records].reverse(),
				}),
				{ status: 200, headers: { "x-request-id": `stable-id-${callCount}` } },
			);
		},
	});
	const input = {
		providerPatientId: "provider-patient-secret",
		startTime: "2026-08-16 00:00:00",
		endTime: "2026-08-16 23:59:59",
		status: "unpaid" as const,
		authSysCode: "thirdSelfMachine",
	};

	const first = await gateway.listRecords(input, context);
	const second = await gateway.listRecords(input, context);
	const firstByDate = new Map(
		first.records.map((record) => [record.billDate, record.recordId]),
	);
	for (const record of second.records) {
		const expectedId = firstByDate.get(record.billDate);
		if (!expectedId) throw new Error("stable fee fixture was not found");
		expect(record.recordId).toBe(expectedId);
	}
});

test("众阳门诊费用 adapter 拒绝缺少稳定标识或重复费用", async () => {
	const createGateway = (data: unknown[], requestId: string) =>
		createZhongyangOutpatientPaymentGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify({ success: true, data }), {
					status: 200,
					headers: { "x-request-id": requestId },
				}),
		});
	const input = {
		providerPatientId: "provider-patient-secret",
		startTime: "2026-08-16 00:00:00",
		endTime: "2026-08-16 23:59:59",
		status: "unpaid" as const,
		authSysCode: "thirdSelfMachine",
	};

	await expect(
		createGateway(
			[
				{
					amount: "1.00",
					tradeStatus: "1",
					billDate: "2026-08-16 09:00:00",
				},
				{
					amount: "2.00",
					tradeStatus: "1",
					billDate: "2026-08-16 09:00:00",
				},
			],
			"missing-fee-identity",
		).listRecords(input, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "outpatient-payment-records",
		requestId: "missing-fee-identity",
		retryable: false,
	});

	await expect(
		createGateway(
			[
				{
					outTradeOrderId: "duplicate-order",
					amount: "1.00",
					tradeStatus: "1",
					billDate: "2026-08-16 09:00:00",
				},
				{
					outTradeOrderId: "duplicate-order",
					amount: "2.00",
					tradeStatus: "1",
					billDate: "2026-08-16 09:00:00",
				},
			],
			"duplicate-fee-identity",
		).listRecords(input, context),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		operation: "outpatient-payment-records",
		requestId: "duplicate-fee-identity",
		retryable: false,
	});
});

test("众阳门诊费用 adapter 拒绝缺失或错配的 tradeStatus", async () => {
	const createGateway = (item: unknown, requestId: string) =>
		createZhongyangOutpatientPaymentGateway({
			baseUrl: "https://zhongyang.example.test",
			fetcher: async () =>
				new Response(JSON.stringify({ success: true, data: [item] }), {
					status: 200,
					headers: { "x-request-id": requestId },
				}),
		});
	const input = {
		providerPatientId: "provider-patient-secret",
		startTime: "2026-08-16 00:00:00",
		endTime: "2026-08-16 23:59:59",
		status: "unpaid" as const,
		authSysCode: "thirdSelfMachine",
	};

	const cases: readonly [unknown, string][] = [
		[
			{
				outTradeOrderId: "missing-trade-status",
				amount: "1.00",
				billDate: "2026-08-16 09:00:00",
			},
			"missing-trade-status",
		],
		[
			{
				outTradeOrderId: "paid-in-unpaid-query",
				amount: "1.00",
				tradeStatus: "3",
				billDate: "2026-08-16 09:00:00",
			},
			"mismatched-trade-status",
		],
	];

	for (const [item, requestId] of cases) {
		await expect(
			createGateway(item, requestId).listRecords(input, context),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			operation: "outpatient-payment-records",
			requestId,
			retryable: false,
		});
	}
});
