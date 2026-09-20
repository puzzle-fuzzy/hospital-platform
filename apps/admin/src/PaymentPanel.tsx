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
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
	ApiError,
	fetchPaymentDay,
	fetchPaymentInterface,
	fetchWechatRefundPaymentHistory,
	requestMedicalInsuranceRefund,
} from "./api";
import type {
	AdminMedicalInsuranceRefund,
	AdminWechatRefundPaymentRecord,
	PaymentDayResult,
	PaymentFlowSummary,
	PaymentInterfaceDetail,
	PaymentInterfaceSummary,
	PaymentStatus,
	RawLogEntry,
	Session,
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

function formatTime(value: string): string {
	const time = new Date(value);
	return Number.isNaN(time.getTime())
		? value
		: time.toLocaleString("zh-CN", { hour12: false });
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

function fen(value: number | undefined): string {
	return value === undefined
		? "—"
		: `${value.toLocaleString("zh-CN")} 分（¥${(value / 100).toFixed(2)}）`;
}

function paymentSourceLabel(
	source: AdminWechatRefundPaymentRecord["source"],
): string {
	return source === "medical_insurance"
		? "医保 + 微信聚合订单"
		: "普通微信支付订单";
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
	const items = [`总额 ${fen(record.totalFen)}`, `现金 ${fen(record.cashFen)}`];
	if (record.insuranceFen !== undefined) {
		items.push(`医保 ${fen(record.insuranceFen)}`);
	}
	if (record.personalAccountFen !== undefined) {
		items.push(`个人账户 ${fen(record.personalAccountFen)}`);
	}
	if (record.fundFen !== undefined) items.push(`基金 ${fen(record.fundFen)}`);
	if (record.otherPaymentFen !== undefined) {
		items.push(`其他支付 ${fen(record.otherPaymentFen)}`);
	}
	if (record.hospitalPartFen !== undefined) {
		items.push(`医院承担 ${fen(record.hospitalPartFen)}`);
	}
	if (record.personalAccountMutualAidFen !== undefined) {
		items.push(`个账共济 ${fen(record.personalAccountMutualAidFen)}`);
	}
	if (record.personalAccountSelfFen !== undefined) {
		items.push(`本人个账 ${fen(record.personalAccountSelfFen)}`);
	}
	if (record.depositFen !== undefined)
		items.push(`押金 ${fen(record.depositFen)}`);
	if (record.deliveryFeeFen !== undefined) {
		items.push(`配送费 ${fen(record.deliveryFeeFen)}`);
	}
	return items;
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
		succeeded: "医保+微信均已成功",
		failed: "退费失败",
		manual_review: "需人工复核",
	}[status];
}

function canAggregateMedicalRefund(
	record: AdminWechatRefundPaymentRecord,
): boolean {
	return (
		record.totalFen > 0 &&
		record.refundRoute === "admin" &&
		(record.cashFen <= 0 || record.cashPaymentConfirmed) &&
		record.totalFen ===
			record.cashFen + (record.personalAccountFen ?? 0) + (record.fundFen ?? 0)
	);
}

function paymentRecordColumns(
	onMedicalRefund: (record: AdminWechatRefundPaymentRecord) => void,
): NonNullable<TableProps<AdminWechatRefundPaymentRecord>["columns"]> {
	return [
		{
			title: "更新时间",
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
			width: 150,
			render: (_, record) =>
				record.source === "medical_insurance" ? (
					record.latestMedicalRefund ? (
						<Space orientation="vertical" size={0}>
							<Tag>
								{medicalRefundStatusLabel(record.latestMedicalRefund.status)}
							</Tag>
							<Text type="secondary">
								{fen(record.latestMedicalRefund.totalFen)}
							</Text>
						</Space>
					) : (
						<Text type="secondary">暂无聚合退费</Text>
					)
				) : record.latestRefund ? (
					<Space orientation="vertical" size={0}>
						<Tag>{refundStatusLabel(record.latestRefund.status)}</Tag>
						<Text type="secondary">{fen(record.latestRefund.refundFen)}</Text>
					</Space>
				) : (
					<Text type="secondary">暂无</Text>
				),
		},
		{
			title: "操作",
			key: "action",
			fixed: "right",
			width: 174,
			render: (_, record) =>
				record.source === "medical_insurance" ? (
					<Button
						danger
						icon={<RollbackOutlined />}
						disabled={!canAggregateMedicalRefund(record)}
						onClick={() => onMedicalRefund(record)}
					>
						医保 + 微信一并退费
					</Button>
				) : (
					<Button danger icon={<RollbackOutlined />} disabled>
						纯微信订单
					</Button>
				),
		},
	];
}

export function PaymentPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const { message } = AntdApp.useApp();
	const [date, setDate] = useState(todayInShanghai);
	const [appliedDate, setAppliedDate] = useState(todayInShanghai);
	const [day, setDay] = useState<PaymentDayResult>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
	const [historyOrderId, setHistoryOrderId] = useState("");
	const [paymentHistory, setPaymentHistory] = useState<
		readonly AdminWechatRefundPaymentRecord[]
	>([]);
	const [historyLoading, setHistoryLoading] = useState(false);
	const [historyError, setHistoryError] = useState<string>();
	const [refundRecord, setRefundRecord] =
		useState<AdminWechatRefundPaymentRecord>();
	const [refundReason, setRefundReason] = useState("");
	const [refundSubmitting, setRefundSubmitting] = useState(false);
	const [refundResult, setRefundResult] =
		useState<AdminMedicalInsuranceRefund>();
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
		async (queryOrderId?: string) => {
			setHistoryLoading(true);
			setHistoryError(undefined);
			try {
				setPaymentHistory(
					await fetchWechatRefundPaymentHistory(
						{
							limit: 100,
							...(queryOrderId?.trim() ? { orderId: queryOrderId.trim() } : {}),
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

	const openMedicalRefund = useCallback(
		(record: AdminWechatRefundPaymentRecord) => {
			setRefundRecord(record);
			setRefundReason("");
			setRefundResult(undefined);
		},
		[],
	);

	const submitMedicalRefund = useCallback(async () => {
		if (!refundRecord) return;
		setRefundSubmitting(true);
		try {
			const result = await requestMedicalInsuranceRefund(
				{
					orderId: refundRecord.orderId,
					idempotencyKey: `admin-ui-${crypto.randomUUID()}`,
					...(refundReason.trim() ? { reason: refundReason.trim() } : {}),
				},
				session,
			);
			setRefundResult(result);
			void message.success(medicalRefundStatusLabel(result.status));
			await loadPaymentHistory(refundRecord.orderId);
		} catch (reason) {
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			void message.error(
				reason instanceof Error ? reason.message : "医保+微信退费失败",
			);
		} finally {
			setRefundSubmitting(false);
		}
	}, [
		loadPaymentHistory,
		message,
		onExpired,
		refundReason,
		refundRecord,
		session,
	]);

	return (
		<main className="console-content payment-page">
			<div className="content-heading">
				<div>
					<Title level={2}>支付数据</Title>
					<Text type="secondary">
						普通微信支付订单和医保支付订单统一查看；支付原文仍按单笔链路受控展开
					</Text>
				</div>
			</div>
			<Card title="全部支付记录" className="payment-search-card">
				<Space orientation="vertical" size={14} style={{ width: "100%" }}>
					<Alert
						type="info"
						showIcon
						title="只读支付台账"
						description="这里合并展示服务端已落库的普通支付订单和医保订单；金额按分展示并保留医保分项。医保订单的退费按钮只发起一次医保 + 微信整笔聚合退费。"
					/>
					<Flex align="center" gap={8} wrap="wrap">
						<Input
							value={historyOrderId}
							onChange={(event) => setHistoryOrderId(event.target.value)}
							onPressEnter={() => void loadPaymentHistory(historyOrderId)}
							placeholder="按订单号精确查询；留空显示最近 100 条"
							maxLength={64}
							style={{ minWidth: 300, flex: 1 }}
						/>
						<Button
							icon={<ReloadOutlined />}
							loading={historyLoading}
							onClick={() => void loadPaymentHistory(historyOrderId)}
						>
							刷新支付数据
						</Button>
						<Button
							onClick={() => {
								setHistoryOrderId("");
								void loadPaymentHistory();
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
						columns={paymentRecordColumns(openMedicalRefund)}
						dataSource={paymentHistory}
						loading={historyLoading}
						pagination={{ pageSize: 8, hideOnSinglePage: true }}
						scroll={{ x: 1480 }}
						size="small"
					/>
				</Space>
			</Card>
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
			<Alert
				className="payment-boundary-alert"
				type="info"
				showIcon
				title="支付流程按开始时间归属"
				description={
					day
						? `查询窗口：${formatTime(day.window.start)} — ${formatTime(day.window.endExclusive)}；前后各带 ${day.window.boundaryBufferMinutes} 分钟边界缓冲。日汇总只读取支付事件，点击接口时再按订单关联号读取原始请求和返回。跨到次日的接口仍归属于原支付流程，无法唯一关联的记录不会强行归入。`
						: "查询会自动带边界缓冲，日汇总只读取支付事件；点击接口时再按订单关联号读取原始请求和返回。"
				}
			/>
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
													<Button
														type="text"
														icon={<InfoCircleOutlined />}
														aria-label={`查看第 ${item.ordinal} 个接口的入参和返回`}
														loading={detailLoading === detailKey}
														onClick={() => void openInterface(flow, item)}
													/>
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
				title="医保 + 微信一并退费"
				open={Boolean(refundRecord)}
				confirmLoading={refundSubmitting}
				okText="确认一并退费"
				cancelText="取消"
				onOk={() => void submitMedicalRefund()}
				onCancel={() => {
					if (!refundSubmitting) {
						setRefundRecord(undefined);
						setRefundResult(undefined);
					}
				}}
				footer={
					refundResult ? (
						<Button
							onClick={() => {
								setRefundRecord(undefined);
								setRefundResult(undefined);
							}}
						>
							关闭
						</Button>
					) : undefined
				}
				destroyOnHidden
			>
				{refundRecord ? (
					<Space orientation="vertical" size={14} style={{ width: "100%" }}>
						<Alert
							type="warning"
							showIcon
							title="这是一次聚合退费"
							description="确认后由服务端先调用医保 6203，再对同一订单的微信 APIv3 现金段原路退回。Admin 不提供医保腿和微信腿的分开操作。"
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
									label: "本次退费金额",
									children: fen(refundRecord.totalFen),
								},
								{
									key: "breakdown",
									label: "金额分项",
									children: amountBreakdown(refundRecord).join("；"),
								},
							]}
						/>
						{refundResult ? (
							<Alert
								type={
									refundResult.status === "succeeded"
										? "success"
										: refundResult.status === "manual_review"
											? "warning"
											: refundResult.status === "failed"
												? "error"
												: "info"
								}
								showIcon
								title={medicalRefundStatusLabel(refundResult.status)}
								description={
									<Space orientation="vertical" size={2}>
										<Text>退费单号：{refundResult.refundNo}</Text>
										<Text>
											医保腿：{refundResult.medicalStatus}；微信腿：
											{refundResult.wechatStatus}
										</Text>
									</Space>
								}
							/>
						) : (
							<Input.TextArea
								value={refundReason}
								onChange={(event) => setRefundReason(event.target.value)}
								maxLength={80}
								showCount
								placeholder="退费原因（可选）"
								rows={3}
							/>
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
				open={Boolean(detail || detailLoading)}
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
