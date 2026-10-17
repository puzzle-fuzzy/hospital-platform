import { expect, test } from "bun:test";
import type {
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceQueryTaskRepository,
} from "@hospital/persistence";
import { MedicalInsuranceRegionUnsupportedError } from "./errors";
import { MedicalInsuranceRegistrationService } from "./registration-service";
import { MedicalInsuranceWechatPaymentService } from "./wechat-payment-service";

const now = "2026-10-16T08:00:00.000Z";
const context = {
	traceId: "region-guard-trace",
	idempotencyKey: "region-guard-request",
};

function order(
	overrides: Partial<MedicalInsuranceOrder> = {},
): MedicalInsuranceOrder {
	return {
		medicalOrderId: "medical-region-001",
		ownerUserId: "owner-region-001",
		patientId: "patient-region-001",
		appointmentId: "appointment-region-001",
		businessId: "appointment-region-001",
		businessType: "registration",
		orderType: "RegPay",
		authorizationId: null,
		feeUploadId: null,
		payOrdId: null,
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		idempotencyKey: context.idempotencyKey,
		medOrgOrd: "medical-region-001",
		chrgBchno: "batch-region-001",
		status: "created",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 1,
		createdAt: now,
		updatedAt: now,
		...overrides,
	};
}

function authorization(
	region: string,
	overrides: Partial<MedicalInsuranceAuthorizationContext> = {},
): MedicalInsuranceAuthorizationContext {
	return {
		authorizationId: "authorization-region-001",
		ownerUserId: "owner-region-001",
		medicalOrderId: "medical-region-001",
		providerSubject: "openid-fixture",
		payAuthNo: "auth-fixture",
		patient: { idNo: "identity-fixture", userName: "测试", idType: "01" },
		psnNo: "psn-fixture",
		insutype: "310",
		insuplcAdmdvs: region,
		insuCode: "140581",
		regionCode: "140581",
		createdAt: now,
		expiresAt: "2026-10-16T08:15:00.000Z",
		...overrides,
	};
}

function settlement(
	overrides: Partial<MedicalInsuranceSettlementContext> = {},
): MedicalInsuranceSettlementContext {
	return {
		businessId: "appointment-region-001",
		hospitalId: "hospital-fixture",
		patientId: "provider-region-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		insuredAreaCode: "330106",
		...overrides,
	};
}

function fixture(region = "330106") {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	let selectedPatientId = "patient-region-001";
	let currentNow = new Date(now);
	let hospitalWrites = 0;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations,
		appointments: {
			findRegistration: async () => ({
				appointmentId: "appointment-region-001",
				ownerUserId: "owner-region-001",
				patientId: selectedPatientId,
				providerPatientId: "provider-region-001",
				providerAppointmentId: "provider-appointment-001",
				status: "booked",
				totalFen: 1000,
				createdAt: now,
				departmentName: "科室",
				doctorName: "医生",
				workDate: "2026-10-16",
				shiftName: "上午",
				sourceSerialNumber: "1",
			}),
		} as never,
		patients: {
			listByOwner: async () => [
				{ id: selectedPatientId, relationship: "self" },
			],
			resolveProviderReference: async () => ({
				patientId: selectedPatientId,
				provider: "zhongyang",
				providerPatientId: "provider-region-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				providerSubject: "openid-fixture",
				unionId: "union-fixture",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: {
					name: "测试",
					idNo: "identity-fixture",
					cardNo: "card-fixture",
				},
			}),
		} as never,
		outpatientPayments: {
			resolvePaymentContext: async () => ({
				recordId: "outpatient-region-001",
				providerPatientId: "provider-region-001",
				totalFen: 1000,
				outTradeOrderIds: ["trade-fixture"],
			}),
		} as never,
		medicalInsurance: {
			authorize: async (input: { orderId: string }) => {
				await authorizations.put(
					authorization(region, { medicalOrderId: input.orderId }),
				);
				return {
					authorizationId: "authorization-region-001",
					trace: { requestId: "1101-fixture" },
				};
			},
			uploadFees: async () => {
				hospitalWrites += 1;
				return {
					feeUploadId: "fee-fixture",
					payOrdId: "pay-fixture",
					payTokenHash: "a".repeat(64),
					mdtrtId: "mdtrt-fixture",
					acctUsedFlag: "0",
					trace: { requestId: "6201-fixture" },
				};
			},
		} as never,
		now: () => currentNow,
		createId: () => "medical-region-001",
	});
	return {
		orders,
		authorizations,
		service,
		setPatient: (patientId: string) => {
			selectedPatientId = patientId;
		},
		setNow: (value: string) => {
			currentNow = new Date(value);
		},
		hospitalWrites: () => hospitalWrites,
	};
}

