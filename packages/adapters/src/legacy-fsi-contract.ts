/**
 * 山西医保移动支付中心的协议 contract（不包含 SM2/SM4 密码实现）。
 *
 * 旧系统把 6201/6202/6203/6301/6401 通过中转服务转发，且 6201/6202
 * 的 data 节点形状与通用 FSI 外层不同。这里先固定路由、金额和订单关联
 * 不变量，密码封装仍由后续可替换的 crypto boundary 负责。
 */

export const LEGACY_FSI_ROUTES = {
	"6201": {
		name: "fee-upload",
		path: "/org/local/api/hos/uldFeeInfo",
	},
	"6202": {
		name: "payment-order",
		path: "/org/local/api/hos/pay_order",
	},
	"6203": {
		name: "refund-order",
		path: "/org/local/api/hos/refund_Order",
	},
	"6301": {
		name: "settlement-query",
		path: "/org/local/api/hos/query_order_info",
	},
	"6401": {
		name: "fee-upload-revoke",
		path: "/org/local/api/hos/revoke_order",
	},
} as const;

export type LegacyFsiInfno = keyof typeof LEGACY_FSI_ROUTES;

export type LegacyFsiAmountBreakdown = {
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
};

export type LegacyFsiFeeUploadCredential = {
	payOrdId: string;
	payToken: string;
};

export type LegacyFsiRefundAmounts = {
	totalFen: number;
	cashFen: number;
	personalAccountFen: number;
	fundFen: number;
	refdType: "ALL" | "CASH" | "HI";
};

export type LegacyFsiSettlement = LegacyFsiAmountBreakdown & {
	payOrdId: string;
	ordStas: string;
};

/**
 * 6301 在 0/1/2 等处理中状态下可能只返回订单号和状态，不返回金额。
 * 这类结果只能驱动“等待确认”，不能被强行填成一笔已结算金额。
 */
export type LegacyFsiSettlementQuery = {
	payOrdId: string;
	ordStas: string;
	amounts?: LegacyFsiAmountBreakdown;
	setlType?: "ALL" | "CASH" | "HI";
};

/**
 * FSI 订单状态的安全分类。
 *
 * `settlement_candidate` 刻意不叫 paid：3/4/5/6 只能进入旧流程的后置
 * 编排，最终仍要经过云健康/HIS 的成功证据。这样 6202/6301 的 success
 * 外层、HTTP 200 或完整金额不会被误用为支付成功。
 */
export type LegacyFsiOrderStatusClass =
	| "processing"
	| "settlement_candidate"
	| "cancelled"
	| "failed"
	| "unknown";

export class LegacyFsiContractError extends Error {
	readonly infno: LegacyFsiInfno;

	constructor(infno: LegacyFsiInfno, message: string) {
		super(`Legacy FSI ${infno} contract violation: ${message}`);
		this.name = "LegacyFsiContractError";
		this.infno = infno;
	}
}

export function classifyLegacyFsiOrderStatus(
	value: unknown,
): LegacyFsiOrderStatusClass {
	const status =
		typeof value === "string" ? value.trim() : String(value ?? "").trim();
	if (["0", "1", "2"].includes(status)) return "processing";
	if (["3", "4", "5", "6"].includes(status)) {
		return "settlement_candidate";
	}
	if (["7", "8", "9", "10", "11", "12", "13"].includes(status)) {
		return "cancelled";
	}
	if (["14", "15", "16"].includes(status)) return "failed";
	return "unknown";
}

function contractError(infno: LegacyFsiInfno, message: string): never {
	throw new LegacyFsiContractError(infno, message);
}

function objectValue(
	value: unknown,
	infno: LegacyFsiInfno,
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		contractError(infno, "payload must be an object");
	}
	return value as Record<string, unknown>;
}

/** 医保金额以字符串元传输；转换到分时禁止浮点四舍五入。 */
export function yuanToFen(
	value: unknown,
	fieldName: string,
	infno: LegacyFsiInfno,
): number {
	const text =
		typeof value === "string"
			? value.trim()
			: typeof value === "number" && Number.isFinite(value)
				? String(value)
				: "";
	if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
		contractError(
			infno,
			`${fieldName} must be a non-negative amount with at most 2 decimals`,
		);
	}
	const [whole, fraction = ""] = text.split(".");
	if (whole === undefined) {
		contractError(infno, `${fieldName} is invalid`);
	}
	const fen = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
	if (fen > BigInt(Number.MAX_SAFE_INTEGER)) {
		contractError(infno, `${fieldName} exceeds the safe integer range`);
	}
	return Number(fen);
}

