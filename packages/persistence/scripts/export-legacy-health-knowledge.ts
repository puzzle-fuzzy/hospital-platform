import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import {
	type LegacyCatalogRow,
	type LegacyDiseaseDrugRow,
	type LegacyDiseaseRow,
	type LegacyDrugRow,
	type LegacyHealthKnowledgeRows,
	type LegacyPartSymptomRow,
	type LegacyRelationRow,
	type LegacySymptomDiseaseRow,
	type LegacySymptomRow,
	mapLegacyHealthKnowledgeSource,
} from "./health-knowledge-source-export";

/**
 * 旧健康知识只读导出命令。
 *
 * 命令只读取显式白名单字段，并生成“未审核源快照”；它不会执行迁移、
 * 修改旧表、修改新表或注册患者端 API。医疗正文不打印到终端，终端只
 * 输出数量和质量告警，避免把大段内容带入日志或 CI 输出。
 */

type CatalogRowPacket = RowDataPacket & {
	id: number;
	name: string;
};

type SymptomRowPacket = CatalogRowPacket & {
	initialLetter: string;
};

type DiseaseRowPacket = CatalogRowPacket & {
	initialLetter: string;
	diseaseAlias: string | null;
	affectedPart: string | null;
	treatmentDepartment: string | null;
	susceptibleCrowd: string | null;
	cause: string | null;
	symptoms: string | null;
	examination: string | null;
	prevention: string | null;
	treatment: string | null;
};

type DrugRowPacket = CatalogRowPacket & {
	manufacturer: string | null;
	chineseName: string | null;
	specifications: string | null;
	treatableDiseases: string | null;
	indications: string | null;
	usageDosage: string | null;
	adverseReactions: string | null;
	contraindications: string | null;
	interactions: string | null;
	precautions: string | null;
};

type DiseaseDrugRowPacket = RowDataPacket & {
	diseaseId: number;
	drugId: number | null;
	drugName: string;
	isClickable: number;
};

type RelationRowPacket = RowDataPacket & {
	relationId: number;
	diseaseId: number;
};

type PartSymptomRowPacket = RowDataPacket & {
	partId: number;
	symptomId: number;
};

type SymptomDiseaseRowPacket = RowDataPacket & {
	symptomId: number;
	diseaseId: number;
};

function requiredDatabaseUrl(): string {
	const value = process.env.DATABASE_URL?.trim();
	if (!value) throw new Error("DATABASE_URL is required");
	return value;
}

function outputPathFromArgs(): string {
	const index = process.argv.indexOf("--output");
	const value = index >= 0 ? process.argv[index + 1] : undefined;
	if (!value || value.startsWith("-")) {
		throw new Error(
			"--output is required; use a private ignored path such as .local/health-knowledge/source-snapshot.json",
		);
	}
	return resolve(process.cwd(), value);
}

function createReadOnlyPool(databaseUrl: string): Pool {
	const parsed = new URL(databaseUrl);
	if (parsed.protocol !== "mysql:") {
		throw new Error("DATABASE_URL must use mysql:// for legacy export");
	}
	if (!parsed.hostname || !parsed.pathname.slice(1)) {
		throw new Error("DATABASE_URL must include a host and database");
	}
	return createPool({
		host: parsed.hostname,
		port: Number(parsed.port || 3306),
		user: decodeURIComponent(parsed.username),
		password: decodeURIComponent(parsed.password),
		database: decodeURIComponent(parsed.pathname.slice(1)),
		dateStrings: true,
		// 导出只使用 SELECT；限制连接池规模，避免维护命令抢占业务连接。
		connectionLimit: 1,
	});
}

async function select<T extends RowDataPacket>(
	pool: Pick<Pool, "execute">,
	sql: string,
): Promise<T[]> {
	const [rows] = await pool.execute<T[]>(sql);
	return rows;
}

