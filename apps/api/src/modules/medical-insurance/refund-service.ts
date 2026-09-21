import { createHash } from "node:crypto";
import type { MedicalInsuranceRefundPayload } from "@hospital/contracts";
import {
	type AdapterCallContext,
	type MedicalInsuranceAuthorizationRepository,
	type MedicalInsuranceOrder,
	type MedicalInsuranceOrderRepository,
	type MedicalInsuranceRefund,
	type MedicalInsuranceRefundGateway,
	type MedicalInsuranceRefundRepository,
	type MedicalInsuranceRefundType,
	type WechatRefund,
	type PaymentOperationsRepository,
	type PaymentOperatorAuditRepository,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
} from "@hospital/domain";
import {
	MedicalInsuranceOrderNotFoundError,
	MedicalInsuranceRegistrationInputError,
} from "./errors";
import type { AdminWechatRefundService } from "../admin/wechat-refund-service";

type MedicalInsuranceRefundRequest = {
	refundType: MedicalInsuranceRefundType;
	refundFen?: number;
	personalAccountRefundFen?: number;
	fundRefundFen?: number;
	reason?: string;
};

type RefundPlan = {
	refundType: MedicalInsuranceRefundType;
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
	reason?: string;
};

function contextOf(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) {
		throw new MedicalInsuranceRegistrationInputError(
			"Medical insurance refund context is invalid",
		);
	}
	return context;
}

function bounded(value: unknown, label: string): string {
	if (!isBoundedOpaqueIdentifier(value)) {
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	}
	return value;
}

function amount(value: unknown, label: string, allowZero = true): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		(allowZero ? value < 0 : value <= 0)
	) {
		throw new MedicalInsuranceRegistrationInputError(`${label} is invalid`);
	}
	return value;
}

function reasonOf(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" || !value.trim() || value.length > 80) {
		throw new MedicalInsuranceRegistrationInputError("退款原因不合法");
	}
	const reason = value.trim();
	if (
		new TextEncoder().encode(reason).byteLength > 80 ||
		Array.from(reason).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new MedicalInsuranceRegistrationInputError("退款原因不合法");
	}
	return reason;
}

function planOf(
	input: MedicalInsuranceRefundRequest,
	original: NonNullable<MedicalInsuranceOrder["amounts"]>,
): RefundPlan {
	if (
		original.totalFen !==
		original.cashFen + original.personalAccountFen + original.fundFen
	) {
		throw new MedicalInsuranceRegistrationInputError(
			"当前医保订单包含 6203 未覆盖的扩展支付分项，暂不能安全退费",
		);
	}
	const refundType = input.refundType;
	if (refundType !== "ALL" && refundType !== "CASH" && refundType !== "HI") {
		throw new MedicalInsuranceRegistrationInputError("refundType is invalid");
	}
	const reason = reasonOf(input.reason);
	if (refundType === "ALL") {
		if (
			input.refundFen !== undefined ||
			input.personalAccountRefundFen !== undefined ||
			input.fundRefundFen !== undefined
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"ALL 退费不接受自定义金额",
			);
		}
		return {
			refundType,
			totalFen: original.totalFen,
			cashFen: original.cashFen,
			personalAccountFen: original.personalAccountFen,
			fundFen: original.fundFen,
			...(reason ? { reason } : {}),
		};
	}
	if (refundType === "CASH") {
		if (
			input.refundFen === undefined ||
			input.personalAccountRefundFen !== undefined ||
			input.fundRefundFen !== undefined
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"CASH 退费必须只提交 refundFen",
			);
		}
		const refundFen = amount(input.refundFen, "refundFen", false);
		if (refundFen > original.cashFen) {
			throw new MedicalInsuranceRegistrationInputError(
				"CASH 退费金额超过原微信自费金额",
			);
		}
		return {
			refundType,
			totalFen: refundFen,
			cashFen: refundFen,
			personalAccountFen: 0,
			fundFen: 0,
			...(reason ? { reason } : {}),
		};
	}
	if (input.refundFen !== undefined) {
		throw new MedicalInsuranceRegistrationInputError("HI 退费不接受 refundFen");
	}
	const personalAccountFen = amount(
		input.personalAccountRefundFen ?? 0,
		"personalAccountRefundFen",
	);
	const fundFen = amount(input.fundRefundFen ?? 0, "fundRefundFen");
	const totalFen = personalAccountFen + fundFen;
	if (
		totalFen <= 0 ||
		personalAccountFen > original.personalAccountFen ||
		fundFen > original.fundFen
	) {
		throw new MedicalInsuranceRegistrationInputError(
			"HI 退费金额超过原医保支付分项",
		);
	}
	return {
		refundType,
		totalFen,
		cashFen: 0,
		personalAccountFen,
		fundFen,
		...(reason ? { reason } : {}),
	};
}

