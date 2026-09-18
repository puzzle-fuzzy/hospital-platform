import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
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

function authorizationSelectionFixture(
	insuinfo: readonly Record<string, unknown>[],
) {
	let requestCount = 0;
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
		createId: () => "authorization-selection-001",
		now: () => new Date("2026-09-10T01:00:00.000Z"),
		fetcher: async () => {
			requestCount += 1;
			const data =
				requestCount === 1
					? {
							code: 0,
							message: "success",
							pay_auth_no: "AUTH-SELECTION-001",
						}
					: { baseinfo: {}, insuinfo };
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

test("门诊医保合单只调用一次 .32 和一次 .5", async () => {
	const providerPaths: string[] = [];
	const providerBodies: Record<string, unknown>[] = [];
	let settlementContext: MedicalInsuranceSettlementContext = {
		businessId: "business-outpatient-split-001",
		hospitalId: "10389001",
		patientId: "patient-outpatient-split-001",
		networkRegister: {},
		outNetworkSettleMain: { settleSource: 4001 },
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
		transId: "paying-outpatient-combined-001",
	});
	expect(settlementContext.settlementCompletion?.status).toBe("succeeded");
	expect(settlementContext.selfPaySettlementWriteback).toBeUndefined();
	expect(settlementContext.selfPaySettlementCompletion).toBeUndefined();
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

test("挂号微信支付成功后才直接调用 .32，不调用 6301", async () => {
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
			cashFen: 200,
			personalAccountFen: 0,
			fundFen: 800,
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
		outNetworkSettleMain: { transId: "paying-hospital-reduce" },
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
		postPaymentCompletedAt: "2026-09-15T19:01:00.000Z",
		payingId: "paying-sequence-001",
		tradingId: "trading-sequence-001",
		postPaymentComponents: [
			{
				componentId: "medical-order-sequence-001:hospital-reduce",
				kind: "hospital_reduce",
				totalFen: 1000,
				amountFen: 200,
				payModel: "H5",
				payTypeId: "50",
				recordCode: "record-hospital-reduce-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-hospital-reduce",
				tradingId: "trading-hospital-reduce",
				updatedAt: "2026-09-15T19:01:00.000Z",
			},
			{
				componentId: "medical-order-sequence-001:fund",
				kind: "fund",
				totalFen: 1000,
				amountFen: 800,
				payModel: "H5",
				payTypeId: "2",
				recordCode: "record-sequence-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-sequence-001",
				tradingId: "trading-sequence-001",
				updatedAt: "2026-09-15T19:01:00.000Z",
			},
			{
				componentId: "medical-order-sequence-001:wechat_cash",
				kind: "wechat_cash",
				totalFen: 1000,
				amountFen: 200,
				payModel: "MINI_PROGRAM",
				payTypeId: "5031",
				recordCode: "record-wechat-cash-sequence-001",
				state: "succeeded",
				attempts: 1,
				payingId: "paying-wechat-cash-sequence-001",
				tradingId: "trading-wechat-cash-sequence-001",
				updatedAt: "2026-09-15T19:01:00.000Z",
			},
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
		cashFen: 200,
		personalAccountFen: 0,
		fundFen: 800,
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
						ownPayAmt: 2,
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
	const finalized = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(finalized).toMatchObject({
		state: "insurance_settled",
		providerStatus: "insur=SUCCESS,settle=SUCCESS",
		finality: "paid",
		authoritative: true,
	});
	expect(providerPaths).toEqual([
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
	]);
	const repeated = await gateway.query(
		{
			orderId: medicalOrder.medicalOrderId,
			ownerUserId: medicalOrder.ownerUserId,
			cashPaymentConfirmed: true,
		},
		context,
	);
	expect(repeated).toMatchObject({
		state: "insurance_settled",
		providerStatus: "insur=SUCCESS,settle=SUCCESS",
		finality: "paid",
		authoritative: true,
	});
	expect(providerPaths).toEqual([
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
		"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
	]);
	const notifyBody = providerBodies.find((request) =>
		request.path.endsWith("/settle-info/notify"),
	)?.body;
	expect(notifyBody?.outNetworkSettleMain).toMatchObject({
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
	expect(notifyBodies[1]?.outNetworkSettleMain).toMatchObject({
		transId: "paying-wechat-cash-sequence-001",
		settleSource: 4003,
	});
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
});
