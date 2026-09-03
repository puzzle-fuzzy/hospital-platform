import { expect, test } from "bun:test";
import {
	LEGACY_FSI_ROUTES,
	classifyLegacyFsiOrderStatus,
	LegacyFsiContractError,
	validate6201FeeUpload,
	validate6201Response,
	validate6202Request,
	validate6202Settlement,
	validate6203Refund,
	validate6203Response,
	validate6301QueryResult,
	validate6301Request,
	validate6301Settlement,
	validate6401Request,
	validate6401Response,
	yuanToFen,
} from "./legacy-fsi-contract";

test("legacy FSI route map keeps mobile payment endpoints explicit", () => {
	expect(LEGACY_FSI_ROUTES).toEqual({
		"6201": {
			name: "fee-upload",
			path: "/org/local/api/hos/uldFeeInfo",
		},
		"6202": {
			name: "payment-order",
			path: "/org/local/api/hos/pay_order",
		},
		"6203": {
			name: "refund-order",
			path: "/org/local/api/hos/refund_Order",
		},
		"6301": {
			name: "settlement-query",
			path: "/org/local/api/hos/query_order_info",
		},
		"6401": {
			name: "fee-upload-revoke",
			path: "/org/local/api/hos/revoke_order",
		},
	});
});

test("medical insurance amounts convert decimal yuan to integer fen without rounding", () => {
	expect(yuanToFen("6202.01", "feeSumamt", "6202")).toBe(620201);
	expect(yuanToFen(0, "cashRefdAmt", "6203")).toBe(0);
	expect(() => yuanToFen("1.001", "feeSumamt", "6202")).toThrow(
		LegacyFsiContractError,
	);
	expect(() => yuanToFen("-1.00", "feeSumamt", "6202")).toThrow(
		LegacyFsiContractError,
	);
});

test("6201 requires fee detail totals to match the medical fee total", () => {
	const requiredFields = {
		ecToken: "ec-token-001",
		orgCodg: "org-001",
		psnNo: "person-001",
		insutype: "310",
		medOrgOrd: "med-order-001",
		begntime: "20260815000000",
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
	};
	expect(
		validate6201FeeUpload({
			...requiredFields,
			medfeeSumamt: "12.00",
			feedetailList: [
				{ detItemFeeSumamt: "5.00" },
				{ detItemFeeSumamt: "7.00" },
			],
			fulamtOwnpayAmt: "2.00",
			preselfpayAmt: "3.00",
			inscpScpAmt: "7.00",
		}),
	).toEqual({ totalFen: 1200 });
	expect(() =>
		validate6201FeeUpload({
			...requiredFields,
			medfeeSumamt: "12.00",
			feedetailList: [{ detItemFeeSumamt: "11.00" }],
		}),
	).toThrow(LegacyFsiContractError);
});

test("6201 response exposes credentials only as an internal mapper result", () => {
	expect(
		validate6201Response({
			data: { payOrdId: "pay-order-001", payToken: "provider-token-001" },
		}),
	).toEqual({ payOrdId: "pay-order-001", payToken: "provider-token-001" });
});

test("6202 and 6301 make settlement decomposition authoritative", () => {
	const result = {
		data: {
			payOrdId: "pay-order-001",
			ordStas: "SUCCESS",
			feeSumamt: "100.00",
			ownPayAmt: "20.00",
			psnAcctPay: "30.00",
			fundPay: "50.00",
		},
	};
	expect(validate6202Settlement(result, "pay-order-001")).toEqual({
		payOrdId: "pay-order-001",
		ordStas: "SUCCESS",
		totalFen: 10000,
		cashFen: 2000,
		personalAccountFen: 3000,
		fundFen: 5000,
	});
	expect(() =>
		validate6202Settlement(
			{
				...result,
				data: { ...result.data, fundPay: "49.99" },
			},
			"pay-order-001",
		),
	).toThrow(LegacyFsiContractError);

	expect(
		validate6301Settlement(
			{
				data: {
					...result.data,
					setlType: "ALL",
					callType: "02",
					medOrgOrd: "med-order-001",
					traceTime: "20260815000000",
					revsToken: "reversal-token-001",
				},
			},
			"pay-order-001",
		),
	).toMatchObject({ totalFen: 10000, fundFen: 5000 });
});

