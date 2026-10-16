import { expect, spyOn, test } from "bun:test";
import {
	createYunhealthRegistrationSelfPayRefundNotificationGateway,
	ProviderRequestError,
} from "@hospital/adapters";
import {
	type PaymentOrder,
	PaymentOrderService,
	type RegistrationSelfPaySettlementContext,
	type WechatRefund,
	type WechatRefundGateway,
	type WechatRefundProviderResult,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import { AdminPaymentRefundService } from "../admin/payment-refund-service";
import { AdminWechatRefundService } from "../admin/wechat-refund-service";
import {
	RegistrationPaymentExitCancellationPendingError,
	RegistrationPaymentExitRefundContextError,
	RegistrationPaymentExitRefundPendingError,
	RegistrationPaymentExitService,
} from "./registration-payment-exit-service";
import { registrationSelfPayOrderKey } from "./registration-self-pay-service";

const context = {
	traceId: "registration-recovery",
	idempotencyKey: "recovery",
};
const appointmentId = "appointment-recovery-test";
const originalContext: RegistrationSelfPaySettlementContext = {
	businessId: "settlement-recovery-test",
	tradeTypeCode: "10",
	payingId: "100002",
	tradingId: "100003",
	hospitalId: "100001",
	patientId: "100004",
	certNo: "fixture-certificate-only",
	psnCertType: "01",
	psnName: "测试患者",
	psnNo: "fixture-person-only",
	patInHosId: "0",
	outTradeNo: "HIS-WX-ORIGINAL-TEST",
	outTradeNoSource: "yunhealth_2_6_65_2",
	recordCode: "0123456789abcdef0123456789abcdef",
	payTypeId: "5032",
	payType: "CREDIT",
	workStationId: "",
	payParams: {
		appId: "wx-test-recovery",
		timeStamp: "1700000000",
		nonceStr: "fixture-nonce",
		package: "prepay_id=fixture-recovery",
		signType: "MD5",
		paySign: "fixture-sign",
	},
};

async function fixture(
	options: {
		notifyFailures?: number;
		saveFailures?: number;
		cancelFailures?: number;
		queryFailures?: number;
		requestFailures?: number;
		missingRefundQueries?: number;
		priorRefundStatus?:
			| "requested"
			| "processing"
			| "unknown"
			| "request_failed";
		initialRefundStatus?: WechatRefundProviderResult["status"];
		contextPatch?: Partial<RegistrationSelfPaySettlementContext>;
		legacy?: boolean;
	} = {},
) {
	let currentTime = new Date("2026-10-16T04:00:00.000Z");
	const order: PaymentOrder = {
		orderId: "payment-registration-recovery",
		ownerUserId: "owner-recovery-test",
		patientId: "patient-recovery-test",
		idempotencyKey: registrationSelfPayOrderKey(appointmentId),
		amounts: { totalFen: 1000, insuranceFen: 0, cashFen: 1000 },
		state: "completed",
		version: 9,
		createdAt: currentTime.toISOString(),
		updatedAt: currentTime.toISOString(),
	};
	const orders = createInMemoryPaymentOrderRepository([order]);
	const saveContext = orders.saveRegistrationSelfPayContext;
	const getContext = orders.getRegistrationSelfPayContext;
	if (!saveContext || !getContext)
		throw new Error("Missing fixture context IO");
	if (!options.legacy)
		await saveContext(order.ownerUserId, order.orderId, {
			...originalContext,
			...options.contextPatch,
		});
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	const priorRefund: WechatRefund = {
		refundRecordId: "historical-pending-refund",
		merchantRefundNo: "RF-PO-HISTORICAL-TEST",
		source: "payment_order",
		sourceOrderId: order.orderId,
		outTradeNo: originalContext.outTradeNo ?? "",
		totalFen: 1000,
		refundFen: 1000,
		reason: "挂号预约取消退款",
		idempotencyKey: `registration-self-pay-refund:${appointmentId}`,
		status: options.priorRefundStatus ?? "requested",
		providerStatus: null,
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: null,
		successTime: null,
		lastErrorCode: null,
		version: 1,
		createdAt: currentTime.toISOString(),
		updatedAt: currentTime.toISOString(),
	};
	const refunds = createInMemoryWechatRefundRepository(
		options.priorRefundStatus ? [priorRefund] : [],
	);
	const moneyCalls: Parameters<WechatRefundGateway["requestRefund"]>[0][] = [];
	const queryCalls: string[] = [];
	const notifyCalls: {
		body: Record<string, unknown>;
		idempotencyKey: string | null;
	}[] = [];
	let cancelAttempts = 0;
	let cancelled = false;
	let providerStatus = options.initialRefundStatus ?? "SUCCESS";
	let notifyFailures = options.notifyFailures ?? 0;
	let saveFailures = options.saveFailures ?? 0;
	let cancelFailures = options.cancelFailures ?? 0;
	let queryFailures = options.queryFailures ?? 0;
	let requestFailures = options.requestFailures ?? 0;
	let missingRefundQueries = options.missingRefundQueries ?? 0;
	const providerResult = (
		input: Parameters<WechatRefundGateway["requestRefund"]>[0],
	): WechatRefundProviderResult => ({
		...input,
		status: providerStatus,
		providerRefundId: "wechat-refund-recovery-test",
		...(providerStatus === "SUCCESS"
			? { successTime: currentTime.toISOString() }
			: {}),
		trace: {
			provider: "wechat-pay",
			operation: "refund",
			requestId: "wx-test",
		},
	});
	const cash = new AdminWechatRefundService({
		refunds,
		paymentOrders: orders,
		medicalInsuranceOrders: medicalOrders,
		gateway: {
			requestRefund: async (input) => {
				moneyCalls.push(input);
				if (requestFailures-- > 0)
					throw new ProviderRequestError({
						provider: "wechat-pay",
						operation: "refund-request",
						message: "fixture request outcome unknown",
						retryable: false,
						failureStage: "transport",
						requestOutcome: "unknown",
					});
				return providerResult(input);
			},
			queryRefund: async ({ merchantRefundNo }) => {
				queryCalls.push(merchantRefundNo);
				if (queryFailures-- > 0)
					throw new Error("fixture query transport failure");
				if (missingRefundQueries-- > 0)
					throw new ProviderRequestError({
						provider: "wechat-pay",
						operation: "refund-query",
						message: "fixture verified refund not found",
						statusCode: 404,
						retryable: false,
						failureStage: "http",
						requestOutcome: "rejected",
						providerErrorCode: "RESOURCE_NOT_EXISTS",
					});
				const original = moneyCalls.find(
					(item) => item.merchantRefundNo === merchantRefundNo,
				);
				if (!original) throw new Error("Query must reuse the original refund");
				return providerResult(original);
			},
		},
		now: () => currentTime,
		createId: () => "recovery-test-ledger",
	});
	const notification =
		createYunhealthRegistrationSelfPayRefundNotificationGateway({
			baseUrl: "https://yunhealth.example.test",
			authorizationToken: "fixture-only-token",
			paymentOrgId: "100005",
			pluginPayTypeId: "5032",
			pluginPayType: "CREDIT",
			paymentSource: "1",
			workStationId: "",
			fetcher: async (_input, init) => {
				notifyCalls.push({
					body: JSON.parse(String(init?.body)) as Record<string, unknown>,
					idempotencyKey: new Headers(init?.headers).get("idempotency-key"),
				});
				return new Response(
					JSON.stringify({ success: !(notifyFailures-- > 0), data: {} }),
					{
						status: 200,
						headers: { "x-request-id": "his-notify-recovery-test" },
					},
				);
			},
		});
	const exit = new RegistrationPaymentExitService({
		appointments: {
			cancel: async () => {
				throw new Error("Paid registration must use the confirmed-refund path");
			},
			cancelAfterConfirmedSelfPayRefund: async () => {
				if (!cancelled) {
					cancelAttempts++;
					if (!options.legacy)
						expect(
							(await getContext(order.ownerUserId, order.orderId))
								?.refundWriteBack,
						).toMatchObject({
							refundFen: 1000,
							merchantRefundNo: moneyCalls[0]?.merchantRefundNo,
						});
					if (cancelFailures-- > 0)
						throw new Error("fixture hospital cancellation failure");
					cancelled = true;
				}
				return { appointmentId, status: "cancelled" as const };
			},
		} as never,
		medicalInsurance: {} as never,
		medicalInsuranceWechatPayment: {} as never,
		medicalInsuranceOrders: medicalOrders,
		paymentOrders: new PaymentOrderService({ orders }),
		wechatPrepay: {
			cancel: async () => ({ orderId: order.orderId, status: "paid" }),
		} as never,
		selfPayRefund: cash,
		selfPayRefundNotification: notification,
		resolveRegistrationContext: (input) =>
			getContext(input.ownerUserId, input.orderId),
		saveRegistrationContext: async (input) => {
			if (saveFailures-- > 0)
				throw new Error("fixture context persistence failure");
			await saveContext(
				input.ownerUserId,
				input.orderId,
				input.registrationContext,
			);
		},
		now: () => currentTime,
	});
	const admin = new AdminPaymentRefundService({
		orders: medicalOrders,
		paymentOrders: orders,
		medicalRefunds: createInMemoryMedicalInsuranceRefundRepository(),
		wechatRefunds: refunds,
		medicalService: {} as never,
		wechatService: cash,
		verifyPaymentForRefund: async () => {
			throw new Error("Not a medical order");
		},
		verifyPaymentOrder: async () => {},
		refundRegistrationPayment: (selected, selectedContext) =>
			exit.abandon({
				ownerUserId: selected.ownerUserId,
				appointmentId,
				mode: "self",
				context: selectedContext,
			}),
		now: () => currentTime,
	});
	return {
		order,
		cash,
		admin,
		exit,
		moneyCalls,
		queryCalls,
		notifyCalls,
		cancelAttempts: () => cancelAttempts,
		cancelled: () => cancelled,
		readContext: () => getContext(order.ownerUserId, order.orderId),
		readRefunds: () =>
			refunds.findBySourceAndSourceOrder?.("payment_order", order.orderId),
		advance: () => {
			currentTime = new Date(currentTime.getTime() + 61_000);
		},
		paidRefund: () => {
			providerStatus = "SUCCESS";
		},
		request: () =>
			admin.request({
				source: "payment_order",
				orderId: order.orderId,
				refundType: "ALL",
				context,
			}),
		query: () =>
			admin.query({ source: "payment_order", orderId: order.orderId, context }),
	};
}

test("普通微信挂号首次全额原路退款、医院回写和取消均确认才返回 completed", async () => {
	const f = await fixture();
	expect(await f.request()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
		wechatRefund: { status: "success", refundFen: 1000 },
	});
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.notifyCalls).toHaveLength(1);
	expect(f.cancelled()).toBe(true);
	expect(f.cancelAttempts()).toBe(1);
});

