import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	OutpatientPaymentGateway,
} from "@hospital/domain";
import { PaymentOrderService } from "@hospital/domain";
import { createInMemoryPaymentOrderRepository } from "@hospital/persistence";
import { OutpatientSelfPayService } from "./self-pay-service";

const ownerUserId = "fixture-user-0001";
const patientId = "patient-001";
const recordId = "record-001";

class ContextAwareOutpatientGateway implements OutpatientPaymentGateway {
	readonly totalFen = 1700;

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

test("门诊自费支付调用网关方法时保留网关 this 上下文", async () => {
	const paymentOrders = new PaymentOrderService({
		orders: createInMemoryPaymentOrderRepository(),
		createOrderId: () => "payment-order-001",
		now: () => new Date("2026-09-18T08:00:00.000Z"),
	});
	const gateway = new ContextAwareOutpatientGateway();
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
		saveContext: async () => undefined,
		getContext: async () => undefined,
	});

	const result = await service.create({
		ownerUserId,
		recordId,
		patientId,
		context: {
			traceId: "trace-001",
			idempotencyKey: "idempotency-001",
		},
	});

	expect(result.status).toBe("prepay_ready");
	expect(result.totalFen).toBe(1700);
});
