-- 强制支付事实的 owner 与 patient/order 归属一致，避免只依赖应用层校验。
-- 旧数据若存在跨 owner 引用，应在 staging 迁移前清理；迁移失败时保持 schema gate 关闭。
ALTER TABLE hp_patients
	ADD UNIQUE KEY uq_hp_patients_owner_patient (owner_user_id, patient_id);

ALTER TABLE hp_payment_orders
	ADD UNIQUE KEY uq_hp_orders_owner_order (owner_user_id, order_id),
	DROP FOREIGN KEY fk_hp_orders_patient,
	ADD CONSTRAINT fk_hp_orders_owner_patient FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id);

ALTER TABLE hp_payment_quotes
	DROP FOREIGN KEY fk_hp_quotes_patient,
	ADD CONSTRAINT fk_hp_quotes_owner_patient FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id);

ALTER TABLE hp_payment_prepay_attempts
	DROP FOREIGN KEY fk_hp_prepay_order,
	ADD CONSTRAINT fk_hp_prepay_owner_order FOREIGN KEY (owner_user_id, order_id)
		REFERENCES hp_payment_orders (owner_user_id, order_id);
