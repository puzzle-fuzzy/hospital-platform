import {
	OutpatientPaymentListResponse,
	OutpatientPaymentStatusSchema,
	success,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientPaymentGateway,
	OutpatientPaymentRecord,
	OutpatientPaymentStatus,
	PatientRepository,
} from "@hospital/domain";
import {
	adapterContextTraceId,
	DependencyNotConfiguredError,
	ExternalTraceReadModelValidationError,
	InvalidOutpatientPaymentStatusError,
	isBoundedOpaqueIdentifier,
	isOutpatientPaymentStatus,
	normalizeAdapterCallContext,
	normalizeExternalTrace,
	normalizeOutpatientPaymentRecords,
	OutpatientPaymentResultValidationError,
	parseOutpatientBillDateTime,
	validatePatientProviderReference,
} from "@hospital/domain";
import {
	type AppLogger,
	createNoopLogger,
	providerFailureMetadata,
} from "@hospital/observability";
import { Elysia, t } from "elysia";
import { createRequestPrincipalResolver } from "../../plugins/request-authentication";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { SessionTokenService } from "../auth/service";

export class OutpatientPaymentPatientNotFoundError extends Error {
	constructor() {
		super("Outpatient payment patient is not available");
		this.name = "OutpatientPaymentPatientNotFoundError";
	}
}

/** 服务层输入边界错误；不能把非法 patientId 误报成“暂无门诊映射”。 */
export class OutpatientPaymentQueryError extends Error {
	constructor() {
		super("Outpatient payment query is invalid");
		this.name = "OutpatientPaymentQueryError";
	}
}

/**
 * 门诊费用只读 service 的上下文运行时门禁。
 *
 * 费用查询虽然不调起支付，但仍会把 trace/idempotency 传给 Provider；直接
 * 调用方若绕过 HTTP schema，必须在 owner 映射和 Provider 前停止，避免错误
 * 日志或错误渠道继续传播损坏上下文。
 */
function requireOutpatientContext(value: unknown): AdapterCallContext {
	const normalized = normalizeAdapterCallContext(value);
	if (!normalized) {
		throw new OutpatientPaymentQueryError();
	}
	return normalized;
}

export type OutpatientPaymentServiceDependencies = {
	repository: PatientRepository;
	gateway: OutpatientPaymentGateway;
	/** 已由运行配置和 Provider 合同确认的渠道码，不属于单次患者查询输入。 */
	authSysCode: string;
	logger?: AppLogger;
	now?: () => Date;
};

/**
 * 将门诊费用 gateway 的外部请求链投影为低敏日志字段。
 *
 * 单请求场景继续保留 `providerRequestId` 兼容既有检索；未来费用查询若由
 * 多个 Provider 请求组成，则同步保存 domain 已校验的 `providerRequestIds`。
 * 这里只保存关联标识，不能把费用、患者号或 Provider 原始响应写入日志。
 */
function traceLogFields(
	trace: Pick<ExternalTrace, "requestId" | "requestIds">,
): Record<string, unknown> {
	return {
		providerRequestId: trace.requestId,
		...(trace.requestIds ? { providerRequestIds: [...trace.requestIds] } : {}),
	};
}

/** 众阳门诊接口使用中国标准时间，不得继承 systemd 进程的本地时区。 */
const OUTPATIENT_PROVIDER_TIME_ZONE = "Asia/Shanghai";
/** 仅用于按 Provider 自然日倒推查询窗口，不能替代 Provider 的分页语义。 */
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

type ProviderDateTimeParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

/**
 * 将绝对时间读取为 provider 的本地日历字段。
 *
 * 不能使用 `getFullYear()` / `getHours()`：它们读取的是服务器进程时区。
 * 生产机时区改成 UTC 后，门诊最近 30 天窗口会整体偏移，跨日时直接造成
 * 漏单或多查。这里把 provider 时区写成业务常量，让部署环境不会改变请求语义。
 */
function providerDateTimeParts(value: Date): ProviderDateTimeParts {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: OUTPATIENT_PROVIDER_TIME_ZONE,
		calendar: "gregory",
		numberingSystem: "latn",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(value);
	const values = Object.fromEntries(
		parts
			.filter(({ type }) => type !== "literal")
			.map(({ type, value: partValue }) => [type, Number(partValue)]),
	);
	const requiredPart = (name: keyof ProviderDateTimeParts): number => {
		const value = values[name];
		if (typeof value !== "number" || !Number.isInteger(value)) {
			throw new Error(`Unable to format outpatient provider ${name}`);
		}
		return value;
	};
	const result: ProviderDateTimeParts = {
		year: requiredPart("year"),
		month: requiredPart("month"),
		day: requiredPart("day"),
		hour: requiredPart("hour"),
		minute: requiredPart("minute"),
		second: requiredPart("second"),
	};
	return result;
}

