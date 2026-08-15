import { expect, test } from "bun:test";
import { createAesGcmSecretValueCipher } from "./prepay-cipher";

const key = Buffer.alloc(32, 7).toString("base64");

test("payment prepay cipher round-trips without storing plaintext", () => {
	const cipher = createAesGcmSecretValueCipher(key);
	const plaintext = JSON.stringify({ paySign: "sensitive-pay-sign" });
	const sealed = cipher.seal(plaintext);

	expect(sealed).toMatch(/^v1\./);
	expect(sealed).not.toContain("sensitive-pay-sign");
	expect(cipher.open(sealed)).toBe(plaintext);
});

test("payment prepay cipher rejects tampered ciphertext", () => {
	const cipher = createAesGcmSecretValueCipher(key);
	const sealed = cipher.seal("payment-params");
	const parts = sealed.split(".");
	parts[3] = `${parts[3]}A`;

	expect(() => cipher.open(parts.join("."))).toThrow();
});

test("payment prepay cipher requires a 32-byte key", () => {
	expect(() => createAesGcmSecretValueCipher("c2hvcnQ=")).toThrow("32 bytes");
});
