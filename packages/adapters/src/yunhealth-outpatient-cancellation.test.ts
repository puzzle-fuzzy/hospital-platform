import { expect, test } from "bun:test";
import { parseJsonPreservingLargeIntegers } from "@hospital/contracts";
import type { RegistrationSelfPaySettlementContext } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import type { ProviderFetcher, ProviderRequestLogger } from "./http";
import { createYunhealthOutpatientSelfPayCancellationGateway } from "./yunhealth-outpatient-cancellation";

const context = {
	traceId: "outpatient-cancel-trace-001",
	idempotencyKey: "outpatient-cancel-request-001",
};
const saved: RegistrationSelfPaySettlementContext = {
	businessId: "9000000000000000101",
	payingId: "9000000000000000102",
	tradingId: "9000000000000000103",
	hospitalId: "10389001",
	patientId: "9000000000000000104",
	tradeTypeCode: "2",
	payTypeId: "5032",
	workStationId: "",
	platformOrderId: "outpatient-order-001",
	certNo: "11010519900101007X",
	psnName: "测试患者隐私姓名",
	outTradeNo: "sensitive-merchant-reference",
	recordCode: "sensitive-record-code",
};
const input = {
	orderId: "outpatient-order-001",
	totalFen: 2137,
	registrationContext: saved,
};

type Call = { url: string; body: string; headers: Headers };
type Reply = unknown | Error | ((init?: RequestInit) => Promise<Response>);

function envelope(data: unknown, extra: Record<string, unknown> = {}) {
	return { success: true, code: "0000", data, ...extra };
}
function query(code: unknown = 5, extra: Record<string, unknown> = {}) {
	return envelope({ success: true, code, payTypeId: 5032, ...extra });
}
function cancelled(extra: Record<string, unknown> = {}) {
	return envelope({ cancelStatus: "1", ...extra });
}
function harness(replies: Reply[], logger?: ProviderRequestLogger) {
	const calls: Call[] = [];
	const fetcher: ProviderFetcher = async (url, init) => {
		calls.push({
			url: String(url),
			body: String(init?.body),
			headers: new Headers(init?.headers),
		});
		const reply = replies[calls.length - 1];
		if (reply instanceof Error) throw reply;
		if (typeof reply === "function") return reply(init);
		return new Response(JSON.stringify(reply), {
			status: 200,
			headers: { "x-request-id": `outpatient-cancel-provider-${calls.length}` },
		});
	};
	const gateway = createYunhealthOutpatientSelfPayCancellationGateway({
		baseUrl: "https://yunhealth.example.test",
		authorizationToken: "private-server-token",
		hospitalId: "10389001",
		fetcher,
		...(logger ? { logger } : {}),
	});
	return { calls, gateway };
}

test("普通门诊明确支付失败才查后取消，Long 原样传输且不调用关单退款或完成结算", async () => {
	const { gateway, calls } = harness([query(), cancelled()]);
	const result = await gateway.cancel(input, context);
	expect(result).toEqual({
		state: "cancelled",
		providerStatus: "settlement_cancel_confirmed",
		trace: {
			provider: "yunhealth",
			operation: "outpatient-self-pay.cancellation",
			requestId: "outpatient-cancel-provider-2",
			requestIds: [
				"outpatient-cancel-provider-1",
				"outpatient-cancel-provider-2",
			],
		},
	});
	expect(calls.map((call) => new URL(call.url).pathname)).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/payment/pay-query",
		"/msun-middle-open-settlepay/api/v2/open/settle/cancel-settle",
	]);
	expect(parseJsonPreservingLargeIntegers(calls[0]?.body ?? "")).toEqual({
		authSysCode: "thirdSelfMachine",
		autoSettle: 0,
		businessId: BigInt(saved.businessId),
		hospitalId: 10389001,
		payingId: BigInt(saved.payingId),
		tradeTypeCode: "2",
		workStationId: "",
	});
	expect(calls[0]?.body).toContain(`"businessId":${saved.businessId}`);
	expect(calls[0]?.body).toContain(`"payingId":${saved.payingId}`);
	expect(parseJsonPreservingLargeIntegers(calls[1]?.body ?? "")).toEqual({
		authSysCode: "thirdSelfMachine",
		businessId: BigInt(saved.businessId),
		tradeTypeCode: "2",
		workStationId: "",
	});
	expect(calls[0]?.headers.get("authorization")).toBe(
		"Bearer private-server-token",
	);
	expect(calls[0]?.headers.get("idempotency-key")).not.toContain(
		saved.businessId,
	);
});

for (const code of [3, "3"]) {
	test(`查单明确已支付 ${code} 不撤销原结算`, async () => {
		const { gateway, calls } = harness([query(code, { code })]);
		expect(await gateway.cancel(input, context)).toMatchObject({
			state: "paid",
			providerStatus: "payment_paid",
		});
		expect(calls).toHaveLength(1);
	});
}
for (const code of [
	0,
	1,
	2,
	4,
	6,
	"2",
	"05",
	"FAILED",
	null,
	true,
	undefined,
]) {
	test(`未明确失败的支付状态 ${String(code)} 保留待确认且不发 .6`, async () => {
		const { gateway, calls } = harness([query(code, { code })]);
		expect((await gateway.cancel(input, context)).state).toBe(
			"awaiting_confirmation",
		);
		expect(calls).toHaveLength(1);
	});
}

