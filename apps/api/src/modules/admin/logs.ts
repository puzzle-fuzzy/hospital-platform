import { success } from "@hospital/contracts";
import type {
	AdminLogLevel,
	AdminLogQuery as AdminLogQueryInput,
	AdminLogStore,
} from "@hospital/observability";
import { Elysia, t } from "elysia";
import { HttpError } from "../../errors";

const AdminLogHeaders = t.Object({
	"x-admin-token": t.Optional(t.String({ maxLength: 512 })),
});

const AdminLogQuerySchema = t.Object(
	{
		page: t.Optional(t.String({ maxLength: 8 })),
		pageSize: t.Optional(t.String({ maxLength: 8 })),
		level: t.Optional(
			t.Union([
				t.Literal("debug"),
				t.Literal("info"),
				t.Literal("warn"),
				t.Literal("error"),
			]),
		),
		event: t.Optional(t.String({ maxLength: 128 })),
		path: t.Optional(t.String({ maxLength: 256 })),
		traceId: t.Optional(t.String({ maxLength: 256 })),
		requestId: t.Optional(t.String({ maxLength: 256 })),
		providerRequestId: t.Optional(t.String({ maxLength: 256 })),
		providerOperation: t.Optional(t.String({ maxLength: 256 })),
		service: t.Optional(t.String({ maxLength: 256 })),
		startTime: t.Optional(t.String({ maxLength: 64 })),
		endTime: t.Optional(t.String({ maxLength: 64 })),
	},
	{ additionalProperties: false },
);

const AdminLogIdParams = t.Object({
	id: t.String({ pattern: "^log-[1-9][0-9]*$", maxLength: 32 }),
});

/** Worker 只允许上送安全元数据；body/raw/url/header 等字段不会被 schema 接受。 */
const AdminLogIngestBody = t.Object(
	{
		timestamp: t.String({ maxLength: 64 }),
		level: t.Union([
			t.Literal("debug"),
			t.Literal("info"),
			t.Literal("warn"),
			t.Literal("error"),
		]),
		service: t.String({ maxLength: 256 }),
		environment: t.String({ maxLength: 64 }),
		event: t.Optional(t.String({ maxLength: 128 })),
		method: t.Optional(t.String({ maxLength: 16 })),
		path: t.Optional(t.String({ maxLength: 256 })),
		statusCode: t.Optional(t.Number()),
		durationMs: t.Optional(t.Number()),
		requestId: t.Optional(t.String({ maxLength: 256 })),
		traceId: t.Optional(t.String({ maxLength: 256 })),
		errorName: t.Optional(t.String({ maxLength: 256 })),
		errorCode: t.Optional(t.String({ maxLength: 256 })),
		dependency: t.Optional(t.String({ maxLength: 256 })),
		provider: t.Optional(t.String({ maxLength: 256 })),
		providerOperation: t.Optional(t.String({ maxLength: 256 })),
		providerRequestId: t.Optional(t.String({ maxLength: 256 })),
		providerStatusCode: t.Optional(t.Number()),
		providerFailureStage: t.Optional(t.String({ maxLength: 64 })),
		providerRequestOutcome: t.Optional(t.String({ maxLength: 64 })),
		providerRetryable: t.Optional(t.Boolean()),
		providerErrorCode: t.Optional(t.String({ maxLength: 256 })),
		providerErrorMessageLength: t.Optional(t.Number()),
		providerErrorMessageSha256: t.Optional(t.String({ maxLength: 128 })),
		providerTransportErrorCode: t.Optional(t.String({ maxLength: 128 })),
		providerResponseBusinessSuccess: t.Optional(t.Boolean()),
		providerResponseCode: t.Optional(t.String({ maxLength: 256 })),
		providerResponseBodyByteLength: t.Optional(t.Number()),
		providerResponseBodySha256: t.Optional(t.String({ maxLength: 128 })),
		providerResponseMessageLength: t.Optional(t.Number()),
		persistenceOperation: t.Optional(t.String({ maxLength: 256 })),
		parameterVisibility: t.Literal("not-recorded"),
	},
	{ additionalProperties: false },
);

