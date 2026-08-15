import type { AdapterCallContext, ExternalTrace } from "./ports";

/** 当前已取得安全查询边界的报告来源；体检报告需要额外身份证合同，暂不纳入。 */
export type ReportKind = "laboratory" | "imaging" | "ecg";

/** 报告目录只返回患者端需要的最小摘要，不把 provider 原始报文带出 adapter。 */
export type ReportSummary = {
	kind: ReportKind;
	title: string;
	reportedAt: string;
	status: "available" | "abnormal";
	hasAttachment: boolean;
};

export type ReportDirectoryQuery = {
	startDate: string;
	endDate: string;
	kind?: ReportKind;
};

/** 服务端先解析 provider 患者号，再把受限引用交给报告 adapter。 */
export type ReportDirectoryInput = {
	providerPatientId: string;
	query: ReportDirectoryQuery;
};

/** 报告目录只读端口；详情、解读和下载必须另行取得 provider 合同。 */
export interface ReportDirectoryGateway {
	listReports(
		input: ReportDirectoryInput,
		context: AdapterCallContext,
	): Promise<{
		reports: readonly ReportSummary[];
		trace: ExternalTrace;
	}>;
}
