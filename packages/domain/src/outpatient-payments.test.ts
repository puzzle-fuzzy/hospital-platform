import { expect, test } from "bun:test";
import {
	MAX_OUTPATIENT_PAYMENT_RECORDS,
	normalizeOutpatientPaymentRecords,
	parseOutpatientBillDateTime,
	validateOutpatientPaymentRecords,
} from "./outpatient-payments";

test("精确单价白名单保留高精度元字符串，合计仍为整数分", () => {
	const record = {
		recordId: "exact-unit-price",
		status: "paid" as const,
		billDate: "2026-10-17 09:00:00",
		amountFen: 388,
		priceYuan: "0.5536",
		quantity: "7",
	};
	expect(normalizeOutpatientPaymentRecords([record], "paid")[0]).toEqual(
		record,
	);
	for (const priceYuan of [0.5536, "-0.1", "NaN", "1e-4", "", "1".repeat(65)]) {
		expect(() =>
			normalizeOutpatientPaymentRecords([{ ...record, priceYuan }], "paid"),
		).toThrow();
	}
	expect(() =>
		normalizeOutpatientPaymentRecords(
			[{ ...record, amountFen: 388.1 }],
			"paid",
		),
	).toThrow();
	expect(() =>
		normalizeOutpatientPaymentRecords([{ ...record, priceFen: 55.36 }], "paid"),
	).toThrow();
});

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

function groupedRecord() {
	return {
		recordId: "payment-group-001",
		status: "unpaid" as const,
		billDate: "2026-10-15 15:34:12",
		amountFen: 9700,
		items: [
			{
				recordId: "payment-item-ultrasound",
				status: "unpaid" as const,
				billDate: "2026-10-15 15:34:12",
				itemName: "彩超检查",
				executionDepartmentName: "超声科",
				amountFen: 8000,
			},
			{
				recordId: "payment-item-ecg",
				status: "unpaid" as const,
				billDate: "2026-10-15 15:34:12",
				itemName: "心电图检查",
				executionDepartmentName: "心电图室",
				amountFen: 1700,
			},
		],
	};
}

test("同笔门诊费用保留独立明细与总额且父子均只投影安全字段", () => {
	const group = groupedRecord();
	const input = {
		...group,
		providerPatientId: "private-patient",
		items: group.items.map((item) => ({
			...item,
			outTradeOrderId: "private-provider-order",
		})),
	};
	const [normalized] = normalizeOutpatientPaymentRecords([input], "unpaid");
	expect(normalized).toEqual(group);
	expect(normalized?.items).toHaveLength(2);
	expect(JSON.stringify(normalized)).not.toContain("private-");
	expect(normalized?.items?.[0]).not.toBe(input.items[0]);
});

test.each([
	{ ...groupedRecord(), items: null },
	{ ...groupedRecord(), items: {} },
	{ ...groupedRecord(), items: [] },
	{ ...groupedRecord(), items: [groupedRecord().items[0]] },
	{ ...groupedRecord(), items: [null, groupedRecord().items[1]] },
	{
		...groupedRecord(),
		items: groupedRecord().items.map((item) => ({ ...item, items: [] })),
	},
])("门诊合并费用拒绝缺项、非对象和嵌套明细 %#", (group) => {
	expect(() => normalizeOutpatientPaymentRecords([group], "unpaid")).toThrow(
		"Outpatient payment provider result is invalid",
	);
});

test("门诊合并费用拒绝重复子项、子项状态冲突和错误合计", () => {
	const group = groupedRecord();
	for (const invalid of [
		{ ...group, items: [group.items[0], group.items[0]] },
		{
			...group,
			items: group.items.map((item) => ({ ...item, status: "paid" })),
		},
		{ ...group, amountFen: 8000 },
		{
			...group,
			items: group.items.map((item) => ({ ...item, amountFen: 0.5 })),
		},
		{
			...group,
			amountFen: Number.MAX_SAFE_INTEGER,
			items: group.items.map((item) => ({
				...item,
				amountFen: Number.MAX_SAFE_INTEGER,
			})),
		},
	]) {
		expect(() =>
			normalizeOutpatientPaymentRecords([invalid], "unpaid"),
		).toThrow("Outpatient payment provider result is invalid");
	}
});

test("已缴合并费用要求每条明细退款标记与父记录一致", () => {
	const group = groupedRecord();
	const paid = {
		...group,
		status: "paid" as const,
		paymentStatus: "refunding" as const,
		items: group.items.map((item) => ({
			...item,
			status: "paid" as const,
			paymentStatus: "refunding" as const,
		})),
	};
	expect(normalizeOutpatientPaymentRecords([paid], "paid")).toEqual([paid]);
	expect(() =>
		normalizeOutpatientPaymentRecords(
			[
				{
					...paid,
					items: paid.items.map(({ paymentStatus: _, ...item }) => item),
				},
			],
			"paid",
		),
	).toThrow("Outpatient payment provider result is invalid");
});

test("合并不能绕过门诊费用明细总数上限", () => {
	const group = groupedRecord();
	const items = Array.from(
		{ length: MAX_OUTPATIENT_PAYMENT_RECORDS },
		(_, i) => ({
			...group.items[0],
			recordId: `item-${i}`,
			amountFen: 1,
		}),
	);
	const maximum = { ...group, amountFen: items.length, items };
	expect(
		normalizeOutpatientPaymentRecords([maximum], "unpaid")[0]?.items,
	).toHaveLength(MAX_OUTPATIENT_PAYMENT_RECORDS);
	expect(() =>
		normalizeOutpatientPaymentRecords([maximum, group.items[1]], "unpaid"),
	).toThrow("Outpatient payment provider result is invalid");
});
