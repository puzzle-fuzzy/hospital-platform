import { expect, test } from "bun:test";
import {
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
