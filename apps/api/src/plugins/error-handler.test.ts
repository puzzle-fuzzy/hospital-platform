import { expect, test } from "bun:test";
import { ProviderRequestError } from "@hospital/adapters";
import {
	AppointmentDirectoryResultValidationError,
	AppointmentRecordResultValidationError,
	InvalidOutpatientPaymentStatusError,
	InvalidReportKindError,
	OutpatientPaymentResultValidationError,
	PatientDirectoryResultValidationError,
	PatientDirectorySnapshotUnsafeError,
	PatientReadModelValidationError,
	PaymentCashPrepayNotAllowedError,
	PaymentIdempotencyConflictError,
	PaymentNotificationConflictError,
	PaymentOrderInputError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptInProgressError,
	PaymentPrepayAttemptUnknownError,
	PaymentQuoteExpiredError,
	PaymentQuoteNotFoundError,
	ReportResultValidationError,
	UserProfileReadModelValidationError,
	WechatIdentityResultValidationError,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import {
	AppointmentRecordQueryError,
	AppointmentScheduleQueryError,
} from "../modules/appointments/service";
import { OutpatientPaymentQueryError } from "../modules/outpatient-payments";
import {
	PaymentIdentityNotFoundError,
	WechatPaymentNotificationRejectedError,
} from "../modules/payments";
import { ReportQueryError } from "../modules/reports/service";
import { errorHandlerPlugin } from "./error-handler";

test("persistence connection failures return a safe 503 contract", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new PersistenceUnavailableError("read");
	});

	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "persistence-temporarily-unavailable",
			message: "数据服务暂时不可用，请稍后重试",
		},
	});
});

test("患者读模型损坏不能降级为空目录", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new PatientReadModelValidationError("patient-owner-mismatch");
	});

	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "persistence-invalid",
			message: "数据服务返回异常，请联系管理员",
		},
	});
});

test("普通资料读模型损坏使用同一套持久化错误契约", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new UserProfileReadModelValidationError("profile-version-invalid");
	});

	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(500);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "persistence-invalid",
			message: "数据服务返回异常，请联系管理员",
		},
	});
});

test("ambiguous empty patient snapshots return a safe 502 contract", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new PatientDirectorySnapshotUnsafeError();
	});

	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "patient-directory-snapshot-unsafe",
			message: "外部患者目录结果不完整，当前就诊人未更新，请稍后重试",
		},
	});
});

test("支付领域内部错误统一映射为稳定中文公共契约", async () => {
	const cases = [
		{
			error: new PaymentOrderInputError("internal validation detail"),
			status: 400,
			code: "payment-order-invalid",
			message: "创建订单输入不合法",
		},
		{
			error: new PaymentQuoteNotFoundError(),
			status: 404,
			code: "payment-quote-not-found",
			message: "服务端报价不存在",
		},
		{
			error: new PaymentQuoteExpiredError(),
			status: 409,
			code: "payment-quote-expired",
			message: "服务端报价已过期，请重新获取报价",
		},
		{
			error: new PaymentIdempotencyConflictError(),
			status: 409,
			code: "payment-idempotency-conflict",
			message: "幂等键与已有订单的请求内容冲突",
		},
		{
			error: new PaymentOrderVersionConflictError(),
			status: 409,
			code: "payment-order-conflict",
			message: "订单版本已被其他流程更新",
		},
		{
			error: new PaymentNotificationConflictError(),
			status: 409,
			code: "payment-notification-conflict",
			message: "重复通知与已落库事件冲突",
		},
		{
			error: new WechatPaymentNotificationRejectedError(),
			status: 400,
			code: "payment-notification-rejected",
			message: "微信支付通知验签或内容校验失败",
		},
		{
			error: new PaymentCashPrepayNotAllowedError(),
			status: 409,
			code: "payment-cash-prepay-not-allowed",
			message: "当前订单不允许现金预支付",
		},
		{
			error: new PaymentIdentityNotFoundError(),
			status: 409,
			code: "payment-identity-not-found",
			message: "支付身份映射不可用",
		},
		{
			error: new PaymentPrepayAttemptInProgressError(),
			status: 409,
			code: "payment-prepay-in-progress",
			message: "预支付仍在处理，不能并发创建",
		},
		{
			error: new PaymentPrepayAttemptUnknownError(),
			status: 409,
			code: "payment-prepay-unknown",
			message: "预支付结果需向外部服务确认，不能直接重建",
		},
	] as const;

	for (const scenario of cases) {
		const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
			throw scenario.error;
		});
		const response = await app.handle(new Request("http://localhost/probe"));

		expect(response.status).toBe(scenario.status);
		expect(await response.json()).toEqual({
			success: false,
			error: { code: scenario.code, message: scenario.message },
		});
	}
});

test("查询边界错误统一映射为稳定中文公共契约", async () => {
	const cases = [
		{
			error: new AppointmentScheduleQueryError("internal schedule detail"),
			code: "appointment-query-invalid",
			message: "预约排班查询条件不合法",
		},
		{
			error: new AppointmentRecordQueryError("internal record detail"),
			code: "appointment-record-query-invalid",
			message: "预约记录查询条件不合法",
		},
		{
			error: new ReportQueryError("internal report detail"),
			code: "report-query-invalid",
			message: "报告查询条件不合法",
		},
		{
			error: new InvalidOutpatientPaymentStatusError(),
			code: "outpatient-payment-query-invalid",
			message: "门诊缴费查询条件不合法",
		},
		{
			error: new OutpatientPaymentQueryError(),
			code: "outpatient-payment-query-invalid",
			message: "门诊缴费查询条件不合法",
		},
		{
			error: new InvalidReportKindError(),
			code: "report-query-invalid",
			message: "报告查询条件不合法",
		},
	] as const;

	for (const scenario of cases) {
		const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
			throw scenario.error;
		});
		const response = await app.handle(new Request("http://localhost/probe"));

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			success: false,
			error: { code: scenario.code, message: scenario.message },
		});
	}
});

test("Provider 读模型校验错误映射为不可重试的 502", async () => {
	for (const error of [
		new AppointmentDirectoryResultValidationError("slot-count-invalid"),
		new OutpatientPaymentResultValidationError("status-mismatch"),
		new AppointmentRecordResultValidationError("status-invalid"),
		new ReportResultValidationError("detail-field-invalid"),
		new PatientDirectoryResultValidationError("patient-card-number-invalid"),
		new WechatIdentityResultValidationError("provider-subject-invalid"),
	]) {
		const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
			throw error;
		});
		const response = await app.handle(new Request("http://localhost/probe"));

		expect(response.status).toBe(502);
		expect(await response.json()).toEqual({
			success: false,
			error: {
				code: "provider-response-invalid",
				message: "外部服务返回数据异常，请稍后重试",
			},
		});
	}
});

test("Provider adapter 标记响应非法时映射为 provider-response-invalid", async () => {
	const app = new Elysia().use(errorHandlerPlugin()).get("/probe", () => {
		throw new ProviderRequestError({
			provider: "zhongyang",
			operation: "patient-list",
			requestId: "invalid-patient-response",
			message: "provider response shape is invalid",
			retryable: false,
			responseInvalid: true,
		});
	});
	const response = await app.handle(new Request("http://localhost/probe"));

	expect(response.status).toBe(502);
	expect(await response.json()).toEqual({
		success: false,
		error: {
			code: "provider-response-invalid",
			message: "外部服务返回数据异常，请稍后重试",
		},
	});
});
