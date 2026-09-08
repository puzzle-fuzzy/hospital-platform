-- 微信医保混合查单在医保部分失败时返回的医保局侧具体原因。
-- 仅在 med_ins_pay_status=MED_INS_PAY_FAIL 时由服务端写入并透传。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN med_ins_fail_reason VARCHAR(2048) NULL COMMENT '医保支付失败原因，仅医保部分失败时保存' AFTER last_error;