test("1101 选中险种非 140581 在 .1/6201 前拒绝，空单本地取消且保留有效资格审计", async () => {
	const f = fixture();
	await expect(
		f.service.authorize({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			authCode: "code-fixture",
			context,
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceRegionUnsupportedError);
	expect(f.hospitalWrites()).toBe(0);
	expect(
		await f.orders.findByMedicalOrderId("medical-region-001"),
	).toMatchObject({
		status: "cancelled",
		authorizationId: "authorization-region-001",
		feeUploadId: null,
		payOrdId: null,
	});
	expect(
		await f.service.authorizationContext({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			context,
		}),
	).toMatchObject({ medicalInsurancePaymentEligibility: "unsupported" });
	// 同一有效授权不能串到另一个就诊人，也不能在授权过期后沿用。
	f.setPatient("patient-region-002");
	expect(
		await f.service.authorizationContext({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			context,
		}),
	).toMatchObject({ medicalInsurancePaymentEligibility: "unknown" });
	f.setPatient("patient-region-001");
	f.setNow("2026-10-16T08:16:00.000Z");
	expect(
		await f.service.authorizationContext({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			context,
		}),
	).toMatchObject({ medicalInsurancePaymentEligibility: "unknown" });
});

test("140581 授权与费用上传正常，通过 1101 参保地而非 insuCode/身份证判断", async () => {
	const f = fixture("140581");
	await expect(
		f.service.authorize({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			authCode: "code-fixture",
			context,
		}),
	).resolves.toMatchObject({ status: "authorized" });
	expect(
		await f.service.authorizationContext({
			ownerUserId: "owner-region-001",
			appointmentId: "appointment-region-001",
			context,
		}),
	).toMatchObject({ medicalInsurancePaymentEligibility: "supported" });
	await expect(
		f.service.uploadFees({
			ownerUserId: "owner-region-001",
			orderId: "medical-region-001",
			context,
		}),
	).resolves.toMatchObject({ status: "fee_uploaded" });
	expect(f.hospitalWrites()).toBe(1);
});

test("门诊医保同样在授权后阻止未开通地区且不产生医院费用上传", async () => {
	const f = fixture("140500");
	await expect(
		f.service.authorizeOutpatient({
			ownerUserId: "owner-region-001",
			recordId: "outpatient-region-001",
			patientId: "patient-region-001",
			authCode: "code-fixture",
			context,
		}),
	).rejects.toBeInstanceOf(MedicalInsuranceRegionUnsupportedError);
	expect(
		await f.orders.findByMedicalOrderId("medical-region-001"),
	).toMatchObject({ status: "cancelled", businessType: "outpatient" });
	expect(
		await f.service.outpatientAuthorizationContext({
			ownerUserId: "owner-region-001",
			recordId: "outpatient-region-001",
			patientId: "patient-region-001",
			context,
		}),
	).toMatchObject({ medicalInsurancePaymentEligibility: "unsupported" });
	expect(f.hospitalWrites()).toBe(0);
});

test("旧 fees 入口不能绕过地区门禁；已有医院上下文时不能直接本地作废", async () => {
	for (const businessType of ["registration", "outpatient"] as const) {
		for (const hasHospitalContext of [false, true]) {
			const f = fixture();
			await f.orders.insert(
				order({
					authorizationId: "authorization-region-001",
					businessType,
					orderType: businessType === "registration" ? "RegPay" : "DiagPay",
					businessId:
						businessType === "registration"
							? "appointment-region-001"
							: "outpatient-region-001",
				}),
			);
			await f.authorizations.put(authorization("330106"));
			if (hasHospitalContext)
				await f.orders.saveSettlementContext(
					"owner-region-001",
					"medical-region-001",
					settlement({ feeUploadStage: "pre_6201" }),
				);
			await expect(
				f.service.uploadFees({
					ownerUserId: "owner-region-001",
					orderId: "medical-region-001",
					context,
				}),
			).rejects.toBeInstanceOf(MedicalInsuranceRegionUnsupportedError);
			expect(f.hospitalWrites()).toBe(0);
			expect(
				(await f.orders.findByMedicalOrderId("medical-region-001"))?.status,
			).toBe(hasHospitalContext ? "created" : "cancelled");
		}
	}
});

test("过期授权与缺失参保地都不能进入新费用上传", async () => {
	for (const auth of [
		authorization("140581", { expiresAt: "2026-10-16T07:59:00.000Z" }),
		authorization(""),
	]) {
		const f = fixture();
		await f.orders.insert(order({ authorizationId: auth.authorizationId }));
		await f.authorizations.put(auth);
		await expect(
			f.service.uploadFees({
				ownerUserId: "owner-region-001",
				orderId: "medical-region-001",
				context,
			}),
		).rejects.toBeInstanceOf(Error);
		expect(f.hospitalWrites()).toBe(0);
	}
});

test("外地 pending 纯个人账户及 HIS 预下单均不能新建医保混合单；已有微信单可查询恢复", async () => {
	for (const hisPrepayCreated of [false, true]) {
		const orders = createInMemoryMedicalInsuranceOrderRepository();
		const authorizations =
			createInMemoryMedicalInsuranceAuthorizationRepository();
		await orders.insert(
			order({
				authorizationId: "authorization-region-001",
				status: "cash_pending",
				payOrdId: "pay-fixture",
				wechatPaymentState: "not_started",
				amounts: {
					totalFen: 1000,
					cashFen: 0,
					fundFen: 0,
					personalAccountFen: 1000,
				},
			}),
		);
		await authorizations.put(authorization("330106"));
		await orders.saveSettlementContext(
			"owner-region-001",
			"medical-region-001",
			settlement({
				postPaymentPlanVersion: "sequenced-v1",
				...(hisPrepayCreated
					? { payingId: "paying-fixture", tradingId: "trading-fixture" }
					: {}),
				postPaymentComponents: [
					{
						componentId: "medical-fixture",
						kind: "medical",
						payTypeId: "5",
						amountFen: 1000,
						totalFen: 1000,
						payModel: "H5",
						recordCode: "record-fixture",
						state: "pending",
						updatedAt: now,
						attempts: 0,
						payTypeParams: [
							{ kind: "personal_account", payTypeId: "5", amountFen: 1000 },
						],
					},
				],
			}),
		);
		let bridgeCalls = 0;
		let createCalls = 0;
		const service = new MedicalInsuranceWechatPaymentService({
			orders,
			authorizations,
			queryTasks: createInMemoryMedicalInsuranceQueryTaskRepository(),
			identityUsers: {} as never,
			patients: {} as never,
			wechatPayment: {
				createMixedOrder: async () => {
					createCalls += 1;
					throw new Error("must not create");
				},
			} as never,
			pluginPaymentBridge: {
				prepareSplitPaymentsBeforeOfficialWechatPayment: async () => {
					bridgeCalls += 1;
				},
			} as never,
			confirmCashPayment: async () => {
				throw new Error("must not complete");
			},
			now: () => new Date(now),
		});
		await expect(
			service.create({
				ownerUserId: "owner-region-001",
				orderId: "medical-region-001",
				context,
			}),
		).rejects.toBeInstanceOf(MedicalInsuranceRegionUnsupportedError);
		expect(bridgeCalls).toBe(0);
		expect(createCalls).toBe(0);
		const original = await orders.findByMedicalOrderId("medical-region-001");
		if (!original) throw new Error("fixture missing");
		await orders.applySettlement(original.medicalOrderId, original.version, {
			status: original.status,
			ordStas: original.ordStas,
			amounts: original.amounts,
			setlType: original.setlType,
			revsTokenHash: null,
			revsTokenExpiresAt: null,
			wechatMixTradeNo: "mix-fixture",
			wechatOutTradeNo: "out-fixture",
		});
		await expect(
			service.query({
				ownerUserId: "owner-region-001",
				orderId: "medical-region-001",
				context,
			}),
		).resolves.toMatchObject({
			status: "cash_pending",
			mixTradeNo: "mix-fixture",
		});
		expect(bridgeCalls).toBe(0);
		expect(createCalls).toBe(0);
	}
});
