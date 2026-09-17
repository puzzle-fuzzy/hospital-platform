import { expect, test } from "bun:test";
import {
	MAX_OUTPATIENT_PAYMENT_RECORDS,
	normalizeOutpatientPaymentRecords,
	parseOutpatientBillDateTime,
	validateOutpatientPaymentRecords,
} from "./outpatient-payments";

test("门诊费用账单时间严格拒绝自然日溢出和带时区文本", () => {
	expect(parseOutpatientBillDateTime("2026-02-28 23:59:59")).toBeDefined();
	expect(parseOutpatientBillDateTime("2026-02-29 00:00:00")).toBeUndefined();
	expect(
		parseOutpatientBillDateTime("2026-08-16T09:00:00+08:00"),
	).toBeUndefined();
});

test("门诊费用公共读模型拒绝非法账单时间", () => {
	expect(() =>
		validateOutpatientPaymentRecords(
			[
				{
					recordId: "record-domain-001",
					status: "unpaid",
					billDate: "2026-02-31 09:00:00",
					amountFen: 100,
				},
			],
			"unpaid",
		),
	).toThrow("Outpatient payment provider result is invalid");
});

test("门诊费用公共读模型超过资源上限时整批拒绝而不截断", () => {
	const records = Array.from(
		{ length: MAX_OUTPATIENT_PAYMENT_RECORDS + 1 },
		(_, index) => ({
			recordId: `record-domain-${index}`,
			status: "unpaid" as const,
			billDate: "2026-08-16 09:00:00",
			amountFen: 100,
		}),
	);

	expect(() => validateOutpatientPaymentRecords(records, "unpaid")).toThrow(
		"Outpatient payment provider result is invalid",
	);
});

test("门诊费用公共读模型保留 2.6.33 的安全展示字段并拒绝非法比例", () => {
	const normalized = normalizeOutpatientPaymentRecords(
		[
			{
				recordId: "record-domain-rich",
				status: "unpaid",
				itemName: "血常规",
				departmentName: "心内科",
				executionDepartmentName: "检验科",
				doctorName: "李医生",
				executionDoctorName: "王医生",
				spec: "全血",
				quantity: "2",
				unitName: "次",
				priceFen: 850,
				chargeClassName: "检查费",
				tradePropName: "检查",
				networkPatClassName: "甲类",
				typeMemo: "甲类",
				preferentialAmountFen: 100,
				ascendAmountFen: 0,
				selfBurdenRatio: 0.2,
				billDate: "2026-08-16 09:00:00",
				amountFen: 1600,
			},
		],
		"unpaid",
	);
	expect(normalized[0]).toMatchObject({
		itemName: "血常规",
		executionDepartmentName: "检验科",
		executionDoctorName: "王医生",
		priceFen: 850,
		preferentialAmountFen: 100,
		selfBurdenRatio: 0.2,
	});

	expect(() =>
		normalizeOutpatientPaymentRecords(
			[
				{
					recordId: "record-domain-bad-ratio",
					status: "unpaid",
					billDate: "2026-08-16 09:00:00",
					amountFen: 100,
					selfBurdenRatio: 1.1,
				},
			],
			"unpaid",
		),
	).toThrow("Outpatient payment provider result is invalid");
});

test("门诊费用公共读模型保留退款中状态且不允许出现在待缴费记录", () => {
	const normalized = normalizeOutpatientPaymentRecords(
		[
			{
				recordId: "record-domain-refunding",
				status: "paid",
				paymentStatus: "refunding",
				billDate: "2026-08-16 09:00:00",
				amountFen: 100,
			},
		],
		"paid",
	);
	expect(normalized[0]).toMatchObject({
		status: "paid",
		paymentStatus: "refunding",
	});

	expect(() =>
		normalizeOutpatientPaymentRecords(
			[
				{
					recordId: "record-domain-refunding-unpaid",
					status: "unpaid",
					paymentStatus: "refunding",
					billDate: "2026-08-16 09:00:00",
					amountFen: 100,
				},
			],
			"unpaid",
		),
	).toThrow("Outpatient payment provider result is invalid");
});
