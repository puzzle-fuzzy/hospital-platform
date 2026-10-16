import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	MedicalInsuranceAmounts,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
	OutpatientPaymentRecord,
} from "@hospital/domain";
import {
	accountFlag,
	createLegacyFsiMedicalInsuranceGateway,
	mapSettlementDetails,
	medicalTypeForBusiness,
	offSiteTypeForInsuredArea,
	resolveRegistrationProviderRegisterId,
	settlementInsuTypeNameForInsutype,
	settlementMedTypeNameForBusiness,
} from "./legacy-fsi-medical-insurance";

const order = {
	medicalOrderId: "medical-order-context-missing-001",
	ownerUserId: "user-context-missing-001",
	businessType: "registration",
} as MedicalInsuranceOrder;

const context: AdapterCallContext = {
	traceId: "trace-context-missing-001",
	idempotencyKey: "idempotency-context-missing-001",
};

test("acctUsedFlag uses the local insured-region rule", () => {
	expect(accountFlag("140581")).toBe("0");
	expect(accountFlag(" 140581 ")).toBe("0");
	expect(accountFlag("140500")).toBe("1");
});

test("6201 医疗类别按挂号、门诊职工和门诊居民选择", () => {
	expect(medicalTypeForBusiness("registration", "310")).toBe("12");
	expect(medicalTypeForBusiness("registration", "390")).toBe("12");
	expect(medicalTypeForBusiness("outpatient", "310")).toBe("11");
	expect(medicalTypeForBusiness("outpatient", "390")).toBe("110104");
	expect(medicalTypeForBusiness("outpatient", "999")).toBeUndefined();
});

test(".32 medTypeName 按业务类型和险种映射", () => {
	expect(settlementMedTypeNameForBusiness("registration", "310")).toBe(
		"门诊挂号",
	);
	expect(settlementMedTypeNameForBusiness("registration", "390")).toBe(
		"门诊挂号",
	);
	expect(settlementMedTypeNameForBusiness("outpatient", "390")).toBe(
		"门诊统筹",
	);
	expect(settlementMedTypeNameForBusiness("outpatient", "310")).toBe(
		"普通门诊",
	);
});

test(".32 offSiteType 按参保地省内外规则映射", () => {
	expect(offSiteTypeForInsuredArea("140581")).toBe(0);
	expect(offSiteTypeForInsuredArea("141000")).toBe(1);
	expect(offSiteTypeForInsuredArea("110000")).toBe(2);
	expect(offSiteTypeForInsuredArea("")).toBeUndefined();
});

test(".32 insuTypeName 按医保险种字典映射", () => {
	expect(settlementInsuTypeNameForInsutype("310")).toBe("职工基本医疗保险");
	expect(settlementInsuTypeNameForInsutype("390")).toBe("城乡居民基本医疗保险");
	expect(settlementInsuTypeNameForInsutype("320")).toBe("公务员医疗补助");
	expect(settlementInsuTypeNameForInsutype("392")).toBe("城乡居民大病医疗保险");
	expect(settlementInsuTypeNameForInsutype("330")).toBe("大额医疗费用补助");
	expect(settlementInsuTypeNameForInsutype("510")).toBe("生育保险");
	expect(settlementInsuTypeNameForInsutype("340")).toBe("离休人员医疗保障");
	expect(settlementInsuTypeNameForInsutype("999")).toBeUndefined();
});

test(".27 明细缺少 orderId 和 outDocOrderId 时仍保留可用明细", () => {
	const [detail] = mapSettlementDetails(
		[
			{
				amount: "10.00",
				chargeCode: "CHARGE-001",
				chargeId: "CHARGE-ID-001",
				chargeName: "挂号费",
				networkItemCode: "ITEM-001",
				networkItemName: "挂号费",
				outSettleDetailId: "DETAIL-001",
				price: "10.00",
				quantity: 1,
				selfBurdenRatio: "1",
				createTime: "2026-09-16 09:43:12",
			},
		],
		[],
		"medical-insurance.2.27.2.27",
		"fsi-27-test-001",
	);

	expect(detail).toMatchObject({
		amount: "10.00",
		outBillId: "DETAIL-001",
		outSettleDetailId: "DETAIL-001",
	});
	expect(detail).not.toHaveProperty("orderId");
	expect(detail).not.toHaveProperty("outDocOrderId");
});

test("挂号 .32 明细的 orderId 固定为 -1", () => {
	const [detail] = mapSettlementDetails(
		[
			{
				amount: "10.00",
				chargeCode: "CHARGE-REG-001",
				chargeId: "CHARGE-ID-REG-001",
				chargeName: "挂号费",
				networkItemCode: "ITEM-REG-001",
				networkItemName: "挂号费",
				outSettleDetailId: "DETAIL-REG-001",
				price: "10.00",
				quantity: 1,
				selfBurdenRatio: "0",
				createTime: "2026-09-16 10:27:39",
			},
		],
		[],
		"medical-insurance.2.27.2.27",
		"fsi-27-registration-order-id-001",
		"registration",
	);

	expect(detail).toMatchObject({ orderId: -1 });
});

test("2.6.65.1 挂号参数优先使用 hisRegisterId", () => {
	expect(
		resolveRegistrationProviderRegisterId({
			appointmentId: "appointment-register-id-001",
			providerAppointmentId: "8842508330040721665",
			providerHisRegisterId: "8842508330101318146",
		}),
	).toBe("8842508330101318146");
	expect(
		resolveRegistrationProviderRegisterId({
			appointmentId: "appointment-register-id-002",
			providerAppointmentId: "8842508330040721666",
		}),
	).toBe("8842508330040721666");
	expect(
		resolveRegistrationProviderRegisterId({
			providerHisRegisterId: "should-not-be-used-without-appointment",
		}),
	).toBeUndefined();
});

