import {
	CheckCircleOutlined,
	ClockCircleOutlined,
	ReloadOutlined,
	SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
	Alert,
	App as AntdApp,
	Button,
	Card,
	Checkbox,
	Descriptions,
	Divider,
	Flex,
	Input,
	InputNumber,
	Modal,
	Select,
	Space,
	Tag,
	Typography,
} from "antd";
import { useState } from "react";
import { ApiError, queryWechatRefund, requestWechatRefund } from "./api";
import type { Session, WechatRefund, WechatRefundSource } from "./types";

const { Text, Title } = Typography;

function statusLabel(status: WechatRefund["status"]): string {
	return {
		requested: "已受理，待查单",
		processing: "退款处理中",
		success: "退款成功",
		closed: "退款已关闭",
		abnormal: "退款异常",
		unknown: "结果未知，必须查单",
		request_failed: "申请失败，可用原幂等键重试",
	}[status];
}

function statusColor(status: WechatRefund["status"]): string {
	return status === "success"
		? "success"
		: status === "processing" || status === "requested"
			? "processing"
			: status === "abnormal" ||
					status === "unknown" ||
					status === "request_failed"
				? "warning"
				: "default";
}

function sourceLabel(source: WechatRefundSource): string {
	return source === "medical_insurance"
		? "医保混合单的微信自费"
		: "普通微信自费";
}

function fen(value: number): string {
	return `${value.toLocaleString("zh-CN")} 分（¥${(value / 100).toFixed(2)}）`;
}

function newIdempotencyKey(): string {
	return `admin-refund-${crypto.randomUUID()}`;
}

