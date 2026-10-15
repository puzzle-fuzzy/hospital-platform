import type { MedicalInsuranceRefundPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	isBoundedOpaqueIdentifier,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceRefund,
	type MedicalInsuranceRefundRepository,
	medicalRefundReservesMedicalAmount,
	normalizeAdapterCallContext,
	type PaymentOrder,
	type PaymentOrderRepository,
	type WechatRefund,
	type WechatRefundRepository,
	type WechatRefundSource,
} from "@hospital/domain";
import { MedicalInsuranceRegistrationInputError } from "../medical-insurance/errors";
import type {
	MedicalInsuranceRefundPaymentVerification,
	MedicalInsuranceRefundService,
} from "../medical-insurance/refund-service";
import {
	RegistrationPaymentExitRefundPendingError,
	RegistrationPaymentExitRefundSyncPendingError,
} from "../payments/registration-payment-exit-service";
import type { AdminWechatRefundService } from "./wechat-refund-service";

export type AdminPaymentRefundType = "ALL" | "HI" | "CASH";
export type AdminPaymentRefundResult = {
	source: WechatRefundSource;
	orderId: string;
	refundType: AdminPaymentRefundType;
	status: "requested" | "processing" | "succeeded" | "failed" | "manual_review";
	amounts: {
		totalFen: number;
		cashFen: number;
		personalAccountFen: number;
		fundFen: number;
	};
	medicalRefund?: MedicalInsuranceRefundPayload["data"];
	wechatRefund?: WechatRefund;
	registrationCancellationPending?: boolean;
};

export type AdminPaymentRefundServiceDependencies = {
	orders: Pick<MedicalInsuranceOrderRepository, "findByMedicalOrderId">;
	paymentOrders: Pick<PaymentOrderRepository, "findById">;
	medicalRefunds: MedicalInsuranceRefundRepository;
	wechatRefunds: Pick<WechatRefundRepository, "findBySourceAndSourceOrder">;
	medicalService: Pick<
		MedicalInsuranceRefundService,
		"requestMedicalOnlyByOrder" | "query"
	>;
	wechatService: Pick<
		AdminWechatRefundService,
		"requestMedicalInsuranceCashByOrder" | "request" | "query"
	>;
	verifyPaymentForRefund: (
		order: Readonly<MedicalInsuranceOrder>,
		scope?: AdminPaymentRefundType,
	) => Promise<MedicalInsuranceRefundPaymentVerification>;
	verifyPaymentOrder?: (
		order: PaymentOrder,
		context: AdapterCallContext,
	) => Promise<void>;
	refundRegistrationPayment?: (
		order: PaymentOrder,
		context: AdapterCallContext,
		reason?: string,
	) => Promise<void>;
	notifyMedicalRefund?: (
		order: MedicalInsuranceOrder,
		refund: MedicalInsuranceRefund,
	) => Promise<void>;
	now?: () => Date;
};

type Command = {
	source: WechatRefundSource;
	orderId: string;
	refundType?: AdminPaymentRefundType;
	context: unknown;
	operatorRef?: string;
};
const cashHeld = (refund: WechatRefund) =>
	["requested", "processing", "success", "unknown"].includes(refund.status);
const amountFields = [
	"totalFen",
	"cashFen",
	"personalAccountFen",
	"fundFen",
	"otherPaymentFen",
	"hospitalPartFen",
	"personalAccountMutualAidFen",
	"personalAccountSelfFen",
	"depositFen",
	"deliveryFeeFen",
] as const;
function inputError(message: string): never {
	throw new MedicalInsuranceRegistrationInputError(message);
}
const payload = (
	refund: MedicalInsuranceRefund,
): MedicalInsuranceRefundPayload["data"] => ({
	orderId: refund.medicalOrderId,
	refundNo: refund.refundNo,
	status: refund.status,
	medicalStatus: refund.medicalStatus,
	wechatStatus: refund.wechatStatus,
	amounts: {
		totalFen: refund.totalFen,
		cashFen: refund.cashFen,
		personalAccountFen: refund.personalAccountFen,
		fundFen: refund.fundFen,
	},
});

