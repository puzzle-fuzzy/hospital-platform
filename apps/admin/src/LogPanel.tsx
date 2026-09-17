import {
	ApiOutlined,
	ClockCircleOutlined,
	FileTextOutlined,
	ReloadOutlined,
	SearchOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App as AntdApp,
	Button,
	Card,
	Collapse,
	Descriptions,
	Drawer,
	Empty,
	Flex,
	Input,
	Select,
	Space,
	Spin,
	Table,
	Tag,
	Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchLogDetail, fetchLogPage, fetchLogRaw } from "./api";
import {
	pairRawLogInvocations,
	type RawLogInvocation,
} from "./raw-log-invocations";
import type {
	AdminLogLevel,
	AdminLogPage,
	AdminLogQuery,
	AdminLogRecord,
	RawLogEntry,
	RawLogTrace,
	Session,
} from "./types";

const { Text, Title } = Typography;

const LEVEL_LABELS: Record<AdminLogLevel, string> = {
	debug: "调试",
	info: "信息",
	warn: "警告",
	error: "错误",
};

function levelTag(level: AdminLogLevel) {
	const color =
		level === "error" ? "error" : level === "warn" ? "warning" : "blue";
	return <Tag color={color}>{LEVEL_LABELS[level]}</Tag>;
}

function statusTag(statusCode?: number) {
	if (statusCode === undefined) return <Text type="secondary">—</Text>;
	const color =
		statusCode >= 500 ? "error" : statusCode >= 400 ? "warning" : "success";
	return <Tag color={color}>{statusCode}</Tag>;
}

function formatTime(value: string): string {
	const time = new Date(value);
	return Number.isNaN(time.getTime())
		? value
		: time.toLocaleString("zh-CN", { hour12: false });
}

function optionalText(value: string | undefined): string {
	return value || "—";
}

function rawLayerLabel(layer: RawLogInvocation["layer"]): string {
	if (layer === "transport") return "传输层";
	if (layer === "logical") return "业务层";
	if (layer === "legacy") return "旧 FSI 层";
	return "其他层";
}

function rawEntryPanel(label: string, entry?: RawLogEntry) {
	if (!entry) {
		return (
			<Card size="small" title={label}>
				<Alert
					type="warning"
					showIcon
					title={`${label}缺失`}
					description="没有找到对应的原始日志记录，不能把缺失的一侧当作成功。"
				/>
			</Card>
		);
	}
	return (
		<Card size="small" title={label}>
			<Descriptions
				bordered
				size="small"
				column={1}
				items={[
					{
						key: "timestamp",
						label: "时间",
						children: formatTime(entry.timestamp),
					},
					{
						key: "status",
						label: "HTTP 状态",
						children: statusTag(entry.statusCode),
					},
					{
						key: "encoding",
						label: "编码/分块",
						children: `${entry.bodyEncoding} · ${entry.chunkCount} 块`,
					},
					{
						key: "integrity",
						label: "完整性",
						children: entry.complete ? (
							<Tag color="success">chunk / UTF-8 / SHA-256 已校验</Tag>
						) : (
							<Tag color="warning">未完整还原：{entry.error || "未知原因"}</Tag>
						),
					},
					{
						key: "headers",
						label: "请求/返回头",
						children: entry.headersText ? (
							<pre className="raw-log-pre">{entry.headersText}</pre>
						) : (
							"—"
						),
					},
					{
						key: "url",
						label: "地址",
						children: optionalText(entry.url),
					},
					{
						key: "body",
						label: "原始 Body",
						children:
							entry.bodyText !== undefined ? (
								<pre className="raw-log-pre">{entry.bodyText}</pre>
							) : (
								"—"
							),
					},
				]}
			/>
		</Card>
	);
}

function rawInvocationPanel(invocation: RawLogInvocation) {
	const correlation =
		invocation.traceId || invocation.requestId || invocation.providerRequestId;
	return (
		<Space orientation="vertical" size={8} style={{ width: "100%" }}>
			<Descriptions
				bordered
				size="small"
				column={1}
				items={[
					{
						key: "layer",
						label: "日志层",
						children: rawLayerLabel(invocation.layer),
					},
					{
						key: "attempt",
						label: "调用序号",
						children:
							invocation.attempt === 0
								? "首次调用"
								: `第 ${invocation.attempt + 1} 次（重试）`,
					},
					{
						key: "correlation",
						label: "关联号",
						children: optionalText(correlation),
					},
				]}
			/>
			<Flex className="raw-invocation-panes" gap={12} wrap="wrap">
				<div className="raw-invocation-pane">
					{rawEntryPanel("入参 JSON", invocation.request)}
				</div>
				<div className="raw-invocation-pane">
					{rawEntryPanel("返回 JSON", invocation.response)}
				</div>
			</Flex>
		</Space>
	);
}

