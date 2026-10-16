import { afterEach, expect, test } from "bun:test";

const PENDING_KEY = "hospital-platform.pending-medical-payment.v1";
const originalWxDescriptor = Object.getOwnPropertyDescriptor(globalThis, "wx");
const originalGetAppDescriptor = Object.getOwnPropertyDescriptor(
	globalThis,
	"getApp",
);

test("医保入口资格读取当前业务的服务端判断，未知不会从客户端区划猜测", async () => {
	const requests: string[] = [];
	let eligibility: string | undefined = "unsupported";
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "eligibility-test-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			request: (options: {
				url: string;
				success: (value: unknown) => void;
			}) => {
				requests.push(options.url);
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							payForRelatives: false,
							...(eligibility
								? { medicalInsurancePaymentEligibility: eligibility }
								: {}),
						},
					},
				});
			},
			getStorageSync: (key: string) => {
				expect(key).not.toMatch(/patient|region|city|pending-medical/u);
				return undefined;
			},
		},
	});
	const { medicalAuthorizationContext, outpatientMedicalAuthorizationContext } =
		await import("./medical-insurance");
	expect(
		(await medicalAuthorizationContext("appointment-eligibility-a"))
			.medicalInsurancePaymentEligibility,
	).toBe("unsupported");
	eligibility = "supported";
	expect(
		(
			await outpatientMedicalAuthorizationContext(
				"record-eligibility-b",
				"patient-eligibility-b",
			)
		).medicalInsurancePaymentEligibility,
	).toBe("supported");
	eligibility = undefined;
	expect(
		(await medicalAuthorizationContext("appointment-eligibility-c"))
			.medicalInsurancePaymentEligibility,
	).toBe("unknown");
	eligibility = "140581";
	await expect(
		medicalAuthorizationContext("appointment-eligibility-d"),
	).rejects.toMatchObject({ code: "provider-response-invalid" });
	expect(requests[0]).toEndWith(
		"/payments/medical-insurance/appointments/appointment-eligibility-a/authorization-context",
	);
	expect(requests[1]).toEndWith(
		"/payments/medical-insurance/outpatient-records/record-eligibility-b/authorization-context?patientId=patient-eligibility-b",
	);
});

test("参保地暂未开通的授权拒绝不会继续上传费用或自动转微信付款", async () => {
	const requests: string[] = [];
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "unsupported-region-test-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			getStorageSync: () => undefined,
			request: (options: {
				url: string;
				success: (value: unknown) => void;
			}) => {
				requests.push(options.url);
				options.success({
					statusCode: 422,
					header: {},
					data: {
						success: false,
						error: {
							code: "medical-insurance-region-unsupported",
							message: "当前参保地暂未开通医保支付，请选择微信支付",
						},
					},
				});
			},
			requestPayment: () => {
				throw new Error("Must not launch payment");
			},
		},
	});
	const {
		continueMedicalPayment,
		createMedicalPaymentContext,
		isMedicalInsuranceRegionUnsupported,
	} = await import("./medical-insurance");
	for (const businessType of ["registration", "outpatient"] as const) {
		const pending = createMedicalPaymentContext({
			businessType,
			businessId: `business-unsupported-${businessType}`,
			patientId: "patient-unsupported",
			phase: "authorization",
		});
		try {
			await continueMedicalPayment(
				"current-authorization-code",
				pending,
				() => undefined,
			);
			throw new Error("Authorization must reject");
		} catch (error) {
			expect(isMedicalInsuranceRegionUnsupported(error)).toBeTrue();
		}
	}
	expect(requests).toHaveLength(2);
	expect(requests[0]).toEndWith("/payments/medical-insurance/authorize");
	expect(requests[1]).toEndWith(
		"/payments/medical-insurance/outpatient/authorize",
	);
});

