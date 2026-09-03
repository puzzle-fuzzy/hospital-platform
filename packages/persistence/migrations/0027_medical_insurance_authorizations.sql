-- 医保授权解析后的短期上下文；payAuthNo/ecToken/参保身份全部存密文。
-- 订单表只保存 authorization_id，接口重试按 owner + 订单重新取回。
CREATE TABLE IF NOT EXISTS hp_medical_insurance_authorizations (
	authorization_id VARCHAR(128) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	medical_order_id VARCHAR(64) NOT NULL,
	payload_ciphertext TEXT NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (authorization_id),
	KEY ix_hp_mi_authorizations_order (owner_user_id, medical_order_id, created_at),
	KEY ix_hp_mi_authorizations_expiry (expires_at),
	CONSTRAINT fk_hp_mi_authorizations_order FOREIGN KEY (medical_order_id)
		REFERENCES hp_medical_insurance_orders (medical_order_id),
	CONSTRAINT fk_hp_mi_authorizations_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

ALTER TABLE hp_medical_insurance_orders
	ADD COLUMN mdtrt_id VARCHAR(128) NULL AFTER pay_token_hash;
