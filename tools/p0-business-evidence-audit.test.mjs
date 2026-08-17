import { expect, test } from "bun:test";
import { auditBusinessEvidence } from "./p0-business-evidence-audit.mjs";

test("P0 业务证据门禁要求请求和明确成功事件同时存在", () => {
	const result = auditBusinessEvidence(
		{
			parseErrors: 0,
			eventCounts: {
				"appointment.records.requested": 2,
				"appointment.records.synced": 1,
				"appointment.records.failed": 1,
			},
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
		},
		["outpatientPaymentRecords"],
	);

	expect(result.passed).toBe(false);
	expect(result.domains.outpatientPaymentRecords).toMatchObject({
		requestedCount: 1,
		successCount: 0,
		missing: ["success"],
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
				"user.profile.requested": 1,
				"user.profile.loaded": 1,
			},
		},
		["profileUpdate"],
	);

	expect(result.domains.profileUpdate).toMatchObject({
		requestedCount: 0,
		successCount: 0,
		missing: ["requested", "success"],
		passed: false,
	});
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
