import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	InfoCircleOutlined,
	ReloadOutlined,
	RollbackOutlined,
	WarningOutlined,
} from "@ant-design/icons";
import type { TableProps } from "antd";
import {
	Alert,
	App as AntdApp,
	Button,
	Card,
	Collapse,
	Descriptions,
	Empty,
	Flex,
	Input,
	Modal,
	Select,
	Space,
	Spin,
	Statistic,
	Table,
	Tag,
	Timeline,
	Tooltip,
	Typography,
} from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatAdminTime as formatTime } from "./admin-time";
import {
	ApiError,
	cancelRegistration,
	fetchPaymentDay,
	fetchPaymentInterface,
	fetchPaymentOperationDetail,
	fetchPaymentSyncTasks,
	fetchRegistrationStatus,
	fetchWechatRefundPaymentHistory,
	isReadOnlySession,
	markPaymentSyncTaskManualReview,
	queryMedicalInsuranceRefund,
	queryPaymentRefund,
	queryWechatRefund,
	requestPaymentRefund,
	retryPaymentSyncTask,
} from "./api";
import { paymentAmountLines } from "./payment-amount-display";
import {
	hasRefundReceipt,
	PAYMENT_REFUND_LABELS,
	PAYMENT_REFUND_TYPES,
	paymentRefundKey,
	paymentRefundLabel,
	paymentRefundOption,
	paymentRefundPreview,
	registrationRefundFeedback,
} from "./payment-refund-options";
import {
	canCancelRegistration,
	cancellationAttemptStorageKey,
	type RegistrationCancellationAttempt,
	readCancellationAttempt,
	registrationPaymentLabel,
	registrationStatusLabel,
	validCancellationReason,
} from "./registration-display";
import type {
	AdminMedicalInsuranceRefund,
	AdminPaymentOperationDetail,
	AdminPaymentRefundResult,
	AdminPaymentRefundType,
	AdminPaymentSyncTask,
	AdminRegistrationStatus,
	AdminWechatRefundPaymentHistoryPage,
	AdminWechatRefundPaymentRecord,
	PaymentDayResult,
	PaymentFlowSummary,
	PaymentInterfaceDetail,
	PaymentInterfaceSummary,
	PaymentStatus,
	RawLogEntry,
	Session,
	WechatRefundSource,
} from "./types";

const { Text, Title } = Typography;

function todayInShanghai(): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

function statusText(status: PaymentStatus): string {
	return {
		CANCELLED: "已取消",
		MANUAL_REVIEW_REQUIRED: "需人工复核",
		PROVIDER_COMPLETED: "Provider 已完成",
		OBSERVED: "已观测",
		INCOMPLETE: "链路不完整",
	}[status];
}

function statusColor(status: PaymentStatus): string {
	return {
		CANCELLED: "default",
		MANUAL_REVIEW_REQUIRED: "warning",
		PROVIDER_COMPLETED: "success",
		OBSERVED: "blue",
		INCOMPLETE: "error",
	}[status];
}

function boundaryText(value: PaymentInterfaceSummary["boundary"]): string {
	return {
		"before-day": "前一日边界",
		"within-day": "当天",
		"after-day": "次日边界",
	}[value];
}

function boundaryColor(value: PaymentInterfaceSummary["boundary"]): string {
	return value === "within-day" ? "default" : "orange";
}

function parseJson(value: string | undefined): unknown {
	if (value === undefined || value === "") return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}

function packet(entry: RawLogEntry | undefined): unknown {
	if (!entry) return undefined;
	const body = parseJson(entry.bodyText);
	if (!entry.method && !entry.url && !entry.headersText) return body;
	return {
		...(entry.method ? { method: entry.method } : {}),
		...(entry.url ? { url: entry.url } : {}),
		...(entry.headersText ? { headers: parseJson(entry.headersText) } : {}),
		body,
	};
}

