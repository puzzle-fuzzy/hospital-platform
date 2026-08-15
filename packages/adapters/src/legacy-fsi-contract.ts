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

export class LegacyFsiContractError extends Error {
	readonly infno: LegacyFsiInfno;

	constructor(infno: LegacyFsiInfno, message: string) {
		super(`Legacy FSI ${infno} contract violation: ${message}`);
		this.name = "LegacyFsiContractError";
		this.infno = infno;
	}
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