function yuan(fen: number): string {
	return (fen / 100).toFixed(2);
}

function beijingTimestamp(date: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		calendar: "gregory",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const value = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${value.year}${value.month}${value.day}${value.hour}${value.minute}${value.second}`;
}

function refundNoOf(orderId: string, idempotencyKey: string): string {
	return `RFMI${createHash("sha256")
		.update(`${orderId}\n${idempotencyKey}`, "utf8")
		.digest("hex")
		.slice(0, 48)}`;
}

function providerErrorCode(error: unknown): string {
	if (error && typeof error === "object") {
		const providerErrorCode = (error as { providerErrorCode?: unknown })
			.providerErrorCode;
		if (typeof providerErrorCode === "string" && providerErrorCode.trim()) {
			return providerErrorCode.trim().slice(0, 128);
		}
	}
	return error instanceof Error ? error.name : "UNKNOWN";
}

function providerRequestId(error: unknown): string | null {
	if (error && typeof error === "object") {
		const requestId = (error as { requestId?: unknown }).requestId;
		if (typeof requestId === "string" && requestId.trim()) {
			return requestId.trim().slice(0, 128);
		}
	}
	return null;
}

function unknownProviderFailure(error: unknown): boolean {
	return (
		(error !== null &&
			typeof error === "object" &&
			(error as { requestOutcome?: unknown }).requestOutcome === "unknown") ||
		(error as { responseInvalid?: unknown }).responseInvalid === true ||
		(error as { name?: unknown }).name === "LegacyFsiContractError"
	);
}

function responseOf(
	record: MedicalInsuranceRefund,
): MedicalInsuranceRefundPayload["data"] {
	return {
		orderId: record.medicalOrderId,
		refundNo: record.refundNo,
		status: record.status,
		medicalStatus: record.medicalStatus,
		wechatStatus: record.wechatStatus,
		amounts: {
			totalFen: record.totalFen,
			cashFen: record.cashFen,
			personalAccountFen: record.personalAccountFen,
			fundFen: record.fundFen,
		},
	};
}

export type MedicalInsuranceRefundServiceDependencies = {
	orders: MedicalInsuranceOrderRepository;
	authorizations: MedicalInsuranceAuthorizationRepository;
	refunds: MedicalInsuranceRefundRepository;
	medicalInsuranceRefund: MedicalInsuranceRefundGateway;
	wechatRefund?: AdminWechatRefundService;
	paymentOperations?: PaymentOperationsRepository;
	operatorAudits?: PaymentOperatorAuditRepository;
	now?: () => Date;
	createId?: () => string;
};

export class MedicalInsuranceRefundService {
	private readonly now: () => Date;
	private readonly createId: () => string;

	constructor(
		private readonly dependencies: MedicalInsuranceRefundServiceDependencies,
	) {
		this.now = dependencies.now ?? (() => new Date());
		this.createId = dependencies.createId ?? (() => crypto.randomUUID());
	}

	private async appendAdminRefundAudit(input: {
		orderId: string;
		requestId: string;
		operatorRef?: string;
		outcome: "succeeded" | "failed" | "rejected";
		reasonCode?: string;
	}): Promise<void> {
		const audits = this.dependencies.operatorAudits;
		if (!audits) return;
		const aggregateId = this.dependencies.paymentOperations
			? (
					await this.dependencies.paymentOperations.findAggregateByBusinessKey(
						`medical_insurance:${input.orderId}`,
					)
				)?.aggregateId
			: undefined;
		await audits.append({
			auditId: `audit-refund-request-${this.createId()}`,
			operatorRef: input.operatorRef ?? null,
			action: "refund_request",
			...(aggregateId ? { aggregateId } : {}),
			requestId: input.requestId,
			outcome: input.outcome,
			...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
			occurredAt: this.now().toISOString(),
		});
	}

	private async save(
		record: MedicalInsuranceRefund,
		patch: Partial<
			Pick<
				MedicalInsuranceRefund,
				| "medicalStatus"
				| "medicalRefStatus"
				| "medicalProviderRequestId"
				| "wechatStatus"
				| "wechatMerchantRefundNo"
				| "status"
				| "lastErrorCode"
			>
		>,
	): Promise<MedicalInsuranceRefund> {
		const updated = await this.dependencies.refunds.update(
			{
				...record,
				...patch,
				version: record.version + 1,
				updatedAt: this.now().toISOString(),
			},
			record.version,
		);
		if (!updated) {
			throw new Error("Medical insurance refund record changed concurrently");
		}
		return updated;
	}

	private async requestMedical(
		record: MedicalInsuranceRefund,
		order: MedicalInsuranceOrder,
		context: AdapterCallContext,
	): Promise<MedicalInsuranceRefund> {
		if (!order.authorizationId) {
			return this.save(record, {
				medicalStatus: "unknown",
				status: "manual_review",
				lastErrorCode: "authorization-context-unavailable",
			});
		}
		const authorization = await this.dependencies.authorizations.getForRefund({
			authorizationId: order.authorizationId,
			ownerUserId: order.ownerUserId,
			medicalOrderId: order.medicalOrderId,
		});
		if (!authorization) {
			return this.save(record, {
				medicalStatus: "unknown",
				status: "manual_review",
				lastErrorCode: "authorization-context-unavailable",
			});
		}
		const processing = await this.save(record, {
			medicalStatus: "processing",
			status: "processing",
			lastErrorCode: null,
		});
		const data: Record<string, unknown> = {
			payOrdId: record.payOrdId,
			appRefdSn: record.refundNo,
			appRefdTime: beijingTimestamp(this.now()),
			refdType: record.refundType,
			totlRefdAmt: yuan(record.totalFen),
			cashRefdAmt: yuan(record.cashFen),
			psnAcctRefdAmt: yuan(record.personalAccountFen),
			fundRefdAmt: yuan(record.fundFen),
			...(authorization.ecToken
				? { ecToken: authorization.ecToken }
				: { payAuthNo: authorization.payAuthNo }),
		};
		try {
			const result = await this.dependencies.medicalInsuranceRefund.refund(
				data,
				{
					totalFen: order.amounts?.totalFen ?? 0,
					cashFen: order.amounts?.cashFen ?? 0,
					personalAccountFen: order.amounts?.personalAccountFen ?? 0,
					fundFen: order.amounts?.fundFen ?? 0,
				},
				{ ...context, idempotencyKey: record.refundNo },
			);
			return this.save(processing, {
				medicalStatus:
					result.refStatus === "SUCC"
						? "success"
						: result.refStatus === "EXP"
							? "unknown"
							: "failed",
				medicalRefStatus: result.refStatus,
				medicalProviderRequestId: result.trace.requestId,
				status:
					result.refStatus === "SUCC"
						? record.cashFen > 0
							? "processing"
							: "succeeded"
						: result.refStatus === "EXP"
							? "manual_review"
							: "failed",
				lastErrorCode: result.refStatus === "SUCC" ? null : result.refStatus,
			});
		} catch (error) {
			return this.save(processing, {
				medicalStatus: unknownProviderFailure(error) ? "unknown" : "failed",
				medicalRefStatus: null,
				medicalProviderRequestId: providerRequestId(error),
				status: unknownProviderFailure(error) ? "manual_review" : "failed",
				lastErrorCode: providerErrorCode(error),
			});
		}
	}

	private async requestWechat(
		record: MedicalInsuranceRefund,
		context: AdapterCallContext,
		reason?: string,
	): Promise<MedicalInsuranceRefund> {
		if (record.cashFen <= 0) {
			return this.save(record, {
				wechatStatus: "not_required",
				status: "succeeded",
			});
		}
		if (!this.dependencies.wechatRefund) {
			return this.save(record, {
				wechatStatus: "failed",
				status: "manual_review",
				lastErrorCode: "wechat-refund-not-configured",
			});
		}
		if (record.wechatStatus === "processing") return record;
		try {
			const result: WechatRefund =
				await this.dependencies.wechatRefund.requestTrustedMedicalInsurance(
					{
						orderId: record.medicalOrderId,
						refundFen: record.cashFen,
						idempotencyKey: `medical-refund:${record.refundNo}`,
						merchantRefundNo: record.refundNo,
						...(reason ? { reason } : {}),
					},
					{ ...context, idempotencyKey: record.refundNo },
				);
			const status =
				result.status === "success"
					? "success"
					: result.status === "processing"
						? "processing"
						: result.status === "unknown"
							? "unknown"
							: "failed";
			return this.save(record, {
				wechatStatus: status,
				wechatMerchantRefundNo: result.merchantRefundNo,
				status:
					status === "success"
						? "succeeded"
						: status === "processing"
							? "processing"
							: "manual_review",
				lastErrorCode: status === "success" ? null : result.lastErrorCode,
			});
		} catch (error) {
			return this.save(record, {
				wechatStatus: unknownProviderFailure(error) ? "unknown" : "failed",
				status: "manual_review",
				lastErrorCode: providerErrorCode(error),
			});
		}
	}

	/**
	 * Admin 只允许整笔聚合退费：医保 6203 与微信 APIv3 由同一次服务端
	 * 编排完成，幂等键固定绑定订单，避免管理员重复点击产生第二笔退费。
	 */
	async requestFullRefundByOrder(input: {
		orderId: string;
		reason?: string;
		context: unknown;
		operatorRef?: string;
	}): Promise<MedicalInsuranceRefundPayload["data"]> {
		const orderId = bounded(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order) throw new MedicalInsuranceOrderNotFoundError();
		const context = contextOf(input.context);
		const adminIdempotencyKey = `admin-medical-full:${orderId}`;
		const existing =
			await this.dependencies.refunds.findLatestByMedicalOrderId(orderId);
		if (existing && existing.idempotencyKey !== adminIdempotencyKey) {
			throw new MedicalInsuranceRegistrationInputError(
				"该医保订单已有退费记录，不能再从 Admin 发起整笔退费",
			);
		}
		const existingWechatRefund =
			await this.dependencies.wechatRefund?.findMedicalInsuranceRefundByOrder(
				orderId,
			);
		if (!existing && existingWechatRefund) {
			throw new MedicalInsuranceRegistrationInputError(
				"该医保订单已有微信单腿退费记录，不能再发起整笔退费",
			);
		}
		let result: MedicalInsuranceRefundPayload["data"];
		try {
			result = await this.request({
				ownerUserId: order.ownerUserId,
				orderId,
				refund: {
					refundType: "ALL",
					...(input.reason !== undefined ? { reason: input.reason } : {}),
				},
				context: {
					...context,
					idempotencyKey: adminIdempotencyKey,
				},
			});
		} catch (error) {
			await this.appendAdminRefundAudit({
				orderId,
				requestId: context.traceId,
				...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
				outcome: "failed",
				reasonCode: providerErrorCode(error),
			});
			throw error;
		}
		await this.appendAdminRefundAudit({
			orderId,
			requestId: context.traceId,
			...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
			outcome:
				result.status === "failed"
					? "failed"
					: result.status === "manual_review"
						? "rejected"
						: "succeeded",
			...(result.status === "manual_review"
				? { reasonCode: "manual_review" }
				: {}),
		});
		return result;
	}

	/**
	 * HIS 医保单腿退费入口。医保金额、授权上下文和 payOrdId 均来自服务端
	 * 6202 订单事实；HIS 只提交订单号和原因，不能覆盖医保分项金额。
	 */
	async requestMedicalOnlyByOrder(input: {
		orderId: string;
		reason?: string;
		context: unknown;
		operatorRef?: string;
	}): Promise<MedicalInsuranceRefundPayload["data"]> {
		const orderId = bounded(input.orderId, "orderId");
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order) throw new MedicalInsuranceOrderNotFoundError();
		const context = contextOf(input.context);
		const idempotencyKey = `his-medical-leg:${orderId}`;
		const existing =
			await this.dependencies.refunds.findLatestByMedicalOrderId(orderId);
		if (existing && existing.idempotencyKey !== idempotencyKey) {
			throw new MedicalInsuranceRegistrationInputError(
				"该医保订单已有其他退费记录，不能再次单独退医保",
			);
		}
		let result: MedicalInsuranceRefundPayload["data"];
		try {
			result = await this.request({
				ownerUserId: order.ownerUserId,
				orderId,
				refund: {
					refundType: "HI",
					...(order.amounts?.personalAccountFen !== undefined
						? { personalAccountRefundFen: order.amounts.personalAccountFen }
						: {}),
					...(order.amounts?.fundFen !== undefined
						? { fundRefundFen: order.amounts.fundFen }
						: {}),
					...(input.reason !== undefined ? { reason: input.reason } : {}),
				},
				context: { ...context, idempotencyKey },
			});
		} catch (error) {
			await this.appendAdminRefundAudit({
				orderId,
				requestId: context.traceId,
				...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
				outcome: "failed",
				reasonCode: providerErrorCode(error),
			});
			throw error;
		}
		await this.appendAdminRefundAudit({
			orderId,
			requestId: context.traceId,
			...(input.operatorRef ? { operatorRef: input.operatorRef } : {}),
			outcome:
				result.status === "failed"
					? "failed"
					: result.status === "manual_review"
						? "rejected"
						: "succeeded",
			...(result.status === "manual_review"
				? { reasonCode: "manual_review" }
				: {}),
		});
		return result;
	}

	async query(
		refundNo: string,
		context: { requestId?: string; operatorRef?: string } = {},
	): Promise<MedicalInsuranceRefundPayload["data"] | undefined> {
		const record = await this.dependencies.refunds.findByRefundNo(
			bounded(refundNo, "refundNo"),
		);
		if (!record) return undefined;
		if (this.dependencies.operatorAudits) {
			const aggregateId = this.dependencies.paymentOperations
				? (
						await this.dependencies.paymentOperations.findAggregateByBusinessKey(
							`medical_insurance:${record.medicalOrderId}`,
						)
					)?.aggregateId
				: undefined;
			await this.dependencies.operatorAudits.append({
				auditId: `audit-refund-query-${this.createId()}`,
				operatorRef: context.operatorRef ?? null,
				action: "refund_query",
				...(aggregateId ? { aggregateId } : {}),
				...(context.requestId ? { requestId: context.requestId } : {}),
				outcome: "succeeded",
				occurredAt: this.now().toISOString(),
			});
		}
		return responseOf(record);
	}

	async request(input: {
		ownerUserId: string;
		orderId: string;
		refund: MedicalInsuranceRefundRequest;
		context: unknown;
	}): Promise<MedicalInsuranceRefundPayload["data"]> {
		const ownerUserId = bounded(input.ownerUserId, "ownerUserId");
		const orderId = bounded(input.orderId, "orderId");
		const context = contextOf(input.context);
		const order = await this.dependencies.orders.findByMedicalOrderId(orderId);
		if (!order || order.ownerUserId !== ownerUserId) {
			throw new MedicalInsuranceOrderNotFoundError();
		}
		if (!order.amounts || !order.payOrdId) {
			throw new MedicalInsuranceRegistrationInputError(
				"医保订单尚未形成可退费的 6202 结算事实",
			);
		}
		if (
			order.status !== "insurance_settled" &&
			!(
				order.status === "cash_pending" &&
				order.wechatPaymentState === "cash_paid"
			)
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"医保订单尚未完成支付，不能发起退费",
			);
		}
		const plan = planOf(input.refund, order.amounts);
		if (plan.cashFen > 0 && order.wechatPaymentState !== "cash_paid") {
			throw new MedicalInsuranceRegistrationInputError(
				"微信自费段尚未确认支付成功，不能退现金段",
			);
		}
		const refundNo = refundNoOf(orderId, context.idempotencyKey);
		const now = this.now().toISOString();
		const initial: MedicalInsuranceRefund = {
			refundId: `medical-refund-${this.createId()}`,
			medicalOrderId: orderId,
			ownerUserId,
			payOrdId: order.payOrdId,
			refundNo,
			idempotencyKey: context.idempotencyKey,
			refundType: plan.refundType,
			totalFen: plan.totalFen,
			cashFen: plan.cashFen,
			personalAccountFen: plan.personalAccountFen,
			fundFen: plan.fundFen,
			medicalStatus: "requested",
			medicalRefStatus: null,
			medicalProviderRequestId: null,
			wechatStatus: plan.cashFen > 0 ? "requested" : "not_required",
			wechatMerchantRefundNo: plan.cashFen > 0 ? refundNo : null,
			status: "requested",
			lastErrorCode: null,
			version: 1,
			createdAt: now,
			updatedAt: now,
		};
		const reserved = await this.dependencies.refunds.reserve(initial);
		let record = reserved.record;
		if (
			record.medicalOrderId !== orderId ||
			record.ownerUserId !== ownerUserId ||
			record.totalFen !== plan.totalFen ||
			record.cashFen !== plan.cashFen ||
			record.personalAccountFen !== plan.personalAccountFen ||
			record.fundFen !== plan.fundFen ||
			record.refundType !== plan.refundType
		) {
			throw new MedicalInsuranceRegistrationInputError(
				"相同幂等键对应的退费金额或类型不一致",
			);
		}
		if (
			record.status === "succeeded" ||
			record.status === "failed" ||
			record.status === "manual_review" ||
			(record.status === "processing" && record.medicalStatus !== "success")
		) {
			if (
				record.medicalStatus !== "success" ||
				record.wechatStatus === "success" ||
				record.cashFen <= 0
			) {
				return responseOf(record);
			}
		}
		if (record.medicalStatus === "requested") {
			if (reserved.status !== "inserted") return responseOf(record);
			record = await this.requestMedical(record, order, context);
		}
		if (record.medicalStatus !== "success") return responseOf(record);
		if (record.cashFen > 0 && record.wechatStatus !== "success") {
			record = await this.requestWechat(record, context, plan.reason);
		}
		return responseOf(record);
	}
}

export { contextOf as medicalInsuranceRefundContextOf };
