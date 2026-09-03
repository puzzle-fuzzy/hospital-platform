-- 保存排班名片字段，确保短期快照不会丢失“我的医生”详情页所需的旧端资料。
ALTER TABLE hp_appointment_schedule_snapshots
	ADD COLUMN title_name VARCHAR(128) NULL AFTER department_name,
	ADD COLUMN introduction VARCHAR(512) NULL AFTER title_name,
	ADD COLUMN expertise VARCHAR(255) NULL AFTER introduction,
	ADD COLUMN department_location VARCHAR(256) NULL AFTER expertise;
