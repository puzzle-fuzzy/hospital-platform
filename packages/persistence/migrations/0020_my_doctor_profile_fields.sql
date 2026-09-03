-- 为已创建的 hp_my_doctors 关系补齐旧医生名片中的简介和完整科室位置字段。
ALTER TABLE hp_my_doctors
	ADD COLUMN introduction VARCHAR(512) NULL AFTER title_name,
	MODIFY COLUMN department_location VARCHAR(256) NULL;