function constantTimeEqual(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	if (leftBytes.length !== rightBytes.length) return false;
	let difference = 0;
	for (let index = 0; index < leftBytes.length; index += 1) {
		difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return difference === 0;
}

function positiveInteger(value: string | undefined, fallback: number): number {
	if (!value || !/^[1-9][0-9]*$/u.test(value)) return fallback;
	const parsed = Number(value);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeDate(
	value: string | undefined,
	field: string,
): string | undefined {
	if (!value) return undefined;
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) {
		throw new HttpError(400, "validation", `${field} 时间格式不合法`);
	}
	return new Date(timestamp).toISOString();
}

function normalizedQuery(query: {
	page?: string;
	pageSize?: string;
	level?: AdminLogLevel;
	event?: string;
	path?: string;
	traceId?: string;
	requestId?: string;
	providerRequestId?: string;
	providerOperation?: string;
	service?: string;
	startTime?: string;
	endTime?: string;
}): AdminLogQueryInput {
	const startTime = normalizeDate(query.startTime, "startTime");
	const endTime = normalizeDate(query.endTime, "endTime");
	if (startTime && endTime && Date.parse(startTime) > Date.parse(endTime)) {
		throw new HttpError(400, "validation", "开始时间不能晚于结束时间");
	}
	return {
		page: Math.min(positiveInteger(query.page, 1), 10_000),
		pageSize: Math.min(positiveInteger(query.pageSize, 50), 100),
		...(query.level ? { level: query.level } : {}),
		...(query.event?.trim() ? { event: query.event.trim() } : {}),
		...(query.path?.trim() ? { path: query.path.trim() } : {}),
		...(query.traceId?.trim() ? { traceId: query.traceId.trim() } : {}),
		...(query.requestId?.trim() ? { requestId: query.requestId.trim() } : {}),
		...(query.providerRequestId?.trim()
			? { providerRequestId: query.providerRequestId.trim() }
			: {}),
		...(query.providerOperation?.trim()
			? { providerOperation: query.providerOperation.trim() }
			: {}),
		...(query.service?.trim() ? { service: query.service.trim() } : {}),
		...(startTime ? { startTime } : {}),
		...(endTime ? { endTime } : {}),
	};
}

function authorize(
	headers: Record<string, string | undefined>,
	token: string | undefined,
): void {
	const expectedToken = token?.trim() || "";
	if (!expectedToken) {
		throw new HttpError(503, "admin-not-configured", "管理端日志尚未配置");
	}
	if (!constantTimeEqual(headers["x-admin-token"] ?? "", expectedToken)) {
		throw new HttpError(401, "admin-unauthorized", "管理端日志令牌无效");
	}
}

/** 新服务独立日志只读入口；只返回安全元数据，不返回请求/响应原文。 */
export function adminLogsModule(
	store: AdminLogStore,
	adminLogsToken?: string,
	adminLogsIngestToken?: string,
) {
	return new Elysia({ name: "admin-logs-module" })
		.get(
			"/admin/logs",
			async ({ headers, query }) => {
				authorize(headers, adminLogsToken);
				return success(store.query(normalizedQuery(query)));
			},
			{
				headers: AdminLogHeaders,
				query: AdminLogQuerySchema,
				// 管理端内部契约不进入患者端 OpenAPI 文档。
				detail: { hide: true },
			},
		)
		.post(
			"/admin/logs/ingest",
			async ({ headers, body }) => {
				authorize(headers, adminLogsIngestToken);
				store.append(JSON.stringify(body));
				return success({ accepted: true });
			},
			{
				headers: AdminLogHeaders,
				body: AdminLogIngestBody,
				// Worker-to-API 内部入口，不进入患者端 OpenAPI 文档。
				detail: { hide: true },
			},
		)
		.get(
			"/admin/logs/:id",
			async ({ headers, params }) => {
				authorize(headers, adminLogsToken);
				const record = store.getById(params.id);
				if (!record)
					throw new HttpError(404, "not_found", "日志不存在或已过期");
				return success(record);
			},
			{
				headers: AdminLogHeaders,
				params: AdminLogIdParams,
				detail: { hide: true },
			},
		);
}
