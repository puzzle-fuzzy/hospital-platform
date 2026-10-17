import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder, PaymentOrder } from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryWechatRefundRepository,
	createNotConfiguredRepositories,
	type MySqlRepositories,
} from "@hospital/persistence";
import { createDefaultApplicationServices } from "./application";
import { MedicalInsuranceRegistrationInputError } from "./modules/medical-insurance/errors";

const time = "2026-10-15T08:00:00.000Z";
const context = {
	traceId: "refund-composition-test",
	idempotencyKey: "refund-composition-key",
};
const medicalOrder: MedicalInsuranceOrder = {
	medicalOrderId: "composition-medical",
	ownerUserId: "composition-owner",
	patientId: "composition-patient",
	idempotencyKey: "composition-order",
	medOrgOrd: "composition-med-org",
	chrgBchno: "composition-batch",
	payOrdId: "composition-pay",
	payTokenHash: null,
	status: "insurance_settled",
	ordStas: "6",
	amounts: {
		totalFen: 1000,
		cashFen: 300,
		personalAccountFen: 200,
		fundFen: 500,
	},
	setlType: "ALL",
	revsTokenHash: null,
	revsTokenExpiresAt: null,
	lastError: null,
	orderType: "DiagPay",
	wechatMixTradeNo: "composition-mix",
	wechatOutTradeNo: "composition-out",
	wechatPaymentState: "cash_paid",
	version: 3,
	createdAt: time,
	updatedAt: time,
};

test("application wiring preserves the core refund scope including legacy ALL/CASH", async () => {
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	await orders.insert(medicalOrder);
	const scopes: unknown[] = [];
	let providerCalls = 0;
	const services = createDefaultApplicationServices({
		repositories: {
			...createNotConfiguredRepositories(),
			medicalInsuranceOrders: orders,
			medicalInsuranceRefunds: createInMemoryMedicalInsuranceRefundRepository(),
		} as unknown as MySqlRepositories,
		medicalInsuranceRefundGateway: {
			refund: async () => {
				providerCalls += 1;
				throw new Error("Unexpected financial call");
			},
		},
		medicalInsuranceRefundPaymentVerifier: {
			verify: async (_order, scope) => {
				scopes.push(scope);
				throw new MedicalInsuranceRegistrationInputError("verification-stop");
			},
		},
	});
	const service = services.medicalInsuranceRefund;
	if (!service) throw new Error("Medical refund service was not composed");
	for (const refund of [
		{ refundType: "ALL" as const },
		{
			refundType: "HI" as const,
			personalAccountRefundFen: 200,
			fundRefundFen: 500,
		},
		{ refundType: "CASH" as const, refundFen: 300 },
	]) {
		await expect(
			service.request({
				ownerUserId: medicalOrder.ownerUserId,
				orderId: medicalOrder.medicalOrderId,
				refund,
				context,
			}),
		).rejects.toThrow("verification-stop");
	}
	expect(scopes).toEqual(["ALL", "HI", "CASH"]);
	expect(providerCalls).toBe(0);
});

test("application delegates ordinary registration refund by server-owned appointment binding", async () => {
	const order: PaymentOrder = {
		orderId: "composition-payment",
		ownerUserId: "composition-owner",
		patientId: "composition-patient",
		idempotencyKey: "registration-self-pay:composition-appointment",
		amounts: { totalFen: 300, cashFen: 300, insuranceFen: 0 },
		state: "completed",
		version: 5,
		createdAt: time,
		updatedAt: time,
	};
	let verified = 0;
	let providerCalls = 0;
	let delegated: unknown;
	const base = createNotConfiguredRepositories();
	const services = createDefaultApplicationServices({
		repositories: {
			...base,
			paymentOrders: { ...base.paymentOrders, findById: async () => order },
			wechatRefunds: createInMemoryWechatRefundRepository(),
		} as unknown as MySqlRepositories,
		wechatRefundGateway: {
			requestRefund: async () => {
				providerCalls += 1;
				throw new Error("Must delegate registration cancellation");
			},
			queryRefund: async () => {
				throw new Error("No cash ledger to query");
			},
		},
		medicalInsuranceRefundGateway: {
			refund: async () => {
				providerCalls += 1;
				throw new Error("Not a medical refund");
			},
		},
		medicalInsuranceRefundPaymentVerifier: {
			verify: async () => {
				throw new Error("Not a medical payment");
			},
		},
		verifyWechatRefundPayment: async (verifiedOrder) => {
			expect(verifiedOrder.orderId).toBe(order.orderId);
			verified += 1;
		},
		appointmentWriteGateway: {} as never,
		registrationSelfPayRefundNotificationGateway: {} as never,
	});
	const exit = services.registrationPaymentExit;
	const refund = services.adminPaymentRefund;
	if (!exit || !refund) throw new Error("Registration refund was not composed");
	exit.abandon = async (input) => {
		delegated = input;
		return { appointmentId: input.appointmentId, status: "cancelled" };
	};
	await refund.request({
		source: "payment_order",
		orderId: order.orderId,
		refundType: "ALL",
		context,
	});
	expect(delegated).toMatchObject({
		ownerUserId: order.ownerUserId,
		appointmentId: "composition-appointment",
		mode: "self",
		context,
	});
	expect(verified).toBe(1);
	expect(providerCalls).toBe(0);
});
