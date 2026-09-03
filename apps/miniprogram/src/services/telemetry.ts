/**
 * 小程序客户端统一遥测层。
 *
 * 旧端维护困难的两个直接原因是"用户做过什么没有留痕"和"中转返回了什么
 * 无从查起"。这里提供一条所有客户端事件共用的出口：稳定事件种类、低敏
 * 字段、可关闭的正文摘要，以及微信实时日志上报。任何页面或服务都不再
 * 自行拼接 console 输出。
 *
 * 隐私边界与服务端 `docs/logging.md` 保持同一原则：
 * - 凭证类字段（token、openid、sessionKey、支付签名等）在任何环境都不
 *   进入日志；键名匹配按大小写和分隔符无关处理。
 * - 请求/响应正文摘要只在 develop/trial 控制台输出；正式版只保留路径、
 *   方法、状态码、业务错误码和数量等元数据。
 * - 微信实时日志（公众平台"运维中心-实时日志"）只上报元数据，正文摘要
 *   永不进入实时日志。
 */

import {
	resolveErrorNumericCode,
	UNKNOWN_NUMERIC_CODE,
} from "./error-registry";

export type ClientTelemetryEnvVersion = "develop" | "trial" | "release";

export type ClientTelemetryEventKind =
	| "app.launch"
	| "page.lifecycle"
	| "page.action"
	| "navigation"
	| "api.request"
	/** 原始错误被转换、替换或吞没前的最后事实；见 logClientErrorTransformed。 */
	| "error.transformed";

export type ClientTelemetryOutcome = "completed" | "failed";

/** 遥测事件里的额外低敏标量；禁止把对象或任意调用方原值放进 fields。 */
export type ClientTelemetryFields = Readonly<
	Record<string, string | number | boolean | null>
>;

/**
 * 遥测事件输入。可选字段允许显式 undefined，方便调用方用条件展开构造；
 * 运行时只写入存在的键。
 */
export type ClientTelemetryEventInput = {
	kind: ClientTelemetryEventKind;
	route?: string | undefined;
	method?: string | undefined;
	/** 导航 API 名称，例如 navigateTo、switchTab。 */
	action?: string | undefined;
	/** 导航目标路径；查询串与 fragment 已剥离。 */
	target?: string | undefined;
	/** 微信事件类型，例如 tap、input、confirm。 */
	eventType?: string | undefined;
	outcome?: ClientTelemetryOutcome | undefined;
	/** 仅记录 Error.name 等固定错误类型，不记录错误原文。 */
	errorName?: string | undefined;
	/** 仅 develop/trial 控制台输出的脱敏正文摘要。 */
	detail?: unknown;
	/** 仅 develop/trial 控制台输出的脱敏 dataset。 */
	dataset?: unknown;
	fields?: ClientTelemetryFields | undefined;
};

export type ClientTelemetryEvent = Readonly<
	ClientTelemetryEventInput & { at: string }
>;

/**
 * App 入口 IIFE 和页面 CommonJS 模块是两份 bundle，模块级变量不共享。
 * 环形缓冲、环境版本缓存和实时日志句柄都挂在 globalThis 上，保证两个
 * bundle 写入同一条事件流；这也与 sessionChangedListeners 的共享方式
 * 一致。
 */
type ClientTelemetryStore = {
	events: ClientTelemetryEvent[];
	envVersion?: ClientTelemetryEnvVersion | undefined;
	envVersionResolved: boolean;
	realtimeSink?: RealtimeLogSink | null;
	/** 实时日志过滤关键字追加计数；微信平台对追加条数有限制。 */
	realtimeFilterCount?: number;
};

type RealtimeLogSink = {
	info: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
	/** 追加实时日志过滤关键字；旧基础库可能缺失，调用前检查。 */
	addFilterMsg?: (msg: string) => void;
};

const TELEMETRY_STORE_KEY = "__hospitalClientTelemetry";

/** 环境探测失败时按正式版处理：宁可少打正文，不能在正式环境多打。 */
const FALLBACK_ENV_VERSION: ClientTelemetryEnvVersion = "release";