function feeUploadDepartmentFixture(
	children: readonly Record<string, unknown>[],
	resume = false,
	outpatientSnapshot?: OutpatientPaymentRecord,
	detailOverrides: Readonly<Record<string, unknown>> = {},
) {
	const providerUrls: URL[] = [];
	const feeUploads: Record<string, unknown>[] = [];
	const contextWrites: MedicalInsuranceSettlementContext[] = [];
	const detail = {
		outTradeOrderId: "trade-current-001",
		chargeId: "charge-current-001",
		chargeCode: "CHARGE-001",
		chargeName: "挂号费",
		networkItemCode: "INSURANCE-ITEM-001",
		networkItemName: "挂号费",
		outSettleDetailId: "detail-current-001",
		amount: "10.00",
		price: "10.00",
		quantity: 1,
		selfBurdenRatio: "0",
		createTime: "2026-10-15 14:00:00",
		billDeptCode: "DEPT-CODE-001",
		billDeptId: "dept-id-from-detail-must-not-be-used",
		billDeptName: "开单科室",
		billDocCode: "doctor-user-code-001",
		billDocName: "测试医生",
		...detailOverrides,
	};
	let settlementContext: MedicalInsuranceSettlementContext | undefined = resume
		? {
				businessId: "business-current-001",
				businessCode: "business-code-current-001",
				hospitalId: "10389001",
				patientId: "patient-current-001",
				networkRegister: {},
				outNetworkSettleMain: {},
				nationalUpDetailList: [],
				upDetailList: mapSettlementDetails(
					[detail],
					[],
					"medical-insurance.2.27.2.27",
					"detail-request-cached-001",
					"registration",
				),
				tradeOrderIds: ["trade-current-001"],
				feeUploadStage: "pre_6201",
				settlementAmountFen: 1000,
				settlementDetailsFetchedAt: "2026-10-15T06:00:00.000Z",
				...(outpatientSnapshot
					? { outpatientPaymentRecord: outpatientSnapshot }
					: {}),
			}
		: undefined;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {
			uploadFees: async (input) => {
				if (outpatientSnapshot) {
					expect(settlementContext?.outpatientPaymentRecord).toEqual(
						outpatientSnapshot,
					);
					expect(settlementContext?.feeUploadStage).toBe("submitting_6201");
				}
				feeUploads.push(input);
				return {
					totalFen: 1000,
					mdtrtId: "visit-current-001",
					credential: {
						payOrdId: "pay-current-001",
						payToken: "synthetic-token",
					},
					trace: {
						provider: "legacy-fsi",
						operation: "legacy-fsi.6201",
						requestId: "synthetic-fee-upload-001",
					},
				};
			},
			createPaymentOrder: async () => {
				throw new Error("6202 must not run during fee upload");
			},
		},
		orders: {
			findByMedicalOrderId: async () => ({
				medicalOrderId: "order-current-001",
				ownerUserId: "owner-current-001",
				businessType: outpatientSnapshot ? "outpatient" : "registration",
			}),
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_order: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
				contextWrites.push(next);
			},
		} as never,
		authorizations: {
			get: async () => ({
				payAuthNo: "synthetic-auth-001",
				patient: { idNo: "synthetic-id", userName: "测试患者", idType: "01" },
				psnNo: "synthetic-person-001",
				insutype: "310",
				insuplcAdmdvs: "140581",
				insuCode: "140581",
			}),
		} as never,
		credentials: { put: async () => undefined } as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		now: () => new Date("2026-10-15T06:00:00.000Z"),
		fetcher: async (input) => {
			const url = new URL(String(input));
			providerUrls.push(url);
			let data: unknown;
			if (url.pathname.endsWith("/apply-pay-settle")) {
				data = {
					businessId: "business-current-001",
					businessCode: "business-code-current-001",
					tradeOrderIdList: ["trade-current-001"],
					getAmount: "10.00",
				};
			} else if (url.pathname.endsWith("/outpatient-child-payment-records")) {
				data = children;
			} else if (url.pathname.endsWith("/out-insur-settle-infos")) {
				data = { outSettleDetailList: [detail] };
			} else if (url.pathname.endsWith("/depts")) {
				data = [
					{
						deptId: url.searchParams.get("deptId"),
						deptCode: "DEPT-CODE-001",
						nationalDeptInsuranceCode: "insurance-dept-code-001",
					},
				];
			} else if (url.pathname.endsWith("/users")) {
				data = [
					{
						userCode: "doctor-user-code-001",
						medicalInsuranceCode: "insurance-doctor-001",
					},
				];
			} else {
				throw new Error(`Unexpected synthetic provider path: ${url.pathname}`);
			}
			return new Response(
				JSON.stringify({ success: true, code: "0000", data }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		},
	});
	return {
		providerUrls,
		feeUploads,
		contextWrites,
		readSettlementContext: () => settlementContext,
		upload: () =>
			gateway.uploadFees(
				{
					orderId: "order-current-001",
					ownerUserId: "owner-current-001",
					patientId: "patient-current-001",
					authorizationId: "authorization-current-001",
					appointment: outpatientSnapshot
						? {
								businessType: "outpatient",
								recordId: outpatientSnapshot.recordId,
								outpatientPaymentRecord: outpatientSnapshot,
								providerPatientId: "patient-current-001",
								outTradeOrderIds: ["trade-current-001"],
								doctorId: "doctor-user-code-001",
								doctorName: "测试医生",
								departmentName: "开单科室",
								totalFen: 1000,
							}
						: {
								appointmentId: "appointment-current-001",
								providerAppointmentId: "registration-current-001",
								providerPatientId: "patient-current-001",
								departmentId: "appointment-dept-id-must-not-be-used",
								departmentName: "预约科室",
								doctorId: "doctor-user-code-001",
								doctorName: "测试医生",
								workDate: "2026-10-15",
								shiftName: "上午",
								sourceSerialNumber: "1",
								totalFen: 1000,
							},
				},
				context,
			),
	};
}

const currentDepartmentChild = {
	outTradeOrderId: "trade-current-001",
	chargeId: "charge-current-001",
	billDeptId: "6309619828601651001",
	billDeptCode: "DEPT-CODE-001",
};

test.each(
	["registration", "outpatient"].flatMap((businessType) =>
		[
			{
				name: "orderId 和 orderMainId 均有值时仍传空字符串",
				detail: { orderId: "order-001", orderMainId: "order-main-001" },
				expected: "",
			},
			{
				name: "orderMainId 有值时仍传空字符串",
				detail: { orderId: null, orderMainId: "order-main-001" },
				expected: "",
			},
			{
				name: "orderId 为空字符串时仍不使用 orderMainId",
				detail: { orderId: "", orderMainId: "order-main-001" },
				expected: "",
			},
			{
				name: "两个字段缺失时传空字符串",
				detail: {},
				expected: "",
			},
			{
				name: "两个字段为空时不使用其他标识兜底",
				detail: {
					orderId: null,
					orderMainId: null,
					rxno: "legacy-rxno-must-not-be-used",
					outDocOrderId: "8843788158791400001",
					presCode: "-1",
				},
				expected: "",
			},
		].map((scenario) => ({ ...scenario, businessType })),
	),
)(
	"6201 rxno $businessType - $name",
	async ({ businessType, detail, expected }) => {
		const fixture = feeUploadDepartmentFixture(
			[currentDepartmentChild],
			false,
			businessType === "outpatient"
				? {
						recordId: "0123456789abcdef0123456789abcdef",
						status: "unpaid",
						billDate: "2026-10-15 14:00:00",
						amountFen: 1000,
					}
				: undefined,
			detail,
		);
		await fixture.upload();
		expect(fixture.feeUploads).toHaveLength(1);
		expect(fixture.feeUploads[0]).toMatchObject({
			feedetailList: [expect.objectContaining({ rxno: expected })],
		});
	},
);

test.each([false, true])(
	"门诊合缴快照与6201各阶段同次保存，恢复路径=%s",
	async (resume) => {
		const snapshot: OutpatientPaymentRecord = {
			recordId: "outpatient-group-snapshot",
			status: "unpaid",
			billDate: "2026-10-15 14:00:00",
			amountFen: 1000,
			items: [
				{
					recordId: "outpatient-leaf-a",
					status: "unpaid",
					billDate: "2026-10-15 14:00:00",
					amountFen: 400,
				},
				{
					recordId: "outpatient-leaf-b",
					status: "unpaid",
					billDate: "2026-10-15 14:00:00",
					amountFen: 600,
				},
			],
		};
		const fixture = feeUploadDepartmentFixture(
			[currentDepartmentChild],
			resume,
			snapshot,
		);
		await fixture.upload();
		expect(fixture.contextWrites.length).toBeGreaterThan(2);
		for (const written of fixture.contextWrites)
			expect(written.outpatientPaymentRecord).toEqual(snapshot);
		expect(
			fixture.contextWrites.map((written) => written.feeUploadStage),
		).toContain("submitting_6201");
		expect(fixture.readSettlementContext()).toMatchObject({
			feeUploadStage: "fee_uploaded",
			outpatientPaymentRecord: snapshot,
		});
	},
);

test("2.1.9 使用同一结算费用的 2.6.33 billDeptId，不发送科室编码或其他记录", async () => {
	const fixture = feeUploadDepartmentFixture([
		{
			...currentDepartmentChild,
			outTradeOrderId: "trade-other-001",
			billDeptId: "other-order-dept",
		},
		{
			...currentDepartmentChild,
			chargeId: "charge-other-001",
			billDeptId: "other-charge-dept",
		},
		currentDepartmentChild,
	]);
	await expect(fixture.upload()).resolves.toMatchObject({
		payOrdId: "pay-current-001",
	});
	const departmentQueries = fixture.providerUrls.filter((url) =>
		url.pathname.endsWith("/depts"),
	);
	expect(departmentQueries).toHaveLength(1);
	expect(departmentQueries[0]?.searchParams.get("deptId")).toBe(
		currentDepartmentChild.billDeptId,
	);
	expect(fixture.feeUploads).toHaveLength(1);
	expect(fixture.feeUploads[0]).toMatchObject({
		deptCode: "DEPT-CODE-001",
		caty: "insurance-dept-code-001",
	});
});

