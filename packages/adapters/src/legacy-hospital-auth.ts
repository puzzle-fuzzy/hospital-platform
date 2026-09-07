import type {
	AdapterCallContext,
	ExternalTrace,
	PatientProviderAuthorizationGateway,
} from "@hospital/domain";
import { ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";

const LEGACY_WECHAT_LOGIN_PATH = "/system/auth/login/wechat";
const MAX_LEGACY_TOKEN_LENGTH = 4096;

type LegacyLoginEnvelope = {
	code?: unknown;
	data?: unknown;
	msg?: unknown;
	success?: unknown;
};

type LegacyLoginData = {
	access_token?: unknown;
	user?: unknown;
};

export type LegacyHospitalPatientAuthGatewayOptions = {
	/** 旧服务端 API 根地址，例如 https://test-hp.meiyi.pro/api/v1。 */
	baseUrl: string;
	fetcher?: ProviderFetcher;
};

function requiredBaseUrl(value: string): string {
	const normalized = value.trim().replace(/\/+$/u, "");
	if (!normalized) throw new Error("Legacy hospital auth base URL is required");
	return normalized;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function safeToken(value: unknown, requestId: string): string {
	if (
		typeof value !== "string" ||
		!value.trim() ||
		value !== value.trim() ||
		value.length > MAX_LEGACY_TOKEN_LENGTH ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw new ProviderRequestError({
			provider: "hospital-his",
			operation: "legacy-wechat-login",
			message: "Legacy hospital login did not return a valid access token",
			requestId,
			retryable: false,
			failureStage: "response",
			responseInvalid: true,
		});
	}
	return value;
}

function optionalUnionId(value: unknown): string | undefined {
	if (value === undefined || value === null || typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	if (
		!normalized ||
		Array.from(normalized).length > 128 ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		return undefined;
	}
	return normalized;
}

function trace(requestId: string): ExternalTrace {
	return {
		provider: "hospital-his",
		operation: "legacy-wechat-login",
		requestId,
	};
}

/**
 * 迁移旧服务端的微信登录步骤：旧服务端负责 code2session、查/建用户并签发
 * JWT；新 API 只消费这个短期用户凭证，再由服务端直连众阳执行患者绑定。
 */
export class LegacyHospitalPatientAuthApiGateway
	implements PatientProviderAuthorizationGateway
{
	private readonly baseUrl: string;
	private readonly fetcher: ProviderFetcher;

	constructor(options: LegacyHospitalPatientAuthGatewayOptions) {
		this.baseUrl = requiredBaseUrl(options.baseUrl);
		this.fetcher = options.fetcher ?? fetch;
	}

	async exchangeWechatCode(
		input: { code: string },
		context: AdapterCallContext,
	): Promise<{
		authorizationToken: string;
		unionId?: string;
		trace: ExternalTrace;
	}> {
		const code = typeof input.code === "string" ? input.code : "";
		if (
			!code ||
			code !== code.trim() ||
			Array.from(code).length > 256 ||
			Array.from(code).some((character) => {
				const codePoint = character.charCodeAt(0);
				return codePoint <= 0x1f || codePoint === 0x7f;
			})
		) {
			throw new ProviderRequestError({
				provider: "hospital-his",
				operation: "legacy-wechat-login",
				message: "Legacy hospital login code is invalid",
				retryable: false,
				failureStage: "validation",
				responseInvalid: true,
			});
		}

		const url = new URL(LEGACY_WECHAT_LOGIN_PATH.slice(1), `${this.baseUrl}/`);
		const response = await requestJson<unknown>(
			{
				provider: "hospital-his",
				operation: "legacy-wechat-login",
				url: url.toString(),
				method: "POST",
				context,
				body: {
					code,
					login_type: "小程序端",
					auto_register: true,
				},
			},
			this.fetcher,
		);

		const envelope = objectValue(response.data) as
			| LegacyLoginEnvelope
			| undefined;
		if (envelope?.success !== true || envelope.code !== 0) {
			throw new ProviderRequestError({
				provider: "hospital-his",
				operation: "legacy-wechat-login",
				message: "Legacy hospital login was rejected",
				requestId: response.requestId,
				retryable: false,
				failureStage: "response",
				...(typeof envelope?.code === "string" ||
				typeof envelope?.code === "number"
					? { providerErrorCode: String(envelope.code) }
					: {}),
			});
		}

		const data = objectValue(envelope.data) as LegacyLoginData | undefined;
		if (!data) {
			throw new ProviderRequestError({
				provider: "hospital-his",
				operation: "legacy-wechat-login",
				message: "Legacy hospital login response was invalid",
				requestId: response.requestId,
				retryable: false,
				failureStage: "response",
				responseInvalid: true,
			});
		}

		const user = objectValue(data.user);
		const unionId =
			optionalUnionId(user?.unionid) ?? optionalUnionId(user?.unionId);
		return {
			authorizationToken: safeToken(data.access_token, response.requestId),
			...(unionId ? { unionId } : {}),
			trace: trace(response.requestId),
		};
	}
}

export function createLegacyHospitalPatientAuthGateway(
	options: LegacyHospitalPatientAuthGatewayOptions,
): PatientProviderAuthorizationGateway {
	return new LegacyHospitalPatientAuthApiGateway(options);
}
