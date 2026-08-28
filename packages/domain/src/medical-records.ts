import { isBoundedOpaqueIdentifier } from "./opaque-identifier";
import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 门诊病历列表只返回患者端确实需要的就诊摘要，不包含 Provider 主键。 */
export type OutpatientMedicalRecord = {
	departmentName?: string;
	doctorName?: string;
	hospitalName?: string;
	clinicTypeName?: string;
	chargeClassName?: string;
	/** 原版门诊记录中的就诊时间展示值，保留医院返回的明确粒度。 */
	visitTime: string;
	diagnosis?: string;
};

/** 门诊病历查询只允许服务端固定的 30 日自然日窗口。 */
export type OutpatientMedicalRecordQuery = {
	startDate: string;
	endDate: string;
};

/** 防止异常 Provider 响应一次性放大内存和小程序渲染树。 */
export const MAX_OUTPATIENT_MEDICAL_RECORDS = 512;

/** 门诊病历网关结果违反字段白名单时使用的低敏原因。 */
export type OutpatientMedicalRecordResultViolation =
	| "records-not-array"
	| "records-too-many"
	| "record-not-object"
	| "visit-time-invalid"
	| "display-text-invalid";

export class OutpatientMedicalRecordResultValidationError extends Error {
	readonly violation: OutpatientMedicalRecordResultViolation;

	constructor(violation: OutpatientMedicalRecordResultViolation) {
		super("Outpatient medical record provider result is invalid");
		this.name = "OutpatientMedicalRecordResultValidationError";
		this.violation = violation;
	}
}

function invalid(violation: OutpatientMedicalRecordResultViolation): never {
	throw new OutpatientMedicalRecordResultValidationError(violation);
}

function safeText(value: unknown, maxLength: number): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maxLength &&
		value === value.trim() &&
		!Array.from(value).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	);
}

function optionalText(value: unknown, maxLength: number): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (!safeText(value, maxLength)) invalid("display-text-invalid");
	return value;
}

/**
 * Provider adapter 和可替换测试网关都必须经过同一层二次投影。
 *
 * 这里明确丢弃 regId、patId、身份证、姓名等旧端字段；门诊病历页面只需要
 * 展示已选患者对应的摘要，不能把 Provider 临床主键或患者资料带回小程序。
 */
export function normalizeOutpatientMedicalRecords(
	value: unknown,
): OutpatientMedicalRecord[] {
	if (!Array.isArray(value)) invalid("records-not-array");
	if (value.length > MAX_OUTPATIENT_MEDICAL_RECORDS) {
		invalid("records-too-many");
	}

	return value.map((item) => {
		if (typeof item !== "object" || item === null || Array.isArray(item)) {
			invalid("record-not-object");
		}
		const record = item as Record<string, unknown>;
		const visitTime = record.visitTime;
		if (!safeText(visitTime, 64)) invalid("visit-time-invalid");
		return {
			visitTime,
			...(optionalText(record.departmentName, 128)
				? { departmentName: record.departmentName as string }
				: {}),
			...(optionalText(record.doctorName, 128)
				? { doctorName: record.doctorName as string }
				: {}),
			...(optionalText(record.hospitalName, 128)
				? { hospitalName: record.hospitalName as string }
				: {}),
			...(optionalText(record.clinicTypeName, 128)
				? { clinicTypeName: record.clinicTypeName as string }
				: {}),
			...(optionalText(record.chargeClassName, 128)
				? { chargeClassName: record.chargeClassName as string }
				: {}),
			...(optionalText(record.diagnosis, 4096)
				? { diagnosis: record.diagnosis as string }
				: {}),
		};
	});
}

/** 门诊病历只读网关；详情、编辑和住院病历使用独立 contract。 */
export interface OutpatientMedicalRecordGateway {
	listRecords(
		input: {
			providerPatientId: string;
			query: OutpatientMedicalRecordQuery;
		},
		context: AdapterCallContext,
	): Promise<{
		records: readonly OutpatientMedicalRecord[];
		trace: ExternalTrace;
	}>;
}

/** 服务端映射引用的二次运行时检查，防止错误患者号进入病历接口。 */
export function validateMedicalRecordProviderReference(
	reference: unknown,
	patientId: string,
): boolean {
	if (
		typeof reference !== "object" ||
		reference === null ||
		Array.isArray(reference)
	) {
		return false;
	}
	const candidate = reference as Record<string, unknown>;
	return (
		candidate.patientId === patientId &&
		candidate.provider === "zhongyang" &&
		isBoundedOpaqueIdentifier(candidate.patientId) &&
		isBoundedOpaqueIdentifier(candidate.providerPatientId)
	);
}