test("已知外地参保不跳转医保，未知仍可授权且亲情付路由保持完整", async () => {
	const { MEDICAL_INSURANCE_CONFIG } = await import("../config");
	const originalOrgAppId = MEDICAL_INSURANCE_CONFIG.medicalOrgAppId;
	const originalOrgCredential =
		MEDICAL_INSURANCE_CONFIG.medicalOrgChannelCredential;
	const app = {
		globalData: {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "medical-entry-gate-session",
			sessionStatus: "signed_in",
		},
	};
	let eligibility = "unsupported";
	const navigated: string[] = [];
	Object.assign(globalThis, {
		getApp: () => app,
		wx: {
			getStorageSync: () => undefined,
			request: (options: { success: (value: unknown) => void }) =>
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							payForRelatives: true,
							familyId: "a".repeat(32),
							medicalInsurancePaymentEligibility: eligibility,
						},
					},
				}),
			navigateToMiniProgram: (options: {
				path: string;
				success: () => void;
			}) => {
				navigated.push(options.path);
				options.success();
			},
		},
	});
	Object.assign(MEDICAL_INSURANCE_CONFIG, {
		medicalOrgAppId: "local-test-org-app",
		medicalOrgChannelCredential: "local-test-org-credential",
	});
	try {
		const { navigateToMedicalAuth, navigateToOutpatientMedicalAuth } =
			await import("./medical-insurance");
		await expect(
			navigateToMedicalAuth("appointment-entry-gate", "patient-entry-gate"),
		).rejects.toMatchObject({ code: "medical-insurance-region-unsupported" });
		await expect(
			navigateToOutpatientMedicalAuth(
				"record-entry-gate",
				"patient-entry-gate",
			),
		).rejects.toMatchObject({ code: "medical-insurance-region-unsupported" });
		expect(navigated).toHaveLength(0);
		eligibility = "unknown";
		await navigateToMedicalAuth("appointment-entry-gate", "patient-entry-gate");
		eligibility = "supported";
		await navigateToOutpatientMedicalAuth(
			"record-entry-gate",
			"patient-entry-gate",
		);
		expect(navigated).toHaveLength(2);
		for (const path of navigated)
			expect(path).toContain(`&familyid=${"a".repeat(32)}`);
	} finally {
		Object.assign(MEDICAL_INSURANCE_CONFIG, {
			medicalOrgAppId: originalOrgAppId,
			medicalOrgChannelCredential: originalOrgCredential,
		});
	}
});

function restoreGlobal(
	key: "wx" | "getApp",
	descriptor: PropertyDescriptor | undefined,
): void {
	if (descriptor) {
		Object.defineProperty(globalThis, key, descriptor);
		return;
	}
	Reflect.deleteProperty(globalThis, key);
}

afterEach(() => {
	restoreGlobal("wx", originalWxDescriptor);
	restoreGlobal("getApp", originalGetAppDescriptor);
});

test("医保授权回跳只允许匹配的业务和患者消费一次", async () => {
	const state = {
		medicalInsuranceAuthIntent: null,
		medicalInsuranceAuthResult: null,
	};
	Object.assign(globalThis, { getApp: () => ({ globalData: state }) });
	const {
		beginMedicalInsuranceAuthHandoff,
		consumeMedicalInsuranceAuthReturn,
		hasMedicalInsuranceAuthReturn,
		receiveMedicalInsuranceAuthReturn,
	} = await import("./medical-insurance-auth-handoff");
	const business = {
		businessType: "registration" as const,
		businessId: "appointment-auth-handoff-001",
		patientId: "patient-auth-handoff-001",
	};

	beginMedicalInsuranceAuthHandoff(business, 1_000);
	receiveMedicalInsuranceAuthReturn(state, " auth-code-handoff-001 ", 1_100);
	expect(hasMedicalInsuranceAuthReturn(business, 1_200)).toBeTrue();
	expect(consumeMedicalInsuranceAuthReturn(business, 1_200)).toBe(
		"auth-code-handoff-001",
	);
	expect(consumeMedicalInsuranceAuthReturn(business, 1_200)).toBe("");

	beginMedicalInsuranceAuthHandoff(business, 2_000);
	receiveMedicalInsuranceAuthReturn(state, "auth-code-must-not-cross", 2_100);
	expect(
		consumeMedicalInsuranceAuthReturn(
			{ ...business, businessId: "appointment-auth-handoff-other" },
			2_200,
		),
	).toBe("");
	expect(state.medicalInsuranceAuthIntent).toBeNull();
	expect(state.medicalInsuranceAuthResult).toBeNull();
});

