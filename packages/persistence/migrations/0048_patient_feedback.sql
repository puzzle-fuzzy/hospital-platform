-- 新服务电子锦旗/表扬信：只保存新提交，旧服务历史数据不迁移。
-- 写入默认 pending_review，未经审核不进入公开读模型。
CREATE TABLE IF NOT EXISTS hp_patient_feedback (
	feedback_id CHAR(36) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	appointment_id VARCHAR(64) NOT NULL,
	kind VARCHAR(32) NOT NULL,
	content VARCHAR(4000) NOT NULL,
	display_public BOOLEAN NOT NULL DEFAULT FALSE,
	status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
	donate_date DATE NOT NULL,
	department_name VARCHAR(128) NOT NULL,
	doctor_name VARCHAR(128) NOT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (feedback_id),
	UNIQUE KEY uq_hp_patient_feedback_owner_idempotency (owner_user_id, idempotency_key),
	KEY ix_hp_patient_feedback_owner_patient_created (owner_user_id, patient_id, created_at),
	KEY ix_hp_patient_feedback_owner_patient_date (owner_user_id, patient_id, donate_date, kind, created_at),
	CONSTRAINT fk_hp_patient_feedback_owner
		FOREIGN KEY (owner_user_id) REFERENCES hp_identity_users (user_id) ON DELETE CASCADE,
	CONSTRAINT fk_hp_patient_feedback_patient
		FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id) ON DELETE CASCADE,
	CONSTRAINT fk_hp_patient_feedback_appointment
		FOREIGN KEY (appointment_id)
		REFERENCES hp_appointment_registrations (appointment_id) ON DELETE CASCADE,
	CONSTRAINT ck_hp_patient_feedback_kind
		CHECK (kind IN ('gift-banner', 'health-praise')),
	CONSTRAINT ck_hp_patient_feedback_status
		CHECK (status IN ('pending_review', 'approved', 'rejected', 'withdrawn'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
