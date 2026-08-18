import type {
	AdapterCallContext,
	ExternalTrace,
	WechatIdentityGateway,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const DEFAULT_WECHAT_IDENTITY_BASE_URL = "https://api.weixin.qq.com";
const WECHAT_CODE2SESSION_PATH = "/sns/jscode2session";
const AUTHORIZATION_GRANT_TYPE = "authorization_code";
/** 微信身份标识只在服务端短暂流转，不能把异常长文本带入身份仓储。 */
const MAX_WECHAT_IDENTITY_LENGTH = 128;

type WechatCode2SessionResponse = {
	openid?: unknown;
	unionid?: unknown;
	session_key?: unknown;
	errcode?: unknown;
	errmsg?: unknown;
};

export type WechatIdentityGatewayOptions = {
	/** 小程序 AppID；只在服务端配置，不能进入请求日志或客户端响应。 */
	appId: string;
	/** 小程序 AppSecret；只拼接到 provider 请求，不离开 adapter。 */
	appSecret: string;
	/** 默认使用微信官方 API 域名；本地 contract 测试可注入 mock origin。 */
	baseUrl?: string;
	fetcher?: ProviderFetcher;
};

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new AdapterNotConfiguredError("wechat-identity");
	}
	return normalized;
}

function providerError(input: {
	message: string;
	retryable: boolean;
	requestId?: string;
}): ProviderRequestError {
	return new ProviderRequestError({
		provider: "wechat-identity",
		operation: "code2session",
		message: input.message,
		retryable: input.retryable,
		...(input.requestId ? { requestId: input.requestId } : {}),
	});
}

function numericErrorCode(value: unknown): number | undefined {
	const code = typeof value === "number" ? value : Number(value);
	return Number.isInteger(code) ? code : undefined;
}

function isRetryableWechatError(code: number | undefined): boolean {
	// -1 为系统繁忙，45011 为频率限制；40029 等 code 无效错误不能盲目重试。
	return code === -1 || code === 45011;
}

function identityTrace(requestId: string): ExternalTrace {
	return {
		provider: "wechat-identity",
		operation: "code2session",
		requestId,
	};
}

/**
 * 严格收窄微信返回的身份字符串。
 *
 * `openid`/`unionid` 是后续 owner 映射的身份主键；如果只判断 openid 非空，
 * 控制字符或异常长值可能进入 MySQL，`unionid` 的错误类型还会被静默忽略，
 * 最终表现为“登录成功但患者同步没有身份”。这里不猜测 provider 的字符集，
 * 只拒绝空白、控制字符、超长值和非字符串；字段异常必须整次登录失败，不能
 * 降级成另一个身份或把不完整身份当作成功事实。
 */
function normalizeWechatIdentityValue(
	value: unknown,
	field: "openid" | "unionid",
	requestId: string,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") {
		throw providerError({
			message: `Wechat code2session ${field} is invalid`,
			retryable: false,
			requestId,
		});
	}
	const normalized = value.trim();
	if (
		!normalized ||
		Array.from(normalized).length > MAX_WECHAT_IDENTITY_LENGTH ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw providerError({
			message: `Wechat code2session ${field} is invalid`,
			retryable: false,
			requestId,
		});
	}
	return normalized;
}

/**
 * 微信小程序 code2session 的真实 adapter。
 *
 * adapter 只返回 openid/unionid 的平台身份映射，不把 session_key 放进
 * domain、日志、事件或 API 响应；AuthService 再把 provider subject 映射
 * 成内部 userId。官方接口是 GET /sns/jscode2session，grant_type 固定为
 * authorization_code。
 */
export class WechatIdentityApiGateway implements WechatIdentityGateway {
	private readonly appId: string;
	private readonly appSecret: string;
	private readonly baseUrl: string;
	private readonly fetcher: ProviderFetcher;

	constructor(options: WechatIdentityGatewayOptions) {
		this.appId = requiredConfig(options.appId);
		this.appSecret = requiredConfig(options.appSecret);
		this.baseUrl = options.baseUrl ?? DEFAULT_WECHAT_IDENTITY_BASE_URL;
		this.fetcher = options.fetcher ?? fetch;
	}

	async exchangeCode(
		input: { code: string },
		context: AdapterCallContext,
	): Promise<{
		providerSubject: string;
		unionId?: string;
		trace: ExternalTrace;
	}> {
		const code = typeof input.code === "string" ? input.code.trim() : "";
		if (!code || code.length > 256) {
			throw providerError({
				message: "Wechat login code is invalid",
				retryable: false,
			});
		}

		const url = new URL(WECHAT_CODE2SESSION_PATH, this.baseUrl);
		url.searchParams.set("appid", this.appId);
		url.searchParams.set("secret", this.appSecret);
		url.searchParams.set("js_code", code);
		url.searchParams.set("grant_type", AUTHORIZATION_GRANT_TYPE);

		const response = await requestJson<WechatCode2SessionResponse>(
			{
				provider: "wechat-identity",
				operation: "code2session",
				url: url.toString(),
				method: "GET",
				context,
			},
			this.fetcher,
		);
		const errorCode = numericErrorCode(response.data.errcode);
		if (errorCode !== undefined && errorCode !== 0) {
			throw new ProviderRequestError({
				provider: "wechat-identity",
				operation: "code2session",
				message: `Wechat code2session failed with provider code ${errorCode}`,
				retryable: isRetryableWechatError(errorCode),
				requestId: response.requestId,
			});
		}

		const providerSubject = normalizeWechatIdentityValue(
			response.data.openid,
			"openid",
			response.requestId,
		);
		if (!providerSubject) {
			throw providerError({
				message: "Wechat code2session response did not contain openid",
				retryable: false,
				requestId: response.requestId,
			});
		}

		const unionId = normalizeWechatIdentityValue(
			response.data.unionid,
			"unionid",
			response.requestId,
		);
		return {
			providerSubject,
			...(unionId ? { unionId } : {}),
			trace: identityTrace(response.requestId),
		};
	}
}

export function createWechatIdentityGateway(
	options: WechatIdentityGatewayOptions,
): WechatIdentityGateway {
	return new WechatIdentityApiGateway(options);
}
