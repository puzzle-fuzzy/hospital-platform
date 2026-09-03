-- 官方微信医保混合支付的服务端事实。
-- mix_trade_no 是 provider 可关联引用；pay params 只保存部署密钥加密后的密文。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN wechat_mix_trade_no VARCHAR(64) NULL COMMENT '微信医保混合订单号' AFTER last_error,
	ADD COLUMN wechat_out_trade_no VARCHAR(64) NULL COMMENT '微信JSAPI自费预下单号' AFTER wechat_mix_trade_no,
	ADD COLUMN wechat_payment_state VARCHAR(24) NOT NULL DEFAULT 'not_started' COMMENT 'not_started/prepay_ready/cash_paid/failed/unknown' AFTER wechat_out_trade_no,
	ADD COLUMN wechat_pay_params_ciphertext TEXT NULL COMMENT '微信小程序调起参数密文' AFTER wechat_payment_state,
	ADD UNIQUE KEY uq_hp_mi_orders_wechat_mix_trade_no (wechat_mix_trade_no);
