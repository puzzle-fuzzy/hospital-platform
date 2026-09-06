import { expect, test } from "bun:test";
import type {
	AdapterCallContext,
	MedicalInsuranceOrder,
} from "@hospital/domain";
import { createLegacyFsiMedicalInsuranceGateway } from "./legacy-fsi-medical-insurance";

const order = {
	medicalOrderId: "medical-order-context-missing-001",
	ownerUserId: "user-context-missing-001",
	businessType: "registration",
} as MedicalInsuranceOrder;

const context: AdapterCallContext = {
	traceId: "trace-context-missing-001",
	idempotencyKey: "idempotency-context-missing-001",
};

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