/** 管理端三种操作共享 HIS 的分项退款身份；金额与资格始终来自服务端事实。 */
export class AdminPaymentRefundService {
	private readonly now: () => Date;
	constructor(
		private readonly dependencies: AdminPaymentRefundServiceDependencies,
	) {
		this.now = dependencies.now ?? (() => new Date());
	}

	private normalize(input: Command) {
		if (
			!isBoundedOpaqueIdentifier(input.orderId) ||
			!["payment_order", "medical_insurance"].includes(input.source)
		)
			inputError("支付订单引用不合法");
		const refundType = input.refundType ?? "ALL";
		if (!["ALL", "HI", "CASH"].includes(refundType))
			inputError("退费类型不合法");
		const context = normalizeAdapterCallContext(input.context);
		if (!context) inputError("退费请求上下文不合法");
		return { ...input, refundType, context };
	}

	private async cashRecords(source: WechatRefundSource, orderId: string) {
		const find = this.dependencies.wechatRefunds.findBySourceAndSourceOrder;
		if (!find) inputError("微信退费台账未配置，暂不能安全退费");
		return [...(await find(source, orderId))];
	}

	private async verify(
		order: MedicalInsuranceOrder,
		scope: AdminPaymentRefundType,
	) {
		const proof = await this.dependencies.verifyPaymentForRefund(order, scope);
		const age = this.now().getTime() - Date.parse(proof.queriedAt);
		if (
			!order.amounts ||
			!Number.isFinite(age) ||
			age < 0 ||
			age > 60_000 ||
			proof.orderId !== order.medicalOrderId ||
			proof.version !== order.version ||
			proof.payOrdId !== order.payOrdId ||
			(proof.mixTradeNo ?? null) !== (order.wechatMixTradeNo ?? null) ||
			(proof.outTradeNo ?? null) !== (order.wechatOutTradeNo ?? null) ||
			!amountFields.every(
				(field) => proof.amounts[field] === order.amounts?.[field],
			) ||
			!Number.isSafeInteger(proof.actualCashFen) ||
			proof.actualCashFen < 0 ||
			proof.actualCashFen > order.amounts.cashFen
		)
			inputError("支付核验与原订单不一致或已过期");
		return proof;
	}

	private async notify(
		order: MedicalInsuranceOrder,
		records: readonly MedicalInsuranceRefund[],
	) {
		let pending = false;
		for (const record of records) {
			if (
				record.medicalStatus !== "success" ||
				record.personalAccountFen + record.fundFen <= 0
			)
				continue;
			try {
				if (!this.dependencies.notifyMedicalRefund)
					inputError("医保退款结果通知未配置");
				await this.dependencies.notifyMedicalRefund(order, record);
				if (record.lastErrorCode === "medical-refund-notify-pending") {
					await this.dependencies.medicalRefunds.update(
						{
							...record,
							status: record.cashFen > 0 ? record.status : "succeeded",
							lastErrorCode: null,
							version: record.version + 1,
							updatedAt: this.now().toISOString(),
						},
						record.version,
					);
				}
			} catch {
				pending = true;
				await this.dependencies.medicalRefunds.update(
					{
						...record,
						status: "manual_review",
						lastErrorCode: "medical-refund-notify-pending",
						version: record.version + 1,
						updatedAt: this.now().toISOString(),
					},
					record.version,
				);
			}
		}
		return pending;
	}

