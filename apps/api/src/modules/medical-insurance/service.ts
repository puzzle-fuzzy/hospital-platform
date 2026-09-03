import {
	type LegacyFsiCryptoGateway,
	validateLegacyFsiSealedEnvelope,
} from "@hospital/adapters";
import {
	type AdapterCallContext,
	assertMedicalInsuranceOrderTransition,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	medicalInsuranceStatusForNotification,
	normalizeMedicalInsuranceSettlementNotification,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type MedicalInsuranceNotificationAck = {
	success: boolean;
	message: string;
};

export class MedicalInsuranceNotificationService {
	private readonly logger: AppLogger;
	private readonly crypto: LegacyFsiCryptoGateway;
	private readonly orders: MedicalInsuranceOrderRepository;

	constructor(dependencies: {
		crypto: LegacyFsiCryptoGateway;
		orders: MedicalInsuranceOrderRepository;
		logger?: AppLogger;
	}) {
		this.crypto = dependencies.crypto;
		this.orders = dependencies.orders;
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	/**
	 * 6302 医保结算结果通知（平台 → 本服务）。
	 *
	 * 流程：验 envelope → 验签解密 → 归一化金额/事实 → 按 payOrdId 找订单 →
	 * 推导目标状态 → CAS 落库。未知订单/状态冲突不抛给平台，返回
	 * success=false 并留低敏日志供人工对账；验签或解密失败直接抛
	 * LegacyFsiContractError（fail-closed，不允许放行）。
	 */
	async receive(input: {
		payload: Record<string, unknown>;
		context: AdapterCallContext;
	}): Promise<MedicalInsuranceNotificationAck> {
		validateLegacyFsiSealedEnvelope(input.payload, "6201");
		const opened = await this.crypto.open(
			{ infno: "6201", response: input.payload },
			input.context,
		);
		const notification = normalizeMedicalInsuranceSettlementNotification(
			opened.data,
		);
		const order = await this.orders.findByPayOrdId(notification.payOrdId);
		if (!order) {
			this.logger.warn(
				{
					event: "medical.insurance.notification.unknown_order",
					traceId: input.context.traceId,
					payOrdIdHash: sha256Short(notification.payOrdId),
				},
				"Medical insurance notification for an unknown order",
			);
			return { success: false, message: "订单不存在或尚未同步" };
		}
		if (order.medOrgOrd !== notification.medOrgOrd) {
			this.logger.warn(
				{
					event: "medical.insurance.notification.order_mismatch",
					traceId: input.context.traceId,
					orderId: order.medicalOrderId,
					payOrdIdHash: sha256Short(notification.payOrdId),
					medOrgOrdHash: sha256Short(notification.medOrgOrd),
				},
				"Medical insurance notification medOrgOrd does not match the order",
			);
			return { success: false, message: "通知与订单不匹配" };
		}
		let nextStatus = medicalInsuranceStatusForNotification(
			notification,
			order.amounts,
		);
		if (nextStatus === order.status) {
			return { success: true, message: "通知已处理，状态未变化" };
		}
		try {
			assertTransition(order.status, nextStatus);
		} catch {
			// 回调先于 6202 落库等乱序场景：停在等待确认，由查单/人工收敛。
			nextStatus = "awaiting_confirmation";
			assertTransition(order.status, nextStatus);
		}
		const updated = await this.orders.applySettlement(
			order.medicalOrderId,
			order.version,
			{
				status: nextStatus,
				ordStas: "6",
				amounts: {
					totalFen: notification.feeSumamt,
					cashFen: notification.ownPayAmt,
					personalAccountFen: notification.psnAcctPay,
					fundFen: notification.fundPay,
				},
				setlType: notification.setlType,
				revsTokenHash: sha256Short(notification.revsToken),
				revsTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			},
		);
		if (!updated) {
			// 版本冲突：并发通知/查单已推进；不重试，交给查单收敛。
			this.logger.warn(
				{
					event: "medical.insurance.notification.version_conflict",
					traceId: input.context.traceId,
				},
				"Medical insurance notification lost the CAS race",
			);
			return { success: false, message: "订单状态已被并发更新" };
		}
		this.logger.info(
			{
				event: "medical.insurance.notification.applied",
				traceId: input.context.traceId,
				status: nextStatus,
			},
			"Medical insurance settlement notification applied",
		);
		return { success: true, message: "医保6302结算结果通知接收成功" };
	}
}

function assertTransition(
	from: MedicalInsuranceOrder["status"],
	to: MedicalInsuranceOrder["status"],
): void {
	assertMedicalInsuranceOrderTransition(from, to);
}

function sha256Short(value: string): string {
	// 只做指纹用途：截断哈希足够日志去关联，不用于安全校验。
	let h1 = 0x811c9dc5;
	let h2 = 0x1000193;
	for (let i = 0; i < value.length; i++) {
		h1 = ((h1 ^ value.charCodeAt(i)) * 0x01000193) | 0;
		h2 = ((h2 + value.charCodeAt(i) * 31) | 0) ^ (h1 >>> 3);
	}
	return (
		(h1 >>> 0).toString(16).padStart(8, "0") +
		(h2 >>> 0).toString(16).padStart(8, "0")
	);
}
