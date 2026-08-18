import { expect, test } from "bun:test";
import { auditBusinessEvidence } from "./p0-business-evidence-audit.mjs";

function correlationFor(events, httpCompletedStatusCounts = { 200: 1 }) {
	return {
		chainCount: 1,
		recordCount: events.length,
		missingCount: 0,
		truncated: false,
		chains: {
			"test-correlation": {
				events: Object.fromEntries(events.map((event) => [event, 1])),
				httpCompletedStatusCounts,
			},
		},
	};
}

test("P0 业务证据门禁要求请求和明确成功事件同时存在", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: {
				"appointment.records.requested": 2,
				"appointment.records.synced": 1,
				"appointment.records.failed": 1,
			},
			correlation: correlationFor([
				"appointment.records.requested",
				"appointment.records.synced",
				"appointment.records.failed",
			]),
		},
		["appointmentRecords"],
	);

	expect(result).toEqual({
		passed: true,
		parseErrors: 0,
		systemdWarningCount: 0,
		domains: {
			appointmentRecords: {
				label: "预约历史",
				requestedCount: 2,
				successCount: 1,
				failureCount: 1,
				correlatedChainCount: 1,
				httpSuccessChainCount: 1,
				missing: [],
				passed: true,
			},
		},
	});
});

test("只有 HTTP 或 requested 不能通过业务证据门禁", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: { "outpatient.payment.records.requested": 1 },
			correlation: correlationFor(["outpatient.payment.records.requested"]),
		},
		["outpatientPaymentRecords"],
	);

	expect(result.passed).toBe(false);
	expect(result.domains.outpatientPaymentRecords).toMatchObject({
		requestedCount: 1,
		successCount: 0,
		missing: ["success", "same-trace-request-success", "same-trace-http-2xx"],
		passed: false,
	});
});

test("患者同步的幂等重放是成功事实，但日志解析错误仍阻止通过", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 1,
			eventCounts: {
				"patient.directory.requested": 1,
				"patient.directory.operation.replayed": 1,
			},
			correlation: correlationFor([
				"patient.directory.requested",
				"patient.directory.operation.replayed",
			]),
		},
		["patientSync"],
	);

	expect(result.domains.patientSync).toMatchObject({
		successCount: 1,
		missing: [],
		passed: false,
	});
	expect(result.passed).toBe(false);
});

test("systemd 停止超时会阻止业务证据门禁，即使请求和成功事件齐全", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			systemdWarningCount: 1,
			eventCounts: {
				"appointment.records.requested": 1,
				"appointment.records.synced": 1,
			},
			correlation: correlationFor([
				"appointment.records.requested",
				"appointment.records.synced",
			]),
		},
		["appointmentRecords"],
	);

	expect(result.systemdWarningCount).toBe(1);
	expect(result.domains.appointmentRecords).toMatchObject({
		missing: [],
		passed: false,
	});
	expect(result.passed).toBe(false);
});

test("普通资料更新不能用资料读取事件冒充写入成功", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: {
				"user.profile.update.requested": 1,
				"user.profile.requested": 1,
				"user.profile.loaded": 1,
			},
			correlation: correlationFor([
				"user.profile.update.requested",
				"user.profile.requested",
				"user.profile.loaded",
			]),
		},
		["profileUpdate"],
	);

	expect(result.domains.profileUpdate).toMatchObject({
		requestedCount: 1,
		successCount: 0,
		missing: ["success", "same-trace-request-success", "same-trace-http-2xx"],
		passed: false,
	});
});

test("不同 trace 的请求和成功不能拼成一次业务成功", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: {
				"appointment.records.requested": 1,
				"appointment.records.synced": 1,
			},
			correlation: {
				chainCount: 2,
				recordCount: 2,
				missingCount: 0,
				truncated: false,
				chains: {
					"trace-a": {
						events: { "appointment.records.requested": 1 },
						httpCompletedStatusCounts: { 200: 1 },
					},
					"trace-b": {
						events: { "appointment.records.synced": 1 },
						httpCompletedStatusCounts: {},
					},
				},
			},
		},
		["appointmentRecords"],
	);

	expect(result.domains.appointmentRecords).toMatchObject({
		requestedCount: 1,
		successCount: 1,
		correlatedChainCount: 0,
		missing: ["same-trace-request-success", "same-trace-http-2xx"],
		passed: false,
	});
	expect(result.passed).toBe(false);
});

test("业务请求和成功同链但没有 HTTP 2xx 完成不能通过", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: {
				"appointment.records.requested": 1,
				"appointment.records.synced": 1,
				"http.request.failed": 1,
			},
			correlation: correlationFor(
				[
					"appointment.records.requested",
					"appointment.records.synced",
					"http.request.failed",
				],
				{ 500: 1 },
			),
		},
		["appointmentRecords"],
	);

	expect(result.domains.appointmentRecords).toMatchObject({
		correlatedChainCount: 1,
		httpSuccessChainCount: 0,
		missing: ["same-trace-http-2xx"],
		passed: false,
	});
	expect(result.passed).toBe(false);
});

test("跨 Windows 管道产生的摘要 BOM 不影响业务证据判断", async () => {
	const process = Bun.spawn(
		[
			"bun",
			"tools/p0-business-evidence-audit.mjs",
			"--domain",
			"appointmentRecords",
		],
		{
			stdin: new Blob([
				"\uFEFF",
				JSON.stringify({
					parseErrors: 0,
					eventCounts: {
						"appointment.records.requested": 1,
						"appointment.records.synced": 1,
					},
					correlation: correlationFor([
						"appointment.records.requested",
						"appointment.records.synced",
					]),
				}),
			]),
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const output = await new Response(process.stdout).text();
	const error = await new Response(process.stderr).text();
	const exitCode = await process.exited;

	expect(exitCode).toBe(0);
	expect(error).toBe("");
	expect(JSON.parse(output)).toMatchObject({ passed: true });
});
