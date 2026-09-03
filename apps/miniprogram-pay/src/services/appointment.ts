import { PAY_CONFIG } from "../config";
import type { Patient } from "./patient";
import { asList, asRecord, providerRequest } from "./request";

export type Schedule = {
	hisScheduleId: string;
	deptId: string;
	deptCode: string;
	deptName: string;
	docId: string;
	docCode: string;
	docName: string;
	workDate: string;
	shiftName: string;
	registrationFee: number;
	registerClassName: string;
	roomAddr: string;
	hospitalId: string;
};

export type Source = {
	sourceId: string;
	hisScheduleId: string;
	workDate: string;
	workTime: string;
	serialNumber: string;
	groupStart: string;
	groupEnd: string;
	appendFlag: string;
};

export type AppointmentRecord = {
	appointmentInfoId: string;
	patId: string;
	patName: string;
	deptName: string;
	workDate: string;
	status: number;
	statusName: string;
	registerId: string;
	hisRegisterId: string;
	isPay: string;
};

function text(record: Record<string, any>, keys: string[]): string {
	for (const key of keys) {
		const value = String(record[key] ?? "").trim();
		if (value) return value;
	}
	return "";
}

function number(record: Record<string, any>, keys: string[]): number {
	for (const key of keys) {
		const value = Number(record[key]);
		if (Number.isFinite(value)) return value;
	}
	return 0;
}

function mapSchedule(value: Record<string, any>): Schedule {
	return {
		hisScheduleId: text(value, ["hisScheduleId", "scheduleId"]),
		deptId: text(value, ["deptId"]),
		deptCode: text(value, ["deptCode"]),
		deptName: text(value, ["deptName"]),
		docId: text(value, ["docId"]),
		docCode: text(value, ["docCode", "docId"]),
		docName: text(value, ["docName"]),
		workDate: text(value, ["workDate"]),
		shiftName: text(value, ["shiftName"]),
		registrationFee: number(value, ["registrationFee", "registFree"]),
		registerClassName: text(value, ["registerClassName"]),
		roomAddr: text(value, ["roomAddr", "deptAddr"]),
		hospitalId: text(value, ["hospitalId"]) || PAY_CONFIG.hospitalId,
	};
}

export async function loadTargetSchedule(): Promise<Schedule> {
	const departmentResponse = await providerRequest<unknown>({
		path: "/msun-middle-business-amc-server/v1/schedulings/scheduling-depts",
		query: {
			requestChannel: PAY_CONFIG.requestChannel,
			startDate: PAY_CONFIG.targetDate,
			endDate: PAY_CONFIG.targetDate,
			searchCondition: PAY_CONFIG.departmentName,
		},
	});
	const departments = asList<Record<string, any>>(departmentResponse);
	const department =
		departments.find(
			(item) => text(item, ["deptName"]) === PAY_CONFIG.departmentName,
		) ||
		departments.find((item) =>
			text(item, ["deptName"]).includes(PAY_CONFIG.departmentName),
		);
	if (!department)
		throw new Error(`未找到指定门诊：${PAY_CONFIG.departmentName}`);

	const schedulesResponse = await providerRequest<unknown>({
		path: "/msun-middle-business-amc-server/v1/schedulings",
		query: {
			requestChannel: PAY_CONFIG.requestChannel,
			startDate: PAY_CONFIG.targetDate,
			endDate: PAY_CONFIG.targetDate,
			scheduleType: 1,
			deptId: text(department, ["deptId"]),
			stopFlag: "0",
		},
	});
	const schedules = asList<Record<string, any>>(schedulesResponse)
		.map(mapSchedule)
		.filter(
			(item) =>
				item.workDate === PAY_CONFIG.targetDate &&
				item.shiftName === PAY_CONFIG.shiftName &&
				item.deptName.includes(PAY_CONFIG.departmentName),
		);
	const schedule = schedules.find((item) => item.registrationFee >= 0);
	if (!schedule)
		throw new Error(
			`${PAY_CONFIG.targetDate} 暂无${PAY_CONFIG.shiftName}可约排班`,
		);
	return schedule;
}

export async function loadSources(schedule: Schedule): Promise<Source[]> {
	const response = await providerRequest<unknown>({
		path: `/msun-middle-business-amc-server/v1/sources/${encodeURIComponent(schedule.hisScheduleId)}`,
		query: { requestChannel: PAY_CONFIG.requestChannel },
	});
	return asList<Record<string, any>>(response)
		.map((item) => ({
			sourceId: text(item, ["sourceId", "id"]),
			hisScheduleId: text(item, ["hisScheduleId"]) || schedule.hisScheduleId,
			workDate: text(item, ["workDate"]) || schedule.workDate,
			workTime: text(item, ["workTime"]),
			serialNumber: text(item, ["serialNumber"]),
			groupStart: text(item, ["groupStart"]),
			groupEnd: text(item, ["groupEnd"]),
			appendFlag: text(item, ["appendFlag"]),
		}))
		.filter((item) => item.sourceId);
}