	private result(
		input: ReturnType<AdminPaymentRefundService["normalize"]>,
		order: MedicalInsuranceOrder,
		proof: MedicalInsuranceRefundPaymentVerification,
		medical: readonly MedicalInsuranceRefund[],
		cash: readonly WechatRefund[],
		notificationPending = false,
	): AdminPaymentRefundResult {
		const includeMedical =
			input.refundType !== "CASH" &&
			(proof.paidMedical ||
				medical.some(
					(record) => record.personalAccountFen + record.fundFen > 0,
				));
		const includeCash =
			input.refundType !== "HI" &&
			(proof.paidCash ||
				cash.length > 0 ||
				medical.some((record) => record.cashFen > 0));
		const personalAccountFen = includeMedical
			? (order.amounts?.personalAccountFen ?? 0)
			: 0;
		const fundFen = includeMedical ? (order.amounts?.fundFen ?? 0) : 0;
		const cashFen = includeCash ? proof.actualCashFen : 0;
		const medicalSuccess = medical.filter(
			(record) => record.medicalStatus === "success",
		);
		const paidPersonal = medicalSuccess.reduce(
			(sum, record) => sum + record.personalAccountFen,
			0,
		);
		const paidFund = medicalSuccess.reduce(
			(sum, record) => sum + record.fundFen,
			0,
		);
		const paidCash = cash
			.filter((record) => record.status === "success")
			.reduce((sum, record) => sum + record.refundFen, 0);
		const selectedMedical = input.refundType === "CASH" ? [] : medical;
		const selectedCash = input.refundType === "HI" ? [] : cash;
		const historicalCashBlocked =
			input.refundType !== "HI" &&
			medical.some(
				(record) =>
					record.refundType === "ALL" &&
					record.cashFen > 0 &&
					!cash.some(
						(item) => item.merchantRefundNo === record.wechatMerchantRefundNo,
					),
			);
		const selected = selectedMedical.length + selectedCash.length;
		let status: AdminPaymentRefundResult["status"] = "requested";
		if (
			(input.refundType !== "CASH" && notificationPending) ||
			historicalCashBlocked ||
			selectedMedical.some(
				(record) =>
					(record.status === "manual_review" &&
						record.medicalStatus !== "success") ||
					record.medicalStatus === "unknown" ||
					record.lastErrorCode === "medical-refund-notify-pending",
			) ||
			selectedCash.some((record) =>
				["unknown", "abnormal"].includes(record.status),
			)
		)
			status = "manual_review";
		else if (
			personalAccountFen + fundFen + cashFen > 0 &&
			paidPersonal >= personalAccountFen &&
			paidFund >= fundFen &&
			paidCash >= cashFen
		)
			status = "succeeded";
		else if (
			selectedMedical.some((record) =>
				["requested", "processing"].includes(record.medicalStatus),
			) ||
			selectedCash.some((record) =>
				["requested", "processing"].includes(record.status),
			)
		)
			status = "processing";
		else if (
			selectedMedical.some((record) => record.medicalStatus === "failed") ||
			selectedCash.some((record) =>
				["closed", "request_failed"].includes(record.status),
			)
		)
			status =
				paidPersonal + paidFund + paidCash > 0 ? "manual_review" : "failed";
		else if (selected) status = "processing";
		const latestMedical = [...medical].sort((a, b) =>
			b.updatedAt.localeCompare(a.updatedAt),
		)[0];
		const latestCash = [...cash].sort((a, b) =>
			b.updatedAt.localeCompare(a.updatedAt),
		)[0];
		return {
			source: input.source,
			orderId: input.orderId,
			refundType: input.refundType,
			status,
			amounts: {
				totalFen: personalAccountFen + fundFen + cashFen,
				cashFen,
				personalAccountFen,
				fundFen,
			},
			...(latestMedical ? { medicalRefund: payload(latestMedical) } : {}),
			...(latestCash ? { wechatRefund: latestCash } : {}),
		};
	}

