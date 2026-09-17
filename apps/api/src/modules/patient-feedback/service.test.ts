import { expect, test } from "bun:test";
import type {
	AppointmentRegistration,
	PatientRecord,
	PatientRepository,
} from "@hospital/domain";
import { createInMemoryPatientFeedbackRepository } from "@hospital/persistence";
import {
	PatientFeedbackAppointmentNotFoundError,
	PatientFeedbackService,
} from "./service";

const patient: PatientRecord = {
	id: "patient-001",
	ownerUserId: "user-001",
	displayName: "张三",
	relationship: "self",
	cardNumberMasked: "****1234",
	source: "hospital-his",
	clinicalAccess: "ready",
};

const appointment: AppointmentRegistration = {
	appointmentId: "appointment-001",
	ownerUserId: "user-001",
	patientId: "patient-001",
	holdId: "hold-001",
	idempotencyKey: "appointment-key",
	providerAppointmentId: "provider-appointment-001",
	providerPatientId: "provider-patient-001",
	departmentName: "心内科",
	doctorName: "李医生",
	workDate: "2026-09-16",
	shiftName: "上午",
	sourceSerialNumber: "001",
	totalFen: 100,
	status: "booked",
	createdAt: "2026-09-15T00:00:00.000Z",
	updatedAt: "2026-09-15T00:00:00.000Z",
};

function service() {
	const patients: PatientRepository = {
		listByOwner: async () => [patient],
		upsertFromDirectory: async () => patient,
		resolveProviderReference: async () => undefined,
	};
	return new PatientFeedbackService({
		repository: createInMemoryPatientFeedbackRepository(),
		patients,
		appointments: {
			findRegistration: async () => appointment,
		} as never,
		createId: () => "feedback-001",
		now: () => new Date("2026-09-16T08:00:00.000Z"),
	});
}

const context = { traceId: "trace-001", idempotencyKey: "feedback-key-001" };

test("电子锦旗/表扬信提交使用当前预约快照并进入待审核", async () => {
	const target = service();
	const result = await target.create(
		"user-001",
		{
			patientId: "patient-001",
			appointmentId: "appointment-001",
			kind: "gift-banner",
			content: "仁心仁术",
			displayPublic: true,
			donateDate: "2026-09-16",
		},
		context,
	);

	expect(result).toMatchObject({
		feedbackId: "feedback-001",
		status: "pending_review",
		departmentName: "心内科",
		doctorName: "李医生",
		displayPublic: true,
	});
	const records = await target.list(
		"user-001",
		"patient-001",
		"gift-banner",
		undefined,
		undefined,
		undefined,
		undefined,
		context,
	);
	expect(records.items).toHaveLength(1);
	expect(records.items[0]?.status).toBe("pending_review");
	const monthRecords = await target.list(
		"user-001",
		"patient-001",
		"gift-banner",
		"2026-09",
		undefined,
		undefined,
		undefined,
		context,
	);
	expect(monthRecords.total).toBe(1);
	const otherMonthRecords = await target.list(
		"user-001",
		"patient-001",
		"gift-banner",
		"2026-08",
		undefined,
		undefined,
		undefined,
		context,
	);
	expect(otherMonthRecords.total).toBe(0);
	const privateRecords = await target.list(
		"user-001",
		"patient-001",
		"gift-banner",
		undefined,
		false,
		undefined,
		undefined,
		context,
	);
	expect(privateRecords.total).toBe(0);
	const firstPage = await target.list(
		"user-001",
		"patient-001",
		"gift-banner",
		undefined,
		undefined,
		1,
		1,
		context,
	);
	expect(firstPage.pageSize).toBe(1);
	expect(firstPage.hasMore).toBe(false);
});

test("电子锦旗/表扬信不能关联其他患者或已取消预约", async () => {
	const target = service();
	const patients: PatientRepository = {
		listByOwner: async () => [patient],
		upsertFromDirectory: async () => patient,
		resolveProviderReference: async () => undefined,
	};
	const isolated = new PatientFeedbackService({
		repository: createInMemoryPatientFeedbackRepository(),
		patients,
		appointments: {
			findRegistration: async () => ({
				...appointment,
				patientId: "patient-002",
			}),
		} as never,
	});
	await expect(
		isolated.create(
			"user-001",
			{
				patientId: "patient-001",
				appointmentId: "appointment-001",
				kind: "health-praise",
				content: "感谢",
				displayPublic: false,
				donateDate: "2026-09-16",
			},
			{ traceId: "trace-002", idempotencyKey: "feedback-key-002" },
		),
	).rejects.toBeInstanceOf(PatientFeedbackAppointmentNotFoundError);
	void target;
});

test("相同幂等键重放返回同一条新服务记录", async () => {
	const target = service();
	const input = {
		patientId: "patient-001",
		appointmentId: "appointment-001",
		kind: "health-praise" as const,
		content: "感谢李医生",
		displayPublic: false,
		donateDate: "2026-09-16",
	};
	const first = await target.create("user-001", input, context);
	const replay = await target.create("user-001", input, context);
	expect(replay.feedbackId).toBe(first.feedbackId);
});
