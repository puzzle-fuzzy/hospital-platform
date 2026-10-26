import type {
	AdapterCallContext,
	OutpatientElectronicInvoiceResourceContent,
	OutpatientElectronicInvoiceResourceGateway,
} from "@hospital/domain";
import { normalizeAdapterCallContext } from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import type { ProviderFetcher } from "./http";

const OPERATION = "outpatient-electronic-invoice-resource";
const DEFAULT_ORIGIN = "http://111.111.111.52:18003";
const RELAY_ORIGIN = "https://gpsrmyy.meiyi.pro";
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 12 * 1024 * 1024;
const MAX_URL_LENGTH = 20_000;
const MAX_TIMEOUT_MS = 20_000;
type ContentType = OutpatientElectronicInvoiceResourceContent["contentType"];

export type ZhongyangOutpatientElectronicInvoiceResourceGatewayOptions = {
	/** 部署方显式批准的票据源；不接受来自请求参数的 origin。 */
	allowedOrigins?: readonly string[];
	/** 已部署的受信医院中转；仅允许固定 HTTPS 来源，不能来自客户端参数。 */
	relayBaseUrl?: string;
	fetcher?: ProviderFetcher;
};

function failure(
	message: string,
	context: AdapterCallContext | undefined,
	options: {
		unsupported?: boolean;
		stage?: "validation" | "transport" | "http" | "response";
		statusCode?: number;
	} = {},
): ProviderRequestError {
	const stage = options.stage ?? "response";
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: OPERATION,
		message,
		...(context?.traceId ? { requestId: context.traceId } : {}),
		failureStage: stage,
		requestOutcome:
			stage === "validation"
				? "not_sent"
				: stage === "transport"
					? "unknown"
					: "rejected",
		responseInvalid: stage === "response",
		retryable: stage === "transport" || (options.statusCode ?? 0) >= 500,
		...(options.statusCode === undefined
			? {}
			: { statusCode: options.statusCode }),
		...(options.unsupported
			? { providerErrorCode: "INVOICE_RESOURCE_UNSUPPORTED" }
			: {}),
	});
}

function configuredOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	if (
		!/^https?:$/u.test(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	) {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	return url.origin;
}

function configuredRelay(value: string | undefined): URL | undefined {
	if (value === undefined) return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	if (
		url.origin !== RELAY_ORIGIN ||
		url.username ||
		url.password ||
		url.hash ||
		url.search ||
		url.pathname !== "/"
	) {
		throw new AdapterNotConfiguredError("zhongyang");
	}
	return url;
}

function ciphertext(value: string | null): boolean {
	return (
		value !== null &&
		value.length % 2 === 0 &&
		/^[0-9a-f]{2,16384}$/iu.test(value)
	);
}

function validateUrl(
	value: string,
	origins: ReadonlySet<string>,
	context: AdapterCallContext,
	base?: URL,
): { url: URL; html: boolean } {
	if (
		!value ||
		value.length > MAX_URL_LENGTH ||
		Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x20 || code === 0x7f || character === "\\";
		})
	) {
		throw failure("Invoice resource URL was invalid", context, {
			stage: "validation",
		});
	}
	let url: URL;
	try {
		url = new URL(value, base);
	} catch {
		throw failure("Invoice resource URL was invalid", context, {
			stage: "validation",
		});
	}
	if (
		!origins.has(url.origin) ||
		url.username ||
		url.password ||
		url.hash ||
		(base && url.origin !== base.origin)
	) {
		throw failure("Invoice resource origin was not allowed", context, {
			stage: "validation",
		});
	}
	const html = url.pathname === "/medical-web/industryMain.do";
	const keys = [...url.searchParams.keys()];
	const validQuery = html
		? keys.length === 2 &&
			keys.includes("method") &&
			keys.includes("ciphertext") &&
			url.searchParams.get("method") === "displayH5" &&
			ciphertext(url.searchParams.get("ciphertext"))
		: keys.length === 0 ||
			(keys.length === 1 &&
				keys[0] === "ciphertext" &&
				ciphertext(url.searchParams.get("ciphertext")));
	if (
		!validQuery ||
		(!html &&
			!/^\/medical-web\/[A-Za-z0-9/_-]+\.(?:png|jpe?g|pdf)$/iu.test(
				url.pathname,
			)) ||
		(base && html)
	) {
		throw failure("Invoice resource path or query was not allowed", context, {
			stage: "validation",
		});
	}
	return { url, html };
}

