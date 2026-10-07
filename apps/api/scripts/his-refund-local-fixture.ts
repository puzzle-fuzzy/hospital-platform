import type { MedicalInsuranceRefundPayload } from "@hospital/contracts";
import type {
	MedicalInsuranceOrder,
	MedicalInsuranceRefundGateway,
	WechatRefundGateway,
} from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceAuthorizationRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import { Elysia } from "elysia";
import { AdminWechatRefundService } from "../src/modules/admin/wechat-refund-service";
import {
	hisMedicalInsuranceRefundModule,
	hisRefundSignature,
} from "../src/modules/his/refunds";
import { MedicalInsuranceRefundService } from "../src/modules/medical-insurance/refund-service";
import { errorHandlerPlugin } from "../src/plugins/error-handler";
import { requestContextPlugin } from "../src/plugins/request-context";

/**
 * 这个工具只在当前 Bun 进程内创建内存数据。它既不会写 MySQL/Redis，也不会
 * 载入 API 组合根或真实 6203/微信 APIv3 adapter，因此不能被用作远端联调造数。
 */
export const HIS_REFUND_LOCAL_FIXTURE_MARKER =
	"LOCAL_FIXTURE_ONLY_NO_DATABASE_NO_NETWORK_NO_REAL_REFUND";

const FIXTURE_NOW = new Date("2026-09-29T00:00:00.000Z");
const FIXTURE_NOW_MILLISECONDS = FIXTURE_NOW.getTime();
const FIXTURE_TOKEN = "local-fixture-token-not-real";
const FIXTURE_HMAC_SECRET = "local-fixture-hmac-not-real";

type FixtureRefundData = MedicalInsuranceRefundPayload["data"];

export type LocalHisRefundFixtureReport = {
	marker: typeof HIS_REFUND_LOCAL_FIXTURE_MARKER;
	fake: true;
	persistence: "in-memory-only";
	providerNetwork: "disabled";
	runId: string;
	fixture: {
		medicalOrderId: string;
		payOrdId: string;
		outTradeNo: string;
		status: "insurance_settled";
		wechatPaymentState: "cash_paid";
		amounts: {
			totalFen: number;
			cashFen: number;
			personalAccountFen: number;
			fundFen: number;
		};
	};
	endpoints: {
		medicalInsuranceByPayOrdId: FixtureRefundData;
		wechatByOutTradeNo: FixtureRefundData;
		medicalInsuranceQuery: FixtureRefundData;
		wechatQuery: FixtureRefundData;
	};
	mockGatewayCalls: {
		medicalInsurance6203: number;
		wechatRefund: number;
		wechatRefundQuery: number;
	};
};

type FixtureIdentity = LocalHisRefundFixtureReport["fixture"];

function buildFixture(runId: string): FixtureIdentity {
	return {
		medicalOrderId: `FAKE-HIS-MIX-${runId}`,
		payOrdId: `FAKE-MI-PAY-${runId}`,
		outTradeNo: `FAKE-WX-OUT-${runId}`,
		status: "insurance_settled",
		wechatPaymentState: "cash_paid",
		amounts: {
			totalFen: 1000,
			cashFen: 300,
			personalAccountFen: 200,
			fundFen: 500,
		},
	};
}

function fixtureOrder(identity: FixtureIdentity): MedicalInsuranceOrder {
	return {
		medicalOrderId: identity.medicalOrderId,
		ownerUserId: `FAKE-HIS-OWNER-${identity.medicalOrderId}`,
		patientId: `FAKE-HIS-PATIENT-${identity.medicalOrderId}`,
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: `FAKE-HIS-BUSINESS-${identity.medicalOrderId}`,
		authorizationId: `FAKE-HIS-AUTH-${identity.medicalOrderId}`,
		feeUploadId: `FAKE-HIS-FEE-${identity.medicalOrderId}`,
		idempotencyKey: `FAKE-HIS-PAYMENT-${identity.medicalOrderId}`,
		medOrgOrd: `FAKE-HIS-MED-ORG-${identity.medicalOrderId}`,
		chrgBchno: `FAKE-HIS-CHARGE-${identity.medicalOrderId}`,
		payOrdId: identity.payOrdId,
		payTokenHash: "0".repeat(64),
		status: identity.status,
		ordStas: "6",
		amounts: { ...identity.amounts },
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: identity.outTradeNo,
		wechatPaymentState: identity.wechatPaymentState,
		version: 1,
		createdAt: FIXTURE_NOW.toISOString(),
		updatedAt: FIXTURE_NOW.toISOString(),
	};
}