test("6301 keeps intermediate statuses separate from final settlement evidence", () => {
	expect(
		validate6301QueryResult(
			{ data: { payOrdId: "pay-order-001", ordStas: "1" } },
			"pay-order-001",
		),
	).toEqual({ payOrdId: "pay-order-001", ordStas: "1" });

	expect(() =>
		validate6301QueryResult(
			{ data: { payOrdId: "other-order", ordStas: "1" } },
			"pay-order-001",
		),
	).toThrow(LegacyFsiContractError);

	expect(() =>
		validate6202Request({
			payAuthNo: "auth-001",
			payOrdId: "pay-order-001",
			payToken: "token-001",
			orgCodg: "org-001",
			orgBizSer: "biz-001",
			chrgBchno: "batch-001",
			feeType: "01",
			mdtrtId: "visit-001",
			acctUsedFlag: "2",
		}),
	).toThrow(LegacyFsiContractError);
});

test("classifies ordStas without calling any value payment success", () => {
	for (const status of ["0", "1", "2"]) {
		expect(classifyLegacyFsiOrderStatus(status)).toBe("processing");
	}
	for (const status of ["3", "4", "5", "6"]) {
		expect(classifyLegacyFsiOrderStatus(status)).toBe("settlement_candidate");
	}
	for (const status of ["7", "8", "9", "10", "11", "12", "13"]) {
		expect(classifyLegacyFsiOrderStatus(status)).toBe("cancelled");
	}
	for (const status of ["14", "15", "16"]) {
		expect(classifyLegacyFsiOrderStatus(status)).toBe("failed");
	}
	expect(classifyLegacyFsiOrderStatus("unexpected")).toBe("unknown");
});

test("provider credential requests require explicit order and identity fields", () => {
	expect(() => validate6301Request({ payOrdId: "only-order" })).toThrow(
		LegacyFsiContractError,
	);
	expect(() => validate6401Request({ payOrdId: "only-order" })).toThrow(
		LegacyFsiContractError,
	);
});

test("6203 enforces refund type and original settlement bounds", () => {
	const original = {
		totalFen: 10000,
		cashFen: 2000,
		personalAccountFen: 3000,
		fundFen: 5000,
	};
	expect(
		validate6203Refund(
			{
				payOrdId: "pay-order-001",
				appRefdSn: "refund-001",
				payAuthNo: "pay-auth-001",
				appRefdTime: "20260815000000",
				refdType: "CASH",
				totlRefdAmt: "20.00",
				cashRefdAmt: "20.00",
			},
			original,
		),
	).toMatchObject({ refdType: "CASH", totalFen: 2000, cashFen: 2000 });
	expect(() =>
		validate6203Refund(
			{
				payOrdId: "pay-order-001",
				appRefdSn: "refund-002",
				payAuthNo: "pay-auth-001",
				appRefdTime: "20260815000000",
				refdType: "ALL",
				totlRefdAmt: "99.99",
				cashRefdAmt: "20.00",
				psnAcctRefdAmt: "30.00",
				fundRefdAmt: "49.99",
			},
			original,
		),
	).toThrow(LegacyFsiContractError);
});

test("6203 and 6401 reject ambiguous success responses", () => {
	expect(validate6203Response({ body: { refStatus: "SUCC" } })).toBe("SUCC");
	expect(() =>
		validate6203Response({ body: { refStatus: "UNKNOWN" } }),
	).toThrow(LegacyFsiContractError);
	expect(
		validate6401Response({ data: { success: true, message: "revoked" } }),
	).toEqual({
		message: "revoked",
	});
	expect(() =>
		validate6401Response({ data: { success: false, message: "failed" } }),
	).toThrow(LegacyFsiContractError);
});
