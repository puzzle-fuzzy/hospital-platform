import { isBoundedOpaqueIdentifier } from "./opaque-identifier";

export type PaymentAggregateBusiness = "registration" | "outpatient" | "other";

export type PaymentAggregateStatus =
	| "created"
	| "pending"
	| "paid"
	| "failed"
	| "refund_pending"
	| "refunded"
	| "manual_review";

/** Admin 列表当前可从来源订单确定的支付状态；退费状态由退费读模型另行计算。 */
export type PaymentHistoryStatus = Exclude<
	PaymentAggregateStatus,
	"refund_pending" | "refunded"
>;

export type PaymentAggregateHisSyncStatus =
	| "not_required"
	| "pending"
	| "succeeded"
	| "failed"
	| "manual_review";

export type PaymentLegType =
	| "medical_insurance"
	| "wechat_cash"
	| "hospital_reduce";

export type PaymentLegStatus =
	| "not_started"
	| "pending"
	| "confirmed"
	| "failed"
	| "refunded"
	| "manual_review";

export type PaymentOperationEventSource =
	| "payment_order"
	| "medical_insurance"
	| "wechat_pay"
	| "platform";

export type PaymentAggregate = {
	aggregateId: string;
	ownerUserId: string;
	patientId: string;
	business: PaymentAggregateBusiness;
	businessKey: string;
	businessId: string;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	status: PaymentAggregateStatus;
	hisSyncStatus: PaymentAggregateHisSyncStatus;
	sourceVersion: number;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type PaymentLeg = {
	legId: string;
	aggregateId: string;
	legType: PaymentLegType;
	source: PaymentOperationEventSource;
	sourceOrderId: string;
	amountFen: number;
	status: PaymentLegStatus;
	providerReferenceDigest?: string;
	confirmedAt?: string;
	version: number;
	createdAt: string;
	updatedAt: string;
};

export type PaymentOperationEvent = {
	eventId: string;
	aggregateId: string;
	legId?: string;
	source: PaymentOperationEventSource;
	eventType: string;
	previousStatus?: string;
	nextStatus: string;
	amountFen?: number;
	providerRequestId?: string;
	idempotencyKey: string;
	eventAt: string;
	payloadDigest: string;
};

/**
 * 支付来源订单写入运营台账时使用的纯数据投影。
 *
 * 该类型不包含 Provider 原文；MySQL 组合根可以把它与来源订单、
 * outbox 事件放进同一个事务。历史回填和外部 Provider 查单仍可继续使用
 * PaymentOperationsRepository 的独立投影路径。
 */
export type PaymentOperationsProjection = {
	aggregate: PaymentAggregate;
	legs: readonly PaymentLeg[];
	event?: PaymentOperationEvent;
};

export type PaymentOperationsRepository = {
	findAggregateById(aggregateId: string): Promise<PaymentAggregate | undefined>;
	findAggregateByBusinessKey(
		businessKey: string,
	): Promise<PaymentAggregate | undefined>;
	upsertAggregate(
		aggregate: PaymentAggregate,
		expectedVersion?: number,
	): Promise<PaymentAggregate>;
	upsertLeg(leg: PaymentLeg, expectedVersion?: number): Promise<PaymentLeg>;
	appendEvent(event: PaymentOperationEvent): Promise<PaymentOperationEvent>;
	listLegs(aggregateId: string): Promise<readonly PaymentLeg[]>;
	listEvents(aggregateId: string): Promise<readonly PaymentOperationEvent[]>;
};

export function assertPaymentOperationIdentifier(
	value: unknown,
	label: string,
): string {
	if (!isBoundedOpaqueIdentifier(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}
