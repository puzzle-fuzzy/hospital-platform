import { afterEach, expect, test } from "bun:test";
import { MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE } from "./medical-insurance";
import {
	beginMedicalInsuranceAuthHandoff,
	receiveMedicalInsuranceAuthReturn,
} from "./medical-insurance-auth-handoff";

type ReturnPage = {
	data: Record<string, unknown>;
	setData(patch: Record<string, unknown>): void;
	handleReturn(): Promise<void>;
};

type AuthorizationError =
	| "public-http"
	| "public-plain"
	| "public-lost-prototype"
	| "public-numeric"
	| "unknown-http"
	| "invalid-envelope"
	| "fees-failure";

const originals = new Map(
	["wx", "getApp", "Page"].map((name) => [
		name,
		Object.getOwnPropertyDescriptor(globalThis, name),
	]),
);
afterEach(() => {
	for (const [name, descriptor] of originals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor);
		else Reflect.deleteProperty(globalThis, name);
	}
});

let definition: ReturnPage | undefined;

async function returnFixture(options: {
	error: AuthorizationError;
	eligibility?: "unsupported" | "unknown" | "read-failure";
	existingPayment?: boolean;
}) {
	const requests: string[] = [];
	let paymentCalls = 0;
	const business = {
		businessType: "registration" as const,
		businessId: "appointment-authorization-return",
		patientId: "patient-authorization-return",
	};
	const app = {
		globalData: {
			apiBaseUrl: "https://hospital.example.test",
			apiPrefix: "/api/v2",
			accessToken: "authorization-return-fixture-session",
			sessionStatus: "signed_in",
			sessionGeneration: 9,
			medicalInsuranceAuthIntent: null,
			medicalInsuranceAuthResult: null,
		},
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (page: ReturnPage) => {
			definition = page;
		},
		wx: {
			setNavigationBarTitle: () => undefined,
			getStorageSync: (key: string) =>
				key === "selected_patient_id" ? business.patientId : undefined,
			requestPayment: () => {
				paymentCalls += 1;
			},
			requestMedicalInsurancePay: () => {
				paymentCalls += 1;
			},
			request: (request: { url: string; success(response: unknown): void }) => {
				const path = new URL(request.url).pathname;
				requests.push(path);
				const respond = (statusCode: number, data: unknown) =>
					request.success({ statusCode, header: {}, data });
				if (path.includes("/appointments/registrations/")) {
					respond(200, {
						success: true,
						data: {
							appointmentId: business.businessId,
							patientId: business.patientId,
							patient: {
								displayName: "测试就诊人",
								cardNumberMasked: "123***45",
							},
							hospitalName: "测试医院",
							departmentName: "测试门诊",
							doctorName: "测试医生",
							workDate: "2026-10-16",
							shiftName: "全天",
							sourceSerialNumber: "1",
							totalFen: 1000,
							status: "scheduled",
							selfPayStatus: "not_started",
							paymentStatus: "pending",
							canPay: true,
							payExpiresAt: "2099-01-01T00:15:00.000Z",
						},
					});
					return;
				}
				if (path.endsWith("/business-recovery")) {
					respond(
						options.existingPayment ? 200 : 404,
						options.existingPayment
							? {
									success: true,
									data: {
										orderId: "existing-payment-order",
										status: "cash_pending",
										authorizationReady: true,
										authorizationPending: false,
										recoveryAllowed: true,
									},
								}
							: {
									success: false,
									error: { code: "medical-insurance-order-not-found" },
								},
					);
					return;
				}
				if (path.endsWith("/authorize")) {
					if (options.error === "public-plain") {
						throw { code: "medical-insurance-region-unsupported" };
					}
					if (options.error === "public-lost-prototype") {
						const error = Object.assign(new Error("fixture"), {
							code: "medical-insurance-region-unsupported",
						});
						Object.setPrototypeOf(error, null);
						throw error;
					}
					if (options.error === "public-numeric") {
						throw { name: "ApiError", numericCode: 30580 };
					}
					if (options.error === "fees-failure") {
						respond(200, {
							success: true,
							data: { orderId: "new-authorized-order", status: "authorized" },
						});
						return;
					}
					if (options.error === "invalid-envelope") {
						respond(200, { success: false, error: { code: "UNKNOWN" } });
						return;
					}
					respond(409, {
						success: false,
						error:
							options.error === "public-http"
								? {
										code: "medical-insurance-region-unsupported",
										numericCode: 30580,
									}
								: { code: "UNKNOWN" },
					});
					return;
				}
				if (path.endsWith("/authorization-context")) {
					expect(path).toEndWith(
						`/appointments/${business.businessId}/authorization-context`,
					);
					if (options.eligibility === "read-failure") {
						respond(503, {
							success: false,
							error: { code: "provider-temporarily-unavailable" },
						});
					} else {
						respond(200, {
							success: true,
							data: {
								payForRelatives: false,
								medicalInsurancePaymentEligibility:
									options.eligibility ?? "unknown",
							},
						});
					}
					return;
				}
				if (path.endsWith("/fees") && options.error === "fees-failure") {
					respond(500, { success: false, error: { code: "UNKNOWN" } });
					return;
				}
				throw new Error(`Unexpected request: ${path}`);
			},
		},
	});
	if (!definition) {
		// 单独注册测试页面，避免与其它测试共享微信页面模块缓存中的 Page 捕获器。
		const modulePath = "../pages/registration-payment/registration-payment";
		await import(`${modulePath}.ts?authorization-return-test`);
	}
	if (!definition) throw new Error("Payment page was not captured");
	const page: ReturnPage = {
		...definition,
		data: {
			...definition.data,
			appointmentId: business.businessId,
			patientId: business.patientId,
			sessionGeneration: 9,
			ready: true,
			canPay: true,
			busy: false,
			selectedMode: "mixed",
		},
		setData(patch) {
			Object.assign(this.data, patch);
		},
	};
	beginMedicalInsuranceAuthHandoff(business);
	receiveMedicalInsuranceAuthReturn(app.globalData, "current-return-auth-code");
	return { page, requests, paymentCalls: () => paymentCalls };
}

