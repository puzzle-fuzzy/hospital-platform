-- 患者目录同步在开始事务中先锁定 owner 身份行，防止不同幂等键并发启动。
-- 这个复合索引用于快速找出同一 owner/provider 下仍在租约内的操作记录；
-- 幂等唯一键仍由 0015 保留，两个索引分别解决“同 key 重放”和“跨 key 并发”两种问题。
ALTER TABLE hp_patient_directory_sync_operations
	ADD KEY ix_hp_patient_sync_owner_provider_state (
		owner_user_id,
		provider_name,
		status,
		lease_until
	);
