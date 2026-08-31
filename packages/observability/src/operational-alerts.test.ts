import { expect, test } from "bun:test";
import {
	evaluateOperationalAlerts,
	OPERATIONAL_ALERT_THRESHOLDS,
	type OperationalAlertSnapshot,
} from "./operational-alerts";

function createHealthySnapshot(): OperationalAlertSnapshot {
	return {
		api: {
			status: "ready",
			dependencies: { database: "ok", redis: "ok", schema: "ok" },
		},
		worker: { status: "ready", expectedToRun: true },
		outbox: {
			pendingCount: 0,
			retryScheduledCount: 0,
			manualReviewCount: 0,
			oldestPendingAgeMs: 0,
		},
		payment: {
			queryPendingCount: 0,
			queryManualReviewCount: 0,
			oldestQueryPendingAgeMs: 0,
			providerRequestCount: 0,
			providerFailureCount: 0,
			providerP95LatencyMs: 0,
			recoveryFailureCount: 0,
		},
	};
}

test("健康快照不产生告警，且没有请求量时不计算错误率", () => {
	expect(evaluateOperationalAlerts(createHealthySnapshot())).toEqual([]);
});

test("按严重级别和代码稳定输出多类告警", () => {
	const snapshot = createHealthySnapshot();
	snapshot.api.status = "not_ready";
	snapshot.worker.status = "not_configured";
	snapshot.outbox.manualReviewCount = 1;
	snapshot.outbox.retryScheduledCount =
		OPERATIONAL_ALERT_THRESHOLDS.outboxRetryBacklogCount;
	snapshot.payment.providerRequestCount = 20;
	snapshot.payment.providerFailureCount = 5;
	snapshot.payment.providerP95LatencyMs =
		OPERATIONAL_ALERT_THRESHOLDS.providerP95LatencyMs;

	expect(
		evaluateOperationalAlerts(snapshot).map((alert) => alert.code),
	).toEqual([
		"api-readiness-not-ready",
		"outbox-manual-review",
		"provider-error-rate-high",
		"worker-not-configured",
		"outbox-retry-backlog",
		"provider-latency-high",
	]);
});

test("未计划运行的 not_configured worker 不误报，实际运行后才告警", () => {
	const snapshot = createHealthySnapshot();
	snapshot.worker.status = "not_configured";
	snapshot.worker.expectedToRun = false;
	expect(evaluateOperationalAlerts(snapshot)).toEqual([]);
	snapshot.worker.expectedToRun = true;
	expect(
		evaluateOperationalAlerts(snapshot).map((alert) => alert.code),
	).toEqual(["worker-not-configured"]);
});

test("只有存在待处理记录时才告警过期积压", () => {
	const snapshot = createHealthySnapshot();
	snapshot.outbox.oldestPendingAgeMs =
		OPERATIONAL_ALERT_THRESHOLDS.outboxStalePendingAgeMs;
	snapshot.payment.oldestQueryPendingAgeMs =
		OPERATIONAL_ALERT_THRESHOLDS.paymentQueryStalePendingAgeMs;
	expect(evaluateOperationalAlerts(snapshot)).toEqual([]);
	snapshot.outbox.pendingCount = 1;
	snapshot.payment.queryPendingCount = 1;
	expect(
		evaluateOperationalAlerts(snapshot).map((alert) => alert.code),
	).toEqual(["outbox-stale-pending", "payment-query-stale-pending"]);
});

test("拒绝不可能的聚合指标", () => {
	const snapshot = createHealthySnapshot();
	snapshot.payment.providerFailureCount = 2;
	snapshot.payment.providerRequestCount = 1;
	expect(() => evaluateOperationalAlerts(snapshot)).toThrow(
		"providerFailureCount cannot exceed providerRequestCount",
	);
});
