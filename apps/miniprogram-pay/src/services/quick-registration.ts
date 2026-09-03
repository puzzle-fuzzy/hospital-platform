import {
	type AppointmentRecord,
	type CreatedAppointment,
	cancelAppointment,
	createAppointment,
	findDuplicate,
	listActiveAppointments,
	loadSources,
	loadTargetSchedule,
	type Schedule,
	type Source,
	selectSource,
} from "./appointment";
import {
	assertMedicalConfig,
	type PaymentProgress,
	startMedicalPayment,
} from "./medical-insurance";
import type { Patient } from "./patient";

export type QuickProgress =
	| PaymentProgress
	| "checking"
	| "reading-source"
	| "registering";
export type QuickResult =
	| {
			kind: "duplicate";
			record: AppointmentRecord;
			schedule: Schedule;
			source: Source | null;
	  }
	| {
			kind: "success";
			appointment: CreatedAppointment;
			schedule: Schedule;
			source: Source;
	  };

export type QuickFlowProgress = (stage: QuickProgress, message: string) => void;

function assertPatientReady(patient: Patient): void {
	if (!patient.patId || !patient.name || !patient.cardNo)
		throw new Error("就诊人资料不完整，无法预约");
	if (!patient.idNo) throw new Error("就诊人缺少身份证号，无法医保支付");
	if (!patient.phone) throw new Error("就诊人缺少手机号，无法预约");
}

/**
 * 唯一的快速挂号入口：先查重，再创建预约，再进入医保支付。
 * 查重命中时只返回 duplicate，绝不自动取消旧预约，避免误操作。
 */
export async function runQuickRegistration(
	patient: Patient,
	onProgress: QuickFlowProgress,
): Promise<QuickResult> {
	assertMedicalConfig();
	assertPatientReady(patient);
	onProgress("checking", "正在检查当天是否已有预约");
	const schedule = await loadTargetSchedule();
	const duplicate = findDuplicate(
		await listActiveAppointments(patient),
		patient,
		schedule,
	);
	if (duplicate) {
		const sources = await loadSources(schedule).catch(() => []);
		return {
			kind: "duplicate",
			record: duplicate,
			schedule,
			source: sources.length > 0 ? selectSource(sources) : null,
		};
	}
	onProgress("reading-source", "正在读取指定排班的号源");
	const sources = await loadSources(schedule);
	const source = selectSource(sources);

	onProgress("registering", "正在预约指定号源");
	const appointment = await createAppointment(patient, schedule, source);
	await startMedicalPayment(appointment, patient, schedule, onProgress);
	return { kind: "success", appointment, schedule, source };
}

export async function cancelAndRetry(
	patient: Patient,
	record: AppointmentRecord,
	onProgress: QuickFlowProgress,
): Promise<QuickResult> {
	assertMedicalConfig();
	assertPatientReady(patient);
	onProgress("checking", "正在取消原有预约");
	await cancelAppointment(record, patient);
	return runQuickRegistration(patient, onProgress);
}
