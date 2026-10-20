import { expect, test } from "bun:test";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
} from "@hospital/persistence";
import { MedicalInsuranceRegistrationService } from "./registration-service";

async function preparedFixture(
	expired = false,
	businessType: "outpatient" | "registration" = "outpatient",
) {
	const clock = new Date();
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	const original: MedicalInsuranceOrder = {
		medicalOrderId: "medical-prepared-001",
		ownerUserId: "owner-prepared-001",
		patientId: "patient-prepared-001",
		businessType,
		orderType: businessType === "outpatient" ? "DiagPay" : "RegPay",
		businessId: "outpatient-prepared-001",
		...(businessType === "registration"
			? { appointmentId: "outpatient-prepared-001" }
			: {}),
		authorizationId: "auth-prepared-old",
		feeUploadId: null,
		idempotencyKey: "prepared-original-key",
		medOrgOrd: "medical-prepared-001",
		chrgBchno: "batch-prepared-001",
		payOrdId: null,
		payTokenHash: null,
		mdtrtId: null,
		acctUsedFlag: null,
		status: "fee_upload_pending",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		version: 3,
		createdAt: new Date(clock.getTime() - 600000).toISOString(),
		updatedAt: new Date(clock.getTime() - 600000).toISOString(),
	};
	await orders.insert(original);
	const anchor: MedicalInsuranceSettlementContext = {
		businessId: "8843869012141618309",
		businessCode: "MZJSD-PREPARED-001",
		hospitalId: "10389001",
		patientId: "his-patient-prepared-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["8843868963491158916", "8843868963491158917"],
		insuredAreaCode: "140581",
		feeUploadStage: "pre_6201",
		settlementAmountFen: 10045,
		outpatientPaymentRecord: {
			recordId: "outpatient-prepared-001",
			status: "unpaid",
			billDate: "2026-10-17 10:24:00",
			amountFen: 10045,
		},
	};
	await orders.saveSettlementContext(
		original.ownerUserId,
		original.medicalOrderId,
		anchor,
	);
	const authorization = (authorizationId: string, expiresAt: string) => ({
		authorizationId,
		ownerUserId: original.ownerUserId,
		medicalOrderId: original.medicalOrderId,
		providerSubject: "synthetic-openid",
		payAuthNo: "synthetic-auth",
		patient: { idNo: "synthetic-identity", userName: "测试", idType: "01" },
		psnNo: "synthetic-person",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "140581",
		createdAt: clock.toISOString(),
		expiresAt,
	});
	await authorizations.put(
		authorization(
			"auth-prepared-old",
			new Date(clock.getTime() + (expired ? -60000 : 600000)).toISOString(),
		),
	);
	let feeCalls = 0,
		authCalls = 0,
		resolveCalls = 0;
	let blockFees: Promise<void> | undefined;
	let blockAuth: Promise<void> | undefined;
	let startAuth: (() => void) | undefined;
	let startFee: (() => void) | undefined;
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations,
		appointments: {
			findRegistration: async () => ({
				appointmentId: original.businessId,
				patientId: original.patientId,
				providerPatientId: "his-patient-prepared-001",
				providerAppointmentId: "his-appointment-prepared-001",
				status: "booked",
				createdAt: original.createdAt,
				totalFen: 10045,
			}),
		} as never,
		patients: {
			resolveProviderReference: async (input: { referenceKind?: string }) => ({
				patientId: original.patientId,
				provider: "zhongyang",
				providerPatientId:
					input.referenceKind === "directory"
						? "directory-prepared-001"
						: "his-patient-prepared-001",
			}),
		} as never,
		identityUsers: {
			findByUserId: async () => ({
				unionId: "synthetic-union",
				providerSubject: "synthetic-openid",
			}),
		} as never,
		patientProfile: {
			resolve: async () => ({
				patient: { name: "测试", idNo: "synthetic-identity", idType: "01" },
			}),
		} as never,
		outpatientPayments: {
			resolvePaymentContext: async () => {
				resolveCalls++;
				return {
					recordId: original.businessId,
					providerPatientId: "his-patient-prepared-001",
					outTradeOrderIds: anchor.tradeOrderIds,
					totalFen: 10045,
					record: anchor.outpatientPaymentRecord,
				};
			},
		} as never,
		medicalInsurance: {
			authorize: async () => {
				authCalls++;
				startAuth?.();
				if (blockAuth) await blockAuth;
				await authorizations.put(
					authorization(
						"auth-prepared-new",
						new Date(clock.getTime() + 600000).toISOString(),
					),
				);
				return {
					authorizationId: "auth-prepared-new",
					trace: {
						provider: "medical-insurance",
						operation: "authorization",
						requestId: "synthetic-auth",
					},
				};
			},
			uploadFees: async (input: {
				authorizationId: string;
				appointment: unknown;
				expectedVersion: number;
			}) => {
				feeCalls++;
				expect(input.expectedVersion).toBe(authCalls > 0 ? 6 : 4);
				expect(input.authorizationId).toBe(
					authCalls > 0 ? "auth-prepared-new" : "auth-prepared-old",
				);
				startFee?.();
				if (blockFees) await blockFees;
				expect(input.appointment).toMatchObject(
					businessType === "outpatient"
						? {
								recordId: original.businessId,
								outTradeOrderIds: anchor.tradeOrderIds,
								totalFen: 10045,
							}
						: { appointmentId: original.businessId, totalFen: 10045 },
				);
				return {
					feeUploadId: "fee-prepared-001",
					payOrdId: "pay-prepared-001",
					payTokenHash: "a".repeat(64),
					mdtrtId: "visit-prepared-001",
					acctUsedFlag: "0",
					trace: {
						provider: "medical-insurance",
						operation: "6201",
						requestId: "synthetic-fee",
					},
				};
			},
			settle: async () => {
				throw new Error("recovery must not automatically charge 6202");
			},
		} as never,
		now: () => clock,
	});
	const context = {
		traceId: "prepared-recovery-trace",
		idempotencyKey: "prepared-recovery-request",
	};
	return {
		orders,
		authorizations,
		service,
		anchor,
		original,
		context,
		clock,
		counts: () => ({ feeCalls, authCalls, resolveCalls }),
		holdAuthorizations: () => {
			let release!: () => void;
			const started = new Promise<void>((r) => {
				startAuth = r;
			});
			blockAuth = new Promise<void>((r) => {
				release = r;
			});
			return { started, release };
		},
		holdFees: () => {
			let release!: () => void;
			const started = new Promise<void>((r) => {
				startFee = r;
			});
			blockFees = new Promise<void>((r) => {
				release = r;
			});
			return { started, release };
		},
	};
}

