/** 票据只接受可由微信原生预览的影像；网页和 JSON 不能当作图片打开。 */
export const MAX_OUTPATIENT_INVOICE_RESOURCE_BYTES = 8 * 1024 * 1024;

export type OutpatientInvoiceResource = {
	tempFilePath: string;
	kind: "image" | "pdf";
};

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

/** 路径只来源于本次 downloadFile 或本页生成的文件，从不接受医院 URL。 */
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
