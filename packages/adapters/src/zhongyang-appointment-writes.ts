import type {
	AdapterCallContext,
	AppointmentPatientProfileGateway,
	AppointmentProviderRecord,
	AppointmentRegistrationPatient,
	AppointmentWriteGateway,
	ExternalTrace,
} from "@hospital/domain";
import {
	AdapterNotConfiguredError,
	ProviderRequestError,
	type ProviderFailureReason,
} from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import type { ZhongyangGatewayOptions } from "./zhongyang-patients";

const SOURCE_PATH = "/msun-middle-business-amc-server/v1/sources/";
const LOCKED_SOURCE_PATH =
	"/msun-middle-business-amc-server/v1/sources/locked-sources";
const FACT_FEE_PATH =
	"/msun-middle-business-appointment-server/v1/appointment-infos/fact-register-fee";
const APPOINTMENT_PATH =
	"/msun-middle-business-appointment-server/v1/appointment-infos";
const RECORD_PATH = `${APPOINTMENT_PATH}/`;
const PATIENT_INFO_PATH = "/api/public/patientInfoByUnionId";
const PATIENT_ARCHIVE_PATH = "/msun-middle-aggregate-patient/v1/patInfosFind";
// 众阳 2.10.3/2.10.4 合同明确约定：门诊微信渠道编码为 3。
const REQUEST_CHANNEL = "3";

type ProviderObject = Record<string, unknown>;

function requiredBaseUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol !== "https:") throw new Error();
		return value.replace(/\/$/, "");
	} catch {
		throw new AdapterNotConfiguredError("zhongyang");
	}
}

function providerError(
	operation: string,
	message: string,
	requestId?: string,
	responseInvalid = true,
	reason?: ProviderFailureReason,
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "zhongyang",
		operation,
		message,
		retryable: false,
		responseInvalid,
		...(reason ? { reason } : {}),
		...(requestId ? { requestId } : {}),
	});
}

function objectValue(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw providerError(
			operation,
			"Zhongyang appointment response was invalid",
			requestId,
		);
	}
	return value as ProviderObject;
}

function successfulEnvelope(
	value: ProviderObject,
	operation: string,
	requestId: string,
): unknown {
	if (Array.isArray(value)) return value;
	const code = value.code;
	const success = value.success;
	const ok = success === true || code === 0 || code === "0" || code === "0000";
	if (success !== undefined && typeof success !== "boolean") {
		throw providerError(
			operation,
			"Zhongyang appointment success flag was invalid",
			requestId,
		);
	}
	if (
		code !== undefined &&
		typeof code !== "string" &&
		typeof code !== "number"
	) {
		throw providerError(
			operation,
			"Zhongyang appointment response code was invalid",
			requestId,
		);
	}
	if (!ok) {
		throw providerError(
			operation,
			"Zhongyang appointment provider rejected the request",
			requestId,
			false,
		);
	}
	return value.data ?? value;
}

function items(
	value: unknown,
	operation: string,
	requestId: string,
): ProviderObject[] {
	const payload = Array.isArray(value)
		? value
		: successfulEnvelope(
				objectValue(value, operation, requestId),
				operation,
				requestId,
			);
	if (!Array.isArray(payload)) {
		throw providerError(
			operation,
			"Zhongyang appointment response list was invalid",
			requestId,
		);
	}
	if (
		payload.length > 512 ||
		payload.some(
			(item) =>
				typeof item !== "object" || item === null || Array.isArray(item),
		)
	) {
		throw providerError(
			operation,
			"Zhongyang appointment response list was invalid",
			requestId,
		);
	}
	return payload as ProviderObject[];
}

function text(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
	required = true,
): string {
	if (
		(typeof value !== "string" && typeof value !== "number") ||
		(typeof value === "number" && !Number.isSafeInteger(value))
	) {
		if (!required && (value === undefined || value === null || value === ""))
			return "";
		throw providerError(operation, `Zhongyang ${field} was invalid`, requestId);
	}
	const result = String(value).trim();
	if (!result && required)
		throw providerError(operation, `Zhongyang ${field} was missing`, requestId);
	if (
		result.length > 256 ||
		Array.from(result).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	)
		throw providerError(operation, `Zhongyang ${field} was invalid`, requestId);
	return result;
}