function pretty(value: unknown, missing: string): string {
	if (value === undefined) return missing;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function interfaceLabel(item: PaymentInterfaceSummary): string {
	const retry =
		item.invocationIndex > 0 ? ` · 重试 ${item.invocationIndex + 1}` : "";
	return `${item.displayOperation}${retry}`;
}

function interfaceIcon(item: PaymentInterfaceSummary) {
	return item.complete ? (
		<CheckCircleOutlined style={{ color: "var(--ant-color-success)" }} />
	) : (
		<WarningOutlined style={{ color: "var(--ant-color-warning)" }} />
	);
}

function interfaceMetadata(detail: PaymentInterfaceDetail) {
	const item = detail.interface;
	return (
		<Descriptions
			bordered
			size="small"
			column={2}
			items={[
				{
					key: "order",
					label: "支付流程",
					children: detail.orderId,
				},
				{
					key: "time",
					label: "调用时间",
					children: formatTime(item.timestamp),
				},
				{
					key: "boundary",
					label: "日期归属",
					children: (
						<Tag color={boundaryColor(item.boundary)}>
							{boundaryText(item.boundary)}
						</Tag>
					),
				},
				{
					key: "attribution",
					label: "归属依据",
					children:
						item.attribution === "correlation"
							? "关联号匹配"
							: "时间线唯一匹配",
				},
				{
					key: "trace",
					label: "trace / Provider 请求号",
					children: item.traceId || item.providerRequestId || "—",
				},
				{
					key: "complete",
					label: "完整性",
					children: item.complete
						? "入参和返回均已校验"
						: "缺少一侧或校验未通过",
				},
			]}
		/>
	);
}

function packetCard(
	title: string,
	entry: RawLogEntry | undefined,
	missing: string,
) {
	return (
		<Card size="small" className="payment-packet-card" title={title}>
			{entry ? (
				<>
					<div className="payment-packet-meta">
						<Tag color={entry.complete ? "success" : "warning"}>
							{entry.complete
								? "chunk / UTF-8 / SHA-256 已校验"
								: entry.error || "不完整"}
						</Tag>
						<Text type="secondary">
							{entry.bodyEncoding} · {entry.chunkCount} 块
						</Text>
					</div>
					<pre className="payment-packet-pre">
						{pretty(packet(entry), missing)}
					</pre>
				</>
			) : (
				<Alert type="warning" showIcon title={missing} />
			)}
		</Card>
	);
}

function flowTitle(flow: PaymentFlowSummary) {
	return (
		<div className="payment-flow-title">
			<div className="payment-flow-title-main">
				<Text strong>{flow.orderId}</Text>
				<Tag color={statusColor(flow.status)}>{statusText(flow.status)}</Tag>
				{flow.hasBoundaryCrossing ? <Tag color="orange">跨凌晨边界</Tag> : null}
			</div>
			<Text type="secondary">
				开始 {formatTime(flow.startedAt)} · {flow.interfaceCount} 个接口 ·{" "}
				{flow.completeInterfaceCount} 个完整
			</Text>
		</div>
	);
}

function fen(value: number | null | undefined): string {
	return value === null
		? "待核实"
		: value === undefined
			? "—"
			: `${value.toLocaleString("zh-CN")} 分（¥${(value / 100).toFixed(2)}）`;
}

function paymentSourceLabel(
	source: AdminWechatRefundPaymentRecord["source"],
): string {
	return source === "medical_insurance" ? "医保支付订单" : "普通微信支付订单";
}

function paymentBusinessLabel(record: AdminWechatRefundPaymentRecord): string {
	if (record.business === "registration") return "挂号";
	if (record.business === "outpatient") return "门诊";
	return "其他";
}

function paymentStatusColor(record: AdminWechatRefundPaymentRecord): string {
	if (
		record.paymentState === "completed" ||
		record.paymentState === "cash_paid"
	) {
		return "success";
	}
	if (
		record.paymentState === "failed" ||
		record.paymentState === "cancelled" ||
		record.medicalStatus === "failed"
	) {
		return "error";
	}
	if (
		record.paymentState === "prepay_ready" ||
		record.paymentState === "unknown" ||
		record.paymentState === "awaiting_confirmation"
	) {
		return "warning";
	}
	return "processing";
}

function paymentStatusLabel(record: AdminWechatRefundPaymentRecord): string {
	if (record.source === "medical_insurance") {
		return `${record.medicalStatus || "医保订单"} / ${record.paymentState}`;
	}
	return record.paymentState;
}

function amountBreakdown(record: AdminWechatRefundPaymentRecord): string[] {
	return paymentAmountLines(record, record.cashPaymentConfirmed);
}

function refundStatusLabel(
	status: NonNullable<AdminWechatRefundPaymentRecord["latestRefund"]>["status"],
): string {
	return {
		requested: "已受理",
		processing: "处理中",
		success: "成功",
		closed: "已关闭",
		abnormal: "异常",
		unknown: "未知",
		request_failed: "申请失败",
	}[status];
}

function medicalRefundStatusLabel(
	status: AdminMedicalInsuranceRefund["status"],
): string {
	return {
		requested: "已受理",
		processing: "处理中",
		succeeded: "退款已完成",
		failed: "退费失败",
		manual_review: "需人工复核",
	}[status];
}

function refundLegStatusLabel(status: string): string {
	return (
		{
			not_required: "无需退款",
			requested: "已申请",
			processing: "处理中",
			success: "已成功",
			failed: "失败",
			unknown: "结果未确认",
		}[status] ?? status
	);
}

function operationStatusLabel(status: string): string {
	return (
		{
			created: "已创建",
			pending: "处理中",
			paid: "已支付",
			failed: "失败",
			refund_pending: "退费处理中",
			refunded: "已退费",
			manual_review: "人工复核",
		}[status] ?? status
	);
}

function operationLegLabel(
	legType: AdminPaymentOperationDetail["legs"][number]["legType"],
): string {
	return {
		medical_insurance: "医保腿",
		wechat_cash: "微信现金腿",
		hospital_reduce: "医院减免腿",
		hospital_part: "医院负担（其他支付）",
		unallocated: "金额分项待核实",
	}[legType];
}

function operationLegStatusLabel(status: string): string {
	return (
		{
			not_started: "未开始",
			pending: "处理中",
			confirmed: "已确认",
			failed: "失败",
			refunded: "已退费",
			manual_review: "人工复核",
		}[status] ?? status
	);
}

function syncTaskStatusLabel(status: AdminPaymentSyncTask["status"]): string {
	return {
		pending: "待执行",
		in_progress: "执行中",
		succeeded: "已完成",
		failed: "失败",
		manual_review: "人工复核",
	}[status];
}

function syncTaskSourceLabel(source: AdminPaymentSyncTask["source"]): string {
	return {
		his: "HIS",
		medical_insurance: "医保",
		wechat_pay: "微信 APIv3",
	}[source];
}

function syncTaskKindLabel(kind: AdminPaymentSyncTask["kind"]): string {
	return {
		pull: "拉取",
		reconcile: "对账",
		writeback: "回写",
	}[kind];
}

export function paymentRecordColumns(
	onRefund: (
		record: AdminWechatRefundPaymentRecord,
		refundType: AdminPaymentRefundType,
	) => void,
	onRefundQuery: (record: AdminWechatRefundPaymentRecord) => void,
	onOperationDetail: (record: AdminWechatRefundPaymentRecord) => void,
	onRegistrationDetail: (record: AdminWechatRefundPaymentRecord) => void,
	refundQueryingNo?: string,
	queryRequiredOrders: ReadonlySet<string> = new Set(),
	readOnly = false,
): NonNullable<TableProps<AdminWechatRefundPaymentRecord>["columns"]> {
	return [
		{
			title: "序号",
			key: "index",
			width: 72,
			fixed: "left",
			align: "center",
			render: (_value, _record, index) => index + 1,
		},
		{
			title: (
				<Tooltip title="订单状态或结算上下文最后更新的时间，不是支付完成时间。">
					<span>更新时间（北京时间）</span>
				</Tooltip>
			),
			dataIndex: "updatedAt",
			key: "updatedAt",
			width: 172,
			render: (value: string) => formatTime(value),
		},
		{
			title: "业务",
			key: "business",
			width: 100,
			render: (_, record) => paymentBusinessLabel(record),
		},
		{
			title: "就诊人",
			key: "patientDisplayName",
			width: 120,
			ellipsis: true,
			render: (_, record) => record.patientDisplayName?.trim() || "未关联",
		},
		{
			title: "下单用户",
			key: "orderUserDisplayName",
			width: 160,
			ellipsis: true,
			render: (_, record) => record.orderUserDisplayName?.trim() || "未设置",
		},
		{
			title: "支付来源",
			key: "source",
			width: 170,
			render: (_, record) => paymentSourceLabel(record.source),
		},
		{
			title: "订单号",
			dataIndex: "orderId",
			key: "orderId",
			width: 240,
			ellipsis: true,
		},
		{
			title: "支付状态",
			key: "paymentState",
			width: 190,
			render: (_, record) => (
				<Tag color={paymentStatusColor(record)}>
					{paymentStatusLabel(record)}
				</Tag>
			),
		},
		{
			title: "挂号状态",
			key: "registrationStatus",
			width: 205,
			render: (_, record) =>
				record.business === "registration" ? (
					<Text>{registrationStatusLabel(record.registration)}</Text>
				) : (
					<Text type="secondary">—</Text>
				),
		},
		{
			title: "金额明细",
			key: "amounts",
			width: 260,
			render: (_, record) => (
				<Space orientation="vertical" size={0}>
					{amountBreakdown(record).map((item) => (
						<Text key={item}>{item}</Text>
					))}
				</Space>
			),
		},
		{
			title: "退款台账",
			key: "latestRefund",
			width: 210,
			render: (_, record) => (
				<Space orientation="vertical" size={2}>
					{record.latestMedicalRefund ? (
						<>
							<Text>
								医保：
								{refundLegStatusLabel(record.latestMedicalRefund.medicalStatus)}
							</Text>
							{!record.latestRefund &&
							record.latestMedicalRefund.wechatStatus !== "not_required" ? (
								<Text>
									微信：
									{refundLegStatusLabel(
										record.latestMedicalRefund.wechatStatus,
									)}
								</Text>
							) : null}
						</>
					) : null}
					{record.latestRefund ? (
						<Text>
							微信：{refundStatusLabel(record.latestRefund.status)} ·{" "}
							{fen(record.latestRefund.refundFen)}
						</Text>
					) : null}
					{!hasRefundReceipt(record) ? (
						<Text type="secondary">暂无退款</Text>
					) : null}
					<Text type="secondary">
						剩余医保 {fen(record.medicalRefundableFen)}
					</Text>
					<Text type="secondary">剩余微信 {fen(record.refundableFen)}</Text>
				</Space>
			),
		},
		{
			title: "操作",
			key: "action",
			fixed: "right",
			width: readOnly ? 120 : 460,
			render: (_, record) => {
				if (readOnly) {
					return (
						<Button
							type="link"
							disabled={!record.operationAggregateId}
							onClick={() => onOperationDetail(record)}
						>
							查看账本
						</Button>
					);
				}
				const queryRequired = queryRequiredOrders.has(paymentRefundKey(record));
				const options = PAYMENT_REFUND_TYPES.map((type) => ({
					type,
					...paymentRefundOption(record, type),
					...(queryRequired
						? { enabled: false, reason: "退款结果尚未确认，请先查询退款状态" }
						: {}),
				}));
				return (
					<Space orientation="vertical" size={4}>
						<Space wrap>
							{record.business === "registration" ? (
								<Button
									type="link"
									onClick={() => onRegistrationDetail(record)}
								>
									查看挂号
								</Button>
							) : null}
							<Button
								type="link"
								disabled={!record.operationAggregateId}
								onClick={() => onOperationDetail(record)}
							>
								查看账本
							</Button>
							{hasRefundReceipt(record) || queryRequired ? (
								<Button
									type="link"
									icon={<ReloadOutlined />}
									loading={refundQueryingNo === paymentRefundKey(record)}
									disabled={Boolean(refundQueryingNo)}
									onClick={() => onRefundQuery(record)}
								>
									查询退款
								</Button>
							) : null}
						</Space>
						<Space wrap>
							{options.map((option) => (
								<Tooltip
									key={option.type}
									title={option.reason || `退款 ${fen(option.amountFen)}`}
								>
									<span>
										<Button
											className="payment-refund-button"
											danger
											size="small"
											icon={<RollbackOutlined />}
											disabled={Boolean(refundQueryingNo) || !option.enabled}
											onClick={() => onRefund(record, option.type)}
										>
											{paymentRefundLabel(record, option.type)}
										</Button>
									</span>
								</Tooltip>
							))}
						</Space>
						{options.every((option) => !option.enabled) ? (
							<Text type="secondary" style={{ maxWidth: 420 }}>
								{[
									...new Set(
										options.map((option) => option.reason).filter(Boolean),
									),
								].join("；")}
							</Text>
						) : null}
					</Space>
				);
			},
		},
	];
}

export function PaymentSyncActions({
	task,
	readOnly,
	loading,
	onRetry,
	onManualReview,
}: {
	task: AdminPaymentSyncTask;
	readOnly: boolean;
	loading: boolean;
	onRetry: () => void;
	onManualReview: () => void;
}) {
	if (readOnly) return null;
	return (
		<Space wrap>
			<Button
				size="small"
				disabled={task.status !== "failed" && task.status !== "manual_review"}
				loading={loading}
				onClick={onRetry}
			>
				重新排队
			</Button>
			<Button
				size="small"
				disabled={
					task.status === "succeeded" ||
					task.status === "manual_review" ||
					task.status === "in_progress"
				}
				onClick={onManualReview}
			>
				转人工
			</Button>
		</Space>
	);
}

export function PaymentPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const { message } = AntdApp.useApp();
	const readOnly = isReadOnlySession(session);
	const [date, setDate] = useState(todayInShanghai);
	const [appliedDate, setAppliedDate] = useState(todayInShanghai);
	const [day, setDay] = useState<PaymentDayResult>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [historyOrderId, setHistoryOrderId] = useState("");
	const [paymentHistory, setPaymentHistory] = useState<
		readonly AdminWechatRefundPaymentRecord[]
	>([]);
	const [historyPageData, setHistoryPageData] =
		useState<AdminWechatRefundPaymentHistoryPage>();
	const [historySource, setHistorySource] = useState<WechatRefundSource>();
	const [historyBusiness, setHistoryBusiness] = useState<
		"registration" | "outpatient" | "other" | undefined
	>();
	const [historyBusinessDay, setHistoryBusinessDay] = useState<string>();
	const [historyStatus, setHistoryStatus] = useState<
		"created" | "pending" | "paid" | "failed" | "manual_review" | undefined
	>();
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string>();
	const [refundRecord, setRefundRecord] =
		useState<AdminWechatRefundPaymentRecord>();
	const [refundReason, setRefundReason] = useState("");
	const [refundType, setRefundType] = useState<AdminPaymentRefundType>("ALL");
	const [refundNeedsQuery, setRefundNeedsQuery] = useState(false);
	const [refundCapabilitiesFresh, setRefundCapabilitiesFresh] = useState(false);
	const [refundQueryRequiredOrders, setRefundQueryRequiredOrders] = useState<
		ReadonlySet<string>
	>(new Set());
	const [refundSubmitting, setRefundSubmitting] = useState(false);
	const [refundQueryingNo, setRefundQueryingNo] = useState<string>();
	const [refundResult, setRefundResult] = useState<AdminPaymentRefundResult>();
	const [registrationRecord, setRegistrationRecord] =
		useState<AdminWechatRefundPaymentRecord>();
	const [registrationDetail, setRegistrationDetail] =
		useState<AdminRegistrationStatus>();
	const [registrationLoading, setRegistrationLoading] = useState(false);
	const [registrationError, setRegistrationError] = useState<string>();
	const [registrationConfirmOpen, setRegistrationConfirmOpen] = useState(false);
	const [registrationReason, setRegistrationReason] = useState("");
	const [registrationSubmitting, setRegistrationSubmitting] = useState(false);
	const [registrationAttempt, setRegistrationAttempt] =
		useState<RegistrationCancellationAttempt>();
	const registrationBusy = useRef(false);
	const registrationSelection = useRef<string | undefined>(undefined);
	const registrationRequestGeneration = useRef(0);
	const [operationDetail, setOperationDetail] =
		useState<AdminPaymentOperationDetail>();
	const [operationDetailLoading, setOperationDetailLoading] = useState(false);
	const [syncTasks, setSyncTasks] = useState<readonly AdminPaymentSyncTask[]>(
		[],
	);
	const [syncStatus, setSyncStatus] =
		useState<AdminPaymentSyncTask["status"]>();
	const [syncLoading, setSyncLoading] = useState(false);
	const [syncError, setSyncError] = useState<string>();
	const [syncReviewTask, setSyncReviewTask] = useState<AdminPaymentSyncTask>();
	const [syncReviewReason, setSyncReviewReason] = useState("");
	const [syncActionLoading, setSyncActionLoading] = useState(false);
	const [activeFlow, setActiveFlow] = useState<string>();
	const [detail, setDetail] = useState<PaymentInterfaceDetail>();
	const [detailLoading, setDetailLoading] = useState<string>();

	const load = useCallback(async () => {
		setLoading(true);
		setError(undefined);
		try {
			setDay(await fetchPaymentDay(appliedDate, session));
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			const messageText =
				reason instanceof Error ? reason.message : "支付日志加载失败";
			setError(messageText);
			void message.error(messageText);
		} finally {
			setLoading(false);
		}
	}, [appliedDate, message, onExpired, session]);

	useEffect(() => {
		void load();
	}, [load]);

	const loadPaymentHistory = useCallback(
		async (
			options: {
				queryOrderId?: string;
				page?: number;
				source?: WechatRefundSource | undefined;
				business?: "registration" | "outpatient" | "other" | undefined;
				businessDay?: string | undefined;
				status?:
					| "created"
					| "pending"
					| "paid"
					| "failed"
					| "manual_review"
					| undefined;
			} = {},
		) => {
			setHistoryLoading(true);
			setHistoryError(undefined);
			try {
				const result = await fetchWechatRefundPaymentHistory(
					{
						page: options.page ?? 1,
						pageSize: 8,
						...(options.source ? { source: options.source } : {}),
						...(options.business ? { business: options.business } : {}),
						...(options.businessDay
							? { businessDay: options.businessDay }
							: {}),
						...(options.status ? { status: options.status } : {}),
						...(options.queryOrderId?.trim()
							? { orderId: options.queryOrderId.trim() }
							: {}),
					},
					session,
				);
				setPaymentHistory(result.items);
				setHistoryPageData(result);
				setRefundRecord((current) =>
					current
						? (result.items.find(
								(item) => paymentRefundKey(item) === paymentRefundKey(current),
							) ?? current)
						: current,
				);
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				const messageText =
					reason instanceof Error ? reason.message : "支付数据加载失败";
				setHistoryError(messageText);
				void message.error(messageText);
			} finally {
				setHistoryLoading(false);
			}
		},
		[message, onExpired, session],
	);

	useEffect(() => {
		void loadPaymentHistory();
	}, [loadPaymentHistory]);

	const loadSyncTasks = useCallback(async () => {
		setSyncLoading(true);
		setSyncError(undefined);
		try {
			setSyncTasks(
				await fetchPaymentSyncTasks(
					{
						limit: 50,
						...(syncStatus ? { status: syncStatus } : {}),
					},
					session,
				),
			);
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			const messageText =
				reason instanceof Error ? reason.message : "同步任务加载失败";
			setSyncError(messageText);
		} finally {
			setSyncLoading(false);
		}
	}, [onExpired, session, syncStatus]);

	useEffect(() => {
		void loadSyncTasks();
	}, [loadSyncTasks]);

	const openInterface = useCallback(
		async (flow: PaymentFlowSummary, item: PaymentInterfaceSummary) => {
			const key = `${flow.id}:${item.ordinal}`;
			setDetailLoading(key);
			try {
				setDetail(
					await fetchPaymentInterface(
						appliedDate,
						flow.id,
						item.ordinal,
						session,
					),
				);
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				void message.error(
					reason instanceof Error ? reason.message : "支付接口加载失败",
				);
			} finally {
				setDetailLoading(undefined);
			}
		},
		[appliedDate, message, onExpired, session],
	);

	const openPaymentRefund = useCallback(
		(record: AdminWechatRefundPaymentRecord, type: AdminPaymentRefundType) => {
			setRefundRecord(record);
			setRefundType(type);
			setRefundReason("");
			setRefundResult(undefined);
			setRefundNeedsQuery(false);
			setRefundCapabilitiesFresh(true);
		},
		[],
	);

	const openOperationDetail = useCallback(
		async (record: AdminWechatRefundPaymentRecord) => {
			if (!record.operationAggregateId) return;
			setOperationDetailLoading(true);
			try {
				setOperationDetail(
					await fetchPaymentOperationDetail(
						record.operationAggregateId,
						session,
					),
				);
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				void message.error(
					reason instanceof Error ? reason.message : "支付账本详情加载失败",
				);
			} finally {
				setOperationDetailLoading(false);
			}
		},
		[message, onExpired, session],
	);

	const refreshRegistration = useCallback(
		async (record: AdminWechatRefundPaymentRecord) => {
			if (registrationBusy.current) return;
			const selection = paymentRefundKey(record);
			const generation = ++registrationRequestGeneration.current;
			setRegistrationLoading(true);
			setRegistrationError(undefined);
			try {
				const result = await fetchRegistrationStatus(
					record.source,
					record.orderId,
					session,
				);
				if (
					registrationSelection.current !== selection ||
					registrationRequestGeneration.current !== generation
				)
					return;
				setRegistrationDetail(result.registration);
				setPaymentHistory((items) =>
					items.map((item) =>
						paymentRefundKey(item) === selection
							? { ...item, registration: result.registration }
							: item,
					),
				);
				const previous = readCancellationAttempt(
					sessionStorage,
					cancellationAttemptStorageKey(record),
				);
				if (previous) {
					const checked = { ...previous, needsQuery: false };
					sessionStorage.setItem(
						cancellationAttemptStorageKey(record),
						JSON.stringify(checked),
					);
					setRegistrationAttempt(checked);
					setRegistrationReason(checked.reason);
				}
			} catch (reason) {
				if (
					registrationSelection.current !== selection ||
					registrationRequestGeneration.current !== generation
				)
					return;
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				if (
					registrationSelection.current === selection &&
					registrationRequestGeneration.current === generation
				)
					setRegistrationError(
						reason instanceof Error
							? reason.message
							: "挂号状态加载失败，请先核对状态再重试",
					);
			} finally {
				if (
					registrationSelection.current === selection &&
					registrationRequestGeneration.current === generation
				)
					setRegistrationLoading(false);
			}
		},
		[onExpired, session],
	);

	const openRegistrationDetail = useCallback(
		(record: AdminWechatRefundPaymentRecord) => {
			if (record.business !== "registration" || registrationBusy.current)
				return;
			registrationSelection.current = paymentRefundKey(record);
			setRegistrationRecord(record);
			setRegistrationDetail(record.registration);
			setRegistrationError(undefined);
			setRegistrationConfirmOpen(false);
			const previous = readCancellationAttempt(
				sessionStorage,
				cancellationAttemptStorageKey(record),
			);
			setRegistrationAttempt(previous);
			setRegistrationReason(previous?.reason || "");
			void refreshRegistration(record);
		},
		[refreshRegistration],
	);

	const submitRegistrationCancellation = useCallback(async () => {
		if (
			!registrationRecord ||
			registrationBusy.current ||
			registrationLoading ||
			registrationError ||
			registrationAttempt?.needsQuery ||
			!canCancelRegistration(registrationDetail) ||
			!validCancellationReason(registrationReason)
		)
			return;
		registrationBusy.current = true;
		++registrationRequestGeneration.current;
		setRegistrationSubmitting(true);
		setRegistrationError(undefined);
		const attempt: RegistrationCancellationAttempt = registrationAttempt || {
			idempotencyKey: `admin-cancel:${crypto.randomUUID()}`,
			reason: registrationReason.trim(),
			needsQuery: true,
		};
		const pending = { ...attempt, needsQuery: true };
		let requestSent = false;
		try {
			// 先保留命令身份，再提交；丢失响应后只能查询，重试沿用同一身份与原因。
			sessionStorage.setItem(
				cancellationAttemptStorageKey(registrationRecord),
				JSON.stringify(pending),
			);
			setRegistrationAttempt(pending);
			requestSent = true;
			const result = await cancelRegistration(
				registrationRecord.source,
				registrationRecord.orderId,
				attempt.reason,
				attempt.idempotencyKey,
				session,
			);
			setRegistrationDetail(result.registration);
			setRegistrationConfirmOpen(false);
			sessionStorage.removeItem(
				cancellationAttemptStorageKey(registrationRecord),
			);
			setRegistrationAttempt(undefined);
			setRegistrationReason("");
			void message.success(
				result.outcome === "already_cancelled"
					? "医院已确认该挂号已取消"
					: "挂号已取消",
			);
			await loadPaymentHistory({
				queryOrderId: historyOrderId,
				page: historyPageData?.page ?? 1,
				source: historySource,
				business: historyBusiness,
				businessDay: historyBusinessDay,
				status: historyStatus,
			});
			setPaymentHistory((items) =>
				items.map((item) =>
					paymentRefundKey(item) === paymentRefundKey(registrationRecord)
						? { ...item, registration: result.registration }
						: item,
				),
			);
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			setRegistrationConfirmOpen(false);
			if (!requestSent) {
				setRegistrationAttempt(undefined);
				setRegistrationError(
					"当前标签页无法保存操作单号，本次未提交取消请求。请检查浏览器会话存储后再试。",
				);
				return;
			}
			setRegistrationAttempt(pending);
			setRegistrationError(
				`${reason instanceof Error ? reason.message : "取消请求未能确认"}。请先刷新挂号状态核对结果，再决定是否重试；系统会沿用原操作单号。`,
			);
		} finally {
			registrationBusy.current = false;
			setRegistrationSubmitting(false);
		}
	}, [
		registrationRecord,
		registrationLoading,
		registrationError,
		registrationAttempt,
		registrationDetail,
		registrationReason,
		session,
		message,
		loadPaymentHistory,
		historyOrderId,
		historyPageData,
		historySource,
		historyBusiness,
		historyBusinessDay,
		historyStatus,
		onExpired,
	]);

	const submitPaymentRefund = useCallback(async () => {
		if (
			!refundRecord ||
			refundSubmitting ||
			refundNeedsQuery ||
			!paymentRefundOption(refundRecord, refundType).enabled
		)
			return;
		setRefundSubmitting(true);
		setRefundNeedsQuery(true);
		setRefundCapabilitiesFresh(false);
		setRefundQueryRequiredOrders((current) =>
			new Set(current).add(paymentRefundKey(refundRecord)),
		);
		try {
			const result = await requestPaymentRefund(
				{
					source: refundRecord.source,
					orderId: refundRecord.orderId,
					refundType,
					...(refundReason.trim() ? { reason: refundReason.trim() } : {}),
				},
				session,
			);
			setRefundResult(result);
			setRefundNeedsQuery(false);
			void message.info(
				registrationRefundFeedback(result)?.title ??
					medicalRefundStatusLabel(result.status),
			);
			const refreshed = await fetchWechatRefundPaymentHistory(
				{
					source: refundRecord.source,
					orderId: refundRecord.orderId,
					page: 1,
					pageSize: 1,
				},
				session,
			);
			const currentRecord = refreshed.items.find(
				(item) => paymentRefundKey(item) === paymentRefundKey(refundRecord),
			);
			if (currentRecord) {
				setRefundRecord(currentRecord);
				setRefundCapabilitiesFresh(true);
				if (result.status !== "requested" && result.status !== "processing")
					setRefundQueryRequiredOrders((current) => {
						const next = new Set(current);
						next.delete(paymentRefundKey(refundRecord));
						return next;
					});
			}
			await loadPaymentHistory({
				queryOrderId: historyOrderId,
				source: historySource,
				business: historyBusiness,
				businessDay: historyBusinessDay,
				status: historyStatus,
			});
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			void message.error(
				reason instanceof Error
					? reason.message
					: "退款申请结果尚未确认，请查询退款状态",
			);
		} finally {
			setRefundSubmitting(false);
		}
	}, [
		historyBusiness,
		historyBusinessDay,
		historyOrderId,
		historyStatus,
		historySource,
		loadPaymentHistory,
		message,
		onExpired,
		refundReason,
		refundRecord,
		refundType,
		refundSubmitting,
		refundNeedsQuery,
		session,
	]);

	const queryOrderRefund = useCallback(
		async (
			record: AdminWechatRefundPaymentRecord,
			type: AdminPaymentRefundType = "ALL",
		) => {
			const key = paymentRefundKey(record);
			setRefundQueryingNo(key);
			setRefundRecord(record);
			setRefundResult(undefined);
			setRefundNeedsQuery(true);
			setRefundCapabilitiesFresh(false);
			setRefundReason("");
			try {
				let result: AdminPaymentRefundResult;
				if (!record.refundOptions && record.latestMedicalRefund) {
					const medicalRefund = await queryMedicalInsuranceRefund(
						record.latestMedicalRefund.refundNo,
						session,
					);
					result = {
						source: record.source,
						orderId: record.orderId,
						refundType: "ALL",
						status: medicalRefund.status,
						amounts: medicalRefund.amounts,
						medicalRefund,
					};
				} else if (!record.refundOptions && record.latestRefund) {
					const wechatRefund = await queryWechatRefund(
						record.latestRefund.merchantRefundNo,
						session,
					);
					result = {
						source: record.source,
						orderId: record.orderId,
						refundType: "CASH",
						status:
							wechatRefund.status === "success"
								? "succeeded"
								: ["closed", "abnormal", "request_failed"].includes(
											wechatRefund.status,
										)
									? "manual_review"
									: "processing",
						amounts: {
							totalFen: wechatRefund.refundFen,
							cashFen: wechatRefund.refundFen,
							personalAccountFen: 0,
							fundFen: 0,
						},
						wechatRefund,
					};
				} else {
					result = await queryPaymentRefund(
						record.source,
						record.orderId,
						session,
						type,
					);
				}
				setRefundResult(result);
				setRefundType(result.refundType);
				setRefundNeedsQuery(false);
				void message.info(
					registrationRefundFeedback(result)?.title ??
						medicalRefundStatusLabel(result.status),
				);
				const refreshed = await fetchWechatRefundPaymentHistory(
					{
						source: record.source,
						orderId: record.orderId,
						page: 1,
						pageSize: 1,
					},
					session,
				);
				const currentRecord = refreshed.items.find(
					(item) => paymentRefundKey(item) === key,
				);
				if (currentRecord) {
					setRefundRecord(currentRecord);
					setRefundCapabilitiesFresh(true);
					if (result.status !== "requested" && result.status !== "processing")
						setRefundQueryRequiredOrders((current) => {
							const next = new Set(current);
							next.delete(key);
							return next;
						});
				}
				await loadPaymentHistory({
					queryOrderId: historyOrderId,
					source: historySource,
					business: historyBusiness,
					businessDay: historyBusinessDay,
					status: historyStatus,
				});
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				void message.error(
					reason instanceof Error ? reason.message : "退款状态查询失败",
				);
			} finally {
				setRefundQueryingNo((current) =>
					current === key ? undefined : current,
				);
			}
		},
		[
			historyBusiness,
			historyBusinessDay,
			historyOrderId,
			historySource,
			historyStatus,
			loadPaymentHistory,
			message,
			onExpired,
			session,
		],
	);

	const retrySyncTask = useCallback(
		async (task: AdminPaymentSyncTask) => {
			setSyncActionLoading(true);
			try {
				await retryPaymentSyncTask(task.taskId, session);
				void message.success("同步任务已重新排队");
				await loadSyncTasks();
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				void message.error(
					reason instanceof Error ? reason.message : "同步任务重试失败",
				);
			} finally {
				setSyncActionLoading(false);
			}
		},
		[loadSyncTasks, message, onExpired, session],
	);

	const submitSyncManualReview = useCallback(async () => {
		if (!syncReviewTask || !syncReviewReason.trim()) return;
		setSyncActionLoading(true);
		try {
			await markPaymentSyncTaskManualReview(
				syncReviewTask.taskId,
				syncReviewReason.trim(),
				session,
			);
			void message.success("同步任务已转人工复核");
			setSyncReviewTask(undefined);
			setSyncReviewReason("");
			await loadSyncTasks();
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			void message.error(
				reason instanceof Error ? reason.message : "转人工复核失败",
			);
		} finally {
			setSyncActionLoading(false);
		}
	}, [
		loadSyncTasks,
		message,
		onExpired,
		session,
		syncReviewReason,
		syncReviewTask,
	]);
	const medicalOrderCount = paymentHistory.filter(
		(record) => record.source === "medical_insurance",
	).length;
	const confirmedPaymentCount = paymentHistory.filter(
		(record) =>
			record.actualCashFen !== null &&
			record.actualCashFen > 0 &&
			record.cashPaymentConfirmed,
	).length;
	const refundableCashFen = paymentHistory.reduce(
		(total, record) => total + record.refundableFen,
		0,
	);
	const selectedRefundOption = refundRecord
		? paymentRefundOption(refundRecord, refundType)
		: undefined;
	const nextRefundType =
		refundRecord &&
		refundCapabilitiesFresh &&
		!refundQueryRequiredOrders.has(paymentRefundKey(refundRecord))
			? PAYMENT_REFUND_TYPES.find(
					(type) => paymentRefundOption(refundRecord, type).enabled,
				)
			: undefined;
	const refundPreview = refundRecord
		? paymentRefundPreview(refundRecord, refundType)
		: undefined;
	const confirmedCashFen =
		refundResult?.amounts.cashFen ?? refundPreview?.cashFen;
	const confirmedMedicalFen = refundResult
		? refundResult.amounts.personalAccountFen + refundResult.amounts.fundFen
		: refundPreview?.medicalFen;
	const registrationFeedback = refundResult
		? registrationRefundFeedback(refundResult)
		: undefined;

	return (
		<main className="console-content payment-page">
			<div className="content-heading">
				<div className="content-heading-copy">
					<Text className="page-kicker">PAYMENT OPERATIONS</Text>
					<Title level={2}>支付数据</Title>
				</div>
			</div>
			<div className="payment-metrics">
				<Card className="metric-card">
					<Statistic
						title="订单总量"
						value={historyPageData?.total ?? 0}
						suffix="笔"
					/>
				</Card>
				<Card className="metric-card metric-card-medical">
					<Statistic
						title="当前页医保支付订单"
						value={medicalOrderCount}
						suffix="笔"
					/>
				</Card>
				<Card className="metric-card metric-card-confirmed">
					<Statistic
						title="当前页微信已确认"
						value={confirmedPaymentCount}
						suffix="笔"
					/>
				</Card>
				<Card className="metric-card metric-card-refund">
					<Statistic
						title="当前页微信可退余额"
						value={refundableCashFen / 100}
						precision={2}
						suffix="元"
					/>
				</Card>
			</div>
			<Card title="全部支付记录" className="payment-search-card">
				<Space orientation="vertical" size={14} style={{ width: "100%" }}>
					<Flex align="center" gap={8} wrap="wrap">
						<Input
							value={historyOrderId}
							onChange={(event) => setHistoryOrderId(event.target.value)}
							onPressEnter={() =>
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source: historySource,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status: historyStatus,
								})
							}
							placeholder="按订单号精确查询；留空显示最近记录"
							maxLength={64}
							style={{ minWidth: 300, flex: 1 }}
						/>
						<Select
							allowClear
							placeholder="全部来源"
							value={historySource}
							onChange={(value) => {
								const source = value as WechatRefundSource | undefined;
								setHistorySource(source);
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status: historyStatus,
								});
							}}
							options={[
								{ value: "medical_insurance", label: "医保支付订单" },
								{ value: "payment_order", label: "普通微信" },
							]}
							style={{ width: 140 }}
						/>
						<Select
							allowClear
							placeholder="全部业务"
							value={historyBusiness}
							onChange={(value) => {
								const business = value as
									| "registration"
									| "outpatient"
									| "other"
									| undefined;
								setHistoryBusiness(business);
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source: historySource,
									business,
									businessDay: historyBusinessDay,
									status: historyStatus,
								});
							}}
							options={[
								{ value: "registration", label: "挂号" },
								{ value: "outpatient", label: "门诊" },
								{ value: "other", label: "其他" },
							]}
							style={{ width: 120 }}
						/>
						<Input
							type="date"
							allowClear
							value={historyBusinessDay ?? ""}
							onChange={(event) => {
								const businessDay = event.target.value || undefined;
								setHistoryBusinessDay(businessDay);
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source: historySource,
									business: historyBusiness,
									businessDay,
									status: historyStatus,
								});
							}}
							aria-label="业务日"
							style={{ width: 160 }}
						/>
						<Select
							allowClear
							placeholder="全部状态"
							value={historyStatus}
							onChange={(value) => {
								const status = value as
									| "created"
									| "pending"
									| "paid"
									| "failed"
									| "manual_review"
									| undefined;
								setHistoryStatus(status);
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source: historySource,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status,
								});
							}}
							options={[
								{ value: "created", label: "待支付" },
								{ value: "pending", label: "处理中" },
								{ value: "paid", label: "已支付" },
								{ value: "failed", label: "失败/取消" },
								{ value: "manual_review", label: "人工复核" },
							]}
							style={{ width: 130 }}
						/>
						<Button
							icon={<ReloadOutlined />}
							loading={historyLoading}
							onClick={() =>
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									source: historySource,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status: historyStatus,
								})
							}
						>
							刷新支付数据
						</Button>
						<Button
							onClick={() => {
								setHistoryOrderId("");
								void loadPaymentHistory({
									queryOrderId: "",
									source: historySource,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status: historyStatus,
								});
							}}
						>
							显示最近记录
						</Button>
					</Flex>
					{historyError ? (
						<Alert type="error" showIcon title={historyError} />
					) : null}
					<Table<AdminWechatRefundPaymentRecord>
						rowKey={(record) => `${record.source}:${record.orderId}`}
						columns={paymentRecordColumns(
							openPaymentRefund,
							(record) =>
								void queryOrderRefund(
									record,
									record.latestMedicalRefund &&
										!record.latestRefund &&
										record.latestMedicalRefund.wechatStatus === "not_required"
										? "HI"
										: record.latestMedicalRefund
											? "ALL"
											: "CASH",
								),
							openOperationDetail,
							openRegistrationDetail,
							refundQueryingNo,
							refundQueryRequiredOrders,
							readOnly,
						)}
						dataSource={paymentHistory}
						loading={historyLoading}
						rowClassName={(record) =>
							record.source === "medical_insurance" ? "payment-row-medical" : ""
						}
						pagination={{
							current: historyPageData?.page ?? 1,
							pageSize: historyPageData?.pageSize ?? 8,
							total: historyPageData?.total ?? 0,
							showSizeChanger: false,
							hideOnSinglePage: true,
							onChange: (page) =>
								void loadPaymentHistory({
									queryOrderId: historyOrderId,
									page,
									source: historySource,
									business: historyBusiness,
									businessDay: historyBusinessDay,
									status: historyStatus,
								}),
						}}
						scroll={{ x: 2085 }}
						size="small"
					/>
				</Space>
			</Card>
			<Card title="同步任务与人工复核" className="payment-search-card">
				<Space orientation="vertical" size={12} style={{ width: "100%" }}>
					<Flex align="center" gap={8} wrap="wrap">
						<Select
							allowClear
							placeholder="全部同步状态"
							value={syncStatus}
							onChange={(value) =>
								setSyncStatus(
									value as AdminPaymentSyncTask["status"] | undefined,
								)
							}
							options={[
								{ value: "pending", label: "待执行" },
								{ value: "in_progress", label: "执行中" },
								{ value: "failed", label: "失败" },
								{ value: "manual_review", label: "人工复核" },
								{ value: "succeeded", label: "已完成" },
							]}
							style={{ width: 150 }}
						/>
						<Button
							icon={<ReloadOutlined />}
							loading={syncLoading}
							onClick={() => void loadSyncTasks()}
						>
							刷新同步任务
						</Button>
						<Text type="secondary">
							这里只处理同步任务状态，不会直接修改支付聚合单终态。
						</Text>
					</Flex>
					{syncError ? <Alert type="error" showIcon title={syncError} /> : null}
					<Table<AdminPaymentSyncTask>
						rowKey="taskId"
						loading={syncLoading}
						dataSource={syncTasks}
						pagination={false}
						size="small"
						scroll={{ x: 980 }}
						columns={[
							{
								title: "任务号",
								dataIndex: "taskId",
								key: "taskId",
								width: 220,
								ellipsis: true,
							},
							{
								title: "来源 / 类型",
								key: "source",
								width: 160,
								render: (_, task) =>
									`${syncTaskSourceLabel(task.source)} / ${syncTaskKindLabel(task.kind)}`,
							},
							{
								title: "状态",
								dataIndex: "status",
								key: "status",
								width: 110,
								render: (value: AdminPaymentSyncTask["status"]) => (
									<Tag
										color={
											value === "succeeded"
												? "success"
												: value === "manual_review" || value === "failed"
													? "warning"
													: "blue"
										}
									>
										{syncTaskStatusLabel(value)}
									</Tag>
								),
							},
							{
								title: "尝试",
								key: "attempts",
								width: 90,
								render: (_, task) => `${task.attempts} / ${task.maxAttempts}`,
							},
							{
								title: "最近错误",
								dataIndex: "lastErrorCode",
								key: "lastErrorCode",
								width: 180,
								ellipsis: true,
								render: (value: string | null) => value || "—",
							},
							{
								title: "操作",
								key: "actions",
								fixed: "right",
								width: 220,
								render: (_, task) => (
									<PaymentSyncActions
										task={task}
										readOnly={readOnly}
										loading={syncActionLoading}
										onRetry={() => void retrySyncTask(task)}
										onManualReview={() => {
											setSyncReviewTask(task);
											setSyncReviewReason("");
										}}
									/>
								),
							},
						]}
					/>
				</Space>
			</Card>
			<Modal
				title="挂号详情"
				open={!readOnly && Boolean(registrationRecord)}
				width={640}
				closable={!registrationSubmitting}
				maskClosable={!registrationSubmitting}
				onCancel={() => {
					if (registrationBusy.current) return;
					registrationSelection.current = undefined;
					++registrationRequestGeneration.current;
					setRegistrationRecord(undefined);
				}}
				footer={
					<Space wrap>
						<Button
							disabled={registrationSubmitting}
							onClick={() => {
								registrationSelection.current = undefined;
								++registrationRequestGeneration.current;
								setRegistrationRecord(undefined);
							}}
						>
							关闭
						</Button>
						<Button
							icon={<ReloadOutlined />}
							loading={registrationLoading}
							disabled={registrationSubmitting}
							onClick={() => {
								if (registrationRecord)
									void refreshRegistration(registrationRecord);
							}}
						>
							刷新医院状态
						</Button>
						<Button
							danger
							disabled={
								registrationLoading ||
								registrationSubmitting ||
								Boolean(registrationError) ||
								Boolean(registrationAttempt?.needsQuery) ||
								!canCancelRegistration(registrationDetail)
							}
							onClick={() => setRegistrationConfirmOpen(true)}
						>
							取消挂号
						</Button>
					</Space>
				}
				destroyOnHidden
			>
				<Spin spinning={registrationLoading}>
					<Space orientation="vertical" size={14} style={{ width: "100%" }}>
						{registrationError ? (
							<Alert
								type="warning"
								showIcon
								title="处理结果需要核对"
								description={registrationError}
							/>
						) : null}
						<Descriptions
							bordered
							size="small"
							column={1}
							items={[
								{
									key: "patient",
									label: "就诊人",
									children: registrationRecord?.patientDisplayName || "未关联",
								},
								{
									key: "order",
									label: "平台订单号",
									children: registrationRecord?.orderId,
								},
								{
									key: "status",
									label: "挂号状态",
									children: registrationStatusLabel(registrationDetail),
								},
								{
									key: "payment",
									label: "医院支付状态",
									children: registrationDetail
										? registrationPaymentLabel(
												registrationDetail.hospitalPaymentStatus,
											)
										: "待核对",
								},
								{
									key: "department",
									label: "科室 / 医生",
									children: `${registrationDetail?.departmentName || "—"} / ${registrationDetail?.doctorName || "—"}`,
								},
								{
									key: "date",
									label: "就诊时间",
									children:
										[
											registrationDetail?.workDate,
											registrationDetail?.shiftName,
										]
											.filter(Boolean)
											.join(" ") || "—",
								},
								{
									key: "serial",
									label: "挂号序号",
									children: registrationDetail?.sourceSerialNumber || "—",
								},
								{
									key: "checked",
									label: "医院核对时间",
									children: registrationDetail?.checkedAt
										? formatTime(registrationDetail.checkedAt)
										: "尚未核对",
								},
							]}
						/>
						<Alert
							type={
								canCancelRegistration(registrationDetail) ? "info" : "warning"
							}
							showIcon
							title={
								canCancelRegistration(registrationDetail)
									? "可以取消挂号"
									: "当前不可直接取消挂号"
							}
							description={
								<Space orientation="vertical" size={4}>
									<Text>
										{registrationDetail?.cancellation.reason ||
											"请先刷新医院状态，核对挂号与支付结果。"}
									</Text>
									{registrationDetail?.hospitalPaymentStatus === "paid" ? (
										<Text>
											{canCancelRegistration(registrationDetail)
												? "原微信实付款已全额退回，本操作仅取消挂号，不会再次退款；医院退费回写结果请按核对提示处理。"
												: "如需退费，请先关闭详情，使用本订单已有的退款入口；退款及医院回写确认后，再核对挂号状态。"}
										</Text>
									) : null}
								</Space>
							}
						/>
					</Space>
				</Spin>
			</Modal>
			<Modal
				title="确认取消挂号"
				open={!readOnly && registrationConfirmOpen}
				okText="确认取消挂号"
				cancelText="返回详情"
				confirmLoading={registrationSubmitting}
				closable={!registrationSubmitting}
				maskClosable={!registrationSubmitting}
				okButtonProps={{
					danger: true,
					disabled:
						registrationLoading ||
						Boolean(registrationError) ||
						Boolean(registrationAttempt?.needsQuery) ||
						!canCancelRegistration(registrationDetail) ||
						!validCancellationReason(registrationReason),
				}}
				onOk={() => void submitRegistrationCancellation()}
				onCancel={() => {
					if (!registrationBusy.current) setRegistrationConfirmOpen(false);
				}}
				destroyOnHidden
			>
				<Space orientation="vertical" size={14} style={{ width: "100%" }}>
					<Alert
						type="warning"
						showIcon
						title="取消后将释放该预约号源"
						description="本操作仅取消挂号，不发起退款。系统会再次核对医院挂号状态与已有支付、退费结果。"
					/>
					<Text>
						{registrationRecord?.patientDisplayName || "未关联"} ·{" "}
						{registrationDetail?.departmentName || "—"} ·{" "}
						{registrationDetail?.doctorName || "—"} ·{" "}
						{registrationDetail?.workDate || "—"} ·{" "}
						{registrationDetail?.sourceSerialNumber || "—"}号
					</Text>
					<Input.TextArea
						value={registrationReason}
						onChange={(event) => setRegistrationReason(event.target.value)}
						minLength={2}
						maxLength={80}
						showCount
						rows={3}
						disabled={registrationSubmitting || Boolean(registrationAttempt)}
						placeholder="请填写 2 至 80 字的取消原因"
					/>
					{registrationAttempt ? (
						<Text type="secondary">
							已有取消请求，重试将沿用原操作单号和原原因，避免重复处理。
						</Text>
					) : null}
				</Space>
			</Modal>
			<Modal
				title="转人工复核"
				open={!readOnly && Boolean(syncReviewTask)}
				confirmLoading={syncActionLoading}
				okText="确认转人工"
				cancelText="取消"
				onOk={() => void submitSyncManualReview()}
				onCancel={() => {
					if (!syncActionLoading) setSyncReviewTask(undefined);
				}}
				destroyOnHidden
			>
				<Input.TextArea
					value={syncReviewReason}
					onChange={(event) => setSyncReviewReason(event.target.value)}
					maxLength={64}
					showCount
					placeholder="填写人工复核原因"
				/>
			</Modal>
			<Card className="payment-search-card">
				<Flex align="center" gap={8} wrap="wrap">
					<Input
						prefix={<ClockCircleOutlined />}
						type="date"
						value={date}
						onChange={(event) => setDate(event.target.value)}
						style={{ width: 190 }}
					/>
					<Button
						type="primary"
						icon={<ReloadOutlined />}
						onClick={() => setAppliedDate(date)}
						loading={loading}
					>
						查询当天支付
					</Button>
					{day ? (
						<Tag color="blue">共 {day.orders.length} 笔支付流程</Tag>
					) : null}
				</Flex>
			</Card>
			{error ? <Alert type="error" showIcon title={error} /> : null}
			<Card
				className="payment-flow-card"
				title={`支付流程${day ? ` · ${day.date}` : ""}`}
			>
				{loading && !day ? (
					<Flex justify="center" style={{ padding: 48 }}>
						<Spin />
					</Flex>
				) : day && day.orders.length > 0 ? (
					<Collapse
						accordion
						{...(activeFlow ? { activeKey: activeFlow } : {})}
						onChange={(key) => setActiveFlow(Array.isArray(key) ? key[0] : key)}
						items={day.orders.map((flow) => ({
							key: flow.id,
							label: flowTitle(flow),
							children: (
								<Space
									orientation="vertical"
									size={12}
									style={{ width: "100%" }}
								>
									<Descriptions
										bordered
										size="small"
										column={2}
										items={[
											{ key: "order", label: "订单号", children: flow.orderId },
											{
												key: "started",
												label: "开始时间",
												children: formatTime(flow.startedAt),
											},
											{
												key: "status",
												label: "流程状态",
												children: (
													<Tag color={statusColor(flow.status)}>
														{statusText(flow.status)}
													</Tag>
												),
											},
											{
												key: "interfaces",
												label: "实际接口",
												children: `${flow.interfaceCount} 个（${flow.completeInterfaceCount} 个完整）`,
											},
										]}
									/>
									{flow.attributionWarningCount > 0 ? (
										<Alert
											type="warning"
											showIcon
											title={`有 ${flow.attributionWarningCount} 个日志块无法唯一归属`}
											description="这些记录已排除，不会被隐式算到本支付流程。"
										/>
									) : null}
									<div className="payment-interface-list">
										{flow.interfaces.map((item) => {
											const detailKey = `${flow.id}:${item.ordinal}`;
											return (
												<div className="payment-interface-row" key={item.id}>
													<div className="payment-interface-main">
														<span className="payment-interface-index">
															{String(item.ordinal).padStart(2, "0")}
														</span>
														{interfaceIcon(item)}
														<Text strong>{interfaceLabel(item)}</Text>
														<Tag color={boundaryColor(item.boundary)}>
															{boundaryText(item.boundary)}
														</Tag>
														<Text type="secondary">
															{formatTime(item.timestamp)}
														</Text>
													</div>
													{!readOnly ? (
														<Button
															type="text"
															icon={<InfoCircleOutlined />}
															aria-label={`查看第 ${item.ordinal} 个接口的入参和返回`}
															loading={detailLoading === detailKey}
															onClick={() => void openInterface(flow, item)}
														/>
													) : null}
												</div>
											);
										})}
										{flow.interfaces.length === 0 ? (
											<Empty
												image={Empty.PRESENTED_IMAGE_SIMPLE}
												description="没有还原出传输层接口"
											/>
										) : null}
									</div>
								</Space>
							),
						}))}
					/>
				) : (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={loading ? "支付日志加载中…" : "当天没有识别到支付流程"}
					/>
				)}
			</Card>
			<Modal
				title="支付运营账本时间线"
				open={Boolean(operationDetail)}
				footer={null}
				confirmLoading={operationDetailLoading}
				onCancel={() => setOperationDetail(undefined)}
				destroyOnHidden
				width={760}
			>
				{operationDetail ? (
					<Space orientation="vertical" size={16} style={{ width: "100%" }}>
						<Descriptions
							bordered
							size="small"
							column={2}
							items={[
								{
									key: "aggregate",
									label: "聚合单号",
									children: operationDetail.aggregate.aggregateId,
								},
								{
									key: "business",
									label: "业务",
									children: operationDetail.aggregate.business,
								},
								{
									key: "status",
									label: "聚合状态",
									children: operationStatusLabel(
										operationDetail.aggregate.status,
									),
								},
								{
									key: "his",
									label: "HIS 同步",
									children: operationDetail.aggregate.hisSyncStatus,
								},
								{
									key: "total",
									label: "金额",
									children: paymentAmountLines(
										operationDetail.aggregate,
										operationDetail.legs.some(
											(leg) =>
												leg.legType === "wechat_cash" &&
												["confirmed", "refunded"].includes(leg.status),
										),
									).join("；"),
								},
								{
									key: "source",
									label: "来源版本",
									children: `${operationDetail.aggregate.sourceVersion} / ${operationDetail.aggregate.version}`,
								},
							]}
						/>
						<Card size="small" title="支付腿">
							<Space orientation="vertical" size={8} style={{ width: "100%" }}>
								{operationDetail.legs.map((leg) => (
									<Flex
										key={leg.legId}
										justify="space-between"
										wrap="wrap"
										gap={8}
									>
										<Text strong>{operationLegLabel(leg.legType)}</Text>
										<Text>{fen(leg.amountFen)}</Text>
										<Tag>{operationLegStatusLabel(leg.status)}</Tag>
									</Flex>
								))}
							</Space>
						</Card>
						<Timeline
							items={operationDetail.events.map((event) => ({
								key: event.eventId,
								color: event.nextStatus === "failed" ? "red" : "blue",
								label: formatTime(event.eventAt),
								title: event.eventType,
								content: `${event.previousStatus ? `${operationStatusLabel(event.previousStatus)} → ` : ""}${operationStatusLabel(event.nextStatus)}；${fen(event.amountFen)}`,
							}))}
						/>
					</Space>
				) : null}
			</Modal>
			<Modal
				title={
					refundResult
						? registrationFeedback
							? "退款与取消挂号进度"
							: "退款结果与渠道状态"
						: `确认${refundRecord ? paymentRefundLabel(refundRecord, refundType) : PAYMENT_REFUND_LABELS[refundType]}`
				}
				open={!readOnly && Boolean(refundRecord)}
				confirmLoading={refundSubmitting}
				okText={`确认退款 ¥${((selectedRefundOption?.amountFen ?? 0) / 100).toFixed(2)}`}
				okButtonProps={{
					danger: true,
					disabled:
						!selectedRefundOption?.enabled ||
						refundNeedsQuery ||
						Boolean(refundQueryingNo),
				}}
				cancelText="取消"
				onOk={() => void submitPaymentRefund()}
				onCancel={() => {
					if (!refundSubmitting && !refundQueryingNo) {
						setRefundRecord(undefined);
						setRefundResult(undefined);
						setRefundNeedsQuery(false);
					}
				}}
				footer={
					refundResult || refundNeedsQuery ? (
						<Space>
							<Button
								icon={<ReloadOutlined />}
								loading={Boolean(refundQueryingNo)}
								disabled={refundSubmitting || !refundRecord}
								onClick={() => {
									if (refundRecord)
										void queryOrderRefund(
											refundRecord,
											refundResult?.refundType ?? refundType,
										);
								}}
							>
								查询最新状态
							</Button>
							{refundResult && nextRefundType && !refundNeedsQuery ? (
								<Button
									disabled={Boolean(refundQueryingNo) || historyLoading}
									onClick={() => {
										setRefundType(nextRefundType);
										setRefundResult(undefined);
										setRefundReason("");
									}}
								>
									退剩余款项
								</Button>
							) : null}
							<Button
								disabled={Boolean(refundQueryingNo) || refundSubmitting}
								onClick={() => {
									setRefundRecord(undefined);
									setRefundResult(undefined);
									setRefundNeedsQuery(false);
								}}
							>
								关闭
							</Button>
						</Space>
					) : undefined
				}
				destroyOnHidden
			>
				{refundRecord ? (
					<Space orientation="vertical" size={14} style={{ width: "100%" }}>
						<Alert
							type={refundResult ? "info" : "warning"}
							showIcon
							title={
								PAYMENT_REFUND_LABELS[refundResult?.refundType ?? refundType]
							}
							description={
								refundRecord.source === "payment_order" &&
								refundRecord.refundRoute === "appointment_cancel"
									? "退款按原微信支付渠道退回。确认原实付款已全额退回后，系统会请求医院取消挂号；医院退费回写结果单独核对。"
									: "退款按原支付渠道退回。医院减免不属于实付金额，不计入本次退款。"
							}
						/>
						<Descriptions
							bordered
							size="small"
							column={1}
							items={[
								{
									key: "order",
									label: "订单号",
									children: refundRecord.orderId,
								},
								{
									key: "total",
									label: refundResult
										? "所选范围金额（含已退）"
										: "本次退费金额",
									children: (
										<Text strong>
											{fen(
												refundResult?.amounts.totalFen ??
													selectedRefundOption?.amountFen,
											)}
										</Text>
									),
								},
								{
									key: "breakdown",
									label: refundResult ? "所选渠道实付（含已退）" : "原渠道退款",
									children: `医保 ${fen(confirmedMedicalFen)}；微信 ${fen(confirmedCashFen)}`,
								},
								{
									key: "discount",
									label: "医院减免（不退款）",
									children: fen(refundRecord.hospitalDiscountFen),
								},
							]}
						/>
						{refundResult ? (
							<Alert
								type={
									registrationFeedback?.type ??
									(refundResult.status === "succeeded"
										? "success"
										: refundResult.status === "manual_review"
											? "warning"
											: refundResult.status === "failed"
												? "error"
												: "info")
								}
								showIcon
								title={
									registrationFeedback?.title ??
									medicalRefundStatusLabel(refundResult.status)
								}
								description={
									<Space orientation="vertical" size={2}>
										{registrationFeedback ? (
											<Text>{registrationFeedback.description}</Text>
										) : null}
										{refundResult.medicalRefund ? (
											<>
												<Text>
													医保退款：
													{refundLegStatusLabel(
														refundResult.medicalRefund.medicalStatus,
													)}
												</Text>
												<Text type="secondary">
													医保退费单号：{refundResult.medicalRefund.refundNo}
												</Text>
											</>
										) : (
											<Text>医保退款：本次未发起</Text>
										)}
										{refundResult.wechatRefund ? (
											<>
												<Text>
													微信退款：
													{refundStatusLabel(refundResult.wechatRefund.status)}
												</Text>
												<Text type="secondary">
													微信退款单号：
													{refundResult.wechatRefund.merchantRefundNo}
												</Text>
											</>
										) : (
											<Text>
												微信退款：
												{refundResult.medicalRefund
													? refundLegStatusLabel(
															refundResult.medicalRefund.wechatStatus,
														)
													: "本次未发起"}
											</Text>
										)}
										{refundResult.status === "manual_review" &&
										!registrationFeedback ? (
											<Text type="warning">
												请查询最新状态，分别核对医保、微信与 HIS
												回执。结果未确认的渠道不能重复退款。
											</Text>
										) : null}
									</Space>
								}
							/>
						) : refundNeedsQuery ? (
							<Alert
								type="warning"
								showIcon
								title="退款结果尚未确认，请先查询最新状态"
							/>
						) : (
							<>
								{!selectedRefundOption?.enabled ? (
									<Alert
										type="warning"
										showIcon
										title={selectedRefundOption?.reason || "当前范围不可退款"}
									/>
								) : null}
								<Input.TextArea
									value={refundReason}
									onChange={(event) => setRefundReason(event.target.value)}
									maxLength={80}
									showCount
									placeholder="退费原因（可选）"
									rows={3}
								/>
							</>
						)}
					</Space>
				) : null}
			</Modal>
			<Modal
				title={
					detail
						? `${interfaceLabel(detail.interface)} · 入参和返回`
						: "接口入参和返回"
				}
				open={!readOnly && Boolean(detail || detailLoading)}
				onCancel={() => {
					setDetail(undefined);
					setDetailLoading(undefined);
				}}
				footer={null}
				width={1180}
				destroyOnHidden
			>
				{detail ? (
					<Space orientation="vertical" size={12} style={{ width: "100%" }}>
						{interfaceMetadata(detail)}
						<Flex className="payment-packet-grid" gap={12} wrap="wrap">
							{packetCard("入参 JSON", detail.request, "没有找到对应入参")}
							{packetCard("返回 JSON", detail.response, "没有找到对应返回")}
						</Flex>
						<Text type="secondary">
							原始内容只在当前受控管理会话中读取，不写入支付日汇总读模型。
						</Text>
					</Space>
				) : (
					<Flex justify="center" style={{ padding: 48 }}>
						<Spin />
					</Flex>
				)}
			</Modal>
		</main>
	);
}
