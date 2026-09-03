import { describe, expect, test } from "bun:test";
import type { AppointmentService } from "../appointments/service";
import { createInMemoryMyDoctorRepository } from "@hospital/persistence";
import { MyDoctorService } from "./service";

const context = {
	traceId: "trace-my-doctor",
	idempotencyKey: "follow-my-doctor",
} as const;

describe("MyDoctorService", () => {
	test("follows from a verified appointment schedule and is idempotent", async () => {
		const repository = createInMemoryMyDoctorRepository();
		let scheduleCalls = 0;
		const appointments = {
			listSchedules: async () => {
				scheduleCalls += 1;
				return {
					items: [
						{
							scheduleId: "schedule-001",
							departmentId: "dept-001",
							departmentName: "心内科",
							doctorId: "doctor-001",
							doctorName: "李医生",
							doctorPhotoUrl: "https://example.test/doctor.jpg",
							workDate: "2026-09-03",
							shiftName: "上午",
							totalSlots: 10,
							availableSlots: 3,
							timeGroup: "unknown",
						},
					],
					total: 1,
				};
			},
		} as unknown as AppointmentService;
		const service = new MyDoctorService({
			repository,
			appointments,
			now: () => new Date("2026-09-03T02:00:00.000Z"),
		});

		const first = await service.follow(
			"user-001",
			{ doctorId: "doctor-001" },
			context,
		);
		const second = await service.follow(
			"user-001",
			{ doctorId: "doctor-001" },
			context,
		);

		expect(first).toMatchObject({
			doctorId: "doctor-001",
			doctorName: "李医生",
			departmentName: "心内科",
			doctorAvatarUrl: "https://example.test/doctor.jpg",
		});
		expect(second).toEqual(first);
		expect(scheduleCalls).toBe(1);
		expect((await service.list("user-001", context)).total).toBe(1);
	});

	test("unfollow is owner-scoped and idempotent", async () => {
		const repository = createInMemoryMyDoctorRepository([
			{
				ownerUserId: "user-001",
				doctorId: "doctor-001",
				doctorName: "李医生",
				departmentName: "心内科",
				createdAt: "2026-09-03T00:00:00.000Z",
			},
		]);
		const service = new MyDoctorService({
			repository,
			appointments: {} as AppointmentService,
		});

		expect(await service.unfollow("user-002", "doctor-001", context)).toEqual({
			doctorId: "doctor-001",
			followed: false,
		});
		expect((await service.list("user-001", context)).total).toBe(1);
		expect(await service.unfollow("user-001", "doctor-001", context)).toEqual({
			doctorId: "doctor-001",
			followed: false,
		});
		expect(await service.unfollow("user-001", "doctor-001", context)).toEqual({
			doctorId: "doctor-001",
			followed: false,
		});
	});
});
