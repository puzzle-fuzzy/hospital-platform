import type { AppointmentSchedule, AppointmentScheduleSource } from "../types";

export type RebookingScheduleContext = Pick<
	AppointmentSchedule,
	| "departmentId"
	| "doctorId"
	| "workDate"
	| "shiftName"
	| "registrationClassName"
	| "hospitalAreaName"
> &
	Partial<Pick<AppointmentSchedule, "startTime" | "endTime">>;

/** 只恢复原医生、科室、日期、班次、院区和号别；多条同名排班也不能猜选。 */
export function sameRebookingSchedule(
	schedule: AppointmentSchedule,
	context: RebookingScheduleContext,
): boolean {
	return (
		Boolean(context.departmentId && context.doctorId) &&
		schedule.departmentId === context.departmentId &&
		schedule.doctorId === context.doctorId &&
		schedule.workDate === context.workDate &&
		schedule.shiftName === context.shiftName &&
		(!context.startTime || schedule.startTime === context.startTime) &&
		(!context.endTime || schedule.endTime === context.endTime) &&
		(schedule.registrationClassName ?? "") ===
			(context.registrationClassName ?? "") &&
		(schedule.hospitalAreaName ?? "") === (context.hospitalAreaName ?? "")
	);
}

export function selectRebookingSchedule(
	schedules: readonly AppointmentSchedule[],
	context: RebookingScheduleContext,
): AppointmentSchedule | undefined {
	const matching = schedules.filter((schedule) =>
		sameRebookingSchedule(schedule, context),
	);
	if (matching.length !== 1) return undefined;
	const schedule = matching[0];
	return schedule?.availabilityStatus === "open" && schedule.availableSlots > 0
		? schedule
		: undefined;
}

/** 序号可被医院复用，必须连同时间和时间类型一起核对，才可自动继续。 */
export function unchangedRebookingSource(
	sources: readonly AppointmentScheduleSource[],
	original: { serialNumber: string; timeLabel: string; timeGroup: string },
): AppointmentScheduleSource | undefined {
	return sources.find(
		(source) =>
			source.serialNumber === original.serialNumber &&
			source.timeLabel === original.timeLabel &&
			source.timeGroup === original.timeGroup,
	);
}
