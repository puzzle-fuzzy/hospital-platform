import type { ApiNetworkFailureReason } from "./api-request-observability";

/** 票据只接受可由微信原生预览的影像；网页和 JSON 不能当作图片打开。 */
export const MAX_OUTPATIENT_INVOICE_RESOURCE_BYTES = 8 * 1024 * 1024;

export type OutpatientInvoiceResource = {
	tempFilePath: string;
	kind: "image" | "pdf";
};

/** 只保留固定网络类别，原始微信错误可能包含 URL 或其他敏感值。 */
export function classifyInvoiceResourceNetworkFailure(error: unknown): {
	networkFailureReason: ApiNetworkFailureReason;
	networkErrorCode?: number;
} {
	const value =
		typeof error === "object" && error !== null
			? (error as { errMsg?: unknown; errCode?: unknown })
			: {};
	const message =
		typeof value.errMsg === "string" ? value.errMsg.slice(0, 1024) : "";
	const networkFailureReason = /timeout|timed out|超时/iu.test(message)
		? "timeout"
		: /not in (?:the )?domain list|domain(?:name)? (?:not allowed|not configured)|合法域名/iu.test(
					message,
				)
			? "domain-not-allowed"
			: /ssl|tls|certificate|证书/iu.test(message)
				? "tls-failed"
				: /dns|resolve|name or service not known|域名解析/iu.test(message)
					? "dns-failed"
					: /abort|cancel|取消/iu.test(message)
						? "aborted"
						: /connect|network|socket|offline|网络|连接/iu.test(message)
							? "connection-failed"
							: "unknown";
	return {
		networkFailureReason,
		...(typeof value.errCode === "number" &&
		Number.isSafeInteger(value.errCode) &&
		Math.abs(value.errCode) <= 1_000_000
			? { networkErrorCode: value.errCode }
			: {}),
	};
}

/** 微信真机不保证提供 TextDecoder；只在 64 KiB 内严格解码错误封套。 */
export function invoiceResourceErrorData(data: unknown): unknown {
	if (!(data instanceof ArrayBuffer) || data.byteLength > 65_536) return {};
	try {
		const encoded = Array.from(
			new Uint8Array(data),
			(byte) => `%${byte.toString(16).padStart(2, "0")}`,
		).join("");
		return JSON.parse(decodeURIComponent(encoded)) as unknown;
	} catch {
		return {};
	}
}

let resourceFileSequence = 0;

/** 保存前后均验真；保存失败（包括部分写入）时回收本次独立文件。 */
export function saveOutpatientInvoiceResource(
	data: ArrayBuffer,
	mime: string,
	sessionGeneration: number,
): OutpatientInvoiceResource {
	const bytes = new Uint8Array(data);
	if (
		data.byteLength < 8 ||
		data.byteLength > MAX_OUTPATIENT_INVOICE_RESOURCE_BYTES ||
		invoiceResourceMimeType(bytes) !== mime
	) {
		throw new Error("Invoice resource content is unsupported");
	}
	const extension =
		mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpg" : "pdf";
	const filePath = `${wx.env.USER_DATA_PATH}/invoice-resource-${sessionGeneration}-${Date.now()}-${++resourceFileSequence}.${extension}`;
	try {
		wx.getFileSystemManager().writeFileSync(filePath, data);
		if (readOutpatientInvoiceResourceType(filePath) !== mime) {
			throw new Error("Saved invoice resource does not match its type");
		}
		return {
			tempFilePath: filePath,
			kind: extension === "pdf" ? "pdf" : "image",
		};
	} catch (error) {
		removeOutpatientInvoiceResource(filePath);
		throw error;
	}
}

export function invoiceResourceMimeType(bytes: Uint8Array): string | undefined {
	if (
		bytes.length >= 8 &&
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
			(value, index) => bytes[index] === value,
		)
	) {
		return "image/png";
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return "image/jpeg";
	if (
		bytes.length >= 5 &&
		[0x25, 0x50, 0x44, 0x46, 0x2d].every(
			(value, index) => bytes[index] === value,
		)
	) {
		return "application/pdf";
	}
	return undefined;
}

/** 路径只来源于本次平台资源或本页生成的文件，从不接受医院 URL。 */
export function removeOutpatientInvoiceResource(filePath: string): void {
	if (!filePath) return;
	try {
		wx.getFileSystemManager().unlinkSync(filePath);
	} catch {
		// 微信可能已回收临时文件；清理失败不改变票据原始状态。
	}
}

/** 在有界文件头上辨认真实内容，不能仅信 HTTP Content-Type。 */
export function readOutpatientInvoiceResourceType(filePath: string): string {
	const fs = wx.getFileSystemManager();
	const stat = fs.statSync(filePath);
	if (
		Array.isArray(stat) ||
		!Number.isSafeInteger(stat.size) ||
		stat.size < 8 ||
		stat.size > MAX_OUTPATIENT_INVOICE_RESOURCE_BYTES
	) {
		throw new Error("Invoice resource size is invalid");
	}
	const head = fs.readFileSync(filePath, undefined, 0, Math.min(stat.size, 16));
	const mime =
		typeof head === "string"
			? undefined
			: invoiceResourceMimeType(new Uint8Array(head));
	if (!mime) throw new Error("Invoice resource content is unsupported");
	return mime;
}
