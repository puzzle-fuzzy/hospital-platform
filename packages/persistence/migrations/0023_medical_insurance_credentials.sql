-- 医保 6201 payToken 的短期服务端凭证上下文。
-- 这里只保存 AES-GCM 密文；原文永不进入订单读模型、日志、outbox 或小程序响应。
CREATE TABLE IF NOT EXISTS hp_medical_insurance_credentials (
	credential_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	medical_order_id VARCHAR(64) NOT NULL,
	pay_ord_id VARCHAR(64) NOT NULL,
	purpose VARCHAR(16) NOT NULL COMMENT 'settlement/query',
	payload_ciphertext TEXT NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	revoked_at DATETIME(3) NULL,
	PRIMARY KEY (credential_id),
	KEY ix_hp_mi_credentials_order_purpose (owner_user_id, medical_order_id, purpose),
	KEY ix_hp_mi_credentials_expiry (expires_at, revoked_at),
	CONSTRAINT fk_hp_mi_credentials_order FOREIGN KEY (medical_order_id)
		REFERENCES hp_medical_insurance_orders (medical_order_id),
	CONSTRAINT fk_hp_mi_credentials_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
