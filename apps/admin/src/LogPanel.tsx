import { Tag, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchLogPage } from "./api";
import type { AdminLogLevel, AdminLogRecord, Session } from "./types";

const POLL_INTERVAL_MS = 2_000;
const TERMINAL_RECORD_LIMIT = 200;
const { Text } = Typography;

function formatTime(value: string): string {
	const time = new Date(value);
	if (Number.isNaN(time.getTime())) return value;
	return time.toLocaleTimeString("zh-CN", {
		hour12: false,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: 3,
	});
}

function levelLabel(level: AdminLogLevel): string {
	return level.toUpperCase().padEnd(5, " ");
}

function recordText(record: AdminLogRecord): string {
	const endpoint = [
		record.method || "EVENT",
		record.path || record.event || "-",
	]
		.join(" ")
		.trim();
	const status =
		record.statusCode === undefined ? "-" : String(record.statusCode);
	const duration =
		record.durationMs === undefined ? "-" : `${record.durationMs}ms`;
	const correlation = record.traceId || record.requestId || "-";
	const provider = record.providerOperation
		? ` provider=${record.providerOperation}`
		: "";
	const error = record.errorCode || record.errorName;
	return `${formatTime(record.timestamp)} ${levelLabel(record.level)} ${record.service} ${endpoint} status=${status} duration=${duration} trace=${correlation}${provider}${error ? ` error=${error}` : ""}`;
}

function levelClass(level: AdminLogLevel): string {
	return `terminal-line terminal-line-${level}`;
}

export function LogPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const [records, setRecords] = useState<AdminLogRecord[]>([]);
	const [error, setError] = useState<string>();
	const [lastUpdated, setLastUpdated] = useState<Date>();
	const terminalRef = useRef<HTMLDivElement>(null);
	const followBottomRef = useRef(true);
	const mountedRef = useRef(true);
	const latestRecordId = records.at(-1)?.id;

	useEffect(() => {
		return () => {
			mountedRef.current = false;
		};
	}, []);

	const load = useCallback(async () => {
		try {
			const page = await fetchLogPage({ page: 1, pageSize: 100 }, session);
			if (!mountedRef.current) return;
			setRecords(
				page.items
					.slice()
					.sort((left, right) => left.timestamp.localeCompare(right.timestamp))
					.slice(-TERMINAL_RECORD_LIMIT),
			);
			setLastUpdated(new Date());
			setError(undefined);
		} catch (reason) {
			if (!mountedRef.current) return;
			if (reason instanceof ApiError && reason.status === 401) {
				onExpired();
				return;
			}
			setError(reason instanceof Error ? reason.message : "日志连接失败");
		}
	}, [onExpired, session]);

	useEffect(() => {
		void load();
		const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
		return () => window.clearInterval(timer);
	}, [load]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal || !followBottomRef.current || latestRecordId === undefined)
			return;
		terminal.scrollTop = terminal.scrollHeight;
	}, [latestRecordId]);

	return (
		<main className="console-content terminal-page">
			<div className="terminal-toolbar">
				<div>
					<Text strong>实时日志</Text>
					<Text type="secondary" className="terminal-toolbar-note">
						每 2 秒自动更新 · 仅显示安全元数据
					</Text>
				</div>
				<Tag color={error ? "error" : "green"}>
					{error ? "连接异常" : "LIVE"}
				</Tag>
			</div>
			<div
				ref={terminalRef}
				className="log-terminal"
				onScroll={(event) => {
					const node = event.currentTarget;
					followBottomRef.current =
						node.scrollHeight - node.scrollTop - node.clientHeight < 48;
				}}
				role="log"
				aria-live="polite"
				aria-label="实时接口日志"
			>
				<div className="terminal-line terminal-line-system">
					<span className="terminal-prompt">$</span> hospital-admin tail
					--follow
				</div>
				{records.length === 0 ? (
					<div className="terminal-line terminal-line-dim">
						等待新的日志记录…
					</div>
				) : (
					records.map((record) => (
						<div className={levelClass(record.level)} key={record.id}>
							{recordText(record)}
						</div>
					))
				)}
				{error ? (
					<div className="terminal-line terminal-line-error">
						[poll] {error}
					</div>
				) : null}
			</div>
			<div className="terminal-status">
				<span>{records.length} 条可见记录</span>
				<span>
					{lastUpdated
						? `最后更新 ${formatTime(lastUpdated.toISOString())}`
						: "正在连接…"}
				</span>
			</div>
		</main>
	);
}