for (const [label, reply] of [
	[
		"外层拒绝",
		envelope({ success: true, code: 5, payTypeId: 5032 }, { success: false }),
	],
	[
		"外层错误码",
		envelope({ success: true, code: 5, payTypeId: 5032 }, { code: "500" }),
	],
	[
		"外层成功缺失",
		{ code: "0000", data: { success: true, code: 5, payTypeId: 5032 } },
	],
	["内层拒绝", query(5, { success: false })],
	["内层成功缺失", envelope({ code: 5, payTypeId: 5032 })],
	["错误渠道", query(5, { payTypeId: 5033 })],
	["渠道缺失", envelope({ success: true, code: 5 })],
	["数据不是对象", envelope([])],
	["查单原文不是JSON", async () => new Response("not-json")],
] as const) {
	test(`${label} 不允许取消`, async () => {
		const { gateway, calls } = harness([reply]);
		expect((await gateway.cancel(input, context)).state).toBe(
			"awaiting_confirmation",
		);
		expect(calls).toHaveLength(1);
	});
}

for (const extra of [
	{ businessId: "9000000000000000201" },
	{ payingId: "9000000000000000202" },
	{ tradingId: "9000000000000000203" },
	{ patientId: "9000000000000000204" },
	{ patId: "9000000000000000204" },
	{ hospitalId: "10389002" },
	{ payRecord: { payingId: "9000000000000000202" } },
	{ record: { businessId: "9000000000000000201" } },
	{
		payRecords: [
			{ payingId: saved.payingId },
			{ payingId: "9000000000000000202" },
		],
	},
	{ payRecords: [null] },
	{ record: [] },
]) {
	test(`查单不能使用其他主单、流水或患者的结果 ${JSON.stringify(extra)}`, async () => {
		const { gateway, calls } = harness([query(5, extra)]);
		expect((await gateway.cancel(input, context)).state).toBe(
			"awaiting_confirmation",
		);
		expect(calls).toHaveLength(1);
	});
}

test("原始响应19位Long逐位验证，不接受JS浮点数碰巧舍入相等", async () => {
	const raw = `{"success":true,"code":0,"data":{"success":true,"code":5,"payTypeId":5032,"businessId":${saved.businessId},"payingId":${saved.payingId},"tradingId":${saved.tradingId},"patientId":${saved.patientId},"hospitalId":10389001}}`;
	const { gateway, calls } = harness([
		async () => new Response(raw),
		cancelled(),
	]);
	expect((await gateway.cancel(input, context)).state).toBe("cancelled");
	expect(calls).toHaveLength(2);
});

for (const [label, reply] of [
	["首次未找到可撤销结算", cancelled({ cancelStatus: "0" })],
	["数值0", cancelled({ cancelStatus: 0 })],
	["未声明状态", envelope({})],
	["相似状态", cancelled({ cancelStatus: "01" })],
	["内层失败", cancelled({ success: false })],
	["外层失败", envelope({ cancelStatus: "1" }, { success: false })],
	["外层错误码", envelope({ cancelStatus: "1" }, { code: "FAILED" })],
	["错主单", cancelled({ businessId: "9000000000000000201" })],
	["错流水", cancelled({ payRecord: { payingId: "9000000000000000202" } })],
] as const) {
	test(`.6 ${label} 不能确认取消`, async () => {
		const { gateway, calls } = harness([query(), reply]);
		expect(await gateway.cancel(input, context)).toMatchObject({
			state: "awaiting_confirmation",
			providerStatus: "settlement_cancel_not_confirmed",
		});
		expect(calls).toHaveLength(2);
	});
}

test("兼容精确字符串支付失败状态和数值取消状态", async () => {
	const { gateway } = harness([query("5"), cancelled({ cancelStatus: 1 })]);
	expect((await gateway.cancel(input, context)).state).toBe("cancelled");
});

for (const stage of ["query", "cancel"] as const) {
	for (const reply of [
		new Error("sensitive transport details"),
		async () => new Response("sensitive upstream exception", { status: 500 }),
		async (init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			}),
	]) {
		test(`${stage} 传输失败或超时保留待确认，不做其他财务写操作`, async () => {
			const { gateway, calls } = harness(
				stage === "query" ? [reply] : [query(), reply],
			);
			expect(
				await gateway.cancel(input, { ...context, timeoutMs: 10 }),
			).toMatchObject({
				state: "awaiting_confirmation",
				providerStatus:
					stage === "query"
						? "payment_query_unavailable"
						: "settlement_cancel_unavailable",
			});
			expect(calls).toHaveLength(stage === "query" ? 1 : 2);
		});
	}
}

