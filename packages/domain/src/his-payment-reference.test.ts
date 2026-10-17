import { expect, test } from "bun:test";
import { normalizeHisPaymentReference } from "./his-payment-reference";

test("HIS reference preserves exact Long values as decimal text", () => {
	expect(normalizeHisPaymentReference("9223372036854775807")).toBe(
		"9223372036854775807",
	);
	expect(normalizeHisPaymentReference(9007199254740993n)).toBe(
		"9007199254740993",
	);
	expect(normalizeHisPaymentReference(42)).toBe("42");
});

test("HIS reference rejects lossy, noncanonical and out of Long range inputs", () => {
	for (const value of [
		0,
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
		null,
		undefined,
		"0",
		"-1",
		"01",
		" 1",
		"1 ",
		"1e3",
		"1.0",
		"9223372036854775808",
		"10000000000000000000",
		"7d8a8e6e-0c65-4d09-89c4-405b027290c1",
	]) {
		expect(() => normalizeHisPaymentReference(value)).toThrow();
	}
});
