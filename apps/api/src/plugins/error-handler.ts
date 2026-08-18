import { ProviderRequestError } from "@hospital/adapters";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	DependencyNotConfiguredError,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgeValidationError,
	InvalidOutpatientPaymentStatusError,
	InvalidReportKindError,
	OutpatientPaymentResultValidationError,
	PatientDirectorySnapshotUnsafeError,
	PatientDirectorySyncInProgressError,
	PatientReadModelValidationError,
	PaymentCashPrepayNotAllowedError,
	PaymentIdempotencyConflictError,
	PaymentNotificationConflictError,
	PaymentOrderInputError,
	PaymentOrderNotFoundError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptInProgressError,
	PaymentPrepayAttemptUnknownError,
	PaymentQuoteExpiredError,
	PaymentQuoteNotFoundError,
	ReportResultValidationError,
	UserProfileInputError,
	UserProfileVersionConflictError,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import { HttpError } from "../errors";
import {
	AppointmentRecordPatientNotFoundError,
	AppointmentRecordQueryError,
	AppointmentScheduleQueryError,
} from "../modules/appointments/service";
import { HealthKnowledgeNotFoundError } from "../modules/knowledge/service";
import {
	OutpatientPaymentPatientNotFoundError,
	OutpatientPaymentQueryError,
} from "../modules/outpatient-payments";
import { WechatPaymentNotificationRejectedError } from "../modules/payments/notification-service";
import { PaymentIdentityNotFoundError } from "../modules/payments/service";
import {
	ReportNotFoundError,
	ReportPatientNotFoundError,
	ReportQueryError,
} from "../modules/reports/service";

function normalizeCode(code: string | number): string {
	return typeof code === "string" ? code : "UNKNOWN";
}

function errorCode(code: string): string {
	return code.toLowerCase().replaceAll("_", "-");
}

function statusFor(code: string): number {
	if (code === "NOT_FOUND") return 404;
	if (code === "VALIDATION" || code === "PARSE") return 400;
	return 500;
}

function messageFor(code: string): string {
	if (code === "NOT_FOUND") return "请求路径不存在";
	if (code === "VALIDATION") return "请求参数校验失败";
	if (code === "PARSE") return "请求体无法解析";
	return "服务器内部错误";
}

