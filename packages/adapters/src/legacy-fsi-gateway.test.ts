import { expect, test } from "bun:test";
import {
	AdapterNotConfiguredError,
	createLegacyFsiGateway,
	type LegacyFsiCryptoGateway,
} from "./index";

const context = {
	traceId: "trace-legacy-fsi-001",
	idempotencyKey: "idem-legacy-fsi-001",
};

function createCrypto(): LegacyFsiCryptoGateway {
	return {
		async seal() {
			return {
				appId: "mbs-test-app",
				encType: "SM4",
				signType: "SM2",
				version: "2.0.1",
				timestamp: "20260902120000",
				encData: "ciphertext-only",
				signData: "signature-only",
			};
		},
		async open({ response }) {
			return {
				data: response.data as Record<string, unknown>,
				signVerified: true,
			};
		},
	};
}

function gateway(
	fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
) {
	return createLegacyFsiGateway({
		relayUrl: "https://relay.example.test/forward",
		directBaseUrl: "https://medical.example.test",
		relayAuthorizationToken: "relay-token-for-test",
		crypto: createCrypto(),
		fetcher,
	});
}

function feeUploadData(): Record<string, unknown> {
	return {
		ecToken: "ec-token-001",
		orgCodg: "org-001",
		psnNo: "person-001",
		insutype: "310",
		medOrgOrd: "visit-001",
		begntime: "20260902120000",
		idNo: "masked-id-001",
		userName: "masked-name-001",
		idType: "01",
		insuCode: "insu-001",
		iptOtpNo: "visit-001",
		deptName: "internal-medicine",
		deptCode: "dept-001",
		caty: "11",
		medType: "21",
		feeType: "01",
		psnSetlway: "01",
		chrgBchno: "batch-001",
		pubHospRfomFlag: "0",
		medfeeSumamt: "12.00",
		feedetailList: [{ detItemFeeSumamt: "12.00" }],
	};
}

test("legacy FSI gateway uses fixed encrypted relay routes", async () => {
	let requestBody: Record<string, unknown> | undefined;
	const api = gateway(async (_input, init) => {
		requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
		return new Response(
			JSON.stringify({
				data: {
					payOrdId: "provider-order-001",
					payToken: "provider-token-001",
				},
			}),
			{ status: 200, headers: { "x-request-id": "relay-request-001" } },
		);
	});

	const result = await api.uploadFees(feeUploadData(), context);
	expect(result).toMatchObject({
		credential: {
			payOrdId: "provider-order-001",
			payToken: "provider-token-001",
		},
		totalFen: 1200,
		trace: { provider: "legacy-fsi", requestId: "relay-request-001" },
	});
	expect(requestBody).toMatchObject({
		method: "POST",
		base_url: "https://medical.example.test",
		path: "/org/local/api/hos/uldFeeInfo",
	});
	const relayPayload = requestBody?.body as Record<string, unknown>;
	expect(relayPayload).toHaveProperty("encData", "ciphertext-only");
	expect(relayPayload).not.toHaveProperty("data");
});

test("legacy FSI gateway preserves non-final 6301 status without inventing amounts", async () => {
	const api = gateway(
		async () =>
			new Response(
				JSON.stringify({
					data: { payOrdId: "provider-order-001", ordStas: "1" },
				}),
				{ status: 200 },
			),
	);

	const result = await api.querySettlement(
		{
			payOrdId: "provider-order-001",
			orgCodg: "org-001",
			payToken: "provider-token-001",
			idNo: "masked-id-001",
			userName: "masked-name-001",
			idType: "01",
		},
		context,
	);
	expect(result.settlement).toEqual({
		payOrdId: "provider-order-001",
		ordStas: "1",
	});
	expect(result.statusClass).toBe("processing");
});

test("legacy FSI gateway refuses an unauthenticated relay", () => {
	expect(() =>
		createLegacyFsiGateway({
			relayUrl: "https://relay.example.test/forward",
			directBaseUrl: "https://medical.example.test",
			relayAuthorizationToken: " ",
			crypto: createCrypto(),
		}),
	).toThrow(AdapterNotConfiguredError);
});