function contentType(body: Uint8Array): ContentType | undefined {
	if (
		body.length >= 8 &&
		[137, 80, 78, 71, 13, 10, 26, 10].every(
			(value, index) => body[index] === value,
		)
	) {
		return "image/png";
	}
	if (body.length >= 3 && body[0] === 255 && body[1] === 216 && body[2] === 255)
		return "image/jpeg";
	if (
		body.length >= 5 &&
		[37, 80, 68, 70, 45].every((value, index) => body[index] === value)
	) {
		return "application/pdf";
	}
	return undefined;
}

function resource(
	body: Uint8Array,
	declared: string,
	context: AdapterCallContext,
): OutpatientElectronicInvoiceResourceContent {
	const actual = contentType(body);
	if (
		!actual ||
		body.byteLength > MAX_RESOURCE_BYTES ||
		(actual !== declared && declared !== "application/octet-stream")
	) {
		throw failure("Invoice resource content was invalid", context);
	}
	return { body, contentType: actual };
}

function embeddedResource(
	value: string,
	context: AdapterCallContext,
): OutpatientElectronicInvoiceResourceContent | undefined {
	const match =
		/^data:(image\/png|image\/jpeg|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/iu.exec(
			value,
		);
	if (!match) return undefined;
	const encoded = match[2] ?? "";
	if (encoded.length > Math.ceil(MAX_RESOURCE_BYTES / 3) * 4) {
		throw failure("Invoice embedded resource was too large", context);
	}
	const body = Uint8Array.from(Buffer.from(encoded, "base64"));
	if (Buffer.from(body).toString("base64") !== encoded) {
		throw failure("Invoice embedded resource encoding was invalid", context);
	}
	return resource(body, (match[1] ?? "").toLowerCase(), context);
}

/** 清理不能延长查看请求的截止时间；中转提供的流可能永不完成 cancel。 */
function cancelWithoutWaiting(cancel: () => unknown): void {
	try {
		void Promise.resolve(cancel()).catch(() => {});
	} catch {
		// 清理的同步异常同样不能覆盖原始的大小、HTTP 或超时错误。
	}
}

async function boundedBody(
	response: Response,
	maximum: number,
	context: AdapterCallContext,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const length = response.headers.get("content-length");
	if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) {
		cancelWithoutWaiting(() => response.body?.cancel());
		throw failure("Invoice response length was invalid", context);
	}
	if (!response.body) throw failure("Invoice response was empty", context);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await abortable(reader.read(), signal);
			if (done) break;
			total += value.byteLength;
			if (total > maximum) {
				throw failure("Invoice response was too large", context);
			}
			chunks.push(value);
		}
	} catch (error) {
		cancelWithoutWaiting(() => reader.cancel(error));
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (total === 0) throw failure("Invoice response was empty", context);
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

/** 自定义中转 fetcher 也受总截止时间约束，不能依赖它自行实现 signal。 */
async function abortable<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	signal.throwIfAborted();
	let onAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
	}
}

/**
 * 仅实现医院 H5 的安全静态子集：直接影像/PDF、明确标签中的内嵌资源或同源资源。
 * 实际医院 H5 尚未完成可达性核验；无法静态提取时明确返回不支持，不执行 JS、不伪造票据。
 */