test("pre_6201 恢复复用 .27 快照，但科室 ID 仍来自本次 .33 返回", async () => {
	const fixture = feeUploadDepartmentFixture([currentDepartmentChild], true);
	await expect(fixture.upload()).resolves.toMatchObject({
		payOrdId: "pay-current-001",
	});
	expect(fixture.providerUrls.map((url) => url.pathname)).toEqual([
		"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records",
		"/msun-middle-base-common/v1/depts",
		"/msun-middle-base-common/v1/users",
	]);
	expect(fixture.providerUrls[1]?.searchParams.get("deptId")).toBe(
		currentDepartmentChild.billDeptId,
	);
	expect(fixture.readSettlementContext()?.feeUploadStage).toBe("fee_uploaded");
});

test.each([
	{
		name: "缺少 billDeptId",
		children: [{ ...currentDepartmentChild, billDeptId: null }],
		error: /billDeptId is required/,
	},
	{
		name: "没有当前订单",
		children: [
			{ ...currentDepartmentChild, outTradeOrderId: "trade-other-001" },
		],
		error: /未匹配到/,
	},
	{
		name: "同费用科室冲突",
		children: [
			currentDepartmentChild,
			{ ...currentDepartmentChild, billDeptId: "different-department-id" },
		],
		error: /多个不同的 billDeptId/,
	},
])(
	"2.6.33 $name 时不以 .27 或预约科室兜底且不调用 6201",
	async ({ children, error }) => {
		const fixture = feeUploadDepartmentFixture(children);
		await expect(fixture.upload()).rejects.toThrow(error);
		expect(
			fixture.providerUrls.some((url) => url.pathname.endsWith("/depts")),
		).toBe(false);
		expect(fixture.feeUploads).toHaveLength(0);
		expect(fixture.readSettlementContext()?.feeUploadStage).toBe("pre_6201");
	},
);

function authorizationSelectionFixture(
	insuinfo: readonly Record<string, unknown>[],
	userQueryOptions: {
		userQueryPath?: string;
		userQueryPartnerSecret?: string | undefined;
	} = {},
	userQueryResponses: readonly unknown[] = [
		{
			code: 0,
			message: "success",
			pay_auth_no: "AUTH-SELECTION-001",
		},
	],
) {
	let requestCount = 0;
	let userQueryCount = 0;
	const relayRequests: Record<string, unknown>[] = [];
	const relayHeaders: Headers[] = [];
	let storedAuthorization: MedicalInsuranceAuthorizationContext | undefined;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {} as never,
		authorizations: {
			put: async (input: MedicalInsuranceAuthorizationContext) => {
				storedAuthorization = input;
				return input;
			},
		} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		foundationPath: "/mbs-fsi-jc/web/api/fsi/callService",
		zhongyangBaseUrl: "https://zhongyang.example",
		userQueryPartnerSecret: "synthetic-user-query-secret",
		...userQueryOptions,
		createId: () => "authorization-selection-001",
		now: () => new Date("2026-09-10T01:00:00.000Z"),
		fetcher: async (_input, init) => {
			requestCount += 1;
			const relayRequest = JSON.parse(String(init?.body));
			relayRequests.push(relayRequest);
			relayHeaders.push(new Headers(init?.headers));
			const data = String(relayRequest.path).startsWith(
				"/api/mipuserquery/userQuery/",
			)
				? userQueryResponses[userQueryCount++]
				: { baseinfo: {}, insuinfo };
			if (!data) throw new Error("Unexpected authorization query in fixture");
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-request-id": `request-selection-${requestCount}`,
				},
			});
		},
	});
	return {
		gateway,
		readStored: () => storedAuthorization,
		readRequestCount: () => requestCount,
		readRelayRequests: () => relayRequests,
		readRelayHeaders: () => relayHeaders,
	};
}

const authorizationSelectionInput = {
	authCode: "authorization-code-selection-001",
	patientId: "patient-selection-001",
	ownerUserId: "user-selection-001",
	orderId: "order-selection-001",
	providerSubject: "openid-selection-001",
	patient: {
		providerPatientId: "provider-selection-001",
		name: "参保地选择测试人",
		cardNo: "CARD-SELECTION-001",
		idNo: "140581199001010011",
		phone: "13800000000",
	},
};

test("医保 adapter 未显式覆盖 userQuery 时通过 relay 使用正式地址", async () => {
	const fixture = authorizationSelectionFixture([
		{ insutype: "310", psn_no: "psn-default-001", insuplc_admdvs: "140581" },
	]);
	await fixture.gateway.authorize(authorizationSelectionInput, context);
	expect(fixture.readRelayRequests()[0]).toMatchObject({
		base_url: "https://receiver.wecity.qq.com",
	});
	expect(fixture.readRelayRequests()[1]).toMatchObject({
		body: { insuplc_admdvs: "", mdtrtarea_admvs: "140581" },
	});
});

test.each([
	{
		label: "直接返回参保地",
		response: { pay_auth_no: "AUTH-CITY-DIRECT", city_id: "110000" },
		expectedCity: "110000",
	},
	{
		label: "嵌套返回参保地",
		response: {
			body: { data: { pay_auth_no: "AUTH-CITY-NESTED", city_id: "140500" } },
		},
		expectedCity: "140500",
	},
	{
		label: "兼容旧relay返回的JSON字符串",
		response: JSON.stringify({
			code: 0,
			output: { pay_auth_no: "AUTH-CITY-STRING", city_id: "510100" },
		}),
		expectedCity: "510100",
	},
	{
		label: "嵌套冲突沿用字段 helper 的直接字段优先级",
		response: {
			city_id: "440100",
			data: { pay_auth_no: "AUTH-CITY-PRECEDENCE", city_id: "110000" },
		},
		expectedCity: "440100",
	},
])(
	"首次1101使用当次授权查询参保地：$label",
	async ({ response, expectedCity }) => {
		const fixture = authorizationSelectionFixture(
			[{ insutype: "310", psn_no: "psn-city-001", insuplc_admdvs: "140581" }],
			{},
			[response],
		);
		await fixture.gateway.authorize(authorizationSelectionInput, context);
		expect(fixture.readRelayRequests()[1]).toMatchObject({
			body: { insuplc_admdvs: expectedCity, mdtrtarea_admvs: "140581" },
		});
		// 首次查询路由不覆盖 1101 返回的真实参保地选择。
		expect(fixture.readStored()).toMatchObject({
			insuplcAdmdvs: "140581",
			regionCode: "140581",
		});
	},
);

test("同一gateway多次授权的首次1101参保地不串单，缺失时保持空串", async () => {
	const fixture = authorizationSelectionFixture(
		[
			{
				insutype: "310",
				psn_no: "psn-city-sequence",
				insuplc_admdvs: "140581",
			},
		],
		{},
		[
			{ pay_auth_no: "AUTH-CITY-FIRST", city_id: "110000" },
			{ pay_auth_no: "AUTH-CITY-SECOND", city_id: "140500" },
			{ pay_auth_no: "AUTH-CITY-MISSING" },
		],
	);
	for (let index = 0; index < 3; index += 1) {
		await fixture.gateway.authorize(
			{
				...authorizationSelectionInput,
				orderId: `order-city-${index}`,
				authCode: `authorization-city-${index}`,
			},
			context,
		);
	}
	const foundationRequests = fixture
		.readRelayRequests()
		.filter((request) => request.base_url === "https://foundation.example");
	expect(foundationRequests).toHaveLength(3);
	for (const [index, expectedCity] of ["110000", "140500", ""].entries()) {
		expect(foundationRequests[index]).toMatchObject({
			body: { insuplc_admdvs: expectedCity, mdtrtarea_admvs: "140581" },
		});
	}
});

