import { expect, test } from "bun:test";
import { createLegacyFsiMedicalInsuranceGateway } from "@hospital/adapters";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
} from "@hospital/persistence";
import { MedicalInsuranceRegistrationService } from "./registration-service";

test("pre6201旧请求在授权读取阻塞跨过宽限期后不能借用新claim版本发送6201", async () => {
	let clock = new Date();
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	const medicalOrderId = "medical-claim-fence-001",
		ownerUserId = "owner-claim-fence-001",
		patientId = "patient-claim-fence-001";
	const initial: MedicalInsuranceOrder = {
		medicalOrderId,
		ownerUserId,
		patientId,
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: "record-claim-fence-001",
		authorizationId: "auth-claim-fence-001",
		feeUploadId: null,
		idempotencyKey: "claim-fence-original-key",
		medOrgOrd: medicalOrderId,
		chrgBchno: "claim-fence-batch",
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
	await orders.insert(initial);
	const anchor: MedicalInsuranceSettlementContext = {
		businessId: "8843869012141618309",
		businessCode: "MZJSD-FENCE-001",
		hospitalId: "10389001",
		patientId: "his-patient-fence-001",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: ["8843868963491158916"],
		insuredAreaCode: "140581",
		feeUploadStage: "pre_6201",
		settlementAmountFen: 1000,
		outpatientPaymentRecord: {
			recordId: initial.businessId as string,
			status: "unpaid",
			billDate: "2026-10-17 10:24:00",
			amountFen: 1000,
		},
	};
	await orders.saveSettlementContext(ownerUserId, medicalOrderId, anchor);
	await authorizations.put({
		authorizationId: "auth-claim-fence-001",
		ownerUserId,
		medicalOrderId,
		providerSubject: "synthetic-openid",
		payAuthNo: "synthetic-auth",
		patient: { idNo: "synthetic-identity", userName: "测试", idType: "01" },
		psnNo: "synthetic-person",
		insutype: "310",
		insuplcAdmdvs: "140581",
		insuCode: "140581",
		createdAt: clock.toISOString(),
		expiresAt: "2099-01-01T00:00:00.000Z",
	});
	let blocked = false,
		markAuthBlocked!: () => void,
		releaseAuth!: () => void;
	const authBlocked = new Promise<void>((resolve) => {
		markAuthBlocked = resolve;
	});
	const authRelease = new Promise<void>((resolve) => {
		releaseAuth = resolve;
	});
	const delayedAuthorizations = {
		...authorizations,
		get: async (input: Parameters<typeof authorizations.get>[0]) => {
			const current = await orders.findByMedicalOrderId(medicalOrderId);
			// service校验授权发生在v3；首次adapter读取恰好在其已claim的v4。
			if (current?.version === 4 && !blocked) {
				blocked = true;
				markAuthBlocked();
				await authRelease;
			}
			return authorizations.get(input);
		},
	};
	let feeUploadCalls = 0;
	const providerPaths: string[] = [];
	const detail = {
		outTradeOrderId: anchor.tradeOrderIds[0],
		chargeId: "charge-fence-001",
		chargeCode: "CHARGE-FENCE-001",
		chargeName: "测试收费",
		networkItemCode: "INSURANCE-FENCE-001",
		networkItemName: "测试收费",
		outSettleDetailId: "detail-fence-001",
		amount: "10.00",
		price: "10.00",
		quantity: 1,
		selfBurdenRatio: "0",
		createTime: "2026-10-17 10:24:00",
		billDeptCode: "DEPT-FENCE-001",
		billDeptName: "测试科室",
		billDocCode: "doctor-fence-001",
		billDocName: "测试医生",
	};
	const gateway = createLegacyFsiMedicalInsuranceGateway({
		orders,
		authorizations: delayedAuthorizations,
		credentials: { put: async () => undefined } as never,
		legacyFsi: {
			uploadFees: async () => {
				feeUploadCalls++;
				return {
					totalFen: 1000,
					mdtrtId: "visit-fence-001",
					credential: {
						payOrdId: "pay-fence-001",
						payToken: "synthetic-token",
					},
					trace: {
						provider: "legacy-fsi",
						operation: "legacy-fsi.6201",
						requestId: "synthetic-6201-fence",
					},
				};
			},
			createPaymentOrder: async () => {
				throw new Error("6202 must never run");
			},
		},
		relayUrl: "https://relay.example",
		relayAuthorizationToken: "synthetic-relay-token",
		foundationBaseUrl: "https://foundation.example",
		zhongyangBaseUrl: "https://zhongyang.example",
		now: () => clock,
		fetcher: async (input) => {
			const url = new URL(String(input));
			providerPaths.push(url.pathname);
			let data: unknown;
			if (url.pathname.endsWith("/outpatient-child-payment-records"))
				data = [
					{
						outTradeOrderId: anchor.tradeOrderIds[0],
						chargeId: detail.chargeId,
						billDeptId: "dept-fence-001",
						tradeStatus: "2",
						disableSettleFlag: "1",
					},
				];
			else if (url.pathname.endsWith("/out-insur-settle-infos"))
				data = { outSettleDetailList: [detail], mdtrtId: "visit-fence-001" };
			else if (url.pathname.endsWith("/depts"))
				data = [
					{
						deptId: "dept-fence-001",
						deptCode: "DEPT-FENCE-001",
						nationalDeptInsuranceCode: "insurance-dept-fence-001",
					},
				];
			else if (url.pathname.endsWith("/users"))
				data = [
					{
						userCode: "doctor-fence-001",
						medicalInsuranceCode: "insurance-doctor-fence-001",
					},
				];
			else
				throw new Error(`Unexpected provider write or path: ${url.pathname}`);
			return new Response(
				JSON.stringify({ success: true, code: "0000", data }),
				{ headers: { "content-type": "application/json" } },
			);
		},
	});
	const service = new MedicalInsuranceRegistrationService({
		orders,
		authorizations: delayedAuthorizations,
		appointments: {} as never,
		patients: {
			resolveProviderReference: async () => ({
				patientId,
				provider: "zhongyang",
				providerPatientId: "his-patient-fence-001",
			}),
		} as never,
		identityUsers: {} as never,
		patientProfile: {} as never,
		outpatientPayments: {
			resolvePaymentContext: async () => {
				throw new Error("reuse prepared snapshot");
			},
		} as never,
		medicalInsurance: gateway,
		now: () => clock,
	});
	const command = (key: string) =>
		service.uploadOutpatientFees({
			ownerUserId,
			orderId: medicalOrderId,
			context: { traceId: key, idempotencyKey: key },
		});
	const oldResult = command("claim-fence-old").then(
		() => new Error("旧请求不应成功"),
		(error: unknown) => error,
	);
	await Promise.race([
		authBlocked,
		oldResult.then((error) => {
			throw error;
		}),
	]);
	await expect(
		orders.findByMedicalOrderId(medicalOrderId),
	).resolves.toMatchObject({ version: 4, status: "fee_upload_pending" });
	clock = new Date(clock.getTime() + 130000);
	await expect(command("claim-fence-new")).resolves.toMatchObject({
		status: "fee_uploaded",
	});
	expect(feeUploadCalls).toBe(1);
	releaseAuth();
	expect(await oldResult).toMatchObject({
		message: expect.stringContaining("发送权已失效"),
	});
	expect(feeUploadCalls).toBe(1);
	expect(
		providerPaths.filter((path) => path.endsWith("/apply-pay-settle")),
	).toHaveLength(0);
	await expect(
		orders.findByMedicalOrderId(medicalOrderId),
	).resolves.toMatchObject({
		version: 6,
		status: "fee_uploaded",
		payOrdId: "pay-fence-001",
	});
	await expect(
		orders.getSettlementContext(ownerUserId, medicalOrderId),
	).resolves.toMatchObject({
		businessId: anchor.businessId,
		feeUploadStage: "fee_uploaded",
	});
});