for (const extra of [
	{ tradeTypeCode: "10" },
	{ payTypeId: "5033" },
	{ workStationId: "other-station" },
	{ platformOrderId: "different-order" },
	{ hospitalId: "10389002" },
	{ businessId: "9000000000000000201.0" },
	{ payingId: "9223372036854775808" },
	{ payingId: "09000000000000000102" },
	{ tradingId: "9.000000000000000103e18" },
	{ patientId: "" },
	{ payingId: Number(saved.payingId) },
]) {
	test(`加密保存的原上下文不完整或不匹配时请求不出站 ${JSON.stringify(extra)}`, async () => {
		const { gateway, calls } = harness([]);
		try {
			await gateway.cancel(
				{
					...input,
					registrationContext: {
						...saved,
						...extra,
					} as RegistrationSelfPaySettlementContext,
				},
				context,
			);
			throw new Error("expected validation rejection");
		} catch (error) {
			expect(error).toBeInstanceOf(ProviderRequestError);
			expect(error).toMatchObject({
				failureStage: "validation",
				requestOutcome: "not_sent",
				retryable: false,
			});
		}
		expect(calls).toHaveLength(0);
	});
}

test("非法金额或调用链上下文不发送请求", async () => {
	const { gateway, calls } = harness([]);
	await expect(
		gateway.cancel({ ...input, totalFen: 0 }, context),
	).rejects.toBeInstanceOf(ProviderRequestError);
	await expect(
		gateway.cancel(input, { ...context, traceId: "" }),
	).rejects.toBeInstanceOf(ProviderRequestError);
	expect(calls).toHaveLength(0);
});

test("默认普通日志不包含患者、授权或结算原单号", async () => {
	const previous = Bun.env.PROVIDER_RAW_LOGGING;
	delete Bun.env.PROVIDER_RAW_LOGGING;
	try {
		const logs: object[] = [];
		const logger: ProviderRequestLogger = {
			info: (value) => {
				logs.push(value);
			},
			warn: (value) => {
				logs.push(value);
			},
			error: (value) => {
				logs.push(value);
			},
		};
		const { gateway } = harness(
			[
				query(5, { patientId: saved.patientId, message: saved.psnName }),
				cancelled({ businessId: saved.businessId, message: saved.certNo }),
			],
			logger,
		);
		expect((await gateway.cancel(input, context)).state).toBe("cancelled");
		expect(logs.length).toBeGreaterThan(0);
		const serialized = JSON.stringify(logs);
		for (const sensitive of [
			"private-server-token",
			saved.certNo,
			saved.psnName,
			saved.businessId,
			saved.payingId,
			saved.tradingId,
			saved.patientId,
			saved.outTradeNo,
			saved.recordCode,
		]) {
			if (sensitive) expect(serialized).not.toContain(sensitive);
		}
		expect(serialized).not.toContain("provider.request.raw");
		expect(serialized).not.toContain("provider.response.raw");
	} finally {
		if (previous === undefined) delete Bun.env.PROVIDER_RAW_LOGGING;
		else Bun.env.PROVIDER_RAW_LOGGING = previous;
	}
});

test("沿用受控原报文日志开关，诊断保留准确请求和返回，普通元数据仍安全", async () => {
	const previous = Bun.env.PROVIDER_RAW_LOGGING;
	Bun.env.PROVIDER_RAW_LOGGING = "1";
	try {
		const logs: Record<string, unknown>[] = [];
		const logger: ProviderRequestLogger = {
			info: (value) => {
				logs.push(value as Record<string, unknown>);
			},
			warn: (value) => {
				logs.push(value as Record<string, unknown>);
			},
			error: (value) => {
				logs.push(value as Record<string, unknown>);
			},
		};
		const { gateway } = harness([query(), cancelled()], logger);
		expect((await gateway.cancel(input, context)).state).toBe("cancelled");
		expect(
			logs.filter((log) => log.event === "provider.request.raw"),
		).toHaveLength(2);
		expect(
			logs.filter((log) => log.event === "provider.response.raw"),
		).toHaveLength(2);
		const raw = JSON.stringify(
			logs.filter((log) => log.event === "provider.request.raw"),
		);
		expect(raw).toContain(saved.businessId);
		expect(raw).toContain(saved.payingId);
		const metadata = JSON.stringify(
			logs.filter((log) => !String(log.event).endsWith(".raw")),
		);
		for (const sensitive of [
			"private-server-token",
			saved.businessId,
			saved.payingId,
			saved.patientId,
		]) {
			if (sensitive) expect(metadata).not.toContain(sensitive);
		}
	} finally {
		if (previous === undefined) delete Bun.env.PROVIDER_RAW_LOGGING;
		else Bun.env.PROVIDER_RAW_LOGGING = previous;
	}
});

for (const baseUrl of [
	"http://yunhealth.example.test",
	"https://user:pass@yunhealth.example.test",
	"https://yunhealth.example.test?token=private",
]) {
	test("无安全HTTPS配置不创建适配器", () => {
		expect(() =>
			createYunhealthOutpatientSelfPayCancellationGateway({ baseUrl }),
		).toThrow(AdapterNotConfiguredError);
	});
}
