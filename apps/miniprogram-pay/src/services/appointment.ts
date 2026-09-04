import { PAY_CONFIG } from "../config";
import type { Patient } from "./patient";
import { asList, asRecord, newIdempotencyKey, request } from "./request";

export type Schedule = {
	scheduleId: string;
	departmentId: string;
	departmentName: string;
	doctorId: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	totalSlots: number;
	availableSlots: number;
	timeGroup: "point" | "range" | "unknown";
	startTime?: string;
	endTime?: string;
	totalFen?: number;
};

export type Source = {
	serialNumber: string;
	timeLabel: string;
	timeGroup: "point" | "range";
};

export type AppointmentRecord = {
	appointmentId: string;
	departmentName?: string;
	workDate: string;
	status: string;
};

function record(value: unknown): Record<string, unknown> {
	return asRecord(value);
}

function text(value: unknown, key: string): string {
	return String(record(value)[key] ?? "").trim();
}

function list<T>(value: unknown): T[] {
	return asList<T>(value);
}

function isTargetDepartment(value: unknown): boolean {
	const displayName = text(value, "displayName");
	const targetNames = new Set<string>([
		PAY_CONFIG.departmentName,
		...PAY_CONFIG.departmentProviderNames,
	]);
	return targetNames.has(displayName);
}

function localDateText(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/** 业务日期使用设备本地自然日；候选只允许后天及之后的明确偏移。 */
export function appointmentCandidateDates(now = new Date()): string[] {
	return PAY_CONFIG.targetDateOffsets.map((offset) => {
		const date = new Date(now.getTime());
		date.setHours(12, 0, 0, 0);
		date.setDate(date.getDate() + offset);
		return localDateText(date);
	});
}

/** 从新版科室目录中确定固定门诊，再用 opaque departmentId 查询排班。 */
export async function loadTargetSchedule(): Promise<Schedule> {
	const departments = list<Record<string, unknown>>(
		await request<unknown>({ path: "/appointments/departments" }),
	);
	// 页面使用业务别名“内科风湿”，Provider 的公开目录使用正式名称
	// “风湿免疫科门诊”；两者都只映射到同一个服务端返回的 opaque ID，
	// 不把名称或 Provider ID 写死到预约/医保写入请求中。
	const department = departments.find(isTargetDepartment);
	if (!department)
		throw new Error(`未找到指定门诊：${PAY_CONFIG.departmentName}`);
	const departmentId = text(department, "departmentId");
	const candidateDates = appointmentCandidateDates();
	for (const targetDate of candidateDates) {
		const schedules = list<Schedule>(
			await request<unknown>({
				path: "/appointments/schedules",
				query: {
					startDate: targetDate,
					endDate: targetDate,
					departmentId,
				},
			}),
		).filter(
			(item) =>
				item.workDate === targetDate &&
				item.shiftName === PAY_CONFIG.shiftName &&
				item.availableSlots > 0,
		);
		const schedule = schedules[0];
		if (schedule) return schedule;
	}
	throw new Error(`${candidateDates.join("、")} 暂无上午可约排班`);
}

export async function loadSources(schedule: Schedule): Promise<Source[]> {
	const data = await request<{ schedule: Schedule; items: unknown[] }>({
		path: `/appointments/schedules/${encodeURIComponent(schedule.scheduleId)}/sources`,
	});
	return list<Source>(data.items).filter((item) =>
		Boolean(item.serialNumber && item.timeLabel),
	);
}

export function selectSource(sources: Source[]): Source {
	const source = PAY_CONFIG.targetSerialNumber
		? sources.find(
				(item) => item.serialNumber === PAY_CONFIG.targetSerialNumber,
			)
		: sources[0];
	if (!source) throw new Error("指定排班没有可用分时段");
	return source;
}

export type AppointmentHold = {
	holdId: string;
	status: "held";
	totalFen: number;
	expiresAt: string;
};

export type CreatedAppointment = {
	appointmentId: string;
	status: "booked" | "duplicate";
	patientId: string;
	departmentName: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	sourceSerialNumber: string;
	totalFen: number;
};

/** 独立预约占位命令；服务端会重新校验排班、号源、患者和挂号费。 */
export async function holdAppointment(
	patient: Patient,
	schedule: Schedule,
	source: Source,
): Promise<AppointmentHold> {
	return request<AppointmentHold>({
		path: "/appointments/holds",
		method: "POST",
		idempotencyKey: newIdempotencyKey("appointment-hold"),
		data: {
			patientId: patient.id,
			scheduleId: schedule.scheduleId,
			sourceSerialNumber: source.serialNumber,
		},
	});
}

/** 独立预约写入命令；不把任何医院预约号返回给小程序。 */
export async function createAppointment(
	patient: Patient,
	hold: AppointmentHold,
): Promise<CreatedAppointment> {
	return request<CreatedAppointment>({
		path: "/appointments/registrations",
		method: "POST",
		idempotencyKey: newIdempotencyKey("appointment-register"),
		data: { patientId: patient.id, holdId: hold.holdId },
	});
}

export async function cancelAppointment(appointmentId: string): Promise<void> {
	await request({
		path: `/appointments/registrations/${encodeURIComponent(appointmentId)}/cancel`,
		method: "POST",
		idempotencyKey: newIdempotencyKey("appointment-cancel"),
	});
}

export function withFee(schedule: Schedule, totalFen: number): Schedule {
	return { ...schedule, totalFen };
}
