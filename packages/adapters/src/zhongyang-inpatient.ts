import type {
	AdapterCallContext,
	ExternalTrace,
	InpatientBaby,
	InpatientDiagnosis,
	InpatientEpisode,
	InpatientEpisodeGateway,
} from "@hospital/domain";
import {
	MAX_INPATIENT_EPISODES,
	normalizeInpatientEpisodes,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const INPATIENT_PATIENTS_PATH = "/msun-middle-aggregate-hsz/v1/patients";
type ProviderObject = Record<string, unknown>;

function providerError(
	message: string,
	requestId?: string,
	responseInvalid = true,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "inpatient-episodes",
		message,
		retryable: false,
		responseInvalid,
		...(requestId ? { requestId } : {}),
	});
}

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function safeText(
	value: unknown,
	field: string,
	maxLength: number,
	requestId: string,
	optional = true,
): string | undefined {
	if (value === undefined || value === null || value === "") {
		if (optional) return undefined;
		throw providerError(`Zhongyang inpatient ${field} is missing`, requestId);
	}
	if (typeof value !== "string") {
		throw providerError(`Zhongyang inpatient ${field} is invalid`, requestId);
	}
	const normalized = value.trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw providerError(`Zhongyang inpatient ${field} is invalid`, requestId);
	}
	return normalized;
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
	requestId: string,
): string {
	const normalized = safeText(value, field, maxLength, requestId, false);
	if (!normalized) {
		throw providerError(`Zhongyang inpatient ${field} is missing`, requestId);
	}
	return normalized;
}

function numericMeasurement(
	value: unknown,
	field: string,
	requestId: string,
): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw providerError(`Zhongyang inpatient ${field} is invalid`, requestId);
	}
	return value;
}

function status(value: unknown, requestId: string): InpatientEpisode["status"] {
	if (value === 1) return "inpatient";
	if (value === 2) return "discharged";
	if (value === 3) return "cancelled";
	throw providerError("Zhongyang inpatient status is unknown", requestId);
}

function bedStatus(
	value: unknown,
	requestId: string,
): InpatientEpisode["bedStatus"] {
	if (value === undefined || value === null) return undefined;
	if (value === 1) return "in_bed";
	if (value === 2) return "shared_bed";
	if (value === 32) return "out_of_bed";
	throw providerError("Zhongyang inpatient bed status is unknown", requestId);
}

function maskCardNumber(value: string): string {
	if (value.length <= 4) return "*".repeat(value.length);
	const suffixLength = Math.min(4, value.length);
	const prefixLength = Math.min(
		5,
		Math.max(0, value.length - suffixLength - 1),
	);
	return `${value.slice(0, prefixLength)}${"*".repeat(value.length - prefixLength - suffixLength)}${value.slice(-suffixLength)}`;
}

function mapBaby(value: unknown, requestId: string): InpatientBaby {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError("Zhongyang inpatient baby item is invalid", requestId);
	}
	const record = value as ProviderObject;
	const name = requiredText(record.babyName, "babyName", 128, requestId);
	const inpatientNumber = safeText(
		record.babyInHosCode,
		"babyInHosCode",
		64,
		requestId,
	);
	const sex = safeText(record.sexName, "sexName", 64, requestId);
	const birthDate = safeText(record.birthDate, "birthDate", 64, requestId);
	const heightCm = numericMeasurement(
		record.babyHeight,
		"babyHeight",
		requestId,
	);
	const weightKg = numericMeasurement(
		record.babyWeight,
		"babyWeight",
		requestId,
	);
	if (heightCm !== undefined && (heightCm < 0 || heightCm > 300)) {
		throw providerError(
			"Zhongyang inpatient babyHeight is out of range",
			requestId,
		);
	}
	if (weightKg !== undefined && (weightKg < 0 || weightKg > 500)) {
		throw providerError(
			"Zhongyang inpatient babyWeight is out of range",
			requestId,
		);
	}
	return {
		name,
		...(inpatientNumber ? { inpatientNumber } : {}),
		...(sex ? { sex } : {}),
		...(birthDate ? { birthDate } : {}),
		...(heightCm === undefined ? {} : { heightCm }),
		...(weightKg === undefined ? {} : { weightKg }),
	};
}

