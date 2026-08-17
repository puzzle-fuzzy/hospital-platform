import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 门诊费用列表只表达查询状态，不把 provider 数字状态码带到客户端。 */
export type OutpatientPaymentStatus = "unpaid" | "paid";

/**
 * 门诊费用查询状态的运行时边界错误。
 *
 * TypeScript 只能约束编译期调用方；HTTP 解析器之外的任务、测试或未来模块
 * 仍可能在运行时传入任意字符串。状态一旦越过领域边界，就可能被错误解释为
 * Provider 的“已支付”查询，因此必须在领域层显式拒绝，而不是依赖类型断言。
 */
export class InvalidOutpatientPaymentStatusError extends Error {
	constructor() {
		super("Invalid outpatient payment status");
		this.name = "InvalidOutpatientPaymentStatusError";
	}
}

/** 供 API、service 和 adapter 共用的门诊费用状态运行时守卫。 */
export function isOutpatientPaymentStatus(
	value: unknown,
): value is OutpatientPaymentStatus {
	return value === "unpaid" || value === "paid";
}

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
