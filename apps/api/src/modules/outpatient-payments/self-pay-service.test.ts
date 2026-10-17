import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	OutpatientPaymentGateway,
	OutpatientPaymentRecord,
	RegistrationSelfPaySettlementContext,
} from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import { createInMemoryPaymentOrderRepository } from "@hospital/persistence";
import { OutpatientSelfPayService } from "./self-pay-service";

const ownerUserId = "fixture-user-0001";
const patientId = "patient-001";
const recordId = "record-001";

class ContextAwareOutpatientGateway implements OutpatientPaymentGateway {
	readonly totalFen = 1700;
	constructor(readonly snapshot?: OutpatientPaymentRecord) {}

	async listRecords() {
		return {
			records: [],
			trace: {
				provider: "zhongyang",
				operation: "outpatient-payment-records",
				requestId: "records-request-001",
			},
		};
	}

	async resolvePaymentContext(
		input: {
			providerPatientId: string;
			recordId: string;
			startTime: string;
			endTime: string;
		},
		_context: AdapterCallContext,
	) {
		expect(this.totalFen).toBe(1700);
		expect(input.providerPatientId).toBe("provider-patient-001");
		expect(input.recordId).toBe(recordId);
		return {
			recordId,
			...(this.snapshot ? { record: this.snapshot } : {}),
			providerPatientId: "provider-patient-001",
			outTradeOrderIds: ["provider-order-001"],
			totalFen: this.totalFen,
			trace: {
				provider: "zhongyang",
				operation: "outpatient-payment-context",
				requestId: "context-request-001",
			},
		};
	}
}

test.each(["legacy", "snapshot", "invalid-amount", "invalid-reference"])(
	"门诊自费支付保留网关上下文并安全保存可选快照：%s",
	async (scenario) => {
		const paymentOrders = new PaymentOrderService({
			orders: createInMemoryPaymentOrderRepository(),
			createOrderId: () => "payment-order-001",
			now: () => new Date("2026-09-18T08:00:00.000Z"),
		});
		const snapshot: OutpatientPaymentRecord = {
			recordId: scenario === "invalid-reference" ? "other-record" : recordId,
			status: "unpaid",
			billDate: "2026-09-18 15:00:00",
			amountFen: scenario === "invalid-amount" ? 1800 : 1700,
		};
		const gateway = new ContextAwareOutpatientGateway(
			scenario === "legacy" ? undefined : snapshot,
		);
		const saved: RegistrationSelfPaySettlementContext[] = [];
		let prepareCalls = 0;
		const service = new OutpatientSelfPayService({
			paymentOrders,
			outpatientPayments: gateway,
			patients: {
				resolveProviderReference: async (input: {
					referenceKind?: "directory" | "his-patient";
				}) => ({
					patientId,
					provider: "zhongyang",
					providerPatientId:
						input.referenceKind === "directory"
							? "directory-patient-001"
							: "provider-patient-001",
				}),
			} as never,
			identityUsers: {
				findByUserId: async () => ({
					userId: ownerUserId,
					providerSubject: "openid-001",
					unionId: "union-001",
				}),
			} as never,
			patientProfile: {
				resolve: async (input: { providerPatientId: string }) => {
					expect(input.providerPatientId).toBe("directory-patient-001");
					return {
						patient: {
							providerPatientId: "provider-patient-001",
							name: "测试患者",
							cardNo: "P000001",
							idNo: "11010519900101007X",
							phone: "13800000000",
						},
						trace: {
							provider: "zhongyang",
							operation: "appointment-patient-profile",
							requestId: "profile-request-001",
						},
					};
				},
			} as never,
			preparation: {
				prepare: async (input: { providerPatientId: string }) => {
					prepareCalls += 1;
					expect(input.providerPatientId).toBe("provider-patient-001");
					return {
						registrationContext: {
							businessId: "business-001",
							payingId: "paying-001",
							tradingId: "trading-001",
							payParams: {
								appId: "wx-test",
								timeStamp: "1",
								nonceStr: "nonce",
								package: "prepay_id=prepay-test",
								signType: "MD5" as const,
								paySign: "signature",
							},
						},
						trace: {
							provider: "yunhealth",
							operation: "outpatient-self-pay.2.6.65.2",
							requestId: "prepare-request-001",
						},
					};
				},
			} as never,
			hospitalSettlement: {} as never,
			saveContext: async (_owner, _order, context) => {
				saved.push(context);
			},
			getContext: async () => undefined,
		});

		const action = service.create({
			ownerUserId,
			recordId,
			patientId,
			context: {
				traceId: "trace-001",
				idempotencyKey: "idempotency-001",
			},
		});
		if (scenario.startsWith("invalid-")) {
			await expect(action).rejects.toThrow(
				"snapshot does not match provider context",
			);
			expect(prepareCalls).toBe(0);
			expect(saved).toHaveLength(0);
			return;
		}
		const result = await action;

		expect(result.status).toBe("prepay_ready");
		expect(result.totalFen).toBe(1700);
		expect(saved).toHaveLength(1);
		if (scenario === "snapshot")
			expect(saved[0]?.outpatientPaymentRecord).toEqual(snapshot);
		else expect(saved[0]).not.toHaveProperty("outpatientPaymentRecord");
	},
);