/** 客户端事件环只保留最近一小段；长期取证依赖控制台或实时日志平台。 */
export const MAX_RECENT_CLIENT_TELEMETRY_EVENTS = 200;

function getTelemetryStore(): ClientTelemetryStore {
	const holder = globalThis as typeof globalThis & {
		[TELEMETRY_STORE_KEY]?: ClientTelemetryStore;
	};
	const existing = holder[TELEMETRY_STORE_KEY];
	if (existing) return existing;
	const store: ClientTelemetryStore = {
		events: [],
		envVersionResolved: false,
	};
	holder[TELEMETRY_STORE_KEY] = store;
	return store;
}

/**
 * 解析当前运行版本。develop（开发者工具与真机预览）和 trial（体验版）
 * 允许输出脱敏正文；release 只输出元数据。
 */
export function resolveClientTelemetryEnvVersion(): ClientTelemetryEnvVersion {
	const store = getTelemetryStore();
	if (store.envVersionResolved) return store.envVersion ?? FALLBACK_ENV_VERSION;
	let resolved: ClientTelemetryEnvVersion = FALLBACK_ENV_VERSION;
	try {
		if (
			typeof wx !== "undefined" &&
			typeof wx.getAccountInfoSync === "function"
		) {
			const version = wx.getAccountInfoSync().miniProgram?.envVersion;
			if (
				version === "develop" ||
				version === "trial" ||
				version === "release"
			) {
				resolved = version;
			}
		}
	} catch {
		// 老基础库或测试替身没有账号信息时保持 fail-closed 默认值。
	}
	store.envVersion = resolved;
	store.envVersionResolved = true;
	return resolved;
}

/** 测试专用：覆盖或还原环境版本判定。 */
export function setClientTelemetryEnvVersionForTests(
	version: ClientTelemetryEnvVersion | null,
): void {
	const store = getTelemetryStore();
	if (version === null) {
		store.envVersion = undefined;
		store.envVersionResolved = false;
		return;
	}
	store.envVersion = version;
	store.envVersionResolved = true;
}

/** develop/trial 输出脱敏正文；release 只保留元数据。 */
export function isVerboseClientTelemetry(): boolean {
	return resolveClientTelemetryEnvVersion() !== "release";
}

const SENSITIVE_KEY_NAMES = new Set([
	"accesstoken",
	"refreshtoken",
	"token",
	"authorization",
	"openid",
	"unionid",
	"sessionkey",
	"paysign",
	"noncestr",
	"prepayid",
	"payparams",
	"sign",
	"signature",
	"secret",
	"password",
	"ticket",
]);

const REDACTED_PLACEHOLDER = "[已脱敏]";
const MAX_REDACT_DEPTH = 4;
const MAX_REDACT_ARRAY_ITEMS = 8;
const MAX_REDACT_STRING_LENGTH = 200;
/** wx.login 的临时 code 是长随机串；业务成功封套没有同名长值，用长度区分。 */
const MIN_SENSITIVE_CODE_LENGTH = 16;

function normalizeSensitiveKey(key: string): string {
	return key.toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function isSensitiveKey(key: string): boolean {
	return SENSITIVE_KEY_NAMES.has(normalizeSensitiveKey(key));
}

function truncateClientValue(value: string): string {
	return value.length <= MAX_REDACT_STRING_LENGTH
		? value
		: `${value.slice(0, MAX_REDACT_STRING_LENGTH)}…[截断]`;
}

/**
 * 把任意调用方原值投影成可进控制台的低敏摘要。
 *
 * 这是"中转参数可排查"与"凭证不落日志"之间的边界：结构、数量和短值
 * 保留，敏感键名整值替换，深度、数组长度和字符串长度都有上限，循环
 * 引用折叠为固定标记。任何环境输出正文前都必须先经过这里。
 */
export function redactClientValue(
	value: unknown,
	depth = 0,
	seen: WeakSet<object> = new WeakSet(),
): unknown {
	if (value === null) return null;
	if (typeof value === "string") return truncateClientValue(value);
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return value;
	}
	if (typeof value !== "object") return `[${typeof value}]`;
	if (seen.has(value)) return "[Circular]";
	if (depth >= MAX_REDACT_DEPTH) return "[层级截断]";

	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const items = value
				.slice(0, MAX_REDACT_ARRAY_ITEMS)
				.map((item) => redactClientValue(item, depth + 1, seen));
			if (value.length > MAX_REDACT_ARRAY_ITEMS) {
				items.push(`[+${value.length - MAX_REDACT_ARRAY_ITEMS} 项]`);
			}
			return items;
		}
		const projected: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			const raw = (value as Record<string, unknown>)[key];
			if (raw === undefined) continue;
			if (isSensitiveKey(key)) {
				projected[key] = REDACTED_PLACEHOLDER;
				continue;
			}
			if (
				normalizeSensitiveKey(key) === "code" &&
				typeof raw === "string" &&
				raw.length >= MIN_SENSITIVE_CODE_LENGTH
			) {
				projected[key] = REDACTED_PLACEHOLDER;
				continue;
			}
			const projectedValue = redactClientValue(raw, depth + 1, seen);
			if (projectedValue !== undefined) projected[key] = projectedValue;
		}
		return projected;
	} finally {
		seen.delete(value);
	}
}

