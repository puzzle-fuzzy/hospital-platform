-- hp_* 的 DATETIME(3) 统一保存 UTC。0038 曾使用数据库会话的 NOW(3)
-- 唤醒混合支付查单任务；当数据库会话运行在 Asia/Shanghai 时，这会让 Worker
-- 按 UTC 比较后误以为任务还要等待 8 小时。这里使用 UTC_TIMESTAMP(3) 重新
-- 唤醒仍可自动处理的本人混合支付任务；已经进入人工复核的业务失败不自动重开。
UPDATE hp_medical_insurance_query_tasks AS task
INNER JOIN hp_medical_insurance_orders AS medical_order
	ON medical_order.medical_order_id = task.medical_order_id
SET task.status = 'pending',
	task.attempts = 0,
	task.next_attempt_at = UTC_TIMESTAMP(3),
	task.claimed_until = NULL,
	task.terminal_ord_stas = NULL,
	task.last_error_code = NULL,
	task.version = task.version + 1,
	task.updated_at = UTC_TIMESTAMP(3)
WHERE medical_order.status = 'cash_pending'
	AND medical_order.wechat_mix_trade_no IS NOT NULL
	AND task.status <> 'manual_review';