async function readSourceRows(pool: Pool): Promise<LegacyHealthKnowledgeRows> {
	const [
		crowds,
		departments,
		parts,
		symptoms,
		diseases,
		drugs,
		diseaseDrugs,
		crowdDiseases,
		departmentDiseases,
		partDiseases,
		partSymptoms,
		symptomDiseases,
	] = await Promise.all([
		select<CatalogRowPacket>(
			pool,
			"SELECT id, crowd_name AS name FROM knowledge_crowd ORDER BY id",
		),
		select<CatalogRowPacket>(
			pool,
			"SELECT id, department_name AS name FROM knowledge_department ORDER BY id",
		),
		select<CatalogRowPacket>(
			pool,
			"SELECT id, part_name AS name FROM knowledge_part ORDER BY id",
		),
		select<SymptomRowPacket>(
			pool,
			"SELECT id, symptoms_name AS name, initial_letter AS initialLetter FROM knowledge_symptoms ORDER BY id",
		),
		select<DiseaseRowPacket>(
			pool,
			`SELECT id, disease_name AS name, initial_letter AS initialLetter,
					disease_alias AS diseaseAlias, affected_part AS affectedPart,
					treatment_department AS treatmentDepartment,
					susceptible_crowd AS susceptibleCrowd, cause, symptoms, examination,
					prevention, treatment
				 FROM knowledge_disease ORDER BY id`,
		),
		select<DrugRowPacket>(
			pool,
			`SELECT id, drug_name AS name, manufacturer, chinese_name AS chineseName,
					specifications, treatable_diseases AS treatableDiseases, indications,
					usage_dosage AS usageDosage, adverse_reactions AS adverseReactions,
					contraindications, interactions, precautions
				 FROM knowledge_drug ORDER BY id`,
		),
		select<DiseaseDrugRowPacket>(
			pool,
			`SELECT disease_id AS diseaseId, drug_id AS drugId, drug_name AS drugName,
					is_clickable AS isClickable
				 FROM knowledge_disease_drug ORDER BY disease_id, drug_name, drug_id`,
		),
		select<RelationRowPacket>(
			pool,
			"SELECT crowd_id AS relationId, disease_id AS diseaseId FROM knowledge_crowd_disease ORDER BY crowd_id, disease_id",
		),
		select<RelationRowPacket>(
			pool,
			"SELECT department_id AS relationId, disease_id AS diseaseId FROM knowledge_department_disease ORDER BY department_id, disease_id",
		),
		select<RelationRowPacket>(
			pool,
			"SELECT part_id AS relationId, disease_id AS diseaseId FROM knowledge_part_disease ORDER BY part_id, disease_id",
		),
		select<PartSymptomRowPacket>(
			pool,
			"SELECT part_id AS partId, symptoms_id AS symptomId FROM knowledge_part_symptoms ORDER BY part_id, symptoms_id",
		),
		select<SymptomDiseaseRowPacket>(
			pool,
			"SELECT symptoms_id AS symptomId, disease_id AS diseaseId FROM knowledge_symptoms_disease ORDER BY symptoms_id, disease_id",
		),
	]);

	return {
		crowds: crowds as LegacyCatalogRow[],
		departments: departments as LegacyCatalogRow[],
		parts: parts as LegacyCatalogRow[],
		symptoms: symptoms as LegacySymptomRow[],
		diseases: diseases as LegacyDiseaseRow[],
		drugs: drugs as LegacyDrugRow[],
		diseaseDrugs: diseaseDrugs as LegacyDiseaseDrugRow[],
		crowdDiseases: crowdDiseases as LegacyRelationRow[],
		departmentDiseases: departmentDiseases as LegacyRelationRow[],
		partDiseases: partDiseases as LegacyRelationRow[],
		partSymptoms: partSymptoms as LegacyPartSymptomRow[],
		symptomDiseases: symptomDiseases as LegacySymptomDiseaseRow[],
	};
}

const outputPath = outputPathFromArgs();
const pool = createReadOnlyPool(requiredDatabaseUrl());
try {
	const sourceRows = await readSourceRows(pool);
	const snapshot = mapLegacyHealthKnowledgeSource(
		sourceRows,
		new Date().toISOString(),
	);
	await mkdir(dirname(outputPath), { recursive: true });
	await Bun.write(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
	console.log(
		JSON.stringify({
			output: outputPath,
			itemCount: snapshot.items.length,
			diseaseCount: snapshot.diseaseDetails.length,
			drugCount: snapshot.drugDetails.length,
			diseaseRelationCount: snapshot.diseaseRelations.length,
			partSymptomCount: snapshot.partSymptoms.length,
			symptomDiseaseCount: snapshot.symptomDiseases.length,
			duplicateDiseaseDrugNameCount:
				snapshot.quality.duplicateDiseaseDrugNames.length,
			clickableDrugReferencesWithoutId:
				snapshot.quality.clickableDrugReferencesWithoutId.length,
			trimmedTextFieldCount: snapshot.quality.trimmedTextFieldCount,
			defaultedInitialLetterCount: snapshot.quality.defaultedInitialLetterCount,
			legacyControlCharacterCount: snapshot.quality.legacyControlCharacterCount,
			ignoredLegacySources: snapshot.quality.ignoredLegacySources,
			publicationState: snapshot.source.publicationState,
		}),
	);
} finally {
	await pool.end();
}
