import type { PaymentState } from "@hospital/contracts";
import type { MedicalInsuranceAuthorizationContext } from "./medical-insurance-authorization";
import type { MedicalInsuranceOrderType } from "./medical-insurance-business";
import type {
	MedicalInsuranceAmounts,
	MedicalInsuranceSettlementContext,
} from "./medical-insurance-order";
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

/** 医保结算证据的来源；来源决定它是否具有最终性。 */
export type MedicalInsuranceSettlementEvidenceSource =
	| "6202"
	| "6301"
	| "6302"
	| "yunhealth";

/**
 * 外部“成功”不能直接等价为业务成功。
 *
 * 6202/6301 的 3/4/5/6 只是当前旧流程允许进入后置编排的候选状态；
 * 只有云健康/HIS 后置接口确认后，才可以标记为 paid。未知值必须停在
 * unknown，避免 success=true 或 HTTP 200 穿透状态机。
 */
export type MedicalInsuranceSettlementEvidenceFinality =
	| "processing"
	| "settlement_candidate"
	| "paid"
	| "cancelled"
	| "failed"
	| "unknown";

/**
 * 6202/6301 的金额证据必须和状态一起返回；query 不能只返回一个 success-like 状态。
 * 金额沿用订单的整数分模型，避免医保 adapter 重新定义元/分单位。
 */
export type MedicalInsuranceSettlementEvidence = {
	state: MedicalInsuranceSettlementState;
	amounts: PaymentAmounts;
	trace: ExternalTrace;
	source: MedicalInsuranceSettlementEvidenceSource;
	providerStatus: string;
	finality: MedicalInsuranceSettlementEvidenceFinality;
	/** 仅表示该证据可用于状态迁移，不表示整个业务订单已完成。 */
	authoritative: boolean;
};

/**
 * 取消支付中的医保结算时，服务端只返回可编排的状态，不把众阳原始回包
 * 或支付流水凭证交给小程序。`unknown` 必须停在待确认，不能被当成已关闭。
 */