test("userQuery 签名只透传给医保授权接口，不污染 relay 或 1101 请求", async () => {
	const fixture = authorizationSelectionFixture(
		[
			{
				insutype: "310",
				psn_no: "psn-signature-001",
				insuplc_admdvs: "140581",
			},
		],
		{ userQueryPath: "/api/mipuserquery/userQuery/synthetic-partner" },
	);
	await fixture.gateway.authorize(authorizationSelectionInput, context);
	const [queryRequest, foundationRequest] = fixture.readRelayRequests();
	expect(queryRequest).toMatchObject({
		path: "/api/mipuserquery/userQuery/synthetic-partner",
		body: {
			qrcode: authorizationSelectionInput.authCode,
			openid: authorizationSelectionInput.providerSubject,
		},
		headers: {
			"Content-Type": "application/json",
			"god-portal-timestamp": "1789002000000",
			"god-portal-request-id": expect.stringMatching(/^[a-f0-9]{32}$/u),
			"god-portal-signature":
				"7b0cb6cc727b35cc9633c4b953b8bb074cd5a3e3e5bf82850d60ef1211f385b9",
		},
	});
	expect(
		Object.keys(queryRequest?.headers as Record<string, unknown>).sort(),
	).toEqual([
		"Content-Type",
		"god-portal-request-id",
		"god-portal-signature",
		"god-portal-timestamp",
	]);
	expect(foundationRequest?.headers).toEqual({
		"Content-Type": "application/json",
	});
	for (const headers of fixture.readRelayHeaders()) {
		expect(headers.get("authorization")).toBe("Bearer synthetic-token");
		expect(headers.has("god-portal-signature")).toBe(false);
	}
	expect(JSON.stringify(fixture.readRelayRequests())).not.toContain(
		"synthetic-user-query-secret",
	);
	expect(JSON.stringify(fixture.readStored())).not.toContain(
		"synthetic-user-query-secret",
	);
});

test.each([undefined, "", " \t "])(
	"授权配置没有 partnerSecret 时拒绝发送未签名请求",
	async (userQueryPartnerSecret) => {
		const fixture = authorizationSelectionFixture([], {
			userQueryPartnerSecret,
		});
		await expect(
			fixture.gateway.authorize(authorizationSelectionInput, context),
		).rejects.toMatchObject({ name: "AdapterNotConfiguredError" });
		expect(fixture.readRequestCount()).toBe(0);
		expect(fixture.readStored()).toBeUndefined();
	},
);

test("授权路径包含额外片段时在 Provider 请求前拒绝", async () => {
	const fixture = authorizationSelectionFixture([], {
		userQueryPath: "/api/mipuserquery/userQuery/synthetic-partner?other=1",
	});
	await expect(
		fixture.gateway.authorize(authorizationSelectionInput, context),
	).rejects.toMatchObject({ name: "AdapterNotConfiguredError" });
	expect(fixture.readRequestCount()).toBe(0);
});

test("1101同险种多条同参保地不依赖返回顺序", async () => {
	const fixture = authorizationSelectionFixture([
		{
			insutype: "310",
			psn_no: "psn-selection-001",
			insuplc_admdvs: "140581",
			psn_insu_stas: "0",
		},
		{
			insuType: "310",
			psnNo: "psn-selection-001",
			insuplcAdmdvs: "140581",
			psnInsuStas: "1",
		},
		{
			insutype: "390",
			psn_no: "psn-selection-001",
			insuplc_admdvs: "140500",
		},
	]);

	await expect(
		fixture.gateway.authorize(authorizationSelectionInput, {
			traceId: "trace-selection-same-area-001",
			idempotencyKey: "idem-selection-same-area-001",
		}),
	).resolves.toMatchObject({
		authorizationId: "authorization-selection-001",
		regionCode: "140581",
	});
	expect(fixture.readStored()).toMatchObject({
		psnNo: "psn-selection-001",
		insutype: "310",
		insuplcAdmdvs: "140581",
	});
});

test("1101跳过暂停险种记录并选择有效参保地", async () => {
	const fixture = authorizationSelectionFixture([
		{
			insutype: "310",
			psn_no: "psn-selection-001",
			insuplc_admdvs: "140581",
			psn_insu_stas: "1",
		},
		{
			insutype: "310",
			psn_no: "psn-selection-001",
			insuplc_admdvs: "140500",
			psn_insu_stas: "0",
		},
	]);

	await expect(
		fixture.gateway.authorize(authorizationSelectionInput, {
			traceId: "trace-selection-conflict-001",
			idempotencyKey: "idem-selection-conflict-001",
		}),
	).resolves.toMatchObject({ regionCode: "140581" });
	expect(fixture.readRequestCount()).toBe(2);
	expect(fixture.readStored()).toMatchObject({
		insutype: "310",
		insuplcAdmdvs: "140581",
	});
});

test("1101仅返回有效居民险种390时继续医保流程", async () => {
	const fixture = authorizationSelectionFixture([
		{
			insutype: "390",
			psn_no: "psn-resident-001",
			insuplc_admdvs: "140581",
			psn_insu_stas: "1",
		},
	]);

	await expect(
		fixture.gateway.authorize(authorizationSelectionInput, {
			traceId: "trace-selection-resident-001",
			idempotencyKey: "idem-selection-resident-001",
		}),
	).resolves.toMatchObject({ regionCode: "140581" });
	expect(fixture.readStored()).toMatchObject({
		psnNo: "psn-resident-001",
		insutype: "390",
		insuplcAdmdvs: "140581",
	});
});

test("授权查询按 family_pay_auth_no 判定亲情付并保存绑卡人身份", async () => {
	let requestCount = 0;
	let foundationForwardBody: Record<string, unknown> | undefined;
	let storedAuthorization: MedicalInsuranceAuthorizationContext | undefined;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {} as never,
		authorizations: {
			put: async (input: MedicalInsuranceAuthorizationContext) => {
				storedAuthorization = input;
				return input;
			},
		} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		foundationPath: "/mbs-fsi-jc/web/api/fsi/callService",
		zhongyangBaseUrl: "https://zhongyang.example",
		createId: () => "authorization-family-001",
		userQueryPartnerSecret: "synthetic-user-query-secret",
		now: () => new Date("2026-09-09T01:00:00.000Z"),
		fetcher: async (_url, init) => {
			requestCount += 1;
			if (requestCount === 2 && typeof init?.body === "string") {
				foundationForwardBody = JSON.parse(init.body) as Record<
					string,
					unknown
				>;
			}
			const data =
				requestCount === 1
					? {
							code: 0,
							message: "success",
							pay_auth_no: "",
							family_pay_auth_no: "AUTH-FAMILY-001",
							city_id: "110000",
							user_name: "当前绑卡人",
							user_card_no: "140581198001010022",
						}
					: {
							baseinfo: {},
							insuinfo: [
								{
									insutype: "310",
									psn_no: "psn-family-001",
									insuplc_admdvs: "140581",
								},
							],
						};
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-request-id": `request-family-${requestCount}`,
				},
			});
		},
	});

	await expect(
		gateway.authorize(
			{
				authCode: "authorization-code-family-001",
				patientId: "patient-family-001",
				ownerUserId: "user-family-001",
				orderId: "order-family-001",
				providerSubject: "openid-family-001",
				patient: {
					providerPatientId: "provider-family-001",
					name: "选中儿童",
					cardNo: "CARD-FAMILY-001",
					idNo: "140581201501010011",
					phone: "13800000000",
				},
			},
			{
				traceId: "trace-family-001",
				idempotencyKey: "idempotency-family-001",
			},
		),
	).resolves.toMatchObject({ authorizationId: "authorization-family-001" });
	expect(requestCount).toBe(2);
	expect(foundationForwardBody).toMatchObject({
		base_url: "https://foundation.example",
		path: "/mbs-fsi-jc/web/api/fsi/callService",
		body: {
			insuplc_admdvs: "110000",
			mdtrtarea_admvs: "140581",
			input: {
				data: {
					psn_name: "选中儿童",
					certno: "140581201501010011",
					mdtrt_cert_no: "AUTH-FAMILY-001",
				},
			},
		},
	});
	expect(storedAuthorization).toMatchObject({
		payAuthNo: "AUTH-FAMILY-001",
		payForRelatives: true,
		patient: {
			userName: "选中儿童",
			idNo: "140581201501010011",
		},
		payer: {
			userName: "当前绑卡人",
			idNo: "140581198001010022",
		},
	});
});

