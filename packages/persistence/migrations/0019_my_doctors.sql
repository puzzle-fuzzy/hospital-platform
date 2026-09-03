-- 我的医生是平台用户级关系；不绑定当前就诊人，且必须由数据库唯一键防止重复关注。
CREATE TABLE IF NOT EXISTS hp_my_doctors (
	relation_id CHAR(36) NOT NULL,
	owner_user_id VARCHAR(64) NOT NULL,
	doctor_id VARCHAR(128) NOT NULL,
	doctor_name VARCHAR(128) NOT NULL,
	title_name VARCHAR(128) NULL,
	expertise VARCHAR(255) NULL,
	department_location VARCHAR(256) NULL,
	department_name VARCHAR(128) NOT NULL,
	doctor_avatar_url VARCHAR(512) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (relation_id),
	UNIQUE KEY uq_hp_my_doctors_owner_doctor (owner_user_id, doctor_id),
	KEY ix_hp_my_doctors_owner_created (owner_user_id, created_at),
	CONSTRAINT fk_hp_my_doctors_owner
		FOREIGN KEY (owner_user_id)
		REFERENCES hp_identity_users (user_id)
		ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
