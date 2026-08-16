-- 患者目录同步的 owner-scoped durable 幂等记录。
--
-- 该表只记录操作状态和低敏结果摘要，不保存 provider 原始响应、unionId、
-- openid、身份证号或完整患者对象。患者快照与 succeeded 标记由仓储放在同一
-- InnoDB 事务中提交；in_progress 通过 lease_until 支持进程崩溃后的接管。
CREATE TABLE IF NOT EXISTS hp_patient_directory_sync_operations (
	operation_id CHAR(36) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	provider_name VARCHAR(32) NOT NULL,
	idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
	status VARCHAR(16) NOT NULL,
	attempt_count INT UNSIGNED NOT NULL DEFAULT 1,
	observed_at DATETIME(3) NULL,
	lease_until DATETIME(3) NOT NULL,
	completed_at DATETIME(3) NULL,
	result_digest CHAR(64) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (operation_id),
	UNIQUE KEY uq_hp_patient_sync_owner_provider_key (
		owner_user_id,
		provider_name,
		idempotency_key
	),
	KEY ix_hp_patient_sync_status_lease (status, lease_until),
	CONSTRAINT ck_hp_patient_sync_status
		CHECK (status IN ('in_progress', 'succeeded')),
	CONSTRAINT fk_hp_patient_sync_owner
		FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
		ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