test("缺少关单上下文时在 Provider 边界前返回可识别错误", async () => {
	let providerCalled = false;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => order,
			getSettlementContext: async () => undefined,
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async () => {
			providerCalled = true;
			throw new Error("provider must not be called");
		},
	});

	await expect(
		gateway.cancel(
			{
				orderId: order.medicalOrderId,
				ownerUserId: order.ownerUserId,
				reason: "payment_in_progress",
			},
			context,
		),
	).rejects.toMatchObject({
		name: "ProviderRequestError",
		reason: "medical-insurance-cancellation-context-missing",
		failureStage: "validation",
		responseInvalid: false,
		requestOutcome: "not_sent",
		operation: "medical-insurance.2.6.65.6",
	});

	expect(providerCalled).toBe(false);
});

test("重授权不校验旧支付流水，只调用 .6 取消结算", async () => {
	const providerPaths: string[] = [];
	const medicalOrder = {
		...order,
		medicalOrderId: "medical-order-reauthorization-001",
		ownerUserId: "user-reauthorization-001",
		businessType: "registration",
	} as MedicalInsuranceOrder;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () =>
				({
					businessId: "business-reauthorization-001",
					hospitalId: "10389001",
					payingId: "paying-reauthorization-001",
				}) as MedicalInsuranceSettlementContext,
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (url) => {
			const requestUrl =
				typeof url === "string"
					? url
					: url instanceof URL
						? url.toString()
						: url.url;
			const path = new URL(requestUrl).pathname;
			providerPaths.push(path);
			const data = path.endsWith("/pay-close")
				? { success: true, data: { revokePayRecords: [{ status: "3" }] } }
				: { success: true, data: { cancelStatus: "1" } };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-request-id": `request-reauthorization-${providerPaths.length}`,
				},
			});
		},
	});

	await expect(
		gateway.cancel(
			{
				orderId: medicalOrder.medicalOrderId,
				ownerUserId: medicalOrder.ownerUserId,
				reason: "reauthorization",
			},
			{
				traceId: "trace-reauthorization-001",
				idempotencyKey: "idempotency-reauthorization-001",
			},
		),
	).resolves.toMatchObject({
		state: "cancelled",
		paymentState: "unknown",
		settlementState: "cancelled",
	});

	expect(providerPaths).toEqual([
		"/msun-middle-open-settlepay/api/v2/open/settle/cancel-settle",
	]);
});

test("门诊纯医保零元订单在 .32 成功后调用 .5", async () => {
	const providerPaths: string[] = [];
	const medicalOrder = {
		medicalOrderId: "medical-order-zero-cash-001",
		ownerUserId: "user-zero-cash-001",
		authorizationId: "authorization-zero-cash-001",
		payOrdId: "pay-order-zero-cash-001",
		amounts: {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 40,
			fundFen: 60,
		},
	} as MedicalInsuranceOrder;
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "10001",
		hospitalId: "10389001",
		patientId: "20001",
		chrgBchno: "fee-upload-batch-001",
		networkRegister: { memberNo: "30001" },
		outNetworkSettleMain: { transId: "40001" },
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "50001" }],
		tradeOrderIds: ["60001"],
		cashierUrl: "https://cashier.example/zero-cash",
	};
	let paymentOrderInput: Record<string, unknown> | undefined;
	let querySettlementCalls = 0;
	const settlement = {
		payOrdId: medicalOrder.payOrdId,
		ordStas: "6",
		totalFen: 100,
		cashFen: 0,
		personalAccountFen: 40,
		fundFen: 60,
	};
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {
			createPaymentOrder: async (input: Record<string, unknown>) => {
				paymentOrderInput = input;
				return {
					settlement,
					statusClass: "settlement_candidate",
					trace: {
						provider: "medical-insurance",
						operation: "medical-insurance.6202",
						requestId: "fsi-6202-zero-cash",
					},
				};
			},
			querySettlement: async () => {
				querySettlementCalls += 1;
				throw new Error("6301 must not be called after WeChat payment success");
			},
		} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {
			get: async () => ({ payAuthNo: "AUTH-ZERO-CASH" }),
		} as never,
		credentials: {
			get: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-zero-cash",
			}),
			getActiveForOrder: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-zero-cash",
				providerQueryIdentity: {},
			}),
		} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input) => {
			const url = new URL(String(input));
			providerPaths.push(url.pathname);
			const data = url.pathname.endsWith("/complete-settle")
				? { success: true, data: { isSettle: 1 } }
				: { success: true, data: { insur: "SUCCESS", settle: "SUCCESS" } };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const pending = await gateway.settle(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			authorizationId: medicalOrder.authorizationId as string,
			feeUploadId: "fee-upload-zero-cash-001",
			mdtrtId: "medical-treatment-zero-cash-001",
			acctUsedFlag: "1",
		},
		context,
	);
	expect(pending.state).toBe("cash_pending");
	expect(pending.providerStatus).toBe("6");
	expect(paymentOrderInput).toMatchObject({
		chrgBchno: "fee-upload-batch-001",
	});
	expect(paymentOrderInput?.orgBizSer).toEqual(expect.any(String));
	expect(paymentOrderInput?.orgBizSer).not.toBe(medicalOrder.medOrgOrd);
	// 模拟官方 INSURANCE_ONLY 查单成功后，支付后置分项已经产生的流水。
	settlementContext = {
		...settlementContext,
		payingId: "40001",
		tradingId: "70001",
	};

	const completed = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(completed.state).toBe("insurance_settled");
	expect(providerPaths).toEqual([
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(providerPaths).not.toContain(
		"/msun-yb-app-miop/v1/out-insur-settle-infos",
	);
	await expect(
		gateway.query(
			{
				orderId: medicalOrder.medicalOrderId,
				ownerUserId: medicalOrder.ownerUserId,
				cashPaymentConfirmed: true,
			},
			context,
		),
	).resolves.toMatchObject({ state: "insurance_settled" });
	expect(querySettlementCalls).toBe(0);
});

