import type {
	AdapterCallContext,
	IntelligentGuideDepartment,
	IntelligentGuideGateway,
	IntelligentGuideProviderReply,
} from "@hospital/domain";
import { ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const GUIDE_CHAT_TEXT_PATH = "/intelligent/outpatient_recommend/chat_text";
const GUIDE_CHAT_AUDIO_PATH = "/intelligent/outpatient_recommend/chat_audio";
const GUIDE_TEXT_OPERATION = "intelligent-guide-chat-text";
const GUIDE_AUDIO_OPERATION = "intelligent-guide-chat-audio";
const MAX_PROVIDER_TEXT_LENGTH = 4_000;
const MAX_PROVIDER_CONVERSATION_ID_LENGTH = 128;
const MAX_DEPARTMENTS = 20;

type LegacyGuideEnvelope = {
	code?: unknown;
	message?: unknown;
	data?: unknown;
};

export type LegacyIntelligentGuideGatewayOptions = {
	/** 旧服务 API 根地址，例如 https://test-hp.meiyi.pro/api/v1。 */
	baseUrl: string;
	fetcher?: ProviderFetcher;
};

function requiredBaseUrl(value: string): string {
	const normalized = value.trim().replace(/\/+$/u, "");
	if (!normalized)
		throw new Error("Legacy intelligent guide base URL is required");
	return normalized;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function optionalText(value: unknown): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (
		typeof value !== "string" ||
		value.length > MAX_PROVIDER_TEXT_LENGTH ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
		})
	) {
		return undefined;
	}
	return value.trim() || undefined;
}

function requiredConversationId(value: unknown): string | undefined {
	if (
		typeof value !== "string" ||
		!value ||
		value !== value.trim() ||
		value.length > MAX_PROVIDER_CONVERSATION_ID_LENGTH ||
		!/^[A-Za-z0-9._:-]+$/u.test(value)
	) {
		return undefined;
	}
	return value;
}

function normalizeDepartment(
	value: unknown,
): IntelligentGuideDepartment | undefined {
	const item = record(value);
	if (!item) return undefined;
	const rawId = item.deptId;
	const departmentId =
		typeof rawId === "string"
			? rawId
			: typeof rawId === "number" && Number.isSafeInteger(rawId)
				? String(rawId)
				: "";
	const displayName = optionalText(item.deptName);
	if (
		!departmentId ||
		departmentId !== departmentId.trim() ||
		departmentId.length > 128 ||
		!/^[A-Za-z0-9._:-]+$/u.test(departmentId) ||
		!displayName ||
		Array.from(displayName).length > 128
	) {
		return undefined;
	}
	return { departmentId, displayName };
}

function invalidResponse(requestId: string, operation: string): never {
	throw new ProviderRequestError({
		provider: "ai",
		operation,
		message: "Legacy intelligent guide response was invalid",
		requestId,
		retryable: false,
		failureStage: "response",
		responseInvalid: true,
		requestOutcome: "rejected",
	});
}

function normalizeReply(
	value: unknown,
	requestId: string,
	operation: string,
): Omit<IntelligentGuideProviderReply, "trace"> {
	const envelope = record(value) as LegacyGuideEnvelope | undefined;
	if (!envelope) return invalidResponse(requestId, operation);
	if (envelope.code !== 0) {
		throw new ProviderRequestError({
			provider: "ai",
			operation,
			message: "Legacy intelligent guide rejected the request",
			requestId,
			retryable: envelope.code === 5000,
			failureStage: "response",
			requestOutcome: "rejected",
			...(typeof envelope.code === "number" || typeof envelope.code === "string"
				? { providerErrorCode: String(envelope.code) }
				: {}),
		});
	}
	const data = record(envelope.data);
	const providerConversationId = requiredConversationId(data?.conversation_id);
	const progress = data?.progress;
	if (
		!data ||
		!providerConversationId ||
		!Number.isInteger(progress) ||
		(progress as number) < 0 ||
		(progress as number) > 100
	) {
		return invalidResponse(requestId, operation);
	}
	const rawDepartments = data.departments;
	if (
		rawDepartments !== undefined &&
		rawDepartments !== null &&
		!Array.isArray(rawDepartments)
	) {
		return invalidResponse(requestId, operation);
	}
	if (
		Array.isArray(rawDepartments) &&
		rawDepartments.length > MAX_DEPARTMENTS
	) {
		return invalidResponse(requestId, operation);
	}
	const departments = (Array.isArray(rawDepartments) ? rawDepartments : [])
		.map(normalizeDepartment)
		.filter((item): item is IntelligentGuideDepartment => Boolean(item));
	if (
		Array.isArray(rawDepartments) &&
		rawDepartments.some((item) => item !== null) &&
		departments.length === 0
	) {
		return invalidResponse(requestId, operation);
	}
	const message = optionalText(data.message);
	const userInput = optionalText(data.user_input);
	const advice = optionalText(data.advice);
	const summary = optionalText(data.summary);
	if (!message && departments.length === 0 && !advice && !summary) {
		return invalidResponse(requestId, operation);
	}
	return {
		providerConversationId,
		progress: progress as number,
		...(message ? { message } : {}),
		...(userInput ? { userInput } : {}),
		departments,
		...(advice ? { advice } : {}),
		...(summary ? { summary } : {}),
	};
}