const recover = (f: Awaited<ReturnType<typeof preparedFixture>>) =>
	f.service.recoverBusinessOrder({
		ownerUserId: f.original.ownerUserId,
		businessType: f.original.businessType as "outpatient" | "registration",
		businessId: f.original.businessId as string,
		patientId: f.original.patientId,
		context: f.context,
	});
const fees = (f: Awaited<ReturnType<typeof preparedFixture>>) =>
	f.service.uploadFees({
		ownerUserId: f.original.ownerUserId,
		orderId: f.original.medicalOrderId,
		context: f.context,
	});

const reauthorize = (f: Awaited<ReturnType<typeof preparedFixture>>) => {
	const input = {
		ownerUserId: f.original.ownerUserId,
		authCode: "synthetic-new-auth-code",
		context: f.context,
	};
	return f.original.businessType === "outpatient"
		? f.service.authorizeOutpatient({
				...input,
				recordId: f.original.businessId as string,
				patientId: f.original.patientId,
			})
		: f.service.authorize({
				...input,
				appointmentId: f.original.appointmentId as string,
			});
};

test("过期pre6201重新授权成功后立即上传费用，不把授权更新时间误当6201发送锁", async () => {
	const f = await preparedFixture(true);
	await expect(recover(f)).resolves.toMatchObject({
		status: "fee_upload_pending",
		authorizationReady: false,
		authorizationPending: false,
	});
	await expect(
		f.service.authorizeOutpatient({
			ownerUserId: f.original.ownerUserId,
			recordId: f.original.businessId as string,
			patientId: f.original.patientId,
			authCode: "synthetic-new-auth-code",
			context: f.context,
		}),
	).resolves.toMatchObject({
		orderId: f.original.medicalOrderId,
		status: "authorized",
	});
	await expect(fees(f)).resolves.toMatchObject({
		orderId: f.original.medicalOrderId,
		status: "fee_uploaded",
	});
	expect(f.counts()).toEqual({ feeCalls: 1, authCalls: 1, resolveCalls: 0 });
	await expect(
		f.orders.getSettlementContext(
			f.original.ownerUserId,
			f.original.medicalOrderId,
		),
	).resolves.toEqual(f.anchor);
});