export type MedicalInsuranceCancellationEvidence = {
	state: "cancelled" | "awaiting_confirmation" | "manual_review";
	paymentState: "not_created" | "processing" | "closed" | "paid" | "unknown";
	settlementState: "not_created" | "cancelled" | "unknown";
	trace: ExternalTrace;
	providerStatus: string;
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
 * 挂号自费回写所需的最小 Provider 关联事实。
 *
 * 三个值必须来自同一笔已加密落库的 Provider 结算上下文；它们是流水关联键，
 * 不能由 appointmentId、平台支付订单号或小程序请求拼接、推导或覆盖。
 */
export type RegistrationSelfPaySettlementContext = {
	businessId: string;
	/** 2.6.65.1 返回的结算单编码；只在服务端创建 .2 时使用。 */
	businessCode?: string;
	payingId: string;
	tradingId: string;
	/** 旧云健康插件 .29/.15/.5 所需的服务端结算上下文。 */
	hospitalId?: string;
	patientId?: string;
	certNo?: string;
	psnCertType?: string;
	psnName?: string;
	psnNo?: string;
	patInHosId?: string;
	/** 插件订单与 .29 agreementNo 共用的微信 out_trade_no。 */
	outTradeNo?: string;
	/** 订单创建时固化的 32 位 recordCode；重试不得重新生成。 */
	recordCode?: string;
	payTypeId?: string;
	payType?: "CREDIT" | "POS" | "CROWD_FUNDING";
	workStationId?: string;
	thirdPartPayRecordId?: string;
	/** 仅允许保存在服务端 AES-GCM 密文中，不得写入日志或 API 响应。 */
	thirdPartPayRawResponse?: string;
};

/**
 * .29 成功后可选的内部留存回调。rawResponse 只允许进入服务端加密上下文，
 * 不得进入 ExternalTrace、日志、API response 或任何业务判断。
 */
export type HospitalSettlementThirdPartPayResponse = {
	rawResponse: string;
	thirdPartPayRecordId: string;
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

/** 所有普通微信自费入口统一使用 APIv3 JSAPI 小程序调起参数。 */
export type WechatPaymentLaunchParams = WechatMiniProgramPayParams;

/** 微信小程序医保混合支付专用调起参数；字段名和 wx API 保持一致。 */
export type WechatMedicalInsurancePayParams = {
	timeStamp: string;
	nonceStr: string;
	package: string;
	signType: "RSA";
	paySign: string;
	mixTradeNo: string;
};

export interface MedicalInsuranceGateway {
	authorize(
		input: {
			authCode: string;
			patientId: string;
			ownerUserId: string;
			orderId: string;
			providerSubject: string;
			patient: AppointmentMedicalInsurancePatient;
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
			ownerUserId: string;
			patientId: string;
			authorizationId: string;
			appointment: AppointmentMedicalInsuranceContext;
		},
		context: AdapterCallContext,
	): Promise<{
		/** 仅是服务端引用；不得把 6201 的 payToken 或原始 envelope 放入此字段。 */
		feeUploadId: string;
		payOrdId: string;
		payTokenHash: string;
		mdtrtId: string;
		acctUsedFlag: string;
		trace: ExternalTrace;
	}>;
	settle(
		input: {
			orderId: string;
			ownerUserId: string;
			authorizationId: string;
			feeUploadId: string;
			mdtrtId: string;
			acctUsedFlag: string;
		},
		context: AdapterCallContext,
	): Promise<{
		state: MedicalInsuranceSettlementState;
		amounts: MedicalInsuranceAmounts;
		trace: ExternalTrace;
		source: MedicalInsuranceSettlementEvidenceSource;
		providerStatus: string;
		finality: MedicalInsuranceSettlementEvidenceFinality;
		authoritative: boolean;
	}>;
	query(
		input: {
			orderId: string;
			ownerUserId: string;
			/** 微信医保混合订单已确认现金支付后，允许执行后置医保完成结算。 */
			cashPaymentConfirmed?: boolean;
		},
		context: AdapterCallContext,
	): Promise<MedicalInsuranceSettlementEvidence>;
	cancel(
		input: {
			orderId: string;
			ownerUserId: string;
			/** 只有在 2.6.33 已确认“正在收款中”后才允许走此专用分支。 */
			reason: "payment_in_progress";
		},
		context: AdapterCallContext,
	): Promise<MedicalInsuranceCancellationEvidence>;
}

/** 微信医保混合订单的 provider 状态，只在 adapter 内部映射后进入编排层。 */
export type MedicalInsuranceWechatPaymentState =
	| "not_started"
	| "prepay_ready"
	| "cash_paid"
	| "failed"
	| "unknown";

export type MedicalInsuranceWechatProviderState = "pending" | "paid" | "failed";

/**
 * 6202 留下自费金额后的官方微信医保混合支付边界。
 *
 * 6201/6202 的凭证和 2.27.2.27 明细只能由后端从加密仓储读取后传入，
 * 小程序不能提交金额、payAuthNo、参保号或费用明细。adapter 负责先创建
 * JSAPI prepay，再创建 /v3/med-ins/orders 混合订单。
 */
export interface MedicalInsuranceWechatPaymentGateway {
	createMixedOrder(
		input: {
			orderId: string;
			outTradeNo: string;
			openid: string;
			payOrdId: string;
			medOrgOrd: string;
			/** 按业务订单事实传入 RegPay/DiagPay，不能读取全局部署默认值。 */
			orderType: MedicalInsuranceOrderType;
			amounts: MedicalInsuranceAmounts;
			/** 6202 订单创建时间；必须使用本地订单事实，不能用支付请求时间覆盖。 */
			medicalOrderCreateTime?: string;
			authorization: MedicalInsuranceAuthorizationContext;
			settlement: MedicalInsuranceSettlementContext;
		},
		context: AdapterCallContext,
	): Promise<{
		mixTradeNo: string;
		prepayId: string;
		payParams: WechatMedicalInsurancePayParams;
		cashFen: number;
		trace: ExternalTrace;
	}>;
	queryMixedOrder(
		input: {
			orderId: string;
			mixTradeNo: string;
			expectedTotalFen: number;
			expectedCashFen: number;
		},
		context: AdapterCallContext,
	): Promise<{
		cashState: MedicalInsuranceWechatProviderState;
		insuranceState: MedicalInsuranceWechatProviderState;
		cashFen: number;
		totalFen: number;
		providerStatus: string;
		trace: ExternalTrace;
	}>;
}

/** 云健康旧插件混合支付的第二次 2.6.65.2 预下单。 */
export interface YunhealthRegistrationPluginPaymentGateway {
	createPreOrder(
		input: {
			orderId: string;
			businessId: string;
			tradeCode: string;
			totalFen: number;
			hospitalId: string;
			patientId: string;
			payTypeId: string;
			payType: "CREDIT" | "POS" | "CROWD_FUNDING";
			workStationId: string;
			recordCode: string;
			tradeTypeCode: string;
		},
		context: AdapterCallContext,
	): Promise<{
		payingId: string;
		tradingId: string;
		payTypeId: string;
		payType: "CREDIT" | "POS" | "CROWD_FUNDING";
		workStationId: string;
		tradeTypeCode: string;
		trace: ExternalTrace;
	}>;
}

/**
 * 普通挂号自费进入微信 APIv3 前的众阳结算准备边界。
 *
 * Provider 调用顺序固定为 2.6.65.1 -> 2.27.2.32 -> 2.6.65.2；
 * 任何一步未确认成功都不得创建微信订单。返回的流水上下文必须先加密落库，
 * 后续微信查单成功后才能用于 .29/.15/.5 回写。
 */
export interface RegistrationSelfPayPreparationGateway {
	prepare(
		input: {
			orderId: string;
			totalFen: number;
			providerRegisterId: string;
			providerPatientId: string;
			patient: {
				name: string;
				cardNo: string;
				idNo: string;
			};
		},
		context: AdapterCallContext,
	): Promise<{
		registrationContext: RegistrationSelfPaySettlementContext;
		trace: ExternalTrace;
	}>;
}

/** 预约写入已经取得的实名资料；只在服务端医保 adapter 调用帧中出现。 */
export type AppointmentMedicalInsurancePatient = {
	providerPatientId: string;
	name: string;
	cardNo: string;
	idNo: string;
	phone: string;
};

/** 6201/6202 所需的预约事实，不接受前端金额或 Provider ID 覆盖。 */
export type AppointmentMedicalInsuranceContext = {
	appointmentId: string;
	providerAppointmentId: string;
	providerPatientId: string;
	providerRegisterId?: string;
	providerHisRegisterId?: string;
	departmentId?: string;
	departmentName: string;
	doctorId?: string;
	doctorName: string;
	workDate: string;
	shiftName: string;
	sourceSerialNumber: string;
	totalFen: number;
};

export interface WechatPaymentGateway {
	createJsapiOrder(
		input: {
			orderId: string;
			openid: string;
			totalFen: number;
			orderType?: "RegPay" | "DiagPay";
			serialNo?: string;
		},
		context: AdapterCallContext,
	): Promise<{
		prepayId: string;
		payParams: WechatPaymentLaunchParams;
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
	/** 只允许在查单确认未支付后关闭普通微信预支付单。 */
	close(
		input: {
			orderId: string;
		},
		context: AdapterCallContext,
	): Promise<{ trace: ExternalTrace }>;
}

export interface HospitalSettlementGateway {
	writeBack(
		input: {
			orderId: string;
			settlement: PaymentOrderSnapshot;
			/** 服务端从同一预约的医保结算上下文解析出的 Provider 关联键。 */
			registrationContext?: RegistrationSelfPaySettlementContext;
			/** .29 成功后只保存完整 raw 响应，不参与后续业务处理。 */
			onThirdPartPayResponse?: (
				response: HospitalSettlementThirdPartPayResponse,
			) => void | Promise<void>;
		},
		context: AdapterCallContext,
	): Promise<ExternalTrace>;
}
