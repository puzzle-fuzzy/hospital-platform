-- 医生头像沿用已确认的资源代理；URL 编码后可长于原 Provider 地址。
ALTER TABLE hp_my_doctors
	MODIFY COLUMN doctor_avatar_url VARCHAR(2048) NULL;
