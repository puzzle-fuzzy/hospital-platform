import { PAY_CONFIG, STORAGE_KEYS } from "../config";
import type { CreatedAppointment, Schedule } from "./appointment";
import type { Patient } from "./patient";
import { asRecord, platformRequest, providerRequest } from "./request";
import { ensureSession } from "./session";

export type PaymentProgress =
	| "settling"
	| "paying"
	| "authorizing"
	| "insuring"
	| "polling"
	| "wechat-paying"
	| "success";

export type PendingPayment = {
	businessId: string;
	businessCode: string;
	tradeOrderId: string;
	payingId: string;
	tradingId: string;
	registerId: string;
	patId: string;
	patient: Patient;
	schedule: Schedule;
	appointment: CreatedAppointment;
};

type Progress = (stage: PaymentProgress, message: string) => void;

function text(value: unknown, keys: string[]): string {
	const record = asRecord(value);
	for (const key of keys) {
		const result = String(record[key] ?? "").trim();
		if (result) return result;
	}
	return "";
}

function number(value: unknown, keys: string[]): number {
	const found = findDeep(value, keys);
	const result = Number(found);
	return Number.isFinite(result) ? result : 0;
}

function findDeep(value: unknown, keys: string[]): unknown {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	for (const key of keys)
		if (record[key] !== undefined && record[key] !== null) return record[key];
	for (const child of Object.values(record)) {
		const found = findDeep(child, keys);
		if (found !== undefined) return found;
	}
	return undefined;
}

function required(value: unknown, label: string): string {
	const result = String(value ?? "").trim();
	if (!result) throw new Error(`医保接口未返回 ${label}`);
	return result;
}

function deepText(value: unknown, keys: string[]): string {
	return String(findDeep(value, keys) ?? "").trim();
}

function records(value: unknown): Record<string, any>[] {
	if (Array.isArray(value))
		return value.filter((item): item is Record<string, any> =>
			Boolean(item && typeof item === "object"),
		);
	if (!value || typeof value !== "object") return [];
	const record = value as Record<string, unknown>;
	for (const key of [
		"data",
		"body",
		"list",
		"records",
		"rows",
		"items",
		"result",
	]) {
		const nested = record[key];
		if (Array.isArray(nested)) return records(nested);
		if (nested && typeof nested === "object") {
			const nestedRecords = records(nested);
			if (nestedRecords.length > 0) return nestedRecords;
		}
	}
	return [record as Record<string, any>];
}

function firstRecordDeep(
	value: unknown,
	keys: string[],
	depth = 0,
	visited = new Set<object>(),
): Record<string, any> | null {
	if (!value || typeof value !== "object" || depth > 8) return null;
	const record = value as Record<string, unknown>;
	if (visited.has(record)) return null;
	visited.add(record);
	for (const key of keys) {
		const candidate = record[key];
		if (candidate && typeof candidate === "object" && !Array.isArray(candidate))
			return candidate as Record<string, any>;
	}
	for (const child of Object.values(record)) {
		const nested = firstRecordDeep(child, keys, depth + 1, visited);
		if (nested) return nested;
	}
	return null;
}

function recordText(record: Record<string, any>, keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (value !== undefined && value !== null && String(value).trim())
			return String(value).trim();
	}
	return "";
}

function recordNumber(
	record: Record<string, any>,
	keys: string[],
): number | null {
	const value = recordText(record, keys);
	if (!value) return null;
	const result = Number(value);
	return Number.isFinite(result) ? result : null;
}