function requiredText(
	payload: Record<string, unknown>,
	fieldName: string,
	infno: LegacyFsiInfno,
): string {
	const value = payload[fieldName];
	if (typeof value !== "string" || !value.trim()) {
		contractError(infno, `${fieldName} is required`);
	}
	return value.trim();
}

function requiredAnyText(
	payload: Record<string, unknown>,
	fieldNames: readonly string[],
	infno: LegacyFsiInfno,
): string {
	for (const fieldName of fieldNames) {
		const value = payload[fieldName];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	contractError(infno, `${fieldNames.join(" or ")} is required`);
}

function optionalAmount(
	payload: Record<string, unknown>,
	fieldName: string,
	infno: LegacyFsiInfno,
): number {
	return payload[fieldName] === undefined || payload[fieldName] === null
		? 0
		: yuanToFen(payload[fieldName], fieldName, infno);
}

function requireExactBreakdown(
	infno: LegacyFsiInfno,
	totalFen: number,
	cashFen: number,
	personalAccountFen: number,
	fundFen: number,
): LegacyFsiAmountBreakdown {
	if (cashFen + personalAccountFen + fundFen !== totalFen) {
		contractError(infno, "cash + personal account + fund must equal total");
	}
	return { totalFen, cashFen, personalAccountFen, fundFen };
}

/** 旧转发服务可能多次包裹 data/output/body，最多只展开固定层数。 */
export function unwrapLegacyFsiData(
	value: unknown,
	infno: LegacyFsiInfno,
): Record<string, unknown> {
	let payload = objectValue(value, infno);
	for (let depth = 0; depth < 3; depth += 1) {
		const nested = ["data", "output", "body"]
			.map((key) => payload[key])
			.find(
				(candidate) =>
					typeof candidate === "object" &&
					candidate !== null &&
					!Array.isArray(candidate),
			);
		if (nested === undefined) break;
		payload = objectValue(nested, infno);
	}
	return payload;
}

export function validate6201FeeUpload(payload: Record<string, unknown>): {
	totalFen: number;
} {
	const infno = "6201" as const;
	requiredAnyText(payload, ["ecToken", "payAuthNo"], infno);
	if (!payload.ecToken) requiredText(payload, "mdtrtId", infno);
	for (const fieldName of [
		"orgCodg",
		"psnNo",
		"insutype",
		"medOrgOrd",
		"begntime",
		"idNo",
		"userName",
		"idType",
		"insuCode",
		"iptOtpNo",
		"deptName",
		"deptCode",
		"caty",
		"medType",
		"feeType",
		"psnSetlway",
		"chrgBchno",
		"pubHospRfomFlag",
	]) {
		requiredText(payload, fieldName, infno);
	}
	const totalFen = yuanToFen(payload.medfeeSumamt, "medfeeSumamt", infno);
	const detailList = payload.feedetailList;
	if (!Array.isArray(detailList) || detailList.length === 0) {
		contractError(infno, "feedetailList must be a non-empty array");
	}
	const details = detailList as unknown[];
	const detailTotal = details.reduce<number>((sum, detail, index) => {
		const item = objectValue(detail, infno);
		const itemTotal = yuanToFen(
			item.detItemFeeSumamt,
			`feedetailList[${index}].detItemFeeSumamt`,
			infno,
		);
		return sum + itemTotal;
	}, 0);
	if (detailTotal !== totalFen) {
		contractError(infno, "fee detail total must equal medfeeSumamt");
	}

	const componentValues = [
		payload.fulamtOwnpayAmt,
		payload.preselfpayAmt,
		payload.inscpScpAmt,
	];
	if (componentValues.every((value) => value !== undefined && value !== null)) {
		const componentTotal = componentValues.reduce<number>(
			(sum, value, index) =>
				sum + yuanToFen(value, `fee component ${index}`, infno),
			0,
		);
		if (componentTotal !== totalFen) {
			contractError(infno, "fee components must equal medfeeSumamt");
		}
	}
	return { totalFen };
}

export function validate6201Response(
	result: unknown,
): LegacyFsiFeeUploadCredential {
	const infno = "6201" as const;
	const payload = unwrapLegacyFsiData(result, infno);
	return {
		payOrdId: requiredText(payload, "payOrdId", infno),
		payToken: requiredText(payload, "payToken", infno),
	};
}

function settlementFromPayload(
	payload: Record<string, unknown>,
	infno: "6202" | "6301",
	expectedPayOrdId?: string,
): LegacyFsiSettlement {
	const payOrdId = requiredText(payload, "payOrdId", infno);
	if (expectedPayOrdId !== undefined && payOrdId !== expectedPayOrdId) {
		contractError(infno, "response payOrdId does not match the request order");
	}
	const totalFen = yuanToFen(payload.feeSumamt, "feeSumamt", infno);
	const cashFen = yuanToFen(payload.ownPayAmt, "ownPayAmt", infno);
	const personalAccountFen = yuanToFen(payload.psnAcctPay, "psnAcctPay", infno);
	const fundFen = yuanToFen(payload.fundPay, "fundPay", infno);
	return {
		...requireExactBreakdown(
			infno,
			totalFen,
			cashFen,
			personalAccountFen,
			fundFen,
		),
		ordStas: requiredText(payload, "ordStas", infno),
		payOrdId,
	};
}

export function validate6202Settlement(
	result: unknown,
	expectedPayOrdId?: string,
): LegacyFsiSettlement {
	return settlementFromPayload(
		unwrapLegacyFsiData(result, "6202"),
		"6202",
		expectedPayOrdId,
	);
}

export function validate6301Settlement(
	result: unknown,
	expectedPayOrdId?: string,
): LegacyFsiSettlement {
	const infno = "6301" as const;
	const payload = unwrapLegacyFsiData(result, infno);
	const settlement = settlementFromPayload(payload, infno, expectedPayOrdId);
	const settlementType = requiredText(payload, "setlType", infno);
	if (
		!(["ALL", "CASH", "HI"] as const).includes(
			settlementType as "ALL" | "CASH" | "HI",
		)
	) {
		contractError(infno, "setlType must be ALL, CASH or HI");
	}
	for (const fieldName of ["callType", "medOrgOrd", "traceTime", "revsToken"]) {
		requiredText(payload, fieldName, infno);
	}
	return settlement;
}

/**
 * 校验 6301 查询结果，但保留医保中心的处理中状态。
 *
 * 旧端把 0～16 都展示为状态；新端只允许 3/4/5/6 携带完整金额进入结算
 * 编排，其余状态返回无金额的查询结果，由上层映射为 awaiting_confirmation
 * 或 failed。这样不会因为“查到订单”就把医保订单误判成已支付。
 */
export function validate6301QueryResult(
	result: unknown,
	expectedPayOrdId?: string,
): LegacyFsiSettlementQuery {
	const infno = "6301" as const;
	const payload = unwrapLegacyFsiData(result, infno);
	const payOrdId = requiredText(payload, "payOrdId", infno);
	if (expectedPayOrdId !== undefined && payOrdId !== expectedPayOrdId) {
		contractError(infno, "response payOrdId does not match the request order");
	}
	const ordStas = requiredText(payload, "ordStas", infno);
	const rawSetlType = payload.setlType;
	if (rawSetlType !== undefined && rawSetlType !== "") {
		if (
			!(["ALL", "CASH", "HI"] as const).includes(
				rawSetlType as "ALL" | "CASH" | "HI",
			)
		) {
			contractError(infno, "setlType must be ALL, CASH or HI");
		}
	}

	const finalStatuses = new Set(["3", "4", "5", "6"]);
	if (!finalStatuses.has(ordStas)) {
		return {
			payOrdId,
			ordStas,
			...(rawSetlType
				? { setlType: rawSetlType as "ALL" | "CASH" | "HI" }
				: {}),
		};
	}

	const settlement = validate6301Settlement(payload, expectedPayOrdId);
	return {
		payOrdId: settlement.payOrdId,
		ordStas: settlement.ordStas,
		amounts: {
			totalFen: settlement.totalFen,
			cashFen: settlement.cashFen,
			personalAccountFen: settlement.personalAccountFen,
			fundFen: settlement.fundFen,
		},
		...(rawSetlType ? { setlType: rawSetlType as "ALL" | "CASH" | "HI" } : {}),
	};
}

function validateRequiredFields(
	payload: Record<string, unknown>,
	fields: readonly string[],
	infno: LegacyFsiInfno,
): void {
	for (const field of fields) requiredText(payload, field, infno);
}

/** 6202 的输入只能使用 6201 返回的凭证，不能由客户端自行拼接。 */
export function validate6202Request(payload: Record<string, unknown>): void {
	validateRequiredFields(
		payload,
		[
			"payAuthNo",
			"payOrdId",
			"payToken",
			"orgCodg",
			"orgBizSer",
			"chrgBchno",
			"feeType",
			"mdtrtId",
		],
		"6202",
	);
	const acctUsedFlag = payload.acctUsedFlag;
	if (
		acctUsedFlag !== undefined &&
		acctUsedFlag !== "" &&
		acctUsedFlag !== "0" &&
		acctUsedFlag !== "1"
	) {
		contractError("6202", "acctUsedFlag must be empty, 0 or 1");
	}
}

/** 6301 查询必须再次提交 6201 凭证和实名字段；它们不能来自 URL。 */
export function validate6301Request(payload: Record<string, unknown>): void {
	validateRequiredFields(
		payload,
		["payOrdId", "orgCodg", "payToken", "idNo", "userName", "idType"],
		"6301",
	);
}

/** 6401 撤销同样只能使用已发放的 provider 订单凭证。 */
export function validate6401Request(payload: Record<string, unknown>): void {
	validateRequiredFields(
		payload,
		["payOrdId", "orgCodg", "payToken", "idNo", "userName", "idType"],
		"6401",
	);
}

export function validate6203Refund(
	payload: Record<string, unknown>,
	original: LegacyFsiAmountBreakdown,
): LegacyFsiRefundAmounts {
	const infno = "6203" as const;
	requiredText(payload, "payOrdId", infno);
	requiredText(payload, "appRefdSn", infno);
	const hasEcToken =
		typeof payload.ecToken === "string" && Boolean(payload.ecToken.trim());
	const hasPayAuthNo =
		typeof payload.payAuthNo === "string" && Boolean(payload.payAuthNo.trim());
	if (hasEcToken === hasPayAuthNo) {
		contractError(infno, "exactly one of ecToken and payAuthNo is required");
	}
	const refundType = requiredText(payload, "refdType", infno).toUpperCase();
	if (!(refundType === "ALL" || refundType === "CASH" || refundType === "HI")) {
		contractError(infno, "refdType must be ALL, CASH or HI");
	}
	const appRefdTime = requiredText(payload, "appRefdTime", infno);
	if (!/^\d{14}$/.test(appRefdTime)) {
		contractError(infno, "appRefdTime must use yyyyMMddHHmmss");
	}
	const totalFen = yuanToFen(payload.totlRefdAmt, "totlRefdAmt", infno);
	const cashFen = yuanToFen(payload.cashRefdAmt, "cashRefdAmt", infno);
	const personalAccountFen = optionalAmount(payload, "psnAcctRefdAmt", infno);
	const fundFen = optionalAmount(payload, "fundRefdAmt", infno);
	const refund = requireExactBreakdown(
		infno,
		totalFen,
		cashFen,
		personalAccountFen,
		fundFen,
	);
	if (totalFen > original.totalFen) {
		contractError(infno, "refund total exceeds the original settlement");
	}
	if (refundType === "ALL") {
		if (
			totalFen !== original.totalFen ||
			cashFen !== original.cashFen ||
			personalAccountFen !== original.personalAccountFen ||
			fundFen !== original.fundFen
		) {
			contractError(
				infno,
				"ALL refund must equal every original settlement component",
			);
		}
	}
	if (
		refundType === "CASH" &&
		(cashFen !== totalFen || personalAccountFen !== 0 || fundFen !== 0)
	) {
		contractError(infno, "CASH refund may contain cash only");
	}
	if (
		refundType === "HI" &&
		(cashFen !== 0 || personalAccountFen + fundFen !== totalFen)
	) {
		contractError(infno, "HI refund may not contain cash");
	}
	if (
		cashFen > original.cashFen ||
		personalAccountFen > original.personalAccountFen ||
		fundFen > original.fundFen
	) {
		contractError(
			infno,
			"refund component exceeds the original settlement component",
		);
	}
	return { ...refund, refdType: refundType };
}

export function validate6203Response(result: unknown): "SUCC" | "FAIL" | "EXP" {
	const infno = "6203" as const;
	const refStatus = requiredText(
		unwrapLegacyFsiData(result, infno),
		"refStatus",
		infno,
	);
	if (refStatus !== "SUCC" && refStatus !== "FAIL" && refStatus !== "EXP") {
		contractError(infno, "refStatus must be SUCC, FAIL or EXP");
	}
	return refStatus;
}

export function validate6401Response(result: unknown): { message: string } {
	const infno = "6401" as const;
	const payload = unwrapLegacyFsiData(result, infno);
	if (payload.success !== true) {
		contractError(infno, "success must be true");
	}
	return { message: requiredText(payload, "message", infno) };
}
