-- 预约写入、取消的 owner-scoped 映射。
-- provider 排班/患者/预约号只保存在服务端，客户端仅持有 opaque holdId/appointmentId。
CREATE TABLE IF NOT EXISTS hp_appointment_holds (
	hold_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	schedule_id VARCHAR(128) NOT NULL,
	provider_schedule_id VARCHAR(128) NOT NULL,
	provider_source_id VARCHAR(128) NOT NULL,
	source_serial_number VARCHAR(32) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	status VARCHAR(16) NOT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (hold_id),
	UNIQUE KEY uq_hp_appointment_holds_owner_idempotency (owner_user_id, idempotency_key),
	KEY ix_hp_appointment_holds_expiry (status, expires_at),
	CONSTRAINT fk_hp_appointment_holds_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_appointment_holds_patient FOREIGN KEY (patient_id)
		REFERENCES hp_patients (patient_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_appointment_registrations (
	appointment_id VARCHAR(64) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	hold_id VARCHAR(64) NOT NULL,
	provider_appointment_id VARCHAR(128) NOT NULL,
	provider_patient_id VARCHAR(128) NOT NULL,
	provider_register_id VARCHAR(128) NULL,
	provider_his_register_id VARCHAR(128) NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	department_name VARCHAR(128) NOT NULL,
	doctor_name VARCHAR(128) NOT NULL,
	work_date DATE NOT NULL,
	shift_name VARCHAR(64) NOT NULL,
	source_serial_number VARCHAR(32) NOT NULL,
	total_fen BIGINT UNSIGNED NOT NULL,
	status VARCHAR(16) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (appointment_id),
	UNIQUE KEY uq_hp_appointment_registrations_provider_id (provider_appointment_id),
	UNIQUE KEY uq_hp_appointment_registrations_owner_idempotency (owner_user_id, idempotency_key),
	KEY ix_hp_appointment_registrations_active (owner_user_id, patient_id, work_date, department_name, status),
	CONSTRAINT fk_hp_appointment_registrations_owner FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id),
	CONSTRAINT fk_hp_appointment_registrations_patient FOREIGN KEY (patient_id)
		REFERENCES hp_patients (patient_id),
	CONSTRAINT fk_hp_appointment_registrations_hold FOREIGN KEY (hold_id)
		REFERENCES hp_appointment_holds (hold_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
