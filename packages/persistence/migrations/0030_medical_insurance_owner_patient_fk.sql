-- 修复 0018 遗留的单列患者外键，恢复医保订单的 owner-scoped 约束。
-- 先补齐被引用表的复合唯一键，再按数据字典判断旧约束是否存在。
SET @hp_patient_owner_key_exists = (
	SELECT COUNT(*)
	FROM information_schema.STATISTICS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_patients'
		AND INDEX_NAME = 'uq_hp_patients_owner_patient'
		AND NON_UNIQUE = 0
		AND SEQ_IN_INDEX = 2
		AND COLUMN_NAME = 'patient_id'
);
SET @hp_patient_add_owner_key = IF(
	@hp_patient_owner_key_exists > 0,
	'SELECT 1',
	'ALTER TABLE hp_patients ADD UNIQUE KEY uq_hp_patients_owner_patient (owner_user_id, patient_id)'
);
PREPARE hp_patient_add_owner_key_stmt FROM @hp_patient_add_owner_key;
EXECUTE hp_patient_add_owner_key_stmt;
DEALLOCATE PREPARE hp_patient_add_owner_key_stmt;

SET @hp_mi_patient_fk_exists = (
	SELECT COUNT(*)
	FROM information_schema.REFERENTIAL_CONSTRAINTS
	WHERE CONSTRAINT_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_medical_insurance_orders'
		AND CONSTRAINT_NAME = 'fk_hp_mi_orders_patient'
);
SET @hp_mi_drop_patient_fk = IF(
	@hp_mi_patient_fk_exists > 0,
	'ALTER TABLE hp_medical_insurance_orders DROP FOREIGN KEY fk_hp_mi_orders_patient',
	'SELECT 1'
);
PREPARE hp_mi_drop_patient_fk_stmt FROM @hp_mi_drop_patient_fk;
EXECUTE hp_mi_drop_patient_fk_stmt;
DEALLOCATE PREPARE hp_mi_drop_patient_fk_stmt;

SET @hp_mi_patient_index_exists = (
	SELECT COUNT(*)
	FROM information_schema.STATISTICS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_medical_insurance_orders'
		AND INDEX_NAME = 'fk_hp_mi_orders_patient'
);
SET @hp_mi_drop_patient_index = IF(
	@hp_mi_patient_index_exists > 0,
	'ALTER TABLE hp_medical_insurance_orders DROP INDEX fk_hp_mi_orders_patient',
	'SELECT 1'
);
PREPARE hp_mi_drop_patient_index_stmt FROM @hp_mi_drop_patient_index;
EXECUTE hp_mi_drop_patient_index_stmt;
DEALLOCATE PREPARE hp_mi_drop_patient_index_stmt;

ALTER TABLE hp_medical_insurance_orders
	ADD CONSTRAINT fk_hp_mi_orders_patient FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id);
