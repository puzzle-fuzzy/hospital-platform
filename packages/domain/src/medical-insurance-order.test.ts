import { describe, expect, test } from "bun:test";
import {
	assertMedicalInsuranceOrderTransition,
	assertValidMedicalInsuranceAmounts,
	InvalidMedicalInsuranceAmountsError,
	InvalidMedicalInsurancePaymentBreakdownError,
	isMedicalInsuranceOrderStatus,
	MedicalInsuranceOrderTransitionError,
	medicalInsurancePaymentBreakdown,
	medicalInsuranceStatusForNotification,
	normalizeMedicalInsuranceSettlementNotification,
} from "./medical-insurance-order";

describe("医保订单状态机", () => {
	test("合法链路与非法回退", () => {
		expect(() =>
			assertMedicalInsuranceOrderTransition("created", "fee_uploaded"),
		).not.toThrow();
		expect(() =>
			assertMedicalInsuranceOrderTransition("order_placed", "cash_pending"),
		).not.toThrow();
		expect(() =>
			assertMedicalInsuranceOrderTransition(
				"awaiting_confirmation",
				"insurance_settled",
			),
		).not.toThrow();
		// 终态后不能静默改写；只能人工对账进入 manual_review。
		expect(() =>
			assertMedicalInsuranceOrderTransition("insurance_settled", "created"),
		).toThrow(MedicalInsuranceOrderTransitionError);
		expect(() =>
			assertMedicalInsuranceOrderTransition("manual_review", "created"),
		).toThrow(MedicalInsuranceOrderTransitionError);
		expect(isMedicalInsuranceOrderStatus("cash_pending")).toBeTrue();
		expect(isMedicalInsuranceOrderStatus("paid")).toBeFalse();
	});
});

describe("医保金额四分项守恒", () => {
	test("现金+个账+基金必须等于总额", () => {
		expect(() =>
			assertValidMedicalInsuranceAmounts({
				totalFen: 10001,
				cashFen: 3001,
				personalAccountFen: 2000,
				fundFen: 5000,
			}),
		).not.toThrow();
		expect(() =>
			assertValidMedicalInsuranceAmounts({
				totalFen: 100,
				cashFen: 50,
				personalAccountFen: 50,
				fundFen: 1,
			}),
		).toThrow(InvalidMedicalInsuranceAmountsError);
	});

	test("V2.2.5 其他支付金额纳入总额并保留个账扩展字段", () => {
		expect(() =>
			assertValidMedicalInsuranceAmounts({
				totalFen: 11000,
				cashFen: 2000,
				personalAccountFen: 3000,
				fundFen: 5000,
				otherPaymentFen: 1000,
				personalAccountMutualAidFen: 500,
				personalAccountSelfFen: 2500,
			}),
		).not.toThrow();
	});

	test("只有高平普通挂号可把医院承担金额映射为 HOSPITAL_REDUCE", () => {
		const amounts = {
			totalFen: 100,
			cashFen: 30,
			personalAccountFen: 20,
			fundFen: 50,
			hospitalPartFen: 10,
		};
		expect(
			medicalInsurancePaymentBreakdown({
				amounts,
				orderType: "RegPay",
				insuredAreaCode: "140581",
			}),
		).toEqual({
			wechatCashFen: 20,
			cashReduceDetails: [
				{ cashReduceFen: 10, cashReduceType: "HOSPITAL_REDUCE" },
			],
		});
		expect(() =>
			medicalInsurancePaymentBreakdown({
				amounts,
				orderType: "RegPay",
				insuredAreaCode: "140500",
			}),
		).toThrow(InvalidMedicalInsurancePaymentBreakdownError);
		expect(() =>
			medicalInsurancePaymentBreakdown({
				amounts,
				orderType: "DiagPay",
				insuredAreaCode: "140581",
			}),
		).toThrow(InvalidMedicalInsurancePaymentBreakdownError);
	});
});

describe("6302 结算通知归一化", () => {
	test("元金额转分并守恒；callType/setlType 白名单", () => {
		const notification = normalizeMedicalInsuranceSettlementNotification({
			payOrdId: "PO-1",
			callType: "02",
			medOrgOrd: "MED-1",
			traceTime: "2026-09-03 15:00:00",
			feeSumamt: "100.01",
			ownPayAmt: "30.01",
			psnAcctPay: 20,
			fundPay: 50,
			setlType: "ALL",
			revsToken: "REV-1",
		});
		expect(notification.feeSumamt).toBe(10001);
		expect(notification.ownPayAmt).toBe(3001);
		expect(notification.psnAcctPay).toBe(2000);
		expect(() =>
			normalizeMedicalInsuranceSettlementNotification({
				payOrdId: "PO-1",
				callType: "02",
				medOrgOrd: "MED-1",
				traceTime: "t",
				feeSumamt: "10.00",
				ownPayAmt: "5.00",
				psnAcctPay: "6.00",
				fundPay: "0",
				setlType: "ALL",
				revsToken: "R",
			}),
		).toThrow();
		expect(() =>
			normalizeMedicalInsuranceSettlementNotification({
				payOrdId: "PO-1",
				callType: "03",
				medOrgOrd: "MED-1",
				traceTime: "t",
				feeSumamt: "1.00",
				ownPayAmt: "0",
				psnAcctPay: "0",
				fundPay: "1.00",
				setlType: "HI",
				revsToken: "R",
			}),
		).toThrow();
	});

	test("通知推导状态：纯医保和混合支付均等待微信官方查单；金额不一致进等待确认", () => {
		const amounts = {
			totalFen: 100,
			cashFen: 0,
			personalAccountFen: 40,
			fundFen: 60,
		};
		const full = normalizeMedicalInsuranceSettlementNotification({
			payOrdId: "PO",
			callType: "02",
			medOrgOrd: "M",
			traceTime: "t",
			feeSumamt: "1.00",
			ownPayAmt: "0",
			psnAcctPay: "0.40",
			fundPay: "0.60",
			setlType: "ALL",
			revsToken: "R",
		});
		expect(medicalInsuranceStatusForNotification(full, amounts)).toBe(
			"cash_pending",
		);
		expect(
			medicalInsuranceStatusForNotification(full, {
				totalFen: 999,
				cashFen: 0,
				personalAccountFen: 400,
				fundFen: 599,
			}),
		).toBe("awaiting_confirmation");
		const withCash = normalizeMedicalInsuranceSettlementNotification({
			payOrdId: "PO",
			callType: "02",
			medOrgOrd: "M",
			traceTime: "t",
			feeSumamt: "1.00",
			ownPayAmt: "0.30",
			psnAcctPay: "0.20",
			fundPay: "0.50",
			setlType: "ALL",
			revsToken: "R",
		});
		expect(medicalInsuranceStatusForNotification(withCash, null)).toBe(
			"cash_pending",
		);
	});
});
