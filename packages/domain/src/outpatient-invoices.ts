import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 2.6.29 交款人类型：个人或单位。 */
export type OutpatientElectronicInvoicePayerType = "1" | "2";

/** 2.6.29 操作类型：患者智能服务、互联网医院或自助机。 */
export type OutpatientElectronicInvoiceOperatorType = 0 | 1 | 2;

/** 2.6.29 返回的电子票据资源和院内关联标识。 */
export type OutpatientElectronicInvoice = {
	/** 电子票据代码。 */
	billBatchCode?: string;
	/** 电子票据号码。 */
	billNo?: string;
	/** 电子票据二维码图片数据，可能是 Base64。 */
	billQrCode?: string;
	/** 电子票据生成时间。 */
	createTime?: string;
	hospitalId?: string;
	/** 未作废为 0，已作废为 1。 */
	invalidFlag?: string;
	outElectronicInvoiceId?: string;
	outInvoiceMainId?: string;
	outSettleMainId?: string;
	/** 可能是 -1、H5 URL 或 Base64，不能假设一定是 URL。 */
	pictureNetUrl?: string;
	/** 可能是 -1、H5 URL 或 Base64，不能假设一定是 URL。 */
	pictureUrl?: string;
	/** 电子校验码。 */
	random?: string;
};

/** 2.6.17 查询到的服务端发票事实；Provider 主键只在 API/adapter 内部流转。 */
export type OutpatientElectronicInvoiceRecord = {
	outInvoiceMainId: string;
	outSettleMainId: string;
	invoiceCode?: string;
	invoiceTime?: string;
	amountFen?: number;
	billBatchCode?: string;
	billNo?: string;
	random?: string;
	pictureNetUrl?: string;
	pictureUrl?: string;
};

/** 2.6.17 门诊发票信息查询网关。 */
export interface OutpatientElectronicInvoiceQueryGateway {
	listRecords(
		input: {
			providerPatientId: string;
			startTime: string;
			endTime: string;
			settleStatus?: "4" | "5";
			pageNum?: number;
			pageSize?: number;
		},
		context: AdapterCallContext,
	): Promise<{
		records: readonly OutpatientElectronicInvoiceRecord[];
		trace: ExternalTrace;
	}>;
}

/**
 * 门诊电子发票写入网关。
 *
 * 该端口故意不复用门诊费用只读网关，也不接受小程序提交的 Provider
 * 发票/结算主键；调用方必须在服务端完成账单归属和 ID 解析后才能调用。
 */
export interface OutpatientElectronicInvoiceGateway {
	issue(
		input: {
			invoiceMainId: string;
			outSettleMainId: string;
			payerType: OutpatientElectronicInvoicePayerType;
		},
		context: AdapterCallContext,
	): Promise<{
		invoice: OutpatientElectronicInvoice;
		trace: ExternalTrace;
	}>;
}

/** 只读票据资源；不返回、执行或转发医院的 HTML 页面。 */
export type OutpatientElectronicInvoiceResourceContent = {
	body: Uint8Array;
	contentType: "image/png" | "image/jpeg" | "application/pdf";
};

/** 输入资源必须来自服务端本次按患者归属重新查询的医院票据记录。 */
export interface OutpatientElectronicInvoiceResourceGateway {
	fetchResource(
		input: Pick<
			OutpatientElectronicInvoiceRecord,
			"pictureNetUrl" | "pictureUrl"
		>,
		context: AdapterCallContext,
	): Promise<OutpatientElectronicInvoiceResourceContent>;
}