	private async ordinary(
		input: ReturnType<AdminPaymentRefundService["normalize"]>,
		write: boolean,
		reason?: string,
	): Promise<AdminPaymentRefundResult> {
		if (input.refundType === "HI") inputError("普通微信订单没有医保退款分项");
		const order = await this.dependencies.paymentOrders.findById(input.orderId);
		if (!order) inputError("支付订单不存在");
		let records = await this.cashRecords(input.source, input.orderId);
		const registration = order.idempotencyKey.startsWith(
			"registration-self-pay:",
		);
		let registrationCancellationPending = false;
		const alreadySucceeded =
			records
				.filter((item) => item.status === "success")
				.reduce((sum, item) => sum + item.refundFen, 0) >=
			order.amounts.cashFen;
		const canonical = records.find(
			(item) => item.idempotencyKey === `admin-payment-cash:${input.orderId}`,
		);
		if (write && !alreadySucceeded && !canonical && !registration) {
			if (!["cash_paid", "his_written_back", "completed"].includes(order.state))
				inputError("尚未确认微信支付成功");
			if (!this.dependencies.verifyPaymentOrder)
				inputError("微信支付实时核验未配置");
			await this.dependencies.verifyPaymentOrder(order, input.context);
			const remaining =
				order.amounts.cashFen -
				records.filter(cashHeld).reduce((sum, item) => sum + item.refundFen, 0);
			if (remaining > 0)
				await this.dependencies.wechatService.request(
					{
						source: "payment_order",
						orderId: input.orderId,
						refundFen: remaining,
						idempotencyKey: `admin-payment-cash:${input.orderId}`,
						...(reason ? { reason } : {}),
					},
					input.context,
				);
		} else
			for (const record of records.filter((item) =>
				["requested", "processing", "unknown"].includes(item.status),
			))
				await this.dependencies.wechatService.query(
					record.merchantRefundNo,
					input.context,
				);
		records = await this.cashRecords(input.source, input.orderId);
		if (
			registration &&
			(write || records.some((item) => item.status === "success"))
		) {
			if (write && !records.length) {
				if (order.state !== "completed")
					inputError("挂号尚未确认完成，请先核对医院状态");
				if (!this.dependencies.verifyPaymentOrder)
					inputError("微信支付实时核验未配置");
				await this.dependencies.verifyPaymentOrder(order, input.context);
			}
			if (!this.dependencies.refundRegistrationPayment)
				inputError("挂号退费及取消流程未配置");
			try {
				await this.dependencies.refundRegistrationPayment(
					order,
					input.context,
					reason,
				);
			} catch (error) {
				if (
					!(error instanceof RegistrationPaymentExitRefundPendingError) &&
					!(error instanceof RegistrationPaymentExitRefundSyncPendingError)
				)
					throw error;
				registrationCancellationPending = true;
			}
		}
		records = await this.cashRecords(input.source, input.orderId);
		const succeeded = records
			.filter((item) => item.status === "success")
			.reduce((sum, item) => sum + item.refundFen, 0);
		const status = registrationCancellationPending
			? "processing"
			: succeeded >= order.amounts.cashFen && order.amounts.cashFen > 0
				? "succeeded"
				: records.some((item) => ["unknown", "abnormal"].includes(item.status))
					? "manual_review"
					: records.some((item) =>
								["requested", "processing"].includes(item.status),
							)
						? "processing"
						: records.length
							? "failed"
							: "requested";
		return {
			source: input.source,
			orderId: input.orderId,
			refundType: input.refundType,
			status,
			amounts: {
				totalFen: order.amounts.cashFen,
				cashFen: order.amounts.cashFen,
				personalAccountFen: 0,
				fundFen: 0,
			},
			...(records[0] ? { wechatRefund: records[0] } : {}),
			...(registrationCancellationPending
				? { registrationCancellationPending: true }
				: {}),
		};
	}

