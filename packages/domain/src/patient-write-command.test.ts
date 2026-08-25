import { expect, test } from "bun:test";
import {
	InvalidPatientWriteCommandTransitionError,
	PATIENT_WRITE_FEATURES,
	allowedPatientWriteCommandTransitions,
	canTransitionPatientWriteCommand,
	createPatientWriteCommand,
	isPatientWriteCommandTerminal,
	normalizePatientWriteCommand,
	PatientWriteCommandValidationError,
	transitionPatientWriteCommand,
} from "./patient-write-command";

const FIRST_TIME = new Date("2026-08-26T10:00:00.000Z");

function createCommand() {
	return createPatientWriteCommand(
		{
			commandId: "command-001",
			ownerUserId: "owner-001",
			patientId: "patient-001",
			feature: "patient-binding",
			idempotencyKey: "idem-001",
		},
		FIRST_TIME,
	);
}

test("D 批次所有入口都使用同一命令状态集合", () => {
	expect(PATIENT_WRITE_FEATURES).toHaveLength(12);
	expect(allowedPatientWriteCommandTransitions("requested")).toEqual([
		"awaiting_confirmation",
		"pending",
		"duplicate",
		"rejected",
	]);
	expect(canTransitionPatientWriteCommand("pending", "submitted")).toBe(true);
	expect(canTransitionPatientWriteCommand("submitted", "pending")).toBe(false);
});

test("命令必须先经过请求态，未知结果保持 pending", () => {
	const requested = createCommand();
	const pending = transitionPatientWriteCommand(
		requested,
		"pending",
		new Date("2026-08-26T10:00:01.000Z"),
	);

	expect(pending.state).toBe("pending");
	expect(pending.history).toHaveLength(2);
	expect(() =>
		transitionPatientWriteCommand(
			pending,
			"requested",
			new Date("2026-08-26T10:00:02.000Z"),
		),
	).toThrow(InvalidPatientWriteCommandTransitionError);
});

test("pending 只能由最终事实推进到提交、重复或权威拒绝", () => {
	const pending = transitionPatientWriteCommand(
		createCommand(),
		"pending",
		new Date("2026-08-26T10:00:01.000Z"),
	);
	const submitted = transitionPatientWriteCommand(
		pending,
		"submitted",
		new Date("2026-08-26T10:00:02.000Z"),
	);

	expect(submitted.history.at(-1)).toEqual({
		from: "pending",
		to: "submitted",
		at: "2026-08-26T10:00:02.000Z",
	});
	expect(isPatientWriteCommandTerminal(submitted.state)).toBe(true);
	expect(() =>
		transitionPatientWriteCommand(
			submitted,
			"rejected",
			new Date("2026-08-26T10:00:03.000Z"),
		),
	).toThrow(InvalidPatientWriteCommandTransitionError);
});

test("需要确认的命令不能跳过确认直接完成", () => {
	const awaiting = transitionPatientWriteCommand(
		createCommand(),
		"awaiting_confirmation",
		new Date("2026-08-26T10:00:01.000Z"),
	);

	expect(() =>
		transitionPatientWriteCommand(
			awaiting,
			"submitted",
			new Date("2026-08-26T10:00:02.000Z"),
		),
	).toThrow(InvalidPatientWriteCommandTransitionError);
	expect(
		transitionPatientWriteCommand(
			awaiting,
			"pending",
			new Date("2026-08-26T10:00:02.000Z"),
		).state,
	).toBe("pending");
});

test("归一化拒绝未知字段、错误轨迹和不带时区的时间", () => {
	const command = createCommand();
	expect(() =>
		normalizePatientWriteCommand({ ...command, payload: "must-not-enter" }),
	).toThrow(PatientWriteCommandValidationError);
	expect(() =>
		normalizePatientWriteCommand({
			...command,
			createdAt: "2026-08-26T10:00:00",
		}),
	).toThrow(PatientWriteCommandValidationError);
	expect(() =>
		normalizePatientWriteCommand({
			...command,
			history: [{ from: null, to: "submitted", at: command.createdAt }],
		}),
	).toThrow(PatientWriteCommandValidationError);
	expect(() =>
		createPatientWriteCommand(
			{
				commandId: "command-invalid-date",
				ownerUserId: "owner-001",
				feature: "patient-binding",
				idempotencyKey: "idem-invalid-date",
			},
			new Date(Number.NaN),
		),
	).toThrow(PatientWriteCommandValidationError);
});

test("患者绑定在确认前可以没有 patientId，但不允许非法标识", () => {
	const command = createPatientWriteCommand(
		{
			commandId: "command-002",
			ownerUserId: "owner-001",
			feature: "patient-binding",
			idempotencyKey: "idem-002",
		},
		FIRST_TIME,
	);
	expect(command.patientId).toBeUndefined();
	expect(() =>
		createPatientWriteCommand(
			{
				commandId: "command-003",
				ownerUserId: "owner-001",
				patientId: "bad\npatient",
				feature: "patient-binding",
				idempotencyKey: "idem-003",
			},
			FIRST_TIME,
		),
	).toThrow(PatientWriteCommandValidationError);
});
