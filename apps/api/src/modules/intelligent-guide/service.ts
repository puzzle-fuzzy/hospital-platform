import type {
	IntelligentGuideMessageRequestPayload,
	IntelligentGuideMessageResponsePayload,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	IntelligentGuideApplicationService,
	IntelligentGuideConversationStore,
	IntelligentGuideGateway,
	PatientProviderAuthorizationGateway,
	UserIdentityRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES,
	INTELLIGENT_GUIDE_AUDIO_MAX_BYTES,
	INTELLIGENT_GUIDE_AUDIO_MIN_BYTES,
	INTELLIGENT_GUIDE_CONVERSATION_TTL_SECONDS,
	INTELLIGENT_GUIDE_MESSAGE_MAX_CODE_POINTS,
	isBoundedOpaqueIdentifier,
	normalizeAdapterCallContext,
	normalizeIdentityUserReadModel,
} from "@hospital/domain";
import { type AppLogger, createNoopLogger } from "@hospital/observability";

const GUIDE_DISCLAIMER =
	"智能导诊仅用于推荐可能合适的门诊科室，不能替代医生诊断；如有急危重症，请立即就医或拨打 120。";
const CONVERSATION_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]+$/u;

export class IntelligentGuideInputError extends Error {
	constructor() {
		super("Intelligent guide input is invalid");
		this.name = "IntelligentGuideInputError";
	}
}

export class IntelligentGuideConversationExpiredError extends Error {
	constructor() {
		super("Intelligent guide conversation is unavailable");
		this.name = "IntelligentGuideConversationExpiredError";
	}
}

export type IntelligentGuideServiceDependencies = {
	identityUsers: UserIdentityRepository;
	providerAuthorizationGateway: PatientProviderAuthorizationGateway;
	guideGateway: IntelligentGuideGateway;
	conversations: IntelligentGuideConversationStore;
	logger?: AppLogger;
};

type NormalizedMessageInput = {
	legacyLoginCode: string;
	message: string;
	conversationReference?: string;
};

function invalid(): never {
	throw new IntelligentGuideInputError();
}

function requireOwner(value: unknown): string {
	if (!isBoundedOpaqueIdentifier(value)) return invalid();
	return value;
}

function normalizeInput(value: unknown): NormalizedMessageInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return invalid();
	}
	const input = value as Record<string, unknown>;
	if (
		Object.keys(input).some(
			(key) =>
				key !== "legacyLoginCode" &&
				key !== "message" &&
				key !== "conversationReference",
		)
	) {
		return invalid();
	}
	const legacyLoginCode = input.legacyLoginCode;
	const rawMessage = input.message;
	if (
		typeof legacyLoginCode !== "string" ||
		!legacyLoginCode ||
		legacyLoginCode !== legacyLoginCode.trim() ||
		legacyLoginCode.length > 256 ||
		Array.from(legacyLoginCode).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		}) ||
		typeof rawMessage !== "string"
	) {
		return invalid();
	}
	const message = rawMessage.trim();
	if (
		!message ||
		Array.from(message).length > INTELLIGENT_GUIDE_MESSAGE_MAX_CODE_POINTS ||
		Array.from(message).some((character) => {
			const code = character.charCodeAt(0);
			return (code <= 0x1f && code !== 0x0a && code !== 0x0d) || code === 0x7f;
		})
	) {
		return invalid();
	}
	const conversationReference = input.conversationReference;
	if (
		conversationReference !== undefined &&
		(typeof conversationReference !== "string" ||
			!isBoundedOpaqueIdentifier(conversationReference) ||
			!CONVERSATION_REFERENCE_PATTERN.test(conversationReference))
	) {
		return invalid();
	}
	return {
		legacyLoginCode,
		message,
		...(conversationReference ? { conversationReference } : {}),
	};
}

export type IntelligentGuideAudioServiceInput = {
	legacyLoginCode?: string;
	audio: Uint8Array;
	contentType: string;
	conversationReference?: string;
};

type NormalizedGuideSessionInput = {
	legacyLoginCode: string;
	conversationReference?: string;
};

function normalizeGuideSessionInput(input: {
	legacyLoginCode?: unknown;
	conversationReference?: unknown;
}): NormalizedGuideSessionInput {
	const legacyLoginCode = input.legacyLoginCode;
	if (
		typeof legacyLoginCode !== "string" ||
		!legacyLoginCode ||
		legacyLoginCode !== legacyLoginCode.trim() ||
		legacyLoginCode.length > 256 ||
		Array.from(legacyLoginCode).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		return invalid();
	}
	const conversationReference = input.conversationReference;
	if (
		conversationReference !== undefined &&
		(typeof conversationReference !== "string" ||
			!isBoundedOpaqueIdentifier(conversationReference) ||
			!CONVERSATION_REFERENCE_PATTERN.test(conversationReference))
	) {
		return invalid();
	}
	return {
		legacyLoginCode,
		...(conversationReference ? { conversationReference } : {}),
	};
}

function normalizeAudioInput(value: IntelligentGuideAudioServiceInput): Omit<
	IntelligentGuideAudioServiceInput,
	"legacyLoginCode"
> & {
	legacyLoginCode: string;
	contentType: (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number];
	filename: string;
} {
	const session = normalizeGuideSessionInput(value);
	if (
		!(value.audio instanceof Uint8Array) ||
		value.audio.byteLength < INTELLIGENT_GUIDE_AUDIO_MIN_BYTES ||
		value.audio.byteLength > INTELLIGENT_GUIDE_AUDIO_MAX_BYTES ||
		typeof value.contentType !== "string" ||
		!INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES.includes(
			value.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number],
		)
	) {
		return invalid();
	}
	const contentType =
		value.contentType as (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number];
	const extension =
		contentType === "audio/mpeg"
			? "mp3"
			: contentType === "audio/mp4" || contentType === "audio/aac"
				? "m4a"
				: contentType.includes("wav")
					? "wav"
					: "webm";
	return {
		...session,
		audio: value.audio,
		contentType,
		filename: `voice.${extension}`,
	};
}

