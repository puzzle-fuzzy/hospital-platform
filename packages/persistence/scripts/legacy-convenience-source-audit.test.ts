import { describe, expect, test } from "bun:test";
import {
	aggregateSql,
	classifyLegacyConvenienceTableAudit,
	LEGACY_CONVENIENCE_TABLES,
} from "./legacy-convenience-source-audit";

describe("旧便民库存只读审计", () => {
	test("只允许固定的六张旧便民表进入审计", () => {
		expect(LEGACY_CONVENIENCE_TABLES.map(({ table }) => table)).toEqual([
			"admission_preconsultation",
			"commendatory_letter",
			"discharge_follow_up",
			"my_doctor",
			"risk_assessment",
			"silk_banner",
		]);
	});

	test("问卷即使 owner 和患者引用都能映射，也不能自动开放", () => {
		const result = classifyLegacyConvenienceTableAudit(
			LEGACY_CONVENIENCE_TABLES[0],
			2,
			2,
		);

		expect(result.status).toBe("owner-mapped-patient-contract-pending");
		expect(result.missingReason).toContain("版本");
	});

	test("反馈和医生快照都必须保留独立 contract 阻断", () => {
		const feedback = classifyLegacyConvenienceTableAudit(
			LEGACY_CONVENIENCE_TABLES[1],
			4,
			4,
		);
		const doctor = classifyLegacyConvenienceTableAudit(
			LEGACY_CONVENIENCE_TABLES[3],
			21,
			21,
		);

		expect(feedback.status).toBe("owner-mapped-patient-contract-pending");
		expect(feedback.missingReason).toContain("内容审核");
		expect(LEGACY_CONVENIENCE_TABLES[1].patientColumn).toBeNull();
		expect(doctor.status).toBe("owner-mapped-patient-contract-pending");
		expect(doctor.missingReason).toContain("医生目录");
	});

	test("owner 映射不完整时不能被误判为空数据", () => {
		const result = classifyLegacyConvenienceTableAudit(
			LEGACY_CONVENIENCE_TABLES[3],
			21,
			20,
		);

		expect(result.status).toBe("owner-mapped-patient-contract-pending");
		expect(result.missingReason).toContain("旧 user_id");
	});

	test("跨旧新表 join 必须显式固定 utf8mb4 二进制比较规则", () => {
		const sql = aggregateSql(LEGACY_CONVENIENCE_TABLES[0]);

		expect(sql).toContain("CONVERT(hp.provider_subject USING utf8mb4)");
		expect(sql).toContain("CONVERT(old_user.openid USING utf8mb4)");
		expect(sql).toContain("CONVERT(legacy.pat_id USING utf8mb4)");
		expect(sql).toContain("COLLATE utf8mb4_bin");
		expect(sql).toContain("COUNT(DISTINCT CASE WHEN hp.user_id IS NOT NULL");
		expect(sql).not.toContain("hp.provider_subject = old_user.openid");
	});
});