function formatProviderDateTime(parts: ProviderDateTimeParts): string {
	const pad = (part: number) => String(part).padStart(2, "0");
	return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

/**
 * 按 provider 的“日历天”回退，而不是按服务器本地时区调用 setDate。
 * Asia/Shanghai 没有夏令时，使用 UTC 伪时间轴只做日期算术，最后仍输出
 * 已经解析好的中国标准时间字段，避免 Date 的隐式时区转换重新污染结果。
 */
function subtractProviderCalendarDays(
	parts: ProviderDateTimeParts,
	days: number,
): ProviderDateTimeParts {
	const pseudoUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second,
	);
	const shifted = new Date(pseudoUtc - days * CALENDAR_DAY_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		second: shifted.getUTCSeconds(),
	};
}

function queryWindow(now: Date): { startTime: string; endTime: string } {
	const end = providerDateTimeParts(now);
	const start = subtractProviderCalendarDays(end, 30);
	return {
		startTime: formatProviderDateTime(start),
		endTime: formatProviderDateTime(end),
	};
}

/**
 * Provider 可能忽略 startTime/endTime，服务层不能把窗口外账单直接展示。
 *
 * 费用列表不是可无限扩大的历史账本：本次请求只代表固定的最近 30 个中国
 * 标准时间日。发现任何一条窗口外账单时整批拒绝，而不是过滤异常行；过滤
 * 会把上游返回不完整伪装成成功，患者无法知道列表缺失。起止秒均属于本次
 * 查询窗口，因为 Provider 请求本身发送的是完整的 startTime/endTime。
 */
function validateOutpatientPaymentRecordWindow(
	records: readonly { billDate: string }[],
	window: { startTime: string; endTime: string },
): void {
	const start = parseOutpatientBillDateTime(window.startTime);
	const end = parseOutpatientBillDateTime(window.endTime);
	if (start === undefined || end === undefined || end < start) {
		// `queryWindow` 由服务端生成；这里保留防御性分支，避免未来修改
		// 时间格式后将无效窗口误当成有效费用事实。
		throw new OutpatientPaymentResultValidationError("bill-date-invalid");
	}
	if (
		records.some((record) => {
			const billDate = parseOutpatientBillDateTime(record.billDate);
			return billDate === undefined || billDate < start || billDate > end;
		})
	) {
		throw new OutpatientPaymentResultValidationError("bill-date-outside-query");
	}
}

/** 门诊缴费只读编排；provider 患者号只在 repository 与 adapter 之间流转。 */
export class OutpatientPaymentService {
	private readonly logger: AppLogger;
	private readonly now: () => Date;

	constructor(
		private readonly dependencies: OutpatientPaymentServiceDependencies,
	) {
		this.logger = dependencies.logger ?? createNoopLogger();
		this.now = dependencies.now ?? (() => new Date());
	}