test("新的医保授权点击覆盖旧意图，冷启动或过期回跳码不会遗留", async () => {
	const state = {
		medicalInsuranceAuthIntent: null,
		medicalInsuranceAuthResult: null,
	};
	Object.assign(globalThis, { getApp: () => ({ globalData: state }) });
	const {
		beginMedicalInsuranceAuthHandoff,
		consumeMedicalInsuranceAuthReturn,
		receiveMedicalInsuranceAuthReturn,
	} = await import("./medical-insurance-auth-handoff");
	const first = {
		businessType: "registration" as const,
		businessId: "appointment-auth-handoff-old",
		patientId: "patient-auth-handoff-old",
	};
	const second = {
		businessType: "outpatient" as const,
		businessId: "record-auth-handoff-new",
		patientId: "patient-auth-handoff-new",
	};

	beginMedicalInsuranceAuthHandoff(first, 1_000);
	beginMedicalInsuranceAuthHandoff(second, 2_000);
	receiveMedicalInsuranceAuthReturn(state, "auth-code-handoff-new", 2_100);
	expect(consumeMedicalInsuranceAuthReturn(second, 2_200)).toBe(
		"auth-code-handoff-new",
	);
	expect(consumeMedicalInsuranceAuthReturn(first, 2_200)).toBe("");

	receiveMedicalInsuranceAuthReturn(state, "unbound-cold-start-code", 3_000);
	expect(state.medicalInsuranceAuthResult).toBeNull();
	beginMedicalInsuranceAuthHandoff(second, 4_000);
	receiveMedicalInsuranceAuthReturn(state, "expired-auth-code", 11 * 60_000);
	expect(state.medicalInsuranceAuthIntent).toBeNull();
	expect(state.medicalInsuranceAuthResult).toBeNull();
});

function storageWx(storage: Map<string, unknown>) {
	return {
		getStorageSync: (key: string) => storage.get(key),
		setStorageSync: (key: string, value: unknown) => storage.set(key, value),
		removeStorageSync: (key: string) => storage.delete(key),
	};
}

test("普通微信挂号支付每次点击都恢复服务端订单且不访问支付本地存储", async () => {
	type RequestOptions = {
		url: string;
		method?: string;
		success: (response: unknown) => void;
	};
	let requestCalls = 0;
	const storageReads: string[] = [];
	const storageWrites: string[] = [];
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "registration-self-pay-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			getStorageSync: (key: string) => {
				storageReads.push(key);
				return undefined;
			},
			setStorageSync: (key: string) => {
				storageWrites.push(key);
			},
			removeStorageSync: (key: string) => {
				storageWrites.push(key);
			},
			request: (options: RequestOptions) => {
				requestCalls += 1;
				expect(options.url).toEndWith(
					"/api/v2/payments/appointments/appointment-self-001/self-pay",
				);
				expect(options.method).toBe("POST");
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							appointmentId: "appointment-self-001",
							orderId: "self-order-server-001",
							status: "cash_paid",
							paymentState: "completed",
							totalFen: 2_000,
						},
					},
				});
			},
		},
	});
	const { startSelfPayment } = await import("./medical-insurance");
	const appointment = {
		appointmentId: "appointment-self-001",
		patientId: "patient-self-001",
	};

	await expect(startSelfPayment(appointment, () => undefined)).resolves.toEqual(
		{
			orderId: "self-order-server-001",
			totalFen: 2_000,
		},
	);
	await expect(startSelfPayment(appointment, () => undefined)).resolves.toEqual(
		{
			orderId: "self-order-server-001",
			totalFen: 2_000,
		},
	);
	expect(requestCalls).toBe(2);
	expect(storageReads).not.toContain(PENDING_KEY);
	expect(storageReads).not.toContain(
		"hospital-platform.last-medical-payment-result",
	);
	expect(storageWrites).toEqual([]);
});

