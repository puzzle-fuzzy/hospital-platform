import { expect, test } from "bun:test";
import {
	AdapterNotConfiguredError,
	createNotConfiguredLegacyFsiCrypto,
	validateLegacyFsiOpenedPayload,
	validateLegacyFsiSealedEnvelope,
} from "./index";
import { LegacyFsiContractError } from "./index";

test("legacy FSI sealed envelope requires strict SM4/SM2 fields", () => {
	expect(
		validateLegacyFsiSealedEnvelope(
			{
				appId: "mbs-app-001",
				encType: "SM4",
				signType: "SM2",
				version: "2.0.1",
				timestamp: "20260815000000",
				encData: "ciphertext-001",
				signData: "signature-001",
			},
			"6201",
		),
	).toMatchObject({ encType: "SM4", signType: "SM2" });
	expect(() =>
		validateLegacyFsiSealedEnvelope(
			{
				appId: "mbs-app-001",
				encType: "AES",
				signType: "RSA",
				version: "2.0.1",
				timestamp: "20260815000000",
				encData: "ciphertext-001",
				signData: "signature-001",
			},
			"6201",
		),
	).toThrow(LegacyFsiContractError);
});

test("legacy FSI opened payload cannot bypass signature verification", () => {
	expect(
		validateLegacyFsiOpenedPayload(
			{ data: { payOrdId: "pay-order-001" }, signVerified: true },
			"6202",
		),
	).toEqual({ data: { payOrdId: "pay-order-001" }, signVerified: true });
	expect(() =>
		validateLegacyFsiOpenedPayload(
			{ data: { payOrdId: "pay-order-001" }, signVerified: false },
			"6202",
		),
	).toThrow(LegacyFsiContractError);
});

test("legacy FSI crypto remains fail-closed until an implementation is configured", async () => {
	const crypto = createNotConfiguredLegacyFsiCrypto();
	await expect(
		crypto.seal(
			{ infno: "6201", data: {} },
			{ traceId: "trace-001", idempotencyKey: "key-001" },
		),
	).rejects.toBeInstanceOf(AdapterNotConfiguredError);
});