export function LogPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const { message } = AntdApp.useApp();
	const [level, setLevel] = useState<AdminLogLevel>();
	const [event, setEvent] = useState("");
	const [path, setPath] = useState("");
	const [traceId, setTraceId] = useState("");
	const [providerRequestId, setProviderRequestId] = useState("");
	const [service, setService] = useState("");
	const [startTime, setStartTime] = useState("");
	const [endTime, setEndTime] = useState("");
	const [loading, setLoading] = useState(false);
	const [page, setPage] = useState<AdminLogPage>();
	const [appliedQuery, setAppliedQuery] = useState<AdminLogQuery>({
		page: 1,
		pageSize: 50,
	});
	const [detail, setDetail] = useState<AdminLogRecord>();
	const [detailLoadingId, setDetailLoadingId] = useState<string>();
	const [rawTrace, setRawTrace] = useState<RawLogTrace>();
	const [rawLoading, setRawLoading] = useState(false);
	const detailRequestRef = useRef(0);
	const rawInvocations = useMemo(
		() => (rawTrace ? pairRawLogInvocations(rawTrace) : []),
		[rawTrace],
	);

	const filterQuery = useMemo<AdminLogQuery>(
		() => ({
			pageSize: 50,
			...(level ? { level } : {}),
			...(event.trim() ? { event: event.trim() } : {}),
			...(path.trim() ? { path: path.trim() } : {}),
			...(traceId.trim() ? { traceId: traceId.trim() } : {}),
			...(providerRequestId.trim()
				? { providerRequestId: providerRequestId.trim() }
				: {}),
			...(service.trim() ? { service: service.trim() } : {}),
			...(startTime.trim() ? { startTime: startTime.trim() } : {}),
			...(endTime.trim() ? { endTime: endTime.trim() } : {}),
		}),
		[
			endTime,
			event,
			level,
			path,
			providerRequestId,
			service,
			startTime,
			traceId,
		],
	);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			setPage(await fetchLogPage(appliedQuery, session));
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) onExpired();
			void message.error(
				error instanceof Error ? error.message : "日志加载失败",
			);
		} finally {
			setLoading(false);
		}
	}, [appliedQuery, message, onExpired, session]);

	useEffect(() => {
		void load();
	}, [load]);

	const applyFilters = () => {
		setAppliedQuery({ ...filterQuery, page: 1 });
	};

	const changePage = (nextPage: number) => {
		setAppliedQuery({ ...appliedQuery, page: nextPage });
	};

	const openDetail = useCallback(
		async (record: AdminLogRecord) => {
			const requestId = detailRequestRef.current + 1;
			detailRequestRef.current = requestId;
			setDetailLoadingId(record.id);
			setRawLoading(true);
			setRawTrace(undefined);
			try {
				const nextDetail = await fetchLogDetail(record.id, session);
				if (detailRequestRef.current !== requestId) return;
				setDetail(nextDetail);
				try {
					const nextRawTrace = await fetchLogRaw(nextDetail.id, session);
					if (detailRequestRef.current === requestId) {
						setRawTrace(nextRawTrace);
					}
				} catch (error) {
					if (detailRequestRef.current !== requestId) return;
					if (error instanceof ApiError && error.status === 401) onExpired();
					void message.warning(
						error instanceof Error ? error.message : "原始日志加载失败",
					);
				}
			} catch (error) {
				if (detailRequestRef.current !== requestId) return;
				if (error instanceof ApiError && error.status === 401) onExpired();
				void message.error(
					error instanceof Error ? error.message : "日志详情加载失败",
				);
			} finally {
				if (detailRequestRef.current === requestId) {
					setDetailLoadingId(undefined);
					setRawLoading(false);
				}
			}
		},
		[message, onExpired, session],
	);

	const closeDetail = useCallback(() => {
		// 使尚未返回的详情/原始日志请求失效，避免关闭抽屉后继续占用 loading 状态。
		detailRequestRef.current += 1;
		setDetail(undefined);
		setRawTrace(undefined);
		setDetailLoadingId(undefined);
		setRawLoading(false);
	}, []);

	const columns = useMemo<ColumnsType<AdminLogRecord>>(
		() => [
			{
				title: "级别",
				dataIndex: "level",
				width: 92,
				render: (value: AdminLogLevel) => levelTag(value),
			},
			{
				title: "接口调用",
				key: "interface",
				width: 360,
				render: (_, record) => (
					<Space orientation="vertical" size={0}>
						<Text code>
							{record.method || "EVENT"} {record.path || record.event || "—"}
						</Text>
						<Text type="secondary">
							{record.providerOperation || record.service}
						</Text>
					</Space>
				),
			},
			{ title: "时间", dataIndex: "timestamp", width: 190, render: formatTime },
			{ title: "状态", dataIndex: "statusCode", width: 90, render: statusTag },
			{
				title: "耗时",
				dataIndex: "durationMs",
				width: 100,
				render: (value?: number) => (value === undefined ? "—" : `${value} ms`),
			},
			{
				title: "关联号",
				key: "correlation",
				width: 220,
				render: (_, record) => record.traceId || record.requestId || "—",
			},
			{
				title: "来源",
				dataIndex: "source",
				width: 110,
				render: (value: AdminLogRecord["source"]) =>
					value === "database" ? (
						<Tag>数据库</Tag>
					) : (
						<Tag color="blue">进程窗口</Tag>
					),
			},
			{
				title: "操作",
				key: "action",
				fixed: "right",
				width: 80,
				render: (_, record) => (
					<Button
						type="link"
						loading={detailLoadingId === record.id}
						onClick={() => void openDetail(record)}
					>
						查看
					</Button>
				),
			},
		],
		[detailLoadingId, openDetail],
	);

	return (
		<main className="console-content">
			<div className="content-heading">
				<div>
					<Title level={2}>接口调用日志</Title>
					<Text type="secondary">
						查看新服务当前进程窗口内的接口调用、状态与关联信息
					</Text>
				</div>
				<Button
					icon={<ReloadOutlined />}
					onClick={() => void load()}
					loading={loading}
				>
					刷新
				</Button>
			</div>
			<Alert
				className="log-policy-alert"
				type="info"
				showIcon
				icon={<ApiOutlined />}
				title="安全日志视图"
				description="列表只显示安全元数据；点击带 trace/request/Provider 请求号的记录，可在服务器 journald 中受控查看已校验的原始请求与返回（单条最多 300 条）。"
			/>
			<Card
				className="log-filter-card"
				title={
					<Space>
						<SearchOutlined />
						筛选条件
					</Space>
				}
			>
				<Flex wrap="wrap" gap={8}>
					<Select
						allowClear
						placeholder="级别"
						style={{ width: 130 }}
						value={level}
						onChange={(value: AdminLogLevel | undefined) => setLevel(value)}
						options={Object.entries(LEVEL_LABELS).map(([value, label]) => ({
							value,
							label,
						}))}
					/>
					<Input
						placeholder="事件名，例如 http.request.failed"
						value={event}
						onChange={(e) => setEvent(e.target.value)}
						style={{ width: 280 }}
					/>
					<Input
						placeholder="接口路径"
						value={path}
						onChange={(e) => setPath(e.target.value)}
						style={{ width: 240 }}
					/>
					<Input
						placeholder="traceId / requestId"
						value={traceId}
						onChange={(e) => setTraceId(e.target.value)}
						style={{ width: 240 }}
					/>
					<Input
						placeholder="Provider 请求号"
						value={providerRequestId}
						onChange={(e) => setProviderRequestId(e.target.value)}
						style={{ width: 220 }}
					/>
					<Input
						placeholder="服务名，例如 hospital-worker"
						value={service}
						onChange={(e) => setService(e.target.value)}
						style={{ width: 230 }}
					/>
					<Input
						prefix={<ClockCircleOutlined />}
						placeholder="开始时间 ISO 8601（可选）"
						value={startTime}
						onChange={(e) => setStartTime(e.target.value)}
						style={{ width: 250 }}
					/>
					<Input
						prefix={<ClockCircleOutlined />}
						placeholder="结束时间 ISO 8601（可选）"
						value={endTime}
						onChange={(e) => setEndTime(e.target.value)}
						style={{ width: 250 }}
					/>
					<Button
						type="primary"
						icon={<SearchOutlined />}
						onClick={applyFilters}
					>
						查询
					</Button>
				</Flex>
			</Card>
			<Card title={`调用记录${page ? `（共 ${page.total} 条）` : ""}`}>
				{page && page.items.length > 0 ? (
					<Table<AdminLogRecord>
						rowKey="id"
						loading={loading}
						columns={columns}
						dataSource={page.items}
						pagination={{
							current: page.page,
							pageSize: page.pageSize,
							total: page.total,
							showSizeChanger: false,
							onChange: changePage,
						}}
						scroll={{ x: 1260 }}
					/>
				) : (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={loading ? "日志加载中…" : "当前筛选条件没有日志"}
					/>
				)}
			</Card>
			<Drawer
				title={detail ? `日志详情 · ${detail.id}` : "日志详情"}
				open={Boolean(detail)}
				onClose={closeDetail}
				width={880}
			>
				{detail ? (
					<Space orientation="vertical" size={16} style={{ width: "100%" }}>
						<Descriptions
							bordered
							size="small"
							column={1}
							items={[
								{
									key: "interface",
									label: "接口",
									children: `${detail.method || "EVENT"} ${detail.path || detail.event || "—"}`,
								},
								{
									key: "time",
									label: "时间",
									children: formatTime(detail.timestamp),
								},
								{
									key: "status",
									label: "状态",
									children: statusTag(detail.statusCode),
								},
								{
									key: "duration",
									label: "耗时",
									children:
										detail.durationMs === undefined
											? "—"
											: `${detail.durationMs} ms`,
								},
								{
									key: "trace",
									label: "trace/request ID",
									children: optionalText(detail.traceId || detail.requestId),
								},
								{
									key: "provider",
									label: "Provider 操作",
									children: optionalText(detail.providerOperation),
								},
								{
									key: "providerRequest",
									label: "Provider 请求号",
									children: optionalText(detail.providerRequestId),
								},
								{
									key: "failureStage",
									label: "失败阶段",
									children: optionalText(detail.providerFailureStage),
								},
								{
									key: "error",
									label: "错误",
									children: optionalText(detail.errorCode || detail.errorName),
								},
								{
									key: "providerResponse",
									label: "Provider 返回",
									children: optionalText(
										detail.providerResponseCode ||
											detail.providerErrorCode ||
											detail.providerTransportErrorCode,
									),
								},
							]}
						/>
						<Card
							size="small"
							title={
								<Space>
									<FileTextOutlined />
									受控原始请求/返回（最多 300 条）
								</Space>
							}
						>
							{rawLoading ? (
								<Flex justify="center" style={{ padding: 24 }}>
									<Spin />
								</Flex>
							) : rawTrace && rawTrace.entries.length > 0 ? (
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
											{
												key: "invocations",
												label: "实际调用",
												children: `${rawInvocations.length} 次`,
											},
											{
												key: "complete",
												label: "完整 request/response",
												children: `${rawInvocations.filter((item) => item.complete).length} 次`,
											},
											{
												key: "requests",
												label: "入参 JSON",
												children: `${rawInvocations.filter((item) => item.request).length} 份`,
											},
											{
												key: "responses",
												label: "返回 JSON",
												children: `${rawInvocations.filter((item) => item.response).length} 份`,
											},
										]}
									/>
									{rawTrace.truncated ? (
										<Alert
											type="warning"
											showIcon
											title={`匹配到 ${rawTrace.total} 条，当前展示前 ${rawTrace.maxEntries} 条`}
											description="请缩小时间范围或使用更具体的 Provider 请求号继续查看。"
										/>
									) : null}
									{rawInvocations.some((item) => !item.complete) ? (
										<Alert
											type="warning"
											showIcon
											title="链路存在未完整调用"
											description="下面按调用序号分别展示入参和返回；缺失或校验失败的一侧保持明确标记，不合并成成功结果。"
										/>
									) : null}
									<Collapse
										items={rawInvocations.map((invocation) => ({
											key: invocation.key,
											label: `${invocation.operation || "原始调用"} · ${rawLayerLabel(invocation.layer)} · ${invocation.attempt === 0 ? "首次" : `重试 ${invocation.attempt + 1}`}`,
											extra: invocation.complete ? (
												<Tag color="success">已校验</Tag>
											) : (
												<Tag color="warning">不完整</Tag>
											),
											children: rawInvocationPanel(invocation),
										}))}
									/>
									<Text type="secondary">
										查询窗口：{formatTime(rawTrace.since)} —{" "}
										{formatTime(rawTrace.until)}； 已匹配 journald{" "}
										{rawTrace.matchedJournalRecords} 个原始块
									</Text>
								</Space>
							) : (
								<Alert
									type="info"
									showIcon
									title="没有找到可关联的原始请求/返回"
									description="请使用带 traceId、requestId 或 Provider 请求号的日志记录，并确认日志仍在 journald 保留窗口内。"
								/>
							)}
						</Card>
					</Space>
				) : null}
			</Drawer>
		</main>
	);
}
