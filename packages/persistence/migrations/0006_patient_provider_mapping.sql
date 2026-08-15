-- 患者平台 id 与 provider 患者号分离；订单只引用 patient_id。
-- provider_patient_id 允许 NULL，以兼容迁移前的 legacy-record 数据。
ALTER TABLE hp_patients
	ADD COLUMN provider_name VARCHAR(32) NULL AFTER source,
	ADD COLUMN provider_patient_id VARCHAR(128) NULL AFTER provider_name,
	ADD UNIQUE KEY uq_hp_patients_owner_provider_patient (
		owner_user_id,
		provider_name,
		provider_patient_id
	);
