import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	InfoCircleOutlined,
	ReloadOutlined,
	WarningOutlined,
} from "@ant-design/icons";
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
	Tag,
	Typography,
} from "antd";
import { useCallback, useEffect, useState } from "react";
import {
	ApiError,
	fetchPaymentDay,
	fetchPaymentInterface,
} from "./api";
import type {
	PaymentFlowSummary,
	PaymentInterfaceDetail,
	PaymentInterfaceSummary,
	PaymentStatus,
	RawLogEntry,
	PaymentDayResult,
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
	const retry = item.invocationIndex > 0 ? ` · 重试 ${item.invocationIndex + 1}` : "";
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
					children: item.attribution === "correlation" ? "关联号匹配" : "时间线唯一匹配",
				},
				{
					key: "trace",
					label: "trace / Provider 请求号",
					children: item.traceId || item.providerRequestId || "—",
				},
				{
					key: "complete",
					label: "完整性",
					children: item.complete ? "入参和返回均已校验" : "缺少一侧或校验未通过",
				},
			]}
		/>
	);
}

function packetCard(title: string, entry: RawLogEntry | undefined, missing: string) {
	return (
		<Card size="small" className="payment-packet-card" title={title}>
			{entry ? (
				<>
					<div className="payment-packet-meta">
						<Tag color={entry.complete ? "success" : "warning"}>
							{entry.complete ? "chunk / UTF-8 / SHA-256 已校验" : entry.error || "不完整"}
						</Tag>
						<Text type="secondary">
							{entry.bodyEncoding} · {entry.chunkCount} 块
						</Text>
					</div>
					<pre className="payment-packet-pre">{pretty(packet(entry), missing)}</pre>
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
				开始 {formatTime(flow.startedAt)} · {flow.interfaceCount} 个接口 · {flow.completeInterfaceCount} 个完整
			</Text>
		</div>
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
	const [date, setDate] = useState(todayInShanghai);
	const [appliedDate, setAppliedDate] = useState(todayInShanghai);
	const [day, setDay] = useState<PaymentDayResult>();
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string>();
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
			const messageText = reason instanceof Error ? reason.message : "支付日志加载失败";
			setError(messageText);
			void message.error(messageText);
		} finally {
			setLoading(false);
		}
	}, [appliedDate, message, onExpired, session]);

	useEffect(() => {
		void load();
	}, [load]);

	const openInterface = useCallback(
		async (flow: PaymentFlowSummary, item: PaymentInterfaceSummary) => {
			const key = `${flow.id}:${item.ordinal}`;
			setDetailLoading(key);
			try {
				setDetail(await fetchPaymentInterface(appliedDate, flow.id, item.ordinal, session));
			} catch (reason) {
				if (reason instanceof ApiError && reason.status === 401) {
					onExpired();
					return;
				}
				void message.error(reason instanceof Error ? reason.message : "支付接口加载失败");
			} finally {
				setDetailLoading(undefined);
			}
		},
		[appliedDate, message, onExpired, session],
	);

	return (
		<main className="console-content payment-page">
			<div className="content-heading">
				<div>
					<Title level={2}>查看支付</Title>
					<Text type="secondary">按北京时间支付开始时间查看每天的支付流程和实际接口调用</Text>
				</div>
			</div>
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
					{day ? <Tag color="blue">共 {day.orders.length} 笔支付流程</Tag> : null}
				</Flex>
			</Card>
			<Alert
				className="payment-boundary-alert"
				type="info"
				showIcon
				title="支付流程按开始时间归属"
				description={
					day
						? `查询窗口：${formatTime(day.window.start)} — ${formatTime(day.window.endExclusive)}；前后各带 ${day.window.boundaryBufferMinutes} 分钟边界缓冲。跨到次日的接口仍归属于原支付流程，无法唯一关联的记录不会强行归入。`
						: "查询会自动带边界缓冲，凌晨前后跨日的接口会显示明确的日期归属。"
				}
			/>
			{error ? <Alert type="error" showIcon title={error} /> : null}
			<Card
				className="payment-flow-card"
				title={`支付流程${day ? ` · ${day.date}` : ""}`}
			>
				{loading && !day ? (
					<Flex justify="center" style={{ padding: 48 }}><Spin /></Flex>
				) : day && day.orders.length > 0 ? (
					<Collapse
						accordion
						activeKey={activeFlow}
						onChange={(key) => setActiveFlow(Array.isArray(key) ? key[0] : key)}
						items={day.orders.map((flow) => ({
							key: flow.id,
							label: flowTitle(flow),
							children: (
								<Space orientation="vertical" size={12} style={{ width: "100%" }}>
									<Descriptions
										bordered
										size="small"
										column={2}
										items={[
											{ key: "order", label: "订单号", children: flow.orderId },
											{ key: "started", label: "开始时间", children: formatTime(flow.startedAt) },
											{ key: "status", label: "流程状态", children: <Tag color={statusColor(flow.status)}>{statusText(flow.status)}</Tag> },
											{ key: "interfaces", label: "实际接口", children: `${flow.interfaceCount} 个（${flow.completeInterfaceCount} 个完整）` },
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
														<span className="payment-interface-index">{String(item.ordinal).padStart(2, "0")}</span>
														{interfaceIcon(item)}
														<Text strong>{interfaceLabel(item)}</Text>
														<Tag color={boundaryColor(item.boundary)}>{boundaryText(item.boundary)}</Tag>
														<Text type="secondary">{formatTime(item.timestamp)}</Text>
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
										{flow.interfaces.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有还原出传输层接口" /> : null}
									</div>
								</Space>
							),
						}))}
					/>
				) : (
					<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "支付日志加载中…" : "当天没有识别到支付流程"} />
				)}
			</Card>
			<Modal
				title={detail ? `${interfaceLabel(detail.interface)} · 入参和返回` : "接口入参和返回"}
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
						<Text type="secondary">原始内容只在当前受控管理会话中读取，不写入支付日汇总读模型。</Text>
					</Space>
				) : (
					<Flex justify="center" style={{ padding: 48 }}><Spin /></Flex>
				)}
			</Modal>
		</main>
	);
}
