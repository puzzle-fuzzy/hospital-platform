-- LIS 详情引用只在服务端短期存在；客户端拿到的 reportId 不是 provider id。
-- 详情读取必须同时满足 owner、报告引用和 expires_at，过期后不能再查 provider。
CREATE TABLE IF NOT EXISTS hp_report_references (
	report_id VARCHAR(128) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	provider VARCHAR(32) NOT NULL,
	kind VARCHAR(16) NOT NULL,
	provider_report_id VARCHAR(256) NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (report_id),
	UNIQUE KEY uq_hp_report_references_provider (
		owner_user_id,
		patient_id,
		provider,
		kind,
		provider_report_id
	),
	KEY ix_hp_report_references_owner_expiry (owner_user_id, expires_at),
	CONSTRAINT fk_hp_report_references_owner_patient FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
