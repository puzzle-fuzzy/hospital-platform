-- PACS/ECG/PEIS 没有独立详情接口；短期引用只保存原实时查询窗口，
-- 详情和附件读取时重新向众阳查询，不保存报告正文、身份证号或附件 URL。
ALTER TABLE hp_report_references
	ADD COLUMN start_date DATE NULL AFTER provider_report_id,
	ADD COLUMN end_date DATE NULL AFTER start_date;
