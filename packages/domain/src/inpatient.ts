import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 旧住院接口明确给出的三种住院状态；未知数字不能被页面猜成在院。 */
export type InpatientEpisodeStatus = "inpatient" | "discharged" | "cancelled";

/** 旧页面只展示这三种已声明的在床状态。 */
export type InpatientBedStatus = "in_bed" | "shared_bed" | "out_of_bed";

/** 住院页面的诊断展示项；Provider 字典 ID 不进入公共模型。 */
export type InpatientDiagnosis = {
	name: string;
	isPrimary?: boolean;
};

/** 住院页面的婴儿展示项；Provider 主键不进入公共模型。 */
export type InpatientBaby = {
	name: string;
	inpatientNumber?: string;
	sex?: string;
	birthDate?: string;
	heightCm?: number;
	weightKg?: number;
};

/**
 * 旧 `inpatient_center.vue` 实际展示的住院摘要。
 *
 * `patId`、`patInHosId`、诊断字典 ID、医护 ID 和 Provider 原始卡号不进入
 * 该模型；服务端只通过 owner-scoped `his-patient` 引用取得上游患者号。
 */
export type InpatientEpisode = {
	patientName: string;
	inpatientNumber?: string;
	cardNumberMasked?: string;
	sex?: string;
	age?: string;
	admittedAt: string;
	dischargedAt?: string;
	admissionType?: string;
	status: InpatientEpisodeStatus;
	bedStatus?: InpatientBedStatus;
	wardName?: string;
	admissionWardName?: string;
	departmentName?: string;
	bedNumber?: string;
	roomNumber?: string;
	primaryDoctorName?: string;
	attendingDoctorName?: string;
	responsibleNurseName?: string;
	outpatientDoctorName?: string;
	admissionDiagnosis?: string;
	dischargeDiagnosis?: string;
	diagnoses?: InpatientDiagnosis[];
	nursingLevel?: string;
	condition?: string;
	babies?: InpatientBaby[];
};

export type InpatientEpisodeResultViolation =
	| "episodes-not-array"
	| "episodes-too-many"
	| "episode-not-object"
	| "episode-identity-invalid"
	| "episode-duplicate"
	| "patient-name-invalid"
	| "display-field-invalid"
	| "status-invalid"
	| "bed-status-invalid"
	| "card-number-invalid"
	| "diagnoses-invalid"
	| "diagnosis-field-invalid"
	| "babies-invalid"
	| "baby-field-invalid"
	| "measurement-invalid";

export class InpatientEpisodeResultValidationError extends Error {
	readonly violation: InpatientEpisodeResultViolation;

	constructor(violation: InpatientEpisodeResultViolation) {
		super("Inpatient episode provider result is invalid");
		this.name = "InpatientEpisodeResultValidationError";
		this.violation = violation;
	}
}

function invalid(violation: InpatientEpisodeResultViolation): never {
	throw new InpatientEpisodeResultValidationError(violation);
}

const INPATIENT_EPISODE_STATUSES: readonly InpatientEpisodeStatus[] = [
	"inpatient",
	"discharged",
	"cancelled",
];
const INPATIENT_BED_STATUSES: readonly InpatientBedStatus[] = [
	"in_bed",
	"shared_bed",
	"out_of_bed",
];

export const MAX_INPATIENT_EPISODES = 128;
const MAX_INPATIENT_DIAGNOSES = 32;
const MAX_INPATIENT_BABIES = 16;

function isSafeText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function optionalText(value: unknown, maxLength: number): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (!isSafeText(value, maxLength)) invalid("display-field-invalid");
	return value;
}

function isMaskedCardNumber(value: string): boolean {
	return /^[A-Za-z0-9]{0,5}\*+[A-Za-z0-9]{0,4}$/u.test(value);
}

function normalizeMeasurement(
	value: unknown,
	maximum: number,
): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > maximum
	) {
		invalid("measurement-invalid");
	}
	return value;
}

function normalizeBaby(value: unknown): InpatientBaby {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalid("babies-invalid");
	}
	const record = value as Record<string, unknown>;
	const name = record.name;
	if (!isSafeText(name, 128)) invalid("baby-field-invalid");
	const inpatientNumber = optionalText(record.inpatientNumber, 64);
	const sex = optionalText(record.sex, 64);
	const birthDate = optionalText(record.birthDate, 64);
	const heightCm = normalizeMeasurement(record.heightCm, 300);
	const weightKg = normalizeMeasurement(record.weightKg, 500);
	return {
		name,
		...(inpatientNumber ? { inpatientNumber } : {}),
		...(sex ? { sex } : {}),
		...(birthDate ? { birthDate } : {}),
		...(heightCm === undefined ? {} : { heightCm }),
		...(weightKg === undefined ? {} : { weightKg }),
	};
}

function normalizeDiagnosis(value: unknown): InpatientDiagnosis {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalid("diagnoses-invalid");
	}
	const record = value as Record<string, unknown>;
	const name = record.name;
	if (!isSafeText(name, 4096)) invalid("diagnosis-field-invalid");
	const isPrimary = record.isPrimary;
	if (isPrimary !== undefined && typeof isPrimary !== "boolean") {
		invalid("diagnosis-field-invalid");
	}
	return {
		name,
		...(isPrimary === undefined ? {} : { isPrimary }),
	};
}