export function RefundPanel({
	session,
	onExpired,
}: {
	session: Session;
	onExpired: () => void;
}) {
	const { message } = AntdApp.useApp();
	const [source, setSource] = useState<WechatRefundSource>("payment_order");
	const [orderId, setOrderId] = useState("");
	const [refundFen, setRefundFen] = useState<number>();
	const [reason, setReason] = useState("");
	const [confirmed, setConfirmed] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [querying, setQuerying] = useState(false);
	const [record, setRecord] = useState<WechatRefund>();
	const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

	const openConfirm = () => {
		if (!orderId.trim()) return void message.error("请输入原支付订单号");
		if (!refundFen || !Number.isSafeInteger(refundFen) || refundFen <= 0) {
			return void message.error("请输入正整数退费金额（分）");
		}
		if (!confirmed) return void message.error("请先确认这是已核对的退费操作");
		setConfirmOpen(true);
	};

	const submit = async () => {
		const amount = refundFen;
		if (!amount || !Number.isSafeInteger(amount) || amount <= 0) {
			void message.error("请输入正整数退费金额（分）");
			return;
		}
		setSubmitting(true);
		try {
			const next = await requestWechatRefund(
				{
					source,
					orderId: orderId.trim(),
					refundFen: amount,
					idempotencyKey,
					...(reason.trim() ? { reason: reason.trim() } : {}),
				},
				session,
			);
			setRecord(next);
			setConfirmOpen(false);
			void message.success("微信退费申请已提交，当前状态已落账");
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				onExpired();
				return;
			}
			void message.error(
				error instanceof Error ? error.message : "微信退费申请失败",
			);
		} finally {
			setSubmitting(false);
		}
	};

	const refresh = async () => {
		if (!record) return;
		setQuerying(true);
		try {
			setRecord(await queryWechatRefund(record.merchantRefundNo, session));
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				onExpired();
				return;
			}
			void message.error(
				error instanceof Error ? error.message : "退款查单失败",
			);
		} finally {
			setQuerying(false);
		}
	};

	const clear = () => {
		setRecord(undefined);
		setOrderId("");
		setRefundFen(undefined);
		setReason("");
		setConfirmed(false);
		setIdempotencyKey(newIdempotencyKey());
	};

	return (
		<main className="console-content payment-page">
			<div className="content-heading">
				<div>
					<Title level={2}>微信退费</Title>
					<Text type="secondary">
						仅处理已确认支付成功的微信自费金额；医保基金部分不在此入口退费。
					</Text>
				</div>
			</div>
			<Alert
				type="warning"
				showIcon
				icon={<SafetyCertificateOutlined />}
				title="退费会产生真实资金操作"
				description="提交后服务端会使用同一商户退款单号保持幂等。微信申请成功只代表受理，最终结果要以查单返回的 SUCCESS/CLOSED/ABNORMAL 为准。"
			/>
			<Card title="发起微信自费退费" className="payment-search-card">
				<Space orientation="vertical" size={14} style={{ width: "100%" }}>
					<Flex gap={12} wrap="wrap">
						<div style={{ minWidth: 280, flex: 1 }}>
							<Text strong>资金来源</Text>
							<Select
								style={{ width: "100%", marginTop: 6 }}
								value={source}
								onChange={(value) => setSource(value)}
								options={[
									{ value: "payment_order", label: "普通微信自费订单" },
									{ value: "medical_insurance", label: "医保混合单的微信自费" },
								]}
							/>
						</div>
						<div style={{ minWidth: 280, flex: 2 }}>
							<Text strong>
								{source === "medical_insurance"
									? "医保订单号"
									: "普通支付订单号"}
							</Text>
							<Input
								style={{ marginTop: 6 }}
								value={orderId}
								onChange={(event) => setOrderId(event.target.value)}
								placeholder="请输入服务端订单号"
								maxLength={64}
							/>
						</div>
					</Flex>
					<Flex gap={12} wrap="wrap">
						<div style={{ minWidth: 220, flex: 1 }}>
							<Text strong>退费金额（分）</Text>
							<InputNumber<number>
								style={{ width: "100%", marginTop: 6 }}
								min={1}
								precision={0}
								value={refundFen ?? null}
								onChange={(value) => setRefundFen(value ?? undefined)}
								placeholder="例如 100 = ¥1.00"
							/>
						</div>
						<div style={{ minWidth: 280, flex: 2 }}>
							<Text strong>退款原因（可选）</Text>
							<Input
								style={{ marginTop: 6 }}
								value={reason}
								onChange={(event) => setReason(event.target.value)}
								placeholder="最多 80 字节"
								maxLength={80}
							/>
						</div>
					</Flex>
					<Checkbox
						checked={confirmed}
						onChange={(event) => setConfirmed(event.target.checked)}
					>
						我已核对原支付订单、退费金额和退费对象，确认执行真实微信退费。
					</Checkbox>
					<Flex gap={8}>
						<Button type="primary" danger onClick={openConfirm}>
							提交微信退费
						</Button>
						<Button onClick={clear}>清空</Button>
					</Flex>
				</Space>
			</Card>
			{record ? (
				<Card title="退款台账" className="payment-flow-card">
					<Descriptions
						bordered
						column={2}
						items={[
							{
								key: "source",
								label: "资金来源",
								children: sourceLabel(record.source),
							},
							{
								key: "order",
								label: "原支付订单",
								children: record.sourceOrderId,
							},
							{
								key: "refund",
								label: "商户退款单号",
								children: record.merchantRefundNo,
							},
							{
								key: "amount",
								label: "退款金额",
								children: fen(record.refundFen),
							},
							{
								key: "status",
								label: "当前状态",
								children: (
									<Tag color={statusColor(record.status)}>
										{statusLabel(record.status)}
									</Tag>
								),
							},
							{
								key: "provider",
								label: "微信退款状态",
								children: record.providerStatus || "—",
							},
							{
								key: "providerRefund",
								label: "微信退款单号",
								children: record.providerRefundId || "—",
							},
							{
								key: "success",
								label: "退款成功时间",
								children: record.successTime || "—",
							},
							{
								key: "error",
								label: "最近错误码",
								children: record.lastErrorCode || "—",
							},
						]}
					/>
					<Divider />
					<Flex gap={8}>
						<Button
							icon={<ReloadOutlined />}
							loading={querying}
							onClick={() => void refresh()}
						>
							查询最新状态
						</Button>
						<Text type="secondary">
							{record.status === "success" ? (
								<CheckCircleOutlined />
							) : (
								<ClockCircleOutlined />
							)}{" "}
							最近更新 {record.updatedAt}
						</Text>
					</Flex>
				</Card>
			) : null}
			<Modal
				title="确认执行微信退费"
				open={confirmOpen}
				confirmLoading={submitting}
				okText="确认退费"
				okButtonProps={{ danger: true }}
				cancelText="取消"
				onOk={() => void submit()}
				onCancel={() => setConfirmOpen(false)}
			>
				<Alert
					type="error"
					showIcon
					title="该操作不可由页面自动撤销"
					description={`将对${sourceLabel(source)} ${orderId.trim()}发起 ${refundFen ? fen(refundFen) : "—"} 的原路退款。`}
				/>
			</Modal>
		</main>
	);
}