test("历史 5031 门诊医保合单只调用一次 .32 和一次 .5", async () => {
	const providerPaths: string[] = [];
	const providerBodies: Record<string, unknown>[] = [];
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-outpatient-split-001",
		hospitalId: "10389001",
		patientId: "patient-outpatient-split-001",
		networkRegister: {},
		outNetworkSettleMain: {
			settleBackNo: "stale-settlement-back-no",
			settleSource: 4001,
		},
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "detail-outpatient-split-001" }],
		tradeOrderIds: ["trade-outpatient-split-001"],
		postPaymentCompletedAt: "2026-09-16T03:00:00.000Z",
		settlementQuery6301: {
			queriedAt: "2026-09-16T03:00:00.000Z",
			providerRequestId: "fsi-6301-outpatient-split-001",
			payOrdId: "pay-order-outpatient-split-001",
			ordStas: "6",
			statusClass: "settlement_candidate",
			amounts: {
				totalFen: 100,
				cashFen: 20,
				personalAccountFen: 0,
				fundFen: 80,
			},
		},
		postPaymentComponents: [
			{
				componentId: "medical-order-outpatient-split-001:combined",
				kind: "combined",
				totalFen: 100,
				amountFen: 100,
				payModel: "H5",
				payTypeId: "2",
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 80 },
					{ kind: "wechat_cash", payTypeId: "5031", amountFen: 20 },
				],
				recordCode: "record-outpatient-combined-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-outpatient-combined-001",
				tradingId: "trading-outpatient-combined-001",
				updatedAt: "2026-09-16T03:00:00.000Z",
			},
		],
	};
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () =>
				({
					medicalOrderId: "medical-order-outpatient-split-001",
					ownerUserId: "user-outpatient-split-001",
					businessType: "outpatient",
					payOrdId: "pay-order-outpatient-split-001",
					amounts: {
						totalFen: 100,
						cashFen: 20,
						personalAccountFen: 0,
						fundFen: 80,
					},
				}) as MedicalInsuranceOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input, init) => {
			const path = new URL(String(input)).pathname;
			providerPaths.push(path);
			if (typeof init?.body === "string") {
				providerBodies.push(JSON.parse(init.body) as Record<string, unknown>);
			}
			const data = path.endsWith("/complete-settle")
				? {
						success: true,
						data: {
							outSettleVO: { settleStatus: "4" },
							outSettlePayFinishDTOList: [{ settleStatus: "4" }],
						},
					}
				: { success: true, data: { insur: "SUCCESS", settle: "SUCCESS" } };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const result = await gateway.query(
		{
			orderId: "medical-order-outpatient-split-001",
			ownerUserId: "user-outpatient-split-001",
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(result).toMatchObject({
		state: "insurance_settled",
		finality: "paid",
		authoritative: true,
	});
	expect(providerPaths).toEqual([
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	]);
	expect(providerBodies[0]?.outNetworkSettleMain).toMatchObject({
		settleBackNo: "medical-order-outpatient-split-001",
		transId: "paying-outpatient-combined-001",
	});
	expect(settlementContext.settlementCompletion?.status).toBe("succeeded");
	expect(settlementContext.selfPaySettlementWriteback).toBeUndefined();
	expect(settlementContext.selfPaySettlementCompletion).toBeUndefined();
});

test("历史拆分支付的两次 .32 都回传平台 orderId 到 settleBackNo", async () => {
	const medicalOrder = {
		medicalOrderId: "medical-order-legacy-split-001",
		ownerUserId: "user-legacy-split-001",
		businessType: "outpatient",
		payOrdId: "pay-order-legacy-split-001",
		amounts: {
			totalFen: 100,
			cashFen: 20,
			personalAccountFen: 0,
			fundFen: 80,
		},
	} as MedicalInsuranceOrder;
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-legacy-split-001",
		hospitalId: "hospital-legacy-split-001",
		patientId: "patient-legacy-split-001",
		insuredAreaCode: "140581",
		networkRegister: {},
		outNetworkSettleMain: { settleSource: 4003 },
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "detail-legacy-split-001" }],
		tradeOrderIds: ["trade-legacy-split-001"],
		postPaymentCompletedAt: "2026-09-29T00:00:00.000Z",
		postPaymentComponents: [
			{
				componentId: "medical-order-legacy-split-001:medical",
				kind: "medical",
				totalFen: 100,
				amountFen: 80,
				payModel: "H5",
				payTypeId: "2",
				recordCode: "record-legacy-medical-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-legacy-medical-001",
				tradingId: "trading-legacy-medical-001",
				updatedAt: "2026-09-29T00:00:00.000Z",
			},
			{
				componentId: "medical-order-legacy-split-001:wechat-cash",
				kind: "wechat_cash",
				totalFen: 100,
				amountFen: 20,
				payModel: "H5",
				payTypeId: "5031",
				recordCode: "record-legacy-wechat-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-legacy-wechat-001",
				tradingId: "trading-legacy-wechat-001",
				updatedAt: "2026-09-29T00:00:00.000Z",
			},
		],
	};
	const notifyBodies: Record<string, unknown>[] = [];
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input, init) => {
			const path = new URL(String(input)).pathname;
			if (
				path.endsWith("/settle-info/notify") &&
				typeof init?.body === "string"
			) {
				notifyBodies.push(JSON.parse(init.body) as Record<string, unknown>);
			}
			const data = path.endsWith("/settle-info/notify")
				? { success: true, data: { insur: "SUCCESS", settle: "SUCCESS" } }
				: { success: true, data: { isSettle: 1 } };
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const result = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);

	expect(result).toMatchObject({
		state: "insurance_settled",
		authoritative: true,
	});
	expect(notifyBodies).toHaveLength(2);
	for (const notifyBody of notifyBodies) {
		expect(notifyBody.outNetworkSettleMain).toMatchObject({
			settleBackNo: medicalOrder.medicalOrderId,
		});
	}
});

test(".32 失败后不重复提交同一结算 ID", async () => {
	const medicalOrder = {
		medicalOrderId: "medical-order-writeback-failed-001",
		ownerUserId: "user-writeback-failed-001",
		businessType: "registration",
		appointmentId: "appointment-writeback-failed-001",
		amounts: {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 0,
			fundFen: 100,
		},
	} as MedicalInsuranceOrder;
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-writeback-failed-001",
		hospitalId: "hospital-writeback-failed-001",
		patientId: "patient-writeback-failed-001",
		insuredAreaCode: "140581",
		networkRegister: { insuType: "310", memberNo: "member-001" },
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "detail-writeback-failed-001" }],
		tradeOrderIds: ["trade-writeback-failed-001"],
		postPaymentCompletedAt: "2026-09-16T03:00:00.000Z",
		postPaymentComponents: [
			{
				componentId: "medical-order-writeback-failed-001:fund",
				kind: "fund",
				totalFen: 100,
				amountFen: 100,
				payModel: "H5",
				payTypeId: "2",
				recordCode: "record-writeback-failed-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-writeback-failed-001",
				tradingId: "trading-writeback-failed-001",
				updatedAt: "2026-09-16T03:00:00.000Z",
			},
		],
		settlementQuery6301: {
			queriedAt: "2026-09-16T03:00:00.000Z",
			providerRequestId: "fsi-6301-writeback-failed-001",
			payOrdId: "pay-order-writeback-failed-001",
			ordStas: "6",
			statusClass: "settlement_candidate",
			amounts: {
				totalFen: 100,
				cashFen: 0,
				personalAccountFen: 0,
				fundFen: 100,
			},
		},
	};
	let notifyCalls = 0;
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input) => {
			if (new URL(String(input)).pathname.endsWith("/settle-info/notify")) {
				notifyCalls += 1;
			}
			return new Response(
				JSON.stringify({
					success: true,
					data: {
						insur: "SUCCESS",
						settle: "FAIL",
						memo: "PayNotifyService not found",
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		},
	});

	const input = {
		orderId: medicalOrder.medicalOrderId,
		ownerUserId: medicalOrder.ownerUserId,
		cashPaymentConfirmed: true,
	};
	const first = await gateway.query(input, context);
	const second = await gateway.query(input, context);
	expect(first).toMatchObject({
		state: "awaiting_confirmation",
		authoritative: false,
	});
	expect(second).toMatchObject({
		state: "awaiting_confirmation",
		authoritative: false,
	});
	expect(notifyCalls).toBe(1);
	expect(settlementContext.settlementWriteback).toMatchObject({
		status: "failed",
		providerStatus: "insur=SUCCESS,settle=FAIL",
	});
});

type WritebackComponent = NonNullable<
	MedicalInsuranceSettlementContext["postPaymentComponents"]
>[number];

function writebackComponent(
	kind: WritebackComponent["kind"],
	payTypeId: WritebackComponent["payTypeId"],
	amountFen: number,
	overrides: Partial<WritebackComponent> = {},
): WritebackComponent {
	return {
		componentId: `writeback:${kind}:${payTypeId}`,
		kind,
		payTypeId,
		totalFen: 100,
		amountFen,
		payModel: "H5",
		recordCode: `record-${kind}-${payTypeId}`,
		state: "succeeded",
		attempts: 1,
		payingId: `paying-${kind}-${payTypeId}`,
		tradingId: `trading-${kind}-${payTypeId}`,
		updatedAt: "2026-10-16T04:00:00.000Z",
		...overrides,
	};
}

