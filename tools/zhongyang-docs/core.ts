import { createHash } from "node:crypto";
import type { NetworkObservation, QueryCapture, QueryStatus } from "./types";

const SENSITIVE_KEY_PATTERN =
	/(authorization|token|access[-_]?token|refresh[-_]?token|id[-_]?token|password|passwd|secret|cookie|set[-_]?cookie|private[-_]?key|certificate|signature|sign|session[-_]?key|api[-_]?key|openid|unionid|idcard|identity|card[-_]?no|mobile|phone)/iu;
const SENSITIVE_VALUE_PATTERN =
	/(bearer\s+[a-z0-9._~+/=-]+|eyj[a-z0-9._~-]+|(?:token|secret|password|passwd|signature|sign|cookie|session[_-]?key)\s*[:=]\s*[^\s,;]+|\b1[3-9]\d{9}\b|\b[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9xX]\b)/giu;
const REDACTED = "[REDACTED]";
const MAX_TEXT_LENGTH = 200_000;
const MAX_STRING_LENGTH = 10_000;
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_ITEMS = 200;
const MAX_DEPTH = 20;

export function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sanitizeText(
	value: string,
	maxLength = MAX_TEXT_LENGTH,
): string {
	const redacted = value.replace(SENSITIVE_VALUE_PATTERN, REDACTED);
	const withoutControls = Array.from(redacted)
		.filter((character) => {
			const code = character.charCodeAt(0);
			return code === 9 || code === 10 || code === 13 || code >= 32;
		})
		.join("");
	return withoutControls.length > maxLength
		? `${withoutControls.slice(0, maxLength)}\n[TRUNCATED]`
		: withoutControls;
}

export function sanitizeUrl(value: string): string {
	try {
		const url = new URL(value);
		for (const key of [...url.searchParams.keys()]) {
			if (SENSITIVE_KEY_PATTERN.test(key)) url.searchParams.set(key, REDACTED);
		}
		return url.toString();
	} catch {
		return sanitizeText(value, 2_000);
	}
}

function sanitizeValue(value: unknown, depth: number): unknown {
	if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
	if (typeof value === "string") return sanitizeText(value, MAX_STRING_LENGTH);
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return value;
	}
	if (Array.isArray(value)) {
		return value
			.slice(0, MAX_ARRAY_ITEMS)
			.map((item) => sanitizeValue(item, depth + 1));
	}
	if (typeof value !== "object") return String(value);

	const output: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
		output[key] = SENSITIVE_KEY_PATTERN.test(key)
			? REDACTED
			: sanitizeValue(child, depth + 1);
	}
	if (Object.keys(value).length > MAX_OBJECT_KEYS) output.__truncated = true;
	return output;
}

export function sanitizeNetworkBody(value: string): unknown {
	try {
		return sanitizeValue(JSON.parse(value) as unknown, 0);
	} catch {
		return sanitizeText(value, MAX_STRING_LENGTH);
	}
}

export function sanitizeNetworkObservation(
	observation: NetworkObservation,
): NetworkObservation {
	return {
		...observation,
		url: sanitizeUrl(observation.url),
		...(observation.body === undefined
			? {}
			: { body: sanitizeValue(observation.body, 0) }),
	};
}

export type QueryClassificationInput = {
	visibleText: string;
	matchedResultCount: number;
	responseStatuses: readonly number[];
};

const CAPTCHA_MARKERS = [
	"验证码",
	"人机验证",
	"安全验证",
	"滑动验证",
	"captcha",
	"verify you are human",
];
const SESSION_MARKERS = [
	"登录已过期",
	"会话已过期",
	"请重新登录",
	"session expired",
	"sign in again",
	"unauthorized",
];
const DENIED_MARKERS = [
	"没有权限",
	"无权限",
	"权限不足",
	"未授权",
	"无权访问",
	"access denied",
	"forbidden",
	"permission denied",
];
const NOT_FOUND_MARKERS = [
	"暂无数据",
	"暂无结果",
	"没有搜索结果",
	"未找到",
	"无搜索结果",
	"no results",
	"not found",
];

function containsMarker(text: string, markers: readonly string[]): boolean {
	const normalized = text.toLocaleLowerCase();
	return markers.some((marker) =>
		normalized.includes(marker.toLocaleLowerCase()),
	);
}