test("微信全额成功后医院回写失败，查询仅恢复原回写和取消，不再退一次钱", async () => {
	const f = await fixture({ notifyFailures: 1 });
	expect(await f.request()).toMatchObject({
		status: "processing",
		registrationRefundStage: "hospital_writeback_pending",
		wechatRefund: { status: "success" },
	});
	expect(f.cancelled()).toBe(false);
	expect(f.cancelAttempts()).toBe(0);
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.moneyCalls[0]).toMatchObject({
		outTradeNo: originalContext.outTradeNo,
		totalFen: 1000,
		refundFen: 1000,
	});
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.cancelled()).toBe(true);
	expect(f.cancelAttempts()).toBe(1);
	expect(f.notifyCalls).toHaveLength(2);
	const [firstNotification, secondNotification] = f.notifyCalls;
	if (!firstNotification || !secondNotification)
		throw new Error("Expected original write-back and its recovery");
	const { nonce: _firstNonce, ...firstBody } = firstNotification.body;
	const { nonce: _secondNonce, ...secondBody } = secondNotification.body;
	expect(secondBody).toEqual(firstBody);
	expect(f.notifyCalls[1]?.idempotencyKey).toBe(
		f.notifyCalls[0]?.idempotencyKey,
	);
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.queryCalls).toHaveLength(0);
	expect(f.notifyCalls).toHaveLength(2);
	expect(f.cancelAttempts()).toBe(1);
	expect(await f.readRefunds()).toHaveLength(1);
});

