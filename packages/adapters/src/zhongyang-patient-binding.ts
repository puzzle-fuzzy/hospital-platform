import type {
	AdapterCallContext,
	ExternalTrace,
	PatientBindingGateway,
} from "@hospital/domain";
import { ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const PATIENT_ARCHIVE_PATH = "/msun-middle-aggregate-patient/v1/patInfosFind";
const PATIENT_CREATE_PATH = "/msun-middle-aggregate-patient/v1/patients";
const PATIENT_CARD_BIND_PATH = "/msun-middle-aggregate-patient/v1/patCards";

type ZhongyangPatientBindingOptions = {
	baseUrl: string;
	authorizationToken?: string;
	fetcher?: ProviderFetcher;
};

type ZhongyangEnvelope = { success?: unknown; data?: unknown };

function providerError(
	message: string,
	requestId?: string,
	responseInvalid = false,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "patient-binding",
		message,
		retryable: false,
		...(requestId ? { requestId } : {}),
		...(responseInvalid ? { responseInvalid: true } : {}),
	});
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
): string {
	if (typeof value !== "string") {
		throw providerError(`Zhongyang patient binding ${field} is invalid`);
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
		throw providerError(`Zhongyang patient binding ${field} is invalid`);
	}
	return normalized;
}

function successfulEnvelope(
	value: unknown,
	requestId: string,
): ZhongyangEnvelope {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang patient binding response is invalid",
			requestId,
			true,
		);
	}
	const envelope = value as ZhongyangEnvelope;
	if (envelope.success !== true) {
		throw providerError(
			"Zhongyang patient binding was rejected",
			requestId,
			envelope.success !== false,
		);
	}
	return envelope;
}

function archivePatientId(
	value: unknown,
	requestId: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw providerError(
			"Zhongyang patient archive response is invalid",
			requestId,
			true,
		);
	}
	const patientId = (value as Record<string, unknown>).patId;
	if (
		typeof patientId !== "string" ||
		!patientId.trim() ||
		patientId.length > 128
	) {
		throw providerError(
			"Zhongyang patient archive patId is invalid",
			requestId,
			true,
		);
	}
	return patientId.trim();
}

function createdPatientId(value: unknown, requestId: string): string {
	const patientId = archivePatientId(value, requestId);
	if (!patientId) {
		throw providerError(
			"Zhongyang patient creation did not return patId",
			requestId,
			true,
		);
	}
	return patientId;
}

export class ZhongyangPatientBindingApiGateway
	implements PatientBindingGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangPatientBindingOptions) {
		this.baseUrl = requiredText(options.baseUrl, "baseUrl", 512);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async bind(
		input: {
			displayName: string;
			mobile: string;
			identityNumber: string;
			birthDate: string;
			sex: "1" | "2";
		},
		context: AdapterCallContext,
	): Promise<{ created: boolean; trace: ExternalTrace }> {
		const displayName = requiredText(input.displayName, "displayName", 128);
		const mobile = requiredText(input.mobile, "mobile", 32);
		const identityNumber = requiredText(
			input.identityNumber,
			"identityNumber",
			32,
		);
		const headers = this.authorizationToken
			? { Authorization: `Bearer ${this.authorizationToken}` }
			: undefined;
		const archiveUrl = new URL(PATIENT_ARCHIVE_PATH, this.baseUrl);
		archiveUrl.searchParams.set("type", "2");
		archiveUrl.searchParams.set("idCardType", "0");
		archiveUrl.searchParams.set("idCardNo", identityNumber);
		archiveUrl.searchParams.set("patName", displayName);
		const archiveResponse = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-binding",
				url: archiveUrl.toString(),
				method: "GET",
				context,
				...(headers ? { headers } : {}),
			},
			this.fetcher,
		);
		const archive = successfulEnvelope(
			archiveResponse.data,
			archiveResponse.requestId,
		);
		if (archive.data === undefined) {
			throw providerError(
				"Zhongyang patient archive response omitted data",
				archiveResponse.requestId,
				true,
			);
		}
		let patientId = archivePatientId(archive.data, archiveResponse.requestId);
		let created = false;
		if (!patientId) {
			const createResponse = await requestJson<unknown>(
				{
					provider: "zhongyang",
					operation: "patient-binding",
					url: new URL(PATIENT_CREATE_PATH, this.baseUrl).toString(),
					method: "POST",
					context,
					...(headers ? { headers } : {}),
					body: {
						patName: displayName,
						phone: mobile,
						idCardNo: identityNumber,
						idCardType: "0",
						birthday: `${input.birthDate} 00:00:00`,
						sex: input.sex,
						cardNo: identityNumber,
						cardType: "3",
					},
				},
				this.fetcher,
			);
			patientId = createdPatientId(
				successfulEnvelope(createResponse.data, createResponse.requestId).data,
				createResponse.requestId,
			);
			created = true;
		}
		const bindResponse = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-binding",
				url: new URL(PATIENT_CARD_BIND_PATH, this.baseUrl).toString(),
				method: "POST",
				context,
				...(headers ? { headers } : {}),
				body: { patId: patientId, cardNo: identityNumber },
			},
			this.fetcher,
		);
		successfulEnvelope(bindResponse.data, bindResponse.requestId);
		return {
			created,
			trace: {
				provider: "zhongyang",
				operation: "patient-binding",
				requestId: bindResponse.requestId,
			},
		};
	}
}

export function createZhongyangPatientBindingGateway(
	options: ZhongyangPatientBindingOptions,
): PatientBindingGateway {
	return new ZhongyangPatientBindingApiGateway(options);
}
