import { expect, test } from "bun:test";
import {
	MAX_OUTPATIENT_MEDICAL_RECORDS,
	normalizeOutpatientMedicalRecords,
	OutpatientMedicalRecordResultValidationError,
} from "./medical-records";

test("门诊病历只保留患者端摘要字段并丢弃 Provider 标识", () => {
	const records = normalizeOutpatientMedicalRecords([
		{
			visitTime: "2026-08-28 09:30:00",
			departmentName: "心内科",
			doctorName: "李医生",
			hospitalName: "门诊楼",
			clinicTypeName: "普通门诊",
			chargeClassName: "自费",
			diagnosis: "高血压",
			patId: "provider-patient-001",
			regId: "provider-registration-001",
			idCardNo: "不应进入响应",
		},
	]);

	expect(records).toEqual([
		{
			visitTime: "2026-08-28 09:30:00",
			departmentName: "心内科",
			doctorName: "李医生",
			hospitalName: "门诊楼",
			clinicTypeName: "普通门诊",
			chargeClassName: "自费",
			diagnosis: "高血压",
		},
	]);
	expect(JSON.stringify(records)).not.toContain("provider-patient-001");
	expect(JSON.stringify(records)).not.toContain("provider-registration-001");
	expect(JSON.stringify(records)).not.toContain("idCardNo");
});

test("门诊病历拒绝缺失就诊时间和无界 Provider 结果", () => {
	expect(() =>
		normalizeOutpatientMedicalRecords([{ departmentName: "心内科" }]),
	).toThrow(OutpatientMedicalRecordResultValidationError);

	expect(() =>
		normalizeOutpatientMedicalRecords(
			Array.from(
				{ length: MAX_OUTPATIENT_MEDICAL_RECORDS + 1 },
				(_, index) => ({
					visitTime: `2026-08-28 09:${String(index % 60).padStart(2, "0")}:00`,
				}),
			),
		),
	).toThrow(OutpatientMedicalRecordResultValidationError);
});
