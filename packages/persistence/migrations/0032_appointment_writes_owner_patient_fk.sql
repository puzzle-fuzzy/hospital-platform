-- 预约写入必须同时约束 owner 与 patient，避免跨用户引用同一个 patient_id。
SET @hp_hold_patient_fk_exists = (
	SELECT COUNT(*)
	FROM information_schema.REFERENTIAL_CONSTRAINTS
	WHERE CONSTRAINT_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_appointment_holds'
		AND CONSTRAINT_NAME = 'fk_hp_appointment_holds_patient'
);
SET @hp_hold_drop_patient_fk = IF(
	@hp_hold_patient_fk_exists > 0,
	'ALTER TABLE hp_appointment_holds DROP FOREIGN KEY fk_hp_appointment_holds_patient',
	'SELECT 1'
);
PREPARE hp_hold_drop_patient_fk_stmt FROM @hp_hold_drop_patient_fk;
EXECUTE hp_hold_drop_patient_fk_stmt;
DEALLOCATE PREPARE hp_hold_drop_patient_fk_stmt;

SET @hp_hold_patient_index_exists = (
	SELECT COUNT(*)
	FROM information_schema.STATISTICS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_appointment_holds'
		AND INDEX_NAME = 'fk_hp_appointment_holds_patient'
);
SET @hp_hold_drop_patient_index = IF(
	@hp_hold_patient_index_exists > 0,
	'ALTER TABLE hp_appointment_holds DROP INDEX fk_hp_appointment_holds_patient',
	'SELECT 1'
);
PREPARE hp_hold_drop_patient_index_stmt FROM @hp_hold_drop_patient_index;
EXECUTE hp_hold_drop_patient_index_stmt;
DEALLOCATE PREPARE hp_hold_drop_patient_index_stmt;

SET @hp_registration_patient_fk_exists = (
	SELECT COUNT(*)
	FROM information_schema.REFERENTIAL_CONSTRAINTS
	WHERE CONSTRAINT_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_appointment_registrations'
		AND CONSTRAINT_NAME = 'fk_hp_appointment_registrations_patient'
);
SET @hp_registration_drop_patient_fk = IF(
	@hp_registration_patient_fk_exists > 0,
	'ALTER TABLE hp_appointment_registrations DROP FOREIGN KEY fk_hp_appointment_registrations_patient',
	'SELECT 1'
);
PREPARE hp_registration_drop_patient_fk_stmt FROM @hp_registration_drop_patient_fk;
EXECUTE hp_registration_drop_patient_fk_stmt;
DEALLOCATE PREPARE hp_registration_drop_patient_fk_stmt;

SET @hp_registration_patient_index_exists = (
	SELECT COUNT(*)
	FROM information_schema.STATISTICS
	WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'hp_appointment_registrations'
		AND INDEX_NAME = 'fk_hp_appointment_registrations_patient'
);
SET @hp_registration_drop_patient_index = IF(
	@hp_registration_patient_index_exists > 0,
	'ALTER TABLE hp_appointment_registrations DROP INDEX fk_hp_appointment_registrations_patient',
	'SELECT 1'
);
PREPARE hp_registration_drop_patient_index_stmt FROM @hp_registration_drop_patient_index;
EXECUTE hp_registration_drop_patient_index_stmt;
DEALLOCATE PREPARE hp_registration_drop_patient_index_stmt;

ALTER TABLE hp_appointment_holds
	ADD CONSTRAINT fk_hp_appointment_holds_owner_patient
		FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id);

ALTER TABLE hp_appointment_registrations
	ADD CONSTRAINT fk_hp_appointment_registrations_owner_patient
		FOREIGN KEY (owner_user_id, patient_id)
		REFERENCES hp_patients (owner_user_id, patient_id);