export function classifyQuery(input: QueryClassificationInput): QueryStatus {
	if (containsMarker(input.visibleText, CAPTCHA_MARKERS))
		return "captcha_required";
	if (
		input.responseStatuses.some((status) => status === 401) ||
		containsMarker(input.visibleText, SESSION_MARKERS)
	) {
		return "session_expired";
	}
	if (
		input.responseStatuses.some((status) => status === 403) ||
		containsMarker(input.visibleText, DENIED_MARKERS)
	) {
		return "explicit_denied";
	}
	if (input.matchedResultCount > 0) return "found";
	if (containsMarker(input.visibleText, NOT_FOUND_MARKERS)) return "not_found";
	return "unknown";
}

function safeDocumentId(query: string): string {
	const slug = query
		.toLocaleLowerCase()
		.replace(/[^a-z0-9.]+/giu, "-")
		.replace(/^-+|-+$/gu, "");
	return slug
		? `zhongyang-interface-${slug}`
		: `zhongyang-interface-query-${sha256(query).slice(0, 12)}`;
}

function codeBlock(value: string): string {
	return `\`\`\`\`text\n${value.split("````").join("` ` ` `")}\n\`\`\`\``;
}

export function captureFingerprint(capture: QueryCapture): string {
	return sha256(
		JSON.stringify({
			query: capture.query,
			title: capture.title,
			pageUrl: capture.pageUrl,
			visibleText: capture.visibleText,
			resultLabels: capture.resultLabels,
			network: capture.network.map(sanitizeNetworkObservation),
		}),
	);
}

export function createIntakeMarkdown(capture: QueryCapture): string {
	const fingerprint = captureFingerprint(capture);
	const documentId = safeDocumentId(capture.query);
	const network = capture.network.map(sanitizeNetworkObservation);
	return `# 众阳接口文档采集草稿：${capture.query}

> 当前状态：\`normalized\`
> 查询状态：\`${capture.status}\`
> 文档采集工具只读取授权用户在官方门户中可见的内容；本记录不是生产授权证明。

## 1. Contract 元数据

| 项目 | 内容 |
| --- | --- |
| documentId | \`${documentId}\` |
| 查询编号 | \`${capture.query}\` |
| 页面标题 | ${capture.title || "未读取到"} |
| 页面地址 | ${capture.pageUrl} |
| 采集时间 | ${capture.capturedAt} |
| 文档版本/发布日期 | 门户未显式提供；待 Provider/院方确认 |
| 脱敏采集结果 SHA-256 | \`${fingerprint}\` |
| 适用环境 | 官方文档门户；具体环境仍需 Provider/院方确认 |
| 查询结果 | \`${capture.status}\` |

## 1.1 来源指纹登记

| documentId | 来源内容 | SHA-256 | 状态 |
| --- | --- | --- | --- |
| \`${documentId}\` | 当前官方门户的脱敏页面文本和页面网络响应摘要 | \`${fingerprint}\` | \`normalized\` |

## 2. 页面提取内容

${codeBlock(capture.visibleText || "页面没有可提取的可见文本")}

## 3. 观察到的页面网络响应

${codeBlock(JSON.stringify(network, null, 2))}

## 4. 脱敏边界与限制

- Authorization、Cookie、Token、密码、签名、证书、身份证、手机号和卡号等敏感值已替换为 \`[REDACTED]\`。
- 采集结果只代表当前登录账号在当前门户环境中的可见内容，不能推导其它医院、租户或账号的权限。
- 页面搜索无结果不能等价为未授权；只有门户明确返回拒绝时才记录为 \`explicit_denied\`。
- 原始浏览器 profile、Cookie、localStorage 和未脱敏报文不进入 Git，也不写入业务 API、数据库或日志。

## 5. 当前冻结边界

- 本草稿只用于 Provider 文档接收和 contract diff，不自动新增 adapter、API、migration 或业务 gate。
- 参数、返回字段、错误码和状态机仍需人工复核；页面内容不自动视为正式 contract。
- 任何写入型、支付、医保、退款或 HIS 接口仍保持未开放。

## 6. 下一步执行顺序

1. 由 Provider/院方确认文档版本、适用环境、鉴权方式和字段授权。
2. 复核请求/响应参数、错误码、幂等、超时和最终状态查询语义。
3. 取得脱敏成功、无权限、空结果和异常样例后，再决定是否建立 versioned contract。
4. 通过 contract、adapter、测试和真实只读验收后，才允许进入业务迁移流程。

${capture.notes.length > 0 ? `## 7. 采集备注\n\n${capture.notes.map((note) => `- ${note}`).join("\n")}\n` : ""}`;
}

export function classifyErrorStatus(message: string): QueryStatus {
	if (containsMarker(message, CAPTCHA_MARKERS)) return "captcha_required";
	if (containsMarker(message, SESSION_MARKERS)) return "session_expired";
	if (containsMarker(message, DENIED_MARKERS)) return "explicit_denied";
	return "upstream_error";
}
