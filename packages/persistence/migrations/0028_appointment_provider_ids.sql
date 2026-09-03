-- 6201 需要使用预约写入返回的真实挂号/医生/科室引用；客户端不得提交这些字段。
ALTER TABLE hp_appointment_registrations
	ADD COLUMN department_id VARCHAR(128) NULL AFTER department_name,
	ADD COLUMN doctor_id VARCHAR(128) NULL AFTER department_id;
