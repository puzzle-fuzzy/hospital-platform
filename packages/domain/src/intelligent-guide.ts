import type { AdapterCallContext } from "./ports";
import type { ExternalTrace } from "./ports";

/** 智能导诊只接受旧服务已经定义的短文本边界。 */
export const INTELLIGENT_GUIDE_MESSAGE_MAX_CODE_POINTS = 50;

/** 原生录音固定为最多 60 秒；服务端再以字节上限阻断异常或伪造上传。 */
export const INTELLIGENT_GUIDE_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

/** 过短的录音不进入语音识别服务，避免误触产生无意义的医疗会话。 */
export const INTELLIGENT_GUIDE_AUDIO_MIN_BYTES = 128;

export const INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES = [
	"audio/mpeg",
	"audio/mp4",
	"audio/aac",
	"audio/wav",
	"audio/x-wav",
	"audio/webm",
] as const;

/** 一次导诊会话在旧服务 Redis 中保存七天；平台引用不得超过旧事实有效期。 */
export const INTELLIGENT_GUIDE_CONVERSATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type IntelligentGuideDepartment = {
	/** 旧服务返回的排班科室引用；只允许服务端 adapter 产生。 */
	departmentId: string;
	displayName: string;
};

export type IntelligentGuideProviderReply = {
	providerConversationId: string;
	progress: number;
	message?: string;
	/** 语音入口由旧服务语音识别产生；文字入口通常不返回。 */
	userInput?: string;
	departments: readonly IntelligentGuideDepartment[];
	advice?: string;
	summary?: string;
	trace: ExternalTrace;
};

/**
 * 旧智能导诊接口只在服务端调用。
 *
 * authorizationToken 是本次 wx.login code 换得的旧服务短期用户凭证，不能
 * 进入小程序响应、平台会话、持久化映射或日志字段。
 */
export interface IntelligentGuideGateway {
	chatText(
		input: {
			message: string;
			providerConversationId?: string;
		},
		context: AdapterCallContext,
		providerContext: { authorizationToken: string },
	): Promise<IntelligentGuideProviderReply>;
	chatAudio(
		input: {
			audio: Uint8Array;
			contentType: (typeof INTELLIGENT_GUIDE_AUDIO_CONTENT_TYPES)[number];
			filename: string;
			providerConversationId?: string;
		},
		context: AdapterCallContext,
		providerContext: { authorizationToken: string },
	): Promise<IntelligentGuideProviderReply>;
}

/**
 * 小程序只持有平台生成的会话引用；Redis 映射负责绑定 owner 和旧会话 ID。
 * 这样即使拿到另一位用户的旧 conversation_id，也不能跨用户恢复对话。
 */
export interface IntelligentGuideConversationStore {
	findProviderConversationId(input: {
		ownerUserId: string;
		conversationReference: string;
	}): Promise<string | undefined>;
	save(input: {
		ownerUserId: string;
		conversationReference: string;
		providerConversationId: string;
		expiresInSeconds: number;
	}): Promise<void>;
}
