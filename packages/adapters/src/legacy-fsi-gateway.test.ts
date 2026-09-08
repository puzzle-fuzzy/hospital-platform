import { expect, test } from "bun:test";
import {
	AdapterNotConfiguredError,
	createLegacyFsiGateway,
	type LegacyFsiCryptoGateway,
	type ProviderRequestLogger,
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
	logger?: ProviderRequestLogger,
) {
	return createLegacyFsiGateway({
		relayUrl: "https://relay.example.test/forward",
		directBaseUrl: "https://medical.example.test",
		relayAuthorizationToken: "relay-token-for-test",
		crypto: createCrypto(),
		fetcher,
		...(logger ? { logger } : {}),
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
		insuplcAdmdvs: "140581",
		iptOtpNo: "visit-001",
		deptName: "internal-medicine",
		deptCode: "dept-001",
		caty: "11",
		diseCodg: "",
		diseName: "",
		medType: "21",
		feeType: "01",
		mdtrtCertType: "01",
		psnSetlway: "01",
		chrgBchno: "batch-001",
		pubHospRfomFlag: "0",
		uldLatlnt: "112.928537,35.787393",
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
					extData: { mdtrtId: "provider-visit-001" },
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
		mdtrtId: "provider-visit-001",
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

test("legacy FSI gateway captures rejected relay response body in the raw log window", async () => {
	const previousRawLogging = Bun.env.PROVIDER_RAW_LOGGING;
	const logs: Array<Record<string, unknown>> = [];
	const logger: ProviderRequestLogger = {
		info(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		warn(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
		error(bindings) {
			logs.push(bindings as Record<string, unknown>);
		},
	};
	Bun.env.PROVIDER_RAW_LOGGING = "true";

	try {
		const api = gateway(
			async () =>
				new Response(
					JSON.stringify({
						success: false,
						code: 360053,
						message: "provider rejection details",
					}),
					{ status: 200, headers: { "x-request-id": "relay-rejected-001" } },
				),
			logger,
		);

		await expect(api.uploadFees(feeUploadData(), context)).rejects.toMatchObject({
			providerErrorCode: "360053",
			providerErrorMessage: "provider rejection details",
			requestOutcome: "rejected",
		});

		const rawResponse = logs.find(
			(entry) =>
				entry.event === "provider.response.raw" &&
				entry.operation === "legacy-fsi.6201",
		);
		expect(rawResponse).toMatchObject({
			provider: "legacy-fsi",
			providerStatusCode: 200,
			providerResponseBodyText: expect.stringContaining(
				"provider rejection details",
			),
		});
		const gatewayRawResponse = logs.find(
			(entry) =>
				entry.event === "medical-insurance.legacy-fsi.response.raw" &&
				entry.operation === "legacy-fsi.6201",
		);
		expect(gatewayRawResponse).toMatchObject({
			provider: "legacy-fsi",
			providerStatusCode: 200,
			providerResponseBodyText: expect.stringContaining(
				"provider rejection details",
			),
		});
	} finally {
		if (previousRawLogging === undefined) {
			delete Bun.env.PROVIDER_RAW_LOGGING;
		} else {
			Bun.env.PROVIDER_RAW_LOGGING = previousRawLogging;
		}
	}
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