function createSecurityStore() {
	const nonces = new Set<string>();
	let requests = 0;
	return {
		async reserveNonce(nonce: string): Promise<boolean> {
			if (nonces.has(nonce)) return false;
			nonces.add(nonce);
			return true;
		},
		async incrementRateLimit(): Promise<number> {
			requests += 1;
			return requests;
		},
	};
}

function createSignedRequest(input: {
	method: "POST" | "GET";
	path: string;
	body: unknown;
	nonce: string;
	requestId: string;
}): Request {
	const timestamp = String(Math.floor(FIXTURE_NOW_MILLISECONDS / 1000));
	const signature = hisRefundSignature({
		method: input.method,
		path: input.path,
		timestamp,
		nonce: input.nonce,
		requestId: input.requestId,
		body: input.body,
		hmacSecret: FIXTURE_HMAC_SECRET,
	});
	return new Request(`http://local-fixture/api/v1${input.path}`, {
		method: input.method,
		headers: {
			"content-type": "application/json",
			"x-real-ip": "124.164.248.83",
			"x-his-refund-token": FIXTURE_TOKEN,
			"x-his-timestamp": timestamp,
			"x-his-nonce": input.nonce,
			"x-his-signature": signature,
			"x-request-id": input.requestId,
		},
		...(input.method === "POST" ? { body: JSON.stringify(input.body) } : {}),
	});
}

async function readSuccess(
	response: Response,
	label: string,
): Promise<FixtureRefundData> {
	const payload = (await response.json()) as {
		success?: unknown;
		data?: unknown;
	};
	if (
		response.status !== 200 ||
		payload.success !== true ||
		!payload.data ||
		typeof payload.data !== "object"
	) {
		throw new Error(`${label} did not produce a successful refund response`);
	}
	return payload.data as FixtureRefundData;
}

function requireFixtureRunId(value: string): string {
	if (!/^[A-Za-z0-9-]{1,16}$/u.test(value)) {
		throw new Error("--run-id must contain 1-16 letters, numbers, or hyphens");
	}
	return value;
}

function defaultRunId(): string {
	return `r${crypto.randomUUID().replaceAll("-", "").slice(0, 11)}`;
}

