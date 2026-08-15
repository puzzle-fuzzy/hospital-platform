-- 只读排班快照是未来预约写入的前置事实，但本 migration 不开放任何写入 API。
-- providerScheduleId 仅保存在服务端；expires_at 过期后不能被写入流程使用。
CREATE TABLE IF NOT EXISTS hp_appointment_schedule_snapshots (
	schedule_id VARCHAR(128) NOT NULL,
	provider VARCHAR(32) NOT NULL,
	provider_schedule_id VARCHAR(128) NOT NULL,
	department_id VARCHAR(128) NOT NULL,
	department_name VARCHAR(128) NOT NULL,
	doctor_id VARCHAR(128) NOT NULL,
	doctor_name VARCHAR(128) NOT NULL,
	work_date DATE NOT NULL,
	shift_name VARCHAR(128) NOT NULL,
	start_time VARCHAR(32) NULL,
	end_time VARCHAR(32) NULL,
	total_slots INT UNSIGNED NOT NULL,
	available_slots INT UNSIGNED NOT NULL,
	time_group VARCHAR(16) NOT NULL,
	provider_request_id VARCHAR(256) NOT NULL,
	observed_at DATETIME(3) NOT NULL,
	expires_at DATETIME(3) NOT NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (schedule_id),
	KEY ix_hp_appointment_snapshots_expiry (provider, expires_at),
	KEY ix_hp_appointment_snapshots_provider_schedule (provider, provider_schedule_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