function mapDiagnosis(value: unknown, requestId: string): InpatientDiagnosis {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang inpatient diagnosis item is invalid",
			requestId,
		);
	}
	const record = value as ProviderObject;
	const name = requiredText(
		record.diagnosisName,
		"diagnosisName",
		4096,
		requestId,
	);
	const primaryFlag = record.mainDiagnoseFlag;
	if (
		primaryFlag !== undefined &&
		primaryFlag !== null &&
		primaryFlag !== "" &&
		primaryFlag !== "0" &&
		primaryFlag !== "1"
	) {
		throw providerError(
			"Zhongyang inpatient diagnosis primary flag is unknown",
			requestId,
		);
	}
	return {
		name,
		...(primaryFlag === "" || primaryFlag === undefined || primaryFlag === null
			? {}
			: { isPrimary: primaryFlag === "1" }),
	};
}

function mapEpisode(value: unknown, requestId: string): InpatientEpisode {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang inpatient episode item is invalid",
			requestId,
		);
	}
	const record = value as ProviderObject;
	const patientName = requiredText(record.patName, "patName", 128, requestId);
	const inpatientNumber = safeText(
		record.patInHosCode,
		"patInHosCode",
		64,
		requestId,
	);
	const rawCardNumber = safeText(record.patCardNo, "patCardNo", 64, requestId);
	const sex = safeText(record.sexName, "sexName", 64, requestId);
	const age = safeText(record.patAge, "patAge", 64, requestId);
	const admittedAt = requiredText(record.patInTime, "patInTime", 64, requestId);
	const dischargedAt = safeText(record.patOutTime, "patOutTime", 64, requestId);
	const admissionType = safeText(
		record.inHosWayName,
		"inHosWayName",
		128,
		requestId,
	);
	const wardName = safeText(record.patWardName, "patWardName", 128, requestId);
	const admissionWardName = safeText(
		record.patInWardName,
		"patInWardName",
		128,
		requestId,
	);
	const departmentName = safeText(
		record.patClinicName,
		"patClinicName",
		128,
		requestId,
	);
	const bedNumber = safeText(record.bedShowNo, "bedShowNo", 64, requestId);
	const roomNumber = safeText(record.roomNo, "roomNo", 64, requestId);
	const primaryDoctorName = safeText(
		record.patInChargeDocName,
		"patInChargeDocName",
		128,
		requestId,
	);
	const attendingDoctorName = safeText(
		record.attendingDocName,
		"attendingDocName",
		128,
		requestId,
	);
	const responsibleNurseName = safeText(
		record.durNurseName,
		"durNurseName",
		128,
		requestId,
	);
	const outpatientDoctorName = safeText(
		record.outDocName,
		"outDocName",
		128,
		requestId,
	);
	const admissionDiagnosis = safeText(
		record.inHosDiagnosisName,
		"inHosDiagnosisName",
		4096,
		requestId,
	);
	const dischargeDiagnosis = safeText(
		record.outHosDiagnosisName,
		"outHosDiagnosisName",
		4096,
		requestId,
	);
	const nursingLevel = safeText(
		record.nursingClassName,
		"nursingClassName",
		128,
		requestId,
	);
	const condition = safeText(
		record.patCondition,
		"patCondition",
		1024,
		requestId,
	);
	const diagnosisInfos = record.patDiagnosisInfos;
	if (
		diagnosisInfos !== undefined &&
		diagnosisInfos !== null &&
		(!Array.isArray(diagnosisInfos) || diagnosisInfos.length > 32)
	) {
		throw providerError(
			"Zhongyang inpatient diagnosis list is invalid",
			requestId,
		);
	}
	const diagnoses =
		diagnosisInfos === undefined || diagnosisInfos === null
			? undefined
			: diagnosisInfos.map((diagnosis) => mapDiagnosis(diagnosis, requestId));
	const babies = record.inPatBabyList;
	if (babies !== undefined && (!Array.isArray(babies) || babies.length > 16)) {
		throw providerError("Zhongyang inpatient baby list is invalid", requestId);
	}
	const mappedBabies = babies?.map((baby) => mapBaby(baby, requestId));
	const mappedStatus = status(record.patInStatus, requestId);
	const mappedBedStatus = bedStatus(record.patInBedStatus, requestId);
	return {
		patientName,
		...(inpatientNumber ? { inpatientNumber } : {}),
		...(rawCardNumber
			? { cardNumberMasked: maskCardNumber(rawCardNumber) }
			: {}),
		...(sex ? { sex } : {}),
		...(age ? { age } : {}),
		admittedAt,
		...(dischargedAt ? { dischargedAt } : {}),
		...(admissionType ? { admissionType } : {}),
		status: mappedStatus,
		...(mappedBedStatus ? { bedStatus: mappedBedStatus } : {}),
		...(wardName ? { wardName } : {}),
		...(admissionWardName ? { admissionWardName } : {}),
		...(departmentName ? { departmentName } : {}),
		...(bedNumber ? { bedNumber } : {}),
		...(roomNumber ? { roomNumber } : {}),
		...(primaryDoctorName ? { primaryDoctorName } : {}),
		...(attendingDoctorName ? { attendingDoctorName } : {}),
		...(responsibleNurseName ? { responsibleNurseName } : {}),
		...(outpatientDoctorName ? { outpatientDoctorName } : {}),
		...(admissionDiagnosis ? { admissionDiagnosis } : {}),
		...(dischargeDiagnosis ? { dischargeDiagnosis } : {}),
		...(diagnoses && diagnoses.length > 0 ? { diagnoses } : {}),
		...(nursingLevel ? { nursingLevel } : {}),
		...(condition ? { condition } : {}),
		...(mappedBabies && mappedBabies.length > 0
			? { babies: mappedBabies }
			: {}),
	};
}

