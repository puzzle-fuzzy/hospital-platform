import { createHmac, randomUUID } from "node:crypto";
import { AdapterNotConfiguredError } from "./errors";

/**
 * 签名的合作方标识必须来自实际透传路径，不引入与 URL 分叉的第二份配置。
 * 只接受固定接口前缀和单个 unreserved 段，拒绝编码、路径规范化和查询歧义。
 */
export function resolveWechatMedicalUserQueryPartnerId(path: string): string {
	const match =
		/^\/api\/mipuserquery\/userQuery\/([A-Za-z0-9._~-]{1,128})$/u.exec(path);
	const partnerId = match?.[1];
	if (
		match?.[0] !== path ||
		!partnerId ||
		partnerId === "." ||
		partnerId === ".."
	) {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
	return partnerId;
}

/**
 * 腾讯官方 userQuery Java 示例：UTF-8 密钥，partnerId + 毫秒时间戳，
 * HmacSHA256 输出小写十六进制。partnerSecret 只作为 HMAC key，不进入报文。
 */
export function createWechatMedicalUserQueryHeaders(input: {
	path: string;
	partnerSecret?: string | undefined;
	now?: () => Date;
}): Readonly<Record<string, string>> {
	const partnerId = resolveWechatMedicalUserQueryPartnerId(input.path);
	const partnerSecret = input.partnerSecret?.trim();
	if (!partnerSecret) {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
	const timestamp = String((input.now?.() ?? new Date()).getTime());
	if (!/^\d{13}$/u.test(timestamp)) {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
	return {
		"god-portal-timestamp": timestamp,
		"god-portal-request-id": randomUUID().replaceAll("-", ""),
		"god-portal-signature": createHmac("sha256", partnerSecret)
			.update(partnerId + timestamp, "utf8")
			.digest("hex"),
	};
}
