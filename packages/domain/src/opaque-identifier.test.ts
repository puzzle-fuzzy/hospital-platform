import { expect, test } from "bun:test";
import {
	isBoundedOpaqueIdentifier,
	MAX_OPAQUE_IDENTIFIER_LENGTH,
} from "./opaque-identifier";

test("opaque 标识只通过有界、无控制字符的形状校验", () => {
	expect(isBoundedOpaqueIdentifier("patient-001")).toBe(true);
	expect(isBoundedOpaqueIdentifier("  patient-001")).toBe(false);
	expect(isBoundedOpaqueIdentifier("patient-001 ")).toBe(false);
	expect(isBoundedOpaqueIdentifier("\u0000patient-001")).toBe(false);
	expect(
		isBoundedOpaqueIdentifier("x".repeat(MAX_OPAQUE_IDENTIFIER_LENGTH)),
	).toBe(true);
	expect(
		isBoundedOpaqueIdentifier("x".repeat(MAX_OPAQUE_IDENTIFIER_LENGTH + 1)),
	).toBe(false);
});
