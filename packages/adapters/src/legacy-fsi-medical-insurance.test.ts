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
	medicalTypeForBusiness,
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

test("纯医保零元订单必须经过 cashier-confirm 后才执行最终结算", async () => {
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
			querySettlement: async () => ({
				settlement: {
					payOrdId: medicalOrder.payOrdId,
					ordStas: "6",
					amounts: settlement,
				},
				statusClass: "settlement_candidate",
				trace: {
					provider: "medical-insurance",
					operation: "medical-insurance.6301",
					requestId: "fsi-6301-zero-cash",
				},
			}),
		} as never,
		orders: {
			findByMedicalOrderId: async () => medicalOrder,
			getSettlementContext: async () => settlementContext,
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
	expect(providerPaths).not.toContain(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);
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
	expect(providerPaths).toContain(
		"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
	);
});
