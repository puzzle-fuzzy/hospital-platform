-- 0010 建立的健康知识表最初把业务 ID 设为全局主键，
-- 这会阻止同一疾病/药品在新 content_version 中复用稳定 ID。
-- 本 migration 保留 0010 的不可变历史，只升级最终 schema 的版本复合主键。
ALTER TABLE hp_health_knowledge_items
	DROP PRIMARY KEY,
	ADD PRIMARY KEY (content_version, item_id);

ALTER TABLE hp_health_knowledge_disease_details
	DROP PRIMARY KEY,
	ADD PRIMARY KEY (content_version, disease_id);

ALTER TABLE hp_health_knowledge_drug_details
	DROP PRIMARY KEY,
	ADD PRIMARY KEY (content_version, drug_id);
