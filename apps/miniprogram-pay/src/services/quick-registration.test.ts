import { describe, expect, test } from "bun:test";
import {
	type AppointmentRecord,
	findDuplicate,
	type Schedule,
	type Source,
	selectSource,
} from "./appointment";
import type { Patient } from "./patient";

const patient: Patient = {
	patId: "pat-1",
	name: "测试患者",
	cardNo: "card-1",
	idNo: "140000000000000000",
	phone: "13800000000",
	relation: "本人",
};

const schedule: Schedule = {
	hisScheduleId: "schedule-1",
	deptId: "dept-1",
	deptCode: "dept-code",
	deptName: "内科风湿",
	docId: "doc-1",
	docCode: "doc-code",
	docName: "测试医生",
	workDate: "2026-09-04",
	shiftName: "上午",
	registrationFee: 5,
	registerClassName: "普通号",
	roomAddr: "门诊二楼",
	hospitalId: "10389001",
};

const source = (sourceId: string, serialNumber: string): Source => ({
	sourceId,
	hisScheduleId: schedule.hisScheduleId,
	workDate: schedule.workDate,
	workTime: "08:30",
	serialNumber,
	groupStart: "08:30",
	groupEnd: "08:40",
	appendFlag: "0",
});

describe("miniprogram-pay duplicate guard", () => {
	test("first available source is selected when no override is configured", () => {
		const sources = [source("source-first", "1"), source("source-target", "2")];
		expect(selectSource(sources).sourceId).toBe("source-first");
	});

	test("same patient, date and clinic is a duplicate", () => {
		const records: AppointmentRecord[] = [
			{
				appointmentInfoId: "appointment-1",
				patId: patient.patId,
				patName: patient.name,
				deptName: "内科风湿",
				workDate: schedule.workDate,
				status: 0,
				statusName: "已预约",
				registerId: "register-1",
				hisRegisterId: "his-register-1",
				isPay: "0",
			},
		];
		expect(findDuplicate(records, patient, schedule)?.appointmentInfoId).toBe(
			"appointment-1",
		);
	});

	test("cancelled records do not block a new registration", () => {
		const records: AppointmentRecord[] = [
			{
				appointmentInfoId: "appointment-1",
				patId: patient.patId,
				patName: patient.name,
				deptName: "内科风湿",
				workDate: schedule.workDate,
				status: 1,
				statusName: "已取消",
				registerId: "register-1",
				hisRegisterId: "his-register-1",
				isPay: "0",
			},
		];
		expect(findDuplicate(records, patient, schedule)).toBeUndefined();
	});
});
