import type {
	AdapterCallContext,
	ExternalTrace,
	OutpatientMedicalRecord,
	OutpatientMedicalRecordGateway,
	OutpatientMedicalRecordQuery,
} from "@hospital/domain";
import {
	MAX_OUTPATIENT_MEDICAL_RECORDS,
	normalizeOutpatientMedicalRecords,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const OUTPATIENT_RECORD_PATH =
	"/msun-middle-aggregate-clinic/v1/out-visit-records";

type ProviderObject = Record<string, unknown>;

function providerError(
	message: string,
	requestId?: string,
	responseInvalid = true,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation: "outpatient-medical-records",
		message,
		retryable: false,
		responseInvalid,
		...(requestId ? { requestId } : {}),
	});
}

function requiredConfig(value: string): string {
	const normalized = value.trim();
	if (!normalized) throw new AdapterNotConfiguredError("zhongyang");
	return normalized;
}

function safeText(value: unknown, maxLength: number): string | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" && typeof value !== "number") return undefined;
	const normalized = String(value).trim();
	if (
		!normalized ||
		normalized.length > maxLength ||
		Array.from(normalized).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		return undefined;
	}
	return normalized;
}

function recordObject(value: unknown, requestId: string): ProviderObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			"Zhongyang outpatient medical record item was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

/**
 * 门诊病历旧接口使用 `success=true, code=0000, data=[]` 包络。
 *
 * 成功空数组是合法的“没有病历”，但 HTTP 200 或缺少成功标志都不能直接
 * 解释为空，否则上游权限失败会被页面伪装成“未查询到记录”。
 */
function responseItems(value: unknown, requestId: string): ProviderObject[] {
	if (Array.isArray(value)) {
		if (value.length > MAX_OUTPATIENT_MEDICAL_RECORDS) {
			throw providerError(
				"Zhongyang outpatient medical record response contained too many items",
				requestId,
			);
		}
		return value.map((item) => recordObject(item, requestId));
	}
	if (typeof value !== "object" || value === null) {
		throw providerError(
			"Zhongyang outpatient medical record response was invalid",
			requestId,
		);
	}
	const envelope = value as ProviderObject;
	const success = envelope.success;
	const code = envelope.code;
	const successfulCode = code === 0 || code === "0" || code === "0000";
	if (
		(success !== undefined && success !== true) ||
		(code !== undefined && !successfulCode) ||
		(success !== true && !successfulCode)
	) {
		throw providerError(
			"Zhongyang outpatient medical record provider rejected the request",
			requestId,
			false,
		);
	}
	if (!Array.isArray(envelope.data)) {
		throw providerError(
			"Zhongyang outpatient medical record response data was invalid",
			requestId,
		);
	}
	if (envelope.data.length > MAX_OUTPATIENT_MEDICAL_RECORDS) {
		throw providerError(
			"Zhongyang outpatient medical record response contained too many items",
			requestId,
		);
	}
	return envelope.data.map((item) => recordObject(item, requestId));
}

function trace(requestId: string): ExternalTrace {
	return {
		provider: "zhongyang",
		operation: "outpatient-medical-records",
		requestId,
	};
}

function mapRecord(
	value: ProviderObject,
	requestId: string,
): OutpatientMedicalRecord {
	const visitTime = safeText(
		value.visitDate ?? value.visitTime ?? value.visitDateTime,
		64,
	);
	if (!visitTime) {
		throw providerError(
			"Zhongyang outpatient medical record visit time was invalid",
			requestId,
		);
	}
	const departmentName = safeText(value.deptName, 128);
	const doctorName = safeText(value.doctorName ?? value.docName, 128);
	const hospitalName = safeText(value.hospitalName, 128);
	const clinicTypeName = safeText(value.clinicTypeName, 128);
	const chargeClassName = safeText(value.chargeClassName, 128);
	const diagnosis = safeText(
		value.diagnosisName ?? value.diagnosis ?? value.diagnosisContent,
		4096,
	);
	return {
		visitTime,
		...(departmentName ? { departmentName } : {}),
		...(doctorName ? { doctorName } : {}),
		...(hospitalName ? { hospitalName } : {}),
		...(clinicTypeName ? { clinicTypeName } : {}),
		...(chargeClassName ? { chargeClassName } : {}),
		...(diagnosis ? { diagnosis } : {}),
	};
}

/**
 * 众阳门诊病历只读 adapter。
 *
 * `patId` 来自服务端 owner-scoped 的 `his-patient` 映射，调用方不能从小
 * 程序把它直接传进来。Provider 原始响应先收窄字段，再由 domain 二次校验。
 */
export class ZhongyangMedicalRecordApiGateway
	implements OutpatientMedicalRecordGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredConfig(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async listRecords(
		input: {
			providerPatientId: string;
			query: OutpatientMedicalRecordQuery;
		},
		context: AdapterCallContext,
	) {
		if (
			typeof input?.providerPatientId !== "string" ||
			!input.providerPatientId.trim() ||
			typeof input?.query?.startDate !== "string" ||
			typeof input?.query?.endDate !== "string"
		) {
			throw providerError(
				"Zhongyang outpatient medical record request was invalid",
				undefined,
				false,
			);
		}
		const url = new URL(OUTPATIENT_RECORD_PATH, this.baseUrl);
		const headers = this.authorizationToken
			? { Authorization: `Bearer ${this.authorizationToken}` }
			: undefined;
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "outpatient-medical-records",
				url: url.toString(),
				method: "POST",
				context,
				...(headers ? { headers } : {}),
				body: {
					// 旧端 out-visit-records 接收完整的就诊时间边界；公共 API
					// 只允许自然日，避免小程序自行构造跨时区时间。
					startDate: `${input.query.startDate} 00:00:00`,
					endDate: `${input.query.endDate} 23:59:59`,
					type: "5",
					patId: input.providerPatientId,
				},
			},
			this.fetcher,
		);
		const items = responseItems(response.data, response.requestId);
		const records = normalizeOutpatientMedicalRecords(
			items.map((item) => mapRecord(item, response.requestId)),
		);
		return { records, trace: trace(response.requestId) };
	}
}

export function createZhongyangMedicalRecordGateway(
	options: ZhongyangGatewayOptions,
): OutpatientMedicalRecordGateway {
	return new ZhongyangMedicalRecordApiGateway(options);
}
