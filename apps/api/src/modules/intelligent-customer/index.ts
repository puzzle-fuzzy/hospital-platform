import {
	IntelligentCustomerMessageRequest,
	IntelligentCustomerMessageResponse,
	success,
} from "@hospital/contracts";
import type { IntelligentCustomerApplicationService } from "@hospital/domain";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";
import {
	createInMemoryIntelligentCustomerRateLimiter,
	type IntelligentCustomerRateLimiter,
} from "./rate-limit";

const IntelligentCustomerHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const IntelligentCustomerAudioRequest = t.Object(
	{
		conversationReference: t.Optional(
			t.String({
				minLength: 1,
				maxLength: 128,
				pattern: "^[A-Za-z0-9._:-]+$",
			}),
		),
		audio: t.File({ maxSize: "2m" }),
	},
	{ additionalProperties: false },
);

function uploadedAudioContentType(audio: File): string {
	const supplied = audio.type.trim().toLowerCase();
	if (supplied && supplied !== "application/octet-stream") return supplied;
	const filename = audio.name.toLowerCase();
	if (filename.endsWith(".mp3")) return "audio/mpeg";
	if (filename.endsWith(".m4a") || filename.endsWith(".mp4")) {
		return "audio/mp4";
	}
	if (filename.endsWith(".aac")) return "audio/aac";
	if (filename.endsWith(".wav")) return "audio/wav";
	if (filename.endsWith(".webm")) return "audio/webm";
	return supplied;
}

/**
 * 客服原生 HTTP 模块暂由组合根显式注册；未注册前固定 H5 入口不受影响。
 * 文本和音频共用同一个 owner-scoped 应用服务，音频不复制客服编排逻辑。
 */
export function intelligentCustomerModule(
	service: IntelligentCustomerApplicationService,
	sessions: SessionTokenService,
	options: { rateLimiter?: IntelligentCustomerRateLimiter } = {},
) {
	const authentication = createRequestPrincipalResolver(sessions);
	const rateLimiter =
		options.rateLimiter ?? createInMemoryIntelligentCustomerRateLimiter();
	return new Elysia({ name: "intelligent-customer-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.post(
			"/intelligent-customer/messages",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				rateLimiter.consume(principal.userId);
				return success(
					await service.chatText(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: IntelligentCustomerHeaders,
				body: IntelligentCustomerMessageRequest,
				response: { 200: IntelligentCustomerMessageResponse },
				tags: ["intelligent-customer"],
			},
		)
		.post(
			"/intelligent-customer/audio",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				rateLimiter.consume(principal.userId);
				return success(
					await service.chatAudio(
						principal.userId,
						{
							audio: new Uint8Array(await body.audio.arrayBuffer()),
							contentType: uploadedAudioContentType(body.audio),
							...(body.conversationReference
								? { conversationReference: body.conversationReference }
								: {}),
						},
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: IntelligentCustomerHeaders,
				body: IntelligentCustomerAudioRequest,
				response: { 200: IntelligentCustomerMessageResponse },
				tags: ["intelligent-customer"],
			},
		);
}

export {
	IntelligentCustomerConversationExpiredError,
	IntelligentCustomerInputError,
	NativeIntelligentCustomerService,
	type NativeIntelligentCustomerServiceDependencies,
} from "./native-mvp";
export {
	createInMemoryIntelligentCustomerRateLimiter,
	InMemoryIntelligentCustomerRateLimiter,
	type InMemoryIntelligentCustomerRateLimiterOptions,
	IntelligentCustomerRateLimitError,
	type IntelligentCustomerRateLimiter,
} from "./rate-limit";
