import { expect, test } from "bun:test";
import type {
	MedicalInsuranceCredentialRepository,
	PaymentOrder,
	PaymentOrderRepository,
} from "@hospital/domain";
import type { LegacyFsiSettlementQueryResult } from "./legacy-fsi-gateway";
import {
	createLegacyFsiMedicalInsuranceQueryGateway,
	LegacyFsiMedicalInsuranceQueryContextUnavailableError,
} from "./legacy-fsi-medical-query";

const now = new Date("2026-09-03T10:00:00.000Z");
const order: PaymentOrder = {
	orderId: "medical-order-001",
	ownerUserId: "user-001",
	patientId: "patient-001",
	idempotencyKey: "payment-key-001",
	amounts: { totalFen: 1_000, insuranceFen: 800, cashFen: 200 },
	state: "insurance_submitted",
	version: 3,
	createdAt: now.toISOString(),
	updatedAt: now.toISOString(),
};

function ordersFor(seed: PaymentOrder): PaymentOrderRepository {
	return {
		findById: async (orderId) => (orderId === seed.orderId ? seed : undefined),
		findByOwnerAndIdempotencyKey: async () => undefined,
		findByOwnerAndId: async () => undefined,
		insert: async () => {
			throw new Error("insert is not used by the query adapter");
		},
		update: async () => {
			throw new Error("update is not used by the query adapter");
		},
	};
}

function credentialInput() {
	return {
		credentialId: "credential-001",
		ownerUserId: order.ownerUserId,
		medicalOrderId: order.orderId,
		payOrdId: "provider-order-001",
		payToken: "provider-token-secret",
		providerQueryIdentity: {
			orgCodg: "org-001",
			idNo: "masked-id-001",
			userName: "测试用户",
			idType: "01",
		},
		purpose: "query" as const,
		expiresAt: "2026-09-03T11:00:00.000Z",
		createdAt: now.toISOString(),
	};
}

function credentialsFor(): MedicalInsuranceCredentialRepository {
	let stored: ReturnType<typeof credentialInput> | undefined;
	return {
		put: async (input) => {
			stored = { ...input, purpose: "query" as const };
			return {
				credentialId: input.credentialId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.medicalOrderId,
				payOrdId: input.payOrdId,
				purpose: input.purpose,
				expiresAt: input.expiresAt,
				createdAt: input.createdAt,
			};
		},
		get: async () => undefined,
		getActiveForOrder: async (input) => {
			if (
				!stored ||
				stored.ownerUserId !== input.ownerUserId ||
				stored.medicalOrderId !== input.medicalOrderId ||
				stored.purpose !== input.purpose ||
				Date.parse(stored.expiresAt) <= Date.parse(input.now)
			) {
				return undefined;
			}
			return stored;
		},
		revoke: async () => false,
	};
}

function legacyResult(
	ordStas: string,
	settlement: LegacyFsiSettlementQueryResult["settlement"] = {
		payOrdId: "provider-order-001",
		ordStas,
	},
): LegacyFsiSettlementQueryResult {
	return {
		settlement,
		statusClass:
			ordStas === "1"
				? "processing"
				: ordStas === "6"
					? "settlement_candidate"
					: ordStas === "9"
						? "cancelled"
						: "unknown",
		trace: {
			provider: "legacy-fsi",
			operation: "legacy-fsi.6301",
			requestId: `request-${ordStas}`,
			providerOrderId: "provider-order-001",
		},
	};
}

function setup(queryResult: LegacyFsiSettlementQueryResult): {
	credentials: MedicalInsuranceCredentialRepository;
	readQueryData: () => Record<string, unknown> | undefined;
	gateway: ReturnType<typeof createLegacyFsiMedicalInsuranceQueryGateway>;
} {
	const credentials = credentialsFor();
	let queryData: Record<string, unknown> | undefined;
	const gateway = createLegacyFsiMedicalInsuranceQueryGateway({
		legacyFsi: {
			querySettlement: async (data) => {
				queryData = data;
				return queryResult;
			},
		},
		orders: ordersFor(order),
		credentials,
		now: () => now,
	});
	return { credentials, readQueryData: () => queryData, gateway };
}

test("6301 query uses only the owner-scoped credential context", async () => {
	const { credentials, readQueryData, gateway } = setup(legacyResult("1"));
	await credentials.put(credentialInput());

	const evidence = await gateway.query(
		{ orderId: order.orderId },
		{ traceId: "trace-001", idempotencyKey: "query-key-001" },
	);

	expect(evidence).toMatchObject({
		state: "awaiting_confirmation",
		finality: "processing",
		authoritative: false,
		providerStatus: "1",
		amounts: order.amounts,
		source: "6301",
	});
	expect(readQueryData()).toEqual({
		payOrdId: "provider-order-001",
		payToken: "provider-token-secret",
		orgCodg: "org-001",
		idNo: "masked-id-001",
		userName: "测试用户",
		idType: "01",
	});
});

test("6301 candidate preserves provider amounts but never becomes paid", async () => {
	const { credentials, gateway } = setup(
		legacyResult("6", {
			payOrdId: "provider-order-001",
			ordStas: "6",
			amounts: {
				totalFen: 1_000,
				cashFen: 200,
				personalAccountFen: 500,
				fundFen: 300,
			},
			setlType: "ALL",
		}),
	);
	await credentials.put(credentialInput());

	const evidence = await gateway.query(
		{ orderId: order.orderId },
		{ traceId: "trace-002", idempotencyKey: "query-key-002" },
	);

	expect(evidence).toMatchObject({
		state: "awaiting_confirmation",
		finality: "settlement_candidate",
		authoritative: false,
		amounts: order.amounts,
	});
});

test("6301 query fails closed when the encrypted credential is absent", async () => {
	const { gateway } = setup(legacyResult("1"));

	await expect(
		gateway.query(
			{ orderId: order.orderId },
			{ traceId: "trace-003", idempotencyKey: "query-key-003" },
		),
	).rejects.toBeInstanceOf(
		LegacyFsiMedicalInsuranceQueryContextUnavailableError,
	);
});