function normalizeEpisode(value: unknown): InpatientEpisode {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		invalid("episode-not-object");
	}
	const record = value as Record<string, unknown>;
	const patientName = record.patientName;
	const admittedAt = record.admittedAt;
	const status = record.status;
	if (!isSafeText(patientName, 128) || !isSafeText(admittedAt, 64)) {
		invalid("episode-identity-invalid");
	}
	if (
		typeof status !== "string" ||
		!(INPATIENT_EPISODE_STATUSES as readonly string[]).includes(status)
	) {
		invalid("status-invalid");
	}
	const bedStatus = record.bedStatus;
	if (
		bedStatus !== undefined &&
		(typeof bedStatus !== "string" ||
			!(INPATIENT_BED_STATUSES as readonly string[]).includes(bedStatus))
	) {
		invalid("bed-status-invalid");
	}
	const cardNumberMasked = optionalText(record.cardNumberMasked, 128);
	if (cardNumberMasked && !isMaskedCardNumber(cardNumberMasked)) {
		invalid("card-number-invalid");
	}
	const babies = record.babies;
	if (babies !== undefined) {
		if (!Array.isArray(babies) || babies.length > MAX_INPATIENT_BABIES) {
			invalid("babies-invalid");
		}
	}
	const diagnoses = record.diagnoses;
	if (
		diagnoses !== undefined &&
		(!Array.isArray(diagnoses) || diagnoses.length > MAX_INPATIENT_DIAGNOSES)
	) {
		invalid("diagnoses-invalid");
	}
	const normalizedDiagnoses = diagnoses?.map(normalizeDiagnosis);
	const normalizedBabies = babies?.map(normalizeBaby);
	return {
		patientName,
		...(optionalText(record.inpatientNumber, 64)
			? { inpatientNumber: record.inpatientNumber as string }
			: {}),
		...(cardNumberMasked ? { cardNumberMasked } : {}),
		...(optionalText(record.sex, 64) ? { sex: record.sex as string } : {}),
		...(optionalText(record.age, 64) ? { age: record.age as string } : {}),
		admittedAt,
		...(optionalText(record.dischargedAt, 64)
			? { dischargedAt: record.dischargedAt as string }
			: {}),
		...(optionalText(record.admissionType, 128)
			? { admissionType: record.admissionType as string }
			: {}),
		status: status as InpatientEpisodeStatus,
		...(bedStatus ? { bedStatus: bedStatus as InpatientBedStatus } : {}),
		...(optionalText(record.wardName, 128)
			? { wardName: record.wardName as string }
			: {}),
		...(optionalText(record.admissionWardName, 128)
			? { admissionWardName: record.admissionWardName as string }
			: {}),
		...(optionalText(record.departmentName, 128)
			? { departmentName: record.departmentName as string }
			: {}),
		...(optionalText(record.bedNumber, 64)
			? { bedNumber: record.bedNumber as string }
			: {}),
		...(optionalText(record.roomNumber, 64)
			? { roomNumber: record.roomNumber as string }
			: {}),
		...(optionalText(record.primaryDoctorName, 128)
			? { primaryDoctorName: record.primaryDoctorName as string }
			: {}),
		...(optionalText(record.attendingDoctorName, 128)
			? { attendingDoctorName: record.attendingDoctorName as string }
			: {}),
		...(optionalText(record.responsibleNurseName, 128)
			? { responsibleNurseName: record.responsibleNurseName as string }
			: {}),
		...(optionalText(record.outpatientDoctorName, 128)
			? { outpatientDoctorName: record.outpatientDoctorName as string }
			: {}),
		...(optionalText(record.admissionDiagnosis, 4096)
			? { admissionDiagnosis: record.admissionDiagnosis as string }
			: {}),
		...(optionalText(record.dischargeDiagnosis, 4096)
			? { dischargeDiagnosis: record.dischargeDiagnosis as string }
			: {}),
		...(normalizedDiagnoses && normalizedDiagnoses.length > 0
			? { diagnoses: normalizedDiagnoses }
			: {}),
		...(optionalText(record.nursingLevel, 128)
			? { nursingLevel: record.nursingLevel as string }
			: {}),
		...(optionalText(record.condition, 1024)
			? { condition: record.condition as string }
			: {}),
		...(normalizedBabies && normalizedBabies.length > 0
			? { babies: normalizedBabies }
			: {}),
	};
}

/** Provider adapter 和 service 替身共用的住院 episode 二次投影。 */
export function normalizeInpatientEpisodes(value: unknown): InpatientEpisode[] {
	if (!Array.isArray(value)) invalid("episodes-not-array");
	if (value.length > MAX_INPATIENT_EPISODES) invalid("episodes-too-many");
	const seen = new Set<string>();
	return value.map((item) => {
		const episode = normalizeEpisode(item);
		const identity = `${episode.inpatientNumber ?? ""}:${episode.admittedAt}:${episode.patientName}`;
		if (seen.has(identity)) invalid("episode-duplicate");
		seen.add(identity);
		return episode;
	});
}

/** 服务端 owner 映射完成后才允许访问上游住院接口。 */
export interface InpatientEpisodeGateway {
	listEpisodes(
		input: { providerPatientId: string },
		context: AdapterCallContext,
	): Promise<{
		episodes: readonly InpatientEpisode[];
		trace: ExternalTrace;
	}>;
}

/** 住院查询只接受当前 owner 的服务端 HIS 患者引用。 */
export function validateInpatientProviderReference(
	reference: unknown,
	patientId: string,
): boolean {
	if (
		typeof reference !== "object" ||
		reference === null ||
		Array.isArray(reference)
	) {
		return false;
	}
	const candidate = reference as Record<string, unknown>;
	return (
		candidate.patientId === patientId &&
		candidate.provider === "zhongyang" &&
		isBoundedOpaqueIdentifier(candidate.patientId) &&
		isBoundedOpaqueIdentifier(candidate.providerPatientId)
	);
}
