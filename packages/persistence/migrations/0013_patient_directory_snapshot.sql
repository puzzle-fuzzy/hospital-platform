-- 患者目录同步使用完整快照；只标记当前目录未出现的 provider 患者为 inactive，
-- 不物理删除记录，以保留报告、费用和未来订单的历史外键引用。
ALTER TABLE hp_patients
	ADD COLUMN directory_active TINYINT(1) NOT NULL DEFAULT 1 AFTER provider_patient_id,
	ADD COLUMN directory_last_seen_at DATETIME(3) NULL AFTER directory_active,
	ADD KEY ix_hp_patients_owner_directory_status (
		owner_user_id,
		provider_name,
		directory_active,
		directory_last_seen_at
	);
