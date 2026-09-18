import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	AppointmentMedicalInsurancePatient,
	ExternalTrace,
	MedicalInsuranceAmounts,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceAuthorizationRepository,
	MedicalInsuranceBusinessContext,
	MedicalInsuranceBusinessType,
	MedicalInsuranceCancellationEvidence,
	MedicalInsuranceCredentialRepository,
	MedicalInsuranceGateway,
	MedicalInsuranceOrderRepository,
	MedicalInsuranceSettlementContext,
	MedicalInsuranceSettlementEvidence,
	PaymentAmounts,
} from "@hospital/domain";
import {
	assertValidMedicalInsuranceAmounts,
	assertValidPaymentAmounts,
} from "@hospital/domain";
import {
	AdapterNotConfiguredError,
	type ProviderFailureReason,
	type ProviderFailureStage,
	ProviderRequestError,
	type ProviderRequestOutcome,
} from "./errors";
import { type ProviderFetcher, requestJson } from "./http";
import {
	type classifyLegacyFsiOrderStatus,
	type LegacyFsi6202SettlementSource,
	yuanToFen,
} from "./legacy-fsi-contract";
import type {
	LegacyFsiGateway,
	LegacyFsiSettlementQueryResult,
	ProviderDiagnosticLogger,
} from "./legacy-fsi-gateway";

const DEFAULT_USER_QUERY_BASE_URL = "https://test-receiver.wecity.qq.com";
const DEFAULT_USER_QUERY_PATH = "/api/mipuserquery/userQuery/50010828";
const DEFAULT_FOUNDATION_PATH = "/mbs-fsi/web/api/fsi/callService";
const DEFAULT_AUTH_SYS_CODE = "thirdSelfMachine";
const DEFAULT_APP_CODE = "WeChatSmallProg";
const DEFAULT_SCENE_CODE = "WeChatSmallProgram";
const DEFAULT_TRADE_TYPE_CODE = "10";
const DEFAULT_REGISTER_SOURCE = 15;
const DEFAULT_SETTLE_WAY = 6;
const DEFAULT_PRE_ORDER_AUTO_SETTLE = 3;
// HIS 2.27.2.32 的 insurOrgId 是医保测试通道的数值机构 ID，
// 与 1101/6201/6202 使用的 fixmedins/orgCodg 字符串不能混用。
const DEFAULT_SETTLEMENT_INSUR_ORG_ID = 10001;
const DEFAULT_SETTLEMENT_FIXMEDINS_NAME = "高平市人民医院";
const DEFAULT_SETTLEMENT_FIXMEDINS_CODE = "H14058101270";
const DEFAULT_SETTLEMENT_OUT_VISIT_RECORD_ID = -1;
// 众阳 2.6.65.4 文档示例使用 2；2.6.65.11 仍沿用挂号旧端实际使用的 3。
const DEFAULT_PAY_QUERY_AUTO_SETTLE = 2;
// 6201 的就医凭证类型沿用当前 1101 授权请求使用的居民身份证类型。
const DEFAULT_MDTRT_CERT_TYPE = "01";
// 当前院方提供的可用医保测试参数中的医院坐标；可由调用方按院区覆盖。
const DEFAULT_ULD_LATLNT = "112.928537,35.787393";

type ProviderRecord = Record<string, unknown>;

/**
 * 挂号 2.6.65.1 必须使用预约创建返回的挂号流水。
 * 高平众阳通常只返回 hisRegisterId；不能用 `in providerRegisterId`
 * 判断是否进入挂号分支，否则属性被上层按需省略时会把 registerId 丢掉。
 */
export function resolveRegistrationProviderRegisterId(input: {
	appointmentId?: string;
	providerAppointmentId?: string;
	providerRegisterId?: string;
	providerHisRegisterId?: string;
}): string | undefined {
	if (!input.appointmentId) return undefined;
	return (
		input.providerRegisterId ??
		input.providerHisRegisterId ??
		input.providerAppointmentId
	);
}

export type LegacyFsiMedicalInsuranceGatewayOptions = {
	legacyFsi: Pick<
		LegacyFsiGateway,
		"uploadFees" | "createPaymentOrder" | "querySettlement"
	>;
	orders: MedicalInsuranceOrderRepository;
	authorizations: MedicalInsuranceAuthorizationRepository;
	credentials: MedicalInsuranceCredentialRepository;
	relayUrl: string;
	relayAuthorizationToken: string;
	foundationBaseUrl: string;
	/** 1101 通用 FSI 路径；未配置时兼容既有高平路径。 */
	foundationPath?: string;
	zhongyangBaseUrl: string;
	zhongyangAuthorizationToken?: string;
	userQueryBaseUrl?: string;
	userQueryPath?: string;
	orgCode?: string;
	hospitalId?: string;
	/** 1101 可接受险种，按优先级排列。 */
	insutypes?: readonly string[];
	insuCode?: string;
	/** 6201 uldLatlnt；没有分院区配置时使用院方确认的默认坐标。 */
	uldLatlnt?: string;
	/** 只写入阶段、字段来源和数量，不写入医保凭证或患者原文。 */
	logger?: ProviderDiagnosticLogger;
	fetcher?: ProviderFetcher;
	now?: () => Date;
	createId?: () => string;
};

function absoluteUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol !== "http:" && url.protocol !== "https:")
			throw new Error();
		return value.replace(/\/$/, "");
	} catch {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
}

function requiredConfig(value: string | undefined): string {
	if (!value?.trim()) {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
	return value.trim();
}

function forwardPath(value: string | undefined): string {
	const path = value?.trim() || DEFAULT_FOUNDATION_PATH;
	if (
		!path.startsWith("/") ||
		path.startsWith("//") ||
		path.includes("?") ||
		path.includes("#") ||
		/\s/u.test(path)
	) {
		throw new AdapterNotConfiguredError("medical-insurance");
	}
	return path;
}

function safeText(
	value: unknown,
	operation: string,
	requestId: string | undefined,
	field: string,
	max = 256,
): string {
	if (
		(typeof value !== "string" &&
			typeof value !== "number" &&
			typeof value !== "bigint") ||
		(typeof value === "number" && !Number.isSafeInteger(value))
	) {
		throw responseError(operation, `${field} is invalid`, requestId);
	}
	const text = String(value).trim();
	if (
		!text ||
		text.length > max ||
		Array.from(text).some((character) => {
			const code = character.charCodeAt(0);
			return code <= 0x1f || code === 0x7f;
		})
	) {
		throw responseError(operation, `${field} is invalid`, requestId);
	}
	return text;
}

function optionalText(
	record: ProviderRecord,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (value === undefined || value === null || value === "") continue;
		return safeText(value, operation, requestId, key);
	}
	return undefined;
}

function requiredText(
	record: ProviderRecord,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
): string {
	for (const key of keys) {
		const value = optionalText(record, [key], operation, requestId);
		if (value) return value;
	}
	throw responseError(operation, `${keys.join(" or ")} is required`, requestId);
}

function responseError(
	operation: string,
	message: string,
	requestId?: string,
	details?: {
		providerErrorCode?: string | undefined;
		providerErrorMessage?: string | undefined;
		reason?: ProviderFailureReason | undefined;
		responseInvalid?: boolean | undefined;
		failureStage?: ProviderFailureStage | undefined;
		requestOutcome?: ProviderRequestOutcome | undefined;
	},
): ProviderRequestError {
	const diagnosticMessage = (details?.providerErrorMessage ?? message).slice(
		0,
		128,
	);
	return new ProviderRequestError({
		provider: "medical-insurance",
		operation,
		message,
		retryable: false,
		failureStage: details?.failureStage ?? "response",
		responseInvalid: details?.responseInvalid ?? true,
		...(details?.requestOutcome
			? { requestOutcome: details.requestOutcome }
			: {}),
		...(requestId ? { requestId } : {}),
		...(details?.providerErrorCode
			? { providerErrorCode: details.providerErrorCode.slice(0, 64) }
			: {}),
		...(diagnosticMessage ? { providerErrorMessage: diagnosticMessage } : {}),
		...(details?.reason ? { reason: details.reason } : {}),
	});
}

function recordValue(
	value: unknown,
	operation: string,
	requestId: string | undefined,
): ProviderRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw responseError(
			operation,
			"provider payload must be an object",
			requestId,
		);
	}
	return value as ProviderRecord;
}

/** 众阳接口和 userQuery 都可能增加 data/body/output 包装，但不能无限递归。 */
function unwrapProviderPayload(
	value: unknown,
	operation: string,
	requestId: string | undefined,
): unknown {
	let current = value;
	for (let depth = 0; depth < 4; depth += 1) {
		if (typeof current === "string") {
			// 旧医保转发服务在部分交易上会把上游 JSON 再编码成字符串返回。
			// 先还原这一层，才能继续识别 infcode/baseinfo/insuinfo；不能把
			// HTTP 200 的双重 JSON 误报成“响应格式非法”。
			try {
				current = JSON.parse(current.trim()) as unknown;
			} catch {
				throw responseError(
					operation,
					"provider payload string is not valid JSON",
					requestId,
				);
			}
			continue;
		}
		if (Array.isArray(current)) return current;
		const object = recordValue(current, operation, requestId);
		if (
			"success" in object &&
			object.success !== undefined &&
			typeof object.success !== "boolean"
		) {
			throw responseError(
				operation,
				"provider success flag is invalid",
				requestId,
			);
		}
		if (object.success === false) {
			throw responseError(
				operation,
				String(object.message ?? object.msg ?? "provider rejected the request"),
				requestId,
				{
					providerErrorCode:
						typeof object.code === "string" ? object.code : undefined,
					providerErrorMessage:
						typeof (object.message ?? object.msg) === "string"
							? String(object.message ?? object.msg)
							: undefined,
				},
			);
		}
		if (object.infcode !== undefined && object.infcode !== null) {
			const infcode = String(object.infcode);
			if (infcode !== "0" && infcode !== "1") {
				throw responseError(
					operation,
					String(
						object.err_msg ??
							object.errmsg ??
							object.message ??
							`provider infcode=${infcode}`,
					).slice(0, 256),
					requestId,
					{
						providerErrorCode: infcode,
						providerErrorMessage:
							typeof (object.err_msg ?? object.errmsg ?? object.message) ===
							"string"
								? String(object.err_msg ?? object.errmsg ?? object.message)
								: undefined,
					},
				);
			}
		}
		const nested = ["data", "output", "body"]
			.map((key) => object[key])
			.find((candidate) => typeof candidate === "object" && candidate !== null);
		if (nested === undefined) return current;
		current = nested;
	}
	throw responseError(
		operation,
		"provider payload nesting is too deep",
		requestId,
	);
}

function arrayPayload(
	value: unknown,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
): ProviderRecord[] {
	const payload = unwrapProviderPayload(value, operation, requestId);
	if (Array.isArray(payload)) {
		return payload.map((item) => recordValue(item, operation, requestId));
	}
	const object = recordValue(payload, operation, requestId);
	for (const key of keys) {
		if (Array.isArray(object[key])) {
			return (object[key] as unknown[]).map((item) =>
				recordValue(item, operation, requestId),
			);
		}
		if (typeof object[key] === "object" && object[key] !== null) {
			return [recordValue(object[key], operation, requestId)];
		}
	}
	return [];
}

function findTextAnywhere(
	value: unknown,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
	depth = 0,
): string | undefined {
	if (depth > 4 || value === null || value === undefined) return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findTextAnywhere(
				item,
				keys,
				operation,
				requestId,
				depth + 1,
			);
			if (found) return found;
		}
		return undefined;
	}
	if (typeof value !== "object") return undefined;
	const object = value as ProviderRecord;
	const direct = optionalText(object, keys, operation, requestId);
	if (direct) return direct;
	for (const key of ["data", "output", "body"]) {
		const found = findTextAnywhere(
			object[key],
			keys,
			operation,
			requestId,
			depth + 1,
		);
		if (found) return found;
	}
	return undefined;
}

function firstTextWithSource(
	sources: readonly {
		source: string;
		record: ProviderRecord;
	}[],
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
): { value: string; source: string } | undefined {
	for (const candidate of sources) {
		const value = optionalText(candidate.record, keys, operation, requestId);
		if (value) return { value, source: candidate.source };
	}
	return undefined;
}

function uniqueTextFromRecords(
	records: readonly ProviderRecord[],
	keys: readonly string[],
	label: string,
	operation: string,
	requestId: string | undefined,
): string | undefined {
	const values = [
		...new Set(
			records
				.map((record) => optionalText(record, keys, operation, requestId))
				.filter((value): value is string => Boolean(value)),
		),
	];
	if (values.length > 1) {
		throw responseError(
			operation,
			`同一险种存在多个不同的${label}，无法判定当前有效参保记录`,
			requestId,
		);
	}
	return values[0];
}

function providerKeys(value: unknown): readonly string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [];
	}
	return Object.keys(value as ProviderRecord)
		.sort()
		.slice(0, 48);
}

function objectPayload(
	value: unknown,
	operation: string,
	requestId: string | undefined,
): ProviderRecord {
	return recordValue(
		unwrapProviderPayload(value, operation, requestId),
		operation,
		requestId,
	);
}

