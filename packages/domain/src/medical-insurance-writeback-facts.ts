import type {
	MedicalInsurancePluginPaymentContext,
	MedicalInsurancePostPaymentComponent,
	MedicalInsuranceSettlementContext,
} from "./medical-insurance-order";

export class MedicalInsuranceWritebackConflictError extends Error {
	constructor() {
		super(
			"An attempted HIS payment writeback cannot change its original payment scope or receipt",
		);
		this.name = "MedicalInsuranceWritebackConflictError";
	}
}

const PLUGIN_STATES: readonly MedicalInsurancePluginPaymentContext["state"][] =
	[
		"preorder_created",
		"prepay_ready",
		"cash_paid",
		"29_succeeded",
		"15_succeeded",
		"settled",
	];

function assertCompatibleIdentity(
	current: Record<string, unknown>,
	incoming: Record<string, unknown>,
	keys: readonly string[],
) {
	for (const key of keys) {
		if (
			current[key] !== undefined &&
			incoming[key] !== undefined &&
			current[key] !== incoming[key]
		) {
			throw new MedicalInsuranceWritebackConflictError();
		}
	}
}

function protectedPlugin(
	plugin: MedicalInsurancePluginPaymentContext | undefined,
): plugin is MedicalInsurancePluginPaymentContext {
	return (
		!!plugin &&
		(!!plugin.thirdPartPayAttempt ||
			!!plugin.thirdPartPayRecordId ||
			PLUGIN_STATES.indexOf(plugin.state) >= 3)
	);
}

function cashComponent(
	context: MedicalInsuranceSettlementContext,
): MedicalInsurancePostPaymentComponent {
	const components =
		context.postPaymentComponents?.filter(
			(item) => item.kind === "wechat_cash",
		) ?? [];
	if (components.length !== 1 || !components[0])
		throw new MedicalInsuranceWritebackConflictError();
	return components[0];
}

/** Preserve irreversible .29 facts at the shared persistence boundary. A late
 * prepay snapshot may update its own fields, but cannot erase an existing claim. */
export function preserveMedicalInsuranceThirdPartyWriteback(
	current: MedicalInsuranceSettlementContext | undefined,
	incoming: MedicalInsuranceSettlementContext,
): MedicalInsuranceSettlementContext {
	if (!current) return incoming;
	let next = incoming;
	if (protectedPlugin(current.plugin)) {
		const previous = current.plugin;
		const candidate = incoming.plugin;
		if (
			!candidate ||
			candidate.paymentOrderId !== previous.paymentOrderId ||
			candidate.outTradeNo !== previous.outTradeNo
		) {
			throw new MedicalInsuranceWritebackConflictError();
		}
		assertCompatibleIdentity(previous, candidate, [
			"payingId",
			"tradingId",
			"recordCode",
			"thirdPartPayRecordId",
		]);
		const receipt =
			previous.thirdPartPayRecordId ?? candidate.thirdPartPayRecordId;
		const attempt =
			previous.thirdPartPayAttempt?.status === "succeeded"
				? previous.thirdPartPayAttempt
				: previous.thirdPartPayAttempt
					? {
							...previous.thirdPartPayAttempt,
							status:
								candidate.thirdPartPayAttempt?.status === "succeeded" &&
								receipt?.trim()
									? ("succeeded" as const)
									: previous.thirdPartPayAttempt.status,
						}
					: candidate.thirdPartPayAttempt;
		const state =
			attempt?.status === "unknown"
				? previous.state
				: PLUGIN_STATES.indexOf(previous.state) >
						PLUGIN_STATES.indexOf(candidate.state)
					? previous.state
					: candidate.state;
		next = {
			...next,
			plugin: {
				...candidate,
				payingId: previous.payingId,
				tradingId: previous.tradingId,
				recordCode: previous.recordCode,
				state,
				...(receipt ? { thirdPartPayRecordId: receipt } : {}),
				...(attempt ? { thirdPartPayAttempt: attempt } : {}),
				...(previous.thirdPartPayRawResponse !== undefined
					? { thirdPartPayRawResponse: previous.thirdPartPayRawResponse }
					: {}),
			},
		};
	}
	if (current.selfPayThirdPartyWriteback) {
		const previous = cashComponent(current);
		const candidate = cashComponent(incoming);
		if (previous.componentId !== candidate.componentId)
			throw new MedicalInsuranceWritebackConflictError();
		assertCompatibleIdentity(previous, candidate, [
			"payingId",
			"tradingId",
			"recordCode",
			"wechatOutTradeNo",
		]);
		const fact = current.selfPayThirdPartyWriteback;
		const candidateFact = incoming.selfPayThirdPartyWriteback;
		if (
			fact.outTradeNo &&
			candidateFact?.outTradeNo &&
			fact.outTradeNo !== candidateFact.outTradeNo
		)
			throw new MedicalInsuranceWritebackConflictError();
		if (
			fact.thirdPartPayRecordId &&
			candidateFact?.thirdPartPayRecordId &&
			fact.thirdPartPayRecordId !== candidateFact.thirdPartPayRecordId
		) {
			throw new MedicalInsuranceWritebackConflictError();
		}
		const mergedFact =
			fact.status === "succeeded" ||
			candidateFact?.status !== "succeeded" ||
			!candidateFact.thirdPartPayRecordId?.trim()
				? fact
				: {
						...candidateFact,
						attemptedAt: fact.attemptedAt,
						...(fact.outTradeNo ? { outTradeNo: fact.outTradeNo } : {}),
					};
		const mergedComponent = { ...candidate, ...previous };
		next = {
			...next,
			postPaymentComponents: (incoming.postPaymentComponents ?? []).map(
				(item) =>
					item.componentId === previous.componentId ? mergedComponent : item,
			),
			selfPayThirdPartyWriteback: mergedFact,
		};
	}
	return next;
}
