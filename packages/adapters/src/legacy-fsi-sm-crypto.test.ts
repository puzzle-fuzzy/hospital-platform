import { describe, expect, test } from "bun:test";
import differentialFixture from "./fixtures/legacy-fsi-crypto-differential.json";
import { LegacyFsiContractError } from "./legacy-fsi-contract";
import {
	base64PrivateKeyToHex,
	base64PublicKeyToHex,
	buildLegacyFsiSignSource,
	cleanLegacyFsiSignObject,
	createSmCryptoLegacyFsiCrypto,
	decryptLegacyFsiSm4Hex,
	deriveLegacyFsiSm4KeyHex,
	encryptLegacyFsiSm4Hex,
	legacyFsiCompactJson,
	normalizeLegacyFsiSignValue,
} from "./legacy-fsi-sm-crypto";
import { sm2, sm3, sm4 } from "./vendor-sm-crypto";

/**
 * crypto 验证链（见 TODO 15.2）：
 * ① 国标公开向量证明密码学原语（SM4 GB/T 32907、SM3 GB/T 32905、SM2 与 OpenSSL 交叉）；
 * ② 规范签名串 KAT（山西规范 v1.3.35 §5.6.5 示例报文，期望值即规范原文）；
 * ③ 与旧仓库 MbsCrypto（Python/gmssl）的逐字节差分（夹具由旧实现离线生成，密钥全部为测试值）。
 * 第④层（测试环境真实调用）不属于单元测试，受控窗口另行执行。
 */

const hexToBytes = (hex: string): number[] =>
	(hex.match(/.{2}/g) ?? []).map((pair) => Number.parseInt(pair, 16));

const bytesToHex = (bytes: number[]): string =>
	bytes.map((b) => b.toString(16).padStart(2, "0")).join("");

