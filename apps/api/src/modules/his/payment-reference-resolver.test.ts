import { expect, test } from "bun:test";
import type {
	HisPaymentReference,
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
	WechatRefund,
} from "@hospital/domain";
import { HisPaymentReferenceConflictError } from "@hospital/domain";
import {
	createInMemoryHisPaymentReferenceRepository,
	runHisPaymentReferenceBackfill,
} from "@hospital/persistence";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { requestContextPlugin } from "../../plugins/request-context";
import { createHisPaymentReferenceResolver } from "./payment-reference-resolver";
import { hisMedicalInsuranceRefundModule, hisRefundSignature } from "./refunds";

function fixture(source: "plugin" | "component" = "component") {
	const reference: HisPaymentReference = {
		referenceId: "1",
		requestReferenceId: "1",
		receiptId: "1952638941030000004",
		status: "confirmed",
		ownerUserId: "owner-1",
		medicalOrderId: "medical-1",
		paymentScopeId:
			source === "component" ? "medical-1:wechat_cash" : "payment-1",
		source,
		createdAt: "2026-10-15T00:00:00.000Z",
	};
	const order = {
		medicalOrderId: "medical-1",
		ownerUserId: "owner-1",
		wechatPaymentState: "cash_paid",
		wechatOutTradeNo: "original-out-trade-no",
	} as MedicalInsuranceOrder;
	const context = {
		plugin: {
			paymentOrderId: "payment-1",
			state: "settled",
			outTradeNo: "original-out-trade-no",
			thirdPartPayRecordId: reference.receiptId,
		},
		postPaymentComponents: [
			{
				componentId: "medical-1:wechat_cash",
				kind: "wechat_cash",
				state: "succeeded",
				payingId: "paying-1",
				tradingId: "trading-1",
			},
		],
		selfPayThirdPartyWriteback: {
			status: "succeeded",
			thirdPartPayRecordId: reference.receiptId,
		},
	} as unknown as MedicalInsuranceSettlementContext;
	let contextReads = 0;
	const resolver = createHisPaymentReferenceResolver({
		references: {
			findByReferenceId: async (id: string) =>
				id === reference.referenceId || id === reference.receiptId
					? reference
					: undefined,
		} as never,
		orders: {
			findByMedicalOrderId: async () => order,
			getSettlementContext: async () => {
				contextReads++;
				return context;
			},
		} as never,
	});
	return {
		reference,
		order,
		context,
		resolver,
		contextReads: () => contextReads,
	};
}

for (const source of ["component", "plugin"] as const) {
	test(`HIS ${source} reference accepts generated and 19-digit receipt aliases exactly`, async () => {
		const state = fixture(source);
		const expected = {
			medicalOrderId: "medical-1",
			paymentScopeId: state.reference.paymentScopeId,
			source,
		};
		expect(await state.resolver("1")).toEqual(expected);
		expect(await state.resolver("1952638941030000004")).toEqual(expected);
	});
}

for (const invalid of [
	"",
	"0",
	"01",
	"-1",
	"1.5",
	"1e3",
	"medical-1",
	"9223372036854775808",
]) {
	test(`HIS resolver rejects invalid integer ${JSON.stringify(invalid)}`, async () => {
		const state = fixture();
		expect(await state.resolver(invalid)).toBeUndefined();
		expect(state.contextReads()).toBe(0);
	});
}

test("allocated reference and missing receipt never authorize refund lookup", async () => {
	const state = fixture();
	state.reference.status = "allocated";
	expect(await state.resolver("1")).toBeUndefined();
	state.reference.status = "confirmed";
	delete state.reference.receiptId;
	expect(await state.resolver("1")).toBeUndefined();
	expect(state.contextReads()).toBe(0);
});

test("reference must still belong to the paid original owner and payment", async () => {
	const state = fixture();
	state.order.ownerUserId = "another-owner";
	expect(await state.resolver("1")).toBeUndefined();
	state.order.ownerUserId = "owner-1";
	state.order.wechatPaymentState = "unknown";
	expect(await state.resolver("1")).toBeUndefined();
	state.order.wechatPaymentState = "cash_paid";
	state.order.wechatOutTradeNo = null;
	expect(await state.resolver("1")).toBeUndefined();
});

