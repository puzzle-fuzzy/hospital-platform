-- 一个患者在众阳不同接口中可能有不同的外部身份：
-- patientInfoByUnionId 返回的 thirdPatientId 是目录引用，
-- patInfosFind 返回的 patId 才是预约、报告和门诊费用使用的 HIS 患者号。
-- 以用途维度拆表，避免任何一次目录同步覆盖临床业务映射。
CREATE TABLE IF NOT EXISTS hp_patient_provider_references (
	owner_user_id VARCHAR(64) NOT NULL,
	patient_id VARCHAR(64) NOT NULL,
	provider_name VARCHAR(32) NOT NULL,
	reference_kind VARCHAR(32) NOT NULL,
	provider_patient_id VARCHAR(128) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (owner_user_id, patient_id, provider_name, reference_kind),
	UNIQUE KEY uq_hp_patient_provider_refs_owner_provider_reference (
		owner_user_id,
		provider_name,
		reference_kind,
		provider_patient_id
	),
	CONSTRAINT fk_hp_patient_provider_refs_owner_patient
		FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id)
		ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