export function selectSource(sources: Source[]): Source {
	const exact = PAY_CONFIG.targetSourceId
		? sources.find((item) => item.sourceId === PAY_CONFIG.targetSourceId)
		: undefined;
	const bySerial = PAY_CONFIG.targetSerialNumber
		? sources.find(
				(item) => item.serialNumber === PAY_CONFIG.targetSerialNumber,
			)
		: undefined;
	const source = exact || bySerial || sources[0];
	if (!source) throw new Error("指定排班没有可用号源");
	return source;
}

export async function listActiveAppointments(
	patient: Patient,
): Promise<AppointmentRecord[]> {
	const response = await providerRequest<unknown>({
		path: `/msun-middle-business-appointment-server/v1/appointment-infos/${encodeURIComponent(patient.patId)}`,
		query: {
			requestChannel: PAY_CONFIG.requestChannel,
			startDate: PAY_CONFIG.targetDate,
			endDate: PAY_CONFIG.targetDate,
			isMzFlag: "1",
			dateFlag: "1",
		},
	});
	return asList<Record<string, any>>(response)
		.map((item) => ({
			appointmentInfoId: text(item, ["appointmentInfoId"]),
			patId: text(item, ["patId"]),
			patName: text(item, ["patName"]),
			deptName: text(item, ["deptName"]),
			workDate: text(item, ["workDate"]),
			status: number(item, ["status"]),
			statusName: text(item, ["statusName"]),
			registerId: text(item, ["registerId"]),
			hisRegisterId: text(item, ["hisRegisterId"]),
			isPay: text(item, ["isPay"]),
		}))
		.filter((item) => item.appointmentInfoId && item.status !== 1);
}

export function findDuplicate(
	records: AppointmentRecord[],
	patient: Patient,
	schedule: Schedule,
): AppointmentRecord | undefined {
	return records.find(
		(item) =>
			item.status !== 1 &&
			item.patId === patient.patId &&
			item.workDate === schedule.workDate &&
			item.deptName.includes(PAY_CONFIG.departmentName),
	);
}

export async function cancelAppointment(
	record: AppointmentRecord,
	patient: Patient,
): Promise<void> {
	await providerRequest<unknown>({
		path: "/msun-middle-business-appointment-server/v1/appointment-infos/d",
		method: "POST",
		contentType: "application/json",
		data: {
			requestChannel: "3",
			appointmentInfoId: record.appointmentInfoId,
			patId: patient.patId,
		},
	});
}

export type CreatedAppointment = {
	appointmentInfoId: string;
	patId: string;
	registerId: string;
	hisRegisterId: string;
	workDate: string;
	serialNumber: string;
	registrationFee: number;
	[key: string]: any;
};

export async function createAppointment(
	patient: Patient,
	schedule: Schedule,
	source: Source,
): Promise<CreatedAppointment> {
	const response = asRecord(
		await providerRequest<unknown>({
			path: "/msun-middle-business-appointment-server/v1/appointment-infos",
			method: "POST",
			contentType: "application/json",
			data: {
				patId: patient.patId,
				patName: patient.name,
				patCardNo: patient.cardNo,
				idcardNo: patient.idNo,
				registrationFee: schedule.registrationFee,
				workDate: schedule.workDate,
				telephone: patient.phone,
				hisScheduleId: schedule.hisScheduleId,
				sourceId: source.sourceId,
				registerSource: PAY_CONFIG.registrationSource,
				settleWay: PAY_CONFIG.settleWay,
				isPay: 0,
				requestChannel: PAY_CONFIG.appointmentRequestChannel,
				recordId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
			},
		}),
	);
	const value = asRecord(response.data || response);
	if (!text(value, ["appointmentInfoId"]))
		throw new Error("预约接口未返回 appointmentInfoId");
	return {
		...value,
		appointmentInfoId: text(value, ["appointmentInfoId"]),
		patId: text(value, ["patId"]) || patient.patId,
		registerId: text(value, ["registerId"]),
		hisRegisterId: text(value, ["hisRegisterId", "registerId"]),
		workDate: text(value, ["workDate"]) || schedule.workDate,
		serialNumber: text(value, ["serialNumber"]) || source.serialNumber,
		registrationFee:
			number(value, ["registrationFee", "registFree"]) ||
			schedule.registrationFee,
	};
}