test("医院回写成功而取消失败时返回取消待恢复；重试复用成功台账与回写凭据", async () => {
	const f = await fixture({ cancelFailures: 1 });
	expect(await f.request()).toMatchObject({
		status: "processing",
		registrationRefundStage: "appointment_cancellation_pending",
		wechatRefund: { status: "success" },
	});
	expect(f.cancelled()).toBe(false);
	const confirmedWriteback = (await f.readContext())?.refundWriteBack;
	expect(confirmedWriteback?.refundFen).toBe(1000);
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.notifyCalls).toHaveLength(1);
	expect(f.queryCalls).toHaveLength(0);
	expect(f.cancelAttempts()).toBe(2);
	expect((await f.readContext())?.refundWriteBack).toEqual(confirmedWriteback);
});

test("微信处理中与查单异常均保留预约，随后仅查原退款号再回写取消", async () => {
	const f = await fixture({
		initialRefundStatus: "PROCESSING",
		queryFailures: 1,
	});
	expect(await f.request()).toMatchObject({
		status: "processing",
		registrationRefundStage: "wechat_refund_pending",
	});
	f.advance();
	expect(await f.query()).toMatchObject({
		status: "processing",
		registrationRefundStage: "wechat_refund_pending",
	});
	expect(f.notifyCalls).toHaveLength(0);
	expect(f.cancelAttempts()).toBe(0);
	expect(f.moneyCalls).toHaveLength(1);
	f.paidRefund();
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(1);
	const originalRefund = f.moneyCalls[0];
	if (!originalRefund) throw new Error("Expected the original refund request");
	expect(new Set(f.queryCalls)).toEqual(
		new Set([originalRefund.merchantRefundNo]),
	);
	expect(f.notifyCalls).toHaveLength(1);
	expect(f.cancelAttempts()).toBe(1);
});

