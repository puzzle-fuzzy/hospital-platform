import {
	type LegacyFsiGateway,
	ProviderRequestError,
} from "@hospital/adapters";
import {
	isValidMedicalInsuranceProviderQueryIdentity,
	type MedicalInsuranceCredentialRepository,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceWechatPaymentGateway,
	medicalInsurancePaymentBreakdown,
	type WechatPaymentGateway,
} from "@hospital/domain";
import { MedicalInsuranceRegistrationInputError } from "./errors";
import type { MedicalInsuranceRefundPaymentVerification } from "./refund-service";

const coreFields = [
	"totalFen",
	"cashFen",
	"personalAccountFen",
	"fundFen",
] as const;
const optionalFields = [
	"otherPaymentFen",
	"hospitalPartFen",
	"personalAccountMutualAidFen",
	"personalAccountSelfFen",
	"depositFen",
	"deliveryFeeFen",
] as const;

function invalid(message: string): never {
	throw new MedicalInsuranceRegistrationInputError(message);
}

/** Query original provider identities; source workflow/HIS status is not payment proof. */
export class MedicalInsuranceRefundPaymentVerifier {
	private readonly now: () => Date;
	constructor(
		private readonly dependencies: {
			orders: Pick<
				MedicalInsuranceOrderRepository,
				"findByMedicalOrderId" | "getSettlementContext"
			>;
			credentials: MedicalInsuranceCredentialRepository;
			wechat: Pick<MedicalInsuranceWechatPaymentGateway, "queryMixedOrder"> & {
				queryPaidOrderForRefund: WechatPaymentGateway["query"];
			};
			medical: Pick<LegacyFsiGateway, "querySettlement">;
			now?: () => Date;
		},
	) {
		this.now = dependencies.now ?? (() => new Date());
	}