test("component reference rejects another scope, unknown writeback, and changed receipt", async () => {
	const state = fixture();
	state.reference.paymentScopeId = "medical-1:medical";
	expect(await state.resolver("1")).toBeUndefined();
	state.reference.paymentScopeId = "medical-1:wechat_cash";
	if (!state.context.selfPayThirdPartyWriteback)
		throw new Error("fixture writeback missing");
	state.context.selfPayThirdPartyWriteback.status = "unknown";
	expect(await state.resolver("1")).toBeUndefined();
	state.context.selfPayThirdPartyWriteback.status = "succeeded";
	state.context.selfPayThirdPartyWriteback.thirdPartPayRecordId =
		"1952638941030000005";
	expect(await state.resolver("1")).toBeUndefined();
});

test("plugin reference cannot follow replacement payment scope or out_trade_no", async () => {
	const state = fixture("plugin");
	const plugin = state.context.plugin;
	if (!plugin) throw new Error("fixture plugin missing");
	plugin.paymentOrderId = "replacement-payment";
	expect(await state.resolver("1")).toBeUndefined();
	plugin.paymentOrderId = "payment-1";
	plugin.outTradeNo = "replacement-out-trade-no";
	expect(await state.resolver("1")).toBeUndefined();
	plugin.outTradeNo = "original-out-trade-no";
	plugin.thirdPartPayAttempt = {
		attemptedAt: "2026-10-15T00:00:00.000Z",
		status: "unknown",
	};
	expect(await state.resolver("1")).toBeUndefined();
	delete plugin.thirdPartPayAttempt;
	plugin.state = "cash_paid";
	expect(await state.resolver("1")).toBeUndefined();
});

test("component reference rejects a replaced cash trade and ambiguous cash components", async () => {
	const state = fixture();
	const component = state.context.postPaymentComponents?.[0];
	if (!component) throw new Error("fixture component missing");
	component.wechatOutTradeNo = "replacement-out-trade-no";
	expect(await state.resolver("1")).toBeUndefined();
	component.wechatOutTradeNo = "original-out-trade-no";
	state.context.postPaymentComponents = [
		component,
		{ ...component, componentId: "other:wechat_cash" },
	];
	expect(await state.resolver("1")).toBeUndefined();
});

test("new cash .29 fact stays bound to the WeChat trade captured at claim time", async () => {
	const state = fixture();
	if (!state.context.selfPayThirdPartyWriteback)
		throw new Error("fixture writeback missing");
	state.context.selfPayThirdPartyWriteback.outTradeNo = "original-out-trade-no";
	expect(await state.resolver("1")).toBeDefined();
	state.order.wechatOutTradeNo = "replacement-out-trade-no";
	expect(await state.resolver("1")).toBeUndefined();
});

test("resolver rejects an internal-only alias even if a repository returns its confirmed historical scope", async () => {
	const state = fixture("plugin");
	delete state.reference.requestReferenceId;
	expect(await state.resolver("1")).toBeUndefined();
	expect(await state.resolver("1952638941030000004")).toMatchObject({
		medicalOrderId: "medical-1",
	});
});

test("a quarantined conflicting number cannot resolve any order or trigger context reads", async () => {
	let orderReads = 0;
	const resolver = createHisPaymentReferenceResolver({
		references: {
			findByReferenceId: async () => {
				throw new HisPaymentReferenceConflictError();
			},
		} as never,
		orders: {
			findByMedicalOrderId: async () => {
				orderReads++;
				throw new Error("quarantined alias must not resolve");
			},
		} as never,
	});
	expect(await resolver("1")).toBeUndefined();
	expect(orderReads).toBe(0);
});