function dateTime(date: Date): string {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(date);
	const values = Object.fromEntries(
		parts
			.filter((part) => part.type !== "literal")
			.map((part) => [part.type, part.value]),
	);
	return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

function legacyFsiDateTime(
	value: unknown,
	operation: string,
	requestId: string | undefined,
	field: string,
	fallback: Date,
): string {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) return dateTime(fallback);
	if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) return text;
	if (/^\d{14}$/.test(text)) {
		return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)} ${text.slice(8, 10)}:${text.slice(10, 12)}:${text.slice(12, 14)}`;
	}
	const parsed = new Date(text);
	if (Number.isNaN(parsed.getTime())) {
		throw responseError(
			operation,
			`${field} must be a valid date-time`,
			requestId,
		);
	}
	return dateTime(parsed);
}

function dateTimeCompact(date: Date): string {
	return dateTime(date).replace(/[- :]/g, "");
}

function fenToYuan(value: number): string {
	return (value / 100).toFixed(2);
}

function positiveDecimal(
	value: unknown,
	operation: string,
	requestId: string | undefined,
	field: string,
): number {
	const raw = safeText(value, operation, requestId, field, 64);
	if (!/^\d+(?:\.\d{1,6})?$/.test(raw) || Number(raw) <= 0) {
		throw responseError(
			operation,
			`${field} is not a positive number`,
			requestId,
		);
	}
	const number = Number(raw);
	if (!Number.isFinite(number) || number > 1_000_000_000) {
		throw responseError(operation, `${field} is out of range`, requestId);
	}
	return number;
}

function trace(
	operation: string,
	context: AdapterCallContext,
	requestIds: readonly string[],
	providerOrderId?: string,
): ExternalTrace {
	const ids = [...new Set(requestIds.filter(Boolean))];
	return {
		provider: "medical-insurance",
		operation,
		requestId: ids.at(-1) ?? context.traceId,
		...(ids.length > 1 ? { requestIds: ids } : {}),
		...(providerOrderId ? { providerOrderId } : {}),
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/** 6201 的业务重试必须复用同一个可审计 requestId，避免重试创建新的结算申请。 */
function stableNumericRequestId(value: string): number {
	return Number.parseInt(sha256(value).slice(0, 12), 16);
}

type SettlementMapping = {
	state:
		| "insurance_settled"
		| "cash_pending"
		| "awaiting_confirmation"
		| "failed";
	finality:
		| "processing"
		| "settlement_candidate"
		| "paid"
		| "cancelled"
		| "failed"
		| "unknown";
	authoritative: boolean;
};

function statusMapping(result: {
	statusClass: ReturnType<typeof classifyLegacyFsiOrderStatus>;
	settlement: { ordStas: string };
}): SettlementMapping {
	switch (result.statusClass) {
		case "processing":
			return {
				// 无论 ownPayAmt 是否为 0，6202 已确认金额后都要进入微信官方
				// 医保订单阶段；纯医保也必须创建 INSURANCE_ONLY 订单。
				state: "cash_pending",
				finality: "processing",
				authoritative: false,
			};
		case "settlement_candidate":
			return {
				state: "cash_pending",
				finality: "settlement_candidate",
				authoritative: false,
			};
		case "cancelled":
			return { state: "failed", finality: "cancelled", authoritative: true };
		case "failed":
			return { state: "failed", finality: "failed", authoritative: true };
		case "unknown":
			return {
				state: "awaiting_confirmation",
				finality: "unknown",
				authoritative: false,
			};
	}
}

function mapMedicalAmounts(amounts: {
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
	otherPaymentFen?: number;
	hospitalPartFen?: number;
	personalAccountMutualAidFen?: number;
	personalAccountSelfFen?: number;
	depositFen?: number;
	deliveryFeeFen?: number;
}): MedicalInsuranceAmounts {
	return assertValidMedicalInsuranceAmounts({
		totalFen: amounts.totalFen,
		cashFen: amounts.cashFen,
		personalAccountFen: amounts.personalAccountFen,
		fundFen: amounts.fundFen,
		...(amounts.otherPaymentFen === undefined
			? {}
			: { otherPaymentFen: amounts.otherPaymentFen }),
		...(amounts.hospitalPartFen === undefined
			? {}
			: { hospitalPartFen: amounts.hospitalPartFen }),
		...(amounts.personalAccountMutualAidFen === undefined
			? {}
			: { personalAccountMutualAidFen: amounts.personalAccountMutualAidFen }),
		...(amounts.personalAccountSelfFen === undefined
			? {}
			: { personalAccountSelfFen: amounts.personalAccountSelfFen }),
		...(amounts.depositFen === undefined
			? {}
			: { depositFen: amounts.depositFen }),
		...(amounts.deliveryFeeFen === undefined
			? {}
			: { deliveryFeeFen: amounts.deliveryFeeFen }),
	});
}

function paymentAmounts(
	amounts: MedicalInsuranceAmounts | null,
	requestId: string | undefined,
): PaymentAmounts {
	if (!amounts) {
		throw responseError(
			"medical-insurance.6301",
			"医保查单没有权威或已落库金额",
			requestId,
		);
	}
	return assertValidPaymentAmounts({
		totalFen: amounts.totalFen,
		insuranceFen:
			amounts.personalAccountFen +
			amounts.fundFen +
			(amounts.otherPaymentFen ?? 0),
		cashFen: amounts.cashFen,
	});
}

function tokenFromBaseInfo(baseInfo: ProviderRecord): string | undefined {
	const raw = baseInfo.exp_content ?? baseInfo.expContent;
	if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
		return optionalText(
			raw as ProviderRecord,
			["business_token", "businessToken"],
			"medical-insurance.1101",
			undefined,
		);
	}
	if (typeof raw !== "string" || !raw.trim()) return undefined;
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
			return undefined;
		return optionalText(
			parsed as ProviderRecord,
			["business_token", "businessToken"],
			"medical-insurance.1101",
			undefined,
		);
	} catch {
		return undefined;
	}
}

function detailAmountFen(
	detail: ProviderRecord,
	operation: string,
	requestId: string | undefined,
): number {
	for (const key of ["amount", "getAmount", "detItemFeeSumamt"]) {
		if (
			detail[key] !== undefined &&
			detail[key] !== null &&
			detail[key] !== ""
		) {
			return yuanToFen(detail[key], key, "6201");
		}
	}
	throw responseError(
		operation,
		"outSettleDetailList item has no amount",
		requestId,
	);
}

function mapFeeDetails(
	details: readonly ProviderRecord[],
	business: MedicalInsuranceBusinessContext,
	auth: MedicalInsuranceAuthorizationContext,
	medType: "12" | "11" | "110104",
	deptCode: string,
	deptName: string,
	doctorCode: string,
	doctorName: string,
	chargeBatch: string,
	currentDate: Date,
	requestId: string | undefined,
): Record<string, unknown>[] {
	return details.map((detail, index) => {
		const operation = "medical-insurance.6201-fee-details";
		const amountFen = detailAmountFen(detail, operation, requestId);
		const quantity = positiveDecimal(
			detail.quantity ?? detail.cnt ?? 1,
			operation,
			requestId,
			"quantity",
		);
		const priceFen =
			detail.price !== undefined && detail.price !== null
				? yuanToFen(detail.price, "price", "6201")
				: Math.round(amountFen / quantity);
		if (priceFen <= 0) {
			throw responseError(operation, "fee detail price is invalid", requestId);
		}
		const medListCode = requiredText(
			detail,
			["networkItemCode", "medinsurItemCode", "nationalMedicalInsuranceCode"],
			operation,
			requestId,
		);
		const medinsListCode = requiredText(
			detail,
			["chargeCode", "hisUploadItemCode"],
			operation,
			requestId,
		);
		const medListName = requiredText(
			detail,
			["chargeName", "medinsurItemName", "networkItemName"],
			operation,
			requestId,
		);
		const occurredAt = legacyFsiDateTime(
			optionalText(detail, ["createTime", "feeOcurTime"], operation, requestId),
			operation,
			requestId,
			"feeOcurTime",
			currentDate,
		);
		const rxno =
			optionalText(
				detail,
				["orderId", "orderMainId", "rxno"],
				operation,
				requestId,
			) ??
			("providerAppointmentId" in business
				? business.providerAppointmentId
				: business.recordId);
		return {
			feedetlSn:
				optionalText(
					detail,
					["outSettleDetailId", "outSettleDetailSubId"],
					operation,
					requestId,
				) ?? String(index + 1),
			psnNo:
				optionalText(detail, ["psnNo", "psn_no"], operation, requestId) ??
				auth.psnNo,
			chrgBchno:
				optionalText(
					detail,
					["chrgBchno", "chargeBatchNo"],
					operation,
					requestId,
				) ?? chargeBatch,
			rxCircFlag:
				optionalText(
					detail,
					["rxCircFlag", "rx_circ_flag"],
					operation,
					requestId,
				) ?? "0",
			feeOcurTime: occurredAt,
			medListCodg: medListCode,
			medinsListCodg: medinsListCode,
			detItemFeeSumamt: fenToYuan(amountFen),
			cnt: quantity.toString(),
			pric: fenToYuan(priceFen),
			bilgDeptCodg:
				optionalText(
					detail,
					["billDeptCode", "billInsurDeptCode"],
					operation,
					requestId,
				) ?? deptCode,
			bilgDeptName:
				optionalText(detail, ["billDeptName"], operation, requestId) ??
				deptName,
			bilgDrCodg:
				// 6201 的开单医生编码必须是 2.1.13 返回的医保医师编码；
				// detail.billDocCode 只是众阳/HIS userCode，不能直接出网。
				doctorCode,
			bilgDrName:
				optionalText(detail, ["billDocName"], operation, requestId) ??
				doctorName,
			hospApprFlag:
				optionalText(detail, ["hospApprFlag"], operation, requestId) ?? "1",
			// 费用明细必须与 6201 顶层医疗类别保持一致，不能沿用 HIS 明细中的旧值。
			medType,
			medListName,
			medListSpc:
				optionalText(detail, ["spec", "medListSpc"], operation, requestId) ??
				"",
			rxno,
			acordDeptCodg:
				optionalText(
					detail,
					["exeDeptCode", "exeInsurDeptCode"],
					operation,
					requestId,
				) ?? deptCode,
			acordDeptName:
				optionalText(detail, ["exeDeptName"], operation, requestId) ?? deptName,
			ordersDrCode:
				// 与 bilgDrCodg 保持同一个 2.1.13 medicalInsuranceCode。
				doctorCode,
			ordersDrName:
				optionalText(detail, ["exeDocName"], operation, requestId) ??
				doctorName,
		};
	});
}

function collectTradeOrderIds(
	payload: ProviderRecord,
	operation: string,
	requestId: string | undefined,
): string[] {
	const value = payload.tradeOrderIdList ?? payload.outTradeOrderIdList;
	if (!Array.isArray(value) || value.length === 0) {
		throw responseError(operation, "tradeOrderIdList is required", requestId);
	}
	return value.map((item, index) =>
		safeText(item, operation, requestId, `tradeOrderIdList[${index}]`, 128),
	);
}

type ChildPaymentInspection = {
	nonPayableChildCount: number;
	paymentInProgressCount: number;
};

function inspectChildPaymentRecords(
	records: readonly ProviderRecord[],
	operation: string,
	requestId: string | undefined,
): ChildPaymentInspection {
	const nonPayableChildCount = records.filter((record) => {
		const tradeStatus = optionalText(
			record,
			["tradeStatus"],
			operation,
			requestId,
		);
		const disableSettleFlag = optionalText(
			record,
			["disableSettleFlag"],
			operation,
			requestId,
		);
		return tradeStatus !== "1" || disableSettleFlag === "1";
	}).length;
	const paymentInProgressCount = records.filter((record) => {
		const tradeStatus = optionalText(
			record,
			["tradeStatus"],
			operation,
			requestId,
		);
		const disableSettleFlag = optionalText(
			record,
			["disableSettleFlag"],
			operation,
			requestId,
		);
		const reason = optionalText(
			record,
			["disableSettleReason"],
			operation,
			requestId,
		);
		return (
			tradeStatus === "2" ||
			(disableSettleFlag === "1" &&
				(reason === undefined || /收款|缴费|支付/.test(reason)))
		);
	}).length;
	return { nonPayableChildCount, paymentInProgressCount };
}

function findTextDeep(
	value: unknown,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
	depth = 0,
	seen = new Set<object>(),
): string | undefined {
	if (depth > 8 || value === null || value === undefined) return undefined;
	if (typeof value !== "object") return undefined;
	if (seen.has(value)) return undefined;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findTextDeep(
				item,
				keys,
				operation,
				requestId,
				depth + 1,
				seen,
			);
			if (found) return found;
		}
		return undefined;
	}
	const object = value as ProviderRecord;
	const direct = optionalText(object, keys, operation, requestId);
	if (direct) return direct;
	for (const item of Object.values(object)) {
		const found = findTextDeep(
			item,
			keys,
			operation,
			requestId,
			depth + 1,
			seen,
		);
		if (found) return found;
	}
	return undefined;
}

function findRecordDeep(
	value: unknown,
	keys: readonly string[],
	depth = 0,
	seen = new Set<object>(),
): ProviderRecord | undefined {
	if (depth > 8 || value === null || typeof value !== "object")
		return undefined;
	if (seen.has(value)) return undefined;
	seen.add(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = findRecordDeep(item, keys, depth + 1, seen);
			if (found) return found;
		}
		return undefined;
	}
	const object = value as ProviderRecord;
	for (const key of keys) {
		const candidate = object[key];
		if (
			typeof candidate === "object" &&
			candidate !== null &&
			!Array.isArray(candidate)
		) {
			return candidate as ProviderRecord;
		}
	}
	for (const item of Object.values(object)) {
		const found = findRecordDeep(item, keys, depth + 1, seen);
		if (found) return found;
	}
	return undefined;
}

function providerRecordKeys(value: unknown): string[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return [];
	}
	return Object.keys(value as ProviderRecord)
		.sort()
		.slice(0, 80);
}

function hasProviderField(
	record: ProviderRecord | undefined,
	keys: readonly string[],
): boolean {
	if (!record) return false;
	return keys.some((key) => {
		const value = record[key];
		return value !== undefined && value !== null && String(value).trim() !== "";
	});
}

function providerPayloadShape(value: unknown): Record<string, unknown> {
	if (Array.isArray(value)) {
		return {
			kind: "array",
			count: value.length,
			firstItemKeys: providerRecordKeys(value[0]),
		};
	}
	if (typeof value === "object" && value !== null) {
		const record = value as ProviderRecord;
		const arrayFields = Object.entries(record)
			.filter(([, item]) => Array.isArray(item))
			.slice(0, 20)
			.map(([key, item]) => ({
				key,
				count: (item as unknown[]).length,
				firstItemKeys: providerRecordKeys((item as unknown[])[0]),
			}));
		return {
			kind: "object",
			keys: providerRecordKeys(record),
			arrayFields,
		};
	}
	return { kind: value === null ? "null" : typeof value };
}

function settlementDetailShape(
	details: readonly ProviderRecord[],
	children: readonly ProviderRecord[],
): Record<string, unknown> {
	const summaries = details.slice(0, 20).map((detail, index) => {
		const detailOutTradeOrderId = [
			"outTradeOrderId",
			"out_trade_order_id",
		].find((key) => hasProviderField(detail, [key]));
		const detailChargeId = hasProviderField(detail, ["chargeId"]);
		const childIndex = children.findIndex((child) => {
			const childOutTradeOrderId = [
				"outTradeOrderId",
				"out_trade_order_id",
			].find((key) => hasProviderField(child, [key]));
			const sameOrder =
				detailOutTradeOrderId !== undefined &&
				childOutTradeOrderId !== undefined &&
				String(detail[detailOutTradeOrderId]).trim() ===
					String(child[childOutTradeOrderId]).trim();
			const sameCharge =
				detailChargeId &&
				hasProviderField(child, ["chargeId"]) &&
				String(detail.chargeId).trim() === String(child.chargeId).trim();
			return sameOrder || sameCharge;
		});
		const child = childIndex >= 0 ? children[childIndex] : undefined;
		return {
			index,
			detailKeys: providerRecordKeys(detail),
			childIndex: childIndex >= 0 ? childIndex : undefined,
			matchedBy:
				childIndex < 0
					? "none"
					: detailChargeId &&
							hasProviderField(child, ["chargeId"]) &&
							String(detail.chargeId).trim() === String(child?.chargeId).trim()
						? "chargeId"
						: "outTradeOrderId",
			detailHasOrderId: hasProviderField(detail, ["orderId"]),
			detailHasOutDocOrderId: hasProviderField(detail, ["outDocOrderId"]),
			detailHasOutTradeOrderId: detailOutTradeOrderId !== undefined,
			detailHasChargeId: detailChargeId,
			childKeys: providerRecordKeys(child),
			childHasOrderId: hasProviderField(child, ["orderId"]),
			childHasOutDocOrderId: hasProviderField(child, ["outDocOrderId"]),
		};
	});
	return {
		detailCount: details.length,
		childCount: children.length,
		unmatchedDetailCount: summaries.filter((item) => item.matchedBy === "none")
			.length,
		firstDetails: summaries,
	};
}

function providerField(
	primary: ProviderRecord,
	secondary: ProviderRecord | undefined,
	keys: readonly string[],
): unknown {
	for (const record of [primary, secondary]) {
		if (!record) continue;
		for (const key of keys) {
			const value = record[key];
			if (value !== undefined && value !== null && value !== "") return value;
		}
	}
	return undefined;
}

function settlementPatientIdentifiers(
	settleInfo: ProviderRecord,
): ProviderRecord {
	const outSettlePat = findRecordDeep(settleInfo, [
		"outSettlePat",
		"out_settle_pat",
	]);
	return pickSettlementPatientIdentifiers(outSettlePat);
}

function pickSettlementPatientIdentifiers(
	source: ProviderRecord | undefined,
): ProviderRecord {
	const identifiers: ProviderRecord = {};
	for (const [key, keys] of [
		["chargeClassId", ["chargeClassId", "charge_class_id"]],
		[
			"networkPatClassId",
			["netWorkingPatClassId", "networkPatClassId", "network_pat_class_id"],
		],
		["outVisitRecordId", ["outVisitRecordId", "out_visit_record_id"]],
	] as const) {
		const value = providerField(source ?? {}, undefined, keys);
		if (value !== undefined && value !== null && value !== "") {
			identifiers[key] = value;
		}
	}
	return identifiers;
}

function parsedProviderRecord(value: unknown): ProviderRecord | undefined {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as ProviderRecord;
	}
	if (typeof value !== "string" || !value.trim()) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		return typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
			? (parsed as ProviderRecord)
			: undefined;
	} catch {
		return undefined;
	}
}

function numberValue(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value !== "string" || !value.trim()) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 6202 国家版回包的 extData.preSetl 是 2.27.2.32 主单的主体来源。
 * 这里刻意不展开 .27 返回的 outNetworkSettleMain，只取其 outSettlePat
 * 三个 ID（已在前置阶段以同名窄对象保存）。
 */
function buildOutNetworkSettleMainFrom6202(
	source: LegacyFsi6202SettlementSource | undefined,
	settlementContext: MedicalInsuranceSettlementContext,
	auth: Pick<
		MedicalInsuranceAuthorizationContext,
		"insuplcAdmdvs" | "insutype"
	>,
	settlementInsurOrgId: number,
	settlementTime: Date,
): ProviderRecord {
	if (!source) return {};
	const root = source.root;
	const preSetl = source.preSetl;
	const expContent = parsedProviderRecord(preSetl.exp_content);
	const rootValue = (keys: readonly string[]) =>
		providerField(root, preSetl, keys);
	const preValue = (keys: readonly string[]) =>
		providerField(preSetl, root, keys);
	const expValue = (keys: readonly string[]) =>
		providerField(expContent ?? {}, undefined, keys);
	const main: ProviderRecord = {};
	const set = (key: string, value: unknown) => {
		if (value !== undefined && value !== null && value !== "")
			main[key] = value;
	};

	set("acctMulaidPay", preValue(["acct_mulaid_pay", "acctMulaidPay"]));
	set(
		"actPayDedc",
		expValue(["bkst_amt"]) ?? preValue(["act_pay_dedc", "actPayDedc"]),
	);
	set("amount", rootValue(["feeSumamt"]) ?? preValue(["medfee_sumamt"]));
	set("amountPos", 0);
	set("balc", preValue(["balc"]));
	set("certNo", preValue(["certno", "certNo"]));
	set(
		"chargeClassId",
		providerField(settlementContext.outNetworkSettleMain, undefined, [
			"chargeClassId",
			"charge_class_id",
		]),
	);
	set("clrOptins", preValue(["clr_optins", "clrOptins"]) ?? auth.insuplcAdmdvs);
	set("clrType", preValue(["clr_type", "clrType"]));
	set("clrWay", preValue(["clr_way", "clrWay"]));
	set("customClrOptins", auth.insuplcAdmdvs || preValue(["clr_optins"]));
	// 按当前 HIS 联调映射保留 hifmi_pay；真实样本中该值为 0。
	set("cvlservPay", preValue(["hifmi_pay", "cvlserv_pay"]));
	set("flagOffsite", auth.insuplcAdmdvs.trim().startsWith("14") ? "0" : "1");
	set("fulamtOwnpayAmt", preValue(["fulamt_ownpay_amt"]));
	set("getAmount", preValue(["psn_cash_pay"]));
	set("hifesPay", preValue(["hifes_pay"]));
	set("hifmiPay", preValue(["hifdm_pay", "hifmi_pay"]));
	set("hifobPay", preValue(["hifes_pay", "hifob_pay"]));
	set("hifpPay", preValue(["hifp_pay"]));
	set("hospPartAmt", rootValue(["hospPartAmt"]) ?? preValue(["hosp_part_amt"]));
	set("inscpScpAmt", preValue(["inscp_scp_amt"]));
	set("insuplcAdmdvs", auth.insuplcAdmdvs);
	// Provider 将此字段反序列化为 Long，必须发送 JSON number，不能发送
	// 1101/6201 使用的 H14058101270 字符串机构编码。
	set("insurOrgId", settlementInsurOrgId);
	set("insutype", preValue(["insutype"]));
	const numericValues = [
		...Object.values(root),
		...Object.values(preSetl),
		...(expContent ? Object.values(expContent) : []),
	];
	set(
		"invalidFlag",
		numericValues.some((value) => (numberValue(value) ?? 0) < 0) ? "1" : "0",
	);
	const fundPay = numberValue(rootValue(["fundPay"]));
	const hifpPay = numberValue(preValue(["hifp_pay"]));
	set(
		"joinMedInsurance",
		(fundPay !== undefined && fundPay > 0) ||
			(hifpPay !== undefined && hifpPay > 0)
			? "1"
			: "0",
	);
	set("mafPay", preValue(["maf_pay"]));
	set("mdtrtId", preValue(["mdtrt_id"]));
	set("medAmountBz", preValue(["maf_pay"]));
	set("medAmountDb", preValue(["hifdm_pay", "hifmi_pay"]));
	set("medAmountDbbz", preValue(["hifes_pay"]));
	set("medAmountGwy", preValue(["cvlserv_pay"]));
	set("medAmountJm", preValue(["hifob_pay"]));
	set("medAmountQfx", expValue(["bkst_amt"]));
	set("medAmountQt", preValue(["oth_pay"]));
	set("medAmountTc", preValue(["hifp_pay"]));
	set("medAmountTotal", rootValue(["fundPay"]));
	set("medAmountZhye", preValue(["balc"]));
	set("medAmountZhzf", rootValue(["psnAcctPay"]));
	set("medinsSetlId", preValue(["medins_setl_id"]));
	set("netPatName", preValue(["psn_name"]));
	set("netPatType", preValue(["psn_type"]));
	set(
		"networkPatClassId",
		providerField(settlementContext.outNetworkSettleMain, undefined, [
			"networkPatClassId",
			"netWorkingPatClassId",
			"network_pat_class_id",
		]),
	);
	set("netType", preValue(["med_type"]));
	set("othPay", preValue(["oth_pay"]));
	set(
		"outVisitRecordId",
		providerField(settlementContext.outNetworkSettleMain, undefined, [
			"outVisitRecordId",
			"out_visit_record_id",
		]),
	);
	set(
		"overlmtSelfpay",
		rootValue(["othFeeAmt"]) ?? preValue(["overlmt_selfpay"]),
	);
	set("poolPropSelfpay", preValue(["pool_prop_selfpay"]));
	set("preselfpayAmt", preValue(["preselfpay_amt"]));
	set("psnCertType", preValue(["psn_cert_type"]));
	set("psnName", preValue(["psn_name"]));
	set("psnNo", preValue(["psn_no"]));
	set("psnPartAmt", preValue(["psn_part_amt"]));
	set("setlId", preValue(["medins_setl_id"]));
	// .32 是支付完成后的 HIS 回写：setlTime 使用支付后置分项全部成功时
	// 记录的 postPaymentCompletedAt，不读取 6301 的查询时间；历史上下文
	// 没有该时间时，使用本次 .32 提交时刻作为可审计的服务端兜底。
	const writebackTime =
		settlementContext.postPaymentCompletedAt ?? dateTime(settlementTime);
	set(
		"setlTime",
		legacyFsiDateTime(
			writebackTime,
			"medical-insurance.2.27.2.32",
			undefined,
			"setlTime",
			settlementTime,
		),
	);
	set("settleNo", preValue(["medins_setl_id"]));
	set("settleSource", 4001);
	set("settleType", "1");
	return main;
}

/**
 * 2.27.2.32 的主单是跨接口事实：6202 的 extData.preSetl 提供结算金额、
 * 结算号和医保字段，1101/.27 保存的上下文提供患者/就诊标识，订单金额
 * 只作为已经校验过的最后兜底。不能因为 .27 的 outNetworkSettleMain 为空
 * 就阻断 .32；只要费用明细和支付后置流水已经就绪，就把可用事实合并后提交。
 */
function composeOutNetworkSettleMain(
	settlementContext: MedicalInsuranceSettlementContext,
	options: {
		source?: LegacyFsi6202SettlementSource;
		auth?: MedicalInsuranceAuthorizationContext;
		settlementInsurOrgId?: number;
		amounts?: MedicalInsuranceAmounts;
		settlementTime: Date;
	},
): ProviderRecord {
	const mapped = buildOutNetworkSettleMainFrom6202(
		options.source,
		settlementContext,
		options.auth ?? {
			insuplcAdmdvs: "",
			insutype: "",
		},
		options.settlementInsurOrgId ?? DEFAULT_SETTLEMENT_INSUR_ORG_ID,
		options.settlementTime,
	);
	const main: ProviderRecord = {
		...settlementContext.outNetworkSettleMain,
		...mapped,
	};
	const register = settlementContext.networkRegister;
	const setIfMissing = (key: string, value: unknown) => {
		if (
			!hasProviderField(main, [key]) &&
			value !== undefined &&
			value !== null &&
			value !== ""
		) {
			main[key] = value;
		}
	};
	const auth = options.auth;
	const insuredAreaCode =
		auth?.insuplcAdmdvs?.trim() || settlementContext.insuredAreaCode?.trim();
	const insutype = auth?.insutype?.trim();
	setIfMissing("chargeClassId", register.chargeClassId);
	setIfMissing(
		"networkPatClassId",
		register.networkPatClassId ?? register.netWorkingPatClassId,
	);
	setIfMissing("mdtrtId", settlementContext.mdtrtId);
	setIfMissing("insuplcAdmdvs", insuredAreaCode);
	setIfMissing("clrOptins", insuredAreaCode);
	setIfMissing("customClrOptins", insuredAreaCode);
	setIfMissing("insutype", insutype);
	// 即使 6202 没有返回主单，也要给 .32 一个符合 Provider Long
	// 类型的机构 ID；不能回退为 1101 的字符串 orgCode。
	main.insurOrgId =
		options.settlementInsurOrgId ?? DEFAULT_SETTLEMENT_INSUR_ORG_ID;
	main.fixmedinsName = DEFAULT_SETTLEMENT_FIXMEDINS_NAME;
	main.fixmedinsCode = DEFAULT_SETTLEMENT_FIXMEDINS_CODE;
	main.outVisitRecordId = DEFAULT_SETTLEMENT_OUT_VISIT_RECORD_ID;
	setIfMissing("psnNo", register.memberNo);
	setIfMissing("psnName", register.netPatName);
	setIfMissing("netPatName", register.netPatName);
	setIfMissing("netPatType", register.netPatType);
	setIfMissing("certNo", register.idNo);
	setIfMissing("outPatId", register.outPatId);
	if (options.amounts) {
		setIfMissing("amount", fenToYuan(options.amounts.totalFen));
		setIfMissing("getAmount", fenToYuan(options.amounts.cashFen));
	}
	// 2.27.2.32 结算来源按新业务合同固定为 4001，不能沿用旧的 3002。
	main.settleSource = 4001;
	setIfMissing("settleType", "1");
	return main;
}

function requiredProviderField(
	primary: ProviderRecord,
	secondary: ProviderRecord | undefined,
	keys: readonly string[],
	operation: string,
	requestId: string | undefined,
	index: number,
): unknown {
	const value = providerField(primary, secondary, keys);
	if (value === undefined) {
		throw responseError(
			operation,
			`upDetailList[${index}] ${keys.join(" or ")} is required`,
			requestId,
		);
	}
	return value;
}

/**
 * 2.27.2.32 的 upDetailList 只能在 6202/6301 之后使用真实 HIS 明细构造。
 * 2.6.33 只用于确认待支付子项目和匹配事实，不能提前决定后置回写字段。
 */
export function mapSettlementDetails(
	details: readonly ProviderRecord[],
	children: readonly ProviderRecord[],
	operation: string,
	requestId: string | undefined,
	businessType?: MedicalInsuranceBusinessType,
): Record<string, unknown>[] {
	const childFor = (detail: ProviderRecord): ProviderRecord | undefined => {
		const outTradeOrderId = optionalText(
			detail,
			["outTradeOrderId", "out_trade_order_id"],
			operation,
			requestId,
		);
		const chargeId = optionalText(detail, ["chargeId"], operation, requestId);
		return children.find((child) => {
			const childOrderId = optionalText(
				child,
				["outTradeOrderId", "out_trade_order_id"],
				operation,
				requestId,
			);
			const childChargeId = optionalText(
				child,
				["chargeId"],
				operation,
				requestId,
			);
			return Boolean(
				(outTradeOrderId && childOrderId === outTradeOrderId) ||
					(chargeId && childChargeId === chargeId),
			);
		});
	};

	return details.map((detail, index) => {
		const child = childFor(detail);
		// HIS `.32` 对挂号明细不接收医嘱号，院方约定统一传数值 -1；
		// 门诊仍保留真实明细中的 orderId/outDocOrderId；门诊缺失时继续省略，
		// 避免在本地映射阶段把可用的 HIS 明细误判为 provider-response-invalid。
		const orderId =
			businessType === "registration"
				? -1
				: providerField(detail, child, ["orderId", "outDocOrderId"]);
		const item = {
			amount: requiredProviderField(
				detail,
				child,
				["amount", "getAmount"],
				operation,
				requestId,
				index,
			),
			chargeCode: requiredProviderField(
				detail,
				child,
				["chargeCode", "hisUploadItemCode"],
				operation,
				requestId,
				index,
			),
			chargeId: requiredProviderField(
				detail,
				child,
				["chargeId"],
				operation,
				requestId,
				index,
			),
			chargeName: requiredProviderField(
				detail,
				child,
				["chargeName", "itemName"],
				operation,
				requestId,
				index,
			),
			networkItemCode: requiredProviderField(
				detail,
				child,
				[
					"networkItemCode",
					"medinsurItemCode",
					"nationalMedicalInsuranceCode",
					"insurMedCode",
				],
				operation,
				requestId,
				index,
			),
			networkItemName: requiredProviderField(
				detail,
				child,
				["networkItemName", "medinsurItemName", "chargeName", "itemName"],
				operation,
				requestId,
				index,
			),
			...(orderId === undefined ? {} : { orderId }),
			outBillId: requiredProviderField(
				detail,
				child,
				["outSettleDetailSubId", "outSettleDetailId"],
				operation,
				requestId,
				index,
			),
			price: requiredProviderField(
				detail,
				child,
				["price"],
				operation,
				requestId,
				index,
			),
			quantity: requiredProviderField(
				detail,
				child,
				["quantity", "cnt"],
				operation,
				requestId,
				index,
			),
			selfBurdenRatio: requiredProviderField(
				detail,
				child,
				["selfBurdenRatio"],
				operation,
				requestId,
				index,
			),
			createTime: requiredProviderField(
				detail,
				child,
				["createTime", "hisCreateTime", "billDate"],
				operation,
				requestId,
				index,
			),
			unit: providerField(detail, child, ["unit", "unitName"]) ?? "",
			spec: providerField(detail, child, ["spec"]) ?? "",
		};
		return { ...item, outSettleDetailId: item.outBillId };
	});
}

function providerSuccessFlag(value: unknown): boolean | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return undefined;
	const record = value as ProviderRecord;
	if (typeof record.success === "boolean") return record.success;
	if (record.data && typeof record.data === "object")
		return providerSuccessFlag(record.data);
	return undefined;
}

/**
 * 众阳 `.5` 完成结算在不同测试批次返回过两种成功形态：
 * `data.isSettle=1`，或只返回 `outSettleVO.settleStatus=4`/
 * `outSettlePayFinishDTOList[].settleStatus=4`。只有明确的完成标记才算成功，
 * 不能因为外层 HTTP 200 或 `success=true` 就放行。
 */
function completeSettleConfirmation(value: unknown): string | undefined {
	const isSettle = providerDeepValue(value, ["isSettle"]);
	if (String(isSettle ?? "").trim() === "1") return "isSettle=1";

	const nestedData = providerDeepValue(value, ["data"]);
	const payload =
		nestedData && typeof nestedData === "object" && !Array.isArray(nestedData)
			? (nestedData as ProviderRecord)
			: value && typeof value === "object" && !Array.isArray(value)
				? (value as ProviderRecord)
				: undefined;
	if (!payload) return undefined;

	const settleStatus =
		payload.outSettleVO &&
		typeof payload.outSettleVO === "object" &&
		!Array.isArray(payload.outSettleVO)
			? (payload.outSettleVO as ProviderRecord).settleStatus
			: undefined;
	if (String(settleStatus ?? "").trim() === "4") {
		return "outSettleVO.settleStatus=4";
	}

	const finishRecords = payload.outSettlePayFinishDTOList;
	if (
		Array.isArray(finishRecords) &&
		finishRecords.length > 0 &&
		finishRecords.every(
			(record) =>
				typeof record === "object" &&
				record !== null &&
				!Array.isArray(record) &&
				String((record as ProviderRecord).settleStatus ?? "").trim() === "4",
		)
	) {
		return "outSettlePayFinishDTOList.settleStatus=4";
	}
	return undefined;
}

function providerDeepValue(
	value: unknown,
	keys: readonly string[],
	depth = 0,
): unknown {
	if (depth > 8 || value === null || typeof value !== "object")
		return undefined;
	if (Array.isArray(value)) {
		for (const item of value) {
			const found = providerDeepValue(item, keys, depth + 1);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	const record = value as ProviderRecord;
	for (const key of keys) if (record[key] !== undefined) return record[key];
	for (const item of Object.values(record)) {
		const found = providerDeepValue(item, keys, depth + 1);
		if (found !== undefined) return found;
	}
	return undefined;
}

type MedicalInsurancePaymentState =
	| "not_created"
	| "processing"
	| "closed"
	| "paid"
	| "unknown";

function paymentQueryCode(value: unknown): number | string | undefined {
	const payload = providerDeepValue(value, ["data"]);
	const raw =
		payload && typeof payload === "object"
			? providerDeepValue(payload, ["code"])
			: undefined;
	if (typeof raw === "number" && Number.isFinite(raw)) return raw;
	if (typeof raw === "string" && /^\d+$/.test(raw.trim())) return raw.trim();
	return undefined;
}

function providerCancelStatus(value: unknown): string | undefined {
	const payload = providerDeepValue(value, ["data"]);
	if (typeof payload !== "object" || payload === null) return undefined;
	const raw = providerDeepValue(payload, ["cancelStatus"]);
	return typeof raw === "string" || typeof raw === "number"
		? String(raw).trim()
		: undefined;
}

function providerRevokeStatus(value: unknown): string | undefined {
	const payload = providerDeepValue(value, ["data"]);
	if (typeof payload !== "object" || payload === null) return undefined;
	const records = (payload as ProviderRecord).revokePayRecords;
	if (!Array.isArray(records)) return undefined;
	for (const record of records) {
		if (typeof record !== "object" || record === null) continue;
		const raw = (record as ProviderRecord).status;
		if (typeof raw === "string" || typeof raw === "number") {
			return String(raw).trim();
		}
	}
	return undefined;
}

/**
 * 众阳 2.6.65.4 的真实文档把支付状态定义在响应 data.code：
 * 3=支付成功、5=支付失败、其他值=支付中；外层 code=0000 只是接口调用结果，
 * 不能拿来判断支付状态。这里优先读取 data 载荷中的数字 code，再兼容已经
 * 出现过的文字状态字段。未知值继续保持 unknown，避免把不确定订单自动关单。
 */
function classifyPaymentQueryState(
	value: unknown,
): MedicalInsurancePaymentState {
	const paymentCode = paymentQueryCode(value);
	if (paymentCode !== undefined) {
		switch (String(paymentCode)) {
			case "3":
				return "paid";
			case "5":
				// 文档明确说明 5 为支付失败，可取消结算后重新支付；
				// 对当前取消分支而言它已经没有可继续收款的支付流水。
				return "closed";
			default:
				return "processing";
		}
	}
	const raw = providerDeepValue(value, [
		"payStatus",
		"payState",
		"paymentStatus",
		"transStatus",
		"settleStatus",
	]);
	if (typeof raw !== "string") return "unknown";
	const state = raw.trim().toLowerCase();
	if (/paid|success|succeed|completed|settled/.test(state)) return "paid";
	if (/closed|cancel|refun|failed|fail/.test(state)) return "closed";
	if (/pending|process|collect|paying|wait/.test(state)) return "processing";
	return "unknown";
}

function providerResultLabel(value: unknown): string {
	if (providerSuccessFlag(value) === false) return "success=false";
	if (providerSuccessFlag(value) === true) return "success=true";
	return "success=unknown";
}

export function accountFlag(insuplcAdmdvs: string): string {
	// 高平本地参保人为 0，其他参保地均显式传 1，避免依赖 6202 默认值。
	return insuplcAdmdvs.trim() === "140581" ? "0" : "1";
}

export function medicalTypeForBusiness(
	businessType: MedicalInsuranceBusinessType,
	insutype: string,
): "12" | "11" | "110104" | undefined {
	// 院方确认：挂号统一传 12；门诊按 1101 选中的险种区分职工和居民。
	if (businessType === "registration") return "12";
	if (insutype.trim() === "310") return "11";
	if (insutype.trim() === "390") return "110104";
	return undefined;
}

/**
 * 2.27.2.32 networkRegister.medTypeName 由 1101 的业务事实和险种决定，
 * 不能沿用 6201 的 medType 编码，也不能使用页面传入的任意文本。
 */
export function settlementMedTypeNameForBusiness(
	businessType: MedicalInsuranceBusinessType,
	insutype: string,
): "门诊挂号" | "门诊统筹" | "普通门诊" | undefined {
	if (businessType === "registration") return "门诊挂号";
	if (insutype.trim() === "390") return "门诊统筹";
	if (insutype.trim() === "310") return "普通门诊";
	return undefined;
}

/** 2.27.2.32 networkRegister.insuTypeName 的险种名称映射。 */
export function settlementInsuTypeNameForInsutype(
	insutype: string,
):
	| "职工基本医疗保险"
	| "城乡居民基本医疗保险"
	| "公务员医疗补助"
	| "城乡居民大病医疗保险"
	| "大额医疗费用补助"
	| "生育保险"
	| "离休人员医疗保障"
	| undefined {
	switch (insutype.trim()) {
		case "310":
			return "职工基本医疗保险";
		case "390":
			return "城乡居民基本医疗保险";
		case "320":
			return "公务员医疗补助";
		case "392":
			return "城乡居民大病医疗保险";
		case "330":
			return "大额医疗费用补助";
		case "510":
			return "生育保险";
		case "340":
			return "离休人员医疗保障";
		default:
			return undefined;
	}
}

/**
 * 2.27.2.32 networkRegister.offSiteType 的医保地区规则：
 * 1405 开头为高平本地，14 开头但不是 1405 为省内异地，其余为省外异地。
 */
export function offSiteTypeForInsuredArea(
	insuplcAdmdvs: string,
): 0 | 1 | 2 | undefined {
	const area = insuplcAdmdvs.trim();
	if (!area) return undefined;
	if (area.startsWith("1405")) return 0;
	if (area.startsWith("14")) return 1;
	return 2;
}

function normalizeSettlementNetworkRegister(
	register: ProviderRecord,
	businessType: MedicalInsuranceBusinessType,
	insuredAreaCode?: string,
	settlementMain?: ProviderRecord,
): ProviderRecord {
	const insutype = String(register.insuType ?? register.insutype ?? "");
	const area = String(
		register.cantonCode ?? register.insuplcAdmdvs ?? insuredAreaCode ?? "",
	);
	const medTypeName =
		typeof register.medTypeName === "string" && register.medTypeName.trim()
			? register.medTypeName
			: settlementMedTypeNameForBusiness(businessType, insutype);
	const insuTypeName =
		typeof register.insuTypeName === "string" && register.insuTypeName.trim()
			? register.insuTypeName
			: settlementInsuTypeNameForInsutype(insutype);
	const offSiteType =
		typeof register.offSiteType === "number"
			? register.offSiteType
			: offSiteTypeForInsuredArea(area);
	const netRegSerial =
		register.netRegSerial ??
		providerField(settlementMain ?? {}, undefined, ["mdtrtId", "mdtrt_id"]);
	return {
		...register,
		...(medTypeName ? { medTypeName } : {}),
		...(insuTypeName ? { insuTypeName } : {}),
		...(offSiteType === undefined ? {} : { offSiteType }),
		...(netRegSerial === undefined ||
		netRegSerial === null ||
		netRegSerial === ""
			? {}
			: { netRegSerial }),
		netDiagnosCode: "Z00.001",
		netDiagnosName: "健康查体",
	};
}

/**
 * 真实医保编排：授权解析 → 1101 → 2.6.65.1/2.27.2.27 → 2.1.9/2.1.13/2.6.33
 * → 6201 → 6202 → 6301。`.27` 的费用明细及 outSettlePat 三个 ID 在前置阶段持久化并复用，
 * 6301 候选结果也只查询一次；6201/6202 仍通过严格加密 FSI gateway，
 * 前端既不能提交费用明细，也不能提交医保人员或科室编码。
 */
export function createLegacyFsiMedicalInsuranceGateway(
	options: LegacyFsiMedicalInsuranceGatewayOptions,
): MedicalInsuranceGateway {
	const relayUrl = absoluteUrl(options.relayUrl);
	const foundationBaseUrl = absoluteUrl(options.foundationBaseUrl);
	const foundationPath = forwardPath(options.foundationPath);
	const zhongyangBaseUrl = absoluteUrl(options.zhongyangBaseUrl);
	const relayAuthorizationToken = requiredConfig(
		options.relayAuthorizationToken,
	);
	const userQueryBaseUrl = absoluteUrl(
		options.userQueryBaseUrl ?? DEFAULT_USER_QUERY_BASE_URL,
	);
	const userQueryPath =
		options.userQueryPath?.trim() || DEFAULT_USER_QUERY_PATH;
	const orgCode = options.orgCode?.trim() || "H14058101270";
	const hospitalId = options.hospitalId?.trim() || "10389001";
	const configuredInsutypes = Array.from(
		new Set(
			(options.insutypes?.length ? options.insutypes : ["310", "390"])
				.map((value) => value.trim())
				.filter(Boolean),
		),
	);
	const insutypes =
		configuredInsutypes.length > 0 ? configuredInsutypes : ["310", "390"];
	const insuCode = options.insuCode?.trim() || "140581";
	const uldLatlnt = options.uldLatlnt?.trim() || DEFAULT_ULD_LATLNT;
	const authorizationToken =
		options.zhongyangAuthorizationToken?.trim() || undefined;
	const fetcher = options.fetcher ?? fetch;
	const now = options.now ?? (() => new Date());
	const createId = options.createId ?? (() => crypto.randomUUID());

	const zhongyangHeaders = authorizationToken
		? { Authorization: `Bearer ${authorizationToken}` }
		: undefined;

	const zhongyangGet = async (
		operation: string,
		path: string,
		context: AdapterCallContext,
		query: Readonly<Record<string, string | readonly string[]>>,
	) => {
		const url = new URL(path, zhongyangBaseUrl);
		for (const [key, value] of Object.entries(query)) {
			if (typeof value === "string") {
				url.searchParams.set(key, value);
			} else {
				for (const item of value) url.searchParams.append(key, item);
			}
		}
		const response = await requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: url.toString(),
				method: "GET",
				context,
				...(zhongyangHeaders ? { headers: zhongyangHeaders } : {}),
			},
			fetcher,
		);
		options.logger?.info(
			{
				event: "medical-insurance.zhongyang.response",
				traceId: context.traceId,
				operation,
				providerRequestId: response.requestId,
				providerStatusCode: response.statusCode,
				queryKeys: Object.keys(query).sort(),
				queryPresence: Object.fromEntries(
					Object.entries(query).map(([key, value]) => [
						key,
						Array.isArray(value)
							? { kind: "array", count: value.length }
							: { kind: "text", present: Boolean(value), length: value.length },
					]),
				),
				responseShape: providerPayloadShape(response.data),
			},
			"Zhongyang response received",
		);
		return response;
	};

	const zhongyangPost = async (
		operation: string,
		path: string,
		context: AdapterCallContext,
		body: Record<string, unknown>,
	) =>
		requestJson<unknown>(
			{
				provider: "zhongyang",
				operation,
				url: new URL(path, zhongyangBaseUrl).toString(),
				method: "POST",
				context,
				...(zhongyangHeaders ? { headers: zhongyangHeaders } : {}),
				body,
			},
			fetcher,
		).then((response) => {
			options.logger?.info(
				{
					event: "medical-insurance.zhongyang.response",
					traceId: context.traceId,
					operation,
					providerRequestId: response.requestId,
					providerStatusCode: response.statusCode,
					bodyKeys: Object.keys(body).sort(),
					responseShape: providerPayloadShape(response.data),
				},
				"Zhongyang response received",
			);
			return response;
		});

	const finalizeStoredSettlement = async (
		input: {
			orderId: string;
			ownerUserId: string;
			amounts: MedicalInsuranceAmounts;
			businessType: MedicalInsuranceBusinessType;
			cashPaymentConfirmed?: boolean;
		},
		context: AdapterCallContext,
	): Promise<{
		state:
			| "insurance_settled"
			| "cash_pending"
			| "awaiting_confirmation"
			| "failed";
		amounts: MedicalInsuranceAmounts;
		trace: ExternalTrace;
		source: "yunhealth";
		providerStatus: string;
		finality:
			| "processing"
			| "settlement_candidate"
			| "paid"
			| "cancelled"
			| "failed"
			| "unknown";
		authoritative: boolean;
	}> => {
		const stored = await options.orders.getSettlementContext(
			input.ownerUserId,
			input.orderId,
		);
		if (!stored) {
			throw responseError(
				"medical-insurance.2.27.2.32",
				"后置结算上下文不存在",
			);
		}
		const legacyPluginContext = Boolean(
			stored.plugin || (stored.payingId && stored.tradingId),
		);
		if (!stored.postPaymentCompletedAt && !legacyPluginContext) {
			throw responseError(
				"medical-insurance.2.27.2.32",
				"支付后置分项尚未完成，不能提前提交医院结算",
			);
		}

		let settlementContext: MedicalInsuranceSettlementContext = stored;
		const previousWriteback = settlementContext.settlementWriteback;
		// 2.27.2.32 不是可重放查询。医保侧即使返回 HTTP 200 + settle=FAIL，
		// 也可能已经占用结算 ID；一旦尝试过，后续查单任务不得再次提交。
		if (previousWriteback?.status !== "succeeded" && previousWriteback) {
			return {
				state: "awaiting_confirmation",
				amounts: input.amounts,
				trace: trace(
					"medical-insurance.2.27.2.32",
					context,
					previousWriteback.providerRequestId
						? [previousWriteback.providerRequestId]
						: [],
					settlementContext.businessId,
				),
				source: "yunhealth",
				providerStatus:
					previousWriteback.providerStatus ??
					"2.27.2.32_writeback_already_attempted",
				finality: "settlement_candidate",
				authoritative: false,
			};
		}
		let notifyRequestId = previousWriteback?.providerRequestId;
		let notifyTrace = trace(
			"medical-insurance.2.27.2.32",
			context,
			notifyRequestId ? [notifyRequestId] : [],
			settlementContext.businessId,
		);
		if (previousWriteback?.status !== "succeeded") {
			if (
				settlementContext.postPaymentComponents?.some(
					(component) => component.state !== "succeeded",
				)
			) {
				throw responseError(
					"medical-insurance.2.27.2.32",
					"支付后置分项尚未全部成功",
				);
			}
			// `.32` 必须严格位于 6301 之后。6202 的 ordStas=3/4/5/6
			// 只是结算候选，只有 6301 候选事实落库后才允许回写 HIS。
			if (
				settlementContext.settlementQuery6301?.statusClass !==
				"settlement_candidate"
			) {
				throw responseError(
					"medical-insurance.2.27.2.32",
					"6301 尚未返回可后置结算状态，不能提交医院结算",
					undefined,
					{
						failureStage: "validation",
						responseInvalid: false,
						requestOutcome: "not_sent",
					},
				);
			}
			if (
				!settlementContext.settlementDetailsFetchedAt &&
				settlementContext.upDetailList.length === 0
			) {
				const detailResponse = await zhongyangGet(
					"medical-insurance.2.27.2.27",
					"/msun-yb-app-miop/v1/out-insur-settle-infos",
					context,
					{
						patId: settlementContext.patientId,
						outSettleMainId: settlementContext.businessId,
					},
				);
				const settleInfo = objectPayload(
					detailResponse.data,
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				);
				const details = arrayPayload(
					settleInfo,
					["outSettleDetailList", "out_settle_detail_list"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				);
				options.logger?.info(
					{
						event: "medical-insurance.settlement-details.shape",
						traceId: context.traceId,
						orderId: input.orderId,
						detailProviderRequestId: detailResponse.requestId,
						...settlementDetailShape(details, []),
					},
					"Medical insurance stored settlement detail inputs inspected",
				);
				// 旧上下文没有前置快照时仍需补读 .27，但只取文档明确要求的
				// outSettlePat 三个 ID；绝不把 .27 的 outNetworkSettleMain 当主单。
				const outNetworkSettleMain = settlementPatientIdentifiers(settleInfo);
				const fetchedAt = now().toISOString();
				settlementContext = {
					...settlementContext,
					// 6202 已生成的主单字段优先，.27 只补充患者/就诊标识。
					outNetworkSettleMain: {
						...outNetworkSettleMain,
						...settlementContext.outNetworkSettleMain,
					},
					settlementDetailsFetchedAt: fetchedAt,
					settlementDetailsProviderRequestId: detailResponse.requestId,
					nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
						? (settleInfo.nationalUpDetailList as ProviderRecord[])
						: settlementContext.nationalUpDetailList,
				};
				// 先记录“已读取”事实，哪怕明细映射失败也不能在后续
				// 6301 重试中再次请求 .27；映射失败应停在人工核验。
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
				const upDetailList =
					details.length > 0
						? mapSettlementDetails(
								details,
								[],
								"medical-insurance.2.27.2.32",
								detailResponse.requestId,
								input.businessType,
							)
						: settlementContext.upDetailList;
				settlementContext = { ...settlementContext, upDetailList };
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
			}

			const normalizedNetworkRegister = normalizeSettlementNetworkRegister(
				settlementContext.networkRegister,
				input.businessType,
				settlementContext.insuredAreaCode,
				settlementContext.outNetworkSettleMain,
			);
			if (
				JSON.stringify(normalizedNetworkRegister) !==
				JSON.stringify(settlementContext.networkRegister)
			) {
				settlementContext = {
					...settlementContext,
					networkRegister: normalizedNetworkRegister,
				};
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
			}

			const composedSettlementMain = composeOutNetworkSettleMain(
				settlementContext,
				{
					amounts: input.amounts,
					settlementInsurOrgId: DEFAULT_SETTLEMENT_INSUR_ORG_ID,
					settlementTime: now(),
				},
			);
			if (
				Object.keys(composedSettlementMain).length !==
					Object.keys(settlementContext.outNetworkSettleMain).length ||
				Object.keys(composedSettlementMain).some(
					(key) =>
						composedSettlementMain[key] !==
						settlementContext.outNetworkSettleMain[key],
				)
			) {
				settlementContext = {
					...settlementContext,
					outNetworkSettleMain: composedSettlementMain,
				};
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
				options.logger?.info(
					{
						event: "medical-insurance.settlement-main.composed",
						traceId: context.traceId,
						orderId: input.orderId,
						fieldCount: Object.keys(composedSettlementMain).length,
						fields: Object.keys(composedSettlementMain).sort(),
					},
					"Medical insurance settlement main composed from stored payment facts",
				);
			}

			if (settlementContext.upDetailList.length === 0) {
				throw responseError(
					"medical-insurance.2.27.2.32",
					"真实费用明细不存在",
				);
			}
			const primaryMedicalComponent =
				settlementContext.postPaymentComponents?.find(
					(component) =>
						component.kind === "fund" &&
						component.payTypeId === "2" &&
						component.state === "succeeded" &&
						Boolean(component.payingId && component.tradingId),
				);
			const finalPayingId =
				primaryMedicalComponent?.payingId ?? settlementContext.payingId;
			const finalTradingId =
				primaryMedicalComponent?.tradingId ?? settlementContext.tradingId;
			if (!finalPayingId || !finalTradingId) {
				throw responseError(
					"medical-insurance.2.27.2.32",
					"支付后置分项尚未生成有效 payingId/tradingId",
				);
			}
			const existingTransId = providerField(
				settlementContext.outNetworkSettleMain,
				undefined,
				["transId", "trans_id"],
			);
			const existingTransIdText = String(existingTransId ?? "").trim();
			if (existingTransIdText && existingTransIdText !== finalPayingId) {
				options.logger?.warn(
					{
						event: "medical-insurance.2.27.2.32.trans-id-corrected",
						traceId: context.traceId,
						orderId: input.orderId,
						existingTransId: existingTransIdText,
						finalPayingId,
					},
					"Medical insurance .32 transId corrected to payTypeId=2 payingId",
				);
			}

			const notifyPayload: Record<string, unknown> = {
				hospitalId: settlementContext.hospitalId,
				nationalUpDetailList: settlementContext.nationalUpDetailList,
				networkRegister: normalizedNetworkRegister,
				outNetworkSettleMain: {
					...settlementContext.outNetworkSettleMain,
					transId: finalPayingId,
				},
				outSettleMainId: settlementContext.businessId,
				patId: settlementContext.patientId,
				tradingId: finalTradingId,
				upDetailList: settlementContext.upDetailList,
			};
			options.logger?.info(
				{
					event: "medical-insurance.2.27.2.32.requested",
					traceId: context.traceId,
					orderId: input.orderId,
					settlementQueryProviderRequestId:
						settlementContext.settlementQuery6301?.providerRequestId,
					postPaymentComponentCount:
						settlementContext.postPaymentComponents?.length ?? 0,
					upDetailCount: settlementContext.upDetailList.length,
					hasSettlementMain:
						Object.keys(settlementContext.outNetworkSettleMain).length > 0,
					hasPayingId: Boolean(finalPayingId),
					hasTradingId: Boolean(finalTradingId),
				},
				"Medical insurance HIS settlement writeback requested after 6301",
			);
			const attemptedAt = now().toISOString();
			settlementContext = {
				...settlementContext,
				settlementWriteback: {
					attemptedAt,
					status: "unknown",
				},
			};
			// 在发送不可重放的 .32 前先落库“已尝试”事实；即使网络或进程在
			// 返回前中断，后续查单也不得再次向医保提交同一个结算 ID。
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				settlementContext,
			);
			const notifyResponse = await zhongyangPost(
				"medical-insurance.2.27.2.32",
				"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
				context,
				notifyPayload,
			);
			const insur = String(
				providerDeepValue(notifyResponse.data, ["insur"]) ?? "",
			)
				.trim()
				.toUpperCase();
			const settle = String(
				providerDeepValue(notifyResponse.data, ["settle"]) ?? "",
			)
				.trim()
				.toUpperCase();
			options.logger?.info(
				{
					event: "medical-insurance.2.27.2.32.completed",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: notifyResponse.requestId,
					insur: insur || "UNKNOWN",
					settle: settle || "UNKNOWN",
				},
				"Medical insurance HIS settlement writeback completed",
			);
			notifyRequestId = notifyResponse.requestId;
			notifyTrace = trace(
				"medical-insurance.2.27.2.32",
				context,
				[notifyResponse.requestId],
				settlementContext.businessId,
			);
			const writebackStatus =
				providerSuccessFlag(notifyResponse.data) !== false &&
				insur === "SUCCESS" &&
				settle === "SUCCESS"
					? "succeeded"
					: "failed";
			settlementContext = {
				...settlementContext,
				settlementWriteback: {
					attemptedAt,
					status: writebackStatus,
					providerRequestId: notifyResponse.requestId,
					providerStatus: `insur=${insur || "UNKNOWN"},settle=${settle || "UNKNOWN"}`,
				},
			};
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				settlementContext,
			);
			if (
				providerSuccessFlag(notifyResponse.data) === false ||
				insur !== "SUCCESS" ||
				settle !== "SUCCESS"
			) {
				return {
					state: "awaiting_confirmation",
					amounts: input.amounts,
					trace: notifyTrace,
					source: "yunhealth",
					providerStatus: `insur=${insur || "UNKNOWN"},settle=${settle || "UNKNOWN"}`,
					finality: "settlement_candidate",
					authoritative: false,
				};
			}
		}

		// 新拆分流程在医保分项 .32 成功后，只有普通微信自费查单确认成功，
		// 才允许提交 5031 分项自己的 .32。挂号也必须完成这两个 .32，
		// 但挂号不调用 .5。
		if (input.amounts.cashFen > 0 && !input.cashPaymentConfirmed) {
			return {
				state: "cash_pending",
				amounts: input.amounts,
				trace: notifyTrace,
				source: "yunhealth",
				providerStatus: "notify_success_cash_pending",
				finality: "paid",
				authoritative: true,
			};
		}
		const selfPayComponent = settlementContext.postPaymentComponents?.find(
			(component) =>
				component.kind === "wechat_cash" &&
				(component.payTypeId === "5031" || component.payTypeId === "31") &&
				component.state === "succeeded" &&
				Boolean(component.payingId && component.tradingId),
		);
		const hasNewSplitPaymentContext = Boolean(
			settlementContext.postPaymentComponents?.some(
				(component) => component.kind === "wechat_cash",
			),
		);
		if (input.amounts.cashFen > 0 && hasNewSplitPaymentContext) {
			if (!selfPayComponent) {
				throw responseError(
					"medical-insurance.2.27.2.32",
					"微信自费 5031 分项尚未生成有效 payingId/tradingId",
				);
			}
			const previousSelfPayWriteback =
				settlementContext.selfPaySettlementWriteback;
			if (
				previousSelfPayWriteback?.status !== "succeeded" &&
				previousSelfPayWriteback
			) {
				return {
					state: "awaiting_confirmation",
					amounts: input.amounts,
					trace: trace(
						"medical-insurance.2.27.2.32",
						context,
						previousSelfPayWriteback.providerRequestId
							? [previousSelfPayWriteback.providerRequestId]
							: [],
						settlementContext.businessId,
					),
					source: "yunhealth",
					providerStatus:
						previousSelfPayWriteback.providerStatus ??
						"2.27.2.32_self_pay_writeback_already_attempted",
					finality: "settlement_candidate",
					authoritative: false,
				};
			}
			if (settlementContext.settlementWriteback?.status !== "succeeded") {
				return {
					state: "awaiting_confirmation",
					amounts: input.amounts,
					trace: notifyTrace,
					source: "yunhealth",
					providerStatus: "medical_writeback_not_confirmed",
					finality: "settlement_candidate",
					authoritative: false,
				};
			}
			if (!previousSelfPayWriteback) {
				const normalizedNetworkRegister = normalizeSettlementNetworkRegister(
					settlementContext.networkRegister,
					input.businessType,
					settlementContext.insuredAreaCode,
					settlementContext.outNetworkSettleMain,
				);
				const selfPayNotifyPayload: Record<string, unknown> = {
					hospitalId: settlementContext.hospitalId,
					nationalUpDetailList: settlementContext.nationalUpDetailList,
					networkRegister: normalizedNetworkRegister,
					outNetworkSettleMain: {
						...settlementContext.outNetworkSettleMain,
						settleSource: 4001,
						transId: selfPayComponent.payingId,
					},
					outSettleMainId: settlementContext.businessId,
					patId: settlementContext.patientId,
					tradingId: selfPayComponent.tradingId,
					upDetailList: settlementContext.upDetailList,
				};
				const selfPayAttemptedAt = now().toISOString();
				settlementContext = {
					...settlementContext,
					selfPaySettlementWriteback: {
						attemptedAt: selfPayAttemptedAt,
						status: "unknown",
					},
				};
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
				const selfPayNotifyResponse = await zhongyangPost(
					"medical-insurance.2.27.2.32",
					"/msun-yb-app-miop/outSettle/v2/settle-info/notify",
					context,
					selfPayNotifyPayload,
				);
				const selfPayInsur = String(
					providerDeepValue(selfPayNotifyResponse.data, ["insur"]) ?? "",
				)
					.trim()
					.toUpperCase();
				const selfPaySettle = String(
					providerDeepValue(selfPayNotifyResponse.data, ["settle"]) ?? "",
				)
					.trim()
					.toUpperCase();
				const selfPayWritebackStatus =
					providerSuccessFlag(selfPayNotifyResponse.data) !== false &&
					selfPayInsur === "SUCCESS" &&
					selfPaySettle === "SUCCESS"
						? "succeeded"
						: "failed";
				settlementContext = {
					...settlementContext,
					selfPaySettlementWriteback: {
						attemptedAt: selfPayAttemptedAt,
						status: selfPayWritebackStatus,
						providerRequestId: selfPayNotifyResponse.requestId,
						providerStatus: `insur=${selfPayInsur || "UNKNOWN"},settle=${selfPaySettle || "UNKNOWN"}`,
					},
				};
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
				notifyTrace = trace(
					"medical-insurance.2.27.2.32",
					context,
					[
						...(notifyRequestId ? [notifyRequestId] : []),
						selfPayNotifyResponse.requestId,
					],
					settlementContext.businessId,
				);
				if (
					selfPayWritebackStatus !== "succeeded" ||
					providerSuccessFlag(selfPayNotifyResponse.data) === false
				) {
					return {
						state: "awaiting_confirmation",
						amounts: input.amounts,
						trace: notifyTrace,
						source: "yunhealth",
						providerStatus: `insur=${selfPayInsur || "UNKNOWN"},settle=${selfPaySettle || "UNKNOWN"}`,
						finality: "settlement_candidate",
						authoritative: false,
					};
				}
			}
		}

		if (input.businessType === "registration") {
			return {
				state: "insurance_settled",
				amounts: input.amounts,
				trace: notifyTrace,
				source: "yunhealth",
				providerStatus: "insur=SUCCESS,settle=SUCCESS",
				finality: "paid",
				authoritative: true,
			};
		}
		// 门诊每个支付分项都独立完成 .5：医保分项使用 settlementCompletion，
		// 微信自费分项使用 selfPaySettlementCompletion。每个分项都先落库
		// unknown，再调用 Provider，查单只读取已落库事实，不重复提交。
		const completeSettlementLeg = async (
			completionKey: "settlementCompletion" | "selfPaySettlementCompletion",
			leg: "medical" | "self_pay",
		) => {
			const previous = settlementContext[completionKey];
			if (previous) {
				return {
					succeeded: previous.status === "succeeded",
					providerRequestId: previous.providerRequestId,
					providerStatus:
						previous.providerStatus ?? "2.6.65.5_already_attempted",
				};
			}
			const attemptedAt = now().toISOString();
			settlementContext = {
				...settlementContext,
				[completionKey]: {
					attemptedAt,
					status: "unknown",
				},
			} as MedicalInsuranceSettlementContext;
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				settlementContext,
			);
			const completionContext = {
				...context,
				idempotencyKey: `medical-insurance-2.6.65.5:${settlementContext.businessId}:${leg}`,
			};
			const completeResponse = await zhongyangPost(
				"medical-insurance.2.6.65.5",
				"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
				completionContext,
				{
					authSysCode: DEFAULT_AUTH_SYS_CODE,
					autoSettle: 2,
					businessId: settlementContext.businessId,
					hospitalId: settlementContext.hospitalId,
					tradeTypeCode: "2",
					workStationId: "",
				},
			);
			const completionMarker = completeSettleConfirmation(
				completeResponse.data,
			);
			const completionStatus =
				providerSuccessFlag(completeResponse.data) !== false &&
				completionMarker !== undefined
					? "succeeded"
					: "failed";
			const completionProviderStatus = completionMarker
				? `completion=${completionMarker}`
				: "completion=UNKNOWN";
			settlementContext = {
				...settlementContext,
				[completionKey]: {
					attemptedAt,
					status: completionStatus,
					providerRequestId: completeResponse.requestId,
					providerStatus: completionProviderStatus,
				},
			} as MedicalInsuranceSettlementContext;
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				settlementContext,
			);
			return {
				succeeded: completionStatus === "succeeded",
				providerRequestId: completeResponse.requestId,
				providerStatus: completionProviderStatus,
			};
		};

		const medicalCompletion = await completeSettlementLeg(
			"settlementCompletion",
			"medical",
		);
		const medicalCompletionTrace = trace(
			"medical-insurance.2.27.2.32/2.6.65.5",
			context,
			[
				...(notifyRequestId ? [notifyRequestId] : []),
				...(medicalCompletion.providerRequestId
					? [medicalCompletion.providerRequestId]
					: []),
			],
			settlementContext.businessId,
		);
		if (!medicalCompletion.succeeded) {
			return {
				state: "awaiting_confirmation",
				amounts: input.amounts,
				trace: medicalCompletionTrace,
				source: "yunhealth",
				providerStatus: medicalCompletion.providerStatus,
				finality: "settlement_candidate",
				authoritative: false,
			};
		}

		const selfPayCompletionRequired = Boolean(selfPayComponent);
		if (selfPayCompletionRequired) {
			const selfPayCompletion = await completeSettlementLeg(
				"selfPaySettlementCompletion",
				"self_pay",
			);
			const selfPayCompletionTrace = trace(
				"medical-insurance.2.27.2.32/2.6.65.5",
				context,
				[
					...(notifyRequestId ? [notifyRequestId] : []),
					...(medicalCompletion.providerRequestId
						? [medicalCompletion.providerRequestId]
						: []),
					...(selfPayCompletion.providerRequestId
						? [selfPayCompletion.providerRequestId]
						: []),
				],
				settlementContext.businessId,
			);
			if (!selfPayCompletion.succeeded) {
				return {
					state: "awaiting_confirmation",
					amounts: input.amounts,
					trace: selfPayCompletionTrace,
					source: "yunhealth",
					providerStatus: selfPayCompletion.providerStatus,
					finality: "settlement_candidate",
					authoritative: false,
				};
			}
			return {
				state: "insurance_settled",
				amounts: input.amounts,
				trace: selfPayCompletionTrace,
				source: "yunhealth",
				providerStatus: `${medicalCompletion.providerStatus};self_pay_${selfPayCompletion.providerStatus}`,
				finality: "paid",
				authoritative: true,
			};
		}

		return {
			state: "insurance_settled",
			amounts: input.amounts,
			trace: medicalCompletionTrace,
			source: "yunhealth",
			providerStatus: medicalCompletion.providerStatus,
			finality: "paid",
			authoritative: true,
		};
	};

	const relayPost = async (
		operation: string,
		context: AdapterCallContext,
		baseUrl: string,
		path: string,
		body: unknown,
	) =>
		requestJson<unknown>(
			{
				provider: "medical-insurance",
				operation,
				url: relayUrl,
				method: "POST",
				context,
				headers: { Authorization: `Bearer ${relayAuthorizationToken}` },
				body: {
					method: "POST",
					base_url: baseUrl,
					path,
					headers: { "Content-Type": "application/json" },
					body,
				},
			},
			fetcher,
		).then((response) => {
			options.logger?.info(
				{
					event: "medical-insurance.relay.response",
					traceId: context.traceId,
					operation,
					providerRequestId: response.requestId,
					providerStatusCode: response.statusCode,
					bodyKeys:
						body && typeof body === "object" && !Array.isArray(body)
							? Object.keys(body as Record<string, unknown>).sort()
							: [],
				},
				"Medical insurance relay response received",
			);
			return response;
		});

	const resolveAuthorization = async (
		input: {
			authCode: string;
			ownerUserId: string;
			orderId: string;
			providerSubject: string;
			patient: AppointmentMedicalInsurancePatient;
		},
		context: AdapterCallContext,
	) => {
		const currentDate = now();
		const queryResponse = await relayPost(
			"medical-insurance.authorization.user-query",
			context,
			userQueryBaseUrl,
			userQueryPath,
			{ qrcode: input.authCode, openid: input.providerSubject },
		);
		const queryPayload = objectPayload(
			queryResponse.data,
			"medical-insurance.authorization.user-query",
			queryResponse.requestId,
		);
		const authorizationOperation = "medical-insurance.authorization.user-query";
		const directPayAuthNo = findTextAnywhere(
			queryResponse.data,
			["pay_auth_no"],
			authorizationOperation,
			queryResponse.requestId,
		);
		const familyPayAuthNo = findTextAnywhere(
			queryResponse.data,
			["family_pay_auth_no"],
			authorizationOperation,
			queryResponse.requestId,
		);
		if (directPayAuthNo && familyPayAuthNo) {
			throw responseError(
				authorizationOperation,
				"userQuery returned both direct and family authorization numbers",
				queryResponse.requestId,
			);
		}
		const fallbackPayAuthNo = findTextAnywhere(
			queryResponse.data,
			["auth_no"],
			authorizationOperation,
			queryResponse.requestId,
		);
		const payAuthNo =
			directPayAuthNo ??
			familyPayAuthNo ??
			fallbackPayAuthNo ??
			requiredText(
				queryPayload,
				["pay_auth_no", "family_pay_auth_no", "auth_no"],
				authorizationOperation,
				queryResponse.requestId,
			);
		const payForRelatives = Boolean(familyPayAuthNo);
		if (!/^AUTH/i.test(payAuthNo)) {
			throw responseError(
				authorizationOperation,
				"userQuery did not return a valid pay_auth_no",
				queryResponse.requestId,
			);
		}
		let payer: { idNo: string; userName: string; idType: string } | undefined;
		if (payForRelatives) {
			const payerName = findTextAnywhere(
				queryResponse.data,
				["user_name"],
				authorizationOperation,
				queryResponse.requestId,
			);
			const payerIdNo = findTextAnywhere(
				queryResponse.data,
				["user_card_no"],
				authorizationOperation,
				queryResponse.requestId,
			)
				?.replaceAll(/\s/g, "")
				.toUpperCase();
			if (
				!payerName ||
				!payerIdNo ||
				!(/^\d{15}$/u.test(payerIdNo) || /^\d{17}[0-9X]$/u.test(payerIdNo))
			) {
				throw responseError(
					authorizationOperation,
					"family authorization did not return a valid payer identity",
					queryResponse.requestId,
				);
			}
			payer = { idNo: payerIdNo, userName: payerName, idType: "01" };
		}

		const infoResponse = await relayPost(
			"medical-insurance.1101",
			context,
			foundationBaseUrl,
			foundationPath,
			{
				infno: "1101",
				msgid: `${orgCode.slice(0, 12)}${dateTimeCompact(currentDate)}${Math.floor(
					Math.random() * 10_000,
				)
					.toString()
					.padStart(4, "0")}`,
				insuplc_admdvs: "",
				mdtrtarea_admvs: "140581",
				dev_no: "",
				dev_safe_info: "",
				signtype: "",
				cainfo: "",
				infver: "V1.0",
				opter_type: "3",
				opter: "百灵收款员",
				opter_name: "百灵收款员",
				inf_time: dateTime(currentDate),
				fixmedins_code: orgCode,
				fixmedins_name: "高平市人民医院",
				sign_no: "",
				recer_sys_code: "msun",
				input: {
					data: {
						mdtrt_cert_type: "01",
						mdtrt_cert_no: payAuthNo,
						card_sn: "",
						begntime: dateTime(currentDate),
						psn_cert_type: "01",
						certno: input.patient.idNo,
						psn_name: input.patient.name,
					},
				},
			},
		);
		const infoPayload = objectPayload(
			infoResponse.data,
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const baseInfo =
			arrayPayload(
				infoPayload,
				["baseinfo", "baseInfo"],
				"medical-insurance.1101",
				infoResponse.requestId,
			)[0] ??
			recordValue(
				infoPayload.baseinfo ?? infoPayload.baseInfo ?? {},
				"medical-insurance.1101",
				infoResponse.requestId,
			);
		const insuInfoList = arrayPayload(
			infoPayload,
			["insuinfo", "insuInfo"],
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const selectedInsuGroup = insutypes
			.map((allowedInsutype) => ({
				allowedInsutype,
				records: insuInfoList.filter((item) => {
					const returnedInsutype = optionalText(
						item,
						["insutype", "insuType", "insutypeCode"],
						"medical-insurance.1101",
						infoResponse.requestId,
					);
					const insuranceStatus = optionalText(
						item,
						["psn_insu_stas", "psnInsuStas"],
						"medical-insurance.1101",
						infoResponse.requestId,
					);
					return (
						returnedInsutype === allowedInsutype &&
						(insuranceStatus === undefined || insuranceStatus === "1")
					);
				}),
			}))
			.find((group) => group.records.length > 0);
		if (!selectedInsuGroup) {
			throw responseError(
				"medical-insurance.1101",
				`参保信息缺少可用险种 insutype=${insutypes.join(",")}`,
				infoResponse.requestId,
			);
		}
		const matchingInsu = selectedInsuGroup.records;
		const selectedInsu = matchingInsu[0] as ProviderRecord;
		const selectedPsnNo = uniqueTextFromRecords(
			matchingInsu,
			["psn_no", "psnNo"],
			"参保人员编号",
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const selectedInsuredArea = uniqueTextFromRecords(
			matchingInsu,
			["insuplc_admdvs", "insuplcAdmdvs"],
			"参保地区划",
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		// 众阳/医保 1101 的参保号和参保地不保证都落在同一条 insuinfo
		// 记录中。旧项目的真实处理顺序是 insuinfo -> baseinfo -> 授权查询结果，
		// 这里保持同一顺序，避免把 HTTP 200 的有效响应误判成字段缺失。
		const psnNoResult = selectedPsnNo
			? { value: selectedPsnNo, source: "1101.insuinfo" }
			: firstTextWithSource(
					[
						{ source: "1101.baseinfo", record: baseInfo },
						{
							source: "authorization.user-query",
							record: queryPayload,
						},
					],
					["psn_no", "psnNo"],
					"medical-insurance.1101",
					infoResponse.requestId,
				);
		const psnNo = psnNoResult?.value;
		if (!psnNo) {
			throw responseError(
				"medical-insurance.1101",
				"1101 返回信息缺少参保人员编号 psn_no/psnNo（已检查 insuinfo、baseinfo 和授权查询结果）",
				infoResponse.requestId,
			);
		}
		const insuplcAdmdvsResult = selectedInsuredArea
			? { value: selectedInsuredArea, source: "1101.insuinfo" }
			: firstTextWithSource(
					[{ source: "1101.baseinfo", record: baseInfo }],
					["insuplc_admdvs", "insuplcAdmdvs"],
					"medical-insurance.1101",
					infoResponse.requestId,
				);
		const insuplcAdmdvs = insuplcAdmdvsResult?.value;
		if (!insuplcAdmdvs) {
			throw responseError(
				"medical-insurance.1101",
				"1101 返回信息缺少真实参保地 insuplc_admdvs/insuplcAdmdvs",
				infoResponse.requestId,
			);
		}
		const returnedInsutype =
			optionalText(
				selectedInsu,
				["insutype", "insuType", "insutypeCode"],
				"medical-insurance.1101",
				infoResponse.requestId,
			) ?? selectedInsuGroup.allowedInsutype;
		const baseInfoEcToken = tokenFromBaseInfo(baseInfo);
		const queryEcToken = optionalText(
			queryPayload,
			["ec_token", "ecToken"],
			"medical-insurance.authorization.user-query",
			queryResponse.requestId,
		);
		const ecToken = baseInfoEcToken ?? queryEcToken;
		options.logger?.info(
			{
				event: "medical-insurance.1101.parsed",
				traceId: context.traceId,
				orderId: input.orderId,
				providerRequestId: infoResponse.requestId,
				baseInfoPresent: Object.keys(baseInfo).length > 0,
				baseInfoKeys: providerKeys(baseInfo),
				queryPayloadKeys: providerKeys(queryPayload),
				insuInfoCount: insuInfoList.length,
				selectedInsutype: returnedInsutype,
				selectedInsuKeys: providerKeys(selectedInsu),
				psnNoSource: psnNoResult?.source ?? "missing",
				insuredAreaSource: insuplcAdmdvsResult?.source ?? "missing",
				ecTokenSource: baseInfoEcToken
					? "1101.baseinfo.exp_content"
					: queryEcToken
						? "authorization.user-query"
						: "missing",
				hasPsnNo: Boolean(psnNo),
				hasInsuredArea: Boolean(insuplcAdmdvs),
				hasEcToken: Boolean(ecToken),
			},
			"Medical insurance 1101 response fields parsed",
		);
		const companyName = uniqueTextFromRecords(
			matchingInsu,
			["emp_name", "empName"],
			"参保单位",
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const netPatType = uniqueTextFromRecords(
			matchingInsu,
			["psn_type", "psnType"],
			"人员类别",
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const createdAt = currentDate.toISOString();
		const expiresAt = new Date(
			currentDate.getTime() + 15 * 60 * 1000,
		).toISOString();
		const authorizationId = createId();
		const authorization: MedicalInsuranceAuthorizationContext = {
			authorizationId,
			ownerUserId: input.ownerUserId,
			medicalOrderId: input.orderId,
			providerSubject: input.providerSubject,
			payAuthNo,
			payForRelatives,
			patient: {
				idNo: input.patient.idNo,
				userName: input.patient.name,
				idType: "01",
			},
			...(payer ? { payer } : {}),
			psnNo,
			insutype: returnedInsutype,
			insuplcAdmdvs,
			insuCode,
			...(companyName ? { companyName } : {}),
			...(netPatType ? { netPatType } : {}),
			...(ecToken ? { ecToken } : {}),
			regionCode: insuplcAdmdvs,
			expiresAt,
			createdAt,
		};
		await options.authorizations.put(authorization);
		return {
			authorization,
			trace: trace("medical-insurance.authorization", context, [
				queryResponse.requestId,
				infoResponse.requestId,
			]),
		};
	};

	return {
		async authorize(input, context) {
			const result = await resolveAuthorization(input, context);
			return {
				authorizationId: result.authorization.authorizationId,
				...(result.authorization.regionCode
					? { regionCode: result.authorization.regionCode }
					: {}),
				trace: result.trace,
			};
		},

		async uploadFees(input, context) {
			const currentDate = now();
			const auth = await options.authorizations.get({
				authorizationId: input.authorizationId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				now: currentDate.toISOString(),
			});
			if (!auth)
				throw responseError(
					"medical-insurance.6201",
					"authorization context is unavailable",
				);
			const order = await options.orders.findByMedicalOrderId(input.orderId);
			if (!order || order.ownerUserId !== input.ownerUserId)
				throw responseError(
					"medical-insurance.6201",
					"order context is unavailable",
				);
			const businessType =
				order.businessType ??
				(order.appointmentId ? "registration" : undefined);
			if (!businessType)
				throw responseError(
					"medical-insurance.6201",
					"medical insurance business type is unavailable",
				);
			const medType = medicalTypeForBusiness(businessType, auth.insutype);
			if (!medType)
				throw responseError(
					"medical-insurance.6201",
					`门诊险种 ${auth.insutype} 没有配置医疗类别`,
				);
			const business = input.appointment;
			const providerPatientId = business.providerPatientId;
			const businessRecordId =
				"providerAppointmentId" in business
					? business.providerAppointmentId
					: business.recordId;
			const registerId =
				"providerAppointmentId" in business
					? resolveRegistrationProviderRegisterId(business)
					: undefined;
			const totalFenExpected = business.totalFen;
			const fallbackDepartmentId =
				"departmentId" in business ? business.departmentId : undefined;
			const fallbackDepartmentName =
				"departmentName" in business ? business.departmentName : undefined;
			const fallbackDoctorId =
				"doctorId" in business ? business.doctorId : undefined;
			const fallbackDoctorName =
				"doctorName" in business ? business.doctorName : undefined;
			const outpatientOrderIds =
				businessType === "outpatient" && "outTradeOrderIds" in business
					? [...business.outTradeOrderIds]
					: [];
			if (businessType === "outpatient" && outpatientOrderIds.length === 0)
				throw responseError(
					"medical-insurance.6201",
					"门诊费用缺少 2.6.33 outTradeOrderIds",
				);
			const priorSettlementContext = await options.orders.getSettlementContext(
				input.ownerUserId,
				input.orderId,
			);
			const resumePre6201 =
				priorSettlementContext?.feeUploadStage === "pre_6201";
			let applyPayload: ProviderRecord = {};
			let settleApplyRequestId: string | undefined;
			let businessId: string;
			let tradeOrderIds: string[];
			let businessCode: string;
			let settlementAmountFen: number;
			if (resumePre6201 && priorSettlementContext) {
				businessId = priorSettlementContext.businessId;
				businessCode = priorSettlementContext.businessCode ?? "";
				tradeOrderIds = [...priorSettlementContext.tradeOrderIds];
				settlementAmountFen =
					priorSettlementContext.settlementAmountFen ?? totalFenExpected;
				if (
					!businessId.trim() ||
					!businessCode.trim() ||
					tradeOrderIds.length === 0
				) {
					throw responseError(
						"medical-insurance.6201",
						"6201 前置结算续跑上下文不完整",
					);
				}
				options.logger?.info(
					{
						event: "medical-insurance.pre-6201.resumed",
						traceId: context.traceId,
						orderId: input.orderId,
						tradeOrderCount: tradeOrderIds.length,
						settlementAmountFen,
					},
					"Medical insurance fee upload resumed from persisted pre-6201 context",
				);
			} else {
				const settleApply = await zhongyangPost(
					"medical-insurance.2.6.65.1",
					"/msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle",
					context,
					{
						authSysCode: DEFAULT_AUTH_SYS_CODE,
						appCode: DEFAULT_APP_CODE,
						autoSettle: "2",
						hospitalId,
						patId: providerPatientId,
						requestId: stableNumericRequestId(
							`medical-insurance.2.6.65.1:${input.orderId}:${registerId}`,
						),
						requestParam:
							businessType === "outpatient"
								? {
										outTradeOrderIds: outpatientOrderIds,
										settleWay: DEFAULT_SETTLE_WAY,
									}
								: {
										registerId,
										registerSource: DEFAULT_REGISTER_SOURCE,
										settleWay: DEFAULT_SETTLE_WAY,
									},
						sceneCode: DEFAULT_SCENE_CODE,
						paySceneCode: DEFAULT_SCENE_CODE,
						tradeTypeCode:
							businessType === "outpatient" ? "2" : DEFAULT_TRADE_TYPE_CODE,
						workStationId: "",
					},
				);
				settleApplyRequestId = settleApply.requestId;
				applyPayload = objectPayload(
					settleApply.data,
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
				);
				businessId = requiredText(
					applyPayload,
					["businessId"],
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
				);
				tradeOrderIds = collectTradeOrderIds(
					applyPayload,
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
				);
				businessCode = requiredText(
					applyPayload,
					["businessCode", "tradeCode"],
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
				);
				const settlementAmountRaw = findTextDeep(
					applyPayload,
					["getAmount"],
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
				);
				if (!settlementAmountRaw) {
					throw responseError(
						"medical-insurance.2.6.65.1",
						"真实结算主单缺少 getAmount",
						settleApply.requestId,
					);
				}
				settlementAmountFen = yuanToFen(
					settlementAmountRaw,
					"getAmount",
					"6201",
				);
			}
			if (settlementAmountFen !== totalFenExpected) {
				throw responseError(
					"medical-insurance.2.6.65.1",
					"真实结算金额与预约服务端金额不一致",
					settleApplyRequestId,
				);
			}
			// 2.6.65.1 已经产生当前结算事实；这里的 2.6.33 只用于读取
			// 当前结算的父子项目和个账标志。它带当前订单号，所以返回
			// tradeStatus=2/disableSettleFlag=1 只能作为当前结算的观察结果，
			// 不能再当作“旧支付预检查”拒绝，否则会把本次刚创建的结算记录
			// 误判成重复支付，并让小程序错误进入关单流程。
			const childPaymentResponse = await zhongyangGet(
				"medical-insurance.2.6.33",
				"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records",
				context,
				{
					patId: providerPatientId,
					startTime: dateTime(
						new Date(currentDate.getTime() - 24 * 60 * 60 * 1000),
					),
					endTime: dateTime(currentDate),
					tradeStatus: "1",
					authSysCode: DEFAULT_AUTH_SYS_CODE,
					outTradeOrderIdList: tradeOrderIds,
				},
			);
			const childRecords = arrayPayload(
				childPaymentResponse.data,
				[],
				"medical-insurance.2.6.33",
				childPaymentResponse.requestId,
			);
			const childPaymentInspection = inspectChildPaymentRecords(
				childRecords,
				"medical-insurance.2.6.33",
				childPaymentResponse.requestId,
			);
			options.logger?.info(
				{
					event: "medical-insurance.2.6.33.current-settlement.observed",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: childPaymentResponse.requestId,
					resultCount: childRecords.length,
					tradeOrderCount: tradeOrderIds.length,
					nonPayableChildCount: childPaymentInspection.nonPayableChildCount,
					paymentInProgressCount: childPaymentInspection.paymentInProgressCount,
					expectedTradeStatus: "1",
				},
				"Medical insurance current settlement child records observed",
			);
			// 新流程不在 6201 前创建 2.6.65.2。先保存 .1 产生的结算事实，
			// 后续失败时只取消结算；微信/医保最终成功后才按非零分项创建 .2。
			// 续跑时保留已有 .27 快照，不能用空上下文覆盖它。
			if (!resumePre6201) {
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					{
						businessId,
						businessCode,
						hospitalId,
						patientId: providerPatientId,
						networkRegister: {},
						outNetworkSettleMain: {},
						nationalUpDetailList: [],
						upDetailList: [],
						tradeOrderIds,
						insuredAreaCode: auth.insuplcAdmdvs,
						feeUploadStage: "pre_6201",
						settlementAmountFen,
					},
				);
				options.logger?.info(
					{
						event: "medical-insurance.settlement-context.pre-6201-saved",
						traceId: context.traceId,
						orderId: input.orderId,
						...(settleApplyRequestId
							? { settleApplyProviderRequestId: settleApplyRequestId }
							: {}),
						hasBusinessId: Boolean(businessId),
						tradeOrderCount: tradeOrderIds.length,
					},
					"Medical insurance settlement context saved before 6201",
				);
			}
			const detailResponse =
				resumePre6201 && priorSettlementContext?.settlementDetailsFetchedAt
					? {
							data: {
								outNetworkSettleMain:
									priorSettlementContext.outNetworkSettleMain,
								outSettleDetailList: priorSettlementContext.upDetailList,
								nationalUpDetailList:
									priorSettlementContext.nationalUpDetailList,
								...(priorSettlementContext.mdtrtId
									? { mdtrtId: priorSettlementContext.mdtrtId }
									: {}),
							},
							requestId:
								priorSettlementContext.settlementDetailsProviderRequestId ??
								context.traceId,
						}
					: await zhongyangGet(
							"medical-insurance.2.27.2.27",
							"/msun-yb-app-miop/v1/out-insur-settle-infos",
							context,
							{
								patId: providerPatientId,
								outSettleMainId: businessId,
							},
						);
			const settleInfo = objectPayload(
				detailResponse.data,
				"medical-insurance.2.27.2.27",
				detailResponse.requestId,
			);
			const details = arrayPayload(
				settleInfo,
				["outSettleDetailList", "out_settle_detail_list"],
				"medical-insurance.2.27.2.27",
				detailResponse.requestId,
			);
			if (details.length === 0)
				throw responseError(
					"medical-insurance.2.27.2.27",
					"真实费用明细为空",
					detailResponse.requestId,
				);
			const outSettlePat = findRecordDeep(settleInfo, [
				"outSettlePat",
				"out_settle_pat",
			]);
			// .32 的 outNetworkSettleMain 主体来自 6202；.27 这里只保留
			// 文档明确要求的患者费别/就诊 ID，不读取 .27 的主单对象。
			const preOutNetworkSettleMain =
				priorSettlementContext?.settlementDetailsFetchedAt
					? pickSettlementPatientIdentifiers(
							priorSettlementContext.outNetworkSettleMain,
						)
					: settlementPatientIdentifiers(settleInfo);
			const preSettlementDetailsFetchedAt =
				priorSettlementContext?.settlementDetailsFetchedAt ??
				now().toISOString();
			// 立即保存 .27 的完整规范化事实，避免后续 2.1.9/2.1.13
			// 或 6201 失败时重试再次请求 .27。
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				{
					businessId,
					businessCode,
					hospitalId,
					patientId: providerPatientId,
					networkRegister: {},
					outNetworkSettleMain: preOutNetworkSettleMain,
					nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
						? (settleInfo.nationalUpDetailList as ProviderRecord[])
						: [],
					upDetailList: [],
					tradeOrderIds,
					insuredAreaCode: auth.insuplcAdmdvs,
					feeUploadStage: "pre_6201",
					settlementAmountFen,
					settlementDetailsFetchedAt: preSettlementDetailsFetchedAt,
					settlementDetailsProviderRequestId: detailResponse.requestId,
				},
			);
			const preUpDetailList = mapSettlementDetails(
				details,
				childRecords,
				"medical-insurance.2.27.2.27",
				detailResponse.requestId,
				businessType,
			);
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				{
					businessId,
					businessCode,
					hospitalId,
					patientId: providerPatientId,
					networkRegister: {},
					outNetworkSettleMain: preOutNetworkSettleMain,
					nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
						? (settleInfo.nationalUpDetailList as ProviderRecord[])
						: [],
					upDetailList: preUpDetailList,
					tradeOrderIds,
					insuredAreaCode: auth.insuplcAdmdvs,
					feeUploadStage: "pre_6201",
					settlementAmountFen,
					settlementDetailsFetchedAt: preSettlementDetailsFetchedAt,
					settlementDetailsProviderRequestId: detailResponse.requestId,
				},
			);
			const firstDetail = details[0] as ProviderRecord;
			const preResolvedMdtrtId =
				optionalText(
					applyPayload,
					["mdtrtId", "mdtrt_id"],
					"medical-insurance.2.6.65.1",
					settleApplyRequestId ?? detailResponse.requestId,
				) ??
				optionalText(
					settleInfo,
					["mdtrtId", "mdtrt_id"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ??
				optionalText(
					firstDetail,
					["mdtrtId", "mdtrt_id"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				);
			if (preResolvedMdtrtId) {
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					{
						businessId,
						businessCode,
						hospitalId,
						patientId: providerPatientId,
						networkRegister: {},
						outNetworkSettleMain: preOutNetworkSettleMain,
						nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
							? (settleInfo.nationalUpDetailList as ProviderRecord[])
							: [],
						upDetailList: preUpDetailList,
						tradeOrderIds,
						insuredAreaCode: auth.insuplcAdmdvs,
						feeUploadStage: "pre_6201",
						settlementAmountFen,
						mdtrtId: preResolvedMdtrtId,
						settlementDetailsFetchedAt: preSettlementDetailsFetchedAt,
						settlementDetailsProviderRequestId: detailResponse.requestId,
					},
				);
			}
			const deptId =
				optionalText(
					firstDetail,
					["billDeptCode", "billDeptId", "exeDeptCode", "exeDeptId"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ?? fallbackDepartmentId;
			if (!deptId)
				throw responseError(
					"medical-insurance.2.1.9",
					"无法从真实费用明细或预约事实解析 deptId",
					detailResponse.requestId,
				);
			const deptResponse = await zhongyangGet(
				"medical-insurance.2.1.9",
				"/msun-middle-base-common/v1/depts",
				context,
				{ deptId, invalidFlag: "0" },
			);
			const departments = arrayPayload(
				deptResponse.data,
				[],
				"medical-insurance.2.1.9",
				deptResponse.requestId,
			);
			const department =
				departments.find(
					(item) =>
						optionalText(
							item,
							["deptId", "id"],
							"medical-insurance.2.1.9",
							deptResponse.requestId,
						) === deptId,
				) ?? (departments.length === 1 ? departments[0] : undefined);
			if (!department)
				throw responseError(
					"medical-insurance.2.1.9",
					"科室查询未返回匹配记录",
					deptResponse.requestId,
				);
			const caty = requiredText(
				department,
				["nationalDeptInsuranceCode"],
				"medical-insurance.2.1.9",
				deptResponse.requestId,
			);
			const deptCode = requiredText(
				department,
				["deptCode"],
				"medical-insurance.2.1.9",
				deptResponse.requestId,
			);
			const deptName =
				optionalText(
					firstDetail,
					["billDeptName"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ?? fallbackDepartmentName;
			const doctorUserCode =
				optionalText(
					firstDetail,
					["billDocCode", "exeDocCode"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ?? fallbackDoctorId;
			if (!doctorUserCode)
				throw responseError(
					"medical-insurance.2.1.13",
					"无法从真实费用明细或预约事实解析 userCode",
					detailResponse.requestId,
				);
			const doctorResponse = await zhongyangGet(
				"medical-insurance.2.1.13",
				"/msun-middle-base-common/v1/users",
				context,
				{ userCode: doctorUserCode },
			);
			const doctors = arrayPayload(
				doctorResponse.data,
				[],
				"medical-insurance.2.1.13",
				doctorResponse.requestId,
			);
			const doctor =
				doctors.find(
					(item) =>
						optionalText(
							item,
							["userCode", "user_code"],
							"medical-insurance.2.1.13",
							doctorResponse.requestId,
						) === doctorUserCode,
				) ?? (doctors.length === 1 ? doctors[0] : undefined);
			if (!doctor)
				throw responseError(
					"medical-insurance.2.1.13",
					"医生查询未返回匹配记录",
					doctorResponse.requestId,
				);
			const doctorCode = requiredText(
				doctor,
				["medicalInsuranceCode"],
				"medical-insurance.2.1.13",
				doctorResponse.requestId,
			);
			const doctorName =
				optionalText(
					firstDetail,
					["billDocName", "exeDocName"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ??
				optionalText(
					doctor,
					["userName"],
					"medical-insurance.2.1.13",
					doctorResponse.requestId,
				) ??
				fallbackDoctorName;
			const chargeBatch =
				optionalText(
					firstDetail,
					["chrgBchno", "chargeBatchNo"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ??
				tradeOrderIds[0] ??
				businessRecordId;
			if (!deptName)
				throw responseError(
					"medical-insurance.2.1.9",
					"无法从真实费用明细或业务事实解析 deptName",
					detailResponse.requestId,
				);
			if (!doctorName)
				throw responseError(
					"medical-insurance.2.1.13",
					"无法从真实费用明细或业务事实解析 doctorName",
					detailResponse.requestId,
				);
			const feedetailList = mapFeeDetails(
				details,
				business,
				auth,
				medType,
				deptCode,
				deptName,
				doctorCode,
				doctorName,
				chargeBatch,
				currentDate,
				detailResponse.requestId,
			);
			const totalFen = details.reduce(
				(sum, detail) =>
					sum +
					detailAmountFen(
						detail,
						"medical-insurance.2.27.2.27",
						detailResponse.requestId,
					),
				0,
			);
			if (totalFen !== totalFenExpected)
				throw responseError(
					"medical-insurance.6201",
					"真实费用明细合计与预约应付金额不一致",
					detailResponse.requestId,
				);
			options.logger?.info(
				{
					event: "medical-insurance.settlement-details.shape",
					traceId: context.traceId,
					orderId: input.orderId,
					detailProviderRequestId: detailResponse.requestId,
					childProviderRequestId: childPaymentResponse.requestId,
					...settlementDetailShape(details, childRecords),
				},
				"Medical insurance settlement detail mapping inputs inspected",
			);
			const acctUsedFlag = accountFlag(auth.insuplcAdmdvs);
			// .27 在 6201 前已经返回后置回写所需的费用明细和患者 ID；
			// 这里一次性规范化并持久化，6202/6301 后直接复用，不能再次查询 .27。
			const upDetailList = preUpDetailList;
			options.logger?.info(
				{
					event: "medical-insurance.settlement-details.persisted",
					traceId: context.traceId,
					orderId: input.orderId,
					detailProviderRequestId: detailResponse.requestId,
					childProviderRequestId: childPaymentResponse.requestId,
					detailCount: upDetailList.length,
				},
				"Medical insurance settlement details persisted for post-payment reuse",
			);
			const outNetworkSettleMain = preOutNetworkSettleMain;
			const networkRegister: Record<string, unknown> = {
				cantonCode: auth.insuplcAdmdvs,
				cardNo: auth.payAuthNo,
				...(auth.companyName ? { companyName: auth.companyName } : {}),
				idNo: auth.patient.idNo,
				insuType: auth.insutype,
				insuTypeName: settlementInsuTypeNameForInsutype(auth.insutype),
				memberNo: auth.psnNo,
				medTypeName: settlementMedTypeNameForBusiness(
					businessType,
					auth.insutype,
				),
				netDiagnosCode: "Z00.001",
				netDiagnosName: "健康查体",
				offSiteType: offSiteTypeForInsuredArea(auth.insuplcAdmdvs),
				netPatName: auth.patient.userName,
				...(auth.netPatType ? { netPatType: auth.netPatType } : {}),
				outPatId: providerField(outSettlePat ?? {}, undefined, ["patId"]),
				regFlag: "1",
			};
			for (const [key, value] of Object.entries(networkRegister)) {
				if (value === undefined || value === null || value === "")
					delete networkRegister[key];
			}
			const primaryDiagnosis = {
				diagCode: "Z00.001",
				diagName: "健康查体",
			};
			const diagnoseList = [
				{
					diagType: "1",
					diagSrtNo: 1,
					...primaryDiagnosis,
					diagDept: deptCode,
					diseDorNo: doctorCode,
					diseDorName: doctorName,
					diagTime: legacyFsiDateTime(
						optionalText(
							firstDetail,
							["createTime"],
							"medical-insurance.2.27.2.27",
							detailResponse.requestId,
						),
						"medical-insurance.2.27.2.27",
						detailResponse.requestId,
						"diagTime",
						currentDate,
					),
					valiFlag: "1",
				},
			];
			options.logger?.info(
				{
					event: "medical-insurance.6201.payload.ready",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: detailResponse.requestId,
					businessId,
					businessCode,
					settlementAmountFen,
					appointmentTotalFen: totalFenExpected,
					detailCount: details.length,
					feedetailCount: feedetailList.length,
					diagnosisCount: diagnoseList.length,
					insutype: auth.insutype,
					insuCode: auth.insuCode,
					acctUsedFlag,
					deptCode,
					caty,
					businessType,
					medType,
					feeType: "01",
					mdtrtCertType: DEFAULT_MDTRT_CERT_TYPE,
					uldLatlnt,
					hasInsuplcAdmdvs: Boolean(auth.insuplcAdmdvs),
					topLevelDiagnosisFields: "explicit-empty",
					feeDetailHasHospApprFlag: feedetailList.every((detail) =>
						Boolean(detail.hospApprFlag),
					),
					hasPsnNo: Boolean(auth.psnNo),
					hasPayAuthNo: Boolean(auth.payAuthNo),
					hasEcToken: Boolean(auth.ecToken),
					hasMdtrtId: Boolean(preResolvedMdtrtId),
				},
				"Medical insurance 6201 payload is ready",
			);
			const feeResult = await options.legacyFsi.uploadFees(
				{
					...(preResolvedMdtrtId ? { mdtrtId: preResolvedMdtrtId } : {}),
					...(auth.ecToken ? { ecToken: auth.ecToken } : {}),
					payAuthNo: auth.payAuthNo,
					acctUsedFlag,
					orgCodg: orgCode,
					psnNo: auth.psnNo,
					insutype: auth.insutype,
					medOrgOrd: input.orderId,
					begntime: legacyFsiDateTime(
						optionalText(
							firstDetail,
							["createTime"],
							"medical-insurance.2.27.2.27",
							detailResponse.requestId,
						),
						"medical-insurance.2.27.2.27",
						detailResponse.requestId,
						"begntime",
						currentDate,
					),
					idNo: auth.patient.idNo,
					userName: auth.patient.userName,
					idType: auth.patient.idType,
					insuCode: auth.insuCode,
					insuplcAdmdvs: auth.insuplcAdmdvs,
					iptOtpNo: chargeBatch,
					deptName,
					deptCode,
					caty,
					medType,
					feeType: "01",
					psnSetlway: "01",
					mdtrtCertType: DEFAULT_MDTRT_CERT_TYPE,
					chrgBchno: chargeBatch,
					pubHospRfomFlag: "1",
					uldLatlnt,
					medfeeSumamt: fenToYuan(totalFen),
					diseCodg: "",
					diseName: "",
					diseinfoList: diagnoseList,
					feedetailList,
				},
				context,
			);
			// 真实 6201 回包可能只返回 payOrdId/payToken；mdtrtId 由
			// 2.6.65.1/2.27.2.27 前置事实提供时，沿用该权威值进入 6202。
			const mdtrtId = feeResult.mdtrtId ?? preResolvedMdtrtId;
			if (!mdtrtId)
				throw responseError(
					"medical-insurance.6201",
					"6201 与前置结算事实均未提供 mdtrtId",
					feeResult.trace.requestId,
				);
			options.logger?.info(
				{
					event: "medical-insurance.6201.completed",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: feeResult.trace.requestId,
					hasMdtrtId: Boolean(mdtrtId),
					mdtrtIdSource: feeResult.mdtrtId
						? "6201"
						: preResolvedMdtrtId
							? "pre_resolved_settlement_fact"
							: "missing",
					hasPayOrdId: Boolean(feeResult.credential.payOrdId),
					hasPayToken: Boolean(feeResult.credential.payToken),
					hasCashierUrl: Boolean(feeResult.cashierUrl),
					cashierUrlLength: feeResult.cashierUrl?.length ?? 0,
				},
				"Medical insurance 6201 completed",
			);
			const createdAt = now().toISOString();
			const expiresAt = new Date(
				now().getTime() + 15 * 60 * 1000,
			).toISOString();
			const settlementCredentialId = createId();
			const queryCredentialId = createId();
			const identity = {
				orgCodg: orgCode,
				idNo: auth.patient.idNo,
				userName: auth.patient.userName,
				idType: auth.patient.idType,
			};
			await options.credentials.put({
				credentialId: settlementCredentialId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				payOrdId: feeResult.credential.payOrdId,
				payToken: feeResult.credential.payToken,
				providerQueryIdentity: identity,
				purpose: "settlement",
				expiresAt,
				createdAt,
			});
			await options.credentials.put({
				credentialId: queryCredentialId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				payOrdId: feeResult.credential.payOrdId,
				payToken: feeResult.credential.payToken,
				providerQueryIdentity: identity,
				purpose: "query",
				expiresAt,
				createdAt,
			});
			await options.orders.saveSettlementContext(
				input.ownerUserId,
				input.orderId,
				{
					businessId,
					businessCode,
					hospitalId,
					patientId: providerPatientId,
					chrgBchno: chargeBatch,
					networkRegister,
					outNetworkSettleMain,
					nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
						? (settleInfo.nationalUpDetailList as ProviderRecord[])
						: [],
					upDetailList,
					tradeOrderIds,
					insuredAreaCode: auth.insuplcAdmdvs,
					feeUploadStage: "fee_uploaded",
					settlementAmountFen,
					...(mdtrtId ? { mdtrtId } : {}),
					settlementDetailsFetchedAt: preSettlementDetailsFetchedAt,
					settlementDetailsProviderRequestId: detailResponse.requestId,
					...(feeResult.cashierUrl ? { cashierUrl: feeResult.cashierUrl } : {}),
				},
			);
			return {
				feeUploadId: settlementCredentialId,
				payOrdId: feeResult.credential.payOrdId,
				payTokenHash: sha256(feeResult.credential.payToken),
				mdtrtId,
				acctUsedFlag,
				...(feeResult.cashierUrl ? { cashierUrl: feeResult.cashierUrl } : {}),
				trace: trace(
					"medical-insurance.6201",
					context,
					[
						...(settleApplyRequestId ? [settleApplyRequestId] : []),
						detailResponse.requestId,
						deptResponse.requestId,
						doctorResponse.requestId,
						childPaymentResponse.requestId,
						feeResult.trace.requestId,
					],
					feeResult.credential.payOrdId,
				),
			};
		},

		async settle(input, context) {
			const order = await options.orders.findByMedicalOrderId(input.orderId);
			if (!order || order.ownerUserId !== input.ownerUserId)
				throw responseError(
					"medical-insurance.6202",
					"order context is unavailable",
				);
			const auth = await options.authorizations.get({
				authorizationId: input.authorizationId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				now: now().toISOString(),
			});
			const credential = await options.credentials.get({
				credentialId: input.feeUploadId,
				ownerUserId: input.ownerUserId,
				medicalOrderId: input.orderId,
				purpose: "settlement",
				now: now().toISOString(),
			});
			if (!auth || !credential || !order.payOrdId)
				throw responseError(
					"medical-insurance.6202",
					"settlement context is unavailable",
				);
			if (credential.payOrdId !== order.payOrdId)
				throw responseError(
					"medical-insurance.6202",
					"payOrdId does not match the order",
				);
			let settlementContext = await options.orders.getSettlementContext(
				input.ownerUserId,
				input.orderId,
			);
			const chrgBchno = settlementContext?.chrgBchno;
			if (!settlementContext || !chrgBchno)
				throw responseError(
					"medical-insurance.6202",
					"6201 charge batch is unavailable",
				);
			const settlementTime = now();
			const mdtrtId = input.mdtrtId || order.mdtrtId;
			if (!mdtrtId)
				throw responseError("medical-insurance.6202", "mdtrtId is unavailable");
			options.logger?.info(
				{
					event: "medical-insurance.6202.payload.ready",
					traceId: context.traceId,
					orderId: input.orderId,
					hasPayAuthNo: Boolean(auth.payAuthNo),
					hasPayOrdId: Boolean(credential.payOrdId),
					hasPayToken: Boolean(credential.payToken),
					hasMdtrtId: Boolean(mdtrtId),
					acctUsedFlag: input.acctUsedFlag || order.acctUsedFlag || "",
				},
				"Medical insurance 6202 payload is ready",
			);
			const result = await options.legacyFsi.createPaymentOrder(
				{
					payAuthNo: auth.payAuthNo,
					payOrdId: credential.payOrdId,
					payToken: credential.payToken,
					orgCodg: orgCode,
					// V2.2.5 要求 orgBizSer 每次 6202 请求唯一；不能把 6201
					// 的 medOrgOrd 当成可重复使用的 6202 业务流水号。
					orgBizSer: createId(),
					chrgBchno,
					feeType: "01",
					mdtrtId,
					acctUsedFlag: input.acctUsedFlag || order.acctUsedFlag || "",
				},
				context,
			);
			const mappedOutNetworkSettleMain = composeOutNetworkSettleMain(
				settlementContext,
				{
					...(result.settlementSource
						? { source: result.settlementSource }
						: {}),
					auth,
					settlementInsurOrgId: DEFAULT_SETTLEMENT_INSUR_ORG_ID,
					amounts: mapMedicalAmounts(result.settlement),
					settlementTime,
				},
			);
			if (Object.keys(mappedOutNetworkSettleMain).length > 0) {
				settlementContext = {
					...settlementContext,
					outNetworkSettleMain: mappedOutNetworkSettleMain,
				};
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					settlementContext,
				);
				options.logger?.info(
					{
						event: "medical-insurance.6202.settlement-main-mapped",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: result.trace.requestId,
						fieldCount: Object.keys(mappedOutNetworkSettleMain).length,
						fields: Object.keys(mappedOutNetworkSettleMain).sort(),
					},
					"Medical insurance 6202 settlement main mapped for .32",
				);
			} else {
				options.logger?.warn(
					{
						event: "medical-insurance.6202.settlement-main-missing",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: result.trace.requestId,
						statusClass: result.statusClass,
						hasSettlementSource: Boolean(result.settlementSource),
					},
					"Medical insurance 6202 did not provide settlement main facts for .32",
				);
			}
			options.logger?.info(
				{
					event: "medical-insurance.6202.completed",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: result.trace.requestId,
					statusClass: result.statusClass,
					providerStatus: result.settlement.ordStas,
					hasPayOrdId: Boolean(result.settlement.payOrdId),
				},
				"Medical insurance 6202 completed",
			);
			const amounts = mapMedicalAmounts(result.settlement);
			const mapping = statusMapping(result);
			// 6202 只确认医保结算候选并保存其 preSetl 主单事实；
			// `.32` 必须等待后续 6301 候选查询完成后，由 query() 统一调用。
			return {
				...mapping,
				amounts,
				trace: result.trace,
				source: "6202",
				providerStatus: result.settlement.ordStas,
			};
		},

		async cancel(
			input,
			context,
		): Promise<MedicalInsuranceCancellationEvidence> {
			const order = await options.orders.findByMedicalOrderId(input.orderId);
			if (!order || order.ownerUserId !== input.ownerUserId)
				throw responseError(
					"medical-insurance.2.6.65.6",
					"order context is unavailable",
				);
			const settlementContext = await options.orders.getSettlementContext(
				input.ownerUserId,
				input.orderId,
			);
			if (!settlementContext) {
				options.logger?.error(
					{
						event: "medical-insurance.cancellation.context-missing",
						traceId: context.traceId,
						orderId: input.orderId,
						reason: input.reason,
					},
					"Medical insurance cancellation context is missing",
				);
				throw responseError(
					"medical-insurance.2.6.65.6",
					"支付关单上下文不存在，不能安全取消",
					undefined,
					{
						reason: "medical-insurance-cancellation-context-missing",
						failureStage: "validation",
						responseInvalid: false,
						requestOutcome: "not_sent",
					},
				);
			}

			const tradeTypeCode = order.businessType === "outpatient" ? "2" : "10";
			const requestIds: string[] = [];
			let paymentState: MedicalInsurancePaymentState =
				settlementContext.payingId ? "unknown" : "not_created";
			options.logger?.info(
				{
					event: "medical-insurance.cancellation.requested",
					traceId: context.traceId,
					orderId: input.orderId,
					businessType: order.businessType ?? "registration",
					tradeTypeCode,
					reason: input.reason,
					hasSettlementContext: true,
					hasBusinessId: Boolean(settlementContext.businessId),
					hasPayingId: Boolean(settlementContext.payingId),
				},
				"Medical insurance cancellation requested",
			);

			// 重授权/旧订单场景不再校验或关闭既有支付流水：当前业务只创建
			// 新医保订单，且不再依赖 2.6.65.4/2.6.65.11。正常支付中取消
			// 仍保留原有 .4 -> .11 -> .6 安全关单路径。
			const shouldQueryPaymentStatus = input.reason !== "reauthorization";
			if (settlementContext.payingId && !shouldQueryPaymentStatus) {
				options.logger?.warn(
					{
						event: "medical-insurance.cancellation.2.6.65.4.skipped",
						traceId: context.traceId,
						orderId: input.orderId,
						reason: input.reason,
						providerStatus: "disabled_for_reauthorization",
					},
					"Medical insurance payment validation skipped for reauthorization",
				);
			}
			if (settlementContext.payingId && shouldQueryPaymentStatus) {
				const queryResponse = await zhongyangPost(
					"medical-insurance.2.6.65.4",
					"/msun-middle-open-settlepay/api/v2/open/payment/pay-query",
					context,
					{
						authSysCode: DEFAULT_AUTH_SYS_CODE,
						autoSettle: DEFAULT_PAY_QUERY_AUTO_SETTLE,
						businessId: settlementContext.businessId,
						hospitalId: settlementContext.hospitalId,
						payingId: settlementContext.payingId,
						tradeTypeCode,
						workStationId: "",
					},
				);
				requestIds.push(queryResponse.requestId);
				paymentState = classifyPaymentQueryState(queryResponse.data);
				options.logger?.info(
					{
						event: "medical-insurance.cancellation.2.6.65.4.completed",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: queryResponse.requestId,
						providerStatus: providerResultLabel(queryResponse.data),
						paymentStatusCode: paymentQueryCode(queryResponse.data),
						paymentState,
						responseShape: providerPayloadShape(queryResponse.data),
					},
					"Medical insurance payment status queried before cancellation",
				);
				if (providerSuccessFlag(queryResponse.data) === false) {
					return {
						state: "manual_review",
						paymentState: "unknown",
						settlementState: "unknown",
						providerStatus: "2.6.65.4_success=false",
						trace: trace(
							"medical-insurance.cancellation",
							context,
							requestIds,
							settlementContext.businessId,
						),
					};
				}
				if (paymentState === "paid") {
					options.logger?.warn(
						{
							event: "medical-insurance.cancellation.blocked-paid",
							traceId: context.traceId,
							orderId: input.orderId,
							providerRequestId: queryResponse.requestId,
							paymentState,
						},
						"Medical insurance cancellation blocked because payment is paid",
					);
					return {
						state: "manual_review",
						paymentState: "paid",
						settlementState: "unknown",
						providerStatus: "payment_paid_requires_refund_review",
						trace: trace(
							"medical-insurance.cancellation",
							context,
							requestIds,
							settlementContext.businessId,
						),
					};
				}
			}

			if (
				settlementContext.payingId &&
				paymentState !== "closed" &&
				paymentState !== "not_created" &&
				input.reason !== "reauthorization"
			) {
				// 2.6.33 已确认“正在收款中”或 pay-query 未返回可识别文字状态
				// 时进入受控关单；关单本身必须拿到 success=true 才能继续 .6。
				const closeResponse = await zhongyangPost(
					"medical-insurance.2.6.65.11",
					"/msun-middle-open-settlepay/api/v2/open/payment/pay-close",
					context,
					{
						authSysCode: DEFAULT_AUTH_SYS_CODE,
						autoSettle: DEFAULT_PRE_ORDER_AUTO_SETTLE,
						businessId: settlementContext.businessId,
						payingId: settlementContext.payingId,
						tradeTypeCode,
						workStationId: "",
					},
				);
				requestIds.push(closeResponse.requestId);
				const revokeStatus = providerRevokeStatus(closeResponse.data);
				options.logger?.info(
					{
						event: "medical-insurance.cancellation.2.6.65.11.completed",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: closeResponse.requestId,
						providerStatus: providerResultLabel(closeResponse.data),
						revokeStatus,
						responseShape: providerPayloadShape(closeResponse.data),
					},
					"Medical insurance payment close completed",
				);
				if (
					providerSuccessFlag(closeResponse.data) !== true ||
					revokeStatus !== "3"
				) {
					return {
						state: "manual_review",
						paymentState: "unknown",
						settlementState: "unknown",
						providerStatus: "2.6.65.11_revoke_status_not_confirmed",
						trace: trace(
							"medical-insurance.cancellation",
							context,
							requestIds,
							settlementContext.businessId,
						),
					};
				}
				paymentState = "closed";
			}

			const cancelResponse = await zhongyangPost(
				"medical-insurance.2.6.65.6",
				"/msun-middle-open-settlepay/api/v2/open/settle/cancel-settle",
				context,
				{
					authSysCode: DEFAULT_AUTH_SYS_CODE,
					businessId: settlementContext.businessId,
					tradeTypeCode,
					workStationId: "",
				},
			);
			requestIds.push(cancelResponse.requestId);
			const cancelStatus = providerCancelStatus(cancelResponse.data);
			options.logger?.info(
				{
					event: "medical-insurance.cancellation.2.6.65.6.completed",
					traceId: context.traceId,
					orderId: input.orderId,
					providerRequestId: cancelResponse.requestId,
					providerStatus: providerResultLabel(cancelResponse.data),
					cancelStatus,
					responseShape: providerPayloadShape(cancelResponse.data),
				},
				"Medical insurance settlement cancellation completed",
			);
			if (
				providerSuccessFlag(cancelResponse.data) !== true ||
				(cancelStatus !== "1" && cancelStatus !== "0")
			) {
				return {
					state: "manual_review",
					paymentState,
					settlementState: "unknown",
					providerStatus: "2.6.65.6_cancel_status_not_confirmed",
					trace: trace(
						"medical-insurance.cancellation",
						context,
						requestIds,
						settlementContext.businessId,
					),
				};
			}
			return {
				state: "cancelled",
				paymentState,
				settlementState: "cancelled",
				providerStatus:
					cancelStatus === "0"
						? "payment_closed_settlement_already_cancelled"
						: "payment_closed_and_settlement_cancelled",
				trace: trace(
					"medical-insurance.cancellation",
					context,
					requestIds,
					settlementContext.businessId,
				),
			};
		},

		async query(input, context): Promise<MedicalInsuranceSettlementEvidence> {
			const order = await options.orders.findByMedicalOrderId(input.orderId);
			if (!order || order.ownerUserId !== input.ownerUserId)
				throw responseError(
					"medical-insurance.6301",
					"order context is unavailable",
				);
			const storedSettlementContext = await options.orders.getSettlementContext(
				input.ownerUserId,
				input.orderId,
			);
			const cached6301 = storedSettlementContext?.settlementQuery6301;
			let result: LegacyFsiSettlementQueryResult;
			if (cached6301?.statusClass === "settlement_candidate") {
				// 6301=3/4/5/6 的候选结果是同一笔结算的稳定事实；
				// 后续重试只重放后置编排，不再向医保中心查询 6301。
				result = {
					settlement: {
						payOrdId: cached6301.payOrdId,
						ordStas: cached6301.ordStas,
						...(cached6301.amounts
							? {
									amounts: {
										totalFen: cached6301.amounts.totalFen,
										cashFen: cached6301.amounts.cashFen,
										personalAccountFen: cached6301.amounts.personalAccountFen,
										fundFen: cached6301.amounts.fundFen,
										...(cached6301.amounts.otherPaymentFen === undefined
											? {}
											: {
													otherPaymentFen: cached6301.amounts.otherPaymentFen,
												}),
										...(cached6301.amounts.hospitalPartFen === undefined
											? {}
											: {
													hospitalPartFen: cached6301.amounts.hospitalPartFen,
												}),
										...(cached6301.amounts.personalAccountMutualAidFen ===
										undefined
											? {}
											: {
													personalAccountMutualAidFen:
														cached6301.amounts.personalAccountMutualAidFen,
												}),
										...(cached6301.amounts.personalAccountSelfFen === undefined
											? {}
											: {
													personalAccountSelfFen:
														cached6301.amounts.personalAccountSelfFen,
												}),
										...(cached6301.amounts.depositFen === undefined
											? {}
											: { depositFen: cached6301.amounts.depositFen }),
										...(cached6301.amounts.deliveryFeeFen === undefined
											? {}
											: { deliveryFeeFen: cached6301.amounts.deliveryFeeFen }),
									},
								}
							: {}),
					},
					statusClass: cached6301.statusClass,
					trace: trace(
						"medical-insurance.6301",
						context,
						[cached6301.providerRequestId],
						input.orderId,
					),
				};
				options.logger?.info(
					{
						event: "medical-insurance.6301.cached",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: cached6301.providerRequestId,
						statusClass: cached6301.statusClass,
						providerStatus: cached6301.ordStas,
					},
					"Medical insurance 6301 candidate reused from settlement context",
				);
			} else {
				const credential = await options.credentials.getActiveForOrder({
					ownerUserId: input.ownerUserId,
					medicalOrderId: input.orderId,
					purpose: "query",
					now: now().toISOString(),
				});
				if (!credential)
					throw responseError(
						"medical-insurance.6301",
						"query context is unavailable",
					);
				options.logger?.info(
					{
						event: "medical-insurance.6301.payload.ready",
						traceId: context.traceId,
						orderId: input.orderId,
						hasPayOrdId: Boolean(credential.payOrdId),
						hasPayToken: Boolean(credential.payToken),
					},
					"Medical insurance 6301 payload is ready",
				);
				result = await options.legacyFsi.querySettlement(
					{
						payOrdId: credential.payOrdId,
						payToken: credential.payToken,
						...credential.providerQueryIdentity,
					},
					context,
				);
				options.logger?.info(
					{
						event: "medical-insurance.6301.completed",
						traceId: context.traceId,
						orderId: input.orderId,
						providerRequestId: result.trace.requestId,
						statusClass: result.statusClass,
						providerStatus: result.settlement.ordStas,
					},
					"Medical insurance 6301 completed",
				);
			}
			const storedAmounts = order.amounts;
			const resultAmounts = result.settlement.amounts
				? mapMedicalAmounts(result.settlement.amounts)
				: undefined;
			const amounts = resultAmounts ?? storedAmounts;
			if (!amounts)
				throw responseError(
					"medical-insurance.6301",
					"医保查单没有权威或已落库金额",
					result.trace.requestId,
				);
			const payment = paymentAmounts(amounts, result.trace.requestId);
			const mapping = statusMapping(result);
			if (
				result.statusClass === "settlement_candidate" &&
				storedSettlementContext &&
				!cached6301
			) {
				await options.orders.saveSettlementContext(
					input.ownerUserId,
					input.orderId,
					{
						...storedSettlementContext,
						settlementQuery6301: {
							queriedAt: now().toISOString(),
							providerRequestId: result.trace.requestId,
							payOrdId: result.settlement.payOrdId,
							ordStas: result.settlement.ordStas,
							statusClass: result.statusClass,
							...(resultAmounts ? { amounts: resultAmounts } : {}),
							...(result.settlement.setlType
								? { setlType: result.settlement.setlType }
								: {}),
						},
					},
				);
			}
			if (result.statusClass === "settlement_candidate") {
				try {
					const finalized = await finalizeStoredSettlement(
						{
							orderId: input.orderId,
							ownerUserId: input.ownerUserId,
							amounts,
							businessType:
								order.businessType ??
								(order.appointmentId ? "registration" : "outpatient"),
							...(input.cashPaymentConfirmed === undefined
								? {}
								: { cashPaymentConfirmed: input.cashPaymentConfirmed }),
						},
						context,
					);
					return {
						...finalized,
						amounts: paymentAmounts(
							finalized.amounts,
							finalized.trace.requestId,
						),
					};
				} catch (error) {
					if (!(error instanceof ProviderRequestError)) throw error;
					options.logger?.warn(
						{
							event: "medical-insurance.post-payment-finalize.failed",
							traceId: context.traceId,
							orderId: input.orderId,
							operation: error.operation,
							providerRequestId: error.requestId,
							failureStage: error.failureStage,
							requestOutcome: error.requestOutcome,
							responseInvalid: error.responseInvalid,
							...(error.providerErrorCode
								? { providerErrorCode: error.providerErrorCode }
								: {}),
							providerErrorMessage: error.providerErrorMessage,
						},
						"Medical insurance post-payment HIS finalization failed or is waiting",
					);
				}
			}
			return {
				...mapping,
				amounts: payment,
				trace: result.trace,
				source: "6301",
				providerStatus: result.settlement.ordStas,
				authoritative: mapping.authoritative,
			};
		},
	};
}
