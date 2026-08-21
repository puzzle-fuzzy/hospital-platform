import { expect, test } from "bun:test";
import {
	auditCurrentLoggingEventDocumentation,
	auditLoggingEventDocumentation,
	extractStaticEventNames,
} from "./logging-event-audit.mjs";

test("日志事件审计只提取静态 event 字面量", () => {
	const events = extractStaticEventNames(
		[
			'logger.info({ event: "alpha.started" });',
			"logger.warn({ event: 'beta.failed' });",
			"logger.info({ event: " + "`gamma.$" + "{kind}`" + " });",
			'const event = "not-a-log-event";',
		].join("\\n"),
	);

	expect(events).toEqual(["alpha.started", "beta.failed"]);
});

test("日志事件文档审计报告缺失登记，而不是放宽文档边界", () => {
	const result = auditLoggingEventDocumentation({
		sourceFiles: ['logger.info({ event: "alpha.started" });'],
		documentation: "| `beta.started` | 已登记 |",
	});

	expect(result).toEqual({
		passed: false,
		discoveredEvents: ["alpha.started"],
		undocumentedEvents: ["alpha.started"],
	});
});

test("当前仓库的静态日志事件全部已登记", async () => {
	const result = await auditCurrentLoggingEventDocumentation();

	expect(result.passed).toBe(true);
	expect(result.undocumentedEvents).toEqual([]);
	expect(result.discoveredEvents.length).toBeGreaterThan(30);
});
