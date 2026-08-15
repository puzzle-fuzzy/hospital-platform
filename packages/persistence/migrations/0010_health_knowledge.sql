-- 健康知识只保存已审核发布版本的可追溯内容。
-- 患者端只读查询必须先选定一个 published content_version，再读取同版本数据。
CREATE TABLE IF NOT EXISTS hp_health_knowledge_publications (
	content_version VARCHAR(64) NOT NULL,
	status VARCHAR(16) NOT NULL,
	source_label VARCHAR(128) NOT NULL,
	reviewed_at DATETIME(3) NOT NULL,
	disclaimer VARCHAR(512) NOT NULL,
	reviewer_ref VARCHAR(128) NULL,
	effective_from DATETIME(3) NULL,
	effective_to DATETIME(3) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (content_version),
	KEY ix_hp_health_knowledge_publications_published (
		status,
		effective_from,
		effective_to,
		reviewed_at
	)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- item_id 在平台内全局唯一，避免不同知识类别的数字旧 id 发生碰撞。
CREATE TABLE IF NOT EXISTS hp_health_knowledge_items (
	item_id VARCHAR(128) NOT NULL,
	content_version VARCHAR(64) NOT NULL,
	item_kind VARCHAR(16) NOT NULL,
	name VARCHAR(256) NOT NULL,
	initial_letter VARCHAR(8) NULL,
	created_at DATETIME(3) NOT NULL,
	updated_at DATETIME(3) NOT NULL,
	PRIMARY KEY (item_id),
	KEY ix_hp_health_knowledge_items_catalog (
		content_version,
		item_kind,
		initial_letter,
		name
	),
	UNIQUE KEY uq_hp_health_knowledge_items_version_id (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_items_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_health_knowledge_disease_details (
	disease_id VARCHAR(128) NOT NULL,
	content_version VARCHAR(64) NOT NULL,
	disease_alias VARCHAR(500) NULL,
	affected_part VARCHAR(500) NULL,
	treatment_department VARCHAR(500) NULL,
	susceptible_crowd VARCHAR(500) NULL,
	cause LONGTEXT NULL,
	symptoms LONGTEXT NULL,
	examination LONGTEXT NULL,
	prevention LONGTEXT NULL,
	treatment LONGTEXT NULL,
	PRIMARY KEY (disease_id),
	CONSTRAINT fk_hp_health_knowledge_disease_item_version
		FOREIGN KEY (content_version, disease_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_disease_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_health_knowledge_drug_details (
	drug_id VARCHAR(128) NOT NULL,
	content_version VARCHAR(64) NOT NULL,
	manufacturer VARCHAR(256) NULL,
	chinese_name VARCHAR(256) NULL,
	specifications VARCHAR(256) NULL,
	treatable_diseases VARCHAR(500) NULL,
	indications LONGTEXT NULL,
	usage_dosage LONGTEXT NULL,
	adverse_reactions LONGTEXT NULL,
	contraindications LONGTEXT NULL,
	interactions LONGTEXT NULL,
	precautions LONGTEXT NULL,
	PRIMARY KEY (drug_id),
	CONSTRAINT fk_hp_health_knowledge_drug_item_version
		FOREIGN KEY (content_version, drug_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_drug_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

-- relation_kind 必须是 crowd/department/part；导入器还要确认 relation_id 的 item_kind。
CREATE TABLE IF NOT EXISTS hp_health_knowledge_disease_relations (
	content_version VARCHAR(64) NOT NULL,
	relation_kind VARCHAR(16) NOT NULL,
	relation_id VARCHAR(128) NOT NULL,
	disease_id VARCHAR(128) NOT NULL,
	PRIMARY KEY (content_version, relation_kind, relation_id, disease_id),
	KEY ix_hp_health_knowledge_disease_relations_relation (
		content_version,
		relation_kind,
		relation_id
	),
	CONSTRAINT fk_hp_health_knowledge_disease_relations_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version),
	CONSTRAINT fk_hp_health_knowledge_disease_relations_relation_version
		FOREIGN KEY (content_version, relation_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_disease_relations_disease_version
		FOREIGN KEY (content_version, disease_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_health_knowledge_part_symptoms (
	content_version VARCHAR(64) NOT NULL,
	part_id VARCHAR(128) NOT NULL,
	symptom_id VARCHAR(128) NOT NULL,
	PRIMARY KEY (content_version, part_id, symptom_id),
	KEY ix_hp_health_knowledge_part_symptoms_part (
		content_version,
		part_id
	),
	CONSTRAINT fk_hp_health_knowledge_part_symptoms_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version),
	CONSTRAINT fk_hp_health_knowledge_part_symptoms_part_version
		FOREIGN KEY (content_version, part_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_part_symptoms_symptom_version
		FOREIGN KEY (content_version, symptom_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_health_knowledge_symptom_diseases (
	content_version VARCHAR(64) NOT NULL,
	symptom_id VARCHAR(128) NOT NULL,
	disease_id VARCHAR(128) NOT NULL,
	PRIMARY KEY (content_version, symptom_id, disease_id),
	KEY ix_hp_health_knowledge_symptom_diseases_symptom (
		content_version,
		symptom_id
	),
	CONSTRAINT fk_hp_health_knowledge_symptom_diseases_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version),
	CONSTRAINT fk_hp_health_knowledge_symptom_diseases_symptom_version
		FOREIGN KEY (content_version, symptom_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_symptom_diseases_disease_version
		FOREIGN KEY (content_version, disease_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS hp_health_knowledge_disease_drugs (
	content_version VARCHAR(64) NOT NULL,
	disease_id VARCHAR(128) NOT NULL,
	drug_id VARCHAR(128) NULL,
	drug_name VARCHAR(256) NOT NULL,
	is_clickable BOOLEAN NOT NULL,
	PRIMARY KEY (content_version, disease_id, drug_name),
	KEY ix_hp_health_knowledge_disease_drugs_disease (
		content_version,
		disease_id
	),
	CONSTRAINT fk_hp_health_knowledge_disease_drugs_publication
		FOREIGN KEY (content_version)
		REFERENCES hp_health_knowledge_publications (content_version),
	CONSTRAINT fk_hp_health_knowledge_disease_drugs_disease_version
		FOREIGN KEY (content_version, disease_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id),
	CONSTRAINT fk_hp_health_knowledge_disease_drugs_drug_version
		FOREIGN KEY (content_version, drug_id)
		REFERENCES hp_health_knowledge_items (content_version, item_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
