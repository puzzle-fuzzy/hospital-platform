import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const AES_ALGORITHM = "aes-256-gcm";
const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;
const CIPHER_VERSION = "v1";

export type SecretValueCipher = {
	seal(value: string): string;
	open(value: string): string;
};

function decodeKey(value: string): Buffer {
	const key = Buffer.from(value.trim(), "base64");
	if (key.byteLength !== AES_KEY_BYTES) {
		throw new Error("PAYMENT_DATA_ENCRYPTION_KEY must decode to 32 bytes");
	}
	return key;
}

function encode(value: Uint8Array): string {
	return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
	return Buffer.from(value, "base64url");
}

/**
 * 只用于支付调起参数等短期敏感值的持久化保护；密钥由部署环境注入，
 * 不写入数据库、日志、outbox 或小程序。密文格式带版本，便于未来轮换算法。
 */
export function createAesGcmSecretValueCipher(
	base64Key: string,
): SecretValueCipher {
	const key = decodeKey(base64Key);

	return {
		seal(value) {
			const iv = randomBytes(AES_IV_BYTES);
			const cipher = createCipheriv(AES_ALGORITHM, key, iv);
			const ciphertext = Buffer.concat([
				cipher.update(value, "utf8"),
				cipher.final(),
			]);
			return [
				CIPHER_VERSION,
				encode(iv),
				encode(cipher.getAuthTag()),
				encode(ciphertext),
			].join(".");
		},
		open(value) {
			const [version, encodedIv, encodedTag, encodedCiphertext] =
				value.split(".");
			if (
				version !== CIPHER_VERSION ||
				!encodedIv ||
				!encodedTag ||
				!encodedCiphertext
			) {
				throw new Error("Encrypted payment value has an unsupported format");
			}
			const iv = decode(encodedIv);
			const tag = decode(encodedTag);
			const ciphertext = decode(encodedCiphertext);
			if (
				iv.byteLength !== AES_IV_BYTES ||
				tag.byteLength !== AES_TAG_BYTES ||
				ciphertext.byteLength === 0
			) {
				throw new Error("Encrypted payment value has invalid lengths");
			}

			const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
			decipher.setAuthTag(tag);
			return Buffer.concat([
				decipher.update(ciphertext),
				decipher.final(),
			]).toString("utf8");
		},
	};
}
