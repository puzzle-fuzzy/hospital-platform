import { expect, test } from "bun:test";
import type {
	OutpatientSelfPayCancellationGateway,
	RegistrationSelfPaySettlementContext,
} from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import { createInMemoryPaymentOrderRepository } from "@hospital/persistence";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "../../plugins/error-handler";
import {
	createOutpatientPaidRecordSnapshotResolver,
	outpatientPaymentsModule,
} from "./index";
import { OutpatientSelfPayService } from "./self-pay-service";

const ownerUserId = "cancel-owner";
const patientId = "cancel-patient";
const recordId = "cancel-record";
const context = { traceId: "cancel-trace", idempotencyKey: "cancel-key" };
const input = { ownerUserId, patientId, recordId, context };

function gate() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture() {
	const repository = createInMemoryPaymentOrderRepository();
	let sequence = 0;
	const orders = new PaymentOrderService({
		orders: repository,
		createOrderId: () => `cancel-order-${++sequence}`,
	});
	const contexts = new Map<string, RegistrationSelfPaySettlementContext>();
	const calls = { prepare: 0, records: 0, cancel: 0, complete: 0 };
	let onCancel: OutpatientSelfPayCancellationGateway["cancel"] = async ({
		registrationContext,
	}) => ({
		state: "cancelled",
		providerStatus: "cancelled",
		trace: {
			provider: "yunhealth",
			operation: "outpatient-self-pay.cancellation",
			requestId: "cancel-provider-request",
			providerOrderId: registrationContext.businessId,
		},
	});
	let onComplete = async () => {
		throw new Error("payment not confirmed");
	};
	const dependencies: ConstructorParameters<
		typeof OutpatientSelfPayService
	>[0] = {
		paymentOrders: orders,
		patients: {
			resolveProviderReference: async () => ({
				patientId,
				provider: "zhongyang",
				providerPatientId: "provider-patient",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				userId: ownerUserId,
				unionId: "fixture-union",
				providerSubject: "fixture-openid",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					providerPatientId: "provider-patient",
					name: "虚构患者",
					cardNo: "FIXTURE",
					idNo: "fixture-id",
					phone: "fixture-phone",
				},
				trace: {
					provider: "zhongyang",
					operation: "appointment-patient-profile",
					requestId: "profile-request",
				},
			}),
		},
		outpatientPayments: {
			listRecords: async () => ({
				records: [],
				trace: {
					provider: "zhongyang",
					operation: "outpatient-payment-records",
					requestId: "records-request",
				},
			}),
			resolvePaymentContext: async ({ recordId: requestedRecordId }) => {
				calls.records++;
				return {
					recordId: requestedRecordId,
					record: {
						recordId: requestedRecordId,
						status: "unpaid",
						billDate: "2026-10-21 10:00:00",
						amountFen: 2137,
					},
					providerPatientId: "provider-patient",
					outTradeOrderIds: ["original-bill"],
					totalFen: 2137,
					trace: {
						provider: "zhongyang",
						operation: "outpatient-payment-context",
						requestId: "context-request",
					},
				};
			},
		},
		preparation: {
			prepare: async ({ orderId }) => {
				calls.prepare++;
				return {
					registrationContext: {
						businessId: `business-${orderId}`,
						payingId: `paying-${orderId}`,
						tradingId: `trading-${orderId}`,
						tradeTypeCode: "2",
						payTypeId: "5032",
						payParams: {
							appId: "wx-fixture",
							timeStamp: "1",
							nonceStr: "fixture",
							package: `prepay_id=${orderId}`,
							signType: "MD5",
							paySign: "fixture-sign",
						},
					},
					trace: {
						provider: "yunhealth",
						operation: "outpatient-self-pay.2.6.65.2",
						requestId: "prepare-request",
					},
				};
			},
		},
		hospitalSettlement: {
			writeBack: async () => {
				calls.complete++;
				await onComplete();
				return {
					provider: "yunhealth",
					operation: "outpatient-self-pay.2.6.65.5",
					requestId: "complete-request",
				};
			},
		},
		cancellation: {
			cancel: async (...args) => {
				calls.cancel++;
				return onCancel(...args);
			},
		},
		saveContext: async (_owner, id, saved) => {
			contexts.set(id, structuredClone(saved));
		},
		getContext: async (_owner, id) => {
			const saved = contexts.get(id);
			return saved ? structuredClone(saved) : undefined;
		},
	};
	const service = new OutpatientSelfPayService(dependencies);
	return {
		repository,
		orders,
		contexts,
		calls,
		dependencies,
		service,
		setCancel: (value: typeof onCancel) => {
			onCancel = value;
		},
		setComplete: (value: () => Promise<void>) => {
			onComplete = value as typeof onComplete;
		},
	};
}

