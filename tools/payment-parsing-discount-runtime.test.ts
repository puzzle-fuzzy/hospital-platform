import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	createRuntimePatch,
	evaluateRuntimeExports,
	loadTypeScript,
	sha256,
} from "./payment-parsing-discount-runtime.mjs";

const ast = process.env.PAYMENT_RUNTIME_TYPESCRIPT
	? loadTypeScript()
	: undefined;
const fixture = (online: string, baseline: string, candidate: string) =>
	createRuntimePatch({
		online,
		baseline,
		candidate,
		expectedOnlineSha256: sha256(online),
		typescript: ast,
		allowedModules: ["target.ts", "helper.ts"],
	});

test("runtime patch rejects an unexpected current API hash", () => {
	expect(() =>
		createRuntimePatch({
			online: "corrupted",
			baseline: "",
			candidate: "",
			typescript: ast,
		}),
	).toThrow("SHA-256 guard");
});

test.skipIf(!ast)(
	"AST transplant maps global bindings, preserves local suffixes and keeps unrelated refund bytes",
	() => {
		const online =
			'// target.ts\nfunction read2(input) { const amount = input; return amount * 100; }\n// refund.ts\nfunction refundLatest() { return "must-preserve-current-fix"; }\n';
		const baseline =
			"// target.ts\nfunction read(input2) { const amount2 = input2; return amount2 * 100; }\n";
		const candidate =
			"// helper.ts\nfunction money(value) { return value * 100; }\n// target.ts\nfunction read(input3) { const amount3 = input3; return money(amount3) + 1; }\n";
		const result = fixture(online, baseline, candidate);
		expect(result.patched).toContain(
			'// refund.ts\nfunction refundLatest() { return "must-preserve-current-fix"; }\n',
		);
		const actual = evaluateRuntimeExports(
			result.patched,
			[["read", "target.ts", "read"]],
			ast,
		);
		expect(actual.read(95.25)).toBe(9526);
		expect(result.manifest.patchedSha256).toBe(sha256(result.patched));
		for (const segment of result.manifest.preservedSegments)
			expect(segment.sha256).toBe(
				sha256(online.slice(segment.start, segment.end)),
			);
	},
);

test.skipIf(!ast)(
	"AST guard rejects a live target that differs from archived source semantics",
	() => {
		expect(() =>
			fixture(
				"// target.ts\nfunction read(input) { return -input; }\n",
				"// target.ts\nfunction read(input) { return +input; }\n",
				"// target.ts\nfunction read(input) { return input * 100; }\n",
			),
		).toThrow("differs semantically");
	},
);

test.skipIf(!ast)(
	"AST guard keeps amount and amount2 as separate scoped symbol identities",
	() => {
		const baseline =
			"// target.ts\nfunction read(input){const amount=input;const amount2=1;return amount-amount2;}\n";
		const online =
			"// target.ts\nfunction read2(input){const amount=input;const amount2=1;return amount2-amount;}\n";
		const candidate =
			"// target.ts\nfunction read(input){const amount=input;const amount2=2;return amount-amount2;}\n";
		expect(() => fixture(online, baseline, candidate)).toThrow(
			"differs semantically",
		);
	},
);

const runtimeRoot = process.env.PAYMENT_RUNTIME_FIXTURE_ROOT;
test.skipIf(!ast)(
	"AST guard retains BigInt literal values used for exact money bounds",
	() => {
		const baseline =
			'// target.ts\nfunction read(input){const scale=100n;const label="old";return BigInt(input)*scale;}\n';
		const online =
			'// target.ts\nfunction read2(input){const scale=200n;const label="old";return BigInt(input)*scale;}\n';
		const candidate =
			'// target.ts\nfunction read(input){const scale=100n;const label="new";return BigInt(input)*scale;}\n';
		expect(() => fixture(online, baseline, candidate)).toThrow(
			"differs semantically",
		);
	},
);

test.skipIf(!ast)("AST guard compares private property identifier text", () => {
	const baseline =
		'// target.ts\nclass Reader { #a=1; #b=2; read(){const label="old";return this.#a-this.#b;} }\n';
	const online =
		'// target.ts\nclass Reader { #a=1; #b=2; read(){const label="old";return this.#b-this.#a;} }\n';
	const candidate =
		'// target.ts\nclass Reader { #a=1; #b=2; read(){const label="new";return this.#a-this.#b;} }\n';
	expect(() => fixture(online, baseline, candidate)).toThrow(
		"differs semantically",
	);
});

