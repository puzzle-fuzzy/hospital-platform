import { expect, test } from "bun:test";
import { parseManualReviewArgs } from "./manual-review";

test("人工复核列表默认使用有界条数", () => {
	expect(parseManualReviewArgs(["list"])).toEqual({
		action: "list",
		limit: 50,
	});
	expect(parseManualReviewArgs(["list", "--limit", "100"])).toEqual({
		action: "list",
		limit: 100,
	});
});

test("人工复核告警检查复用有限列表参数", () => {
	expect(parseManualReviewArgs(["check", "--limit", "20"])).toEqual({
		action: "check",
		limit: 20,
	});
});

test("人工复核重放必须有固定原因码和人工确认", () => {
	expect(
		parseManualReviewArgs([
			"requeue",
			"--kind",
			"outbox",
			"--id",
			"payment-order:order-001:created",
			"--reason",
			"operator-confirmed",
			"--confirm",
		]),
	).toEqual({
		action: "requeue",
		kind: "outbox",
		id: "payment-order:order-001:created",
		reasonCode: "operator-confirmed",
		confirmed: true,
	});

	expect(() =>
		parseManualReviewArgs([
			"requeue",
			"--kind",
			"outbox",
			"--id",
			"event-001",
			"--reason",
			"operator-confirmed",
		]),
	).toThrow("confirmation-required");

	expect(() =>
		parseManualReviewArgs([
			"requeue",
			"--kind",
			"outbox",
			"--id",
			"event-001",
			"--reason",
			"provider-error-message",
			"--confirm",
		]),
	).toThrow("invalid-reason");
});

test("人工复核列表拒绝无界或带确认参数的读取", () => {
	expect(() => parseManualReviewArgs(["list", "--limit", "101"])).toThrow(
		"invalid-limit",
	);
	expect(() => parseManualReviewArgs(["list", "--confirm"])).toThrow(
		"unexpected-confirm",
	);
});
