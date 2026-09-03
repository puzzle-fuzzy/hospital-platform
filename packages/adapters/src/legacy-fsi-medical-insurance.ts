import { createHash } from "node:crypto";
import type {
	AdapterCallContext,
	AppointmentMedicalInsuranceContext,
	AppointmentMedicalInsurancePatient,
	ExternalTrace,
	MedicalInsuranceAmounts,
	MedicalInsuranceAuthorizationContext,
	MedicalInsuranceAuthorizationRepository,
	MedicalInsuranceCredentialRepository,
	MedicalInsuranceGateway,
	MedicalInsuranceOrderRepository,
	MedicalInsuranceSettlementEvidence,
	MedicalInsuranceSettlementContext,
	PaymentAmounts,
} from "@hospital/domain";
import {
	assertValidMedicalInsuranceAmounts,
	assertValidPaymentAmounts,
} from "@hospital/domain";
import { AdapterNotConfiguredError, ProviderRequestError } from "./errors";
import {
	type classifyLegacyFsiOrderStatus,
	yuanToFen,
} from "./legacy-fsi-contract";
import type {
	LegacyFsiGateway,
	LegacyFsiSettlementQueryResult,
} from "./legacy-fsi-gateway";
import { type ProviderFetcher, requestJson } from "./http";

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
const DEFAULT_MEDICAL_PAY_TYPE_ID = 2;
const DEFAULT_MEDICAL_PAY_MODEL = "H5";

