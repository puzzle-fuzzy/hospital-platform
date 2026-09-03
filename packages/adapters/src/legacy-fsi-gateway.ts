import type { AdapterCallContext, ExternalTrace } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import {
	LEGACY_FSI_ROUTES,
	classifyLegacyFsiOrderStatus,
	type LegacyFsiAmountBreakdown,
	LegacyFsiContractError,
	type LegacyFsiFeeUploadCredential,
	type LegacyFsiInfno,
	type LegacyFsiRefundAmounts,
	type LegacyFsiSettlement,
	type LegacyFsiSettlementQuery,
	validate6201FeeUpload,
	validate6201Response,
	validate6202Request,
	validate6202Settlement,
	validate6203Refund,
	validate6203Response,
	validate6301QueryResult,
	validate6301Request,
	validate6401Request,
	validate6401Response,
	unwrapLegacyFsiData,
} from "./legacy-fsi-contract";
import {
	type LegacyFsiCryptoGateway,
	validateLegacyFsiOpenedPayload,
	validateLegacyFsiSealedEnvelope,
} from "./legacy-fsi-crypto";

export type LegacyFsiGatewayOptions = {
	/** 医保中转服务地址；不从请求参数读取。 */
	relayUrl: string;
	/** 6201/6202/6203/6301/6401 共用的移动支付中心 base_url。 */
	directBaseUrl: string;
	/** 旧服务曾硬编码该 Bearer；新实现必须由部署密钥显式注入。 */
	relayAuthorizationToken: string;
	/** 真实 SM2/SM4 实现通过该边界注入，未配置时必须失败。 */
	crypto: LegacyFsiCryptoGateway;
	fetcher?: ProviderFetcher;
};

export type LegacyFsiFeeUploadResult = {
	credential: LegacyFsiFeeUploadCredential;
	/** 6201 返回的真实就诊/医保结算号；未返回时上层必须停止 6202。 */
	mdtrtId?: string;
	totalFen: number;
	trace: ExternalTrace;
};

export type LegacyFsiPaymentOrderResult = {
	settlement: LegacyFsiSettlement;
	/** 3/4/5/6 仅是后置结算候选，不是业务最终成功。 */
	statusClass: ReturnType<typeof classifyLegacyFsiOrderStatus>;
	trace: ExternalTrace;
};

export type LegacyFsiSettlementQueryResult = {
	settlement: LegacyFsiSettlementQuery;
	/** 6301 的状态分类供上层调度查单/后置编排使用。 */
	statusClass: ReturnType<typeof classifyLegacyFsiOrderStatus>;
	trace: ExternalTrace;
};

export type LegacyFsiRefundResult = {
	refund: LegacyFsiRefundAmounts;
	refStatus: "SUCC" | "FAIL" | "EXP";
	trace: ExternalTrace;
};

export type LegacyFsiRevokeResult = {
	message: string;
	trace: ExternalTrace;
};

export type LegacyFsiGateway = {
	uploadFees(
		data: Record<string, unknown>,
		context: AdapterCallContext,
	): Promise<LegacyFsiFeeUploadResult>;
	createPaymentOrder(
		data: Record<string, unknown>,
		context: AdapterCallContext,
	): Promise<LegacyFsiPaymentOrderResult>;
	querySettlement(
		data: Record<string, unknown>,
		context: AdapterCallContext,
	): Promise<LegacyFsiSettlementQueryResult>;
	refund(
		data: Record<string, unknown>,
		original: LegacyFsiAmountBreakdown,
		context: AdapterCallContext,
	): Promise<LegacyFsiRefundResult>;
	revoke(
		data: Record<string, unknown>,
		context: AdapterCallContext,
	): Promise<LegacyFsiRevokeResult>;
};

function assertUrl(value: string, name: string): string {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw new Error();
		return value.replace(/\/$/, "");
	} catch {
		throw new Error(`${name} must be an absolute http(s) URL`);
	}
}

function providerResponseError(
	infno: LegacyFsiInfno,
	message: string,
	requestId: string,
	cause: unknown,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "legacy-fsi",
		operation: `legacy-fsi.${infno}`,
		message,
		requestId,
		retryable: false,
		failureStage: "response",
		responseInvalid: true,
		cause,
	});
}

function asRecord(
	value: unknown,
	infno: LegacyFsiInfno,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new LegacyFsiContractError(infno, "relay response must be an object");
	}
	return value as Record<string, unknown>;
}