test("患者取消入口的原退款查单异常保持 pending，不解释为确定失败", async () => {
	for (const options of [
		{ initialRefundStatus: "PROCESSING" as const, queryFailures: 1 },
		{ requestFailures: 1, queryFailures: 1 },
	]) {
		const f = await fixture(options);
		const command = {
			ownerUserId: f.order.ownerUserId,
			appointmentId,
			mode: "self" as const,
			context,
		};
		await expect(f.exit.abandon(command)).rejects.toBeInstanceOf(
			RegistrationPaymentExitRefundPendingError,
		);
		f.advance();
		await expect(f.exit.abandon(command)).rejects.toBeInstanceOf(
			RegistrationPaymentExitRefundPendingError,
		);
		expect(f.moneyCalls).toHaveLength(1);
		expect(f.notifyCalls).toHaveLength(0);
		expect(f.cancelAttempts()).toBe(0);
	}
});

test("原退款结果未知且微信权威确认无单时，用原号原金额恢复后再完成回写和取消", async () => {
	const f = await fixture({
		requestFailures: 1,
		missingRefundQueries: 1,
		initialRefundStatus: "PROCESSING",
	});
	expect(await f.request()).toMatchObject({
		status: "processing",
		registrationRefundStage: "wechat_refund_pending",
	});
	f.advance();
	expect(await f.query()).toMatchObject({
		status: "processing",
		registrationRefundStage: "wechat_refund_pending",
	});
	expect(f.moneyCalls).toHaveLength(2);
	expect(f.moneyCalls[1]).toEqual(f.moneyCalls[0]);
	expect(await f.readRefunds()).toHaveLength(1);
	expect(f.notifyCalls).toHaveLength(0);
	expect(f.cancelAttempts()).toBe(0);
	f.paidRefund();
	// 原号恢复刚返回 PROCESSING 时仍遵守一分钟查单间隔。
	expect(await f.query()).toMatchObject({
		status: "processing",
		registrationRefundStage: "wechat_refund_pending",
	});
	f.advance();
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(2);
	expect(f.notifyCalls).toHaveLength(1);
	expect(f.cancelAttempts()).toBe(1);
});

test("有 MD5 参数但医院退费上下文缺字段时，纯校验在退款台账预留和网络之前拒绝", async () => {
	for (const contextPatch of [
		{ payTypeId: "" },
		{ recordCode: "" },
		{ hospitalId: "" },
		{ payingId: "" },
	]) {
		const f = await fixture({ contextPatch });
		await expect(f.request()).rejects.toBeInstanceOf(ProviderRequestError);
		expect(await f.readRefunds()).toHaveLength(0);
		expect(f.moneyCalls).toHaveLength(0);
		expect(f.notifyCalls).toHaveLength(0);
		expect(f.cancelAttempts()).toBe(0);
	}
});