test("明确撤销后按原订单幂等重放；再次支付使用新的主单、预单及平台订单", async () => {
	const f = fixture();
	const first = await f.service.create(input);
	f.setCancel(async ({ orderId, registrationContext }) => {
		expect(f.contexts.get(orderId)?.outpatientCancellation?.state).toBe(
			"requested",
		);
		expect(registrationContext.payingId).toBe(`paying-${first.orderId}`);
		return {
			state: "cancelled",
			providerStatus: "cancelled",
			trace: {
				provider: "yunhealth",
				operation: "outpatient-self-pay.cancellation",
				requestId: "cancel-request",
			},
		};
	});
	expect(
		await f.service.cancel({ ...input, orderId: first.orderId }),
	).toMatchObject({ status: "cancelled", paymentState: "cancelled" });
	expect(
		await f.service.cancel({ ...input, orderId: first.orderId }),
	).toMatchObject({ status: "cancelled" });
	expect(f.calls.cancel).toBe(1);
	const second = await f.service.create(input);
	expect(second.status).toBe("prepay_ready");
	expect(second.orderId).not.toBe(first.orderId);
	expect(second.payParams?.package).not.toBe(first.payParams?.package);
	expect(
		(await f.orders.get(ownerUserId, second.orderId)).idempotencyKey,
	).toStartWith("outpatient-self-pay:retry:");
	expect(f.calls.prepare).toBe(2);
	expect(f.calls.records).toBe(2);
	expect(
		(await f.service.query({ ...input, orderId: first.orderId })).paymentState,
	).toBe("cancelled");
	expect(
		(await f.service.cancel({ ...input, orderId: first.orderId })).status,
	).toBe("cancelled");
	expect((await f.orders.get(ownerUserId, second.orderId)).state).toBe(
		"cash_pending",
	);
	expect(f.calls.complete).toBe(0);
	const snapshotResolver = createOutpatientPaidRecordSnapshotResolver({
		paymentOrders: {
			findByOwnerAndIdempotencyKey: repositoryLookup(f),
			getRegistrationSelfPayContext: f.dependencies.getContext,
		},
		medicalInsuranceOrders: {},
	} as never);
	await f.orders.transition(ownerUserId, second.orderId, "cash_paid");
	expect(
		await snapshotResolver({ ownerUserId, patientId, recordId }),
	).toMatchObject({ recordId, amountFen: 2137 });
});

function repositoryLookup(f: ReturnType<typeof fixture>) {
	return (owner: string, key: string) =>
		f.orders.findByOwnerAndIdempotencyKey(owner, key);
}

test.each(["awaiting_confirmation", "paid", "throws", "bad-trace"])(
	"%s 结果保留原订单并永久阻止旧参数与盲目完成结算",
	async (scenario) => {
		const f = fixture();
		const first = await f.service.create(input);
		f.setCancel(async () => {
			if (scenario === "throws") throw new Error("private upstream error");
			return {
				state:
					scenario === "paid"
						? "paid"
						: scenario === "bad-trace"
							? "cancelled"
							: "awaiting_confirmation",
				providerStatus: "pending",
				trace: {
					provider: scenario === "bad-trace" ? "wrong-provider" : "yunhealth",
					operation: "outpatient-self-pay.cancellation",
					requestId: "cancel-request",
				},
			};
		});
		const result = await f.service.cancel({ ...input, orderId: first.orderId });
		expect(result.status).toBe(
			scenario === "paid" ? "already_paid" : "awaiting_confirmation",
		);
		expect(result.paymentState).toBe("cash_pending");
		expect((await f.service.create(input)).status).toBe(
			"awaiting_confirmation",
		);
		expect(await f.service.create(input)).not.toHaveProperty("payParams");
		expect(
			(await f.service.query({ ...input, orderId: first.orderId })).status,
		).toBe("awaiting_confirmation");
		expect(f.calls.complete).toBe(0);
		expect(f.calls.prepare).toBe(1);
		expect((await f.orders.get(ownerUserId, first.orderId)).state).toBe(
			"cash_pending",
		);
	},
);

