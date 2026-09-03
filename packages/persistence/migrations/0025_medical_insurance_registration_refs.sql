-- 医保订单与预约的服务端关联；authCode 和 payToken 仍不落库。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN appointment_id VARCHAR(64) NULL AFTER patient_id,
	ADD COLUMN authorization_id VARCHAR(128) NULL AFTER appointment_id,
	ADD KEY ix_hp_mi_orders_appointment (owner_user_id, appointment_id);