function expectNoPayment(fixture: Awaited<ReturnType<typeof returnFixture>>) {
	expect(
		fixture.requests.filter((path) => path.endsWith("/authorize")),
	).toHaveLength(1);
	expect(
		fixture.requests.some((path) =>
			/\/(?:fees|settle|wechat-pay|self-pay)$/u.test(path),
		),
	).toBeFalse();
	expect(fixture.paymentCalls()).toBe(0);
	expect(fixture.page.data.busy).toBeFalse();
}

test("真实授权回跳将公共区域错误显示为未开通并隐藏医保入口，兼容原型丢失", async () => {
	for (const error of [
		"public-http",
		"public-plain",
		"public-lost-prototype",
		"public-numeric",
	] as const) {
		const fixture = await returnFixture({ error });
		await fixture.page.handleReturn();
		expect(fixture.page.data.medicalEligibility).toBe("unsupported");
		expect(fixture.page.data.medicalEligibilityMessage).toBe(
			MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE,
		);
		expect(fixture.page.data.message).toBe(
			MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE,
		);
		expect(fixture.page.data.hasPendingPayment).toBeFalse();
		expect(
			fixture.requests.some((path) => path.endsWith("/authorization-context")),
		).toBeFalse();
		expectNoPayment(fixture);
	}
});

test("新授权未知错误仅在当次业务服务端明确未开通时给出微信支付提示", async () => {
	const fixture = await returnFixture({
		error: "unknown-http",
		eligibility: "unsupported",
	});
	await fixture.page.handleReturn();
	expect(fixture.page.data.medicalEligibility).toBe("unsupported");
	expect(fixture.page.data.message).toBe(
		MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE,
	);
	expect(fixture.requests.at(-1)).toEndWith(
		"/appointments/appointment-authorization-return/authorization-context",
	);
	expectNoPayment(fixture);
});

test("授权 HTTP 200 异常封套同样仅按当前服务端明确资格提示未开通", async () => {
	for (const eligibility of ["unsupported", "unknown"] as const) {
		const fixture = await returnFixture({
			error: "invalid-envelope",
			eligibility,
		});
		await fixture.page.handleReturn();
		if (eligibility === "unsupported") {
			expect(fixture.page.data.medicalEligibility).toBe("unsupported");
			expect(fixture.page.data.message).toBe(
				MEDICAL_INSURANCE_REGION_UNSUPPORTED_MESSAGE,
			);
		} else {
			expect(fixture.page.data.medicalEligibility).toBe("unknown");
			expect(fixture.page.data.message).toContain(
				"支付未完成，当前订单状态已保留",
			);
			expect(fixture.page.data.message).not.toContain("请选择微信支付");
		}
		expect(fixture.requests.at(-1)).toEndWith(
			"/appointments/appointment-authorization-return/authorization-context",
		);
		expectNoPayment(fixture);
	}
});

test("资格未知或复核失败保留原支付异常，不按旧地区提示改付", async () => {
	for (const eligibility of ["unknown", "read-failure"] as const) {
		const fixture = await returnFixture({ error: "unknown-http", eligibility });
		await fixture.page.handleReturn();
		expect(fixture.page.data.medicalEligibility).toBe("unknown");
		expect(fixture.page.data.message).toContain(
			"支付未完成，当前订单状态已保留",
		);
		expect(fixture.page.data.message).not.toContain("请选择微信支付");
		expect(fixture.page.data.hasPendingPayment).toBeTrue();
		expectNoPayment(fixture);
	}
});

test("已有支付中订单的授权异常不复核资格、不引导切换支付", async () => {
	const fixture = await returnFixture({
		error: "unknown-http",
		eligibility: "unsupported",
		existingPayment: true,
	});
	await fixture.page.handleReturn();
	expect(
		fixture.requests.some((path) => path.endsWith("/authorization-context")),
	).toBeFalse();
	expect(fixture.page.data.message).toContain("支付未完成，当前订单状态已保留");
	expect(fixture.page.data.message).not.toContain("请选择微信支付");
	expectNoPayment(fixture);
});

test("授权之后费用上传失败不触发地区复核或微信改付提示", async () => {
	const fixture = await returnFixture({
		error: "fees-failure",
		eligibility: "unsupported",
	});
	await fixture.page.handleReturn();
	expect(fixture.requests.some((path) => path.endsWith("/fees"))).toBeTrue();
	expect(
		fixture.requests.some((path) => path.endsWith("/authorization-context")),
	).toBeFalse();
	expect(fixture.page.data.message).toContain("支付未完成，当前订单状态已保留");
	expect(fixture.page.data.message).not.toContain("请选择微信支付");
	expect(fixture.paymentCalls()).toBe(0);
});
