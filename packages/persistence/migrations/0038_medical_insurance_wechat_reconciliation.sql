-- 微信医保混合支付的 prepay_id 只能在两小时内调起；保存服务端到期时间，
-- 禁止小程序无限复用旧签名。out_trade_no 同一时刻只能关联一笔医保订单。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN wechat_prepay_expires_at DATETIME(3) NULL COMMENT '微信JSAPI预支付参数到期时间' AFTER wechat_pay_params_ciphertext,
	ADD UNIQUE KEY uq_hp_mi_orders_wechat_out_trade_no (wechat_out_trade_no);

UPDATE hp_medical_insurance_orders
SET wechat_prepay_expires_at = DATE_ADD(updated_at, INTERVAL 2 HOUR)
WHERE wechat_pay_params_ciphertext IS NOT NULL
	AND wechat_prepay_expires_at IS NULL;

-- 旧版本曾在“自费成功、医保仍处理中”时提前写 cash_paid。发布新闸门时把
-- 尚未完成医院结算的历史值降回 unknown，必须经官方混合查单重新确认。
UPDATE hp_medical_insurance_orders
SET wechat_payment_state = 'unknown', updated_at = NOW(3)
WHERE status = 'cash_pending' AND wechat_payment_state = 'cash_paid';

-- 已有混合单可能被旧 Worker 误判为终态并关闭查单任务。重新唤醒这些任务，
-- 发布后立即以微信官方混合查单结果确认医保和自费两段，再进入 HIS 回写。
UPDATE hp_medical_insurance_query_tasks AS task
INNER JOIN hp_medical_insurance_orders AS medical_order
	ON medical_order.medical_order_id = task.medical_order_id
SET task.status = 'pending',
	task.attempts = 0,
	task.next_attempt_at = NOW(3),
	task.claimed_until = NULL,
	task.terminal_ord_stas = NULL,
	task.last_error_code = NULL,
	task.version = task.version + 1,
	task.updated_at = NOW(3)
WHERE medical_order.status = 'cash_pending'
	AND medical_order.wechat_mix_trade_no IS NOT NULL
	AND task.status <> 'manual_review';

INSERT INTO hp_medical_insurance_query_tasks (
	task_id,
	medical_order_id,
	status,
	attempts,
	max_attempts,
	next_attempt_at,
	claimed_until,
	last_error_code,
	terminal_ord_stas,
	version,
	created_at,
	updated_at
)
SELECT
	medical_order.medical_order_id,
	medical_order.medical_order_id,
	'pending',
	0,
	12,
	NOW(3),
	NULL,
	NULL,
	NULL,
	1,
	NOW(3),
	NOW(3)
FROM hp_medical_insurance_orders AS medical_order
LEFT JOIN hp_medical_insurance_query_tasks AS task
	ON task.medical_order_id = medical_order.medical_order_id
WHERE medical_order.status = 'cash_pending'
	AND medical_order.wechat_mix_trade_no IS NOT NULL
	AND task.medical_order_id IS NULL;
