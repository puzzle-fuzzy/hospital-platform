/**
 * 运行告警只接收低敏聚合指标，不接收用户、患者、订单号、Provider 原文
 * 或任何凭据。这个模块负责把 API/Worker 的健康快照统一映射成告警规则，
 * 真正的指标采集、监控平台配置和通知渠道仍由部署环境负责。
 */

export type OperationalAlertSeverity = "critical" | "warning";

export type OperationalDependencyState =
	| "ok"
	| "not_configured"
	| "unavailable";

export type OperationalAlertCode =
	| "api-readiness-not-ready"
	| "worker-not-ready"
	| "worker-not-configured"
	| "outbox-manual-review"
	| "outbox-retry-backlog"
	| "outbox-stale-pending"
	| "payment-query-manual-review"
	| "payment-query-stale-pending"
	| "provider-error-rate-high"
	| "provider-latency-high"
	| "recovery-failure";

export type OperationalAlert = {
	code: OperationalAlertCode;
	severity: OperationalAlertSeverity;
	message: string;
	observedValue: number;
	threshold?: number;
};

export type OperationalAlertSnapshot = {
	api: {
		status: "ready" | "not_ready";
		dependencies: {
			database: OperationalDependencyState;
			redis: OperationalDependencyState;
			schema: OperationalDependencyState;
		};
	};
	worker: {
		status: "ready" | "not_ready" | "not_configured";
		/** 支付 Worker 未计划运行时不应因 not_configured 产生误报。 */
		expectedToRun: boolean;
	};
	outbox: {
		pendingCount: number;
		retryScheduledCount: number;
		manualReviewCount: number;
		oldestPendingAgeMs: number;
	};
	payment: {
		queryPendingCount: number;
		queryManualReviewCount: number;
		oldestQueryPendingAgeMs: number;
		providerRequestCount: number;
		providerFailureCount: number;
		providerP95LatencyMs: number;
		recoveryFailureCount: number;
	};
};

/**
 * 默认阈值是告警初始基线，不是 Provider SLA 或最终业务承诺。
 * 先把规则固定成代码，部署时才能对照环境实际采样和调整，而不是在
 * Prometheus/日志平台里各写一套容易漂移的条件。
 */
export const OPERATIONAL_ALERT_THRESHOLDS = {
	outboxRetryBacklogCount: 10,
	outboxStalePendingAgeMs: 15 * 60 * 1000,
	paymentQueryStalePendingAgeMs: 15 * 60 * 1000,
	providerMinimumRequestCount: 20,
	providerFailureRate: 0.2,
	providerP95LatencyMs: 3_000,
} as const;

export class OperationalAlertSnapshotError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OperationalAlertSnapshotError";
	}
}

function requireNonNegativeFinite(value: number, field: string): number {
	if (!Number.isFinite(value) || value < 0) {
		throw new OperationalAlertSnapshotError(
			`${field} must be a finite non-negative number`,
		);
	}
	return value;
}

function validateSnapshot(snapshot: OperationalAlertSnapshot): void {
	const numericFields: Array<[number, string]> = [
		[snapshot.outbox.pendingCount, "outbox.pendingCount"],
		[snapshot.outbox.retryScheduledCount, "outbox.retryScheduledCount"],
		[snapshot.outbox.manualReviewCount, "outbox.manualReviewCount"],
		[snapshot.outbox.oldestPendingAgeMs, "outbox.oldestPendingAgeMs"],
		[snapshot.payment.queryPendingCount, "payment.queryPendingCount"],
		[snapshot.payment.queryManualReviewCount, "payment.queryManualReviewCount"],
		[
			snapshot.payment.oldestQueryPendingAgeMs,
			"payment.oldestQueryPendingAgeMs",
		],
		[snapshot.payment.providerRequestCount, "payment.providerRequestCount"],
		[snapshot.payment.providerFailureCount, "payment.providerFailureCount"],
		[snapshot.payment.providerP95LatencyMs, "payment.providerP95LatencyMs"],
		[snapshot.payment.recoveryFailureCount, "payment.recoveryFailureCount"],
	];
	for (const [value, field] of numericFields)
		requireNonNegativeFinite(value, field);
	if (
		snapshot.payment.providerFailureCount >
		snapshot.payment.providerRequestCount
	) {
		throw new OperationalAlertSnapshotError(
			"payment.providerFailureCount cannot exceed providerRequestCount",
		);
	}
}

function createAlert(
	code: OperationalAlertCode,
	severity: OperationalAlertSeverity,
	message: string,
	observedValue: number,
	threshold?: number,
): OperationalAlert {
	return {
		code,
		severity,
		message,
		observedValue,
		...(threshold === undefined ? {} : { threshold }),
	};
}