test("原owner、患者、费用、orderId全部必须匹配，不能按外来订单取消", async () => {
	const f = fixture();
	const first = await f.service.create(input);
	for (const wrong of [
		{ ownerUserId: "other-owner" },
		{ patientId: "other-patient" },
		{ recordId: "other-record" },
		{ orderId: "other-order" },
	]) {
		await expect(
			f.service.cancel({ ...input, orderId: first.orderId, ...wrong }),
		).rejects.toThrow("unavailable");
	}
	expect(f.calls.cancel).toBe(0);
	expect((await f.orders.get(ownerUserId, first.orderId)).state).toBe(
		"cash_pending",
	);
});

test.each(["cash_paid", "his_written_back", "completed"] as const)(
	"本地%s直接报告已支付，不调用任何撤销或完成结算接口",
	async (state) => {
		const f = fixture();
		const first = await f.service.create(input);
		await f.orders.transition(ownerUserId, first.orderId, "cash_paid");
		if (state !== "cash_paid")
			await f.orders.transition(ownerUserId, first.orderId, "his_written_back");
		if (state === "completed")
			await f.orders.transition(ownerUserId, first.orderId, "completed");
		expect(
			await f.service.cancel({ ...input, orderId: first.orderId }),
		).toMatchObject({ status: "already_paid", paymentState: state });
		expect(f.calls.cancel).toBe(0);
		expect(f.calls.complete).toBe(0);
	},
);

test("取消先获锁时查询/继续支付不能进入.5；锁释放后持久化标记继续阻断", async () => {
	const f = fixture(),
		entered = gate(),
		finish = gate();
	const first = await f.service.create(input);
	f.setCancel(async () => {
		entered.resolve();
		await finish.promise;
		return {
			state: "awaiting_confirmation",
			providerStatus: "pending",
			trace: {
				provider: "yunhealth",
				operation: "outpatient-self-pay.cancellation",
				requestId: "pending-request",
			},
		};
	});
	const cancelling = f.service.cancel({ ...input, orderId: first.orderId });
	await entered.promise;
	await expect(
		f.service.query({ ...input, orderId: first.orderId }),
	).rejects.toMatchObject({ name: "PaymentIdempotencyConflictError" });
	await expect(f.service.create(input)).rejects.toMatchObject({
		name: "PaymentIdempotencyConflictError",
	});
	expect(f.calls.complete).toBe(0);
	finish.resolve();
	await cancelling;
	await f.service.query(input);
	expect(await f.service.create(input)).not.toHaveProperty("payParams");
	expect(f.calls.complete).toBe(0);
});

test("支付确认先获锁时取消不能越过支付竞态；确认已付后再取消也不会撤销或退款", async () => {
	const f = fixture(),
		entered = gate(),
		finish = gate();
	const first = await f.service.create(input);
	f.setComplete(async () => {
		entered.resolve();
		await finish.promise;
	});
	const query = f.service.query({ ...input, orderId: first.orderId });
	await entered.promise;
	await expect(
		f.service.cancel({ ...input, orderId: first.orderId }),
	).rejects.toMatchObject({ name: "PaymentIdempotencyConflictError" });
	finish.resolve();
	expect((await query).status).toBe("cash_paid");
	expect(
		(await f.service.cancel({ ...input, orderId: first.orderId })).status,
	).toBe("already_paid");
	expect(f.calls.cancel).toBe(0);
});

test("上下文丢失与取消依赖缺失均不能让旧订单继续预下单", async () => {
	for (const kind of ["context", "gateway"]) {
		const f = fixture();
		const first = await f.service.create(input);
		if (kind === "context") f.contexts.delete(first.orderId);
		else delete f.dependencies.cancellation;
		if (kind === "gateway")
			await expect(
				f.service.cancel({ ...input, orderId: first.orderId }),
			).rejects.toMatchObject({ name: "DependencyNotConfiguredError" });
		else
			expect(
				(await f.service.cancel({ ...input, orderId: first.orderId })).status,
			).toBe("awaiting_confirmation");
		expect((await f.service.create(input)).status).toBe(
			"awaiting_confirmation",
		);
		await f.service.query(input);
		expect(f.calls.complete).toBe(0);
		expect(f.calls.cancel).toBe(0);
		expect(f.calls.prepare).toBe(1);
	}
});

