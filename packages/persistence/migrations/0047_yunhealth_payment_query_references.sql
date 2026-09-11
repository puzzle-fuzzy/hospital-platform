-- 众阳非 HIS 收款会在 2.6.65.5 内按每笔 2.6.65.2 的 recordCode 反调 2.6.65.9。
-- 医保混合单可能有多笔分项，因此不能复用 hp_payment_orders 上的单值索引。
-- 这里只保存 SHA-256 和平台内部引用；recordCode 明文仍只存在 AES-GCM 密文上下文中。
CREATE TABLE IF NOT EXISTS hp_yunhealth_payment_query_references (
	record_code_hash CHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	medical_order_id VARCHAR(64) NOT NULL,
	component_id VARCHAR(128) NOT NULL,
	created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (record_code_hash),
	UNIQUE KEY uq_hp_yunhealth_query_order_component (medical_order_id, component_id),
	KEY ix_hp_yunhealth_query_owner_order (owner_user_id, medical_order_id),
	CONSTRAINT fk_hp_yunhealth_query_medical_order FOREIGN KEY (medical_order_id)
		REFERENCES hp_medical_insurance_orders (medical_order_id),
	CONSTRAINT fk_hp_yunhealth_query_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
