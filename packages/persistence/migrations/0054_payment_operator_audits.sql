-- Admin 操作审计只保存动作、目标聚合单、请求引用和结果摘要。
-- operator_ref 在现有 Admin 令牌没有稳定操作者身份时保持 NULL，禁止把令牌原文落库。
CREATE TABLE IF NOT EXISTS hp_payment_operator_audits (
	audit_id VARCHAR(64) NOT NULL,
	operator_ref VARCHAR(128) NULL,
	action VARCHAR(32) NOT NULL,
	aggregate_id VARCHAR(64) NULL,
	request_id VARCHAR(128) NULL,
	outcome VARCHAR(32) NOT NULL,
	reason_code VARCHAR(64) NULL,
	result_digest CHAR(64) NULL,
	occurred_at DATETIME(3) NOT NULL,
	PRIMARY KEY (audit_id),
	KEY ix_hp_payment_operator_audits_aggregate_time (aggregate_id, occurred_at, audit_id),
	KEY ix_hp_payment_operator_audits_operator_time (operator_ref, occurred_at, audit_id),
	KEY ix_hp_payment_operator_audits_action_time (action, occurred_at, audit_id),
	CONSTRAINT fk_hp_payment_operator_audits_aggregate
		FOREIGN KEY (aggregate_id) REFERENCES hp_payment_aggregates (aggregate_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