test(".6已确认但本地迁移未完成只恢复本地取消，不再调用Provider", async () => {
	const f = fixture();
	const first = await f.service.create(input);
	const saved = f.contexts.get(first.orderId);
	if (!saved) throw new Error("fixture context unavailable");
	f.contexts.set(first.orderId, {
		...saved,
		outpatientCancellation: {
			state: "cancelled",
			requestedAt: "2026-10-21T02:00:00.000Z",
		},
	});
	expect(
		(await f.service.cancel({ ...input, orderId: first.orderId })).status,
	).toBe("cancelled");
	expect(f.calls.cancel).toBe(0);
});

test("缺少分布式业务锁必须在任何Provider前失败", async () => {
	const f = fixture();
	delete f.repository.withBusinessOperationLock;
	await expect(f.service.create(input)).rejects.toMatchObject({
		name: "DependencyNotConfiguredError",
	});
	expect(f.calls.records).toBe(0);
	expect(f.calls.prepare).toBe(0);
});

test("连续取消沿正确尝试链前进，错误历史凭据不能创建新尝试", async () => {
	const f = fixture();
	const ids: string[] = [];
	for (let index = 0; index < 3; index++) {
		const created = await f.service.create(input);
		ids.push(created.orderId);
		await f.service.cancel({ ...input, orderId: created.orderId });
	}
	expect(new Set(ids).size).toBe(3);
	const latest = ids[2];
	if (!latest) throw new Error("fixture order unavailable");
	expect((await f.service.query(input)).orderId).toBe(latest);
	expect(f.calls.complete).toBe(0);
	const first = ids[0];
	if (!first) throw new Error("fixture order unavailable");
	const saved = f.contexts.get(first);
	if (!saved) throw new Error("fixture context unavailable");
	f.contexts.set(first, {
		...saved,
		outpatientCancellation: {
			state: "awaiting_confirmation",
			requestedAt: "2026-10-21T02:00:00.000Z",
		},
	});
	await expect(f.service.create(input)).rejects.toThrow("撤销尚未确认");
	expect(f.calls.prepare).toBe(3);
});

test("内部retry命名空间不能作为记录别名绕过同一订单的业务锁", async () => {
	const f = fixture();
	const first = await f.service.create(input);
	await f.service.cancel({ ...input, orderId: first.orderId });
	const second = await f.service.create(input);
	const order = await f.orders.get(ownerUserId, second.orderId);
	const alias = order.idempotencyKey.slice("outpatient-self-pay:".length);
	expect(alias).toStartWith("retry:");
	const beforeCalls = { ...f.calls };
	const beforeContext = structuredClone(f.contexts.get(second.orderId));
	const originalLock = f.repository.withBusinessOperationLock;
	if (!originalLock) throw new Error("fixture lock unavailable");
	let lockCalls = 0;
	f.repository.withBusinessOperationLock = async (owner, key, operation) => {
		lockCalls++;
		return originalLock(owner, key, operation);
	};
	await expect(f.service.create({ ...input, recordId: alias })).rejects.toThrow(
		"record is unavailable",
	);
	await expect(
		f.service.query({ ...input, recordId: alias, orderId: second.orderId }),
	).rejects.toThrow("record is unavailable");
	await expect(
		f.service.cancel({ ...input, recordId: alias, orderId: second.orderId }),
	).rejects.toThrow("record is unavailable");
	const app = new Elysia().use(errorHandlerPlugin()).use(
		outpatientPaymentsModule(
			{} as never,
			{
				issue: async () => ({ accessToken: "fixture", expiresInSeconds: 60 }),
				verify: async () => ({ userId: ownerUserId }),
			},
			f.service,
		),
	);
	const base = `http://localhost/payments/outpatient/records/${encodeURIComponent(alias)}/self-pay`;
	for (const [method, url, body] of [
		["POST", base, { patientId }],
		[
			"GET",
			`${base}?patientId=${patientId}&orderId=${second.orderId}`,
			undefined,
		],
		["POST", `${base}/cancel`, { patientId, orderId: second.orderId }],
	] as const) {
		const response = await app.handle(
			new Request(url, {
				method,
				headers: {
					authorization: "Bearer fixture",
					"content-type": "application/json",
					"idempotency-key": "alias-request",
				},
				...(body ? { body: JSON.stringify(body) } : {}),
			}),
		);
		expect(response.status).toBe(400);
	}
	expect(lockCalls).toBe(0);
	expect(f.calls).toEqual(beforeCalls);
	expect(f.contexts.get(second.orderId)).toEqual(beforeContext);
	expect(await f.orders.get(ownerUserId, second.orderId)).toEqual(order);
});

