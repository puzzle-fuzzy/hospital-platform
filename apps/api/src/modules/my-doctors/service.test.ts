import { describe, expect, test } from "bun:test";
import {
	MyDoctorInputError,
	MyDoctorNotFoundError,
} from "@hospital/domain";
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

	test("uses the Shanghai seven-day window and refuses a doctor absent from the directory", async () => {
		const repository = createInMemoryMyDoctorRepository();
		let receivedQuery: unknown;
		const appointments = {
			listSchedules: async (query: unknown) => {
				receivedQuery = query;
				return { items: [], total: 0 };
			},
		} as unknown as AppointmentService;
		const service = new MyDoctorService({
			repository,
			appointments,
			// 2026-09-03T16:30Z is 2026-09-04 in Asia/Shanghai.
			now: () => new Date("2026-09-03T16:30:00.000Z"),
		});

		await expect(
			service.follow("user-001", { doctorId: "doctor-001" }, context),
		).rejects.toBeInstanceOf(MyDoctorNotFoundError);
		expect(receivedQuery).toEqual({
			startDate: "2026-09-04",
			endDate: "2026-09-10",
			doctorId: "doctor-001",
		});
		expect((await service.list("user-001", context)).total).toBe(0);
	});

	test("does not accept old client snapshot fields in the follow command", async () => {
		let scheduleCalls = 0;
		const appointments = {
			listSchedules: async () => {
				scheduleCalls += 1;
				return { items: [], total: 0 };
			},
		} as unknown as AppointmentService;
		const service = new MyDoctorService({
			repository: createInMemoryMyDoctorRepository(),
			appointments,
		});

		await expect(
			service.follow(
				"user-001",
				{
					doctorId: "doctor-001",
					doctorName: "伪造医生",
				},
				context,
			),
		).rejects.toBeInstanceOf(MyDoctorInputError);
		expect(scheduleCalls).toBe(0);
	});

	test("does not expose another owner's relation in the list", async () => {
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

		expect((await service.list("user-002", context)).total).toBe(0);
		expect((await service.list("user-001", context)).total).toBe(1);
	});
});