function responseItems(value: unknown, requestId: string): ProviderObject[] {
	if (Array.isArray(value)) {
		if (value.length > MAX_INPATIENT_EPISODES) {
			throw providerError(
				"Zhongyang inpatient response contained too many episodes",
				requestId,
			);
		}
		return value.map((item) => {
			if (typeof item !== "object" || item === null || Array.isArray(item)) {
				throw providerError(
					"Zhongyang inpatient episode item is invalid",
					requestId,
				);
			}
			return item as ProviderObject;
		});
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError("Zhongyang inpatient response is invalid", requestId);
	}
	const envelope = value as ProviderObject;
	const success = envelope.success;
	const code = envelope.code;
	const successfulCode = code === 0 || code === "0" || code === "0000";
	if (
		(success !== undefined && success !== true) ||
		(code !== undefined && !successfulCode) ||
		(success !== true && !successfulCode)
	) {
		throw providerError(
			"Zhongyang inpatient provider rejected the request",
			requestId,
			false,
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			"Zhongyang inpatient response data is invalid",
			requestId,
		);
	}
	if (envelope.data.length > MAX_INPATIENT_EPISODES) {
		throw providerError(
			"Zhongyang inpatient response contained too many episodes",
			requestId,
		);
	}
	return envelope.data.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			throw providerError(
				"Zhongyang inpatient episode item is invalid",
				requestId,
			);
		}
		return item as ProviderObject;
	});
}

function trace(requestId: string): ExternalTrace {
	return {
		provider: "zhongyang",
		operation: "inpatient-episodes",
		requestId,
	};
}

export class ZhongyangInpatientEpisodeApiGateway
	implements InpatientEpisodeGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async listEpisodes(
		input: { providerPatientId: string },
		context: AdapterCallContext,
	) {
		if (
			typeof input?.providerPatientId !== "string" ||
			!input.providerPatientId.trim()
		) {
			throw providerError(
				"Zhongyang inpatient patient identifier is invalid",
				undefined,
				false,
			);
		}
		const url = new URL(INPATIENT_PATIENTS_PATH, this.baseUrl);
		url.searchParams.set("patId", input.providerPatientId);
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "inpatient-episodes",
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const episodes = normalizeInpatientEpisodes(
			responseItems(response.data, response.requestId).map((item) =>
				mapEpisode(item, response.requestId),
			),
		);
		return { episodes, trace: trace(response.requestId) };
	}
}

export function createZhongyangInpatientEpisodeGateway(
	options: ZhongyangGatewayOptions,
): InpatientEpisodeGateway {
	return new ZhongyangInpatientEpisodeApiGateway(options);
}
