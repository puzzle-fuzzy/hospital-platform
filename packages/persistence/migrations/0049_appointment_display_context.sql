-- 保存确认页/挂号详情所需的已审核排班展示字段。
-- 这些字段来自当前排班快照，不是旧历史数据导入，也不包含 Provider 标识。
ALTER TABLE hp_appointment_schedule_snapshots
	ADD COLUMN registration_class_name VARCHAR(128) NULL AFTER department_location,
	ADD COLUMN hospital_area_name VARCHAR(128) NULL AFTER registration_class_name;

ALTER TABLE hp_appointment_registrations
	ADD COLUMN registration_class_name VARCHAR(128) NULL AFTER department_name,
	ADD COLUMN hospital_area_name VARCHAR(128) NULL AFTER registration_class_name;