test.each(["request_failed", "unknown"] as const)(
	"历史 MD5 商户单号等于医院业务号时拒绝恢复 %s 退款，不发送退款或取消预约",
	async (priorRefundStatus) => {
		const hospitalBusinessCode = "MZJSD-FIXTURE-ONLY";
		const f = await fixture({
			priorRefundStatus,
			missingRefundQueries: 1,
			contextPatch: {
				businessCode: hospitalBusinessCode,
				outTradeNo: hospitalBusinessCode,
			},
		});
		const trustedRefund = spyOn(f.cash, "requestTrustedPaymentOrder");
		f.advance();
		await expect(f.request()).rejects.toBeInstanceOf(
			RegistrationPaymentExitRefundContextError,
		);
		if (priorRefundStatus === "unknown")
			await expect(f.query()).rejects.toBeInstanceOf(
				RegistrationPaymentExitRefundContextError,
			);
		expect(trustedRefund).not.toHaveBeenCalled();
		expect(f.moneyCalls).toHaveLength(0);
		expect(f.queryCalls).toHaveLength(0);
		expect(f.notifyCalls).toHaveLength(0);
		expect(f.cancelAttempts()).toBe(0);
		expect(f.cancelled()).toBe(false);
		expect(await f.readRefunds()).toHaveLength(1);
		trustedRefund.mockRestore();
	},
);

test("历史 5031 商户单号与医院业务号相同仍保留原退款链路", async () => {
	const f = await fixture({
		contextPatch: {
			payTypeId: "5031",
			businessCode: originalContext.outTradeNo ?? "",
		},
	});
	expect(await f.request()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.moneyCalls[0]?.outTradeNo).toBe(originalContext.outTradeNo);
	expect(f.notifyCalls).toHaveLength(1);
	expect(
		JSON.parse(String(f.notifyCalls[0]?.body.requestParam)).recordList[0]
			.payTypeId,
	).toBe(5031);
	expect(f.cancelAttempts()).toBe(1);
});

test("Admin 查询历史 pending 退款也先校验医院上下文，缺字段时不能通过404同号恢复绕过", async () => {
	for (const priorRefundStatus of [
		"requested",
		"processing",
		"unknown",
	] as const) {
		const f = await fixture({
			priorRefundStatus,
			missingRefundQueries: 1,
			contextPatch: { payTypeId: "" },
		});
		f.advance();
		await expect(f.query()).rejects.toBeInstanceOf(ProviderRequestError);
		expect(f.moneyCalls).toHaveLength(0);
		expect(f.queryCalls).toHaveLength(0);
		expect(f.notifyCalls).toHaveLength(0);
		expect(f.cancelAttempts()).toBe(0);
		expect(await f.readRefunds()).toHaveLength(1);
	}
});

test("医院已回写但保存凭据失败时仍保持待恢复，重试同号原参且不重复退款", async () => {
	const f = await fixture({ saveFailures: 1 });
	expect(await f.request()).toMatchObject({
		status: "processing",
		registrationRefundStage: "hospital_writeback_pending",
	});
	expect(f.cancelAttempts()).toBe(0);
	expect((await f.readContext())?.refundWriteBack).toBeUndefined();
	expect(await f.query()).toMatchObject({
		status: "succeeded",
		registrationRefundStage: "completed",
	});
	expect(f.moneyCalls).toHaveLength(1);
	expect(f.notifyCalls).toHaveLength(2);
	expect(f.notifyCalls[1]?.body.recordCode).toBe(
		f.notifyCalls[0]?.body.recordCode,
	);
	expect(f.notifyCalls[1]?.body.payingId).toBe(f.notifyCalls[0]?.body.payingId);
	expect(f.notifyCalls[1]?.idempotencyKey).toBe(
		f.notifyCalls[0]?.idempotencyKey,
	);
});

test("legacy 订单没有医院退费回执时不能声明三步完成", async () => {
	const f = await fixture({ legacy: true });
	const result = await f.request();
	expect(result.status).toBe("manual_review");
	expect(result.registrationRefundStage).toBeUndefined();
	expect(result.wechatRefund?.status).toBe("success");
	expect(f.notifyCalls).toHaveLength(0);
});

test("患者入口取消待恢复返回明确 409，不能误报整体成功或医院回写未完成", async () => {
	const app = new Elysia()
		.use(errorHandlerPlugin())
		.get("/refund-cancel", () => {
			throw new RegistrationPaymentExitCancellationPendingError(true);
		});
	const response = await app.handle(
		new Request("http://localhost/refund-cancel"),
	);
	expect(response.status).toBe(409);
	expect(await response.json()).toMatchObject({
		success: false,
		error: {
			code: "appointment-refund-pending",
			message: "微信已退款、医院已回写，挂号取消待确认，请稍后查看",
		},
	});
});