test("historical A=2/B=1 references route to their own cash orders without synthetic internal aliases", async () => {
	const references = createInMemoryHisPaymentReferenceRepository();
	for (const [medicalOrderId, receiptId] of [
		["order-a", "2"],
		["order-b", "1"],
	]) {
		await references.confirm({
			ownerUserId: "owner-1",
			medicalOrderId: medicalOrderId as string,
			paymentScopeId: `payment-${medicalOrderId}`,
			source: "plugin",
			referenceId: receiptId as string,
		});
	}
	const resolver = createHisPaymentReferenceResolver({
		references,
		orders: {
			findByMedicalOrderId: async (medicalOrderId: string) => ({
				medicalOrderId,
				ownerUserId: "owner-1",
				wechatPaymentState: "cash_paid",
				wechatOutTradeNo: `trade-${medicalOrderId}`,
			}),
			getSettlementContext: async (_owner: string, medicalOrderId: string) => ({
				plugin: {
					paymentOrderId: `payment-${medicalOrderId}`,
					outTradeNo: `trade-${medicalOrderId}`,
					state: "settled",
					thirdPartPayRecordId: medicalOrderId === "order-a" ? "2" : "1",
				},
			}),
		} as never,
	});
	const calls: string[] = [];
	const app = new Elysia({ normalize: false })
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.use(
			hisMedicalInsuranceRefundModule(
				{
					requestFullRefundByOrder: async () => {
						throw new Error("cash id must never invoke aggregate refund");
					},
					query: async () => undefined,
				},
				{
					token: "test-token",
					hmacSecret: "test-hmac",
					resolvePaymentReference: resolver,
					security: {
						reserveNonce: async () => true,
						incrementRateLimit: async () => 1,
					},
				},
				{
					wechat: {
						requestMedicalInsuranceCashByOrder: async ({ orderId }) => {
							calls.push(orderId);
							return {
								sourceOrderId: orderId,
								merchantRefundNo: `refund-${orderId}`,
								refundFen: 10,
								status: "processing",
							} as WechatRefund;
						},
						requestMedicalInsuranceCashByOutTradeNo: async () => {
							throw new Error("unused");
						},
						query: async () => {
							throw new Error("unused");
						},
					},
				},
			),
		);
	const path = "/his/wechat-leg-refunds/by-third-part-pay-record-id";
	for (const referenceId of [1, 2]) {
		const body = { thirdPartPayRecordId: referenceId };
		const timestamp = String(Math.floor(Date.now() / 1000));
		const nonce = `historical-cash-reference-${referenceId}`;
		const requestId = `historical-refund-${referenceId}`;
		const response = await app.handle(
			new Request(`http://localhost${path}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-real-ip": "124.164.248.83",
					"x-his-refund-token": "test-token",
					"x-his-timestamp": timestamp,
					"x-his-nonce": nonce,
					"x-request-id": requestId,
					"x-his-signature": hisRefundSignature({
						method: "POST",
						path,
						timestamp,
						nonce,
						requestId,
						body,
						hmacSecret: "test-hmac",
					}),
				},
				body: JSON.stringify(body),
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			data: { orderId: referenceId === 1 ? "order-b" : "order-a" },
		});
	}
	expect(calls).toEqual(["order-b", "order-a"]);
	// 以后扫描到同号属于两笔历史支付时，apply 必须让现有数字也停止退款。
	const backfill = await runHisPaymentReferenceBackfill({
		references,
		mode: "apply",
		listOrders: async () =>
			["order-a", "order-b"].map((medicalOrderId) => ({
				medicalOrderId,
				ownerUserId: "owner-1",
				createdAt: "2026-10-15T00:00:00Z",
			})),
		getSettlementContext: async (_owner, medicalOrderId) =>
			({
				plugin: {
					paymentOrderId: `payment-${medicalOrderId}`,
					state: "settled",
					thirdPartPayRecordId: "1",
				},
			}) as unknown as MedicalInsuranceSettlementContext,
	});
	expect(backfill.conflicts).toBe(2);
	const body = { thirdPartPayRecordId: 1 };
	const timestamp = String(Math.floor(Date.now() / 1000));
	const nonce = "historical-quarantined-refund-1";
	const requestId = "historical-quarantined-request-1";
	const rejected = await app.handle(
		new Request(`http://localhost${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-real-ip": "124.164.248.83",
				"x-his-refund-token": "test-token",
				"x-his-timestamp": timestamp,
				"x-his-nonce": nonce,
				"x-request-id": requestId,
				"x-his-signature": hisRefundSignature({
					method: "POST",
					path,
					timestamp,
					nonce,
					requestId,
					body,
					hmacSecret: "test-hmac",
				}),
			},
			body: JSON.stringify(body),
		}),
	);
	expect(rejected.status).toBe(404);
	expect(calls).toEqual(["order-b", "order-a"]);
});
