import { afterEach, expect, test } from "bun:test";
import type { Patient } from "../types";
import {
	queryOutpatientSelfPay,
	requestOutpatientSelfPayCancellation,
	requireOutpatientSelfPayCancelResponse,
} from "./api-client";
import {
	OutpatientSelfPayCancellationPendingError,
	startOutpatientSelfPay,
} from "./outpatient-self-pay";

const RECORD = "record/opaque?original=1";
const ORDER = "order/opaque?original=1";
const PATIENT: Patient = {
	id: "patient-001",
	displayName: "测试就诊人",
	relationship: "self",
	cardNumberMasked: "12345******0001",
	source: "hospital-his",
	clinicalAccess: "ready",
};
const PREPAY = {
	recordId: RECORD,
	orderId: ORDER,
	status: "prepay_ready",
	paymentState: "cash_pending",
	totalFen: 1000,
	payParams: {
		appId: "wx-test",
		timeStamp: "1792540800",
		nonceStr: "nonce",
		package: "prepay_id=synthetic",
		signType: "MD5",
		paySign: "A".repeat(32),
	},
};
const FRESH = {
	recordId: "fresh-from-his",
	status: "unpaid",
	billDate: "2026-10-21 08:00:00",
	amountFen: 1000,
};
type Response = { statusCode: number; data: unknown };
type Request = {
	url: string;
	method: string;
	data?: unknown;
	header: Record<string, string>;
	success(value: Response): void;
	fail(value: { errMsg: string }): void;
};
type SDK = { success(): void; fail(value: { errMsg: string }): void };
type PageFixture = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	startPayment(
		method: "wechat",
		record: Record<string, unknown>,
		patientId: string,
	): Promise<void>;
	onShow(): void;
	onUnload(): void;
	loadPage(): Promise<void>;
};
const originalGlobals = new Map(
	["wx", "getApp", "Page", "setTimeout"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
afterEach(() => {
	for (const [name, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});
const ok = (data: unknown): Response => ({
	statusCode: 200,
	data: { success: true, data },
});
const cancel = (status = "cancelled", paymentState = "cancelled") => ({
	recordId: RECORD,
	orderId: ORDER,
	status,
	paymentState,
});
const path = (request: Request) => new URL(request.url).pathname;
const cancelRequests = (requests: Request[]) =>
	requests.filter((item) => path(item).endsWith("/self-pay/cancel"));
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}
let fixtureNumber = 0;
async function fixture(
	options: {
		cancellation?: Response | Promise<Response>;
		handler?: (request: Request) => Response | Promise<Response>;
		sdk?: (sdk: SDK) => void;
	} = {},
) {
	const requests: Request[] = [],
		callbacks: SDK[] = [],
		notices: string[] = [],
		redirects: string[] = [];
	let selectedPatient = PATIENT.id,
		active = true;
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "synthetic-session",
			sessionStatus: "signed_in",
			sessionGeneration: 0,
			sessionOwnerId: "owner-001",
		},
	};
	const defaults = (request: Request): Response | Promise<Response> => {
		if (path(request).endsWith("/self-pay/cancel"))
			return options.cancellation ?? ok(cancel());
		if (path(request).endsWith("/self-pay"))
			return ok(
				request.method === "POST"
					? PREPAY
					: {
							...PREPAY,
							payParams: undefined,
							status: "cash_paid",
							paymentState: "completed",
						},
			);
		if (path(request).endsWith("/me")) return ok({ user: { id: "owner-001" } });
		if (path(request).endsWith("/patients"))
			return ok({ items: [PATIENT], total: 1 });
		if (path(request).endsWith("/outpatient/records"))
			return ok({ status: "unpaid", items: [FRESH], total: 1 });
		throw new Error(
			`Unexpected synthetic request ${request.method} ${path(request)}`,
		);
	};
	Object.assign(globalThis, {
		getApp: () => app,
		wx: {
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? selectedPatient : "",
			setStorageSync: () => {},
			removeStorageSync: () => {},
			getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
			request: (request: Request) => {
				requests.push(request);
				void Promise.resolve()
					.then(() => (options.handler ?? defaults)(request))
					.then(request.success)
					.catch(() => request.fail({ errMsg: "request:fail timeout" }));
			},
			requestPayment: (sdk: SDK) => {
				callbacks.push(sdk);
				options.sdk?.(sdk);
			},
			showToast: ({ title }: { title: string }) => notices.push(title),
			redirectTo: ({ url }: { url: string }) => redirects.push(url),
		},
	});
	let definition: PageFixture | undefined;
	Object.assign(globalThis, {
		Page: (page: PageFixture) => {
			definition = page;
		},
	});
	await import(
		`../pages/outpatient-payment/outpatient-payment.ts?cancel-test-${++fixtureNumber}`
	);
	if (!definition) throw new Error("Page not registered");
	const page: PageFixture = {
		...definition,
		data: {
			...definition.data,
			selectedPatient: PATIENT,
			patientSessionGeneration: 0,
			sessionState: "valid",
			loading: false,
			hasShown: true,
			items: [{ ...FRESH, recordId: RECORD }],
			visibleItems: [{ ...FRESH, recordId: RECORD }],
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	return {
		app,
		page,
		requests,
		callbacks,
		notices,
		redirects,
		defaults,
		selectPatient: (id: string) => {
			selectedPatient = id;
		},
		deactivate: () => {
			active = false;
		},
		start: () =>
			startOutpatientSelfPay(
				RECORD,
				PATIENT.id,
				(_stage, message) => notices.push(message),
				() => active,
			),
		pageStart: () =>
			page.startPayment("wechat", { ...FRESH, recordId: RECORD }, PATIENT.id),
	};
}

test("用户明确cancel绑定原orderId提交一次取消命令，重复SDK回调和迟到success不重复取消", async () => {
	const f = await fixture();
	const action = f.start();
	await settle();
	f.callbacks[0]?.fail({ errMsg: "requestPayment:fail cancel" });
	f.callbacks[0]?.fail({ errMsg: "requestPayment:fail cancel" });
	f.callbacks[0]?.success();
	expect((await action).data as unknown).toEqual(cancel());
	expect(cancelRequests(f.requests)).toHaveLength(1);
	const request = cancelRequests(f.requests)[0];
	if (!request) throw new Error("Missing cancellation request");
	expect(path(request)).toBe(
		`/api/v2/payments/outpatient/records/${encodeURIComponent(RECORD)}/self-pay/cancel`,
	);
	expect(request?.data).toEqual({ patientId: PATIENT.id, orderId: ORDER });
	expect(request?.header["idempotency-key"]).toMatch(
		/^[A-Za-z0-9._:-]{1,128}$/u,
	);
	expect(f.requests.filter((item) => item.method === "GET")).toHaveLength(0);
});

test.each([
	"requestPayment:fail",
	"requestPayment:fail network cancel uncertain",
	"requestPayment:fail user_cancelled",
	"requestPayment:fail no permission",
])("非明确cancel的SDK失败%s不会提交医院取消", async (errMsg) => {
	const f = await fixture({ sdk: (sdk) => sdk.fail({ errMsg }) });
	await expect(f.start()).rejects.toMatchObject({
		code: "wechat-payment-launch-failed",
	});
	expect(cancelRequests(f.requests)).toHaveLength(0);
});

test("SDK超时和迟到cancel不会取消结算", async () => {
	const f = await fixture();
	let timeout!: () => void;
	const nativeTimeout = globalThis.setTimeout;
	globalThis.setTimeout = ((callback: () => void, delay?: number) => {
		if (delay === 60000) {
			timeout = callback;
			return 0;
		}
		return nativeTimeout(callback, delay);
	}) as typeof setTimeout;
	const action = f.start();
	void action.catch(() => {});
	await settle();
	timeout();
	await expect(action).rejects.toMatchObject({
		code: "payment-prepay-unknown",
	});
	f.callbacks[0]?.fail({ errMsg: "requestPayment:fail cancel" });
	await settle();
	expect(cancelRequests(f.requests)).toHaveLength(0);
});

test("正常SDK成功仍查原单并返回cash_paid，之后迟到cancel不生效", async () => {
	const f = await fixture({
		sdk: (sdk) => {
			sdk.success();
			sdk.fail({ errMsg: "requestPayment:fail cancel" });
		},
	});
	expect((await f.start()).data.status).toBe("cash_paid");
	expect(cancelRequests(f.requests)).toHaveLength(0);
	expect(f.requests.filter((item) => item.method === "GET")).toHaveLength(1);
	const query = f.requests.find((item) => item.method === "GET");
	expect(new URL(query?.url ?? "").searchParams.get("orderId")).toBe(ORDER);
});

test("持久化取消标记冻结预支付时，create待确认无payParams不再调起SDK或报参数错误", async () => {
	const f = await fixture({
		handler: () =>
			ok({ ...PREPAY, status: "awaiting_confirmation", payParams: undefined }),
	});
	expect((await f.start()).data.status).toBe("awaiting_confirmation");
	expect(f.callbacks).toHaveLength(0);
	expect(cancelRequests(f.requests)).toHaveLength(0);
	expect(f.requests).toHaveLength(1);
});

test("Page初始支付create待确认给支付状态提示，不误报取消完成或支付参数错误", async () => {
	const f = await fixture({
		handler: () =>
			ok({ ...PREPAY, status: "awaiting_confirmation", payParams: undefined }),
	});
	await f.pageStart();
	expect(f.notices).toContain("支付状态正在确认，请勿重复付款");
	expect(
		f.notices.some((message) => /已取消|参数不可用/u.test(message)),
	).toBeFalse();
	expect(f.callbacks).toHaveLength(0);
	expect(cancelRequests(f.requests)).toHaveLength(0);
	expect(f.redirects).toHaveLength(0);
});

test("支付成功查单绑定本次原orderId，不能接受同费用新attempt的响应", async () => {
	const f = await fixture({
		sdk: (sdk) => sdk.success(),
		handler: (request) =>
			ok(
				request.method === "POST"
					? PREPAY
					: {
							...PREPAY,
							orderId: "newer-attempt-order",
							status: "cash_paid",
							paymentState: "completed",
							payParams: undefined,
						},
			),
	});
	await expect(f.start()).rejects.toMatchObject({
		code: "provider-response-invalid",
	});
	expect(cancelRequests(f.requests)).toHaveLength(0);
});

test("查询接口兼容旧两参，同时拒绝无效第三参orderId", async () => {
	const f = await fixture();
	expect((await queryOutpatientSelfPay(RECORD, PATIENT.id)).data.status).toBe(
		"cash_paid",
	);
	expect(
		new URL(f.requests[0]?.url ?? "").searchParams.has("orderId"),
	).toBeFalse();
	await expect(
		queryOutpatientSelfPay(RECORD, PATIENT.id, "x".repeat(65)),
	).rejects.toThrow();
	expect(f.requests).toHaveLength(1);
});

test("绑定原订单的成功查单遇401不自动登录后重放旧患者请求", async () => {
	const f = await fixture({
		sdk: (sdk) => sdk.success(),
		handler: (request) =>
			request.method === "POST"
				? ok(PREPAY)
				: {
						statusCode: 401,
						data: { success: false, error: { code: "unauthorized" } },
					},
	});
	await expect(f.start()).rejects.toMatchObject({ code: "unauthorized" });
	expect(f.requests).toHaveLength(2);
	expect(f.requests.some((item) => path(item).includes("/auth/"))).toBeFalse();
	expect(cancelRequests(f.requests)).toHaveLength(0);
});

test("创建支付的响应到达前切换患者，不调起旧患者SDK也不取消", async () => {
	const pending = deferred<Response>();
	const f = await fixture({ handler: () => pending.promise });
	const action = f.start();
	void action.catch(() => {});
	await settle();
	f.selectPatient("patient-002");
	pending.resolve(ok(PREPAY));
	await expect(action).rejects.toMatchObject({ code: "session-changed" });
	expect(f.callbacks).toHaveLength(0);
	expect(cancelRequests(f.requests)).toHaveLength(0);
});

for (const [status, state] of [
	["awaiting_confirmation", "cash_pending"],
	["already_paid", "cash_pending"],
]) {
	test(`后端${status}按原事实返回，不伪造cancelled或completed`, async () => {
		const f = await fixture({
			cancellation: ok(cancel(status, state)),
			sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
		});
		expect((await f.start()).data as unknown).toEqual(cancel(status, state));
		expect(cancelRequests(f.requests)).toHaveLength(1);
	});
}

test.each(["timeout", "rejected", "mismatch"])(
	"取消命令%s保持待确认，既不重放也不查单或退款",
	async (failure) => {
		const f = await fixture({
			sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
			handler: (request) => {
				if (path(request).endsWith("/cancel")) {
					if (failure === "timeout") throw new Error("synthetic timeout");
					if (failure === "rejected")
						return {
							statusCode: 409,
							data: {
								success: false,
								error: {
									code: "provider-request-rejected",
									message: "untrusted provider diagnostic",
								},
							},
						};
					return ok({ ...cancel(), orderId: "other-order" });
				}
				return ok(PREPAY);
			},
		});
		await expect(f.start()).rejects.toBeInstanceOf(
			OutpatientSelfPayCancellationPendingError,
		);
		expect(cancelRequests(f.requests)).toHaveLength(1);
		expect(f.requests).toHaveLength(2);
	},
);

for (const change of ["patient", "session", "page"] as const) {
	test(`SDK取消前${change}变化不发送陈旧取消命令`, async () => {
		const f = await fixture();
		const action = f.start();
		void action.catch(() => {});
		await settle();
		if (change === "patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "page") f.deactivate();
		f.callbacks[0]?.fail({ errMsg: "requestPayment:fail cancel" });
		await expect(action).rejects.toMatchObject({ code: "session-changed" });
		expect(cancelRequests(f.requests)).toHaveLength(0);
	});
	test(`取消响应在途时${change}变化丢弃旧结果`, async () => {
		const pending = deferred<Response>();
		const f = await fixture({
			cancellation: pending.promise,
			sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
		});
		const action = f.start();
		void action.catch(() => {});
		await settle();
		if (change === "patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "page") f.deactivate();
		pending.resolve(ok(cancel()));
		await expect(action).rejects.toMatchObject({ code: "session-changed" });
		expect(cancelRequests(f.requests)).toHaveLength(1);
	});
}

test("Page等待后端取消确认且onShow不清空费用，确认后只从真实列表响应刷新", async () => {
	const pending = deferred<Response>();
	const f = await fixture({
		cancellation: pending.promise,
		sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
	});
	const action = f.pageStart();
	await settle();
	f.page.onShow();
	await settle();
	expect((f.page.data.items as Array<{ recordId: string }>)[0]?.recordId).toBe(
		RECORD,
	);
	expect(f.requests).toHaveLength(2);
	expect(f.notices.some((message) => message.includes("已取消"))).toBeFalse();
	pending.resolve(ok(cancel()));
	await action;
	await settle();
	expect(f.notices).toContain("本次结算已取消，正在刷新待缴费记录");
	expect((f.page.data.items as Array<{ recordId: string }>)[0]?.recordId).toBe(
		FRESH.recordId,
	);
	const reads = f.requests.filter((item) =>
		path(item).endsWith("/outpatient/records"),
	);
	expect(reads).toHaveLength(1);
	expect(new URL(reads[0]?.url ?? "").searchParams.get("patientId")).toBe(
		PATIENT.id,
	);
	expect(f.redirects).toHaveLength(0);
});

test.each(["pending", "paid", "failure"])(
	"Page取消%s只给准确提示，不刷新成已取消也不跳成功页",
	async (outcome) => {
		const cancellation =
			outcome === "failure"
				? {
						statusCode: 409,
						data: {
							success: false,
							error: { code: "provider-request-rejected" },
						},
					}
				: ok(
						cancel(
							outcome === "paid" ? "already_paid" : "awaiting_confirmation",
							"cash_pending",
						),
					);
		const f = await fixture({
			cancellation,
			sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
		});
		await f.pageStart();
		expect(f.notices).toContain(
			outcome === "paid"
				? "医院已有支付记录，请先核对，请勿重复付款"
				: "取消状态正在确认，请勿重复付款",
		);
		expect(
			(f.page.data.items as Array<{ recordId: string }>)[0]?.recordId,
		).toBe(RECORD);
		expect(f.redirects).toHaveLength(0);
		expect(f.requests).toHaveLength(2);
		expect(f.page.data.paymentBusy).toBe("");
	},
);

test("Page普通支付成功仍进入原订单结果页且没有取消请求", async () => {
	const f = await fixture({ sdk: (sdk) => sdk.success() });
	await f.pageStart();
	expect(cancelRequests(f.requests)).toHaveLength(0);
	expect(f.redirects).toHaveLength(1);
	expect(
		new URL(f.redirects[0] ?? "", "https://mini.example.test").searchParams.get(
			"orderId",
		),
	).toBe(ORDER);
});

for (const change of ["patient", "session", "unload"] as const) {
	test(`Page取消SDK回调前${change}变化不发取消、不刷新旧患者`, async () => {
		const f = await fixture();
		const action = f.pageStart();
		await settle();
		if (change === "patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "unload") f.page.onUnload();
		const before = f.notices.length;
		f.callbacks[0]?.fail({ errMsg: "requestPayment:fail cancel" });
		await action;
		expect(cancelRequests(f.requests)).toHaveLength(0);
		expect(f.notices).toHaveLength(before);
		expect(f.redirects).toHaveLength(0);
	});
	test(`Page取消后端响应前${change}变化不显示已取消或读取旧患者列表`, async () => {
		const pending = deferred<Response>();
		const f = await fixture({
			cancellation: pending.promise,
			sdk: (sdk) => sdk.fail({ errMsg: "requestPayment:fail cancel" }),
		});
		const action = f.pageStart();
		await settle();
		if (change === "patient") f.selectPatient("patient-002");
		if (change === "session") f.app.globalData.sessionGeneration++;
		if (change === "unload") f.page.onUnload();
		const before = f.notices.length;
		pending.resolve(ok(cancel()));
		await action;
		expect(f.requests).toHaveLength(2);
		expect(f.notices).toHaveLength(before);
		expect(f.redirects).toHaveLength(0);
	});
}

test("取消响应严格绑定原引用和状态，只投影白名单字段", () => {
	const payload = {
		success: true,
		data: {
			...cancel(),
			patientName: "must-drop",
			providerId: "must-drop",
			payParams: {},
		},
	};
	expect(
		requireOutpatientSelfPayCancelResponse(payload, RECORD, ORDER) as unknown,
	).toEqual(ok(cancel()).data);
	for (const invalid of [
		null,
		{},
		{ success: false, data: cancel() },
		{ success: true, data: { ...cancel(), recordId: "other" } },
		{ success: true, data: { ...cancel(), orderId: "other" } },
		{ success: true, data: cancel("cancelled", "cash_pending") },
		{ success: true, data: cancel("already_paid", "cancelled") },
		{ success: true, data: cancel("awaiting_confirmation", "completed") },
		{ success: true, data: cancel("cancelled", "not-real") },
	]) {
		expect(() =>
			requireOutpatientSelfPayCancelResponse(invalid, RECORD, ORDER),
		).toThrow();
	}
});

test("取消API在网络前拒绝无效引用、幂等键和旧会话，不自动登录", async () => {
	const f = await fixture();
	for (const [input, key, generation] of [
		[{ recordId: RECORD, patientId: "", orderId: ORDER }, "cancel-key", 0],
		[
			{ recordId: RECORD, patientId: PATIENT.id, orderId: "x".repeat(65) },
			"cancel-key",
			0,
		],
		[
			{ recordId: RECORD, patientId: PATIENT.id, orderId: ORDER },
			"invalid key",
			0,
		],
		[
			{ recordId: RECORD, patientId: PATIENT.id, orderId: ORDER },
			"cancel-key",
			1,
		],
	] as const) {
		await expect(
			requestOutpatientSelfPayCancellation(input, key, generation),
		).rejects.toThrow();
	}
	expect(f.requests).toHaveLength(0);
});
