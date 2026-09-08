-- 0038 使用历史 updated_at 回填旧混合支付的预支付到期时间。部分历史
-- updated_at 曾由数据库本地时钟按 Asia/Shanghai 写入，而读取边界统一按 UTC
-- 解释，导致旧 prepay_id 最多被错误延长 8 小时。
--
-- 新预支付参数在创建时严格写为“当前时刻 + 2 小时”，所以任何仍待支付且
-- 到期时间晚于数据库 UTC 当前时刻 2 小时的记录都不可能是合法新值。只把
-- 这类异常旧参数立即置为过期；后续接口会先查原单并明确提示不要重复付款。
UPDATE hp_medical_insurance_orders
SET wechat_prepay_expires_at = UTC_TIMESTAMP(3),
	updated_at = UTC_TIMESTAMP(3)
WHERE status = 'cash_pending'
	AND wechat_payment_state = 'prepay_ready'
	AND wechat_mix_trade_no IS NOT NULL
	AND wechat_pay_params_ciphertext IS NOT NULL
	AND wechat_prepay_expires_at > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 2 HOUR);