test("单次医保操作上下文只在内存构造且使用新的幂等键", async () => {
	const storage = new Map<string, unknown>();
	Object.assign(globalThis, { wx: storageWx(storage) });
	const { createMedicalPaymentContext } = await import("./medical-insurance");
	const first = createMedicalPaymentContext({
		businessType: "outpatient",
		businessId: "outpatient-record-server-001",
		patientId: "patient-server-001",
		order: {
			orderId: "medical-server-001",
			status: "cash_pending",
			amounts: { totalFen: 10000, insuranceFen: 7000, cashFen: 3000 },
		},
		phase: "cash_payment",
	});
	const second = createMedicalPaymentContext({
		businessType: "outpatient",
		businessId: "outpatient-record-server-001",
		patientId: "patient-server-001",
		order: {
			orderId: "medical-server-001",
			status: "cash_pending",
		},
		phase: "cash_payment",
	});

	expect(first).toMatchObject({
		businessType: "outpatient",
		recordId: "outpatient-record-server-001",
		patientId: "patient-server-001",
		orderId: "medical-server-001",
		phase: "cash_payment",
	});
	expect(second.authorizeIdempotencyKey).not.toBe(
		first.authorizeIdempotencyKey,
	);
	expect(storage.has(PENDING_KEY)).toBeFalse();
});

test("医保现金支付每次新点击都重新查服务端且不写本地结果", async () => {
	type RequestOptions = {
		url: string;
		method?: string;
		success: (response: unknown) => void;
	};
	const storage = new Map<string, unknown>();
	let queryCalls = 0;
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "medical-cash-query-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			...storageWx(storage),
			request: (options: RequestOptions) => {
				queryCalls += 1;
				expect(options.url).toEndWith(
					"/api/v2/payments/medical-insurance/orders/medical-cash-query-001/wechat-pay",
				);
				expect(options.method).toBe("GET");
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							orderId: "medical-cash-query-001",
							status: "insurance_settled",
							paymentState: "cash_paid",
							cashFen: 3000,
						},
					},
				});
			},
		},
	});
	const {
		createMedicalPaymentContext,
		resumeOrContinueMedicalCashPaymentFromPending,
	} = await import("./medical-insurance");
	const pending = createMedicalPaymentContext({
		businessType: "outpatient",
		businessId: "outpatient-record-cash-query-001",
		patientId: "patient-cash-query-001",
		order: {
			orderId: "medical-cash-query-001",
			status: "cash_pending",
			amounts: { totalFen: 10000, insuranceFen: 7000, cashFen: 3000 },
		},
		phase: "cash_payment",
	});

	await resumeOrContinueMedicalCashPaymentFromPending(pending, () => undefined);
	await resumeOrContinueMedicalCashPaymentFromPending(pending, () => undefined);

	expect(queryCalls).toBe(2);
	expect(storage.has(PENDING_KEY)).toBeFalse();
	expect(storage.size).toBe(0);
});

test("医保按钮按业务键查询服务端并接受 6201 在途状态", async () => {
	type RequestOptions = {
		url: string;
		method?: string;
		data?: unknown;
		success: (response: unknown) => void;
	};
	const storage = new Map<string, unknown>();
	const requestUrls: string[] = [];
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "medical-business-recovery-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			...storageWx(storage),
			request: (options: RequestOptions) => {
				requestUrls.push(options.url);
				expect(options.method).toBe("POST");
				expect(options.data).toEqual({
					businessType: "outpatient",
					businessId: "outpatient-record-query-001",
					patientId: "patient-query-001",
				});
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							orderId: "medical-query-001",
							status: "fee_upload_pending",
							authorizationReady: true,
							authorizationPending: false,
							recoveryAllowed: true,
						},
					},
				});
			},
		},
	});
	const { queryMedicalBusinessRecovery } = await import("./medical-insurance");

	await expect(
		queryMedicalBusinessRecovery({
			businessType: "outpatient",
			businessId: "outpatient-record-query-001",
			patientId: "patient-query-001",
		}),
	).resolves.toEqual({
		orderId: "medical-query-001",
		status: "fee_upload_pending",
		authorizationReady: true,
		authorizationPending: false,
		recoveryAllowed: true,
	});
	expect(requestUrls[0]).toEndWith(
		"/api/v2/payments/medical-insurance/business-recovery",
	);
});

