import {
	DependencyNotConfiguredError,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceWechatPaymentGateway,
	medicalInsurancePaymentBreakdown,
	PaymentOrderInputError,
	type PaymentOrderRepository,
	type RegistrationSelfPaySettlementContext,
	type WechatPaymentGateway,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

export type YunhealthPaymentQueryInput = {
	patId: string | number;
	tradeNo: string;
	payTypeId: string | number;
	payingId: string | number;
	amount: string | number;
	cashierId: string | number;
	cashierName: string;
	tradeType: string;
	deviceIp?: string;
	deviceMac?: string;
	hisCreateTime: string;
	remark?: string;
	orgId?: string | number;
	hospitalId?: string | number;
	/** 众阳规定为 2.6.65.2 下单时传入的 recordCode。 */
	transactionId: string;
};

export type YunhealthPaymentQueryResult = {
	patId: string | number;
	transactionId: string;
	payTime: string;
	payTypeId: string | number;
	result: "SUCCESS" | "REFUND" | "USERPAYING" | "PAYERROR" | "CLOSED";
};

type QueryContext = {
	traceId: string;
	idempotencyKey: string;
};

function requiredText(value: unknown, label: string, maxLength = 128): string {
	if (typeof value !== "string")
		throw new PaymentOrderInputError(`${label} is invalid`);
	const normalized = value.trim();
	if (!normalized || normalized.length > maxLength)
		throw new PaymentOrderInputError(`${label} is invalid`);
	return normalized;
}

function integerText(value: unknown, label: string): string {
	const normalized = String(value ?? "").trim();
	if (!/^\d+$/u.test(normalized))
		throw new PaymentOrderInputError(`${label} is invalid`);
	return normalized;
}

function yuanToFen(value: unknown): number {
	const normalized = String(value ?? "").trim();
	const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/u.exec(normalized);
	if (!match) throw new PaymentOrderInputError("amount is invalid");
	const fen = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
	if (!Number.isSafeInteger(fen) || fen <= 0)
		throw new PaymentOrderInputError("amount is invalid");
	return fen;
}

function sameReference(
	input: YunhealthPaymentQueryInput,
	context: RegistrationSelfPaySettlementContext,
): boolean {
	return (
		integerText(input.patId, "patId") === context.patientId &&
		integerText(input.payingId, "payingId") === context.payingId &&
		integerText(input.payTypeId, "payTypeId") === context.payTypeId &&
		requiredText(input.tradeType, "tradeType", 32) ===
			(context.tradeTypeCode ?? "10") &&
		(input.hospitalId === undefined ||
			integerText(input.hospitalId, "hospitalId") === context.hospitalId)
	);
}

function providerTime(rfc3339: string): string | undefined {
	const timestamp = new Date(rfc3339);
	if (!Number.isFinite(timestamp.getTime())) return undefined;
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(timestamp);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((candidate) => candidate.type === type)?.value;
	const values = {
		year: part("year"),
		month: part("month"),
		day: part("day"),
		hour: part("hour"),
		minute: part("minute"),
		second: part("second"),
	};
	return Object.values(values).every(Boolean)
		? `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`
		: undefined;
}

export class YunhealthPaymentQueryService {
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: {
			orders: PaymentOrderRepository;
			medicalOrders: MedicalInsuranceOrderRepository;
			wechatPayment: WechatPaymentGateway;
			medicalWechatPayment?: MedicalInsuranceWechatPaymentGateway;
			logger?: AppLogger;
		},
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	async query(
		input: YunhealthPaymentQueryInput,
		context: QueryContext,
	): Promise<YunhealthPaymentQueryResult> {
		const recordCode = requiredText(input.transactionId, "transactionId", 128);
		const find = this.dependencies.orders.findByRegistrationSelfPayRecordCode;

		let result: YunhealthPaymentQueryResult;
		const found = find ? await find(recordCode) : undefined;
		if (found) {
			const referencesMatch = sameReference(input, found.context);
			const amountMatches =
				yuanToFen(input.amount) === found.order.amounts.cashFen;
			if (!referencesMatch || !amountMatches) {
				result = {
					patId: input.patId,
					transactionId: "",
					payTime: "",
					payTypeId: input.payTypeId,
					result: "PAYERROR",
				};
			} else {
				const outTradeNo = requiredText(
					found.context.outTradeNo,
					"outTradeNo",
					64,
				);
				try {
					const payment = await this.dependencies.wechatPayment.query(
						{ orderId: outTradeNo },
						{
							...context,
							idempotencyKey: `yunhealth-payment-query:${recordCode}`,
						},
					);
					const transactionId = payment.trace.providerOrderId?.trim() ?? "";
					const payTime = payment.successTime
						? providerTime(payment.successTime)
						: undefined;
					const state: YunhealthPaymentQueryResult["result"] =
						payment.state === "cash_paid" &&
						payment.totalFen === found.order.amounts.cashFen &&
						transactionId &&
						payTime
							? "SUCCESS"
							: payment.providerState === "REFUND"
								? "REFUND"
								: payment.providerState === "CLOSED" ||
										payment.providerState === "REVOKED"
									? "CLOSED"
									: payment.state === "failed" ||
											(payment.state === "cash_paid" &&
												payment.totalFen !== found.order.amounts.cashFen)
										? "PAYERROR"
										: "USERPAYING";
					const includePaymentReference =
						state === "SUCCESS" || state === "REFUND";
					result = {
						patId: input.patId,
						transactionId: includePaymentReference ? transactionId : "",
						payTime: includePaymentReference ? (payTime ?? "") : "",
						payTypeId: input.payTypeId,
						result: state,
					};
				} catch (error) {
					this.logger.warn(
						{
							event: "yunhealth.2.6.65.9.wechat-query-pending",
							traceId: context.traceId,
							paymentOrderId: found.order.orderId,
							errorName: error instanceof Error ? error.name : "UnknownError",
						},
						"Yunhealth payment query could not confirm WeChat payment yet",
					);
					result = {
						patId: input.patId,
						transactionId: "",
						payTime: "",
						payTypeId: input.payTypeId,
						result: "USERPAYING",
					};
				}
			}
		} else {
			const medical =
				await this.dependencies.medicalOrders.findByYunhealthPaymentRecordCode(
					recordCode,
				);
			if (!medical) {
				result = {
					patId: input.patId,
					transactionId: "",
					payTime: "",
					payTypeId: input.payTypeId,
					result: "PAYERROR",
				};
			} else {
				const referencesMatch =
					integerText(input.patId, "patId") === medical.context.patientId &&
					integerText(input.payingId, "payingId") ===
						medical.component.payingId &&
					integerText(input.payTypeId, "payTypeId") ===
						medical.component.payTypeId &&
					requiredText(input.tradeType, "tradeType", 32) ===
						(medical.order.businessType === "outpatient" ? "2" : "10") &&
					(input.hospitalId === undefined ||
						integerText(input.hospitalId, "hospitalId") ===
							medical.context.hospitalId);
				const amountMatches =
					yuanToFen(input.amount) === medical.component.amountFen;
				if (!referencesMatch || !amountMatches) {
					result = {
						patId: input.patId,
						transactionId: "",
						payTime: "",
						payTypeId: input.payTypeId,
						result: "PAYERROR",
					};
				} else if (medical.component.state !== "succeeded") {
					result = {
						patId: input.patId,
						transactionId: "",
						payTime: "",
						payTypeId: input.payTypeId,
						result: "USERPAYING",
					};
				} else {
					try {
						const gateway = this.dependencies.medicalWechatPayment;
						if (!gateway)
							throw new DependencyNotConfiguredError("wechat-medical-payment");
						const amounts = medical.order.amounts;
						if (!amounts)
							throw new PaymentOrderInputError(
								"payment amounts are unavailable",
							);
						const breakdown = medicalInsurancePaymentBreakdown({
							amounts,
							orderType: medical.order.orderType ?? "RegPay",
							insuredAreaCode: medical.context.insuredAreaCode ?? "",
						});
						const payment = await gateway.queryMixedOrder(
							{
								orderId: medical.order.medicalOrderId,
								mixTradeNo: requiredText(
									medical.order.wechatMixTradeNo,
									"mixTradeNo",
									32,
								),
								expectedOutTradeNo: requiredText(
									medical.order.wechatOutTradeNo,
									"outTradeNo",
									64,
								),
								expectedPayOrdId: requiredText(
									medical.order.payOrdId,
									"payOrdId",
									64,
								),
								expectedTotalFen: amounts.totalFen,
								expectedCashFen: breakdown.wechatCashFen,
							},
							{
								...context,
								idempotencyKey: `yunhealth-medical-payment-query:${recordCode}`,
							},
						);
						const amountsMatch =
							payment.totalFen === amounts.totalFen &&
							payment.cashFen === breakdown.wechatCashFen &&
							payment.fundFen === amounts.fundFen &&
							payment.personalAccountFen === amounts.personalAccountFen &&
							payment.otherPaymentFen === (amounts.otherPaymentFen ?? 0) &&
							payment.medicalCashFen === amounts.cashFen;
						const fullyPaid =
							payment.mixState === "paid" &&
							payment.cashState === "paid" &&
							payment.insuranceState === "paid";
						const refunded = payment.providerStatus.includes("_REFUND");
						const state: YunhealthPaymentQueryResult["result"] = refunded
							? "REFUND"
							: fullyPaid && amountsMatch
								? "SUCCESS"
								: payment.mixState === "failed" || !amountsMatch
									? "PAYERROR"
									: "USERPAYING";
						const transactionId = payment.trace.providerOrderId?.trim() ?? "";
						const payTime = providerTime(
							payment.paidTime ?? medical.component.updatedAt,
						);
						const includePaymentReference =
							(state === "SUCCESS" || state === "REFUND") &&
							Boolean(transactionId) &&
							Boolean(payTime);
						result = {
							patId: input.patId,
							transactionId: includePaymentReference ? transactionId : "",
							payTime: includePaymentReference ? (payTime ?? "") : "",
							payTypeId: input.payTypeId,
							result:
								(state === "SUCCESS" || state === "REFUND") &&
								!includePaymentReference
									? "USERPAYING"
									: state,
						};
					} catch (error) {
						this.logger.warn(
							{
								event: "yunhealth.2.6.65.9.wechat-query-pending",
								traceId: context.traceId,
								medicalOrderId: medical.order.medicalOrderId,
								componentId: medical.component.componentId,
								errorName: error instanceof Error ? error.name : "UnknownError",
							},
							"Yunhealth medical payment query could not confirm WeChat payment yet",
						);
						result = {
							patId: input.patId,
							transactionId: "",
							payTime: "",
							payTypeId: input.payTypeId,
							result: "USERPAYING",
						};
					}
				}
			}
		}

		return result;
	}
}
