import {
	IntelligentGuideMessageRequest,
	IntelligentGuideMessageResponse,
	success,
} from "@hospital/contracts";
import type { IntelligentGuideApplicationService } from "@hospital/domain";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";

const IntelligentGuideHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const IntelligentGuideAudioRequest = t.Object(
	{
		legacyLoginCode: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
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

export function intelligentGuideModule(
	service: IntelligentGuideApplicationService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "intelligent-guide-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.post(
			"/intelligent-guide/messages",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await service.chatText(
						principal.userId,
						body,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: IntelligentGuideHeaders,
				body: IntelligentGuideMessageRequest,
				response: { 200: IntelligentGuideMessageResponse },
				tags: ["intelligent-guide"],
			},
		)
		.post(
			"/intelligent-guide/audio",
			async ({ request, headers, body }) => {
				const principal = await authentication.get(request);
				return success(
					await service.chatAudio(
						principal.userId,
						{
							...(body.legacyLoginCode
								? { legacyLoginCode: body.legacyLoginCode }
								: {}),
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
				headers: IntelligentGuideHeaders,
				body: IntelligentGuideAudioRequest,
				response: { 200: IntelligentGuideMessageResponse },
				tags: ["intelligent-guide"],
			},
		);
}

export {
	NativeIntelligentGuideService,
	type NativeIntelligentGuideServiceDependencies,
} from "./native-mvp";
export {
	IntelligentGuideConversationExpiredError,
	IntelligentGuideInputError,
	IntelligentGuideService,
} from "./service";