export async function runLocalHisRefundFixture(
	input: { runId?: string } = {},
): Promise<LocalHisRefundFixtureReport> {
	const runId = requireFixtureRunId(input.runId ?? defaultRunId());
	const fixture = buildFixture(runId);
	const order = fixtureOrder(fixture);
	const orders = createInMemoryMedicalInsuranceOrderRepository();
	const authorizations =
		createInMemoryMedicalInsuranceAuthorizationRepository();
	const medicalRefunds = createInMemoryMedicalInsuranceRefundRepository();
	const wechatRefunds = createInMemoryWechatRefundRepository();
	await orders.insert(order);
	await authorizations.put({
		authorizationId: order.authorizationId ?? "",
		ownerUserId: order.ownerUserId,
		medicalOrderId: order.medicalOrderId,
		providerSubject: `FAKE-HIS-SUBJECT-${runId}`,
		payAuthNo: `FAKE-HIS-PAY-AUTH-${runId}`,
		patient: {
			idNo: `FAKE-HIS-ID-${runId}`,
			userName: "本地退费假数据",
			idType: "01",
		},
		psnNo: `FAKE-HIS-PSN-${runId}`,
		insutype: "310",
		insuplcAdmdvs: "FAKE-HIS-AREA",
		insuCode: `FAKE-HIS-INSURANCE-${runId}`,
		expiresAt: "2099-01-01T00:00:00.000Z",
		createdAt: FIXTURE_NOW.toISOString(),
	});

	let medicalInsurance6203Calls = 0;
	let wechatRefundCalls = 0;
	let wechatRefundQueryCalls = 0;
	let lastWechatRefund:
		| {
				merchantRefundNo: string;
				outTradeNo: string;
				totalFen: number;
				refundFen: number;
		  }
		| undefined;

	const medicalInsuranceGateway: MedicalInsuranceRefundGateway = {
		async refund(data) {
			medicalInsurance6203Calls += 1;
			if (data.payOrdId !== fixture.payOrdId) {
				throw new Error(
					"local fixture medical gateway received the wrong payOrdId",
				);
			}
			return {
				refStatus: "SUCC",
				trace: {
					provider: "local-fixture",
					operation: "fake-6203-refund",
					requestId: `FAKE-6203-${runId}`,
				},
			};
		},
	};
	const wechatGateway: WechatRefundGateway = {
		async requestRefund(refund) {
			wechatRefundCalls += 1;
			if (refund.outTradeNo !== fixture.outTradeNo) {
				throw new Error(
					"local fixture WeChat gateway received the wrong outTradeNo",
				);
			}
			lastWechatRefund = {
				merchantRefundNo: refund.merchantRefundNo,
				outTradeNo: refund.outTradeNo,
				totalFen: refund.totalFen,
				refundFen: refund.refundFen,
			};
			return {
				status: "SUCCESS",
				merchantRefundNo: refund.merchantRefundNo,
				providerRefundId: `FAKE-WX-REFUND-${runId}`,
				providerTransactionId: `FAKE-WX-TRANSACTION-${runId}`,
				outTradeNo: refund.outTradeNo,
				totalFen: refund.totalFen,
				refundFen: refund.refundFen,
				successTime: FIXTURE_NOW.toISOString(),
				trace: {
					provider: "local-fixture",
					operation: "fake-wechat-refund",
					requestId: `FAKE-WX-REFUND-REQUEST-${runId}`,
				},
			};
		},
		async queryRefund({ merchantRefundNo }) {
			wechatRefundQueryCalls += 1;
			if (
				!lastWechatRefund ||
				merchantRefundNo !== lastWechatRefund.merchantRefundNo
			) {
				throw new Error(
					"local fixture WeChat query did not reuse the refund number",
				);
			}
			return {
				status: "SUCCESS",
				merchantRefundNo: lastWechatRefund.merchantRefundNo,
				providerRefundId: `FAKE-WX-REFUND-${runId}`,
				providerTransactionId: `FAKE-WX-TRANSACTION-${runId}`,
				outTradeNo: lastWechatRefund.outTradeNo,
				totalFen: lastWechatRefund.totalFen,
				refundFen: lastWechatRefund.refundFen,
				successTime: FIXTURE_NOW.toISOString(),
				trace: {
					provider: "local-fixture",
					operation: "fake-wechat-refund-query",
					requestId: `FAKE-WX-QUERY-${runId}`,
				},
			};
		},
	};
	const wechatRefund = new AdminWechatRefundService({
		refunds: wechatRefunds,
		paymentOrders: createInMemoryPaymentOrderRepository(),
		medicalInsuranceOrders: orders,
		gateway: wechatGateway,
		now: () => FIXTURE_NOW,
		createId: () => `FAKE-WX-REFUND-RECORD-${runId}`,
	});
	const medicalInsuranceRefund = new MedicalInsuranceRefundService({
		orders,
		authorizations,
		refunds: medicalRefunds,
		medicalInsuranceRefund: medicalInsuranceGateway,
		wechatRefund,
		now: () => FIXTURE_NOW,
		createId: () => `FAKE-MI-REFUND-RECORD-${runId}`,
	});
	const app = new Elysia()
		.use(requestContextPlugin())
		.use(errorHandlerPlugin())
		.group("/api/v1", (api) =>
			api.use(
				hisMedicalInsuranceRefundModule(
					medicalInsuranceRefund,
					{
						token: FIXTURE_TOKEN,
						hmacSecret: FIXTURE_HMAC_SECRET,
						security: createSecurityStore(),
						now: () => FIXTURE_NOW_MILLISECONDS,
					},
					{
						medicalInsurance: medicalInsuranceRefund,
						wechat: wechatRefund,
					},
				),
			),
		);

	const medicalInsuranceByPayOrdId = await readSuccess(
		await app.handle(
			createSignedRequest({
				method: "POST",
				path: "/his/medical-insurance-leg-refunds/by-pay-ord-id",
				body: {
					payOrdId: fixture.payOrdId,
					reason: HIS_REFUND_LOCAL_FIXTURE_MARKER,
				},
				nonce: `fixture-medical-post-${runId}`,
				requestId: `fixture-medical-post-${runId}`,
			}),
		),
		"medical insurance refund by payOrdId",
	);
	const wechatByOutTradeNo = await readSuccess(
		await app.handle(
			createSignedRequest({
				method: "POST",
				path: "/his/wechat-leg-refunds/by-out-trade-no",
				body: {
					outTradeNo: fixture.outTradeNo,
					reason: HIS_REFUND_LOCAL_FIXTURE_MARKER,
				},
				nonce: `fixture-wechat-post-${runId}`,
				requestId: `fixture-wechat-post-${runId}`,
			}),
		),
		"WeChat refund by outTradeNo",
	);
	const medicalInsuranceQuery = await readSuccess(
		await app.handle(
			createSignedRequest({
				method: "GET",
				path: `/his/medical-insurance-leg-refunds/${medicalInsuranceByPayOrdId.refundNo}`,
				body: undefined,
				nonce: `fixture-medical-query-${runId}`,
				requestId: `fixture-medical-query-${runId}`,
			}),
		),
		"medical insurance refund query",
	);
	const wechatQuery = await readSuccess(
		await app.handle(
			createSignedRequest({
				method: "GET",
				path: `/his/wechat-leg-refunds/${wechatByOutTradeNo.refundNo}`,
				body: undefined,
				nonce: `fixture-wechat-query-${runId}`,
				requestId: `fixture-wechat-query-${runId}`,
			}),
		),
		"WeChat refund query",
	);

	if (
		medicalInsurance6203Calls !== 1 ||
		wechatRefundCalls !== 1 ||
		wechatRefundQueryCalls !== 1
	) {
		throw new Error(
			"local fixture did not exercise each fake refund gateway exactly once",
		);
	}
	if (
		medicalInsuranceByPayOrdId.amounts.totalFen !== 700 ||
		wechatByOutTradeNo.amounts.cashFen !== fixture.amounts.cashFen
	) {
		throw new Error(
			"local fixture did not preserve the mixed-payment refund amounts",
		);
	}

	return {
		marker: HIS_REFUND_LOCAL_FIXTURE_MARKER,
		fake: true,
		persistence: "in-memory-only",
		providerNetwork: "disabled",
		runId,
		fixture,
		endpoints: {
			medicalInsuranceByPayOrdId,
			wechatByOutTradeNo,
			medicalInsuranceQuery,
			wechatQuery,
		},
		mockGatewayCalls: {
			medicalInsurance6203: medicalInsurance6203Calls,
			wechatRefund: wechatRefundCalls,
			wechatRefundQuery: wechatRefundQueryCalls,
		},
	};
}

function printHelp(): void {
	process.stdout.write(
		"用法：bun apps/api/scripts/his-refund-local-fixture.ts [--run-id <1-16位字母数字或连字符>]\n",
	);
	process.stdout.write(
		"仅在内存中生成并演练一条医保+微信自费退费夹具；不写数据库、不联网、不发起真实退款。\n",
	);
}

function readRunIdFromArguments(): string | undefined {
	const runIdIndex = Bun.argv.indexOf("--run-id");
	if (runIdIndex < 0) return undefined;
	const runId = Bun.argv[runIdIndex + 1];
	if (!runId || runId.startsWith("--")) {
		throw new Error("--run-id requires a value");
	}
	if (
		Bun.argv.some(
			(argument, index) => argument.startsWith("--") && index !== runIdIndex,
		)
	) {
		throw new Error("only --run-id is supported");
	}
	return runId;
}

if (import.meta.main) {
	if (Bun.argv.includes("--help") || Bun.argv.includes("-h")) {
		printHelp();
	} else {
		const runId = readRunIdFromArguments();
		const report = await runLocalHisRefundFixture(
			runId === undefined ? {} : { runId },
		);
		process.stdout.write(JSON.stringify(report, null, 2));
		process.stdout.write("\n");
	}
}
