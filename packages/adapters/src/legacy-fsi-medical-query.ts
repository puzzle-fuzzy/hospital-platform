import type {
	AdapterCallContext,
	ExternalTrace,
	MedicalInsuranceCredentialRepository,
	MedicalInsuranceSettlementEvidence,
	PaymentAmounts,
	PaymentOrderRepository,
} from "@hospital/domain";
import { assertValidPaymentAmounts } from "@hospital/domain";
import type {
	LegacyFsiGateway,
	LegacyFsiSettlementQueryResult,
} from "./legacy-fsi-gateway";

export type LegacyFsiMedicalInsuranceQueryGateway = {
	query(
		input: { orderId: string },
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
};

export class LegacyFsiMedicalInsuranceQueryContextUnavailableError extends Error {
	constructor(reason: "order" | "credential") {
		super(`Legacy FSI 6301 query context is unavailable: ${reason}`);
		this.name = "LegacyFsiMedicalInsuranceQueryContextUnavailableError";
	}
}

function paymentAmountsFromLegacySettlement(
	result: LegacyFsiSettlementQueryResult,
	orderAmounts: PaymentAmounts,
): PaymentAmounts {
	if (!result.settlement.amounts) return orderAmounts;
	const amounts = result.settlement.amounts;
	return assertValidPaymentAmounts({
		totalFen: amounts.totalFen,
		insuranceFen: amounts.personalAccountFen + amounts.fundFen,
		cashFen: amounts.cashFen,
	});
}

function evidenceClassification(
	statusClass: LegacyFsiSettlementQueryResult["statusClass"],
): Pick<
	MedicalInsuranceSettlementEvidence,
	"state" | "finality" | "authoritative"
> {
	switch (statusClass) {
		case "processing":
			return {
				state: "awaiting_confirmation",
				finality: "processing",
				authoritative: false,
			};
		case "settlement_candidate":
			return {
				state: "awaiting_confirmation",
				finality: "settlement_candidate",
				authoritative: false,
			};
		case "cancelled":
			return { state: "failed", finality: "cancelled", authoritative: true };
		case "failed":
			return { state: "failed", finality: "failed", authoritative: true };
		case "unknown":
			return {
				state: "awaiting_confirmation",
				finality: "unknown",
				authoritative: false,
			};
	}
}

function queryTrace(result: LegacyFsiSettlementQueryResult): ExternalTrace {
	return result.trace;
}

/**
 * 将旧项目真实 6301 查单接到窄的 Worker query port。
 *
 * 6201 返回的 payToken、实名字段都从 owner-scoped 加密凭证读取，绝不从
 * Worker task、URL 或客户端输入拼接。6301 的 3/4/5/6 仍只是后置结算候选，
 * 必须等待 Yunhealth/HIS 证据才能进入 paid/final 状态。
 */
export function createLegacyFsiMedicalInsuranceQueryGateway(options: {
	legacyFsi: Pick<LegacyFsiGateway, "querySettlement">;
	orders: PaymentOrderRepository;
	credentials: MedicalInsuranceCredentialRepository;
	now?: () => Date;
}): LegacyFsiMedicalInsuranceQueryGateway {
	const now = options.now ?? (() => new Date());

	return {
		async query(input, context) {
			const order = await options.orders.findById(input.orderId);
			if (!order) {
				throw new LegacyFsiMedicalInsuranceQueryContextUnavailableError(
					"order",
				);
			}
			const credential = await options.credentials.getActiveForOrder({
				ownerUserId: order.ownerUserId,
				medicalOrderId: order.orderId,
				purpose: "query",
				now: now().toISOString(),
			});
			if (!credential) {
				throw new LegacyFsiMedicalInsuranceQueryContextUnavailableError(
					"credential",
				);
			}

			const result = await options.legacyFsi.querySettlement(
				{
					payOrdId: credential.payOrdId,
					payToken: credential.payToken,
					...credential.providerQueryIdentity,
				},
				context,
			);
			const classification = evidenceClassification(result.statusClass);
			return {
				...classification,
				amounts: paymentAmountsFromLegacySettlement(result, order.amounts),
				trace: queryTrace(result),
				source: "6301",
				providerStatus: result.settlement.ordStas,
			};
		},
	};
}
