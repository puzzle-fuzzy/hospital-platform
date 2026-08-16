import { ProviderRequestError } from "@hospital/adapters";
import {
	DependencyNotConfiguredError,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgeValidationError,
	PatientDirectorySyncInProgressError,
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
import { OutpatientPaymentPatientNotFoundError } from "../modules/outpatient-payments";
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
	if (code === "NOT_FOUND") return "Route not found";
	if (code === "VALIDATION") return "Request validation failed";
	if (code === "PARSE") return "Request body could not be parsed";
	return "Internal Server Error";
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
						message: "Required service dependency is not configured",
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

			if (error instanceof HealthKnowledgeContentUnavailableError) {
				set.status = 503;
				return {
					success: false,
					error: {
						code: "health-knowledge-unavailable",
						message: "Health knowledge content is temporarily unavailable",
					},
				};
			}

			if (error instanceof HealthKnowledgeValidationError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "health-knowledge-query-invalid",
						message: "Health knowledge query is invalid",
					},
				};
			}

			if (error instanceof HealthKnowledgeNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "health-knowledge-not-found",
						message: "Health knowledge item not found",
					},
				};
			}

			if (error instanceof ProviderRequestError) {
				set.status = error.retryable ? 503 : 502;
				return {
					success: false,
					error: {
						code: error.retryable
							? "provider-temporarily-unavailable"
							: "provider-request-rejected",
						message: error.retryable
							? "External service is temporarily unavailable"
							: "External service rejected the request",
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

			if (error instanceof AppointmentScheduleQueryError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "appointment-query-invalid",
						message: error.message,
					},
				};
			}

			if (error instanceof AppointmentRecordQueryError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "appointment-record-query-invalid",
						message: error.message,
					},
				};
			}

			if (error instanceof AppointmentRecordPatientNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "appointment-record-patient-not-found",
						message: "Appointment record patient not found",
					},
				};
			}

			if (error instanceof ReportQueryError) {
				set.status = 400;
				return {
					success: false,
					error: { code: "report-query-invalid", message: error.message },
				};
			}

			if (error instanceof ReportPatientNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "report-patient-not-found",
						message: "Report patient not found",
					},
				};
			}

			if (error instanceof ReportNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "report-not-found",
						message: "Report detail is not available",
					},
				};
			}

			if (error instanceof PaymentOrderInputError) {
				set.status = 400;
				return {
					success: false,
					error: { code: "payment-order-invalid", message: error.message },
				};
			}

			if (error instanceof PaymentOrderNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "payment-order-not-found",
						message: "Payment order not found",
					},
				};
			}

			if (error instanceof PaymentQuoteNotFoundError) {
				set.status = 404;
				return {
					success: false,
					error: {
						code: "payment-quote-not-found",
						message: "Payment quote not available",
					},
				};
			}

			if (error instanceof PaymentQuoteExpiredError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-quote-expired",
						message: "Payment quote expired",
					},
				};
			}

			if (error instanceof PaymentIdempotencyConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-idempotency-conflict",
						message: "Idempotency key conflicts with an existing order",
					},
				};
			}

			if (error instanceof PaymentOrderVersionConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-order-conflict",
						message: "Payment order changed",
					},
				};
			}

			if (error instanceof PaymentNotificationConflictError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-notification-conflict",
						message: "Payment notification conflicts with an existing event",
					},
				};
			}

			if (error instanceof WechatPaymentNotificationRejectedError) {
				set.status = 400;
				return {
					success: false,
					error: {
						code: "payment-notification-rejected",
						message: "Wechat payment notification was rejected",
					},
				};
			}

			if (error instanceof PaymentCashPrepayNotAllowedError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-cash-prepay-not-allowed",
						message: "Cash prepay is not available for this order",
					},
				};
			}

			if (error instanceof PaymentIdentityNotFoundError) {
				set.status = 409;
				return {
					success: false,
					error: {
						code: "payment-identity-not-found",
						message: "Payment identity is not available",
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
								? "Payment prepay is still being processed"
								: "Payment prepay requires provider confirmation",
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
