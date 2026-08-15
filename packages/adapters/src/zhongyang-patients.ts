import type {
	AdapterCallContext,
	ExternalTrace,
	PatientDirectoryGateway,
	PatientDirectoryProfile,
	PatientRelationship,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { requestJson, type ProviderFetcher } from "./http";

const PATIENT_INFO_BY_UNION_ID_PATH = "/api/public/patientInfoByUnionId";

type ZhongyangPatientResponse = {
	thirdPatientId?: unknown;
	patientName?: unknown;
	cardNo?: unknown;
	medicalCardNo?: unknown;
	relation?: unknown;
};

type ZhongyangPatientEnvelope = {
	success?: unknown;
	data?: unknown;
	message?: unknown;
};

export type ZhongyangPatientGatewayOptions = {
	/** 众阳服务端地址；不能来自小程序请求参数。 */
	baseUrl: string;
	/** 只有 provider 明确要求时才注入服务端 token，绝不从客户端透传。 */
	authorizationToken?: string;
	fetcher?: ProviderFetcher;
};

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function providerError(
	message: string,
	requestId?: string,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "patient-list",
		message,
		retryable: false,
		...(requestId ? { requestId } : {}),
	});
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
): string {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(`Zhongyang patient field ${field} is invalid`);
	}
	const normalized = String(value).trim();
	if (!normalized || normalized.length > maxLength) {
		throw providerError(`Zhongyang patient field ${field} is invalid`);
	}
	return normalized;
}

function maskCardNumber(value: unknown): string {
	if (value === undefined || value === null) return "未绑定";
	const normalized = String(value).trim();
	if (!normalized || normalized.length > 64) return "未绑定";
	if (normalized.length <= 4) return "*".repeat(normalized.length);
	return `${"*".repeat(Math.min(8, normalized.length - 4))}${normalized.slice(-4)}`;
}

function relationship(value: unknown): PatientRelationship {
	const normalized =
		typeof value === "string" ? value.trim().toLowerCase() : "";
	const aliases: Record<string, PatientRelationship> = {
		self: "self",
		本人: "self",
		spouse: "spouse",
		配偶: "spouse",
		child: "child",
		子女: "child",
		parent: "parent",
		父母: "parent",
	};
	return aliases[normalized] ?? "other";
}

function responseItems(
	value: unknown,
	requestId: string,
): ZhongyangPatientResponse[] {
	if (Array.isArray(value)) return value as ZhongyangPatientResponse[];
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang patient response data was invalid",
			requestId,
		);
	}
	const envelope = value as ZhongyangPatientEnvelope;
	if (envelope.success === false) {
		throw providerError(
			"Zhongyang patient provider rejected the request",
			requestId,
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			"Zhongyang patient response data was invalid",
			requestId,
		);
	}
	return envelope.data as ZhongyangPatientResponse[];
}

function mapPatient(value: ZhongyangPatientResponse): PatientDirectoryProfile {
	const providerPatientId = requiredText(
		value.thirdPatientId,
		"thirdPatientId",
		128,
	);
	const displayName = requiredText(value.patientName, "patientName", 128);
	const card = value.cardNo ?? value.medicalCardNo;
	return {
		providerPatientId,
		displayName,
		relationship: relationship(value.relation),
		cardNumberMasked: maskCardNumber(card),
	};
}

function trace(requestId: string): ExternalTrace {
	return {
		provider: "zhongyang",
		operation: "patient-list",
		requestId,
	};
}

/**
 * 众阳患者目录 adapter。
 *
 * 旧小程序曾直接调用 `/api/public/patientInfoByUnionId`；新架构只允许服务端
 * 使用已绑定的 unionId 调用，并将 provider 原始患者结构收窄为最小脱敏事实。
 */
export class ZhongyangPatientApiGateway implements PatientDirectoryGateway {
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangPatientGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async listByIdentity(
		input: { unionId: string },
		context: AdapterCallContext,
	): Promise<{
		patients: readonly PatientDirectoryProfile[];
		trace: ExternalTrace;
	}> {
		const unionId = requiredText(input.unionId, "unionId", 128);
		const url = new URL(PATIENT_INFO_BY_UNION_ID_PATH, this.baseUrl);
		url.searchParams.set("unionId", unionId);
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "patient-list",
				url: url.toString(),
				method: "GET",
				context,
				...(this.authorizationToken
					? { headers: { Authorization: `Bearer ${this.authorizationToken}` } }
					: {}),
			},
			this.fetcher,
		);
		const items = responseItems(response.data, response.requestId);
		return {
			patients: items.map(mapPatient),
			trace: trace(response.requestId),
		};
	}
}

export function createZhongyangPatientGateway(
	options: ZhongyangPatientGatewayOptions,
): PatientDirectoryGateway {
	return new ZhongyangPatientApiGateway(options);
}