/**
 * 根据一次聚合快照返回当前需要呈现给监控系统的告警。
 * 没有请求量时不计算 Provider 错误率，避免低流量窗口把“0/0”误报成故障；
 * 返回顺序固定为严重级别再按规则代码排序，便于日志、测试和告警去重。
 */
export function evaluateOperationalAlerts(
	snapshot: OperationalAlertSnapshot,
	thresholds: typeof OPERATIONAL_ALERT_THRESHOLDS = OPERATIONAL_ALERT_THRESHOLDS,
): readonly OperationalAlert[] {
	validateSnapshot(snapshot);
	const alerts: OperationalAlert[] = [];

	if (snapshot.api.status !== "ready") {
		alerts.push(
			createAlert(
				"api-readiness-not-ready",
				"critical",
				"API readiness 未通过，禁止把实例视为可接收业务流量",
				1,
			),
		);
	}
	if (snapshot.worker.status === "not_ready") {
		alerts.push(
			createAlert(
				"worker-not-ready",
				"critical",
				"Worker 依赖未就绪，支付/补偿循环没有运行",
				1,
			),
		);
	}
	if (
		snapshot.worker.status === "not_configured" &&
		snapshot.worker.expectedToRun
	) {
		alerts.push(
			createAlert(
				"worker-not-configured",
				"critical",
				"Worker 被要求运行但配置不完整，业务循环保持关闭",
				1,
			),
		);
	}
	if (snapshot.outbox.manualReviewCount > 0) {
		alerts.push(
			createAlert(
				"outbox-manual-review",
				"critical",
				"Outbox 存在等待人工复核的事件",
				snapshot.outbox.manualReviewCount,
				0,
			),
		);
	}
	if (
		snapshot.outbox.retryScheduledCount >= thresholds.outboxRetryBacklogCount
	) {
		alerts.push(
			createAlert(
				"outbox-retry-backlog",
				"warning",
				"Outbox 自动重试队列达到积压阈值",
				snapshot.outbox.retryScheduledCount,
				thresholds.outboxRetryBacklogCount,
			),
		);
	}
	if (
		snapshot.outbox.pendingCount > 0 &&
		snapshot.outbox.oldestPendingAgeMs >= thresholds.outboxStalePendingAgeMs
	) {
		alerts.push(
			createAlert(
				"outbox-stale-pending",
				"warning",
				"Outbox 待处理事件超过允许等待时间",
				snapshot.outbox.oldestPendingAgeMs,
				thresholds.outboxStalePendingAgeMs,
			),
		);
	}
	if (snapshot.payment.queryManualReviewCount > 0) {
		alerts.push(
			createAlert(
				"payment-query-manual-review",
				"critical",
				"微信查单存在等待人工复核的记录",
				snapshot.payment.queryManualReviewCount,
				0,
			),
		);
	}
	if (
		snapshot.payment.queryPendingCount > 0 &&
		snapshot.payment.oldestQueryPendingAgeMs >=
			thresholds.paymentQueryStalePendingAgeMs
	) {
		alerts.push(
			createAlert(
				"payment-query-stale-pending",
				"warning",
				"微信查单待确认记录超过允许等待时间",
				snapshot.payment.oldestQueryPendingAgeMs,
				thresholds.paymentQueryStalePendingAgeMs,
			),
		);
	}
	if (
		snapshot.payment.providerRequestCount >=
		thresholds.providerMinimumRequestCount
	) {
		const failureRate =
			snapshot.payment.providerFailureCount /
			snapshot.payment.providerRequestCount;
		if (failureRate >= thresholds.providerFailureRate) {
			alerts.push(
				createAlert(
					"provider-error-rate-high",
					"critical",
					"Provider 错误率超过告警阈值",
					failureRate,
					thresholds.providerFailureRate,
				),
			);
		}
	}
	if (
		snapshot.payment.providerP95LatencyMs >= thresholds.providerP95LatencyMs
	) {
		alerts.push(
			createAlert(
				"provider-latency-high",
				"warning",
				"Provider P95 延迟超过告警阈值",
				snapshot.payment.providerP95LatencyMs,
				thresholds.providerP95LatencyMs,
			),
		);
	}
	if (snapshot.payment.recoveryFailureCount > 0) {
		alerts.push(
			createAlert(
				"recovery-failure",
				"critical",
				"支付或回写恢复流程出现失败",
				snapshot.payment.recoveryFailureCount,
				0,
			),
		);
	}

	return alerts.sort((left, right) => {
		const severityOrder = { critical: 0, warning: 1 } as const;
		return (
			severityOrder[left.severity] - severityOrder[right.severity] ||
			left.code.localeCompare(right.code)
		);
	});
}