function requireContext(value: unknown): AdapterCallContext {
	const context = normalizeAdapterCallContext(value);
	if (!context) return invalid();
	return context;
}

/**
 * 智能导诊编排：平台会话确认 owner，新的微信 code 换旧服务 JWT，Redis 只
 * 保存 owner-scoped 会话映射。任何旧凭证和 provider conversation_id 都不会
 * 下发到小程序。
 */
export class IntelligentGuideService
	implements IntelligentGuideApplicationService
{
	private readonly logger: AppLogger;

	constructor(
		private readonly dependencies: IntelligentGuideServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
	}

	private async prepareProviderSession(
		owner: string,
		request: NormalizedGuideSessionInput,
		traceContext: AdapterCallContext,
	): Promise<{
		providerConversationId?: string;
		authorizationToken: string;
	}> {
		let providerConversationId: string | undefined;
		if (request.conversationReference) {
			providerConversationId =
				await this.dependencies.conversations.findProviderConversationId({
					ownerUserId: owner,
					conversationReference: request.conversationReference,
				});
			if (!providerConversationId) {
				throw new IntelligentGuideConversationExpiredError();
			}
		}

		const currentIdentity = normalizeIdentityUserReadModel(
			await this.dependencies.identityUsers.findByUserId(owner),
			{ expectedUserId: owner },
		);
		const legacyIdentity =
			await this.dependencies.providerAuthorizationGateway.exchangeWechatCode(
				{ code: request.legacyLoginCode },
				traceContext,
			);
		if (
			!currentIdentity.unionId ||
			!legacyIdentity.unionId ||
			currentIdentity.unionId !== legacyIdentity.unionId
		) {
			return invalid();
		}
		return {
			...(providerConversationId ? { providerConversationId } : {}),
			authorizationToken: legacyIdentity.authorizationToken,
		};
	}

	private async completeReply(
		owner: string,
		conversationReference: string | undefined,
		reply: Awaited<ReturnType<IntelligentGuideGateway["chatText"]>>,
	): Promise<IntelligentGuideMessageResponsePayload["data"]> {
		const publicReference = conversationReference ?? crypto.randomUUID();
		await this.dependencies.conversations.save({
			ownerUserId: owner,
			conversationReference: publicReference,
			providerConversationId: reply.providerConversationId,
			expiresInSeconds: INTELLIGENT_GUIDE_CONVERSATION_TTL_SECONDS,
		});
		return {
			conversationReference: publicReference,
			progress: reply.progress,
			...(reply.message ? { message: reply.message } : {}),
			...(reply.userInput ? { userInput: reply.userInput } : {}),
			departments: [...reply.departments],
			...(reply.advice ? { advice: reply.advice } : {}),
			...(reply.summary ? { summary: reply.summary } : {}),
			disclaimer: GUIDE_DISCLAIMER,
		};
	}

	async chatText(
		ownerUserId: string,
		input: IntelligentGuideMessageRequestPayload,
		context: AdapterCallContext,
	): Promise<IntelligentGuideMessageResponsePayload["data"]> {
		const owner = requireOwner(ownerUserId);
		const request = normalizeInput(input);
		const traceContext = requireContext(context);
		const providerSession = await this.prepareProviderSession(
			owner,
			request,
			traceContext,
		);

		const reply = await this.dependencies.guideGateway.chatText(
			{
				message: request.message,
				...(providerSession.providerConversationId
					? { providerConversationId: providerSession.providerConversationId }
					: {}),
			},
			traceContext,
			{ authorizationToken: providerSession.authorizationToken },
		);

		this.logger.info(
			{
				event: "intelligent-guide.message.completed",
				traceId: adapterContextTraceId(traceContext),
				userId: owner,
				providerRequestId: reply.trace.requestId,
				messageCodePointLength: Array.from(request.message).length,
				progress: reply.progress,
				departmentCount: reply.departments.length,
				conversationContinued: Boolean(request.conversationReference),
			},
			"Intelligent guide message completed",
		);

		return this.completeReply(owner, request.conversationReference, reply);
	}

	async chatAudio(
		ownerUserId: string,
		input: IntelligentGuideAudioServiceInput,
		context: AdapterCallContext,
	): Promise<IntelligentGuideMessageResponsePayload["data"]> {
		const owner = requireOwner(ownerUserId);
		const request = normalizeAudioInput(input);
		const traceContext = requireContext(context);
		const providerSession = await this.prepareProviderSession(
			owner,
			request,
			traceContext,
		);
		const reply = await this.dependencies.guideGateway.chatAudio(
			{
				audio: request.audio,
				contentType: request.contentType,
				filename: request.filename,
				...(providerSession.providerConversationId
					? { providerConversationId: providerSession.providerConversationId }
					: {}),
			},
			traceContext,
			{ authorizationToken: providerSession.authorizationToken },
		);

		this.logger.info(
			{
				event: "intelligent-guide.audio.completed",
				traceId: adapterContextTraceId(traceContext),
				userId: owner,
				providerRequestId: reply.trace.requestId,
				audioByteLength: request.audio.byteLength,
				progress: reply.progress,
				departmentCount: reply.departments.length,
				conversationContinued: Boolean(request.conversationReference),
			},
			"Intelligent guide audio completed",
		);

		return this.completeReply(owner, request.conversationReference, reply);
	}
}
