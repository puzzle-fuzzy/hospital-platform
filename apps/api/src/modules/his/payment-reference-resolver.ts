import {
	type HisPaymentReference,
	HisPaymentReferenceConflictError,
	type HisPaymentReferenceRepository,
	type MedicalInsuranceOrderRepository,
	normalizeHisPaymentReference,
} from "@hospital/domain";

export type ResolvedHisPaymentReference = {
	medicalOrderId: string;
	paymentScopeId: string;
	source: "plugin" | "component";
};

/** An allocated number is only a correlation key; the current payment facts
 * must independently prove that the corresponding .29 has succeeded. */
export function createHisPaymentReferenceResolver(dependencies: {
	references: HisPaymentReferenceRepository;
	orders: MedicalInsuranceOrderRepository;
}) {
	return async (
		value: string,
	): Promise<ResolvedHisPaymentReference | undefined> => {
		let referenceId: string;
		try {
			referenceId = normalizeHisPaymentReference(value);
		} catch {
			return undefined;
		}
		let reference: HisPaymentReference | undefined;
		try {
			reference = await dependencies.references.findByReferenceId(referenceId);
		} catch (error) {
			if (error instanceof HisPaymentReferenceConflictError) return undefined;
			throw error;
		}
		if (reference?.status !== "confirmed" || !reference.receiptId)
			return undefined;
		// 内部自增主键不是对 HIS 公开的支付号。历史导入只能按真实回执查找，
		// 新支付另允许已分配并对外发送的 requestReferenceId。
		if (
			referenceId !== reference.receiptId &&
			referenceId !== reference.requestReferenceId
		)
			return undefined;
		const order = await dependencies.orders.findByMedicalOrderId(
			reference.medicalOrderId,
		);
		if (
			!order ||
			order.ownerUserId !== reference.ownerUserId ||
			order.wechatPaymentState !== "cash_paid" ||
			!order.wechatOutTradeNo
		)
			return undefined;
		const settlement = await dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (!settlement) return undefined;
		let receipt: string | undefined;
		if (reference.source === "plugin") {
			const plugin = settlement.plugin;
			if (
				!plugin ||
				plugin.thirdPartPayAttempt?.status === "unknown" ||
				plugin.paymentOrderId !== reference.paymentScopeId ||
				plugin.outTradeNo !== order.wechatOutTradeNo ||
				!["29_succeeded", "15_succeeded", "settled"].includes(plugin.state)
			)
				return undefined;
			receipt = plugin.thirdPartPayRecordId;
		} else {
			const cashComponents =
				settlement.postPaymentComponents?.filter(
					(item) => item.kind === "wechat_cash",
				) ?? [];
			if (cashComponents.length !== 1) return undefined;
			const component = cashComponents[0];
			const writeback = settlement.selfPayThirdPartyWriteback;
			if (
				component?.kind !== "wechat_cash" ||
				component.componentId !== reference.paymentScopeId ||
				component.state !== "succeeded" ||
				(component.wechatOutTradeNo !== undefined &&
					component.wechatOutTradeNo !== order.wechatOutTradeNo) ||
				!component.payingId ||
				!component.tradingId ||
				writeback?.status !== "succeeded" ||
				(writeback.outTradeNo !== undefined &&
					writeback.outTradeNo !== order.wechatOutTradeNo)
			)
				return undefined;
			receipt = writeback.thirdPartPayRecordId;
		}
		try {
			if (normalizeHisPaymentReference(receipt) !== reference.receiptId)
				return undefined;
		} catch {
			return undefined;
		}
		return {
			medicalOrderId: order.medicalOrderId,
			paymentScopeId: reference.paymentScopeId,
			source: reference.source,
		};
	};
}