test("挂号pre6201过期重授后也可立即使用新授权续传同一原单", async () => {
	const f = await preparedFixture(true, "registration");
	await expect(reauthorize(f)).resolves.toMatchObject({ status: "authorized" });
	await expect(recover(f)).resolves.toMatchObject({
		status: "created",
		authorizationReady: true,
		authorizationPending: false,
	});
	await expect(fees(f)).resolves.toMatchObject({
		orderId: f.original.medicalOrderId,
		status: "fee_uploaded",
	});
	expect(f.counts()).toEqual({ feeCalls: 1, authCalls: 1, resolveCalls: 0 });
});

for (const businessType of ["outpatient", "registration"] as const) {
	test(`${businessType}已有有效授权的近期费用发送锁仍保留等待窗口`, async () => {
		const f = await preparedFixture(false, businessType);
		await f.orders.applySettlement(
			f.original.medicalOrderId,
			f.original.version,
			{
				status: "fee_upload_pending",
				ordStas: null,
				amounts: null,
				setlType: null,
				revsTokenHash: null,
				revsTokenExpiresAt: null,
			},
		);
		await expect(reauthorize(f)).resolves.toMatchObject({
			status: "authorized",
		});
		await expect(fees(f)).resolves.toMatchObject({
			status: "fee_upload_pending",
		});
		await expect(
			f.orders.findByMedicalOrderId(f.original.medicalOrderId),
		).resolves.toMatchObject({
			status: "fee_upload_pending",
			authorizationId: f.original.authorizationId,
			version: f.original.version + 1,
		});
		expect(f.counts()).toEqual({ feeCalls: 0, authCalls: 0, resolveCalls: 0 });
	});

	test(`${businessType}重授后并发续传仅CAS赢家发送6201，随后重复命令不重发`, async () => {
		const f = await preparedFixture(true, businessType);
		await reauthorize(f);
		const hold = f.holdFees();
		const first = fees(f);
		const second = fees(f);
		try {
			await hold.started;
			await expect(Promise.race([first, second])).resolves.toMatchObject({
				status: "fee_upload_pending",
			});
			expect(f.counts().feeCalls).toBe(1);
		} finally {
			hold.release();
		}
		const results = await Promise.all([first, second]);
		expect(results.map((result) => result.status).sort()).toEqual([
			"fee_upload_pending",
			"fee_uploaded",
		]);
		await expect(fees(f)).resolves.toMatchObject({ status: "fee_uploaded" });
		expect(f.counts()).toEqual({ feeCalls: 1, authCalls: 1, resolveCalls: 0 });
	});

	test(`${businessType}真实submitting_6201不因重授入口退回created或重复发送`, async () => {
		const f = await preparedFixture(true, businessType);
		await f.orders.saveSettlementContext(
			f.original.ownerUserId,
			f.original.medicalOrderId,
			{
				...f.anchor,
				feeUploadStage: "submitting_6201",
				feeUploadSubmittedAt: f.clock.toISOString(),
			},
		);
		await expect(reauthorize(f)).resolves.toMatchObject({
			status: "authorized",
		});
		await expect(fees(f)).resolves.toMatchObject({
			status: "fee_upload_pending",
		});
		await expect(
			f.orders.findByMedicalOrderId(f.original.medicalOrderId),
		).resolves.toMatchObject({
			status: "fee_upload_pending",
			authorizationId: f.original.authorizationId,
			version: f.original.version,
		});
		expect(f.counts()).toEqual({
			feeCalls: 0,
			authCalls: 0,
			resolveCalls: businessType === "outpatient" ? 1 : 0,
		});
	});
}

test("完整pre6201恢复仅观察且不自动发6201或6202，随后显式费用命令复用原单", async () => {
	const f = await preparedFixture();
	await expect(recover(f)).resolves.toMatchObject({
		status: "fee_upload_pending",
		authorizationReady: true,
		recoveryAllowed: true,
	});
	expect(f.counts()).toEqual({ feeCalls: 0, authCalls: 0, resolveCalls: 0 });
	await expect(fees(f)).resolves.toMatchObject({
		status: "fee_uploaded",
		orderId: f.original.medicalOrderId,
	});
	expect(f.counts()).toEqual({ feeCalls: 1, authCalls: 0, resolveCalls: 0 });
	await expect(
		f.orders.getSettlementContext(
			f.original.ownerUserId,
			f.original.medicalOrderId,
		),
	).resolves.toMatchObject({ businessId: f.anchor.businessId });
});

