/**
 * 人工复核队列只暴露运维需要的低敏摘要。
 *
 * 这里故意不包含 outbox payload、患者号、身份证、支付参数或 provider 原始
 * 报文。维护命令只能先查看“哪一类任务卡住了”，不能借查询功能把敏感业务
 * 事实导出到终端或日志。
 */
export type OutboxManualReviewItem = {
	kind: "outbox";
	eventId: string;
	eventName: string;
	aggregateId: string;
	attempts: number;
	occurredAt: string;
	availableAt: string;
	manualReviewAt?: string;
	reasonCode?: string;
};

/** 微信查单人工复核摘要不包含 owner、患者号、prepay 参数或密文。 */
export type PaymentManualReviewItem = {
	kind: "wechat-payment-query";
	attemptId: string;
	orderId: string;
	provider: "wechat-pay";
	status: "manual_review";
	version: number;
	queryAttempts: number;
	manualReviewAt?: string;
	lastErrorCode?: string;
	createdAt: string;
	updatedAt: string;
};

export type ManualReviewSnapshot = {
	outbox: readonly OutboxManualReviewItem[];
	paymentQueries: readonly PaymentManualReviewItem[];
};

export type ManualReviewKind = "outbox" | "wechat-payment-query";

/** 维护命令只接受固定格式的原因码，禁止把自由文本/异常原文写回数据库。 */
export type ManualReviewReasonCode =
	| "operator-confirmed"
	| "provider-evidence-confirmed"
	| "false-positive-reviewed";

export const MANUAL_REVIEW_REASON_CODES: readonly ManualReviewReasonCode[] = [
	"operator-confirmed",
	"provider-evidence-confirmed",
	"false-positive-reviewed",
];

/**
 * 人工复核仓储是受控维护能力，不属于患者 API。
 * requeue 只允许把当前仍处于 manual_review 的一条记录重新放回队列；
 * 仓储必须使用状态条件更新，避免把已经被其他运维人员处理的记录覆盖。
 */
export interface ManualReviewRepository {
	list(limit: number): Promise<ManualReviewSnapshot>;
	requeue(input: {
		kind: ManualReviewKind;
		id: string;
		now: Date;
		reasonCode: ManualReviewReasonCode;
	}): Promise<boolean>;
}
