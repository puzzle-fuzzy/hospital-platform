-- 众阳 2.6.65.9 以 2.6.65.2 下单时的 recordCode 回查支付结果。
-- 只保存 SHA-256 索引，完整 recordCode 继续留在 AES-GCM 密文上下文中。
ALTER TABLE hp_payment_orders
	ADD COLUMN registration_self_pay_record_code_hash CHAR(64) NULL
		AFTER registration_self_pay_context_ciphertext,
	ADD UNIQUE KEY uq_hp_payment_orders_registration_record_code_hash
		(registration_self_pay_record_code_hash);