function primaryMedicalWritebackFixture(
	components: readonly WritebackComponent[] | undefined,
	amounts: MedicalInsuranceAmounts = {
		totalFen: 100,
		cashFen: 0,
		personalAccountFen: 100,
		fundFen: 0,
	},
) {
	const medicalOrder = {
		medicalOrderId: "medical-primary-writeback-001",
		ownerUserId: "user-primary-writeback-001",
		businessType: "registration",
		appointmentId: "appointment-primary-writeback-001",
		amounts,
	} as MedicalInsuranceOrder;
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-primary-writeback-001",
		hospitalId: "10389001",
		patientId: "patient-primary-writeback-001",
		insuredAreaCode: "140581",
		networkRegister: {},
		outNetworkSettleMain: { transId: "stale-top-paying" },
		nationalUpDetailList: [],
		upDetailList: [{ detailId: "detail-primary-writeback-001" }],
		tradeOrderIds: ["trade-primary-writeback-001"],
		postPaymentPlanVersion: "sequenced-v1",
		postPaymentCompletedAt: "2026-10-16T04:00:00.000Z",
		payingId: "stale-top-paying",
		tradingId: "stale-top-trading",
		...(components === undefined ? {} : { postPaymentComponents: components }),
	};
	const requests: { path: string; body: Record<string, unknown> }[] = [];
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {} as never,
		credentials: {} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		fetcher: async (input, init) => {
			const path = new URL(String(input)).pathname;
			requests.push({ path, body: JSON.parse(String(init?.body)) });
			const data = path.endsWith("/settle-info/notify")
				? { insur: "SUCCESS", settle: "SUCCESS" }
				: { isSettle: 1 };
			return Response.json({ success: true, data });
		},
	});
	return {
		requests,
		readContext: () => settlementContext,
		query: () =>
			gateway.query(
				{
					orderId: medicalOrder.medicalOrderId,
					ownerUserId: medicalOrder.ownerUserId,
					cashPaymentConfirmed: true,
				},
				context,
			),
	};
}

test.each(["medical", "combined", "personal_account"] as const)(
	".32 纯个账使用成功的 %s / 5 流水并且不重放",
	async (kind) => {
		const account = writebackComponent(kind, "5", 100);
		const fixture = primaryMedicalWritebackFixture([account]);
		await expect(fixture.query()).resolves.toMatchObject({
			state: "insurance_settled",
			authoritative: true,
		});
		await fixture.query();
		expect(fixture.requests.map((request) => request.path)).toEqual([
			"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
			"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
		]);
		expect(fixture.requests[0]?.body).toMatchObject({
			tradingId: account.tradingId,
			outNetworkSettleMain: { transId: account.payingId },
		});
	},
);

test(".32 个账主组不被现金、减免或顶层旧流水覆盖", async () => {
	const account = writebackComponent("medical", "5", 80, { totalFen: 120 });
	const fixture = primaryMedicalWritebackFixture(
		[
			writebackComponent("wechat_cash", "5033", 20, { totalFen: 120 }),
			writebackComponent("hospital_reduce", "50", 20, { totalFen: 120 }),
			account,
		],
		{
			totalFen: 120,
			cashFen: 20,
			personalAccountFen: 80,
			fundFen: 0,
			otherPaymentFen: 20,
		},
	);
	await expect(fixture.query()).resolves.toMatchObject({ authoritative: true });
	const notify = fixture.requests[0]?.body;
	expect(notify).toMatchObject({
		tradingId: account.tradingId,
		outNetworkSettleMain: { transId: account.payingId },
	});
	expect(JSON.stringify(notify)).not.toContain("paying-wechat_cash");
	expect(JSON.stringify(notify)).not.toContain("paying-hospital_reduce");
});

test(".32 统筹优先于先出现的个账流水", async () => {
	const fund = writebackComponent("fund", "2", 40);
	const fixture = primaryMedicalWritebackFixture(
		[writebackComponent("personal_account", "5", 60), fund],
		{ totalFen: 100, cashFen: 0, personalAccountFen: 60, fundFen: 40 },
	);
	await fixture.query();
	expect(fixture.requests[0]?.body).toMatchObject({
		tradingId: fund.tradingId,
		outNetworkSettleMain: { transId: fund.payingId },
	});
});

test.each([
	{
		label: "只有现金",
		components: [writebackComponent("wechat_cash", "5033", 100)],
	},
	{
		label: "只有减免",
		components: [writebackComponent("hospital_reduce", "50", 100)],
	},
	{ label: "空分项", components: [] },
	{
		label: "医保组未成功",
		components: [writebackComponent("medical", "5", 100, { state: "pending" })],
	},
	{
		label: "医保组缺少流水",
		components: [writebackComponent("medical", "5", 100, { tradingId: "" })],
	},
	{
		label: "医保组金额为零",
		components: [writebackComponent("medical", "5", 0)],
	},
])(".32 $label 时不沿用顶层流水", async ({ components }) => {
	const fixture = primaryMedicalWritebackFixture(components);
	await expect(fixture.query()).resolves.toMatchObject({
		authoritative: false,
	});
	expect(fixture.requests).toEqual([]);
	expect(fixture.readContext().settlementWriteback).toBeUndefined();
});

test(".32 未保存分项的历史上下文仍使用原顶层流水", async () => {
	const fixture = primaryMedicalWritebackFixture(undefined);
	await expect(fixture.query()).resolves.toMatchObject({
		state: "insurance_settled",
		authoritative: true,
	});
	expect(fixture.requests[0]?.body).toMatchObject({
		tradingId: "stale-top-trading",
		outNetworkSettleMain: { transId: "stale-top-paying" },
	});
});

