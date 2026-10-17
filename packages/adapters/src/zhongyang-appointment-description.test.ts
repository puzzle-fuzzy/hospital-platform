import { expect, test } from "bun:test";
import { normalizeAppointmentScheduleResults } from "@hospital/domain";
import { createZhongyangAppointmentGateway } from "./zhongyang-appointments";

type Mode = "doctor" | "date";

const context = {
	traceId: "description-trace",
	idempotencyKey: "description-key",
};

function readSchedules(
	mode: Mode,
	description: Record<string, unknown>,
	schedulePatch: Record<string, unknown> = {},
) {
	const schedule = {
		hisScheduleId: "schedule-description",
		totalNum: 10,
		usableNum: 4,
		usableSourceNum: 4,
		scheduleStatus: 2,
		shiftName: "上午",
		timeGroupFlag: "1",
		...schedulePatch,
	};
	const providerItem = {
		workDate: "2026-10-16",
		deptId: "dept-description",
		deptName: "测试门诊",
		docId: "doctor-description",
		docName: "测试医生",
		...schedule,
		...description,
		...(mode === "doctor" ? { schedulingList: [schedule] } : {}),
	};
	const gateway = createZhongyangAppointmentGateway({
		baseUrl: "https://zhongyang.example.test",
		fetcher: async () =>
			new Response(JSON.stringify({ success: true, data: [providerItem] }), {
				headers: { "x-request-id": "description-provider-request" },
			}),
	});
	const query = {
		startDate: "2026-10-16",
		endDate: "2026-10-23",
		departmentId: "dept-description",
	};
	if (mode === "date") return gateway.listSchedules(query, context);
	if (!gateway.listDoctorSchedules) throw new Error("Doctor directory missing");
	return gateway.listDoctorSchedules(query, context);
}

for (const mode of ["doctor", "date"] as const) {
	test(`${mode} 排班规范化简介与擅长的 CRLF、LF、CR，保留完整号源`, async () => {
		for (const lineBreak of ["\r\n", "\n", "\r"]) {
			const { schedules } = await readSchedules(mode, {
				introduce: `  医生简介${lineBreak}第二段  `,
				specialty: `  专业方向${lineBreak}${lineBreak}其他擅长  `,
			});
			expect(schedules).toHaveLength(1);
			expect(schedules[0]).toMatchObject({
				introduction: "医生简介 第二段",
				expertise: "专业方向 其他擅长",
				providerScheduleId: "schedule-description",
				departmentId: "dept-description",
				doctorId: "doctor-description",
				availableSlots: 4,
				totalSlots: 10,
				availabilityStatus: "open",
			});
			// 下游仍使用原领域读模型约束，不放宽文本或号源校验。
			expect(normalizeAppointmentScheduleResults(schedules)).toEqual([
				...schedules,
			]);
		}
	});

	test(`${mode} 排班将未填写或仅空格与换行的可选描述省略`, async () => {
		for (const empty of [undefined, null, "", "  \r\n \n\r  "]) {
			const { schedules } = await readSchedules(mode, {
				introduce: empty,
				specialty: empty,
			});
			expect(schedules[0]).not.toHaveProperty("introduction");
			expect(schedules[0]).not.toHaveProperty("expertise");
		}
	});

	test(`${mode} 排班按规范化后文本保留简介512、擅长255的长度边界`, async () => {
		const { schedules } = await readSchedules(mode, {
			introduce: `${"介".repeat(510)}\r\n尾`,
			specialty: `${"专".repeat(253)}\r\n尾`,
		});
		expect(schedules[0]?.introduction).toHaveLength(512);
		expect(schedules[0]?.expertise).toHaveLength(255);
		for (const description of [
			{ introduce: `${"介".repeat(511)}\r\n尾` },
			{ specialty: `${"专".repeat(254)}\r\n尾` },
		]) {
			await expect(readSchedules(mode, description)).rejects.toMatchObject({
				name: "ProviderRequestError",
				responseInvalid: true,
			});
		}
	});

	test(`${mode} 描述换行兼容不放宽其他控制字符和非法类型`, async () => {
		for (const field of ["introduce", "specialty"]) {
			for (const invalid of [
				"第一段\t第二段",
				"第一段\0第二段",
				"第一段\u007f第二段",
				"\t\r\n",
				{ text: "非法对象" },
				["非法数组"],
				false,
			]) {
				await expect(
					readSchedules(mode, { [field]: invalid }),
				).rejects.toMatchObject({
					name: "ProviderRequestError",
					message: `Zhongyang appointment field ${field} is invalid`,
					responseInvalid: true,
				});
			}
		}
	});

	test(`${mode} 换行兼容仅用于描述，编号、姓名和号源仍严格校验`, async () => {
		for (const invalid of [
			{ deptId: "dept\ninvalid" },
			{ docId: "doctor\ninvalid" },
			{ docName: "医生\n姓名" },
		]) {
			await expect(
				readSchedules(mode, { introduce: "第一段\n第二段", ...invalid }),
			).rejects.toMatchObject({ name: "ProviderRequestError" });
		}
		await expect(
			readSchedules(
				mode,
				{ introduce: "第一段\n第二段" },
				{ usableNum: 11, usableSourceNum: 11 },
			),
		).rejects.toMatchObject({
			name: "ProviderRequestError",
			message: "Zhongyang appointment slot counts are inconsistent",
		});
	});
}