/**
 * 从页面方法参数里识别微信事件对象。tap、input、confirm 等用户交互的
 * 第一个参数带字符串 `type`；普通业务参数返回 undefined，由调用方决定
 * 是否按正文摘要输出。
 */
export function summarizeWxEventArg(
	arg: unknown,
): { eventType: string; detail: unknown; dataset: unknown } | undefined {
	if (typeof arg !== "object" || arg === null) return undefined;
	const record = arg as {
		type?: unknown;
		detail?: unknown;
		currentTarget?: unknown;
	};
	if (typeof record.type !== "string" || record.type.length === 0)
		return undefined;
	const dataset =
		typeof record.currentTarget === "object" && record.currentTarget !== null
			? (record.currentTarget as { dataset?: unknown }).dataset
			: undefined;
	return {
		eventType: record.type,
		detail: record.detail,
		dataset,
	};
}

function resolveRealtimeSink(): RealtimeLogSink | null {
	const store = getTelemetryStore();
	if (store.realtimeSink !== undefined) return store.realtimeSink ?? null;
	let sink: RealtimeLogSink | null = null;
	try {
		if (
			typeof wx !== "undefined" &&
			typeof wx.getRealtimeLogManager === "function"
		) {
			const manager = wx.getRealtimeLogManager() as unknown;
			if (
				typeof manager === "object" &&
				manager !== null &&
				typeof (manager as RealtimeLogSink).info === "function" &&
				typeof (manager as RealtimeLogSink).warn === "function"
			) {
				sink = manager as RealtimeLogSink;
			}
		}
	} catch {
		// 实时日志不可用不影响业务与控制台观测。
	}
	store.realtimeSink = sink;
	return sink;
}

/** 实时日志只带元数据；detail/dataset/正文摘要在任何环境都不上报。 */
function reportClientTelemetryRealtime(event: ClientTelemetryEvent): void {
	const sink = resolveRealtimeSink();
	if (!sink) return;
	const metadata: Record<string, unknown> = {
		kind: event.kind,
		...(event.route === undefined ? {} : { route: event.route }),
		...(event.method === undefined ? {} : { method: event.method }),
		...(event.action === undefined ? {} : { action: event.action }),
		...(event.target === undefined ? {} : { target: event.target }),
		...(event.eventType === undefined ? {} : { eventType: event.eventType }),
		...(event.outcome === undefined ? {} : { outcome: event.outcome }),
		...(event.errorName === undefined ? {} : { errorName: event.errorName }),
		...(event.fields === undefined ? {} : { fields: event.fields }),
	};
	try {
		if (event.outcome === "failed") {
			sink.warn("hospital", JSON.stringify(metadata));
		} else {
			sink.info("hospital", JSON.stringify(metadata));
		}
	} catch {
		// 实时日志写入失败不能影响任何调用方。
	}
	const numeric = event.fields?.errorCode;
	if (
		event.outcome === "failed" &&
		typeof numeric === "number" &&
		Number.isSafeInteger(numeric)
	) {
		registerRealtimeErrorFilter(sink, numeric);
	}
}

