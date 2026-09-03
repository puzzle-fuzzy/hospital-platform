-- 2.27.2.32 → 2.6.65.5 后置结算所需 provider 事实。
-- 该列只保存 AES-GCM 密文，原始费用明细、参保信息和 provider 流水不进入订单读模型。
ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN settlement_context_ciphertext TEXT NULL AFTER last_error;
