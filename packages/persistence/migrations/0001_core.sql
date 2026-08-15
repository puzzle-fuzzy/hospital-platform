-- Hospital Platform target schema.
-- This is a new target schema; it must be applied to a staging copy first.

-- Migration CLI uses this table to make an explicitly applied migration
-- observable and idempotent. Business tables remain independently guarded by
-- IF NOT EXISTS so a partially initialized local database can be repaired.
CREATE TABLE IF NOT EXISTS hp_schema_migrations (
	migration_id VARCHAR(128) NOT NULL,
	applied_at DATETIME(3) NOT NULL,
	PRIMARY KEY (migration_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_identity_users (
	user_id VARCHAR(64) NOT NULL,
	provider_subject VARCHAR(128) NOT NULL,
	union_id VARCHAR(128) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (user_id),
	UNIQUE KEY uq_hp_identity_provider_subject (provider_subject)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_patients (
	patient_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	display_name VARCHAR(128) NOT NULL,
	relationship VARCHAR(16) NOT NULL,
	card_number_masked VARCHAR(64) NOT NULL,
	source VARCHAR(32) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (patient_id),
	KEY ix_hp_patients_owner (owner_user_id),
	CONSTRAINT fk_hp_patients_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_payment_quotes (
	quote_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	insurance_fen BIGINT UNSIGNED NOT NULL,
	cash_fen BIGINT UNSIGNED NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	source VARCHAR(32) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	PRIMARY KEY (quote_id),
	KEY ix_hp_quotes_owner_patient (owner_user_id, patient_id),
	CONSTRAINT fk_hp_quotes_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_quotes_patient FOREIGN KEY (patient_id)
		REFERENCES hp_patients (patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_payment_orders (
	order_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	insurance_fen BIGINT UNSIGNED NOT NULL,
	cash_fen BIGINT UNSIGNED NOT NULL,
	state VARCHAR(32) NOT NULL,
	version INT UNSIGNED NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (order_id),
	UNIQUE KEY uq_hp_orders_owner_idempotency (owner_user_id, idempotency_key),
	KEY ix_hp_orders_owner_updated (owner_user_id, updated_at),
	CONSTRAINT fk_hp_orders_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_orders_patient FOREIGN KEY (patient_id)
		REFERENCES hp_patients (patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_outbox_events (
	event_id VARCHAR(96) NOT NULL,
	event_name VARCHAR(64) NOT NULL,
	aggregate_id VARCHAR(64) NOT NULL,
	payload JSON NOT NULL,
	occurred_at DATETIME(3) NOT NULL,
	available_at DATETIME(3) NOT NULL,
	attempts INT UNSIGNED NOT NULL DEFAULT 0,
	claimed_until DATETIME(3) NULL,
	processed_at DATETIME(3) NULL,
	last_error VARCHAR(512) NULL,
	created_at DATETIME(3) NOT NULL,
	PRIMARY KEY (event_id),
	KEY ix_hp_outbox_available (processed_at, available_at, claimed_until)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