test("pre6201授权过期返回未就绪，重新授权使同一原单恢复可续传并保留原主单", async () => {
	const f = await preparedFixture(true);
	await expect(recover(f)).resolves.toMatchObject({
		status: "fee_upload_pending",
		authorizationReady: false,
		recoveryAllowed: true,
	});
	await expect(fees(f)).rejects.toThrow(/authorization is required/);
	await expect(
		f.service.authorizeOutpatient({
			ownerUserId: f.original.ownerUserId,
			recordId: f.original.businessId as string,
			patientId: f.original.patientId,
			authCode: "synthetic-new-auth-code",
			context: f.context,
		}),
	).resolves.toMatchObject({
		orderId: f.original.medicalOrderId,
		status: "authorized",
	});
	await expect(
		f.orders.findByMedicalOrderId(f.original.medicalOrderId),
	).resolves.toMatchObject({
		status: "created",
		authorizationId: "auth-prepared-new",
		version: 5,
	});
	await expect(
		f.orders.getSettlementContext(
			f.original.ownerUserId,
			f.original.medicalOrderId,
		),
	).resolves.toEqual(f.anchor);
	expect(f.counts()).toEqual({ feeCalls: 0, authCalls: 1, resolveCalls: 0 });
});

test("完整pre6201并发续跑仍只有CAS赢家发6201，输家只观察", async () => {
	const f = await preparedFixture();
	const hold = f.holdFees();
	const winner = fees(f);
	await hold.started;
	await expect(fees(f)).resolves.toMatchObject({
		status: "fee_upload_pending",
	});
	expect(f.counts().feeCalls).toBe(1);
	hold.release();
	await expect(winner).resolves.toMatchObject({ status: "fee_uploaded" });
});

test("已有其他渠道支付确认仅返回友好标记，绝不记为平台支付成功", async () => {
	const f = await preparedFixture(true);
	await f.orders.saveSettlementContext(
		f.original.ownerUserId,
		f.original.medicalOrderId,
		{
			...f.anchor,
			externalPaymentConfirmation: {
				source: "user-confirmed-and-his-child-paid",
				amountFen: 10045,
				confirmedAt: f.clock.toISOString(),
				hisBusinessId: f.anchor.businessId,
				hisBusinessCode: f.anchor.businessCode as string,
				tradeOrderIds: f.anchor.tradeOrderIds,
				hisTradeStatus: "3",
				platformPaymentStarted: false,
				actualChannel: "unknown",
			},
		},
	);
	await f.orders.applySettlement(f.original.medicalOrderId, 3, {
		status: "manual_review",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
	});
	await expect(recover(f)).resolves.toMatchObject({
		status: "manual_review",
		recoveryAllowed: false,
		externalPaymentConfirmed: true,
	});
	await expect(fees(f)).resolves.toMatchObject({ status: "manual_review" });
	expect(f.counts()).toEqual({ feeCalls: 0, authCalls: 0, resolveCalls: 0 });
});

test("外渠证据金额或主单不一致时不返回已缴清标记", async () => {
	const f = await preparedFixture();
	await f.orders.saveSettlementContext(
		f.original.ownerUserId,
		f.original.medicalOrderId,
		{
			...f.anchor,
			externalPaymentConfirmation: {
				source: "user-confirmed-and-his-child-paid",
				amountFen: 10044,
				confirmedAt: f.clock.toISOString(),
				hisBusinessId: "wrong-main",
				hisBusinessCode: f.anchor.businessCode as string,
				tradeOrderIds: f.anchor.tradeOrderIds,
				hisTradeStatus: "3",
				platformPaymentStarted: false,
				actualChannel: "unknown",
			},
		},
	);
	await f.orders.applySettlement(f.original.medicalOrderId, 3, {
		status: "manual_review",
		ordStas: null,
		amounts: null,
		setlType: null,
		revsTokenHash: null,
		revsTokenExpiresAt: null,
	});
	const result = await recover(f);
	expect(result.externalPaymentConfirmed).toBeUndefined();
	expect(result.recoveryAllowed).toBe(false);
	expect(f.counts().feeCalls).toBe(0);
});

test("原主单过期授权并发重授只允许一次Provider请求，不创建第二订单", async () => {
	const f = await preparedFixture(true);
	const hold = f.holdAuthorizations();
	const input = {
		ownerUserId: f.original.ownerUserId,
		recordId: f.original.businessId as string,
		patientId: f.original.patientId,
		authCode: "synthetic-new-auth-code",
		context: f.context,
	};
	const winner = f.service.authorizeOutpatient(input);
	await hold.started;
	await expect(f.service.authorizeOutpatient(input)).rejects.toThrow();
	expect(f.counts().authCalls).toBe(1);
	hold.release();
	await expect(winner).resolves.toMatchObject({
		orderId: f.original.medicalOrderId,
		status: "authorized",
	});
	await expect(
		f.orders.getSettlementContext(
			f.original.ownerUserId,
			f.original.medicalOrderId,
		),
	).resolves.toEqual(f.anchor);
});
