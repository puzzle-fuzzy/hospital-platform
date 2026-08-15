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
	timestamp: string;
	encData: string;
	signData: string;
};

/** 严格模式下，未验签 payload 不能进入业务 mapper 或状态机。 */
export type LegacyFsiOpenedPayload = {
	data: Record<string, unknown>;
	signVerified: true;
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
	const timestamp = requiredString(payload, "timestamp", infno);
	if (!/^\d{14}$/.test(timestamp)) {
		throw new LegacyFsiContractError(
			infno,
			"crypto envelope timestamp must use yyyyMMddHHmmss",
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
): LegacyFsiOpenedPayload {
	const payload = objectValue(value, infno);
	if (payload.signVerified !== true) {
		throw new LegacyFsiContractError(
			infno,
			"crypto response must have signVerified=true",
		);
	}
	return {
		data: objectValue(payload.data, infno),
		signVerified: true,
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
