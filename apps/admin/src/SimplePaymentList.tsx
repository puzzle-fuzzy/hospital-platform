import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Empty, Input, Pagination, Spin, Tooltip } from "antd";
import { paymentRefundKey } from "./payment-refund-options";
import {
	simplePaymentRefundAction,
	simplePaymentRefundStatus,
	simplePaymentSentence,
} from "./simple-payment-display";
import type {
	AdminPaymentRefundType,
	AdminWechatRefundPaymentRecord,
} from "./types";
import "./simple-payment-list.css";

export type SimplePaymentListProps = {
	items: readonly AdminWechatRefundPaymentRecord[];
	loading: boolean;
	error?: string | undefined;
	page: number;
	pageSize: number;
	total: number;
	readOnly: boolean;
	onRefresh: () => void;
	onPageChange: (page: number, pageSize: number) => void;
	onRefund: (
		record: AdminWechatRefundPaymentRecord,
		refundType: AdminPaymentRefundType,
	) => void;
	onRefundQuery: (record: AdminWechatRefundPaymentRecord) => void;
	refundQueryingNo?: string | undefined;
	queryRequiredOrders?: ReadonlySet<string> | undefined;
	businessDay?: string | undefined;
	onBusinessDayChange?: ((value: string | undefined) => void) | undefined;
};

export function SimplePaymentList({
	items,
	loading,
	error,
	page,
	pageSize,
	total,
	readOnly,
	onRefresh,
	onPageChange,
	onRefund,
	onRefundQuery,
	refundQueryingNo,
	queryRequiredOrders,
	businessDay,
	onBusinessDayChange,
}: SimplePaymentListProps) {
	return (
		<section
			className="simple-payments"
			aria-label="支付展示"
			aria-busy={loading}
		>
			<div className="simple-payments-toolbar">
				<div className="simple-payments-filters">
					{onBusinessDayChange ? (
						<>
							<label
								className="simple-payments-date-label"
								htmlFor="simple-payment-day"
							>
								下单日期
							</label>
							<Input
								id="simple-payment-day"
								type="date"
								className="simple-payments-date"
								value={businessDay ?? ""}
								disabled={loading}
								onChange={(event) =>
									onBusinessDayChange(event.target.value || undefined)
								}
							/>
							<Button
								disabled={loading || !businessDay}
								onClick={() => onBusinessDayChange(undefined)}
							>
								全部日期
							</Button>
						</>
					) : (
						<p className="simple-payments-note">
							时间为下单时间（北京时间），金额为原支付实付。
						</p>
					)}
				</div>
				<Button icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>
					刷新
				</Button>
			</div>
			{onBusinessDayChange ? (
				<p className="simple-payments-note simple-payments-explanation">
					时间为下单时间（北京时间），金额为原支付实付。
				</p>
			) : null}
			{readOnly ? (
				<p className="simple-payments-note simple-payments-readonly">
					当前账号仅可查看，退费需使用操作员账号。
				</p>
			) : null}
			{error ? <Alert type="error" showIcon title={error} /> : null}
			<Spin spinning={loading}>
				{items.length === 0 ? (
					<div className="simple-payments-empty">
						<Empty
							image={Empty.PRESENTED_IMAGE_SIMPLE}
							description={
								error ? "支付记录加载失败，请刷新重试" : "暂无支付记录"
							}
						/>
					</div>
				) : (
					<ul className="simple-payments-list">
						{items.map((record) => {
							const key = paymentRefundKey(record);
							const queryRequired = queryRequiredOrders?.has(key) ?? false;
							const refundStatus = simplePaymentRefundStatus(
								record,
								queryRequired,
							);
							const action = simplePaymentRefundAction(record, {
								readOnly,
								queryRequired,
								busy: Boolean(refundQueryingNo),
							});
							return (
								<li className="simple-payment-row" key={key}>
									<p className="simple-payment-sentence">
										{simplePaymentSentence(record)}
										{refundStatus ? (
											<span className="simple-payment-refund-status">
												{refundStatus}
											</span>
										) : null}
									</p>
									<div className="simple-payment-actions">
										<Tooltip title={action.reason}>
											<span>
												<Button
													danger
													disabled={
														loading || Boolean(error) || action.disabled
													}
													onClick={() => onRefund(record, "ALL")}
												>
													退费
												</Button>
											</span>
										</Tooltip>
										{action.showQuery ? (
											<Button
												type="link"
												disabled={
													readOnly || loading || Boolean(refundQueryingNo)
												}
												loading={refundQueryingNo === key}
												onClick={() => onRefundQuery(record)}
											>
												查询退款
											</Button>
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</Spin>
			{total > 0 ? (
				<div className="simple-payments-pagination">
					<Pagination
						current={page}
						pageSize={pageSize}
						total={total}
						onChange={onPageChange}
						disabled={loading}
						showSizeChanger={false}
						showTotal={(count) => `共 ${count} 笔`}
					/>
				</div>
			) : null}
		</section>
	);
}
