import type { AdapterCallContext } from "@hospital/domain";
import { AdapterNotConfiguredError } from "./errors";
import {
	LegacyFsiContractError,
	type LegacyFsiInfno,
} from "./legacy-fsi-contract";

/**
 * 旧医保中转服务的密文 envelope contract。
 *
 * 这里只定义协议形状，不假设具体 SM2 userId、SM4 key 派生和 padding 实现；
 * 这些参数必须由 golden vector 验证后注入 crypto adapter。
 */
export type LegacyFsiSealedEnvelope = {
	appId: string;
	encType: "SM4";
	signType: "SM2";
	version: string;
	/** 旧实现为 yyyyMMddHHmmss 字符串，官方 SDK 为 13 位毫秒数。 */
	timestamp: string | number;
	encData: string;
	signData: string;
};

/** 回包是否通过平台签名校验；非严格联调模式允许为 false，但必须被日志标记。 */
export type LegacyFsiOpenedPayload = {
	data: Record<string, unknown>;
	signVerified: boolean;
};

export interface LegacyFsiCryptoGateway {
	seal(
		input: {
			infno: LegacyFsiInfno;
			data: Record<string, unknown>;
		},
		context: AdapterCallContext,
	): Promise<LegacyFsiSealedEnvelope>;
	open(
		input: {
			infno: LegacyFsiInfno;
			response: Record<string, unknown>;
		},
		context: AdapterCallContext,
	): Promise<LegacyFsiOpenedPayload>;
}

function objectValue(
	value: unknown,
	infno: LegacyFsiInfno,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new LegacyFsiContractError(infno, "crypto result must be an object");
	}
	return value as Record<string, unknown>;
}

function requiredString(
	payload: Record<string, unknown>,
	fieldName: string,
	infno: LegacyFsiInfno,
): string {
	const value = payload[fieldName];
	if (typeof value !== "string" || !value.trim()) {
		throw new LegacyFsiContractError(
			infno,
			`crypto envelope field ${fieldName} is required`,
		);
	}
	return value.trim();
}

export function validateLegacyFsiSealedEnvelope(
	value: unknown,
	infno: LegacyFsiInfno,
): LegacyFsiSealedEnvelope {
	const payload = objectValue(value, infno);
	const encType = requiredString(payload, "encType", infno);
	const signType = requiredString(payload, "signType", infno);
	if (encType !== "SM4" || signType !== "SM2") {
		throw new LegacyFsiContractError(
			infno,
			"crypto envelope must use the agreed SM4/SM2 algorithms",
		);
	}
	const rawTimestamp = payload.timestamp;
	const timestamp =
		typeof rawTimestamp === "number" &&
		Number.isSafeInteger(rawTimestamp) &&
		rawTimestamp > 0
			? rawTimestamp
			: requiredString(payload, "timestamp", infno);
	if (
		(typeof timestamp === "string" &&
			!/^\d{14}$/.test(timestamp) &&
			!/^\d{13}$/.test(timestamp)) ||
		(typeof timestamp === "number" && String(timestamp).length !== 13)
	) {
		throw new LegacyFsiContractError(
			infno,
			"crypto envelope timestamp must use yyyyMMddHHmmss or 13-digit milliseconds",
		);
	}
	return {
		appId: requiredString(payload, "appId", infno),
		encType: "SM4",
		signType: "SM2",
		version: requiredString(payload, "version", infno),
		timestamp,
		encData: requiredString(payload, "encData", infno),
		signData: requiredString(payload, "signData", infno),
	};
}

export function validateLegacyFsiOpenedPayload(
	value: unknown,
	infno: LegacyFsiInfno,
	options: { allowUnverified?: boolean } = {},
): LegacyFsiOpenedPayload {
	const payload = objectValue(value, infno);
	if (payload.signVerified !== true && !options.allowUnverified) {
		throw new LegacyFsiContractError(
			infno,
			"crypto response must have signVerified=true",
		);
	}
	return {
		data: objectValue(payload.data, infno),
		signVerified: payload.signVerified === true,
	};
}

export function createNotConfiguredLegacyFsiCrypto(): LegacyFsiCryptoGateway {
	const unavailable = async (): Promise<never> => {
		throw new AdapterNotConfiguredError("legacy-fsi");
	};
	return {
		seal: unavailable,
		open: unavailable,
	};
}
