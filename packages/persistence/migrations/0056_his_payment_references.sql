-- 内部 scope 主键不属于公开编号；历史确认只登记真实回执。
-- 新发送号由独立计数器在完成完整历史索引后分配。
CREATE TABLE IF NOT EXISTS hp_his_payment_reference_scopes (
	allocation_id BIGINT NOT NULL AUTO_INCREMENT,
	owner_user_id VARCHAR(64) NOT NULL,
	medical_order_id VARCHAR(64) NOT NULL,
	payment_scope_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
	source VARCHAR(16) NOT NULL,
	request_reference_id BIGINT NULL,
	status VARCHAR(16) NOT NULL,
	receipt_id BIGINT NULL,
	created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	PRIMARY KEY (allocation_id),
	UNIQUE KEY uq_hp_his_reference_scope (medical_order_id, source, payment_scope_id),
	UNIQUE KEY uq_hp_his_reference_request (request_reference_id),
	CONSTRAINT fk_hp_his_reference_order FOREIGN KEY (medical_order_id)
		REFERENCES hp_medical_insurance_orders (medical_order_id),
	CONSTRAINT fk_hp_his_reference_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT ck_hp_his_reference_source CHECK (source IN ('plugin', 'component')),
	CONSTRAINT ck_hp_his_reference_request CHECK (request_reference_id IS NULL OR request_reference_id > 0),
	CONSTRAINT ck_hp_his_reference_status CHECK (
		(status = 'allocated' AND request_reference_id IS NOT NULL AND receipt_id IS NULL) OR
		(status = 'confirmed' AND receipt_id IS NOT NULL AND receipt_id > 0)
	)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_his_payment_references (
	reference_id BIGINT NOT NULL,
	allocation_id BIGINT NOT NULL,
	conflicted TINYINT UNSIGNED NOT NULL DEFAULT 0,
	PRIMARY KEY (reference_id),
	KEY ix_hp_his_reference_allocation (allocation_id),
	CONSTRAINT fk_hp_his_reference_allocation FOREIGN KEY (allocation_id)
		REFERENCES hp_his_payment_reference_scopes (allocation_id),
	CONSTRAINT ck_hp_his_reference_alias_positive CHECK (reference_id > 0),
	CONSTRAINT ck_hp_his_reference_alias_conflicted CHECK (conflicted IN (0, 1))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_his_payment_reference_allocator (
	singleton_id TINYINT UNSIGNED NOT NULL,
	initialized TINYINT UNSIGNED NOT NULL DEFAULT 0,
	next_reference_id BIGINT NULL DEFAULT 1,
	initialized_at DATETIME(3) NULL,
	PRIMARY KEY (singleton_id),
	CONSTRAINT ck_hp_his_reference_allocator_singleton CHECK (singleton_id = 1),
	CONSTRAINT ck_hp_his_reference_allocator_initialized CHECK (initialized IN (0, 1)),
	CONSTRAINT ck_hp_his_reference_allocator_next CHECK (next_reference_id IS NULL OR next_reference_id > 0)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

INSERT INTO hp_his_payment_reference_allocator (singleton_id, initialized, next_reference_id)
VALUES (1, 0, 1)
ON DUPLICATE KEY UPDATE singleton_id = singleton_id;
