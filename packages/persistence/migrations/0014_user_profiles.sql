-- 普通个人资料独立于微信身份和患者档案，避免旧端混合更新敏感字段。
-- version 用于两个设备并发修改时的乐观锁；头像、实名和手机号不在本表开放。
CREATE TABLE IF NOT EXISTS hp_user_profiles (
	user_id VARCHAR(64) NOT NULL,
	display_name VARCHAR(64) NOT NULL,
	gender VARCHAR(16) NOT NULL,
	age TINYINT UNSIGNED NULL,
	email VARCHAR(320) NULL,
	version INT UNSIGNED NOT NULL DEFAULT 1,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (user_id),
	CONSTRAINT fk_hp_user_profiles_user
		FOREIGN KEY (user_id)
		REFERENCES hp_identity_users (user_id)
		ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