	async verify(
		order: Readonly<MedicalInsuranceOrder>,
		scope: "ALL" | "HI" | "CASH" = "ALL",
	): Promise<MedicalInsuranceRefundPaymentVerification> {
		const started = this.now();
		if (!Number.isFinite(started.getTime()))
			return invalid("支付核验时间不合法");
		if (
			!order.amounts ||
			!order.orderType ||
			!order.payOrdId ||
			!order.wechatMixTradeNo ||
			!order.wechatOutTradeNo
		)
			return invalid("原支付上下文不完整，暂不能核实可退金额");
		const amounts = order.amounts;
		const settlement = await this.dependencies.orders.getSettlementContext(
			order.ownerUserId,
			order.medicalOrderId,
		);
		if (order.orderType === "RegPay" && !settlement?.insuredAreaCode?.trim())
			return invalid("挂号支付地区信息不完整，无法核实医院减免");
		const breakdown = medicalInsurancePaymentBreakdown({
			amounts,
			orderType: order.orderType,
			insuredAreaCode: settlement?.insuredAreaCode ?? "",
		});
		const context = {
			traceId: `refund-verify-${crypto.randomUUID()}`,
			idempotencyKey: `refund-verify:${order.medicalOrderId}`,
		};
		const mixed = await this.dependencies.wechat.queryMixedOrder(
			{
				orderId: order.medicalOrderId,
				mixTradeNo: order.wechatMixTradeNo,
				expectedOutTradeNo: order.wechatOutTradeNo,
				expectedPayOrdId: order.payOrdId,
				expectedTotalFen: amounts.totalFen,
				expectedCashFen: breakdown.wechatCashFen,
			},
			context,
		);
		if (
			mixed.totalFen !== amounts.totalFen ||
			mixed.cashFen !== breakdown.wechatCashFen ||
			mixed.fundFen !== amounts.fundFen ||
			mixed.personalAccountFen !== amounts.personalAccountFen ||
			mixed.medicalCashFen !== amounts.cashFen ||
			mixed.otherPaymentFen !== (amounts.otherPaymentFen ?? 0) ||
			JSON.stringify(mixed.cashReduceDetails) !==
				JSON.stringify(breakdown.cashReduceDetails)
		)
			return invalid("实时支付金额与原结算或医院减免不一致，请核对原订单");
		let paidCash = breakdown.wechatCashFen > 0 && mixed.cashState === "paid";
		let paidMedical =
			amounts.personalAccountFen + amounts.fundFen > 0 &&
			mixed.insuranceState === "paid";
		if (scope !== "HI" && breakdown.wechatCashFen > 0) {
			try {
				const cash = await this.dependencies.wechat.queryPaidOrderForRefund(
					{ orderId: order.wechatOutTradeNo },
					context,
				);
				if (cash.totalFen !== breakdown.wechatCashFen)
					return invalid("微信原支付金额不一致，请核对原订单");
				paidCash = cash.state === "cash_paid";
			} catch (error) {
				if (
					!(
						error instanceof ProviderRequestError &&
						error.provider === "wechat-pay" &&
						error.operation === "order-query" &&
						error.statusCode === 404 &&
						error.providerErrorCode === "ORDER_NOT_EXIST" &&
						error.requestOutcome === "rejected" &&
						!error.responseInvalid
					)
				)
					throw error;
				paidCash = false;
			}
		}
		if (
			scope !== "CASH" &&
			amounts.personalAccountFen + amounts.fundFen > 0 &&
			mixed.insuranceState !== "failed"
		) {
			const read = this.dependencies.credentials.getForRefund;
			const credential = read
				? await read.call(this.dependencies.credentials, {
						ownerUserId: order.ownerUserId,
						medicalOrderId: order.medicalOrderId,
						payOrdId: order.payOrdId,
						purpose: "query",
					})
				: undefined;
			if (
				!credential ||
				credential.ownerUserId !== order.ownerUserId ||
				credential.medicalOrderId !== order.medicalOrderId ||
				credential.payOrdId !== order.payOrdId ||
				credential.purpose !== "query"
			)
				return invalid("原医保查单凭证不可用，请核对原支付记录");
			const identity = credential.providerQueryIdentity;
			if (
				!isValidMedicalInsuranceProviderQueryIdentity(identity) ||
				typeof credential.payToken !== "string" ||
				!credential.payToken.trim()
			)
				return invalid("原医保查单凭证不完整，请核对原支付记录");
			const result = await this.dependencies.medical.querySettlement(
				{
					payOrdId: credential.payOrdId,
					payToken: credential.payToken,
					orgCodg: identity.orgCodg,
					idNo: identity.idNo,
					userName: identity.userName,
					idType: identity.idType,
				},
				context,
			);
			if (result.settlement.payOrdId !== order.payOrdId)
				return invalid("医保查单引用与原订单不一致");
			if (!["4", "5", "6"].includes(result.settlement.ordStas))
				paidMedical = false;
			else {
				const queried = result.settlement.amounts;
				if (
					!queried ||
					!coreFields.every((field) => queried[field] === amounts[field]) ||
					!optionalFields.every(
						(field) => (queried[field] ?? 0) === (amounts[field] ?? 0),
					)
				)
					return invalid("医保实时结算金额与原订单不一致");
				paidMedical = true;
			}
		}
		const current = await this.dependencies.orders.findByMedicalOrderId(
			order.medicalOrderId,
		);
		if (
			!current ||
			current.medicalOrderId !== order.medicalOrderId ||
			current.patientId !== order.patientId ||
			current.version !== order.version ||
			current.ownerUserId !== order.ownerUserId ||
			current.authorizationId !== order.authorizationId ||
			current.status !== order.status ||
			current.orderType !== order.orderType ||
			current.wechatPaymentState !== order.wechatPaymentState ||
			current.payOrdId !== order.payOrdId ||
			current.wechatMixTradeNo !== order.wechatMixTradeNo ||
			current.wechatOutTradeNo !== order.wechatOutTradeNo ||
			!coreFields.every(
				(field) => current.amounts?.[field] === amounts[field],
			) ||
			!optionalFields.every(
				(field) => current.amounts?.[field] === amounts[field],
			)
		)
			return invalid("核验期间原订单已变化，请刷新后重试");
		const age = this.now().getTime() - started.getTime();
		if (!Number.isFinite(age) || age < 0 || age > 60_000)
			return invalid("支付核验已过期，请刷新后重试");
		return {
			orderId: order.medicalOrderId,
			version: order.version,
			payOrdId: order.payOrdId,
			mixTradeNo: order.wechatMixTradeNo,
			outTradeNo: order.wechatOutTradeNo,
			amounts,
			actualCashFen: breakdown.wechatCashFen,
			paidCash,
			paidMedical,
			queriedAt: started.toISOString(),
		};
	}
}
