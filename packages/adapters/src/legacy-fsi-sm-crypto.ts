import type { AdapterCallContext } from "@hospital/domain";
import {
	LegacyFsiContractError,
	type LegacyFsiInfno,
} from "./legacy-fsi-contract";
import {
	type LegacyFsiCryptoGateway,
	type LegacyFsiOpenedPayload,
	type LegacyFsiSealedEnvelope,
	validateLegacyFsiSealedEnvelope,
} from "./legacy-fsi-crypto";
import { sm2, sm4 } from "./vendor-sm-crypto";

/**
 * 山西医保移动支付封套的 sm-crypto 实现。
 *
 * 行为逐项对齐旧项目 `app/api/v1/module_common/mbs_fsi/crypto.py`（MbsCrypto），
 * 后者又是山西规范 v1.3.35 §5.6.5 与国标 V2.2.5 §2.3 的落地：
 * - 签名串：剔除 signData/encData/extra，键 ASCII 升序，值递归剔空值后以
 *   紧凑 JSON（键升序、不转义中文）参与拼接，末尾拼 `&key=appSecret`；
 * - SM2：SM3withSM2（含 userId ZA），私钥 32 字节，签名输出 r‖s 64 字节 Base64；
 * - SM4：ECB + PKCS7；报文密钥 = 用 appId 前 16 字节 ASCII 作 key 加密 appSecret，
 *   密文 hex 大写后取前 16 个字符的 ASCII 字节（16 字节）；
 * - seal 顺序：先对含明文 data 的报文签名，再加密 data 并清空，得到
 *   {appId, encType, signType, version, timestamp, encData, signData}。
 *
 * 该实现只提供算法行为；接线、relay 鉴权和 gate 仍由组合根控制，
 * 未注入配置前不得发起任何真实医保请求。
 */

const EXCLUDED_FROM_SIGN = new Set(["signData", "encData", "extra"]);
const ENVELOPE_VERSION = "2.0.1";

function contractError(infno: LegacyFsiInfno, message: string): never {
	throw new LegacyFsiContractError(infno, message);
}

/** 递归剔除空值：null、空字符串、空对象、空数组；布尔值保留。 */
export function cleanLegacyFsiSignValue(value: unknown): unknown {
	if (value === null || value === "") return null;
	if (typeof value === "boolean") return value;
	if (Array.isArray(value)) {
		const cleaned = value
			.map((item) => cleanLegacyFsiSignValue(item))
			.filter((item) => item !== null);
		return cleaned;
	}
	if (typeof value === "object") {
		return cleanLegacyFsiSignObject(value as Record<string, unknown>);
	}
	return value;
}

export function cleanLegacyFsiSignObject(
	input: Record<string, unknown>,
): Record<string, unknown> | null {
	const result: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(input)) {
		const cleaned = cleanLegacyFsiSignValue(raw);
		if (cleaned === null) continue;
		if (typeof cleaned === "object" && cleaned !== null) {
			if (Array.isArray(cleaned) && cleaned.length === 0) continue;
			if (!Array.isArray(cleaned) && Object.keys(cleaned).length === 0) {
				continue;
			}
		}
		result[key] = cleaned;
	}
	return Object.keys(result).length > 0 ? result : null;
}

/**
 * 紧凑 JSON 序列化：键递归升序、无空格分隔、不转义中文。
 * 与 Python `json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(",", ":"))`
 * 对已剔除空值的结构逐字节一致。
 */
