import { describe, expect, test } from "bun:test";
import {
	credentialType,
	formatBalance,
	maskIdentity,
	normalize1101Result,
	queryPayload,
} from "./insurance";

describe("1101 response normalization", () => {
	test("keeps every insurance record and reads balance aliases", () => {
		const result = normalize1101Result({
			data: {
				output: {
					baseinfo: { psn_no: "person-001", psn_name: "测试人员" },
					insuinfo: [
						{
							psn_no: "person-001",
							insutype: "310",
							balc: "10.50",
							psn_insu_stas: "1",
						},
						{
							psn_no: "person-001",
							insutype: "390",
							balance: 20,
							psnInsuStas: "2",
						},
						{ psn_no: "person-001", insutype: "330", balC: "30.00" },
					],
				},
			},
		});
		expect(result.insuranceRecords).toHaveLength(3);
		expect(result.insuranceRecords.map((item) => item.insuranceType)).toEqual([
			"310",
			"390",
			"330",
		]);
		expect(result.insuranceRecords.map((item) => item.balance)).toEqual([
			"10.50",
			"20",
			"30.00",
		]);
	});

	test("accepts JSON-string wrappers and object-shaped insuinfo", () => {
		const result = normalize1101Result({
			body: JSON.stringify({
				insuinfo: { psnNo: "person-002", insuType: "310", balc: 0 },
			}),
		});
		expect(result.insuranceRecords).toHaveLength(1);
		expect(result.insuranceRecords[0]?.psnNo).toBe("person-002");
		expect(result.insuranceRecords[0]?.balance).toBe("0");
	});
});

describe("query contract", () => {
	test("maps the three supported credentials", () => {
		expect(credentialType("electronic-credential")).toBe("01");
		expect(credentialType("identity-card")).toBe("02");
		expect(credentialType("social-security-card")).toBe("03");
	});

	test("normalizes identity input without turning PSN_NO into a credential", () => {
		expect(
			queryPayload({
				mode: "identity-card",
				name: " 测试人员 ",
				identityNumber: "11010519900101007x",
				expectedPsnNo: " person-001 ",
			}),
		).toEqual({
			mode: "identity-card",
			name: "测试人员",
			identityNumber: "11010519900101007X",
			credentialNumber: "11010519900101007X",
			cardSerialNumber: "",
			expectedPsnNo: "person-001",
		});
	});
});

test("display helpers keep balances readable and identity masked", () => {
	expect(formatBalance("12.3")).toBe("¥12.30");
	expect(maskIdentity("11010519900101007X")).toBe("1101********007X");
});