	async list(
		ownerUserId: string,
		patientId: string,
		status: OutpatientPaymentStatus,
		context: AdapterCallContext,
	) {
		// 该变量只保存有限枚举，供失败日志关联网关输出；不能把 Provider
		// 原始响应或金额明细写入日志。
		let resultViolation: string | undefined;
		let trace: ExternalTrace | undefined;
		try {
			context = requireOutpatientContext(context);
			// ownerUserId 是当前会话的内部授权边界。HTTP 层虽然只从 principal
			// 传入它，但直接调用 service 时仍必须在患者映射和 Provider 前复核，
			// 避免非法 owner 被误当成“没有门诊映射”或进入错误的仓储查询。
			if (!isBoundedOpaqueIdentifier(ownerUserId)) {
				throw new OutpatientPaymentQueryError();
			}
			if (!isOutpatientPaymentStatus(status)) {
				// 不能把未知状态交给 adapter；adapter 的历史实现会把非 unpaid
				// 值映射成 Provider 的 paid 查询，运行时必须在这里先 fail-closed。
				throw new InvalidOutpatientPaymentStatusError();
			}
			if (!isBoundedOpaqueIdentifier(patientId)) {
				// 不能让空白 patientId 进入 repository；否则调用方会把输入错误
				// 误看成“没有门诊映射”，也会丢失统一的失败日志事件。
				throw new OutpatientPaymentQueryError();
			}
			// 配置通常由 env 解析器提供字符串，但 service 也可能被 Worker、
			// 回放任务或测试替身直接调用；TypeScript 类型不能约束运行时配置。
			// 非字符串和空白字符串都必须统一视为“依赖未配置”，不能在 trim()
			// 处抛出未映射 TypeError，更不能让 gateway 自行解释缺失渠道码。
			const authSysCode =
				typeof this.dependencies.authSysCode === "string"
					? this.dependencies.authSysCode.trim()
					: "";
			if (!authSysCode) {
				// Provider 渠道码决定权限和流量归属；缺失时必须停止在服务层，
				// 不能让任意 gateway 把空值解释成另一个渠道的默认值。
				throw new DependencyNotConfiguredError(
					"outpatient-payment-auth-sys-code",
				);
			}

			const window = queryWindow(this.now());
			this.logger.info(
				{
					event: "outpatient.payment.records.requested",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					status,
					patientId,
					startTime: window.startTime,
					endTime: window.endTime,
				},
				"Outpatient payment records requested",
			);

			const reference =
				await this.dependencies.repository.resolveProviderReference({
					ownerUserId,
					patientId,
					provider: "zhongyang",
					// 门诊费用接口的 patId 与预约/报告共用档案身份，不是目录 thirdPatientId。
					referenceKind: "his-patient",
				});
			if (!reference) throw new OutpatientPaymentPatientNotFoundError();
			// 仓储返回值仍是跨层运行时数据，不能只依赖 PatientProviderReference
			// 的编译期类型。发现结构或范围异常时，在 Provider 调用前 fail-closed，
			// 对客户端继续使用与“没有映射”相同的安全语义。
			const referenceViolation = validatePatientProviderReference(
				reference,
				patientId,
			);
			if (referenceViolation) {
				resultViolation = referenceViolation;
				throw new OutpatientPaymentPatientNotFoundError();
			}

			const result = await this.dependencies.gateway.listRecords(
				{
					providerPatientId: reference.providerPatientId,
					...window,
					status,
				},
				context,
			);
			trace = normalizeExternalTrace(
				(result as { trace?: unknown } | undefined)?.trace,
				{ expectedProvider: "zhongyang" },
			);
			let normalizedRecords: OutpatientPaymentRecord[];
			try {
				// adapter 是第一道 Provider 白名单边界，这里是可注入 gateway
				// 的第二道 contract 边界。不能因为返回类型写成了 TS 类型，就
				// 允许未来的回放实现或错误网关把错状态、重复 ID、非法金额带到
				// API 响应。
				normalizedRecords = normalizeOutpatientPaymentRecords(
					(result as { records?: unknown } | undefined)?.records,
					status,
				);
				validateOutpatientPaymentRecordWindow(normalizedRecords, window);
			} catch (error) {
				if (error instanceof OutpatientPaymentResultValidationError) {
					resultViolation = error.violation;
				}
				if (error instanceof ExternalTraceReadModelValidationError) {
					resultViolation = error.violation;
				}
				throw error;
			}
			this.logger.info(
				{
					event: "outpatient.payment.records.loaded",
					traceId: adapterContextTraceId(context),
					provider: trace.provider,
					...traceLogFields(trace),
					status,
					itemCount: normalizedRecords.length,
				},
				"Outpatient payment records loaded",
			);
			return {
				status,
				items: normalizedRecords,
				total: normalizedRecords.length,
			};
		} catch (error) {
			this.logger.error(
				{
					event: "outpatient.payment.records.failed",
					traceId: adapterContextTraceId(context),
					provider: "zhongyang",
					// 这是平台内部 opaque patientId，用于把 owner 映射失败与
					// 页面请求关联；provider 患者号仍只存在于调用帧内。
					patientId: isBoundedOpaqueIdentifier(patientId)
						? patientId
						: "invalid",
					// 无效运行时状态不能原样进入日志；这条日志只保留“无效”事实，
					// 避免把任意外部字符串当成合法业务状态继续传播。
					status: isOutpatientPaymentStatus(status) ? status : "invalid",
					errorType: error instanceof Error ? error.name : "UnknownError",
					...(error instanceof ExternalTraceReadModelValidationError
						? { resultViolation: error.violation }
						: {}),
					...(resultViolation ? { resultViolation } : {}),
					...providerFailureMetadata(error),
					...(trace ? traceLogFields(trace) : {}),
				},
				"Outpatient payment records failed",
			);
			throw error;
		}
	}
}

const AuthorizationHeaders = t.Object({
	authorization: t.Optional(t.String({ maxLength: 512 })),
	"idempotency-key": t.Optional(t.String({ maxLength: 128 })),
	"x-request-id": t.Optional(t.String({ maxLength: 128 })),
});

const OutpatientPaymentQuery = t.Object({
	patientId: t.String({ minLength: 1, maxLength: 128 }),
	status: OutpatientPaymentStatusSchema,
});

/** 门诊费用列表只接受内部 patientId 和状态，不接受 provider patId 或金额。 */
export function outpatientPaymentsModule(
	service: OutpatientPaymentService,
	sessions: SessionTokenService,
) {
	const authentication = createRequestPrincipalResolver(sessions);
	return new Elysia({ name: "outpatient-payments-module" })
		.onTransform({ as: "local" }, authentication.authenticate)
		.get(
			"/payments/outpatient/records",
			async ({ request, headers, query }) => {
				const principal = await authentication.get(request);
				return success(
					await service.list(
						principal.userId,
						query.patientId,
						query.status,
						adapterContextFromHeaders(headers),
					),
				);
			},
			{
				headers: AuthorizationHeaders,
				query: OutpatientPaymentQuery,
				response: { 200: OutpatientPaymentListResponse },
				tags: ["payments"],
			},
		);
}
