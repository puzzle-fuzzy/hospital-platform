import type { PaymentState } from "@hospital/contracts";
import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { PaymentAmounts } from "./payment-order";

/** 每次 provider 调用都必须携带的链路和幂等上下文。 */
export type AdapterCallContext = {
	traceId: string;
	idempotencyKey: string;
	signal?: AbortSignal;
	timeoutMs?: number;
};

/**
 * Adapter 调用上下文的字段白名单。
 *
 * trace、幂等键和超时会进入日志、租约或 Provider 请求；未知字段若被原样
 * 透传，未来调用方可能把患者号、卡号或未审核的 Provider 参数带过领域边界。
 * 这里与 `normalizeAdapterCallContext` 配套，确保返回对象只保留已审计字段。
 */
const ADAPTER_CALL_CONTEXT_FIELDS = new Set([
	"traceId",
	"idempotencyKey",
	"signal",
	"timeoutMs",
]);

/**
 * 运行时校验可替换 gateway 共用的调用上下文。
 *
 * HTTP 路由会生成合法上下文，但组合根、回放任务和 Worker 也可能直接调用
 * service。未知字段不能被静默带入 Provider，trace/idempotency 也不能只依赖
 * TypeScript 声明；否则错误租约、不可检索日志或错误重放会在更深层才暴露。
 * 返回新对象而不是原样透传，确保 gateway 只看到 contract 允许的字段。
 */
export function normalizeAdapterCallContext(
	value: unknown,
): AdapterCallContext | undefined {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return undefined;
		}
		const record = value as Record<string, unknown>;
		if (
			Object.keys(record).some(
				(field) => !ADAPTER_CALL_CONTEXT_FIELDS.has(field),
			)
		) {
			return undefined;
		}
		if (
			!isBoundedOpaqueIdentifier(record.traceId) ||
			!isBoundedOpaqueIdentifier(record.idempotencyKey)
		) {
			return undefined;
		}
		if (
			record.timeoutMs !== undefined &&
			(typeof record.timeoutMs !== "number" ||
				!Number.isSafeInteger(record.timeoutMs) ||
				record.timeoutMs <= 0)
		) {
			return undefined;
		}
		if (record.signal !== undefined) {
			if (
				typeof record.signal !== "object" ||
				record.signal === null ||
				typeof (record.signal as { aborted?: unknown }).aborted !== "boolean" ||
				typeof (record.signal as { addEventListener?: unknown })
					.addEventListener !== "function" ||
				typeof (record.signal as { removeEventListener?: unknown })
					.removeEventListener !== "function"
			) {
				return undefined;
			}
		}

		return {
			traceId: record.traceId,
			idempotencyKey: record.idempotencyKey,
			...(record.signal !== undefined
				? { signal: record.signal as AbortSignal }
				: {}),
			...(record.timeoutMs !== undefined
				? { timeoutMs: record.timeoutMs as number }
				: {}),
		};
	} catch {
		// 组合根或测试夹具可能传入带异常 getter/proxy 的损坏对象。它不是
		// 合法上下文；验证器必须把它收敛为 undefined，不能让输入读取异常
		// 越过边界并遮蔽真正的业务错误。
		return undefined;
	}
}

/** 失败日志读取上下文时使用安全投影，避免坏上下文让错误处理再次抛异常。 */
export function adapterContextTraceId(value: unknown): string {
	try {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return "invalid";
		}
		const traceId = (value as Record<string, unknown>).traceId;
		return isBoundedOpaqueIdentifier(traceId) ? traceId : "invalid";
	} catch {
		// 错误日志是故障兜底路径；即使损坏上下文的 getter 自身抛错，也必须
		// 保留原始异常的记录机会，而不是让日志构造覆盖业务异常。
		return "invalid";
	}
}

/**
 * 外部系统证据索引；只保存可关联的标识，不保存密钥或完整敏感报文。
 *
 * `requestId` 保留单请求场景和旧日志查询的兼容字段；一个业务读取若并发
 * 调用多个 Provider，则必须把完整的有界列表放到 `requestIds`，不能把多个
 * 外部 ID 直接拼进一个字符串后越过单字段长度门禁。
 */
export type ExternalTrace = {
	provider: string;
	operation: string;
	requestId: string;
	/** 多 Provider 聚合时的完整请求号；每项都必须单独通过运行时校验。 */
	requestIds?: readonly string[];
	providerOrderId?: string;
};

/** 微信查单 adapter 只允许返回三种可编排状态，其他 provider 状态必须 fail-closed。 */
export type WechatPaymentQueryState = "cash_pending" | "cash_paid" | "failed";

/**
 * 医保 provider 的结算状态只能映射到医保阶段，不能直接宣称微信已支付或 HIS 已回写。
 * 无法确认的 provider 状态必须由 adapter 映射为 awaiting_confirmation。
 */
export type MedicalInsuranceSettlementState =
	| "insurance_settled"
	| "cash_pending"
	| "awaiting_confirmation"
	| "failed";

/**
 * 6202/6301 的金额证据必须和状态一起返回；query 不能只返回一个 success-like 状态。
 * 金额沿用订单的整数分模型，避免医保 adapter 重新定义元/分单位。
 */
export type MedicalInsuranceSettlementEvidence = {
	state: MedicalInsuranceSettlementState;
	amounts: PaymentAmounts;
	trace: ExternalTrace;
};

/** 支付订单的内部快照，金额统一使用整数分。 */
export type PaymentOrderSnapshot = {
	orderId: string;
	state: PaymentState;
	totalFen: number;
	insuranceFen: number;
	cashFen: number;
	trace: ExternalTrace[];
};

/**
 * 微信小程序调起支付所需的服务端签名结果。
 *
 * 这些字段只允许从后端 adapter 返回给受控的 API response；小程序不应
 * 自己生成 paySign，也不应接触商户私钥、APIv3 密钥或平台证书。
 */
export type WechatMiniProgramPayParams = {
	appId: string;
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
};

export interface MedicalInsuranceGateway {
	authorize(
		input: {
			authCode: string;
			patientId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		authorizationId: string;
		regionCode?: string;
		trace: ExternalTrace;
	}>;
	uploadFees(
		input: {
			orderId: string;
			patientId: string;
			authorizationId: string;
			totalFen: number;
			insuranceFen: number;
			cashFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		/** 仅是服务端引用；不得把 6201 的 payToken 或原始 envelope 放入此字段。 */
		feeUploadId: string;
		trace: ExternalTrace;
	}>;
	settle(
		input: {
			orderId: string;
			authorizationId: string;
			feeUploadId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: MedicalInsuranceSettlementState;
		amounts: PaymentAmounts;
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
}

export interface WechatPaymentGateway {
	createJsapiOrder(
		input: {
			orderId: string;
			openid: string;
			totalFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		prepayId: string;
		payParams: WechatMiniProgramPayParams;
		trace: ExternalTrace;
	}>;
	query(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: WechatPaymentQueryState;
		totalFen: number;
		trace: ExternalTrace;
	}>;
}

export interface HospitalSettlementGateway {
	writeBack(
		input: {
			orderId: string;
			settlement: PaymentOrderSnapshot;
		},
		context: AdapterCallContext,
	): Promise<ExternalTrace>;
}