/** 旧服务智能导诊 adapter；用户 JWT 只存在于本次服务端请求头。 */
export class LegacyIntelligentGuideApiGateway
	implements IntelligentGuideGateway
{
	private readonly baseUrl: string;
	private readonly fetcher: ProviderFetcher;

	constructor(options: LegacyIntelligentGuideGatewayOptions) {
		this.baseUrl = requiredBaseUrl(options.baseUrl);
		this.fetcher = options.fetcher ?? fetch;
	}

	async chatText(
		input: { message: string; providerConversationId?: string },
		context: AdapterCallContext,
		providerContext: { authorizationToken: string },
	): Promise<IntelligentGuideProviderReply> {
		const response = await requestJson<unknown>(
			{
				provider: "ai",
				operation: GUIDE_TEXT_OPERATION,
				url: `${this.baseUrl}${GUIDE_CHAT_TEXT_PATH}`,
				method: "POST",
				context,
				headers: {
					Authorization: `Bearer ${providerContext.authorizationToken}`,
				},
				body: {
					message: input.message,
					conversation_id: input.providerConversationId ?? null,
				},
				// 症状描述属于医疗自由文本；保留低敏结构/状态审计，不采集原文。
				rawLogging: false,
			},
			this.fetcher,
		);
		return {
			...normalizeReply(
				response.data,
				response.requestId,
				GUIDE_TEXT_OPERATION,
			),
			trace: {
				provider: "ai",
				operation: GUIDE_TEXT_OPERATION,
				requestId: response.requestId,
			},
		};
	}

	async chatAudio(
		input: {
			audio: Uint8Array;
			contentType:
				| "audio/mpeg"
				| "audio/mp4"
				| "audio/aac"
				| "audio/wav"
				| "audio/x-wav"
				| "audio/webm";
			filename: string;
			providerConversationId?: string;
		},
		context: AdapterCallContext,
		providerContext: { authorizationToken: string },
	): Promise<IntelligentGuideProviderReply> {
		const formData = new FormData();
		const audioBytes = new Uint8Array(new ArrayBuffer(input.audio.byteLength));
		audioBytes.set(input.audio);
		formData.append(
			"audio",
			new Blob([audioBytes], { type: input.contentType }),
			input.filename,
		);
		if (input.providerConversationId) {
			formData.append("conversation_id", input.providerConversationId);
		}
		const response = await requestJson<unknown>(
			{
				provider: "ai",
				operation: GUIDE_AUDIO_OPERATION,
				url: `${this.baseUrl}${GUIDE_CHAT_AUDIO_PATH}`,
				method: "POST",
				context,
				headers: {
					Authorization: `Bearer ${providerContext.authorizationToken}`,
				},
				bodyFormData: formData,
				// 音频与识别后的症状文本都属于医疗敏感内容，不采集原文。
				rawLogging: false,
			},
			this.fetcher,
		);
		return {
			...normalizeReply(
				response.data,
				response.requestId,
				GUIDE_AUDIO_OPERATION,
			),
			trace: {
				provider: "ai",
				operation: GUIDE_AUDIO_OPERATION,
				requestId: response.requestId,
			},
		};
	}
}

export function createLegacyIntelligentGuideGateway(
	options: LegacyIntelligentGuideGatewayOptions,
): IntelligentGuideGateway {
	return new LegacyIntelligentGuideApiGateway(options);
}
