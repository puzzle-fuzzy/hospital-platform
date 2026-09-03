-- 医保订单域（F 批次）：6201/6202/6301/6302 的事实聚合与查单任务。
-- payToken/revsToken 只保存 SHA-256 指纹；金额一律分；终态语义见 domain 状态机。
CREATE TABLE IF NOT EXISTS hp_medical_insurance_orders (
	medical_order_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	med_org_ord VARCHAR(64) NOT NULL COMMENT '6201 medOrgOrd 院内唯一流水',
	chrg_bchno VARCHAR(64) NOT NULL COMMENT '6201 收费批次号',
	pay_ord_id VARCHAR(64) NULL COMMENT '6201 返回的医保结算中心订单号',
	pay_token_hash CHAR(64) NULL COMMENT '6201 payToken 的 SHA-256，不存原文',
	status VARCHAR(32) NOT NULL,
	ord_stas VARCHAR(8) NULL COMMENT '最近一次 6202/6301/6302 的 ordStas 快照',
	total_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
	cash_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
	personal_account_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
	fund_fen BIGINT UNSIGNED NOT NULL DEFAULT 0,
	setl_type VARCHAR(8) NULL COMMENT 'ALL/CASH/HI',
	revs_token_hash CHAR(64) NULL,
	revs_token_expires_at DATETIME(3) NULL COMMENT '冲正授权 1 小时窗口',
	last_error VARCHAR(512) NULL,
	version INT UNSIGNED NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (medical_order_id),
	UNIQUE KEY uq_hp_mi_orders_owner_idempotency (owner_user_id, idempotency_key),
	UNIQUE KEY uq_hp_mi_orders_med_org_ord (med_org_ord),
	UNIQUE KEY uq_hp_mi_orders_pay_ord_id (pay_ord_id),
	KEY ix_hp_mi_orders_owner_updated (owner_user_id, updated_at),
	CONSTRAINT fk_hp_mi_orders_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_mi_orders_patient FOREIGN KEY (patient_id)
		REFERENCES hp_patients (patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_medical_insurance_query_tasks (
	task_id VARCHAR(64) NOT NULL,
	medical_order_id VARCHAR(64) NOT NULL,
	status VARCHAR(32) NOT NULL COMMENT 'pending/in_progress/awaiting_confirmation/completed/manual_review',
	attempts INT UNSIGNED NOT NULL DEFAULT 0,
	max_attempts INT UNSIGNED NOT NULL,
	next_attempt_at DATETIME(3) NOT NULL,
	claimed_until DATETIME(3) NULL,
	terminal_ord_stas VARCHAR(8) NULL,
	last_error_code VARCHAR(64) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (task_id),
	KEY ix_hp_mi_query_available (status, next_attempt_at, claimed_until),
	KEY ix_hp_mi_query_order (medical_order_id),
	CONSTRAINT fk_hp_mi_query_order FOREIGN KEY (medical_order_id)
		REFERENCES hp_medical_insurance_orders (medical_order_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