export function createZhongyangOutpatientElectronicInvoiceResourceGateway(
	options: ZhongyangOutpatientElectronicInvoiceResourceGatewayOptions = {},
): OutpatientElectronicInvoiceResourceGateway {
	const origins = new Set(
		(options.allowedOrigins ?? [DEFAULT_ORIGIN]).map(configuredOrigin),
	);
	const fetcher = options.fetcher ?? fetch;
	const relay = configuredRelay(options.relayBaseUrl);
	return {
		async fetchResource(input, context) {
			const normalizedContext = normalizeAdapterCallContext(context);
			if (!normalizedContext || typeof input !== "object" || input === null) {
				throw failure("Invoice resource context was invalid", context, {
					stage: "validation",
				});
			}
			// Prefer the hospital's network resource, falling back only when absent.
			const candidate = [input.pictureNetUrl, input.pictureUrl].find(
				(value) => typeof value === "string" && value !== "-1" && value !== "",
			);
			if (!candidate) {
				throw failure(
					"Hospital has not supplied an invoice resource",
					context,
					{
						unsupported: true,
					},
				);
			}
			const embedded = embeddedResource(candidate, normalizedContext);
			if (embedded) return embedded;
			const initial = validateUrl(candidate, origins, normalizedContext);
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(),
				Math.min(normalizedContext.timeoutMs ?? MAX_TIMEOUT_MS, MAX_TIMEOUT_MS),
			);
			const onAbort = () => controller.abort();
			if (normalizedContext.signal?.aborted) controller.abort();
			else
				normalizedContext.signal?.addEventListener("abort", onAbort, {
					once: true,
				});
			const load = async (url: URL, html: boolean) => {
				controller.signal.throwIfAborted();
				let transportUrl = url;
				if (relay) {
					transportUrl = new URL("/proxy/forward", relay);
					transportUrl.searchParams.set("url", url.toString());
					transportUrl.searchParams.set("download", "false");
				}
				const response = await abortable(
					fetcher(transportUrl, {
						method: "GET",
						headers: {
							Accept: html
								? "text/html, image/png, image/jpeg, application/pdf"
								: "image/png, image/jpeg, application/pdf",
						},
						// 只禁止 API -> 票据源/中转这一跳的重定向。现有中转内
						// 部 HTTP 客户端属于已部署的受信 transport 边界。
						redirect: "manual",
						credentials: "omit",
						signal: controller.signal,
					}),
					controller.signal,
				);
				if (!response.ok) {
					cancelWithoutWaiting(() => response.body?.cancel());
					throw failure(
						"Hospital invoice resource request failed",
						normalizedContext,
						{
							stage: "http",
							statusCode: response.status,
						},
					);
				}
				const declared =
					(response.headers.get("content-type") ?? "")
						.split(";", 1)[0]
						?.trim()
						.toLowerCase() ?? "";
				const isHtml = html && declared === "text/html";
				const body = await boundedBody(
					response,
					isHtml ? MAX_HTML_BYTES : MAX_RESOURCE_BYTES,
					normalizedContext,
					controller.signal,
				);
				return { body, declared, isHtml };
			};
			try {
				const response = await load(initial.url, initial.html);
				if (!response.isHtml)
					return resource(response.body, response.declared, normalizedContext);
				let decoded: string;
				try {
					decoded = new TextDecoder("utf-8", { fatal: true }).decode(
						response.body,
					);
				} catch {
					throw failure(
						"Hospital invoice page encoding was invalid",
						normalizedContext,
					);
				}
				const html = decoded
					.replace(/<!--[\s\S]*?-->/gu, "")
					.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
				const candidates = new Set<string>();
				for (const tag of html.matchAll(/<(?:img|embed|iframe)\b[^>]*>/giu)) {
					const matches = [
						...tag[0].matchAll(/\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/giu),
					];
					if (matches.length !== 1) continue;
					const value = (matches[0]?.[1] ?? matches[0]?.[2] ?? "").replaceAll(
						"&amp;",
						"&",
					);
					if (value) candidates.add(value);
				}
				if (candidates.size !== 1) {
					throw failure(
						"Hospital invoice page has no unambiguous supported resource",
						normalizedContext,
						{ unsupported: true },
					);
				}
				const source = [...candidates][0] ?? "";
				const data = embeddedResource(source, normalizedContext);
				if (data) return data;
				if (/^data:/iu.test(source)) {
					throw failure(
						"Hospital invoice page resource format was not supported",
						normalizedContext,
						{ unsupported: true },
					);
				}
				const linked = validateUrl(
					source,
					origins,
					normalizedContext,
					initial.url,
				);
				const linkedResponse = await load(linked.url, false);
				return resource(
					linkedResponse.body,
					linkedResponse.declared,
					normalizedContext,
				);
			} catch (error) {
				if (error instanceof ProviderRequestError) throw error;
				throw failure(
					"Hospital invoice resource could not be read",
					normalizedContext,
					{ stage: "transport" },
				);
			} finally {
				clearTimeout(timeout);
				normalizedContext.signal?.removeEventListener("abort", onAbort);
			}
		},
	};
}
