import {
	OutpatientPaymentListResponse,
	OutpatientPaymentStatusSchema,
	success,
} from "@hospital/contracts";
import type {
	AdapterCallContext,
	OutpatientPaymentGateway,
	OutpatientPaymentStatus,
	PatientRepository,
} from "@hospital/domain";
import {
	DependencyNotConfiguredError,
	InvalidOutpatientPaymentStatusError,
	isBoundedOpaqueIdentifier,
	isOutpatientPaymentStatus,
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

export type OutpatientPaymentServiceDependencies = {
	repository: PatientRepository;
	gateway: OutpatientPaymentGateway;
	/** 已由运行配置和 Provider 合同确认的渠道码，不属于单次患者查询输入。 */
	authSysCode: string;
	logger?: AppLogger;
	now?: () => Date;
};

/** 众阳门诊接口使用中国标准时间，不得继承 systemd 进程的本地时区。 */
const OUTPATIENT_PROVIDER_TIME_ZONE = "Asia/Shanghai";
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
		try {
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
			const authSysCode = this.dependencies.authSysCode.trim();
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
					traceId: context.traceId,
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

			const result = await this.dependencies.gateway.listRecords(
				{
					providerPatientId: reference.providerPatientId,
					...window,
					status,
				},
				context,
			);
			this.logger.info(
				{
					event: "outpatient.payment.records.loaded",
					traceId: context.traceId,
					provider: result.trace.provider,
					providerRequestId: result.trace.requestId,
					status,
					itemCount: result.records.length,
				},
				"Outpatient payment records loaded",
			);
			return {
				status,
				items: [...result.records],
				total: result.records.length,
			};
		} catch (error) {
			this.logger.error(
				{
					event: "outpatient.payment.records.failed",
					traceId: context.traceId,
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
					...providerFailureMetadata(error),
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