function trace(infno: LegacyFsiInfno, requestId: string): ExternalTrace {
	return {
		provider: "legacy-fsi",
		operation: `legacy-fsi.${infno}`,
		requestId,
	};
}

/**
 * 受控的旧医保 FSI 移动支付传输适配器。
 *
 * 该类只负责“固定路由、严格加密 envelope、严格响应映射”。它不接受公共
 * HTTP 的任意 path/infno，也不把 provider 凭证保存到订单、日志或小程序。
 * 真正的医保订单编排仍需另一个 owner-scoped service 和持久化模型接入。
 */
export function createLegacyFsiGateway(
	options: LegacyFsiGatewayOptions,
): LegacyFsiGateway {
	const relayUrl = assertUrl(options.relayUrl, "relayUrl");
	const directBaseUrl = assertUrl(options.directBaseUrl, "directBaseUrl");
	if (!options.relayAuthorizationToken.trim()) {
		throw new AdapterNotConfiguredError("legacy-fsi");
	}
	const fetcher = options.fetcher;

	const call = async (
		infno: LegacyFsiInfno,
		data: Record<string, unknown>,
		context: AdapterCallContext,
	): Promise<{ data: Record<string, unknown>; requestId: string }> => {
		const sealed = await options.crypto.seal({ infno, data }, context);
		const envelope = validateLegacyFsiSealedEnvelope(sealed, infno);
		const response = await requestJson<unknown>(
			{
				provider: "legacy-fsi",
				operation: `legacy-fsi.${infno}`,
				url: relayUrl,
				method: "POST",
				context,
				headers: {
					authorization: `Bearer ${options.relayAuthorizationToken}`,
				},
				body: {
					method: "POST",
					base_url: directBaseUrl,
					path: LEGACY_FSI_ROUTES[infno].path,
					headers: { "content-type": "application/json" },
					body: envelope,
				},
			},
			fetcher,
		);

		try {
			const opened = await options.crypto.open(
				{ infno, response: asRecord(response.data, infno) },
				context,
			);
			return {
				data: validateLegacyFsiOpenedPayload(opened, infno).data,
				requestId: response.requestId,
			};
		} catch (error) {
			if (error instanceof AdapterNotConfiguredError) throw error;
			if (error instanceof ProviderRequestError) throw error;
			throw providerResponseError(
				infno,
				"Legacy FSI response could not be verified or opened",
				response.requestId,
				error,
			);
		}
	};

	return {
		async uploadFees(data, context) {
			const { totalFen } = validate6201FeeUpload(data);
			const response = await call("6201", data, context);
			const credential = validate6201Response(response.data);
			const payload = unwrapLegacyFsiData(response.data, "6201");
			const mdtrtId =
				typeof payload.mdtrtId === "string" && payload.mdtrtId.trim()
					? payload.mdtrtId.trim()
					: typeof payload.mdtrt_id === "string" && payload.mdtrt_id.trim()
						? payload.mdtrt_id.trim()
						: undefined;
			return {
				credential,
				...(mdtrtId ? { mdtrtId } : {}),
				totalFen,
				trace: trace("6201", response.requestId),
			};
		},
		async createPaymentOrder(data, context) {
			validate6202Request(data);
			const response = await call("6202", data, context);
			const settlement = validate6202Settlement(
				response.data,
				String(data.payOrdId),
			);
			return {
				settlement,
				statusClass: classifyLegacyFsiOrderStatus(settlement.ordStas),
				trace: {
					...trace("6202", response.requestId),
					providerOrderId: settlement.payOrdId,
				},
			};
		},
		async querySettlement(data, context) {
			validate6301Request(data);
			const response = await call("6301", data, context);
			const settlement = validate6301QueryResult(
				response.data,
				String(data.payOrdId),
			);
			return {
				settlement,
				statusClass: classifyLegacyFsiOrderStatus(settlement.ordStas),
				trace: {
					...trace("6301", response.requestId),
					providerOrderId: settlement.payOrdId,
				},
			};
		},
		async refund(data, original, context) {
			const refund = validate6203Refund(data, original);
			const response = await call("6203", data, context);
			return {
				refund,
				refStatus: validate6203Response(response.data),
				trace: trace("6203", response.requestId),
			};
		},
		async revoke(data, context) {
			validate6401Request(data);
			const response = await call("6401", data, context);
			return {
				message: validate6401Response(response.data).message,
				trace: trace("6401", response.requestId),
			};
		},
	};
}