function providerInteger(
	value: unknown,
	field: string,
	operation: string,
): number {
	const raw =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d+$/.test(value.trim())
				? Number(value.trim())
				: Number.NaN;
	if (!Number.isSafeInteger(raw) || raw < 0) {
		throw providerError(
			operation,
			`Zhongyang ${field} must be a non-negative integer`,
			undefined,
			false,
		);
	}
	return raw;
}

function yuanToFen(
	value: unknown,
	field: string,
	operation: string,
	requestId: string,
): number {
	const raw =
		typeof value === "number"
			? String(value)
			: typeof value === "string"
				? value.trim()
				: "";
	if (!/^\d+(?:\.\d{1,2})?$/.test(raw))
		throw providerError(
			operation,
			`Zhongyang ${field} amount was invalid`,
			requestId,
		);
	const [whole] = raw.split(".");
	const fraction = raw.split(".")[1] ?? "";
	const fen = BigInt(whole ?? "") * 100n + BigInt(fraction.padEnd(2, "0"));
	if (fen <= 0n || fen > BigInt(Number.MAX_SAFE_INTEGER))
		throw providerError(
			operation,
			`Zhongyang ${field} amount was invalid`,
			requestId,
		);
	return Number(fen);
}

function trace(
	operation: string,
	requestId: string,
	requestIds?: string[],
): ExternalTrace {
	return {
		provider: "zhongyang",
		operation,
		requestId,
		...(requestIds && requestIds.length > 1 ? { requestIds } : {}),
	};
}

function headers(token: string | undefined): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {};
}

/** 预约写入所需患者信息只在本 adapter 内从服务端身份重新解析。 */
export class ZhongyangAppointmentPatientProfileGateway
	implements AppointmentPatientProfileGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredBaseUrl(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	async resolve(
		input: { unionId: string; providerPatientId: string },
		context: AdapterCallContext,
	) {
		const listOperation = "appointment-patient-profile";
		if (!input.unionId.trim() || !input.providerPatientId.trim())
			throw providerError(
				listOperation,
				"Appointment patient identity was invalid",
				undefined,
				false,
			);
		const bindingUrl = new URL(PATIENT_INFO_PATH, this.baseUrl);
		bindingUrl.searchParams.set("unionId", input.unionId);
		const binding = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: listOperation,
				url: bindingUrl.toString(),
				method: "GET",
				context,
				headers: headers(this.authorizationToken),
			},
			this.fetcher,
		);
		const bindingItems = items(binding.data, listOperation, binding.requestId);
		const selected = bindingItems.find(
			(item) =>
				text(
					item.thirdPatientId,
					"thirdPatientId",
					listOperation,
					binding.requestId,
				) === input.providerPatientId,
		);
		if (!selected)
			throw providerError(
				listOperation,
				"Appointment patient binding was not found",
				binding.requestId,
				false,
			);
		const name = text(
			selected.patientName ?? selected.patName ?? selected.name,
			"patientName",
			listOperation,
			binding.requestId,
		);
		const cardNo = text(
			selected.medicalCardNo ?? selected.cardNo,
			"medicalCardNo",
			listOperation,
			binding.requestId,
		);
		const phone = text(
			selected.mobile ?? selected.telephone ?? selected.phone,
			"phone",
			listOperation,
			binding.requestId,
		);
		const archiveUrl = new URL(PATIENT_ARCHIVE_PATH, this.baseUrl);
		archiveUrl.searchParams.set("type", "3");
		archiveUrl.searchParams.set("cardNo", cardNo);
		archiveUrl.searchParams.set("patName", name);
		const archive = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation: "appointment-patient-archive",
				url: archiveUrl.toString(),
				method: "GET",
				context,
				headers: headers(this.authorizationToken),
			},
			this.fetcher,
		);
		const archiveEnvelope = objectValue(
			archive.data,
			"appointment-patient-archive",
			archive.requestId,
		);
		const archiveData = objectValue(
			successfulEnvelope(
				archiveEnvelope,
				"appointment-patient-archive",
				archive.requestId,
			),
			"appointment-patient-archive",
			archive.requestId,
		);
		const hisPatientId = text(
			archiveData.patId,
			"patId",
			"appointment-patient-archive",
			archive.requestId,
		);
		const idNo = text(
			archiveData.idCardNo ??
				archiveData.idcardNo ??
				archiveData.idNo ??
				archiveData.certNo ??
				selected.idCardNo ??
				selected.idcardNo,
			"idNo",
			"appointment-patient-archive",
			archive.requestId,
		);
		return {
			patient: {
				providerPatientId: hisPatientId,
				name,
				cardNo,
				idNo,
				phone,
			} satisfies AppointmentRegistrationPatient,
			trace: trace(listOperation, archive.requestId, [
				binding.requestId,
				archive.requestId,
			]),
		};
	}
}