export function legacyFsiCompactJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => legacyFsiCompactJson(item)).join(",")}]`;
	}
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
		);
		return `{${entries
			.map(([k, v]) => `${JSON.stringify(k)}:${legacyFsiScalarJson(v)}`)
			.join(",")}}`;
	}
	return legacyFsiScalarJson(value);
}

function legacyFsiScalarJson(value: unknown): string {
	if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
		return legacyFsiCompactJson(value);
	}
	return JSON.stringify(value) ?? "null";
}

/** 本地时间 yyyyMMddHHmmss，与旧 MbsCrypto 的 datetime.now() 口径一致。 */
export function localLegacyFsiTimestamp(date = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return (
		`${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
		`${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
	);
}

/** 规范化签名字段值；空值返回 null（不参与签名）。 */
export function normalizeLegacyFsiSignValue(value: unknown): string | null {
	if (value === null) return null;
	if (typeof value === "string") return value === "" ? null : value;
	if (typeof value === "boolean") return value ? "true" : "false";
	const cleaned = cleanLegacyFsiSignValue(value);
	if (cleaned === null) return null;
	if (Array.isArray(cleaned)) {
		if (cleaned.length === 0) return null;
		return legacyFsiCompactJson(cleaned);
	}
	if (typeof cleaned === "object") {
		if (Object.keys(cleaned).length === 0) return null;
		return legacyFsiCompactJson(cleaned);
	}
	return String(cleaned);
}

/**
 * 构建待签名串（规范 §2.3.1.2 / 旧 MbsCrypto._build_sign_string）：
 * 剔除 signData/encData/extra，键 ASCII 升序拼 `k=v`，空值跳过，末尾 `&key=appSecret`。
 */
export function buildLegacyFsiSignSource(
	body: Record<string, unknown>,
	appSecret: string,
): string {
	const parts: string[] = [];
	for (const key of Object.keys(body).sort()) {
		if (EXCLUDED_FROM_SIGN.has(key)) continue;
		const normalized = normalizeLegacyFsiSignValue(body[key]);
		if (normalized === null) continue;
		parts.push(`${key}=${normalized}`);
	}
	return parts.join("&") + `&key=${appSecret}`;
}

/**
 * 派生报文 SM4 密钥（规范 §2.3.2.2 步骤 3-4 的旧实现语义）：
 * appId 前 16 字节 ASCII 作 key，SM4-ECB/PKCS7 加密 appSecret 的 UTF-8 字节，
 * 密文转 hex 大写后取前 16 个字符，其 ASCII 字节（16 字节）即最终密钥。
 * 返回值为该 16 字节密钥的 hex 形式（小写），供 sm-crypto 使用。
 */
export function deriveLegacyFsiSm4KeyHex(
	appId: string,
	appSecret: string,
): string {
	const appIdBytes = new TextEncoder().encode(appId);
	if (appIdBytes.length < 16) {
		throw new LegacyFsiContractError(
			"6201",
			"appId must contain at least 16 ASCII characters to derive the SM4 key",
		);
	}
	const keyBytes = appIdBytes.slice(0, 16);
	const keyHex = Array.from(keyBytes, (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
	const secretBytes = Array.from(
		new TextEncoder().encode(appSecret),
	) as unknown as number[];
	const encryptedHex = sm4.encrypt(secretBytes, keyHex, {
		padding: "pkcs#7",
	});
	const upperHex = encryptedHex.toUpperCase();
	const derived = upperHex.slice(0, 16);
	return Array.from(new TextEncoder().encode(derived), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

/** SM4-ECB/PKCS7 加密 UTF-8 文本，输出大写 hex（规范 §2.3.2.2 步骤 4）。 */
export function encryptLegacyFsiSm4Hex(
	plaintext: string,
	keyHex: string,
): string {
	const bytes = Array.from(
		new TextEncoder().encode(plaintext),
	) as unknown as number[];
	return sm4.encrypt(bytes, keyHex, { padding: "pkcs#7" }).toUpperCase();
}

/** SM4-ECB/PKCS7 解密大写/小写 hex 密文，返回 UTF-8 文本。 */
export function decryptLegacyFsiSm4Hex(
	ciphertextHex: string,
	keyHex: string,
): string {
	return sm4.decrypt(ciphertextHex.toLowerCase(), keyHex, {
		padding: "pkcs#7",
	});
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value.trim());
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function hexToBytes(hex: string): Uint8Array {
	const pairs = hex.match(/.{2}/g) ?? [];
	const bytes = new Uint8Array(pairs.length);
	pairs.forEach((pair, index) => {
		bytes[index] = Number.parseInt(pair, 16);
	});
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Base64(32 字节) 私钥 → 64 位 hex。 */
export function base64PrivateKeyToHex(privateKeyB64: string): string {
	const bytes = base64ToBytes(privateKeyB64);
	if (bytes.length !== 32) {
		throw new LegacyFsiContractError(
			"6201",
			"SM2 private key must decode to 32 bytes",
		);
	}
	return bytesToHex(bytes);
}

/** Base64(64/65 字节) 公钥 → 130 位 hex（含 04 前缀）。 */
export function base64PublicKeyToHex(publicKeyB64: string): string {
	const bytes = base64ToBytes(publicKeyB64);
	const xy = bytes.length === 65 && bytes[0] === 0x04 ? bytes.slice(1) : bytes;
	if (xy.length !== 64) {
		throw new LegacyFsiContractError(
			"6201",
			"SM2 public key must decode to 64 or 65 bytes",
		);
	}
	return `04${bytesToHex(xy)}`;
}

export type SmCryptoLegacyFsiConfig = {
	appId: string;
	appSecret: string;
	/** Base64 编码的 32 字节渠道 SM2 私钥。 */
	channelPrivateKeyB64: string;
	/** Base64 编码的平台 SM2 公钥（64 或 65 字节）。 */
	platformPublicKeyB64: string;
	/** SM2 签名 userId；为空时回落规范默认值。 */
	sm2UserId?: string;
	/** 派生 SM4 密钥覆盖（测试注入）；生产必须由 appId/appSecret 派生。 */
	derivedSm4KeyHexOverride?: string;
};

export function createSmCryptoLegacyFsiCrypto(
	config: SmCryptoLegacyFsiConfig,
): LegacyFsiCryptoGateway {
	const privateKeyHex = base64PrivateKeyToHex(config.channelPrivateKeyB64);
	const platformPublicKeyHex = base64PublicKeyToHex(
		config.platformPublicKeyB64,
	);
	const userId = config.sm2UserId?.trim() || "1234567812345678";
	const sm4KeyHex =
		config.derivedSm4KeyHexOverride ??
		deriveLegacyFsiSm4KeyHex(config.appId, config.appSecret);

	function signSource(body: Record<string, unknown>): string {
		return buildLegacyFsiSignSource(body, config.appSecret);
	}

	function sign(body: Record<string, unknown>): string {
		const signatureHex = sm2.doSignature(signSource(body), privateKeyHex, {
			hash: true,
			userId,
		});
		if (!signatureHex) {
			throw new LegacyFsiContractError(
				"6201",
				"SM2 signature generation failed",
			);
		}
		return bytesToBase64(hexToBytes(signatureHex));
	}

	function verify(body: Record<string, unknown>, signB64: string): boolean {
		try {
			const signHex = bytesToHex(base64ToBytes(signB64));
			return sm2.doVerifySignature(
				signSource(body),
				signHex,
				platformPublicKeyHex,
				{
					hash: true,
					userId,
				},
			);
		} catch {
			return false;
		}
	}

	return {
		async seal(
			input: { infno: LegacyFsiInfno; data: Record<string, unknown> },
			_context: AdapterCallContext,
		): Promise<LegacyFsiSealedEnvelope> {
			const cleaned =
				cleanLegacyFsiSignObject(input.data) ??
				contractError(input.infno, "data must not be empty after cleaning");
			const timestamp = localLegacyFsiTimestamp();
			const signPayload = {
				appId: config.appId,
				data: cleaned,
				encType: "SM4",
				signType: "SM2",
				version: ENVELOPE_VERSION,
				timestamp,
			};
			const signData = sign(signPayload);
			const encData = encryptLegacyFsiSm4Hex(
				legacyFsiCompactJson(cleaned),
				sm4KeyHex,
			);
			return validateLegacyFsiSealedEnvelope(
				{
					appId: config.appId,
					encType: "SM4",
					signType: "SM2",
					version: ENVELOPE_VERSION,
					timestamp,
					encData,
					signData,
				},
				input.infno,
			);
		},

		async open(
			input: {
				infno: LegacyFsiInfno;
				response: Record<string, unknown>;
			},
			_context: AdapterCallContext,
		): Promise<LegacyFsiOpenedPayload> {
			const response = input.response;
			const encData = response.encData;
			if (typeof encData !== "string" || !encData.trim()) {
				// 业务失败响应可能不带 encData；此时没有可解密数据，也没有可验签事实，
				// 严格模式下不猜测内容。
				contractError(input.infno, "response has no encData to open");
			}
			let plaintext: string;
			try {
				plaintext = decryptLegacyFsiSm4Hex(encData as string, sm4KeyHex);
			} catch (error) {
				throw new LegacyFsiContractError(
					input.infno,
					`SM4 decrypt failed: ${(error as Error).message}`,
				);
			}
			let data: unknown;
			try {
				data = JSON.parse(plaintext);
			} catch (error) {
				throw new LegacyFsiContractError(
					input.infno,
					`decrypted payload is not JSON: ${(error as Error).message}`,
				);
			}
			if (typeof data !== "object" || data === null || Array.isArray(data)) {
				contractError(input.infno, "decrypted payload must be a JSON object");
			}
			const signData = response.signData;
			if (typeof signData !== "string" || !signData.trim()) {
				contractError(input.infno, "response has no signData to verify");
			}
			const verifyPayload: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(response)) {
				if (key === "encData" || key === "signData") continue;
				verifyPayload[key] = value;
			}
			verifyPayload.data = data;
			if (!verify(verifyPayload, signData as string)) {
				contractError(input.infno, "response signData verification failed");
			}
			return { data: data as Record<string, unknown>, signVerified: true };
		},
	};
}
