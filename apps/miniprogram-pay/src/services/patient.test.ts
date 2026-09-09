import { describe, expect, test } from "bun:test";
import type { Patient } from "./patient";

Object.assign(globalThis, {
	MINIPROGRAM_PAY_MEDICAL_ORG_CHANNEL_CREDENTIAL: "",
});

const { initialPaymentPatientIndex } = await import("./patient");

function patient(id: string): Patient {
	return {
		id,
		displayName: id,
		relation: id === "patient-self" ? "本人" : "子女",
		cardNumberMasked: "******0001",
		clinicalAccess: "ready",
	};
}

describe("支付页就诊人选择", () => {
	test("没有待支付订单时只在唯一就诊人的情况下自动选择", () => {
		expect(initialPaymentPatientIndex([patient("patient-self")])).toBe(0);
		expect(
			initialPaymentPatientIndex([
				patient("patient-self"),
				patient("patient-child"),
			]),
		).toBe(-1);
	});

	test("待支付订单始终恢复原就诊人而不是当前目录默认项", () => {
		const patients = [patient("patient-self"), patient("patient-child")];
		expect(initialPaymentPatientIndex(patients, "patient-child")).toBe(1);
	});

	test("待支付就诊人已离开目录时保持未选择并禁止误付给唯一剩余就诊人", () => {
		expect(
			initialPaymentPatientIndex([patient("patient-self")], "patient-child"),
		).toBe(-1);
	});
});