test("服务端明确无活动医保订单时返回 null，不回退读取本地医保缓存", async () => {
	type RequestOptions = {
		url: string;
		success: (response: unknown) => void;
	};
	const storage = new Map<string, unknown>();
	storage.set(PENDING_KEY, { stale: true });
	Object.assign(globalThis, {
		getApp: () => ({
			globalData: {
				apiBaseUrl: "https://test-hp.meiyi.pro",
				apiPrefix: "/api/v2",
				accessToken: "medical-business-not-found-session",
				sessionStatus: "signed_in",
			},
		}),
		wx: {
			...storageWx(storage),
			request: (options: RequestOptions) =>
				options.success({
					statusCode: 404,
					header: {},
					data: {
						success: false,
						error: {
							code: "medical-insurance-order-not-found",
							numericCode: 40410,
							message: "not found",
						},
					},
				}),
		},
	});
	const { queryMedicalBusinessRecovery } = await import("./medical-insurance");

	await expect(
		queryMedicalBusinessRecovery({
			businessType: "registration",
			businessId: "appointment-query-missing-001",
			patientId: "patient-query-missing-001",
		}),
	).resolves.toBeNull();
	expect(storage.get(PENDING_KEY)).toEqual({ stale: true });
});

test("外地患者的门诊原单查询只查原订单，不续传费用、不调用结算或支付", async () => {
	const originalPage = Object.getOwnPropertyDescriptor(globalThis, "Page");
	let captured: Record<string, unknown> | undefined;
	const requestPaths: string[] = [];
	const notices: string[] = [];
	const app = {
		globalData: {
			apiBaseUrl: "https://test-hp.meiyi.pro",
			apiPrefix: "/api/v2",
			accessToken: "readonly-old-medical-order-session",
			sessionStatus: "signed_in",
		},
	};
	Object.assign(globalThis, {
		getApp: () => app,
		Page: (definition: Record<string, unknown>) => {
			captured = definition;
		},
		wx: {
			getStorageSync: () => undefined,
			request: (options: {
				url: string;
				method?: string;
				success: (value: unknown) => void;
			}) => {
				requestPaths.push(`${options.method ?? "GET"} ${options.url}`);
				options.success({
					statusCode: 200,
					header: {},
					data: {
						success: true,
						data: {
							orderId: "old-outpatient-region-order",
							status: "cash_pending",
							authorizationReady: true,
							authorizationPending: false,
							recoveryAllowed: true,
						},
					},
				});
			},
			showModal: (options: { content: string }) =>
				notices.push(options.content),
			requestPayment: () => {
				throw new Error("Readonly lookup must not launch payment");
			},
			navigateTo: () => {
				throw new Error(
					"Readonly lookup must not open settlement continuation",
				);
			},
		},
	});
	try {
		await import("../pages/outpatient-payment/outpatient-payment");
		if (!captured) throw new Error("Page definition was not captured");
		const page = {
			data: {
				...(captured.data as Record<string, unknown>),
				selectedPatient: { id: "patient-readonly-region" },
				paymentRecord: { recordId: "record-readonly-region" },
				hasOriginalMedicalPayment: true,
				medicalEligibility: "unsupported",
				paymentMethod: "",
			},
			setData(patch: Record<string, unknown>) {
				Object.assign(this.data, patch);
			},
			isPatientContextCurrent: () => true,
			queryOriginalMedicalPayment: captured.queryOriginalMedicalPayment,
		};
		await (
			captured.onOriginalMedicalPayment as (this: typeof page) => Promise<void>
		).call(page);
		expect(requestPaths).toHaveLength(2);
		expect(requestPaths[0]).toEndWith(
			"/payments/medical-insurance/business-recovery",
		);
		expect(requestPaths[1]).toContain("GET ");
		expect(requestPaths[1]).toEndWith(
			"/payments/medical-insurance/orders/old-outpatient-region-order",
		);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("请勿重复付款");
		const selectMethod = captured.onPaymentMethodTap as (
			this: typeof page,
			event: { currentTarget: { dataset: { method: string } } },
		) => void;
		selectMethod.call(page, {
			currentTarget: { dataset: { method: "medical" } },
		});
		expect(page.data.paymentMethod).toBe("");
		selectMethod.call(page, {
			currentTarget: { dataset: { method: "wechat" } },
		});
		expect(page.data.paymentMethod).toBe("wechat");
		expect(requestPaths).toHaveLength(2);
	} finally {
		if (originalPage) Object.defineProperty(globalThis, "Page", originalPage);
		else Reflect.deleteProperty(globalThis, "Page");
	}
});
