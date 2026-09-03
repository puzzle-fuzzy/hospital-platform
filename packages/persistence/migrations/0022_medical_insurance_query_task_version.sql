-- 医保查单任务的 CAS 版本。
-- 0018 已创建任务表；本迁移只补齐 Worker claim/update 所需的版本栅栏，
-- 保持历史迁移不可变，避免已执行环境因修改旧文件而失去可审计性。
ALTER TABLE hp_medical_insurance_query_tasks
	ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1 AFTER max_attempts;