async function assertSequencedRegistrationMedicalWriteback(
	includePendingWechatCash: boolean,
) {
	const medicalOrder = {
		medicalOrderId: "medical-order-sequence-001",
		ownerUserId: "user-sequence-001",
		authorizationId: "authorization-sequence-001",
		feeUploadId: "fee-upload-sequence-001",
		payOrdId: "pay-order-sequence-001",
		businessType: "registration",
		orderType: "RegPay",
		amounts: {
			totalFen: 1000,
			cashFen: includePendingWechatCash ? 200 : 0,
			personalAccountFen: 0,
			fundFen: 800,
			otherPaymentFen: includePendingWechatCash ? 0 : 200,
		},
	} as MedicalInsuranceOrder;
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-sequence-001",
		businessCode: "trade-sequence-001",
		hospitalId: "10389001",
		patientId: "provider-patient-sequence-001",
		chrgBchno: "batch-sequence-001",
		insuredAreaCode: "140581",
		networkRegister: {
			insuType: "310",
			memberNo: "psn-sequence-001",
			chargeClassId: "charge-class-sequence-001",
			networkPatClassId: "network-class-sequence-001",
			outVisitRecordId: "visit-sequence-001",
		},
		outNetworkSettleMain: { transId: "paying-sequence-001" },
		nationalUpDetailList: [],
		upDetailList: [
			{
				amount: "10.00",
				chargeCode: "CHARGE-001",
				chargeId: "CHARGE-ID-001",
				chargeName: "挂号费",
				networkItemCode: "ITEM-001",
				networkItemName: "挂号费",
				outBillId: "BILL-001",
				price: "10.00",
				quantity: 1,
				selfBurdenRatio: "0",
				createTime: "2026-09-15 19:00:00",
			},
		],
		tradeOrderIds: ["trade-sequence-001"],
		postPaymentPlanVersion: "sequenced-v1",
		payingId: "paying-sequence-001",
		tradingId: "trading-sequence-001",
		postPaymentComponents: [
			{
				componentId: "medical-order-sequence-001:medical",
				kind: "medical",
				totalFen: 1000,
				amountFen: includePendingWechatCash ? 800 : 1000,
				payModel: "H5",
				payTypeId: "2",
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 800 },
					...(includePendingWechatCash
						? []
						: [
								{
									kind: "hospital_reduce" as const,
									payTypeId: "50" as const,
									amountFen: 200,
								},
							]),
				],
				recordCode: "record-sequence-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-sequence-001",
				tradingId: "trading-sequence-001",
				updatedAt: "2026-09-15T19:01:00.000Z",
			},
			...(includePendingWechatCash
				? [
						{
							componentId: "medical-order-sequence-001:wechat_cash",
							kind: "wechat_cash" as const,
							totalFen: 1000,
							amountFen: 200,
							payModel: "H5" as const,
							payTypeId: "5033" as const,
							recordCode: "record-wechat-cash-sequence-001",
							state: "pending" as const,
							attempts: 0,
							updatedAt: "2026-09-15T19:01:00.000Z",
						},
					]
				: []),
		],
	};
	const providerPaths: string[] = [];
	const providerBodies: Array<{
		path: string;
		body: Record<string, unknown> | undefined;
	}> = [];
	let querySettlementCalls = 0;
	const settlement = {
		payOrdId: medicalOrder.payOrdId,
		ordStas: "6",
		totalFen: 1000,
		cashFen: includePendingWechatCash ? 200 : 0,
		personalAccountFen: 0,
		fundFen: 800,
		otherPaymentFen: includePendingWechatCash ? 0 : 200,
	};
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		legacyFsi: {
			createPaymentOrder: async () => ({
				settlement,
				statusClass: "settlement_candidate",
				settlementSource: {
					root: {
						feeSumamt: 10,
						fundPay: 8,
						psnAcctPay: 0,
						ownPayAmt: includePendingWechatCash ? 2 : 0,
					},
					preSetl: {
						mdtrt_id: "mdtrt-sequence-001",
						medfee_sumamt: "10.00",
						psn_no: "psn-sequence-001",
						psn_name: "顺序测试人",
						insutype: "310",
						clr_optins: "140581",
						exp_content: "{}",
					},
				},
				trace: {
					provider: "medical-insurance",
					operation: "medical-insurance.6202",
					requestId: "fsi-6202-sequence-001",
				},
			}),
			querySettlement: async () => {
				querySettlementCalls += 1;
				throw new Error("6301 must not be called after WeChat payment success");
			},
		} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
			saveSettlementContext: async (
				_owner: string,
				_orderId: string,
				next: MedicalInsuranceSettlementContext,
			) => {
				settlementContext = next;
			},
		} as never,
		authorizations: {
			get: async () => ({
				payAuthNo: "AUTH-SEQUENCE-001",
				insuplcAdmdvs: "140581",
				insutype: "310",
				patient: { idNo: "140581199001010011", userName: "顺序测试人" },
			}),
		} as never,
		credentials: {
			get: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-sequence-001",
			}),
			getActiveForOrder: async () => ({
				payOrdId: medicalOrder.payOrdId,
				payToken: "pay-token-sequence-001",
				providerQueryIdentity: {},
			}),
		} as never,
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		now: () => new Date("2026-09-15T19:01:00.000Z"),
		fetcher: async (input, init) => {
			const path = new URL(String(input)).pathname;
			providerPaths.push(path);
			providerBodies.push({
				path,
				body:
					typeof init?.body === "string"
						? (JSON.parse(init.body) as Record<string, unknown>)
						: undefined,
			});
			const data = path.endsWith("/complete-settle")
				? {
						success: true,
						data: {
							outSettleVO: { settleStatus: "4" },
							outSettlePayFinishDTOList: [{ settleStatus: "4" }],
						},
					}
				: {
						success: true,
						data: { insur: "SUCCESS", settle: "SUCCESS" },
					};
			return new Response(JSON.stringify(data), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		},
	});

	const pending = await gateway.settle(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			authorizationId: medicalOrder.authorizationId as string,
			feeUploadId: medicalOrder.feeUploadId as string,
			mdtrtId: "mdtrt-sequence-001",
			acctUsedFlag: "0",
		},
		context,
	);
	expect(pending.state).toBe("cash_pending");
	expect(providerPaths).toEqual([]);
	expect(settlementContext.outNetworkSettleMain).toMatchObject({
		mdtrtId: "mdtrt-sequence-001",
		insutype: "310",
		setlTime: "2026-09-16 03:01:00",
	});
	expect(settlementContext.postPaymentCompletedAt).toBeUndefined();
	expect(
		settlementContext.postPaymentComponents?.reduce(
			(sum, component) => sum + component.amountFen,
			0,
		),
	).toBe(settlement.totalFen);
	if (includePendingWechatCash) {
		const pendingWechatCash = settlementContext.postPaymentComponents?.find(
			(component) => component.kind === "wechat_cash",
		);
		expect(pendingWechatCash).toMatchObject({
			state: "pending",
			amountFen: 200,
			payTypeId: "5033",
		});
		expect(pendingWechatCash?.payingId).toBeUndefined();
		expect(pendingWechatCash?.tradingId).toBeUndefined();
	}

	if (includePendingWechatCash) {
		const waitingForWechatPayment = await gateway.query(
			{
				orderId: medicalOrder.medicalOrderId,
				ownerUserId: medicalOrder.ownerUserId,
			},
			context,
		);
		expect(waitingForWechatPayment).toMatchObject({
			state: "cash_pending",
			providerStatus: "waiting_for_wechat_payment",
			finality: "processing",
			authoritative: false,
		});
		expect(providerPaths).toEqual([]);
	}
	const finalized = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(finalized).toMatchObject({
		state: includePendingWechatCash ? "cash_pending" : "insurance_settled",
		providerStatus: includePendingWechatCash
			? "medical_writeback_completed_cash_pending"
			: "completion=outSettleVO.settleStatus=4",
		finality: "paid",
		authoritative: true,
	});
	const expectedProviderPaths = includePendingWechatCash
		? ["/msun-yb-app-miop/outSettle/v2/settle-info/notify"]
		: [
				"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
				"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
			];
	expect(providerPaths).toEqual(expectedProviderPaths);
	const repeated = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(repeated).toMatchObject({
		state: includePendingWechatCash ? "cash_pending" : "insurance_settled",
		providerStatus: includePendingWechatCash
			? "medical_writeback_completed_cash_pending"
			: "completion=outSettleVO.settleStatus=4",
		finality: "paid",
		authoritative: true,
	});
	expect(providerPaths).toEqual(expectedProviderPaths);
	expect(
		providerPaths.filter((path) => path.endsWith("/complete-settle")),
	).toHaveLength(includePendingWechatCash ? 0 : 1);
	expect(settlementContext.settlementWriteback).toMatchObject({
		status: "succeeded",
		providerStatus: "insur=SUCCESS,settle=SUCCESS",
	});
	if (includePendingWechatCash) {
		expect(settlementContext.settlementCompletion).toBeUndefined();
	} else {
		expect(settlementContext.settlementCompletion).toMatchObject({
			status: "succeeded",
			providerStatus: "completion=outSettleVO.settleStatus=4",
		});
	}
	const notifyBody = providerBodies.find((request) =>
		request.path.endsWith("/settle-info/notify"),
	)?.body;
	expect(notifyBody?.outNetworkSettleMain).toMatchObject({
		settleBackNo: "medical-order-sequence-001",
		transId: "paying-sequence-001",
		fixmedinsCode: "H14058101270",
		fixmedinsName: "高平市人民医院",
		insurOrgId: 10001,
		outVisitRecordId: -1,
		settleSource: 4003,
	});
	const notifyBodies = providerBodies
		.filter((request) => request.path.endsWith("/settle-info/notify"))
		.map((request) => request.body);
	expect(notifyBodies).toHaveLength(1);
	expect(notifyBodies[0]).toMatchObject({
		tradingId: "trading-sequence-001",
		outNetworkSettleMain: {
			settleBackNo: "medical-order-sequence-001",
			transId: "paying-sequence-001",
			settleSource: 4003,
		},
	});
	expect(JSON.stringify(providerBodies)).not.toContain(
		"paying-wechat-cash-sequence-001",
	);
	expect(JSON.stringify(providerBodies)).not.toContain(
		"trading-wechat-cash-sequence-001",
	);
	expect(notifyBody?.networkRegister).toMatchObject({
		insuTypeName: "职工基本医疗保险",
		medTypeName: "门诊挂号",
		netDiagnosCode: "Z00.001",
		netDiagnosName: "健康查体",
		offSiteType: 0,
		netRegSerial: "mdtrt-sequence-001",
	});
	expect(querySettlementCalls).toBe(0);
	expect(settlementContext.settlementQuery6301).toBeUndefined();
}

test("挂号医保流水严格按 .32 -> .5 完成且不调用 6301", async () => {
	await assertSequencedRegistrationMedicalWriteback(false);
});

test("sequenced-v1 新 5033 pending wechat_cash 只让医保段执行 .32", async () => {
	await assertSequencedRegistrationMedicalWriteback(true);
});
