-- 同步/对账框架只保存任务状态、金额/状态比较结果和证据摘要。
-- 不保存 HIS、医保或微信完整请求响应；外部合同未确认前不得据此自动写回终态。
CREATE TABLE IF NOT EXISTS hp_payment_sync_tasks (
	task_id VARCHAR(64) NOT NULL,
	aggregate_id VARCHAR(64) NOT NULL,
	business_key VARCHAR(128) NOT NULL,
	source VARCHAR(32) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	status VARCHAR(32) NOT NULL,
	attempts INT UNSIGNED NOT NULL,
	max_attempts INT UNSIGNED NOT NULL,
	next_run_at DATETIME(3) NOT NULL,
	claimed_until DATETIME(3) NULL,
	last_error_code VARCHAR(64) NULL,
	result_digest CHAR(64) NULL,
	version INT UNSIGNED NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (task_id),
	UNIQUE KEY uq_hp_payment_sync_task_key (aggregate_id, business_key, source, kind),
	KEY ix_hp_payment_sync_task_due (status, next_run_at, claimed_until),
	KEY ix_hp_payment_sync_task_aggregate (aggregate_id, updated_at),
	CONSTRAINT fk_hp_payment_sync_task_aggregate
		FOREIGN KEY (aggregate_id) REFERENCES hp_payment_aggregates (aggregate_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_payment_reconciliation_results (
	result_id VARCHAR(64) NOT NULL,
	aggregate_id VARCHAR(64) NOT NULL,
	source VARCHAR(32) NOT NULL,
	observation_key VARCHAR(128) NOT NULL,
	outcome VARCHAR(32) NOT NULL,
	expected_amount_fen BIGINT UNSIGNED NULL,
	observed_amount_fen BIGINT UNSIGNED NULL,
	amount_delta_fen BIGINT NULL,
	expected_status VARCHAR(64) NULL,
	observed_status VARCHAR(64) NULL,
	resolution VARCHAR(32) NOT NULL,
	evidence_digest CHAR(64) NOT NULL,
	observed_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	PRIMARY KEY (result_id),
	UNIQUE KEY uq_hp_payment_reconciliation_observation (aggregate_id, source, observation_key),
	KEY ix_hp_payment_reconciliation_aggregate_time (aggregate_id, observed_at, result_id),
	KEY ix_hp_payment_reconciliation_resolution (resolution, observed_at),
	CONSTRAINT fk_hp_payment_reconciliation_aggregate
		FOREIGN KEY (aggregate_id) REFERENCES hp_payment_aggregates (aggregate_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