	async request(input: {
		source: WechatRefundSource;
		orderId: string;
		refundType: AdminPaymentRefundType;
		reason?: string;
		context: unknown;
		operatorRef?: string;
	}): Promise<AdminPaymentRefundResult> {
		const command = this.normalize(input);
		if (input.source === "payment_order")
			return this.ordinary(command, true, input.reason);
		const order = await this.dependencies.orders.findByMedicalOrderId(
			input.orderId,
		);
		if (!order?.amounts) inputError("医保订单不存在或尚未形成金额事实");
		let medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		// 历史 ALL 可能已向两个渠道发送：只续查原身份，不改为新的单腿命令。
		if (medical.some((record) => record.refundType === "ALL"))
			return this.query(command);
		const proof = await this.verify(order, command.refundType);
		if (input.refundType !== "CASH") {
			const held = medical.filter(medicalRefundReservesMedicalAmount);
			const remainingMedical =
				order.amounts.personalAccountFen +
				order.amounts.fundFen -
				held.reduce(
					(sum, record) => sum + record.personalAccountFen + record.fundFen,
					0,
				);
			if (remainingMedical > 0 && proof.paidMedical) {
				if (!this.dependencies.notifyMedicalRefund)
					inputError("医保退款结果通知未配置，暂不能申请医保退款");
				await this.dependencies.medicalService.requestMedicalOnlyByOrder({
					orderId: input.orderId,
					...(input.reason ? { reason: input.reason } : {}),
					context: input.context,
					...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
				});
			} else if (input.refundType === "HI" && !medical.length)
				inputError("当前没有已确认支付的医保可退金额");
		}
		medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		const pendingNotification = await this.notify(order, medical);
		medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		let cash = await this.cashRecords(input.source, input.orderId);
		if (
			input.refundType === "ALL" &&
			proof.paidMedical &&
			medical
				.filter((record) => record.medicalStatus === "success")
				.reduce(
					(sum, record) => sum + record.personalAccountFen + record.fundFen,
					0,
				) <
				order.amounts.personalAccountFen + order.amounts.fundFen
		)
			return this.result(command, order, proof, medical, cash);
		if (
			input.refundType !== "HI" &&
			proof.paidCash &&
			proof.actualCashFen >
				cash.filter(cashHeld).reduce((sum, record) => sum + record.refundFen, 0)
		) {
			const currentOrder = await this.dependencies.orders.findByMedicalOrderId(
				input.orderId,
			);
			if (
				!currentOrder ||
				currentOrder.version !== order.version ||
				currentOrder.payOrdId !== order.payOrdId ||
				currentOrder.wechatOutTradeNo !== order.wechatOutTradeNo ||
				currentOrder.wechatMixTradeNo !== order.wechatMixTradeNo
			)
				inputError("支付订单已变化，请重新核验后退费");
			const cashProof =
				this.now().getTime() - Date.parse(proof.queriedAt) > 60_000
					? await this.verify(currentOrder, "CASH")
					: proof;
			if (
				!cashProof.paidCash ||
				cashProof.actualCashFen !== proof.actualCashFen
			)
				inputError("微信支付事实已变化，请重新核验后退费");
			await this.dependencies.wechatService.requestMedicalInsuranceCashByOrder(
				{
					orderId: input.orderId,
					expectedCashFen: proof.actualCashFen,
					...(input.reason ? { reason: input.reason } : {}),
				},
				command.context,
			);
		} else if (
			input.refundType === "CASH" &&
			!cash.length &&
			(!proof.paidCash || proof.actualCashFen <= 0)
		)
			inputError("当前没有已确认支付的实际微信现金可退金额");
		cash = await this.cashRecords(input.source, input.orderId);
		return this.result(
			command,
			order,
			proof,
			medical,
			cash,
			pendingNotification,
		);
	}

	async query(input: Command): Promise<AdminPaymentRefundResult> {
		const command = this.normalize(input);
		if (input.source === "payment_order") return this.ordinary(command, false);
		const order = await this.dependencies.orders.findByMedicalOrderId(
			input.orderId,
		);
		if (!order?.amounts) inputError("医保订单不存在或尚未形成金额事实");
		let medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		let cash = await this.cashRecords(input.source, input.orderId);
		for (const record of medical.filter(
			(item) =>
				item.refundType === "ALL" &&
				item.medicalStatus === "success" &&
				item.cashFen > 0 &&
				cash.some(
					(cashItem) =>
						cashItem.merchantRefundNo === item.wechatMerchantRefundNo,
				),
		))
			await this.dependencies.medicalService.query(record.refundNo, {
				requestId: command.context.traceId,
				...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
			});
		for (const record of cash.filter((item) =>
			["requested", "processing", "unknown"].includes(item.status),
		))
			await this.dependencies.wechatService.query(
				record.merchantRefundNo,
				command.context,
			);
		medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		const pendingNotification = await this.notify(order, medical);
		medical = [
			...(await this.dependencies.medicalRefunds.listByMedicalOrderId(
				input.orderId,
			)),
		];
		cash = await this.cashRecords(input.source, input.orderId);
		const proof = await this.verify(order, command.refundType);
		return this.result(
			command,
			order,
			proof,
			medical,
			cash,
			pendingNotification,
		);
	}
}
