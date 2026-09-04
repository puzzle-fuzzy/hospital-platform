-- 医保订单统一业务键：挂号和门诊共用一张订单表，由业务类型区分协议语义。
-- 历史订单按 appointment_id 回填为 registration/RegPay；不修改任何支付状态、金额
-- 或 provider 凭证，便于新代码上线后继续处理旧订单。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN business_type VARCHAR(24) NOT NULL DEFAULT 'registration' COMMENT 'registration/outpatient' AFTER patient_id,
	ADD COLUMN order_type VARCHAR(24) NOT NULL DEFAULT 'RegPay' COMMENT 'RegPay/DiagPay' AFTER business_type,
	ADD COLUMN business_id VARCHAR(128) NULL COMMENT '统一业务事实主键；挂号为 appointment，门诊为费用记录' AFTER order_type,
	ADD KEY ix_hp_mi_orders_owner_business (owner_user_id, business_type, business_id);

UPDATE hp_medical_insurance_orders
SET business_id = appointment_id
WHERE business_id IS NULL AND appointment_id IS NOT NULL;