function formatDateTime(value = new Date()): string {
	const pad = (input: number) => String(input).padStart(2, "0");
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

function savePending(value: PendingPayment): void {
	wx.setStorageSync(STORAGE_KEYS.pendingPayment, value);
}

export function readPendingPayment(): PendingPayment | null {
	const value = wx.getStorageSync(STORAGE_KEYS.pendingPayment);
	return value && typeof value === "object" ? (value as PendingPayment) : null;
}

export function assertMedicalConfig(): void {
	const missing: string[] = [];
	if (!PAY_CONFIG.medicalCityCode) missing.push("medicalCityCode");
	if (!PAY_CONFIG.medicalChannel) missing.push("medicalChannel");
	if (!PAY_CONFIG.medicalOrgChannelCredential)
		missing.push("medicalOrgChannelCredential");
	if (missing.length > 0)
		throw new Error(`医保机构联调配置不完整：${missing.join("、")}`);
}

function clearPendingPayment(): void {
	wx.removeStorageSync(STORAGE_KEYS.pendingPayment);
}

function readTradeOrderIds(value: unknown): string[] {
	const parsed =
		typeof value === "string"
			? (() => {
					try {
						return JSON.parse(value);
					} catch {
						return value;
					}
				})()
			: value;
	if (!Array.isArray(parsed)) return [];
	return Array.from(
		new Set(
			parsed
				.map((item) => {
					if (item && typeof item === "object") {
						const record = item as Record<string, unknown>;
						return String(
							record.outTradeOrderId ||
								record.out_trade_order_id ||
								record.tradeOrderId ||
								record.trade_order_id ||
								record.id ||
								"",
						).trim();
					}
					return String(item || "").trim();
				})
				.filter(Boolean),
		),
	);
}

function readSettlementAmount(value: unknown): number {
	const data = asRecord(value);
	const outSettleValue = data.outSettle;
	const outSettle =
		outSettleValue && typeof outSettleValue === "object"
			? asRecord(outSettleValue)
			: (() => {
					if (typeof outSettleValue !== "string") return {};
					try {
						return asRecord(JSON.parse(outSettleValue));
					} catch {
						return {};
					}
				})();
	const rawAmount = data.getAmount ?? outSettle.getAmount;
	const amount = Number(rawAmount);
	if (!Number.isFinite(amount) || amount < 0)
		throw new Error("医保结算接口未返回有效挂号金额");
	return amount;
}

function formatQueryDateTime(value: Date): string {
	return formatDateTime(value);
}

async function loadChildPaymentRecords(
	pending: PendingPayment,
): Promise<Record<string, any>[]> {
	const end = new Date();
	const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
	const response = await providerRequest<unknown>({
		path: "/msun-middle-open-settlepay/v1/outpatient-payments/outpatient-child-payment-records",
		query: {
			patId: pending.patId,
			startTime: formatQueryDateTime(start),
			endTime: formatQueryDateTime(end),
			tradeStatus: 1,
			authSysCode: PAY_CONFIG.authSysCode,
		},
	});
	return records(response);
}

function resolveAcctUsedFlag(
	insuplcAdmdvs: string,
	childPaymentRecords: Record<string, any>[],
): "" | "0" {
	const codes = new Set(
		childPaymentRecords
			.map((item) => recordText(item, ["insurMedCode"]))
			.filter(Boolean),
	);
	const matchesSpecialRule =
		codes.has("011102020010000") &&
		!(codes.has("011102020010001") && codes.has("011102020010002"));
	return String(insuplcAdmdvs).trim() === "140581" && matchesSpecialRule
		? "0"
		: "";
}

function buildUpDetailList(
	details: Record<string, any>[],
	childPaymentRecords: Record<string, any>[],
): Record<string, any>[] {
	const findChild = (detail: Record<string, any>): Record<string, any> => {
		const orderId = recordText(detail, [
			"outTradeOrderId",
			"outTradeOrderIdList",
		]);
		const chargeId = recordText(detail, ["chargeId"]);
		return (
			childPaymentRecords.find(
				(item) =>
					(orderId && recordText(item, ["outTradeOrderId"]) === orderId) ||
					(chargeId && recordText(item, ["chargeId"]) === chargeId),
			) || {}
		);
	};

	const result = details.map((detail, index) => {
		const child = findChild(detail);
		const outBillId = recordNumber(detail, [
			"outSettleDetailSubId",
			"outSettleDetailId",
		]);
		const item = {
			amount:
				recordNumber(detail, ["amount", "getAmount"]) ??
				recordNumber(child, ["amount"]),
			chargeCode:
				recordText(detail, ["chargeCode", "hisUploadItemCode"]) ||
				recordText(child, ["chargeCode"]),
			chargeId:
				recordNumber(detail, ["chargeId"]) ?? recordNumber(child, ["chargeId"]),
			chargeName:
				recordText(detail, ["chargeName"]) || recordText(child, ["itemName"]),
			networkItemCode:
				recordText(detail, [
					"networkItemCode",
					"medinsurItemCode",
					"nationalMedicalInsuranceCode",
				]) || recordText(child, ["insurMedCode"]),
			networkItemName:
				recordText(detail, [
					"networkItemName",
					"medinsurItemName",
					"chargeName",
				]) || recordText(child, ["itemName"]),
			orderId:
				recordNumber(detail, ["orderId", "outDocOrderId"]) ??
				recordNumber(child, ["orderId"]),
			outBillId,
			price: recordNumber(detail, ["price"]) ?? recordNumber(child, ["price"]),
			quantity:
				recordNumber(detail, ["quantity"]) ?? recordNumber(child, ["quantity"]),
			selfBurdenRatio:
				recordNumber(detail, ["selfBurdenRatio"]) ??
				recordNumber(child, ["selfBurdenRatio"]),
			createTime:
				recordText(detail, ["createTime"]) ||
				recordText(child, ["hisCreateTime", "billDate"]),
			outSettleDetailId: outBillId,
			unit:
				recordText(detail, ["unit", "unitName"]) ||
				recordText(child, ["unitName"]),
			spec: recordText(detail, ["spec"]) || recordText(child, ["spec"]),
		};
		const missing = [
			"amount",
			"chargeCode",
			"chargeId",
			"chargeName",
			"networkItemCode",
			"networkItemName",
			"orderId",
			"outBillId",
			"price",
			"quantity",
			"selfBurdenRatio",
			"createTime",
		].filter(
			(field) =>
				(item as Record<string, unknown>)[field] == null ||
				(item as Record<string, unknown>)[field] === "",
		);
		if (missing.length > 0)
			throw new Error(`医保结算明细缺少字段：${missing.join("、")}`);
		return item;
	});
	if (result.length === 0) throw new Error("医保结算明细不能为空");
	return result;
}

function readPaymentIds(value: unknown): {
	payingId: string;
	tradingId: string;
} {
	const record = asRecord(
		findDeep(value, ["payRecord", "pay_record"]) || value,
	);
	return {
		payingId: required(findDeep(record, ["payingId", "paying_id"]), "payingId"),
		tradingId: required(
			findDeep(record, ["tradingId", "trading_id"]),
			"tradingId",
		),
	};
}

function readInsuranceStatus(value: unknown): {
	ordStas: string;
	completed: boolean;
	failed: boolean;
} {
	const ordStas = String(
		findDeep(value, ["ordStas", "ord_stas", "orderStatus"]) || "",
	).trim();
	return {
		ordStas,
		completed: ["3", "4", "5", "6"].includes(ordStas),
		failed: ["7", "8", "9", "10", "11", "12", "13", "14", "15", "16"].includes(
			ordStas,
		),
	};
}

function readFinalSuccess(value: unknown): boolean {
	const found = findDeep(value, ["isSettle", "is_settle", "finalSuccess"]);
	return found === true || ["1", "true", "SUCCESS"].includes(String(found));
}

async function cleanupSettlement(
	businessId: string,
	payingId: string,
): Promise<void> {
	let closeSucceeded = !payingId;
	if (payingId) {
		try {
			await providerRequest<unknown>({
				path: "/msun-middle-open-settlepay/api/v2/open/payment/pay-close",
				method: "POST",
				contentType: "application/json",
				data: {
					authSysCode: PAY_CONFIG.authSysCode,
					autoSettle: 3,
					businessId,
					payingId,
					tradeTypeCode: PAY_CONFIG.tradeTypeCode,
					workStationId: "",
				},
			});
			closeSucceeded = true;
		} catch {
			closeSucceeded = false;
		}
	}
	if (closeSucceeded) {
		try {
			await providerRequest<unknown>({
				path: "/msun-middle-open-settlepay/api/v2/open/settle/cancel-settle",
				method: "POST",
				contentType: "application/json",
				data: {
					authSysCode: PAY_CONFIG.authSysCode,
					businessId,
					tradeTypeCode: PAY_CONFIG.tradeTypeCode,
					workStationId: "",
				},
			});
		} catch {
			// 清理失败不覆盖原始业务错误；订单由后台按 businessId 继续处理。
		}
	}
}

export async function startMedicalPayment(
	appointment: CreatedAppointment,
	patient: Patient,
	schedule: Schedule,
	onProgress: Progress,
): Promise<PendingPayment> {
	const registerId = required(
		appointment.registerId || appointment.hisRegisterId,
		"registerId",
	);
	let businessId = "";
	let payingId = "";
	try {
		onProgress("settling", "正在创建医保结算订单");
		const settleResponse = await providerRequest<unknown>({
			path: "/msun-middle-open-settlepay/api/v2/open/settle/apply-pay-settle",
			method: "POST",
			contentType: "application/json",
			data: {
				authSysCode: PAY_CONFIG.authSysCode,
				appCode: PAY_CONFIG.appCode,
				autoSettle: "2",
				hospitalId: PAY_CONFIG.hospitalId,
				patId: patient.patId,
				requestId: Date.now(),
				requestParam: {
					registerId,
					registerSource: PAY_CONFIG.registrationSource,
					settleWay: PAY_CONFIG.settleWay,
				},
				sceneCode: PAY_CONFIG.sceneCode,
				paySceneCode: PAY_CONFIG.sceneCode,
				tradeTypeCode: PAY_CONFIG.tradeTypeCode,
				workStationId: "",
			},
		});
		businessId = required(
			findDeep(settleResponse, ["businessId", "business_id"]),
			"businessId",
		);
		const businessCode = required(
			findDeep(settleResponse, ["businessCode", "business_code"]),
			"businessCode",
		);
		const tradeOrderValue = findDeep(settleResponse, [
			"tradeOrderIdList",
			"trade_order_id_list",
		]);
		const tradeOrderId = readTradeOrderIds(tradeOrderValue)[0] || "";
		const settlementAmount = readSettlementAmount(settleResponse);

		onProgress("paying", "正在发起医保支付");
		const preOrderResponse = await providerRequest<unknown>({
			path: "/msun-middle-open-settlepay/api/v2/open/payment/pre-order",
			method: "POST",
			contentType: "application/json",
			data: {
				appCode: PAY_CONFIG.appCode,
				authSysCode: PAY_CONFIG.authSysCode,
				autoSettle: 3,
				body: "预约挂号医保支付",
				businessId,
				expire: 20,
				hospitalId: PAY_CONFIG.hospitalId,
				notifyUrl: "",
				payModel: "H5",
				payTypeId: 2,
				payTypeParams: [{ payTypeId: 2, amount: 0 }],
				total: settlementAmount,
				tradeCode: businessCode,
				tradeTypeCode: PAY_CONFIG.tradeTypeCode,
				workStationId: "",
				requestId: Date.now(),
				sceneCode: PAY_CONFIG.sceneCode,
			},
		});
		const ids = readPaymentIds(preOrderResponse);
		payingId = ids.payingId;
		const pending: PendingPayment = {
			businessId,
			businessCode,
			tradeOrderId,
			payingId: ids.payingId,
			tradingId: ids.tradingId,
			registerId,
			patId: patient.patId,
			patient,
			schedule,
			appointment,
		};
		savePending(pending);
		onProgress("authorizing", "请在医保小程序完成授权");
		await navigateToMedicalAuth();
		return pending;
	} catch (error) {
		if (businessId) {
			await cleanupSettlement(businessId, payingId);
			clearPendingPayment();
		}
		throw error;
	}
}

export async function navigateToMedicalAuth(): Promise<void> {
	assertMedicalConfig();
	const path = `auth/pages/bindcard/auth/index?openType=getAuthCode&cityCode=${encodeURIComponent(PAY_CONFIG.medicalCityCode)}&channel=${encodeURIComponent(PAY_CONFIG.medicalChannel)}&sourceapp=${encodeURIComponent(PAY_CONFIG.medicalSourceApp)}&orgChnlCrtfCodg=${encodeURIComponent(PAY_CONFIG.medicalOrgChannelCredential)}&orgCodg=${encodeURIComponent(PAY_CONFIG.medicalOrgCode)}&bizType=${encodeURIComponent(PAY_CONFIG.medicalBizType)}&orgAppId=${encodeURIComponent(PAY_CONFIG.medicalOrgAppId)}`;
	await new Promise<void>((resolve, reject) => {
		wx.navigateToMiniProgram({
			appId: PAY_CONFIG.medicalAppId,
			path,
			envVersion: PAY_CONFIG.medicalEnvVersion,
			success: () => resolve(),
			fail: reject,
		});
	});
}

function read1101(value: unknown): {
	baseInfo: Record<string, any>;
	insuInfo: Record<string, any>;
} {
	const output = asRecord(findDeep(value, ["output"]) || value);
	const baseInfo = records(output.baseinfo || output.baseInfo)[0] || {};
	const insuRecords = records(output.insuinfo || output.insuInfo);
	const insuInfo =
		insuRecords.find(
			(item) =>
				text(item, ["insutype", "insuType"]) === PAY_CONFIG.medicalInsutype,
		) ||
		insuRecords[0] ||
		{};
	return { baseInfo, insuInfo };
}

function mapFeeDetails(
	details: Record<string, any>[],
	psnNo: string,
	chrgBchno: string,
	schedule: Schedule,
): Record<string, any>[] {
	return details.map((detail, index) => {
		const code = text(detail, [
			"insurMedCode",
			"medListCodg",
			"networkItemCode",
			"medInsuranceCode",
		]);
		if (!code) throw new Error("挂号费用缺少医保项目编码，已停止调用 6201");
		const amount = number(detail, [
			"amount",
			"fee",
			"detItemFeeSumamt",
			"price",
		]);
		return {
			feedetlSn: String(index + 1),
			psnNo,
			chrgBchno,
			rxCircFlag: "0",
			feeOcurTime:
				text(detail, ["createTime", "feeOcurTime"]) || formatDateTime(),
			medListCodg: code,
			medinsListCodg: code,
			detItemFeeSumamt: amount,
			cnt: 1,
			pric: amount,
			bilgDeptCodg: schedule.deptCode,
			bilgDeptName: schedule.deptName,
			bilgDrCodg: schedule.docCode,
			bilgDrName: schedule.docName,
			hospApprFlag: "1",
			medType: "11",
			medListName:
				text(detail, ["costName", "medListName", "name"]) || "预约挂号费",
			medListSpc: "",
		};
	});
}

export async function continueMedicalPayment(
	authCode: string,
	pending: PendingPayment,
	onProgress: Progress,
): Promise<void> {
	let safeToCleanup = true;
	try {
		const session = await ensureSession();
		onProgress("insuring", "正在核验医保授权");
		const authResponse = await platformRequest<unknown>({
			path: "/common/mip-user-query",
			method: "POST",
			contentType: "application/json",
			data: { qrcode: authCode, openid: session.openid },
		});
		const payAuthNo = required(
			findDeep(authResponse, [
				"pay_auth_no",
				"payAuthNo",
				"family_pay_auth_no",
			]),
			"pay_auth_no",
		);

		const basicResponse = await platformRequest<unknown>({
			path: "/common/mbs-fsi/1101",
			method: "POST",
			contentType: "application/json",
			data: {
				mdtrt_cert_type: "01",
				mdtrt_cert_no: payAuthNo,
				card_sn: "",
				begntime: formatDateTime(),
				psn_cert_type: "01",
				certno: pending.patient.idNo,
				psn_name: pending.patient.name,
			},
		});
		const { baseInfo, insuInfo } = read1101(basicResponse);
		const psnNo = required(
			deepText(insuInfo, ["psn_no", "psnNo"]) ||
				deepText(baseInfo, ["psn_no", "psnNo"]),
			"psnNo",
		);
		const insuplcAdmdvs = required(
			deepText(insuInfo, ["insuplc_admdvs", "insuplcAdmdvs"]) ||
				deepText(baseInfo, ["insuplc_admdvs", "insuplcAdmdvs"]),
			"insuplcAdmdvs",
		);
		const ecToken = required(
			deepText(baseInfo, ["ecToken", "ec_token", "token"]) ||
				deepText(insuInfo, ["ecToken", "ec_token", "token"]) ||
				deepText(authResponse, ["ecToken", "ec_token"]),
			"ecToken",
		);

		const settleInfoResponse = await providerRequest<unknown>({
			path: "/msun-yb-app-miop/v1/out-insur-settle-infos",
			query: { patId: pending.patId, outSettleMainId: pending.businessId },
		});
		const settleInfo = asRecord(settleInfoResponse);
		const details = records(
			settleInfo.outSettleDetailList ||
				findDeep(settleInfo, ["outSettleDetailList"]),
		);
		if (details.length === 0) throw new Error("未获取到挂号医保费用明细");
		const firstDetail = details[0] || {};
		const chrgBchno =
			text(firstDetail, ["chrgBchno", "chargeBatchNo"]) ||
			pending.registerId ||
			pending.businessId;
		const medOrgOrd = pending.tradeOrderId || chrgBchno;
		const deptInfoResponse = await providerRequest<unknown>({
			path: "/msun-middle-base-common/v1/depts",
			query: { deptId: pending.schedule.deptId, invalidFlag: 0 },
		});
		const deptInfo = records(deptInfoResponse)[0] || {};
		const caty = required(
			text(deptInfo, ["nationalDeptInsuranceCode"]),
			"caty",
		);
		const doctorResponse = await providerRequest<unknown>({
			path: "/msun-middle-base-common/v1/users",
			query: { userCode: pending.schedule.docCode },
		});
		const doctorInfo = records(doctorResponse)[0] || {};
		const doctorMedicalCode = required(
			text(doctorInfo, ["medicalInsuranceCode"]),
			"医保医师编码",
		);
		const feedetailList: Record<string, any>[] = mapFeeDetails(
			details,
			psnNo,
			chrgBchno,
			pending.schedule,
		).map((item) => ({ ...item, bilgDrCodg: doctorMedicalCode }));

		const feeTotal = Number(
			feedetailList
				.reduce((total, item) => total + Number(item.detItemFeeSumamt || 0), 0)
				.toFixed(2),
		);
		const settle6201 = await platformRequest<unknown>({
			path: "/common/mbs-fsi/6201",
			method: "POST",
			contentType: "application/json",
			data: {
				mdtrtCertType: "01",
				chrgBchno,
				iptOtpNo: medOrgOrd,
				psnNo,
				idNo: pending.patient.idNo,
				idType: "01",
				begntime: formatDateTime(),
				feedetailList,
				acctUsedFlag: "1",
				insutype: PAY_CONFIG.medicalInsutype,
				feeType: "01",
				psnSetlway: "01",
				medType: "11",
				uldLatlnt: "0,0",
				medfeeSumamt: feeTotal,
				insuCode: PAY_CONFIG.medicalInsuCode,
				orgCodg: PAY_CONFIG.medicalOrgCode,
				insuplcAdmdvs,
				medOrgOrd,
				userName: pending.patient.name,
				payAuthNo,
				deptName: pending.schedule.deptName,
				deptCode: pending.schedule.deptCode,
				caty,
				ecToken,
				diseCodg: "",
				diseName: "",
				diseinfoList: [
					{
						diagType: "1",
						diagSrtNo: 1,
						diagCode: "Z00.001",
						diagName: "健康查体",
						diagDept: pending.schedule.deptCode,
						diseDorNo: doctorMedicalCode,
						diseDorName: pending.schedule.docName,
						diagTime: formatDateTime(),
						valiFlag: "1",
					},
				],
				pubHospRfomFlag: "1",
			},
		});
		const payOrdId = required(
			findDeep(settle6201, ["payOrdId", "pay_ord_id", "payOrderId"]),
			"payOrdId",
		);
		const payToken = required(
			findDeep(settle6201, ["payToken", "pay_token"]),
			"payToken",
		);
		const mdtrtId = required(
			findDeep(settle6201, ["mdtrtId", "mdtrt_id"]),
			"mdtrtId",
		);
		const childPaymentRecords = await loadChildPaymentRecords(pending);
		const acctUsedFlag = resolveAcctUsedFlag(
			insuplcAdmdvs,
			childPaymentRecords,
		);

		// 6202 一旦发出，远端订单可能已经扣款或进入异步处理中，后续不再自动关单。
		safeToCleanup = false;
		const settle6202 = await platformRequest<unknown>({
			path: "/common/mbs-fsi/6202",
			method: "POST",
			contentType: "application/json",
			data: {
				payAuthNo,
				payOrdId,
				payToken,
				orgCodg: PAY_CONFIG.medicalOrgCode,
				orgBizSer: `BIZ${Date.now()}`,
				chrgBchno,
				feeType: "01",
				mdtrtId,
				acctUsedFlag,
			},
		});
		const ownPayAmt = number(settle6202, [
			"ownPayAmt",
			"own_pay_amt",
			"wechatPayCashFee",
		]);
		const statusParams = {
			payOrdId,
			orgCodg: PAY_CONFIG.medicalOrgCode,
			payToken,
			idNo: pending.patient.idNo,
			userName: pending.patient.name,
			idType: "01",
		};
		let status = readInsuranceStatus(settle6202);
		for (
			let index = 0;
			!status.completed &&
			!status.failed &&
			index <= PAY_CONFIG.insurancePollDelaysMs.length;
			index += 1
		) {
			if (index > 0)
				await new Promise((resolve) =>
					setTimeout(
						resolve,
						PAY_CONFIG.insurancePollDelaysMs[index - 1] || 1_500,
					),
				);
			onProgress("polling", `正在确认医保结算结果（${index + 1}）`);
			const queryResponse = await platformRequest<unknown>({
				path: "/common/mbs-fsi/6301",
				method: "POST",
				contentType: "application/json",
				data: statusParams,
			});
			status = readInsuranceStatus(queryResponse);
		}
		if (status.failed)
			throw new Error(`医保订单结算失败（ordStas=${status.ordStas}）`);
		if (!status.completed)
			throw new Error("医保订单仍在处理中，请稍后点击继续医保支付");

		if (ownPayAmt > 0) {
			await paySelfPart({
				pending,
				payOrdId,
				payAuthNo,
				ownPayAmt,
				psnNo,
				onProgress,
			});
		} else {
			onProgress("insuring", "医保已完成，正在回写医院结算");
			const finalResponse = await platformRequest<unknown>({
				path: "/common/yunhealth/registration/medical-settlement-complete",
				method: "POST",
				contentType: "application/json",
				data: buildCompletePayload(
					pending,
					settle6202,
					details,
					settleInfo,
					insuInfo,
					childPaymentRecords,
					insuplcAdmdvs,
					payAuthNo,
					psnNo,
				),
			});
			if (!readFinalSuccess(finalResponse))
				throw new Error("医保已返回，但医院最终结算尚未确认");
		}
		clearPendingPayment();
		wx.setStorageSync(STORAGE_KEYS.lastResult, {
			appointmentInfoId: pending.appointment.appointmentInfoId,
			completedAt: Date.now(),
		});
		onProgress("success", "挂号和医保支付成功");
	} catch (error) {
		if (safeToCleanup) {
			await cleanupSettlement(pending.businessId, pending.payingId);
			clearPendingPayment();
		}
		throw error;
	}
}

function buildCompletePayload(
	pending: PendingPayment,
	settle6202: unknown,
	details: Record<string, any>[],
	settleInfo: Record<string, any>,
	insuInfo: Record<string, any>,
	childPaymentRecords: Record<string, any>[],
	insuplcAdmdvs: string,
	payAuthNo: string,
	psnNo: string,
): Record<string, any> {
	const main = firstRecordDeep(settle6202, [
		"outNetworkSettleMain",
		"out_network_settle_main",
	]);
	if (!main) throw new Error("医保结算结果缺少 outNetworkSettleMain");
	const upDetailList = buildUpDetailList(details, childPaymentRecords);
	const nationalUpDetailList = records(
		findDeep(settleInfo, ["nationalUpDetailList", "national_up_detail_list"]),
	);
	const outSettlePat = asRecord(
		findDeep(settleInfo, ["outSettlePat", "out_settle_pat"]),
	);
	const outPatId = recordNumber(outSettlePat, ["patId"]);
	return {
		outSettleMainId: pending.businessId,
		patId: pending.patId,
		payingId: pending.payingId,
		tradingId: pending.tradingId,
		notifyPayload: {
			hospitalId: PAY_CONFIG.hospitalId,
			nationalUpDetailList,
			networkRegister: {
				cantonCode: insuplcAdmdvs,
				cardNo: payAuthNo,
				companyName: text(insuInfo, ["emp_name", "empName"]),
				idNo: pending.patient.idNo,
				insuType: PAY_CONFIG.medicalInsutype,
				memberNo: psnNo,
				netPatName: pending.patient.name,
				netPatType: text(insuInfo, ["psn_type", "psnType"]),
				...(outPatId == null ? {} : { outPatId }),
				regFlag: "1",
			},
			outNetworkSettleMain: { ...main, transId: pending.payingId },
			outSettleMainId: pending.businessId,
			patId: pending.patId,
			tradingId: pending.tradingId,
			upDetailList,
		},
	};
}

async function paySelfPart(args: {
	pending: PendingPayment;
	payOrdId: string;
	payAuthNo: string;
	ownPayAmt: number;
	psnNo: string;
	onProgress: Progress;
}): Promise<void> {
	if (
		!PAY_CONFIG.pluginPayType ||
		!["CREDIT", "POS", "CROWD_FUNDING"].includes(PAY_CONFIG.pluginPayType)
	) {
		throw new Error("医保结果包含微信自费，请先配置 pluginPayType");
	}
	args.onProgress(
		"paying",
		`医保完成，正在创建自费支付（${args.ownPayAmt.toFixed(2)} 元）`,
	);
	const preOrderResponse = await providerRequest<unknown>({
		path: "/msun-middle-open-settlepay/api/v2/open/payment/pre-order",
		method: "POST",
		contentType: "application/json",
		data: {
			appCode: PAY_CONFIG.appCode,
			authSysCode: PAY_CONFIG.authSysCode,
			autoSettle: 3,
			body: "预约挂号医保自费插件支付",
			businessId: args.pending.businessId,
			expire: 20,
			hospitalId: PAY_CONFIG.hospitalId,
			notifyUrl: "",
			payModel: "H5",
			payTypeId: 50,
			payTypeParams: [{ payTypeId: 50, amount: args.ownPayAmt }],
			total: args.ownPayAmt,
			tradeCode: args.pending.businessCode,
			tradeTypeCode: PAY_CONFIG.tradeTypeCode,
			workStationId: PAY_CONFIG.pluginWorkStationId,
			requestId: Date.now(),
			sceneCode: PAY_CONFIG.sceneCode,
		},
	});
	const ids = readPaymentIds(preOrderResponse);
	const session = await ensureSession();
	const orderResponse = await platformRequest<unknown>({
		path: "/common/yunhealth/registration/plugin-payment-order",
		method: "POST",
		contentType: "application/json",
		data: {
			payOrdId: args.payOrdId,
			businessId: args.pending.businessId,
			tradeCode: args.pending.businessCode,
			patId: Number(args.pending.patId),
			hospitalId: PAY_CONFIG.hospitalId,
			certNo: args.pending.patient.idNo,
			psnCertType: "01",
			psnName: args.pending.patient.name,
			psnNo: args.psnNo,
			tradeTypeCode: PAY_CONFIG.tradeTypeCode,
			patInHosId: 0,
			payAuthNo: args.payAuthNo,
			payingId: ids.payingId,
			tradingId: ids.tradingId,
			payTypeId: "50",
			payType: PAY_CONFIG.pluginPayType,
			workStationId: PAY_CONFIG.pluginWorkStationId,
			openid: session.openid,
		},
	});
	const params = asRecord(findDeep(orderResponse, ["pay_params", "payParams"]));
	if (
		!params.timeStamp ||
		!params.nonceStr ||
		!params.package ||
		!params.paySign
	)
		throw new Error("自费支付未返回完整微信支付参数");
	args.onProgress("wechat-paying", "请完成微信自费支付");
	await new Promise<void>((resolve, reject) => {
		wx.requestPayment({
			timeStamp: String(params.timeStamp),
			nonceStr: String(params.nonceStr),
			package: String(params.package),
			signType: String(params.signType || "RSA") as
				| "HMAC-SHA256"
				| "MD5"
				| "RSA",
			paySign: String(params.paySign),
			success: () => resolve(),
			fail: reject,
		});
	});
	const finalResponse = await platformRequest<unknown>({
		path: "/common/yunhealth/registration/plugin-payment-complete",
		method: "POST",
		contentType: "application/json",
		data: {
			payOrdId: args.payOrdId,
			businessId: args.pending.businessId,
			patId: args.pending.patId,
			hospitalId: PAY_CONFIG.hospitalId,
			certNo: args.pending.patient.idNo,
			psnCertType: "01",
			psnName: args.pending.patient.name,
			psnNo: args.psnNo,
			tradeTypeCode: PAY_CONFIG.tradeTypeCode,
			workStationId: PAY_CONFIG.pluginWorkStationId,
			patInHosId: 0,
		},
	});
	if (!readFinalSuccess(finalResponse))
		throw new Error("自费支付已返回，但医院最终结算尚未确认");
}
