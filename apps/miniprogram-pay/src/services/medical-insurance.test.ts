import { expect, test } from "bun:test";

Object.assign(globalThis, {
	MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: "test-channel-credential",
});

type CapturedRequest = {
	path: string;
	idempotencyKey: string;
	data: unknown;
};

function response(
	options: WechatMiniprogram.RequestOption,
	statusCode: number,
	data: unknown,
): void {
	options.success?.({
		errMsg: "request:ok",
		statusCode,
		data,
		header: {},
		cookies: [],
	} as unknown as WechatMiniprogram.RequestSuccessCallbackResult);
}

test("支付中关单后必须重新展码，新授权才重走 6201 和 6202", async () => {
	const storage = new Map<string, unknown>();
	const savedPending: unknown[] = [];
	const requests: CapturedRequest[] = [];
	const navigations: Array<{ appId: string; path: string }> = [];
	let authorizationCalls = 0;
	Object.assign(globalThis, {
		wx: {
			getStorageSync: (key: string) => storage.get(key),
			setStorageSync: (key: string, value: unknown) => {
				storage.set(key, value);
				if (key === "miniprogram-pay.pending-payment.v2") {
					savedPending.push(structuredClone(value));
				}
			},
			removeStorageSync: (key: string) => storage.delete(key),
			navigateToMiniProgram: (
				options: WechatMiniprogram.NavigateToMiniProgramOption,
			) => {
				navigations.push({ appId: options.appId, path: options.path ?? "" });
				options.success?.({ errMsg: "navigateToMiniProgram:ok" });
			},
			request: (options: WechatMiniprogram.RequestOption) => {
				const path = new URL(options.url).pathname.replace(/^\/api\/v2/u, "");
				const headers = options.header as Record<string, unknown>;
				requests.push({
					path,
					idempotencyKey: String(headers["Idempotency-Key"] ?? ""),
					data: options.data,
				});
				if (path.endsWith("/authorization-context")) {
					response(options, 200, { data: { payForRelatives: false } });
					return;
				}
				if (path === "/payments/medical-insurance/authorize") {
					authorizationCalls += 1;
					response(options, 200, {
						data: {
							orderId:
								authorizationCalls === 1
									? "medical-old-001"
									: "medical-replacement-001",
							status: "authorized",
						},
					});
					return;
				}
				if (
					path === "/payments/medical-insurance/orders/medical-old-001/fees"
				) {
					response(options, 409, {
						error: {
							code: "medical-insurance-payment-in-progress",
							message: "payment is already in progress",
						},
					});
					return;
				}
				if (
					path === "/payments/medical-insurance/orders/medical-old-001/cancel"
				) {
					response(options, 200, {
						data: {
							orderId: "medical-old-001",
							status: "cancelled",
							paymentState: "closed",
							settlementState: "cancelled",
							restartAllowed: true,
						},
					});
					return;
				}
				if (
					path ===
					"/payments/medical-insurance/orders/medical-replacement-001/fees"
				) {
					response(options, 200, {
						data: {
							orderId: "medical-replacement-001",
							status: "fee_uploaded",
						},
					});
					return;
				}
				if (
					path ===
					"/payments/medical-insurance/orders/medical-replacement-001/settle"
				) {
					response(options, 200, {
						data: {
							orderId: "medical-replacement-001",
							status: "insurance_settled",
						},
					});
					return;
				}
				throw new Error(`unexpected request: ${path}`);
			},
		},
	});
	const { continueMedicalPayment } = await import("./medical-insurance");
	const pending = {
		appointmentId: "appointment-relative-001",
		patientId: "patient-child-001",
		createdAt: Date.now(),
		authorizeIdempotencyKey: "medical-authorize-original",
		feesIdempotencyKey: "medical-fees-original",
		settleIdempotencyKey: "medical-settle-original",
		mode: "medical" as const,
		phase: "authorization" as const,
	};

	await expect(
		continueMedicalPayment("auth-code-original", pending, () => undefined),
	).resolves.toEqual({ kind: "reauthorization_started" });

	const replacement = storage.get(
		"miniprogram-pay.pending-payment.v2",
	) as typeof pending;
	expect(replacement.authorizeIdempotencyKey).toStartWith(
		"medical-authorize-restart-",
	);
	expect(replacement.authorizeIdempotencyKey).not.toBe(
		pending.authorizeIdempotencyKey,
	);
	expect(replacement.feesIdempotencyKey).toStartWith("medical-fees-restart-");
	expect(replacement.settleIdempotencyKey).toStartWith(
		"medical-settle-restart-",
	);
	expect(replacement).not.toHaveProperty("orderId");
	expect(navigations).toHaveLength(1);
	expect(navigations[0]?.path).toContain("openType=getAuthCode");
	expect(authorizationCalls).toBe(1);
	expect(storage.has("miniprogram-pay.last-result")).toBe(false);

	await expect(
		continueMedicalPayment("auth-code-fresh", replacement, () => undefined),
	).resolves.toBeUndefined();

	expect(requests.map((item) => item.path)).toEqual([
		"/payments/medical-insurance/authorize",
		"/payments/medical-insurance/orders/medical-old-001/fees",
		"/payments/medical-insurance/orders/medical-old-001/cancel",
		"/payments/medical-insurance/appointments/appointment-relative-001/authorization-context",
		"/payments/medical-insurance/authorize",
		"/payments/medical-insurance/orders/medical-replacement-001/fees",
		"/payments/medical-insurance/orders/medical-replacement-001/settle",
	]);
	expect(requests[0]?.idempotencyKey).toBe("medical-authorize-original");
	expect(requests[0]?.data).toEqual({
		appointmentId: "appointment-relative-001",
		authCode: "auth-code-original",
	});
	expect(requests[4]?.idempotencyKey).toStartWith("medical-authorize-restart-");
	expect(requests[4]?.idempotencyKey).not.toBe(requests[0]?.idempotencyKey);
	expect(requests[4]?.data).toEqual({
		appointmentId: "appointment-relative-001",
		authCode: "auth-code-fresh",
	});
	expect(requests[5]?.idempotencyKey).toStartWith("medical-fees-restart-");
	expect(requests[6]?.idempotencyKey).toStartWith("medical-settle-restart-");
	expect(savedPending).toContainEqual(
		expect.objectContaining({
			appointmentId: "appointment-relative-001",
			patientId: "patient-child-001",
			phase: "authorization",
		}),
	);
	expect(authorizationCalls).toBe(2);
	expect(storage.has("miniprogram-pay.pending-payment.v2")).toBe(false);
	expect(storage.get("miniprogram-pay.last-result")).toMatchObject({
		appointmentId: "appointment-relative-001",
		orderId: "medical-replacement-001",
	});
});

test("只有尚未生成医保订单号的授权阶段允许切换普通自费", async () => {
	const { canSwitchMedicalAuthorizationToSelfPay } = await import(
		"./medical-insurance"
	);
	const pending = {
		appointmentId: "appointment-self-fallback-001",
		patientId: "patient-self-fallback-001",
		createdAt: Date.now(),
		authorizeIdempotencyKey: "medical-authorize-fallback",
		feesIdempotencyKey: "medical-fees-fallback",
		settleIdempotencyKey: "medical-settle-fallback",
		mode: "medical" as const,
		phase: "authorization" as const,
	};

	expect(canSwitchMedicalAuthorizationToSelfPay(pending)).toBe(true);
	expect(
		canSwitchMedicalAuthorizationToSelfPay({
			...pending,
			orderId: "medical-order-already-created",
		}),
	).toBe(false);
	expect(
		canSwitchMedicalAuthorizationToSelfPay({
			...pending,
			phase: "cash_payment",
		}),
	).toBe(false);
});