export function errorHandlerPlugin() {
	return new Elysia({ name: "error-handler" }).onError(
		{ as: "global" },
		({ code, error, set }) => {
			if (error instanceof HttpError) {
				set.status = error.statusCode;
				return {
					success: false,
					error: { code: error.code, message: error.message },
				};
			}

			if (error instanceof DependencyNotConfiguredError) {
				set.status = 503;
				return {
					success: false,
					error: {
						code: "dependency-not-configured",
						message: "该服务暂未配置完成，请稍后重试",
					},
				};
			}

			if (error instanceof PatientDirectorySyncInProgressError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "patient-sync-in-progress",
						message: "患者目录正在同步，请稍后刷新",
					},
				};
			}

			if (error instanceof PatientDirectorySnapshotUnsafeError) {
				set.status = 502;
				return {
					success: false,
					error: {
						code: "patient-directory-snapshot-unsafe",
						message: "外部患者目录结果不完整，当前就诊人未更新，请稍后重试",
					},
				};
			}

			if (error instanceof HealthKnowledgeContentUnavailableError) {
				set.status = 503;
				return {
					success: false,
					error: {
						code: "health-knowledge-unavailable",
						message: "健康知识内容暂时不可用，请稍后重试",
					},
				};
			}

			if (error instanceof HealthKnowledgeValidationError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "health-knowledge-query-invalid",
						message: "健康知识查询条件不合法",
					},
				};
			}

			if (error instanceof HealthKnowledgeNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "health-knowledge-not-found",
						message: "未找到对应的健康知识内容",
					},
				};
			}

			if (error instanceof ProviderRequestError) {
				set.status = error.retryable ? 503 : 502;
				const responseInvalid = error.responseInvalid === true;
				return {
					success: false,
					error: {
						code: responseInvalid
							? "provider-response-invalid"
							: error.retryable
								? "provider-temporarily-unavailable"
								: "provider-request-rejected",
						message: responseInvalid
							? "外部服务返回数据异常，请稍后重试"
							: error.retryable
								? "外部服务暂时不可用，请稍后重试"
								: "外部服务拒绝了本次请求，请稍后重试",
					},
				};
			}

			if (
				error instanceof OutpatientPaymentResultValidationError ||
				error instanceof AppointmentDirectoryResultValidationError ||
				error instanceof AppointmentRecordResultValidationError ||
				error instanceof ReportResultValidationError
			) {
				// Provider 已返回响应，但网关结果违反平台读模型；这不是患者
				// 查询参数错误，也不能降级为空列表，应明确返回不可重试的 502。
				set.status = 502;
				return {
					success: false,
					error: {
						code: "provider-response-invalid",
						message: "外部服务返回数据异常，请稍后重试",
					},
				};
			}

			if (error instanceof UserProfileInputError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "user-profile-invalid",
						message: "个人资料字段不合法",
					},
				};
			}

			if (error instanceof UserProfileVersionConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "user-profile-conflict",
						message: "个人资料已被其他设备修改，请刷新后重试",
					},
				};
			}

			if (error instanceof PersistenceUnavailableError) {
				set.status = 503;
				return {
					success: false,
					error: {
						code: "persistence-temporarily-unavailable",
						message: "数据服务暂时不可用，请稍后重试",
					},
				};
			}

			if (error instanceof PatientReadModelValidationError) {
				// 数据库读模型违反内部患者 contract 时不能降级为空目录；空目录会让
				// 小程序误以为用户没有就诊人，甚至触发错误的默认选择。固定返回
				// 500，详细原因只进入服务端低敏日志。
				set.status = 500;
				return {
					success: false,
					error: {
						code: "persistence-invalid",
						message: "数据服务返回异常，请联系管理员",
					},
				};
			}

			if (error instanceof OutpatientPaymentPatientNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "outpatient-payment-patient-not-found",
						message: "当前就诊人暂未建立门诊缴费映射",
					},
				};
			}

			if (
				error instanceof InvalidOutpatientPaymentStatusError ||
				error instanceof OutpatientPaymentQueryError
			) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "outpatient-payment-query-invalid",
						message: "门诊缴费查询条件不合法",
					},
				};
			}

			if (error instanceof AppointmentScheduleQueryError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "appointment-query-invalid",
						// 查询边界的内部细节只用于日志，公共接口返回稳定中文文案。
						message: "预约排班查询条件不合法",
					},
				};
			}

			if (error instanceof AppointmentRecordQueryError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "appointment-record-query-invalid",
						// 不把日期范围上限等实现细节暴露给小程序页面。
						message: "预约记录查询条件不合法",
					},
				};
			}

			if (error instanceof AppointmentRecordPatientNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "appointment-record-patient-not-found",
						message: "当前就诊人暂无可查询的预约记录",
					},
				};
			}

			if (
				error instanceof ReportQueryError ||
				error instanceof InvalidReportKindError
			) {
				set.status = 400;
				return {
					success: false,
					// provider 查询窗口和字段校验不属于公共错误契约。
					error: {
						code: "report-query-invalid",
						message: "报告查询条件不合法",
					},
				};
			}

			if (error instanceof ReportPatientNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "report-patient-not-found",
						message: "当前就诊人暂无可查询的报告",
					},
				};
			}

			if (error instanceof ReportNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "report-not-found",
						message: "报告详情暂不可用",
					},
				};
			}

			if (error instanceof PaymentOrderInputError) {
				set.status = 400;
				return {
					success: false,
					// 输入错误可能来自领域层内部校验，公共 API 只返回稳定的安全文案。
					error: {
						code: "payment-order-invalid",
						message: "创建订单输入不合法",
					},
				};
			}

			if (error instanceof PaymentOrderNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "payment-order-not-found",
						message: "未找到对应的支付订单",
					},
				};
			}

			if (error instanceof PaymentQuoteNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "payment-quote-not-found",
						message: "服务端报价不存在",
					},
				};
			}

			if (error instanceof PaymentQuoteExpiredError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-quote-expired",
						message: "服务端报价已过期，请重新获取报价",
					},
				};
			}

			if (error instanceof PaymentIdempotencyConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-idempotency-conflict",
						message: "幂等键与已有订单的请求内容冲突",
					},
				};
			}

			if (error instanceof PaymentOrderVersionConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-order-conflict",
						message: "订单版本已被其他流程更新",
					},
				};
			}

			if (error instanceof PaymentNotificationConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-notification-conflict",
						message: "重复通知与已落库事件冲突",
					},
				};
			}

			if (error instanceof WechatPaymentNotificationRejectedError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "payment-notification-rejected",
						message: "微信支付通知验签或内容校验失败",
					},
				};
			}

			if (error instanceof PaymentCashPrepayNotAllowedError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-cash-prepay-not-allowed",
						message: "当前订单不允许现金预支付",
					},
				};
			}

			if (error instanceof PaymentIdentityNotFoundError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-identity-not-found",
						message: "支付身份映射不可用",
					},
				};
			}

			if (
				error instanceof PaymentPrepayAttemptInProgressError ||
				error instanceof PaymentPrepayAttemptUnknownError
			) {
				set.status = 409;
				return {
					success: false,
					error: {
						code:
							error instanceof PaymentPrepayAttemptInProgressError
								? "payment-prepay-in-progress"
								: "payment-prepay-unknown",
						message:
							error instanceof PaymentPrepayAttemptInProgressError
								? "预支付仍在处理，不能并发创建"
								: "预支付结果需向外部服务确认，不能直接重建",
					},
				};
			}

			const normalizedCode = normalizeCode(code);
			set.status = statusFor(normalizedCode);
			return {
				success: false,
				error: {
					code: errorCode(normalizedCode),
					message: messageFor(normalizedCode),
				},
			};
		},
	);
}
