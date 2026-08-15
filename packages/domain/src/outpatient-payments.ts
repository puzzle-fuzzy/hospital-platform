import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 门诊费用列表只表达查询状态，不把 provider 数字状态码带到客户端。 */
export type OutpatientPaymentStatus = "unpaid" | "paid";

/** 门诊费用展示模型；金额统一为人民币分，provider 订单号不进入该模型。 */
export type OutpatientPaymentRecord = {
	recordId: string;
	status: OutpatientPaymentStatus;
	departmentName?: string;
	doctorName?: string;
	billDate: string;
	amountFen: number;
};

/** 门诊费用 provider 只读网关；写入、医保和微信支付另建独立 contract。 */
export interface OutpatientPaymentGateway {
	listRecords(
		input: {
			providerPatientId: string;
			startTime: string;
			endTime: string;
			status: OutpatientPaymentStatus;
			authSysCode: string;
		},
		context: AdapterCallContext,
	): Promise<{
		records: readonly OutpatientPaymentRecord[];
		trace: ExternalTrace;
	}>;
}