/** 众阳预约写入/费用/取消 adapter；不向公共 contract 暴露 provider 引用。 */
export class ZhongyangAppointmentWriteApiGateway
	implements AppointmentWriteGateway
{
	private readonly baseUrl: string;
	private readonly authorizationToken: string | undefined;
	private readonly fetcher: ProviderFetcher;

	constructor(options: ZhongyangGatewayOptions) {
		this.baseUrl = requiredBaseUrl(options.baseUrl);
		this.authorizationToken = options.authorizationToken?.trim() || undefined;
		this.fetcher = options.fetcher ?? fetch;
	}

	private async get<T>(
		operation: string,
		path: string,
		context: AdapterCallContext,
		query: Record<string, string>,
	): Promise<{ data: T; requestId: string }> {
		const url = new URL(path, this.baseUrl);
		for (const [key, value] of Object.entries(query))
			url.searchParams.set(key, value);
		return requestJson<T>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				headers: headers(this.authorizationToken),
			},
			this.fetcher,
		);
	}

	private async post<T>(
		operation: string,
		path: string,
		context: AdapterCallContext,
		body: Record<string, unknown>,
	): Promise<{ data: T; requestId: string }> {
		return requestJson<T>(
			{
				provider: "zhongyang",
				operation,
				url: new URL(path, this.baseUrl).toString(),
				method: "POST",
				context,
				body,
				headers: headers(this.authorizationToken),
			},
			this.fetcher,
		);
	}

	async resolveSource(
		input: {
			providerScheduleId: string;
			providerPatientId: string;
			sourceSerialNumber: string;
		},
		context: AdapterCallContext,
	) {
		const operation = "appointment-source-resolve";
		const providerScheduleId = providerInteger(
			input.providerScheduleId,
			"hisScheduleId",
			operation,
		);
		const response = await this.get<unknown>(
			operation,
			`${SOURCE_PATH}${providerScheduleId}`,
			context,
			{ requestChannel: REQUEST_CHANNEL },
		);
		const source = items(response.data, operation, response.requestId).find(
			(item) =>
				text(
					item.serialNumber,
					"serialNumber",
					operation,
					response.requestId,
				) === input.sourceSerialNumber,
		);
		if (!source)
			throw providerError(
				operation,
				"Appointment source is no longer available",
				response.requestId,
				false,
				"appointment-source-unavailable",
			);
		const sourceId = providerInteger(source.sourceId, "sourceId", operation);
		const providerPatientId = providerInteger(
			input.providerPatientId,
			"patId",
			operation,
		);
		const lockedSourceBody: Record<string, unknown> = {
			requestChannel: REQUEST_CHANNEL,
			hisScheduleId: providerScheduleId,
			sourceId,
			patId: providerPatientId,
		};
		// 点号源的可选时间段字段在众阳响应中可能以 null/空串表示未提供；
		// 两端都缺失时不发送范围字段，只有单端存在才视为合同形状错误。
		const hasGroupStart =
			source.groupStart !== undefined &&
			source.groupStart !== null &&
			source.groupStart !== "";
		const hasGroupEnd =
			source.groupEnd !== undefined &&
			source.groupEnd !== null &&
			source.groupEnd !== "";
		if (hasGroupStart !== hasGroupEnd) {
			throw providerError(
				operation,
				"Zhongyang appointment source time range is incomplete",
				response.requestId,
				false,
			);
		}
		if (hasGroupStart && hasGroupEnd) {
			const groupStart = text(
				source.groupStart,
				"groupStart",
				operation,
				response.requestId,
			);
			const groupEnd = text(
				source.groupEnd,
				"groupEnd",
				operation,
				response.requestId,
			);
			if (
				!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(groupStart) ||
				!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(groupEnd) ||
				groupStart >= groupEnd
			) {
				throw providerError(
					operation,
					"Zhongyang appointment source time range is invalid",
					response.requestId,
					false,
				);
			}
			lockedSourceBody.groupStart = groupStart;
			lockedSourceBody.groupEnd = groupEnd;
		}
		const locked = await this.post<unknown>(
			"appointment-source-lock",
			LOCKED_SOURCE_PATH,
			context,
			lockedSourceBody,
		);
		const lockedEnvelope = objectValue(
			locked.data,
			"appointment-source-lock",
			locked.requestId,
		);
		const lockedPayload = successfulEnvelope(
			lockedEnvelope,
			"appointment-source-lock",
			locked.requestId,
		);
		const lockedData = objectValue(
			lockedPayload,
			"appointment-source-lock",
			locked.requestId,
		);
		const lockedSourceId = providerInteger(
			lockedData.sourceId,
			"sourceId",
			"appointment-source-lock",
		);
		if (lockedSourceId !== sourceId) {
			throw providerError(
				"appointment-source-lock",
				"Zhongyang locked source did not match the requested source",
				locked.requestId,
				false,
			);
		}
		return {
			providerSourceId: String(lockedSourceId),
			sourceSerialNumber: text(
				source.serialNumber,
				"serialNumber",
				operation,
				response.requestId,
			),
			trace: trace(operation, response.requestId, [
				response.requestId,
				locked.requestId,
			]),
		};
	}

	async getFactRegisterFee(
		input: { providerScheduleId: string; providerPatientId: string },
		context: AdapterCallContext,
	) {
		const operation = "appointment-fact-register-fee";
		const providerScheduleId = providerInteger(
			input.providerScheduleId,
			"hisScheduleId",
			operation,
		);
		const providerPatientId = providerInteger(
			input.providerPatientId,
			"patId",
			operation,
		);
		const response = await this.get<unknown>(
			operation,
			FACT_FEE_PATH,
			context,
			{
				hisScheduleId: String(providerScheduleId),
				patId: String(providerPatientId),
				requestChannel: REQUEST_CHANNEL,
			},
		);
		const envelope = objectValue(response.data, operation, response.requestId);
		const payload = successfulEnvelope(envelope, operation, response.requestId);
		const data = objectValue(payload, operation, response.requestId);
		return {
			totalFen: yuanToFen(
				data.factRegisterFee ?? data.registrationFee ?? data.registFree,
				"factRegisterFee",
				operation,
				response.requestId,
			),
			trace: trace(operation, response.requestId),
		};
	}

	async listActive(
		input: { providerPatientId: string; workDate: string },
		context: AdapterCallContext,
	) {
		const operation = "appointment-active-records";
		const providerPatientId = providerInteger(
			input.providerPatientId,
			"patId",
			operation,
		);
		const response = await this.get<unknown>(
			operation,
			`${RECORD_PATH}${providerPatientId}`,
			context,
			{
				requestChannel: REQUEST_CHANNEL,
				startDate: input.workDate,
				endDate: input.workDate,
				isMzFlag: "1",
				dateFlag: "1",
			},
		);
		const records = items(response.data, operation, response.requestId).map(
			(item): AppointmentProviderRecord => {
				const status = Number(item.status);
				return {
					providerAppointmentId: text(
						item.appointmentInfoId,
						"appointmentInfoId",
						operation,
						response.requestId,
					),
					providerPatientId: text(
						item.patId,
						"patId",
						operation,
						response.requestId,
					),
					departmentName: text(
						item.deptName,
						"deptName",
						operation,
						response.requestId,
						false,
					),
					workDate: text(
						item.workDate,
						"workDate",
						operation,
						response.requestId,
					),
					status:
						status === 1
							? "cancelled"
							: status === 3
								? "completed"
								: status === 0
									? "active"
									: "unknown",
					...(item.registerId !== undefined
						? {
								providerRegisterId: text(
									item.registerId,
									"registerId",
									operation,
									response.requestId,
								),
							}
						: {}),
					...(item.hisRegisterId !== undefined
						? {
								providerHisRegisterId: text(
									item.hisRegisterId,
									"hisRegisterId",
									operation,
									response.requestId,
								),
							}
						: {}),
				};
			},
		);
		return {
			records: records.filter((record) => record.status === "active"),
			trace: trace(operation, response.requestId),
		};
	}

	async create(
		input: {
			patient: AppointmentRegistrationPatient;
			target: {
				providerScheduleId: string;
				providerSourceId: string;
				workDate: string;
			};
			totalFen: number;
			recordId: string;
		},
		context: AdapterCallContext,
	) {
		const operation = "appointment-registration-create";
		const providerPatientId = providerInteger(
			input.patient.providerPatientId,
			"patId",
			operation,
		);
		const providerScheduleId = providerInteger(
			input.target.providerScheduleId,
			"hisScheduleId",
			operation,
		);
		const providerSourceId = providerInteger(
			input.target.providerSourceId,
			"sourceId",
			operation,
		);
		const response = await this.post<unknown>(
			operation,
			APPOINTMENT_PATH,
			context,
			{
				patId: providerPatientId,
				patName: input.patient.name,
				patCardNo: input.patient.cardNo,
				idcardNo: input.patient.idNo,
				registrationFee: input.totalFen / 100,
				workDate: input.target.workDate,
				telephone: input.patient.phone,
				hisScheduleId: providerScheduleId,
				sourceId: providerSourceId,
				isPay: "0",
				requestChannel: REQUEST_CHANNEL,
				recordId: input.recordId,
			},
		);
		const envelope = objectValue(response.data, operation, response.requestId);
		const payload = successfulEnvelope(envelope, operation, response.requestId);
		const data = objectValue(payload, operation, response.requestId);
		return {
			providerAppointmentId: text(
				data.appointmentInfoId,
				"appointmentInfoId",
				operation,
				response.requestId,
			),
			...(data.registerId !== undefined
				? {
						providerRegisterId: text(
							data.registerId,
							"registerId",
							operation,
							response.requestId,
						),
					}
				: {}),
			...(data.hisRegisterId !== undefined
				? {
						providerHisRegisterId: text(
							data.hisRegisterId,
							"hisRegisterId",
							operation,
							response.requestId,
						),
					}
				: {}),
			trace: trace(operation, response.requestId),
		};
	}

	async cancel(
		input: { providerPatientId: string; providerAppointmentId: string },
		context: AdapterCallContext,
	) {
		const operation = "appointment-cancellation";
		const providerPatientId = providerInteger(
			input.providerPatientId,
			"patId",
			operation,
		);
		const providerAppointmentId = providerInteger(
			input.providerAppointmentId,
			"appointmentInfoId",
			operation,
		);
		const response = await this.post<unknown>(
			`${operation}`,
			`${APPOINTMENT_PATH}/d`,
			context,
			{
				requestChannel: REQUEST_CHANNEL,
				appointmentInfoId: providerAppointmentId,
				patId: providerPatientId,
			},
		);
		const envelope = objectValue(response.data, operation, response.requestId);
		successfulEnvelope(envelope, operation, response.requestId);
		return { trace: trace(operation, response.requestId) };
	}
}

export function createZhongyangAppointmentWriteGateway(
	options: ZhongyangGatewayOptions,
): AppointmentWriteGateway {
	return new ZhongyangAppointmentWriteApiGateway(options);
}

export function createZhongyangAppointmentPatientProfileGateway(
	options: ZhongyangGatewayOptions,
): AppointmentPatientProfileGateway {
	return new ZhongyangAppointmentPatientProfileGateway(options);
}