/**
 * 把数字错误码注册为实时日志过滤关键字，运维在公众平台"实时日志"里
 * 可以直接按用户口头反馈的数字过滤。微信平台限制追加条数，超限静默放弃。
 */
function registerRealtimeErrorFilter(
	sink: RealtimeLogSink,
	numeric: number,
): void {
	if (typeof sink.addFilterMsg !== "function") return;
	const store = getTelemetryStore();
	if ((store.realtimeFilterCount ?? 0) >= 10) return;
	try {
		sink.addFilterMsg(String(numeric));
		store.realtimeFilterCount = (store.realtimeFilterCount ?? 0) + 1;
	} catch {
		// 过滤关键字追加失败不影响观测与业务。
	}
}

function emitClientTelemetryConsole(event: ClientTelemetryEvent): void {
	try {
		if (event.outcome === "failed") {
			console.warn("[医院日志]", event);
		} else {
			console.info("[医院日志]", event);
		}
	} catch {
		// 某些真机调试容器可能禁用 console；观测失败不能改变业务结果。
	}
}

/**
 * 记录一条客户端遥测事件：写入共享环形缓冲、输出控制台并上报实时日志。
 * 任何一步失败都不会抛出，也不会改变调用方行为。
 */
export function recordClientTelemetryEvent(
	event: ClientTelemetryEventInput,
): void {
	const store = getTelemetryStore();
	const enriched: ClientTelemetryEvent = Object.freeze({
		...event,
		at: new Date().toISOString(),
	});
	store.events.push(enriched);
	if (store.events.length > MAX_RECENT_CLIENT_TELEMETRY_EVENTS) {
		store.events.splice(
			0,
			store.events.length - MAX_RECENT_CLIENT_TELEMETRY_EVENTS,
		);
	}
	emitClientTelemetryConsole(enriched);
	reportClientTelemetryRealtime(enriched);
}

/**
 * 记录事件但不重复输出控制台。`api.request` 已经由请求观测模块输出带
 * 前缀的控制台行，这里只让它进入统一事件流和实时日志。
 */
export function recordClientTelemetrySilentEvent(
	event: ClientTelemetryEventInput,
): void {
	const store = getTelemetryStore();
	const enriched: ClientTelemetryEvent = Object.freeze({
		...event,
		at: new Date().toISOString(),
	});
	store.events.push(enriched);
	if (store.events.length > MAX_RECENT_CLIENT_TELEMETRY_EVENTS) {
		store.events.splice(
			0,
			store.events.length - MAX_RECENT_CLIENT_TELEMETRY_EVENTS,
		);
	}
	reportClientTelemetryRealtime(enriched);
}

/** 返回副本，避免调用方修改内部事件顺序。 */
export function getRecentClientTelemetryEvents(): ClientTelemetryEvent[] {
	return [...getTelemetryStore().events];
}

/** 测试和重新开始一轮人工取证时清理旧事件。 */
export function clearClientTelemetryEvents(): void {
	getTelemetryStore().events.length = 0;
}

function pageRouteOrUndefined(route: unknown): string | undefined {
	return typeof route === "string" && route.length > 0 ? route : undefined;
}

/** 页面生命周期事件：路由 + 方法名即可还原用户走到了哪里。 */
export function logClientPageLifecycle(
	route: unknown,
	method: string,
	outcome: ClientTelemetryOutcome = "completed",
	errorName?: unknown,
): void {
	recordClientTelemetryEvent({
		kind: "page.lifecycle",
		...(pageRouteOrUndefined(route) === undefined
			? {}
			: { route: pageRouteOrUndefined(route) }),
		method,
		...(outcome === "completed" ? {} : { outcome }),
		...(typeof errorName === "string" && errorName.length > 0
			? { errorName }
			: {}),
	});
}

/**
 * 页面用户操作事件：点击、输入、滚动触发等页面方法调用。
 *
 * 事件摘要在正式版降级为方法名 + 事件类型；develop/trial 才附带脱敏的
 * detail 与 dataset，避免体验版/正式版的控制台或日志转发泄漏患者文本。
 */