const hexToBase64 = (hex: string): string => {
	const bytes = hexToBytes(hex);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

const base64ToHex = (value: string): string => {
	const binary = atob(value);
	return bytesToHex(Array.from(binary, (ch) => ch.charCodeAt(0) as number));
};

const callContext = {
	traceId: "trace-test",
	idempotencyKey: "idem-test",
};

// ---------- ① 国标向量：密码学原语 ----------

describe("layer-1: GB/T standard known-answer tests", () => {
	test("SM4-ECB matches the GB/T 32907-2016 appendix A vector", () => {
		const block = "0123456789abcdeffedcba9876543210";
		const ciphertext = sm4.encrypt(hexToBytes(block), block, {
			padding: "none",
		}) as string;
		expect(ciphertext).toBe("681edf34d206965e86b3e94f536e4246");
	});

	test("SM3 matches the GB/T 32905-2012 digest of 'abc'", () => {
		expect(sm3("abc")).toBe(
			"66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0",
		);
	});

	test("SM2 verifies an OpenSSL 3.6 signature and self-signature round trip", async () => {
		const fx = differentialFixture.sm2OpensslCrossFixture;
		// OpenSSL（C 实现，distid=userId）签名 → 本库验签
		expect(
			sm2.doVerifySignature(
				fx.message,
				fx.opensslSignatureRsHex,
				fx.publicKeyHex130,
				{
					hash: true,
					userId: fx.userId,
				},
			),
		).toBeTrue();
		// 自签自验（OpenSSL 对 JS 签名的反向验证已在生成夹具时人工确认）
		const jsSignature = sm2.doSignature(fx.message, fx.privateKeyHex, {
			hash: true,
			userId: fx.userId,
		});
		expect(
			sm2.doVerifySignature(fx.message, jsSignature, fx.publicKeyHex130, {
				hash: true,
				userId: fx.userId,
			}),
		).toBeTrue();
	});
});

// ---------- ② 规范签名串 KAT ----------

describe("layer-2: spec sign-source known-answer tests", () => {
	test("spec-example sample reproduces the v1.3.35 §5.6.5 sign string", () => {
		const sample = (
			differentialFixture.samples as Array<{
				name: string;
				payload: Record<string, unknown>;
				expectedSignString: string;
			}>
		).find((item) => item.name === "spec-example");
		if (!sample) throw new Error("fixture missing spec-example sample");
		expect(
			buildLegacyFsiSignSource(sample.payload, differentialFixture.appSecret),
		).toBe(sample.expectedSignString);
	});

	test("empty values, nested objects, arrays and Chinese text follow the spec rules", () => {
		// 覆盖：空串/null/空对象/空数组剔除、bool 小写化、紧凑排序 JSON、中文不转义
		expect(
			normalizeLegacyFsiSignValue({
				b: 2,
				a: 1,
				empty: "",
				nested: { y: ["", null, 0, { k: "值" }], z: null },
			}),
		).toBe('{"a":1,"b":2,"nested":{"y":[0,{"k":"值"}]}}');
		expect(normalizeLegacyFsiSignValue("")).toBeNull();
		expect(normalizeLegacyFsiSignValue(null)).toBeNull();
		expect(normalizeLegacyFsiSignValue(true)).toBe("true");
		expect(normalizeLegacyFsiSignValue(["", {}])).toBeNull();
	});

	test("Base64 key conversion matches the feedback-form key formats", () => {
		const fx = differentialFixture.sm2OpensslCrossFixture;
		const privateKeyB64 = hexToBase64(fx.privateKeyHex);
		const publicKeyB64 = hexToBase64(fx.publicKeyHex130);
		expect(base64ToHex(privateKeyB64)).toBe(fx.privateKeyHex);
		expect(base64PrivateKeyToHex(privateKeyB64)).toBe(fx.privateKeyHex);
		expect(base64PublicKeyToHex(publicKeyB64)).toBe(fx.publicKeyHex130);
	});
});

// ---------- ③ 与旧 MbsCrypto 的逐字节差分 ----------

describe("layer-3: differential tests against the legacy MbsCrypto", () => {
	const derivedKey = deriveLegacyFsiSm4KeyHex(
		differentialFixture.appId,
		differentialFixture.appSecret,
	);

	test("derived report SM4 key matches the legacy derivation", () => {
		expect(derivedKey).toBe(
			differentialFixture.expectedDerivedSm4KeyHexUpperAscii,
		);
	});

	for (const sample of differentialFixture.samples as Array<{
		name: string;
		payload: Record<string, unknown>;
		expectedSignString: string;
		expectedCleanedDataJson: string;
		expectedEncData: string;
	}>) {
		test(`sample ${sample.name} matches sign string, cleaned JSON and encData`, () => {
			expect(
				buildLegacyFsiSignSource(sample.payload, differentialFixture.appSecret),
			).toBe(sample.expectedSignString);
			const cleaned = cleanLegacyFsiSignObject(
				sample.payload.data as Record<string, unknown>,
			);
			expect(legacyFsiCompactJson(cleaned)).toBe(
				sample.expectedCleanedDataJson,
			);
			expect(
				encryptLegacyFsiSm4Hex(sample.expectedCleanedDataJson, derivedKey),
			).toBe(sample.expectedEncData);
			expect(decryptLegacyFsiSm4Hex(sample.expectedEncData, derivedKey)).toBe(
				sample.expectedCleanedDataJson,
			);
		});
	}
});

// ---------- seal/open 集成往返 ----------

describe("sm-crypto gateway seal/open round trip", () => {
	const fx = differentialFixture.sm2OpensslCrossFixture;
	const gateway = createSmCryptoLegacyFsiCrypto({
		appId: differentialFixture.appId,
		appSecret: differentialFixture.appSecret,
		channelPrivateKeyB64: hexToBase64(fx.privateKeyHex),
		platformPublicKeyB64: hexToBase64(fx.publicKeyHex130),
		sm2UserId: fx.userId,
	});
	// 用己方密钥同时充当平台侧，验证 seal/open 的自洽闭环。
	const mirrored = createSmCryptoLegacyFsiCrypto({
		appId: differentialFixture.appId,
		appSecret: differentialFixture.appSecret,
		channelPrivateKeyB64: hexToBase64(fx.privateKeyHex),
		platformPublicKeyB64: hexToBase64(fx.publicKeyHex130),
		sm2UserId: fx.userId,
	});

	test("seal then open returns the cleaned payload and strict verification", async () => {
		const envelope = await gateway.seal(
			{
				infno: "6201",
				data: {
					medOrgOrd: "TEST-ORD-001",
					userName: "测试用户",
					medfeeSumamt: "12.34",
					emptyDropped: "",
					nested: { b: 2, a: 1 },
				},
			},
			callContext,
		);
		expect(envelope.encType).toBe("SM4");
		expect(envelope.signType).toBe("SM2");
		expect(envelope.version).toBe("2.0.1");
		expect(/^[0-9A-F]+$/.test(envelope.encData)).toBeTrue();

		const opened = await mirrored.open(
			{ infno: "6201", response: { ...envelope } },
			callContext,
		);
		expect(opened.signVerified).toBeTrue();
		expect(opened.data).toEqual({
			medOrgOrd: "TEST-ORD-001",
			userName: "测试用户",
			medfeeSumamt: "12.34",
			nested: { a: 1, b: 2 },
		});
	});

	test("tampered signData is rejected in strict mode", async () => {
		const envelope = await gateway.seal(
			{ infno: "6202", data: { payOrdId: "PO-1" } },
			callContext,
		);
		const corrupted = bytesToHex(
			Array.from(atob(envelope.signData), (ch) => ch.charCodeAt(0) as number),
		);
		const flipped = hexToBase64(
			(corrupted.slice(0, 2) === "00" ? "01" : "00") + corrupted.slice(2),
		);
		await expect(
			mirrored.open(
				{ infno: "6202", response: { ...envelope, signData: flipped } },
				callContext,
			),
		).rejects.toThrow(LegacyFsiContractError);
	});

	test("tampered encData fails to open", async () => {
		const envelope = await gateway.seal(
			{ infno: "6301", data: { payOrdId: "PO-2" } },
			callContext,
		);
		const mutated = `00${envelope.encData.slice(2)}`;
		await expect(
			mirrored.open(
				{ infno: "6301", response: { ...envelope, encData: mutated } },
				callContext,
			),
		).rejects.toThrow(LegacyFsiContractError);
	});

	test("response without encData or signData is rejected fail-closed", async () => {
		await expect(
			mirrored.open(
				{ infno: "6301", response: { code: 500, message: "boom" } },
				callContext,
			),
		).rejects.toThrow(LegacyFsiContractError);
	});
});
