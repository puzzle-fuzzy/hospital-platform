import { emitRawBodyLog, providerRawLoggingEnabled } from "@hospital/adapters";
import { type AppLogger, createNoopLogger } from "@hospital/observability";
import { Elysia, t } from "elysia";
import { adapterContextFromHeaders } from "../../plugins/request-context";
import type { YunhealthPaymentQueryService } from "./yunhealth-payment-query-service";

const Identifier = t.Union([
	t.String({ minLength: 1, maxLength: 128 }),
	t.Number(),
]);

const Request = t.Object(
	{
		patId: Identifier,
		tradeNo: t.String({ minLength: 1, maxLength: 128 }),
		payTypeId: Identifier,
		payingId: Identifier,
		amount: t.Union([t.String({ minLength: 1, maxLength: 32 }), t.Number()]),
		cashierId: Identifier,
		cashierName: t.String({ minLength: 1, maxLength: 50 }),
		tradeType: t.String({ minLength: 1, maxLength: 32 }),
		deviceIp: t.Optional(t.String({ maxLength: 64 })),
		deviceMac: t.Optional(t.String({ maxLength: 64 })),
		hisCreateTime: t.String({ minLength: 1, maxLength: 32 }),
		remark: t.Optional(t.String({ maxLength: 64 })),
		orgId: t.Optional(Identifier),
		hospitalId: t.Optional(Identifier),
		transactionId: t.String({ minLength: 1, maxLength: 128 }),
	},
	{ additionalProperties: false },
);

const Response = t.Object({
	patId: Identifier,
	transactionId: t.String(),
	payTime: t.String(),
	payTypeId: Identifier,
	result: t.Union([
		t.Literal("SUCCESS"),
		t.Literal("REFUND"),
		t.Literal("USERPAYING"),
		t.Literal("PAYERROR"),
		t.Literal("CLOSED"),
	]),
});

const callbackPath = "/Payment/Api/MYDService/ThirdpartyPayQuery";

function stringHeaders(headers: Headers): Readonly<Record<string, string>> {
	return Object.fromEntries(headers.entries());
}

function statusCode(status: number | string | undefined): number {
	if (typeof status === "number") return status;
	const parsed = Number(status);
	return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
		? parsed
		: 200;
}

function responseBodyText(value: unknown): string {
	const serialized = JSON.stringify(value);
	return serialized ?? String(value ?? "");
}

function logRawCallbackRequest(
	logger: AppLogger,
	request: Request,
	bodyText: string,
): void {
	if (!providerRawLoggingEnabled()) return;
	const requestHeaders = stringHeaders(request.headers);
	const context = adapterContextFromHeaders(requestHeaders);
	emitRawBodyLog(
		logger,
		{
			event: "provider.request.raw",
			provider: "yunhealth",
			operation: "registration-self-pay.2.6.65.9",
			traceId: context.traceId,
			providerRequestId: context.traceId,
			method: request.method,
			providerRequestUrl: callbackPath,
			providerRequestHeadersText: JSON.stringify(requestHeaders),
		},
		"providerRequestBodyText",
		bodyText,
		"Yunhealth 2.6.65.9 raw callback request captured",
	);
}

function logRawCallbackResponse(
	logger: AppLogger,
	request: Request,
	status: number | string | undefined,
	value: unknown,
): void {
	if (!providerRawLoggingEnabled()) return;
	const context = adapterContextFromHeaders(stringHeaders(request.headers));
	emitRawBodyLog(
		logger,
		{
			event: "provider.response.raw",
			provider: "yunhealth",
			operation: "registration-self-pay.2.6.65.9",
			traceId: context.traceId,
			providerRequestId: context.traceId,
			providerStatusCode: statusCode(status),
			providerResponseHeadersText: '{"content-type":"application/json"}',
		},
		"providerResponseBodyText",
		responseBodyText(value),
		"Yunhealth 2.6.65.9 raw callback response captured",
	);
}

/** 众阳非 HIS 收款流程的 2.6.65.9 反向支付查询接口。 */
export function yunhealthPaymentQueryModule(
	service: YunhealthPaymentQueryService,
	logger: AppLogger = createNoopLogger(),
) {
	return (
		new Elysia({
			name: "yunhealth-payment-query-module",
			normalize: false,
		})
			// 在框架 JSON 解析和 schema 校验之前记录原始 body，确保 malformed JSON、
			// Content-Type 错误、缺字段和多字段回调也能按 traceId 还原，而不只覆盖
			// 成功进入 service 的请求。
			.onParse(async ({ request, contentType }) => {
				const bodyText = await request.text();
				logRawCallbackRequest(logger, request, bodyText);
				return contentType === "application/json"
					? JSON.parse(bodyText)
					: bodyText;
			})
			// mapResponse 能看到统一 error handler 生成的最终错误封套；因此正常响应和
			// 解析/校验/运行异常的实际返回 JSON 都使用同一套完整分块日志。
			.mapResponse(({ request, responseValue, set }) => {
				// 解析异常时 Elysia 会先以 undefined 进入一次 mapResponse，再携带
				// 统一错误封套进入；跳过前者，避免生成重复的 chunkIndex=0 空响应。
				if (responseValue === undefined) return;
				logRawCallbackResponse(logger, request, set.status, responseValue);
			})
			.post(
				callbackPath,
				({ body, headers }) => {
					return service.query(body, {
						...adapterContextFromHeaders(headers),
					});
				},
				{
					body: Request,
					response: { 200: Response },
					tags: ["payments"],
				},
			)
	);
}