test("不同费用的取消不被另一笔处理中费用的锁阻塞", async () => {
	const f = fixture(),
		entered = gate(),
		finish = gate();
	const first = await f.service.create(input);
	const otherInput = { ...input, recordId: "another-record" };
	const second = await f.service.create(otherInput);
	f.setCancel(async ({ orderId }) => {
		if (orderId === first.orderId) {
			entered.resolve();
			await finish.promise;
		}
		return {
			state: "awaiting_confirmation",
			providerStatus: "pending",
			trace: {
				provider: "yunhealth",
				operation: "outpatient-self-pay.cancellation",
				requestId: "pending-request",
			},
		};
	});
	const pending = f.service.cancel({ ...input, orderId: first.orderId });
	await entered.promise;
	expect(
		(await f.service.cancel({ ...otherInput, orderId: second.orderId })).status,
	).toBe("awaiting_confirmation");
	finish.resolve();
	await pending;
	expect(f.calls.cancel).toBe(2);
});

test.each(["paid", "awaiting_confirmation"] as const)(
	"真实HTTP保留%s以及原cash_pending状态，不伪造成功支付或撤销",
	async (state) => {
		const f = fixture();
		const first = await f.service.create(input);
		f.setCancel(async () => ({
			state,
			providerStatus: "pending",
			trace: {
				provider: "yunhealth",
				operation: "outpatient-self-pay.cancellation",
				requestId: "http-pending-request",
			},
		}));
		const app = new Elysia().use(errorHandlerPlugin()).use(
			outpatientPaymentsModule(
				{} as never,
				{
					issue: async () => ({
						accessToken: "fixture",
						expiresInSeconds: 60,
					}),
					verify: async () => ({ userId: ownerUserId }),
				},
				f.service,
			),
		);
		const response = await app.handle(
			new Request(
				`http://localhost/payments/outpatient/records/${recordId}/self-pay/cancel`,
				{
					method: "POST",
					headers: {
						authorization: "Bearer fixture",
						"content-type": "application/json",
						"idempotency-key": "http-pending",
					},
					body: JSON.stringify({ patientId, orderId: first.orderId }),
				},
			),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			success: true,
			data: {
				recordId,
				orderId: first.orderId,
				status: state === "paid" ? "already_paid" : state,
				paymentState: "cash_pending",
			},
		});
		expect(f.calls.complete).toBe(0);
	},
);

test("真实HTTP取消路由要求登录、幂等头和原订单引用；响应只保留公开字段", async () => {
	const f = fixture();
	const first = await f.service.create(input);
	const app = new Elysia().use(errorHandlerPlugin()).use(
		outpatientPaymentsModule(
			{} as never,
			{
				issue: async () => ({ accessToken: "fixture", expiresInSeconds: 60 }),
				verify: async () => ({ userId: ownerUserId }),
			},
			f.service,
		),
	);
	const url = `http://localhost/payments/outpatient/records/${recordId}/self-pay/cancel`;
	const request = (
		authorization: boolean,
		idempotency: boolean,
		body: unknown,
	) =>
		app.handle(
			new Request(url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(authorization ? { authorization: "Bearer fixture" } : {}),
					...(idempotency ? { "idempotency-key": "cancel-http" } : {}),
				},
				body: JSON.stringify(body),
			}),
		);
	expect(
		(await request(false, true, { patientId, orderId: first.orderId })).status,
	).toBe(401);
	expect(
		(await request(true, false, { patientId, orderId: first.orderId })).status,
	).toBe(400);
	expect((await request(true, true, { patientId })).status).toBe(400);
	expect(f.calls.cancel).toBe(0);
	const response = await request(true, true, {
		patientId,
		orderId: first.orderId,
	});
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		success: true,
		data: {
			recordId,
			orderId: first.orderId,
			status: "cancelled",
			paymentState: "cancelled",
		},
	});
});
