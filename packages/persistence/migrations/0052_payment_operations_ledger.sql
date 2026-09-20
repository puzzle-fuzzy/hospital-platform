-- 平台支付运营账本只保存已验证的低敏事实和摘要，不保存医保/微信原始报文、密钥或调起参数。
-- 聚合单与支付腿是平台投影，不替代 hp_payment_orders、hp_medical_insurance_orders
-- 或 provider 的真实交易身份；回填和新投影都必须幂等，不能改变外部支付终态。
CREATE TABLE IF NOT EXISTS hp_payment_aggregates (
	aggregate_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	business VARCHAR(32) NOT NULL,
	business_key VARCHAR(128) NOT NULL,
	business_id VARCHAR(128) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	insurance_fen BIGINT UNSIGNED NOT NULL,
	cash_fen BIGINT UNSIGNED NOT NULL,
	status VARCHAR(32) NOT NULL,
	his_sync_status VARCHAR(32) NOT NULL,
	source_version INT UNSIGNED NOT NULL,
	version INT UNSIGNED NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (aggregate_id),
	UNIQUE KEY uq_hp_payment_aggregates_business_key (business_key),
	KEY ix_hp_payment_aggregates_owner_updated (owner_user_id, updated_at),
	KEY ix_hp_payment_aggregates_status_updated (status, updated_at),
	CONSTRAINT fk_hp_payment_aggregates_owner
		FOREIGN KEY (owner_user_id) REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_payment_aggregates_patient
		FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_payment_legs (
	leg_id VARCHAR(64) NOT NULL,
	aggregate_id VARCHAR(64) NOT NULL,
	leg_type VARCHAR(32) NOT NULL,
	source VARCHAR(32) NOT NULL,
	source_order_id VARCHAR(64) NOT NULL,
	amount_fen BIGINT UNSIGNED NOT NULL,
	status VARCHAR(32) NOT NULL,
	provider_reference_digest CHAR(64) NULL,
	confirmed_at DATETIME(3) NULL,
	version INT UNSIGNED NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (leg_id),
	UNIQUE KEY uq_hp_payment_legs_aggregate_type (aggregate_id, leg_type),
	KEY ix_hp_payment_legs_source_order (source, source_order_id),
	KEY ix_hp_payment_legs_status_updated (status, updated_at),
	CONSTRAINT fk_hp_payment_legs_aggregate
		FOREIGN KEY (aggregate_id) REFERENCES hp_payment_aggregates (aggregate_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_payment_events (
	event_id VARCHAR(64) NOT NULL,
	aggregate_id VARCHAR(64) NOT NULL,
	leg_id VARCHAR(64) NULL,
	source VARCHAR(32) NOT NULL,
	event_type VARCHAR(64) NOT NULL,
	previous_status VARCHAR(32) NULL,
	next_status VARCHAR(32) NOT NULL,
	amount_fen BIGINT UNSIGNED NULL,
	provider_request_id VARCHAR(128) NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	event_at DATETIME(3) NOT NULL,
	payload_digest CHAR(64) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	PRIMARY KEY (event_id),
	UNIQUE KEY uq_hp_payment_events_aggregate_idempotency (aggregate_id, idempotency_key),
	KEY ix_hp_payment_events_aggregate_event_at (aggregate_id, event_at, event_id),
	KEY ix_hp_payment_events_source_request (source, provider_request_id),
	CONSTRAINT fk_hp_payment_events_aggregate
		FOREIGN KEY (aggregate_id) REFERENCES hp_payment_aggregates (aggregate_id),
	CONSTRAINT fk_hp_payment_events_leg
		FOREIGN KEY (leg_id) REFERENCES hp_payment_legs (leg_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
