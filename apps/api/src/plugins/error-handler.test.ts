import { expect, test } from "bun:test";
import {
	PaymentCashPrepayNotAllowedError,
	PaymentIdempotencyConflictError,
	PaymentNotificationConflictError,
	PaymentOrderInputError,
	PaymentOrderVersionConflictError,
	PaymentPrepayAttemptInProgressError,
	PaymentPrepayAttemptUnknownError,
	PaymentQuoteExpiredError,
	PaymentQuoteNotFoundError,
} from "@hospital/domain";
import { PersistenceUnavailableError } from "@hospital/persistence";
import { Elysia } from "elysia";
import {
	AppointmentRecordQueryError,
	AppointmentScheduleQueryError,
} from "../modules/appointments/service";
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