type ProviderRecord = Record<string, unknown>;

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
	zhongyangBaseUrl: string;
	zhongyangAuthorizationToken?: string;
	userQueryBaseUrl?: string;
	userQueryPath?: string;
	orgCode?: string;
	hospitalId?: string;
	insutype?: string;
	insuCode?: string;
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
): ProviderRequestError {
	return new ProviderRequestError({
		provider: "medical-insurance",
		operation,
		message,
		retryable: false,
		failureStage: "response",
		responseInvalid: true,
		...(requestId ? { requestId } : {}),
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

function statusMapping(
	result: {
		statusClass: ReturnType<typeof classifyLegacyFsiOrderStatus>;
		settlement: { ordStas: string };
	},
	amounts: MedicalInsuranceAmounts,
): SettlementMapping {
	switch (result.statusClass) {
		case "processing":
			return {
				state: "awaiting_confirmation",
				finality: "processing",
				authoritative: false,
			};
		case "settlement_candidate":
			return {
				state: amounts.cashFen > 0 ? "cash_pending" : "awaiting_confirmation",
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
}): MedicalInsuranceAmounts {
	return assertValidMedicalInsuranceAmounts({
		totalFen: amounts.totalFen,
		cashFen: amounts.cashFen,
		personalAccountFen: amounts.personalAccountFen,
		fundFen: amounts.fundFen,
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
		insuranceFen: amounts.personalAccountFen + amounts.fundFen,
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
	appointment: AppointmentMedicalInsuranceContext,
	auth: MedicalInsuranceAuthorizationContext,
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
		const occurredAt =
			optionalText(
				detail,
				["createTime", "feeOcurTime"],
				operation,
				requestId,
			) ?? dateTime(currentDate);
		const rxno =
			optionalText(
				detail,
				["orderId", "orderMainId", "rxno"],
				operation,
				requestId,
			) ?? appointment.providerAppointmentId;
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
				optionalText(detail, ["billDocCode"], operation, requestId) ??
				doctorCode,
			bilgDrName:
				optionalText(detail, ["billDocName"], operation, requestId) ??
				doctorName,
			...(optionalText(detail, ["hospApprFlag"], operation, requestId)
				? {
						hospApprFlag: optionalText(
							detail,
							["hospApprFlag"],
							operation,
							requestId,
						),
					}
				: {}),
			medType: optionalText(detail, ["medType"], operation, requestId) ?? "11",
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
				optionalText(
					detail,
					["exeDocCode", "exeInsurDocCode"],
					operation,
					requestId,
				) ?? doctorCode,
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

/** 2.27.2.32 的 upDetailList 必须来自 HIS 明细和 2.6.33 子项目事实。 */
function mapSettlementDetails(
	details: readonly ProviderRecord[],
	children: readonly ProviderRecord[],
	operation: string,
	requestId: string | undefined,
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
			orderId: requiredProviderField(
				detail,
				child,
				["orderId", "outDocOrderId"],
				operation,
				requestId,
				index,
			),
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

function accountFlag(
	records: readonly ProviderRecord[],
	insuplcAdmdvs: string,
): string {
	const codes = new Set(
		records
			.map((record) =>
				optionalText(
					record,
					["insurMedCode"],
					"medical-insurance.2.6.33",
					undefined,
				),
			)
			.filter((value): value is string => Boolean(value)),
	);
	const special =
		codes.has("011102020010000") &&
		!(codes.has("011102020010001") && codes.has("011102020010002"));
	return insuplcAdmdvs === "140581" && special ? "0" : "";
}

/**
 * 真实医保编排：授权解析 → 1101 → 2.6.65.1/2.27.2.27 → 2.1.9/2.1.13/2.6.33
 * → 6201 → 6202 → 6301。6201/6202 仍通过严格加密 FSI gateway，所有短期
 * 凭证进入加密仓储；前端既不能提交费用明细，也不能提交医保人员或科室编码。
 */
export function createLegacyFsiMedicalInsuranceGateway(
	options: LegacyFsiMedicalInsuranceGatewayOptions,
): MedicalInsuranceGateway {
	const relayUrl = absoluteUrl(options.relayUrl);
	const foundationBaseUrl = absoluteUrl(options.foundationBaseUrl);
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
	const insutype = options.insutype?.trim() || "310";
	const insuCode = options.insuCode?.trim() || "140581";
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
		return requestJson<unknown>(
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
		);

	const finalizeStoredSettlement = async (
		input: {
			orderId: string;
			ownerUserId: string;
			amounts: MedicalInsuranceAmounts;
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

		let settlementContext: MedicalInsuranceSettlementContext = stored;
		if (
			Object.keys(settlementContext.outNetworkSettleMain).length === 0 ||
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
			const outNetworkSettleMain =
				findRecordDeep(settleInfo, [
					"outNetworkSettleMain",
					"out_network_settle_main",
				]) ?? settlementContext.outNetworkSettleMain;
			const upDetailList =
				details.length > 0
					? mapSettlementDetails(
							details,
							[],
							"medical-insurance.2.27.2.32",
							detailResponse.requestId,
						)
					: settlementContext.upDetailList;
			settlementContext = {
				...settlementContext,
				outNetworkSettleMain,
				upDetailList,
				nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
					? (settleInfo.nationalUpDetailList as ProviderRecord[])
					: settlementContext.nationalUpDetailList,
			};
		}

		if (
			Object.keys(settlementContext.outNetworkSettleMain).length === 0 ||
			settlementContext.upDetailList.length === 0
		) {
			throw responseError(
				"medical-insurance.2.27.2.32",
				"真实结算主单或费用明细不存在",
			);
		}
		const existingTransId = providerField(
			settlementContext.outNetworkSettleMain,
			undefined,
			["transId", "trans_id"],
		);
		if (
			existingTransId !== undefined &&
			String(existingTransId).trim() !== settlementContext.payingId
		) {
			throw responseError(
				"medical-insurance.2.27.2.32",
				"outNetworkSettleMain.transId 与 2.6.65.2 payingId 不一致",
			);
		}

		const notifyPayload: Record<string, unknown> = {
			hospitalId: settlementContext.hospitalId,
			nationalUpDetailList: settlementContext.nationalUpDetailList,
			networkRegister: settlementContext.networkRegister,
			outNetworkSettleMain: {
				...settlementContext.outNetworkSettleMain,
				transId: settlementContext.payingId,
			},
			outSettleMainId: settlementContext.businessId,
			patId: settlementContext.patientId,
			tradingId: settlementContext.tradingId,
			upDetailList: settlementContext.upDetailList,
		};
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
		const notifyTrace = trace(
			"medical-insurance.2.27.2.32",
			context,
			[notifyResponse.requestId],
			settlementContext.businessId,
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

		const completeResponse = await zhongyangPost(
			"medical-insurance.2.6.65.5",
			"/msun-middle-open-settlepay/api/v2/open/payment/complete-settle",
			context,
			{
				authSysCode: DEFAULT_AUTH_SYS_CODE,
				autoSettle: 2,
				businessId: settlementContext.businessId,
				hospitalId: settlementContext.hospitalId,
				tradeTypeCode: DEFAULT_TRADE_TYPE_CODE,
				workStationId: "",
			},
		);
		const isSettle = providerDeepValue(completeResponse.data, ["isSettle"]);
		const completeTrace = trace(
			"medical-insurance.2.27.2.32/2.6.65.5",
			context,
			[notifyResponse.requestId, completeResponse.requestId],
			settlementContext.businessId,
		);
		if (
			providerSuccessFlag(completeResponse.data) === false ||
			String(isSettle) !== "1"
		) {
			return {
				state: "awaiting_confirmation",
				amounts: input.amounts,
				trace: completeTrace,
				source: "yunhealth",
				providerStatus: `isSettle=${String(isSettle ?? "UNKNOWN")}`,
				finality: "settlement_candidate",
				authoritative: false,
			};
		}
		return {
			state: "insurance_settled",
			amounts: input.amounts,
			trace: completeTrace,
			source: "yunhealth",
			providerStatus: "isSettle=1",
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
		);

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
		const payAuthNo =
			findTextAnywhere(
				queryResponse.data,
				["pay_auth_no", "family_pay_auth_no", "auth_no"],
				"medical-insurance.authorization.user-query",
				queryResponse.requestId,
			) ??
			requiredText(
				queryPayload,
				["pay_auth_no", "family_pay_auth_no", "auth_no"],
				"medical-insurance.authorization.user-query",
				queryResponse.requestId,
			);
		if (!/^AUTH/i.test(payAuthNo)) {
			throw responseError(
				"medical-insurance.authorization.user-query",
				"userQuery did not return a valid pay_auth_no",
				queryResponse.requestId,
			);
		}

		const infoResponse = await relayPost(
			"medical-insurance.1101",
			context,
			foundationBaseUrl,
			DEFAULT_FOUNDATION_PATH,
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
		const selectedInsu = insuInfoList.find(
			(item) =>
				optionalText(
					item,
					["insutype", "insuType", "insutypeCode"],
					"medical-insurance.1101",
					infoResponse.requestId,
				) === insutype,
		);
		if (!selectedInsu) {
			throw responseError(
				"medical-insurance.1101",
				`参保信息缺少 insutype=${insutype}`,
				infoResponse.requestId,
			);
		}
		const psnNo = requiredText(
			selectedInsu,
			["psn_no", "psnNo"],
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const insuplcAdmdvs = requiredText(
			selectedInsu,
			["insuplc_admdvs", "insuplcAdmdvs"],
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const returnedInsutype =
			optionalText(
				selectedInsu,
				["insutype", "insuType", "insutypeCode"],
				"medical-insurance.1101",
				infoResponse.requestId,
			) ?? insutype;
		const ecToken = tokenFromBaseInfo(baseInfo);
		const companyName = optionalText(
			selectedInsu,
			["emp_name", "empName"],
			"medical-insurance.1101",
			infoResponse.requestId,
		);
		const netPatType = optionalText(
			selectedInsu,
			["psn_type", "psnType"],
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
			patient: {
				idNo: input.patient.idNo,
				userName: input.patient.name,
				idType: "01",
			},
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
			const appointment = input.appointment;
			const registerId =
				appointment.providerRegisterId ??
				appointment.providerHisRegisterId ??
				appointment.providerAppointmentId;
			const settleApply = await zhongyangPost(
				"medical-insurance.2.6.65.1",
				"/msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle",
				context,
				{
					authSysCode: DEFAULT_AUTH_SYS_CODE,
					appCode: DEFAULT_APP_CODE,
					autoSettle: "2",
					hospitalId,
					patId: appointment.providerPatientId,
					requestId: stableNumericRequestId(
						`medical-insurance.2.6.65.1:${input.orderId}:${registerId}`,
					),
					requestParam: {
						registerId,
						registerSource: DEFAULT_REGISTER_SOURCE,
						settleWay: DEFAULT_SETTLE_WAY,
					},
					sceneCode: DEFAULT_SCENE_CODE,
					paySceneCode: DEFAULT_SCENE_CODE,
					tradeTypeCode: DEFAULT_TRADE_TYPE_CODE,
					workStationId: "",
				},
			);
			const applyPayload = objectPayload(
				settleApply.data,
				"medical-insurance.2.6.65.1",
				settleApply.requestId,
			);
			const businessId = requiredText(
				applyPayload,
				["businessId"],
				"medical-insurance.2.6.65.1",
				settleApply.requestId,
			);
			const tradeOrderIds = collectTradeOrderIds(
				applyPayload,
				"medical-insurance.2.6.65.1",
				settleApply.requestId,
			);
			const businessCode = requiredText(
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
			const settlementAmountFen = yuanToFen(
				settlementAmountRaw,
				"getAmount",
				"6201",
			);
			if (settlementAmountFen !== appointment.totalFen) {
				throw responseError(
					"medical-insurance.2.6.65.1",
					"真实结算金额与预约服务端金额不一致",
					settleApply.requestId,
				);
			}
			const preOrderResponse = await zhongyangPost(
				"medical-insurance.2.6.65.2",
				"/msun-middle-open-settlepay/api/v2/open/payment/pre-order",
				context,
				{
					appCode: DEFAULT_APP_CODE,
					authSysCode: DEFAULT_AUTH_SYS_CODE,
					autoSettle: DEFAULT_PRE_ORDER_AUTO_SETTLE,
					body: "预约挂号医保支付",
					businessId,
					expire: 20,
					hospitalId,
					notifyUrl: "",
					payModel: DEFAULT_MEDICAL_PAY_MODEL,
					payTypeId: DEFAULT_MEDICAL_PAY_TYPE_ID,
					payTypeParams: [
						{
							payTypeId: DEFAULT_MEDICAL_PAY_TYPE_ID,
							amount: 0,
							paymentSystemUserId: "",
							spbillCreateIp: "",
						},
					],
					paymentSystemUserId: "",
					spbillCreateIp: "",
					total: settlementAmountFen / 100,
					tradeCode: businessCode,
					tradeTypeCode: DEFAULT_TRADE_TYPE_CODE,
					workStationId: "",
					requestId: stableNumericRequestId(
						`medical-insurance.2.6.65.2:${input.orderId}:${businessId}`,
					),
					sceneCode: DEFAULT_SCENE_CODE,
				},
			);
			if (providerSuccessFlag(preOrderResponse.data) === false) {
				throw responseError(
					"medical-insurance.2.6.65.2",
					"医保支付流水创建失败",
					preOrderResponse.requestId,
				);
			}
			const payingId = findTextDeep(
				preOrderResponse.data,
				["payingId", "paying_id"],
				"medical-insurance.2.6.65.2",
				preOrderResponse.requestId,
			);
			const tradingId = findTextDeep(
				preOrderResponse.data,
				["tradingId", "trading_id"],
				"medical-insurance.2.6.65.2",
				preOrderResponse.requestId,
			);
			if (
				!payingId ||
				!tradingId ||
				!/^\d+$/.test(payingId) ||
				!/^\d+$/.test(tradingId)
			) {
				throw responseError(
					"medical-insurance.2.6.65.2",
					"医保支付流水缺少有效 payingId/tradingId",
					preOrderResponse.requestId,
				);
			}
			const detailResponse = await zhongyangGet(
				"medical-insurance.2.27.2.27",
				"/msun-yb-app-miop/v1/out-insur-settle-infos",
				context,
				{ patId: appointment.providerPatientId, outSettleMainId: businessId },
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
			const firstDetail = details[0] as ProviderRecord;
			const preResolvedMdtrtId =
				optionalText(
					applyPayload,
					["mdtrtId", "mdtrt_id"],
					"medical-insurance.2.6.65.1",
					settleApply.requestId,
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
			const deptId =
				optionalText(
					firstDetail,
					["billDeptCode", "billDeptId", "exeDeptCode", "exeDeptId"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ?? appointment.departmentId;
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
				) ?? appointment.departmentName;
			const doctorUserCode =
				optionalText(
					firstDetail,
					["billDocCode", "exeDocCode"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ?? appointment.doctorId;
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
				appointment.doctorName;
			const chargeBatch =
				optionalText(
					firstDetail,
					["chrgBchno", "chargeBatchNo"],
					"medical-insurance.2.27.2.27",
					detailResponse.requestId,
				) ??
				tradeOrderIds[0] ??
				appointment.providerAppointmentId;
			const feedetailList = mapFeeDetails(
				details,
				appointment,
				auth,
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
			if (totalFen !== appointment.totalFen)
				throw responseError(
					"medical-insurance.6201",
					"真实费用明细合计与预约应付金额不一致",
					detailResponse.requestId,
				);
			const childPaymentResponse = await zhongyangGet(
				"medical-insurance.2.6.33",
				"/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records",
				context,
				{
					patId: appointment.providerPatientId,
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
			const acctUsedFlag = accountFlag(childRecords, auth.insuplcAdmdvs);
			const outNetworkSettleMain =
				findRecordDeep(settleInfo, [
					"outNetworkSettleMain",
					"out_network_settle_main",
				]) ?? {};
			const outSettlePat = findRecordDeep(settleInfo, [
				"outSettlePat",
				"out_settle_pat",
			]);
			const upDetailList = mapSettlementDetails(
				details,
				childRecords,
				"medical-insurance.2.27.2.32",
				detailResponse.requestId,
			);
			const networkRegister: Record<string, unknown> = {
				cantonCode: auth.insuplcAdmdvs,
				cardNo: auth.payAuthNo,
				...(auth.companyName ? { companyName: auth.companyName } : {}),
				idNo: auth.patient.idNo,
				insuType: auth.insutype,
				memberNo: auth.psnNo,
				netPatName: auth.patient.userName,
				...(auth.netPatType ? { netPatType: auth.netPatType } : {}),
				outPatId: providerField(outSettlePat ?? {}, undefined, ["patId"]),
				regFlag: "1",
			};
			for (const [key, value] of Object.entries(networkRegister)) {
				if (value === undefined || value === null || value === "")
					delete networkRegister[key];
			}
			const diagnoseList = [
				{
					diagType: "1",
					diagSrtNo: 1,
					diagCode: "Z00.001",
					diagName: "健康查体",
					diagDept: deptCode,
					diseDorNo: doctorCode,
					diseDorName: doctorName,
					diagTime:
						optionalText(
							firstDetail,
							["createTime"],
							"medical-insurance.2.27.2.27",
							detailResponse.requestId,
						) ?? dateTime(currentDate),
					valiFlag: "1",
				},
			];
			const feeResult = await options.legacyFsi.uploadFees(
				{
					...(preResolvedMdtrtId ? { mdtrtId: preResolvedMdtrtId } : {}),
					...(auth.ecToken ? { ecToken: auth.ecToken } : {}),
					payAuthNo: auth.payAuthNo,
					orgCodg: orgCode,
					psnNo: auth.psnNo,
					insutype: auth.insutype,
					medOrgOrd: input.orderId,
					begntime:
						optionalText(
							firstDetail,
							["createTime"],
							"medical-insurance.2.27.2.27",
							detailResponse.requestId,
						) ?? dateTime(currentDate),
					idNo: auth.patient.idNo,
					userName: auth.patient.userName,
					idType: auth.patient.idType,
					insuCode: auth.insuCode,
					iptOtpNo: chargeBatch,
					deptName,
					deptCode,
					caty,
					medType: "11",
					feeType: "01",
					psnSetlway: "01",
					chrgBchno: chargeBatch,
					pubHospRfomFlag: "1",
					medfeeSumamt: fenToYuan(totalFen),
					diseinfoList: diagnoseList,
					feedetailList,
				},
				context,
			);
			const mdtrtId = feeResult.mdtrtId;
			if (!mdtrtId)
				throw responseError(
					"medical-insurance.6201",
					"6201 未返回 mdtrtId",
					feeResult.trace.requestId,
				);
			const createdAt = now().toISOString();
			const expiresAt = new Date(
				now().getTime() + 30 * 60 * 1000,
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
					patientId: appointment.providerPatientId,
					networkRegister,
					outNetworkSettleMain,
					nationalUpDetailList: Array.isArray(settleInfo.nationalUpDetailList)
						? (settleInfo.nationalUpDetailList as ProviderRecord[])
						: [],
					upDetailList,
					tradeOrderIds,
					payingId,
					tradingId,
				},
			);
			return {
				feeUploadId: settlementCredentialId,
				payOrdId: feeResult.credential.payOrdId,
				payTokenHash: sha256(feeResult.credential.payToken),
				mdtrtId,
				acctUsedFlag,
				trace: trace(
					"medical-insurance.6201",
					context,
					[
						settleApply.requestId,
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
			const mdtrtId = input.mdtrtId || order.mdtrtId;
			if (!mdtrtId)
				throw responseError("medical-insurance.6202", "mdtrtId is unavailable");
			const result = await options.legacyFsi.createPaymentOrder(
				{
					payAuthNo: auth.payAuthNo,
					payOrdId: credential.payOrdId,
					payToken: credential.payToken,
					orgCodg: orgCode,
					orgBizSer: order.medOrgOrd,
					chrgBchno: order.chrgBchno,
					feeType: "01",
					mdtrtId,
					acctUsedFlag: input.acctUsedFlag || order.acctUsedFlag || "",
				},
				context,
			);
			const amounts = mapMedicalAmounts(result.settlement);
			const mapping = statusMapping(result, amounts);
			if (result.statusClass === "settlement_candidate") {
				try {
					return await finalizeStoredSettlement(
						{ orderId: input.orderId, ownerUserId: input.ownerUserId, amounts },
						context,
					);
				} catch (error) {
					if (!(error instanceof ProviderRequestError)) throw error;
					return {
						...mapping,
						amounts,
						trace: result.trace,
						source: "6202",
						providerStatus: result.settlement.ordStas,
					};
				}
			}
			return {
				...mapping,
				amounts,
				trace: result.trace,
				source: "6202",
				providerStatus: result.settlement.ordStas,
			};
		},

		async query(input, context): Promise<MedicalInsuranceSettlementEvidence> {
			const order = await options.orders.findByMedicalOrderId(input.orderId);
			if (!order || order.ownerUserId !== input.ownerUserId)
				throw responseError(
					"medical-insurance.6301",
					"order context is unavailable",
				);
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
			const result: LegacyFsiSettlementQueryResult =
				await options.legacyFsi.querySettlement(
					{
						payOrdId: credential.payOrdId,
						payToken: credential.payToken,
						...credential.providerQueryIdentity,
					},
					context,
				);
			const storedAmounts = order.amounts;
			const amounts = result.settlement.amounts
				? mapMedicalAmounts(result.settlement.amounts)
				: storedAmounts;
			if (!amounts)
				throw responseError(
					"medical-insurance.6301",
					"医保查单没有权威或已落库金额",
					result.trace.requestId,
				);
			const payment = paymentAmounts(amounts, result.trace.requestId);
			const mapping = statusMapping(result, amounts);
			if (result.statusClass === "settlement_candidate") {
				try {
					const finalized = await finalizeStoredSettlement(
						{
							orderId: input.orderId,
							ownerUserId: input.ownerUserId,
							amounts,
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
