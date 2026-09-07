import type {
	AdapterCallContext,
	ExternalTrace,
	PatientBindingGateway,
	PatientBindingProviderContext,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const PATIENT_ARCHIVE_PATH = "/msun-middle-aggregate-patient/v1/patInfosFind";
const PATIENT_CREATE_PATH = "/msun-middle-aggregate-patient/v1/patients";
const PATIENT_CARD_BIND_PATH = "/msun-middle-aggregate-patient/v1/patCards";

type ZhongyangPatientBindingOptions = {
	baseUrl: string;
	/** 众阳 2.1.53 的 `org-id` 请求头及 2.1.51 的 orgId。 */
	orgId: number;
	/** 众阳 2.1.51 建档使用的 hospitalId。 */
	hospitalId: number;
	/** 由 2.1.55 卡类型字典确认的 cardTypeId。 */
	cardTypeId: number;
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

function requiredPositiveInteger(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	return value;
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

type PatientReference = { patId: number; cardNo: string };

function positivePatientId(value: unknown): number | undefined {
	const normalized =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/u.test(value.trim())
				? Number(value.trim())
				: undefined;
	if (
		normalized === undefined ||
		!Number.isSafeInteger(normalized) ||
		normalized <= 0
	) {
		return undefined;
	}
	return normalized;
}

function patientReference(
	value: unknown,
	requestId: string,
): PatientReference | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "object" || Array.isArray(value)) {
		throw providerError(
			"Zhongyang patient archive response is invalid",
			requestId,
			true,
		);
	}
	const record = value as Record<string, unknown>;
	const patientId = positivePatientId(record.patId);
	if (patientId === undefined) {
		throw providerError(
			"Zhongyang patient archive patId is invalid",
			requestId,
			true,
		);
	}
	const cardNo = record.cardNo;
	if (typeof cardNo !== "string" || !cardNo.trim() || cardNo.length > 300) {
		throw providerError(
			"Zhongyang patient archive cardNo is invalid",
			requestId,
			true,
		);
	}
	return { patId: patientId, cardNo: cardNo.trim() };
}

function createdPatientReference(
	value: unknown,
	requestId: string,
): PatientReference {
	const patient = patientReference(value, requestId);
	if (!patient) {
		throw providerError(
			"Zhongyang patient creation did not return patId/cardNo",
			requestId,
			true,
		);
	}
	return patient;
}

export class ZhongyangPatientBindingApiGateway
	implements PatientBindingGateway
{
	private readonly baseUrl: string;
	private readonly orgId: number;
	private readonly hospitalId: number;
	private readonly cardTypeId: number;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangPatientBindingOptions) {
		this.baseUrl = requiredText(options.baseUrl, "baseUrl", 512);
		this.orgId = requiredPositiveInteger(options.orgId);
		this.hospitalId = requiredPositiveInteger(options.hospitalId);
		this.cardTypeId = requiredPositiveInteger(options.cardTypeId);
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
		providerContext?: PatientBindingProviderContext,
	): Promise<{ created: boolean; trace: ExternalTrace }> {
		const displayName = requiredText(input.displayName, "displayName", 128);
		const mobile = requiredText(input.mobile, "mobile", 32);
		const identityNumber = requiredText(
			input.identityNumber,
			"identityNumber",
			32,
		);
		const authorizationToken =
			providerContext?.authorizationToken?.trim() || this.authorizationToken;
		const headers = {
			"org-id": String(this.orgId),
			...(authorizationToken
				? { Authorization: `Bearer ${authorizationToken}` }
				: {}),
		};
		const archiveUrl = new URL(PATIENT_ARCHIVE_PATH, this.baseUrl);
		archiveUrl.searchParams.set("type", "2");
		archiveUrl.searchParams.set("idCardType", "0");
		archiveUrl.searchParams.set("idCardNo", identityNumber);
		archiveUrl.searchParams.set("patName", displayName);
		const archiveResponse = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-binding.archive-lookup",
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
		let patient = patientReference(archive.data, archiveResponse.requestId);
		let created = false;
		let createRequestId: string | undefined;
		let cardNo = identityNumber;
		if (!patient) {
			const createResponse = await requestJson<unknown>(
				{
					provider: "zhongyang",
					operation: "patient-binding.create-archive",
					url: new URL(PATIENT_CREATE_PATH, this.baseUrl).toString(),
					method: "POST",
					context,
					...(headers ? { headers } : {}),
					body: {
						patName: displayName,
						phone: mobile,
						idCardNo: identityNumber,
						idCardType: 0,
						birthday: `${input.birthDate} 00:00:00`,
						sex: Number(input.sex),
						cardType: this.cardTypeId,
						hospitalId: this.hospitalId,
						orgId: this.orgId,
					},
				},
				this.fetcher,
			);
			createRequestId = createResponse.requestId;
			patient = createdPatientReference(
				successfulEnvelope(createResponse.data, createResponse.requestId).data,
				createResponse.requestId,
			);
			cardNo = patient.cardNo;
			created = true;
		}
		const bindResponse = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-binding.bind-card",
				url: new URL(PATIENT_CARD_BIND_PATH, this.baseUrl).toString(),
				method: "POST",
				context,
				...(headers ? { headers } : {}),
				body: { patId: patient.patId, cardNo },
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
				requestIds: [
					archiveResponse.requestId,
					...(createRequestId ? [createRequestId] : []),
					bindResponse.requestId,
				],
			},
		};
	}
}

export function createZhongyangPatientBindingGateway(
	options: ZhongyangPatientBindingOptions,
): PatientBindingGateway {
	return new ZhongyangPatientBindingApiGateway(options);
}
