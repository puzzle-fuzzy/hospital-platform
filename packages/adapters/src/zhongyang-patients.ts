import type {
	AdapterCallContext,
	ExternalTrace,
	PatientDirectoryGateway,
	PatientDirectoryProfile,
	PatientRelationship,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const PATIENT_INFO_BY_UNION_ID_PATH = "/api/public/patientInfoByUnionId";
const PATIENT_ARCHIVE_PATH = "/msun-middle-aggregate-patient/v1/patInfosFind";

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

/** 众阳各服务共用的服务端连接配置；业务 adapter 不共享彼此的模型。 */
export type ZhongyangGatewayOptions = {
	/** 众阳服务端地址；不能来自小程序请求参数。 */
	baseUrl: string;
	/** 只有 provider 明确要求时才注入服务端 token，绝不从客户端透传。 */
	authorizationToken?: string;
	fetcher?: ProviderFetcher;
};

export type ZhongyangPatientGatewayOptions = ZhongyangGatewayOptions;

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function providerError(
	message: string,
	requestId?: string,
	operation = "patient-list",
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation,
		message,
		retryable: false,
		...(requestId ? { requestId } : {}),
	});
}

function requiredText(
	value: unknown,
	field: string,
	maxLength: number,
	operation = "patient-list",
	requestId?: string,
): string {
	if (typeof value !== "string" && typeof value !== "number") {
		throw providerError(
			`Zhongyang patient field ${field} is invalid`,
			requestId,
			operation,
		);
	}
	const normalized = String(value).trim();
	if (!normalized || normalized.length > maxLength) {
		throw providerError(
			`Zhongyang patient field ${field} is invalid`,
			requestId,
			operation,
		);
	}
	return normalized;
}

function maskCardNumber(value: unknown): string {
	if (value === undefined || value === null) return "未绑定";
	const normalized = String(value).trim();
	if (!normalized || normalized.length > 64) return "未绑定";
	if (normalized.length <= 4) return "*".repeat(normalized.length);
	// 患者选择页需要可核对卡号，但不能暴露完整卡号：最多展示前五位和后四位。
	const suffixLength = Math.min(4, normalized.length);
	const prefixLength = Math.min(
		5,
		Math.max(0, normalized.length - suffixLength - 1),
	);
	const maskLength = normalized.length - prefixLength - suffixLength;
	return `${normalized.slice(0, prefixLength)}${"*".repeat(maskLength)}${normalized.slice(-suffixLength)}`;
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
	// 旧端患者选择流程明确优先 medicalCardNo；cardNo 只作为旧数据兜底。
	const card = value.medicalCardNo ?? value.cardNo;
	return {
		providerPatientId,
		displayName,
		relationship: relationship(value.relation),
		cardNumberMasked: maskCardNumber(card),
	};
}

/**
 * 使用旧端已经验证过的档案查询契约取得临床业务所需的 HIS patId。
 *
 * patientInfoByUnionId 返回的 thirdPatientId 是患者目录引用，不能直接
 * 拼到 appointment-infos、报告或门诊费用接口。这里通过卡号+姓名查询
 * patInfosFind，只把返回的 patId 留在服务端映射层，不进入小程序响应。
 */
async function resolveHisPatientId(
	value: ZhongyangPatientResponse,
	context: AdapterCallContext,
	fetcher: ProviderFetcher,
	baseUrl: string,
	authorizationToken: string | undefined,
): Promise<string> {
	const operation = "patient-archive";
	const card = requiredText(
		value.medicalCardNo ?? value.cardNo,
		"medicalCardNo",
		128,
	);
	const displayName = requiredText(value.patientName, "patientName", 128);
	const url = new URL(PATIENT_ARCHIVE_PATH, baseUrl);
	url.searchParams.set("type", "3");
	url.searchParams.set("cardNo", card);
	url.searchParams.set("patName", displayName);
	const response = await requestJson<unknown>(
		{
			provider: "zhongyang",
			operation,
			url: url.toString(),
			method: "GET",
			context,
			...(authorizationToken
				? { headers: { Authorization: `Bearer ${authorizationToken}` } }
				: {}),
		},
		fetcher,
	);
	if (
		typeof response.data !== "object" ||
		response.data === null ||
		Array.isArray(response.data)
	) {
		throw providerError(
			"Zhongyang patient archive response was invalid",
			response.requestId,
			operation,
		);
	}
	const envelope = response.data as ZhongyangPatientEnvelope;
	if (envelope.success === false) {
		throw providerError(
			"Zhongyang patient archive provider rejected the request",
			response.requestId,
			operation,
		);
	}
	if (
		typeof envelope.data !== "object" ||
		envelope.data === null ||
		Array.isArray(envelope.data)
	) {
		throw providerError(
			"Zhongyang patient archive data was invalid",
			response.requestId,
			operation,
		);
	}
	return requiredText(
		(envelope.data as Record<string, unknown>).patId,
		"patId",
		128,
		operation,
		response.requestId,
	);
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
		// 患者数量通常很少，按患者并行解析一次临床档案身份，避免把
		// thirdPatientId 错当成预约、报告和门诊费用接口的 patId。
		const patients = await Promise.all(
			items.map(async (item) => {
				const patient = mapPatient(item);
				const hisPatientId = await resolveHisPatientId(
					item,
					context,
					this.fetcher,
					this.baseUrl,
					this.authorizationToken,
				);
				return {
					...patient,
					providerReferences: { "his-patient": hisPatientId },
				};
			}),
		);
		return {
			patients,
			trace: trace(response.requestId),
		};
	}
}

export function createZhongyangPatientGateway(
	options: ZhongyangPatientGatewayOptions,
): PatientDirectoryGateway {
	return new ZhongyangPatientApiGateway(options);
}