test.skipIf(!runtimeRoot || !ast)(
	"actual current bundle preserves all unedited bytes and runs complete mapper/core services offline",
	async () => {
		if (!runtimeRoot || !ast)
			throw new Error(
				"Runtime verification requires explicit local AST and baseline fixtures",
			);
		const [online, baseline, candidate] = await Promise.all([
			readFile(join(runtimeRoot, "runtime-base/api-index.js"), "utf8"),
			readFile(
				join(
					runtimeRoot,
					"runtime-base/source-baseline/apps/api/dist/index.js",
				),
				"utf8",
			),
			readFile(new URL("../apps/api/dist/index.js", import.meta.url), "utf8"),
		]);
		const { patched, manifest } = createRuntimePatch({
			online,
			baseline,
			candidate,
			typescript: ast,
		});
		expect(manifest.onlineSha256).toBe(
			"90d096bf5bc6aedfa42b823be509511e1e465ba09ad2fb2b62241e6faf358377",
		);
		const replacements = manifest.edits.reduce(
			(sum: number, edit: { start: number; end: number }) =>
				sum + edit.end - edit.start,
			0,
		);
		expect(replacements).toBeLessThan(15000);
		for (const name of [
			"yunhealth-registration-settlement.ts",
			"registration-payment-exit-service.ts",
		]) {
			const span = new RegExp(
				`^// [^\\n]*${name.replaceAll(".", "\\.")}\\n[\\s\\S]*?(?=^// |$)`,
				"m",
			);
			expect(span.exec(patched)?.[0]).toBe(span.exec(online)?.[0]);
		}
		const runtime = evaluateRuntimeExports(
			patched,
			[
				[
					"findAmountFenDeep",
					"packages/adapters/src/legacy-fsi-medical-insurance.ts",
					"findAmountFenDeep",
				],
				[
					"mapRecord",
					"packages/adapters/src/zhongyang-outpatient-payments.ts",
					"mapRecord",
				],
				[
					"normalizePaymentItem",
					"packages/domain/src/outpatient-payments.ts",
					"normalizePaymentItem",
				],
				[
					"presentation",
					"src/modules/medical-insurance/payment-presentation.ts",
					"medicalInsurancePaymentPresentation",
				],
				[
					"Core",
					"src/modules/medical-insurance/payment-core.ts",
					"MedicalInsurancePaymentCore",
				],
				[
					"Wechat",
					"src/modules/medical-insurance/wechat-payment-service.ts",
					"MedicalInsuranceWechatPaymentService",
				],
			],
			ast,
			{
				"packages/observability/src/index.ts:createNoopLogger": () => ({
					warn() {},
					info() {},
					error() {},
					debug() {},
					child() {
						return this;
					},
				}),
			},
		);
		expect(
			runtime.findAmountFenDeep(
				{ data: { getAmount: 95.25 } },
				["getAmount"],
				"medical-insurance.2.6.65.1",
				"offline-request",
			),
		).toBe(9525);
		for (const amount of ["-1", "1.001"])
			expect(() =>
				runtime.findAmountFenDeep(
					{ getAmount: amount },
					["getAmount"],
					"medical-insurance.2.6.65.1",
					"offline-request",
				),
			).toThrow();
		expect(
			runtime.findAmountFenDeep(
				{ getAmount: null },
				["getAmount"],
				"medical-insurance.2.6.65.1",
				"offline-request",
			),
		).toBeUndefined();
		const record = runtime.mapRecord(
			{
				outTradeOrderId: "offline-bill",
				registerId: "offline-registration",
				visitRecordId: "offline-visit",
				mainId: "offline-application",
				chargeId: "offline-item",
				billDeptId: "offline-dept",
				billDocCode: "offline-doctor",
				networkPatClassId: "insurance",
				medicalCategoryId: "outpatient",
				registerChargeFlag: "0",
				presCode: "-1",
				amount: "95.25",
				tradeStatus: "1",
				itemName: "offline medicine",
				price: "0.5536",
				quantity: "172",
				unitName: "unit",
				billDate: "2026-10-17 09:03:00",
			},
			"offline-patient",
			"unpaid",
			"offline-request",
		);
		expect(record).toMatchObject({ amountFen: 9525, priceYuan: "0.5536" });
		expect(record).not.toHaveProperty("priceFen");
		expect(
			runtime.normalizePaymentItem(record, "unpaid", new Set()),
		).toMatchObject({ priceYuan: "0.5536" });
		const order = {
			medicalOrderId: "offline-order",
			ownerUserId: "offline-owner",
			patientId: "offline-patient",
			businessType: "registration",
			orderType: "RegPay",
			appointmentId: "offline-appointment",
			status: "insurance_settled",
			version: 1,
			amounts: {
				totalFen: 1000,
				fundFen: 800,
				personalAccountFen: 0,
				cashFen: 200,
			},
		};
		const settlement = {
			insuredAreaCode: "140581",
			postPaymentComponents: [
				{ kind: "hospital_reduce", amountFen: 200, state: "succeeded" },
			],
		};
		const before = JSON.stringify(order);
		expect(runtime.presentation(order, settlement)).toEqual({
			hospitalPartFen: 0,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		});
		const forbidden = () => {
			throw new Error("offline test forbids financial mutation");
		};
		const orders = {
			findByMedicalOrderId: async () => order,
			getSettlementContext: async () => settlement,
			applySettlement: forbidden,
		};
		const core = new runtime.Core({
			orders,
			medicalInsurance: { query: forbidden, settle: forbidden },
		});
		const input = {
			ownerUserId: order.ownerUserId,
			orderId: order.medicalOrderId,
			context: {
				traceId: "offline-runtime-trace",
				idempotencyKey: "offline-runtime-key",
			},
		};
		expect(await core.query(input)).toMatchObject({
			status: "insurance_settled",
			amounts: {
				totalFen: 1000,
				insuranceFen: 800,
				cashFen: 200,
				hospitalReduceFen: 200,
				wechatCashFen: 0,
			},
		});
		const wechat = new runtime.Wechat({
			orders,
			medicalInsurance: { query: forbidden },
		});
		expect(await wechat.query(input)).toMatchObject({
			status: "insurance_settled",
			cashFen: 200,
			hospitalReduceFen: 200,
			wechatCashFen: 0,
		});
		expect(JSON.stringify(order)).toBe(before);
	},
);
