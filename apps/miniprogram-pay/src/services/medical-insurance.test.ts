import { expect, test } from "bun:test";

Object.assign(globalThis, {
	MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: "",
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

test("支付中关单重建会轮换幂等键并保持原预约和亲属就诊人", async () => {
	const storage = new Map<string, unknown>();
	const savedPending: unknown[] = [];
	const requests: CapturedRequest[] = [];
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
			request: (options: WechatMiniprogram.RequestOption) => {
				const path = new URL(options.url).pathname.replace(/^\/api\/v2/u, "");
				const headers = options.header as Record<string, unknown>;
				requests.push({
					path,
					idempotencyKey: String(headers["Idempotency-Key"] ?? ""),
					data: options.data,
				});
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
	).resolves.toBeUndefined();

	expect(requests.map((item) => item.path)).toEqual([
		"/payments/medical-insurance/authorize",
		"/payments/medical-insurance/orders/medical-old-001/fees",
		"/payments/medical-insurance/orders/medical-old-001/cancel",
		"/payments/medical-insurance/authorize",
		"/payments/medical-insurance/orders/medical-replacement-001/fees",
		"/payments/medical-insurance/orders/medical-replacement-001/settle",
	]);
	expect(requests[0]?.idempotencyKey).toBe("medical-authorize-original");
	expect(requests[3]?.idempotencyKey).toStartWith("medical-authorize-restart-");
	expect(requests[3]?.idempotencyKey).not.toBe(requests[0]?.idempotencyKey);
	expect(requests[4]?.idempotencyKey).toStartWith("medical-fees-restart-");
	expect(requests[5]?.idempotencyKey).toStartWith("medical-settle-restart-");
	expect(savedPending).toContainEqual(
		expect.objectContaining({
			appointmentId: "appointment-relative-001",
			patientId: "patient-child-001",
			phase: "authorization",
		}),
	);
	expect(storage.has("miniprogram-pay.pending-payment.v2")).toBe(false);
	expect(storage.get("miniprogram-pay.last-result")).toMatchObject({
		appointmentId: "appointment-relative-001",
		orderId: "medical-replacement-001",
	});
});