export function logClientPageAction(
	route: unknown,
	method: string,
	arg?: unknown,
): void {
	const summary = summarizeWxEventArg(arg);
	const verbose = isVerboseClientTelemetry();
	recordClientTelemetryEvent({
		kind: "page.action",
		...(pageRouteOrUndefined(route) === undefined
			? {}
			: { route: pageRouteOrUndefined(route) }),
		method,
		...(summary ? { eventType: summary.eventType } : {}),
		...(verbose
			? {
					...(summary
						? {
								detail: redactClientValue(summary.detail),
								dataset: redactClientValue(summary.dataset),
							}
						: arg === undefined
							? {}
							: { detail: redactClientValue(arg) }),
				}
			: {}),
	});
}

/**
 * 从任意错误对象提取数字码关联字段。只做鸭子类型检查（code/numericCode/
 * requestId），不 import ApiError，保持 telemetry 可进入 App IIFE bundle。
 */
function clientErrorTelemetryFields(error: unknown): ClientTelemetryFields {
	if (typeof error !== "object" || error === null) {
		return { errorCode: UNKNOWN_NUMERIC_CODE };
	}
	const record = error as {
		code?: unknown;
		numericCode?: unknown;
		requestId?: unknown;
	};
	const code = typeof record.code === "string" ? record.code : "";
	const numeric =
		typeof record.numericCode === "number" &&
		Number.isSafeInteger(record.numericCode)
			? record.numericCode
			: resolveErrorNumericCode(code);
	const requestId =
		typeof record.requestId === "string" && record.requestId.length > 0
			? record.requestId
			: undefined;
	return {
		errorCode: numeric,
		...(code ? { errorKey: code } : {}),
		...(requestId ? { requestId } : {}),
	};
}

/** 页面方法执行失败：记录错误类型与数字码，保留原始异常给页面自身处理。 */
export function logClientPageFailure(
	kind: "page.action" | "page.lifecycle",
	route: unknown,
	method: string,
	error: unknown,
): void {
	recordClientTelemetryEvent({
		kind,
		...(pageRouteOrUndefined(route) === undefined
			? {}
			: { route: pageRouteOrUndefined(route) }),
		method,
		outcome: "failed",
		errorName: error instanceof Error ? error.name : "UnknownError",
		fields: clientErrorTelemetryFields(error),
	});
}

/**
 * 原始错误被转换、替换或吞没前的最后事实。
 *
 * 旧链路里有若干固定位置会把具体错误换成通用文案（命令型 401 的
 * session-changed 替换、资料仓库的会话代际替换、确认页的患者上下文
 * 兜底等）；转换本身是安全边界，不能取消，但转换前的数字码必须留痕，
 * 否则用户看到的错误码永远指向替换后的泛化原因。`stage` 使用
 * `模块.位置` 命名，例如 `api-client.command-session-retry`。
 */
export function logClientErrorTransformed(stage: string, error: unknown): void {
	recordClientTelemetryEvent({
		kind: "error.transformed",
		method: stage,
		outcome: "failed",
		errorName: error instanceof Error ? error.name : "UnknownError",
		fields: clientErrorTelemetryFields(error),
	});
}

/**
 * 导航事件：记录跳转 API 与目标路径。查询串在客户端观测里按请求路径
 * 同一规则剥离，避免把 opaque 引用或筛选参数扩散到日志。
 */
export function logClientNavigation(
	action: string,
	url: unknown,
	outcome: ClientTelemetryOutcome = "completed",
	errorName?: unknown,
): void {
	recordClientTelemetryEvent({
		kind: "navigation",
		action,
		...(typeof url === "string" && url.length > 0
			? { target: sanitizeNavigationTarget(url) }
			: {}),
		...(outcome === "completed" ? {} : { outcome }),
		...(typeof errorName === "string" && errorName.length > 0
			? { errorName }
			: {}),
	});
}

/** 导航目标只保留路径；query/fragment 一律剥离，非内部路径折叠为 unknown。 */
export function sanitizeNavigationTarget(url: string): string {
	const path = url.split(/[?#]/u, 1)[0] ?? "";
	if (!path.startsWith("/") || path.length > 256) return "/unknown";
	return path;
}
