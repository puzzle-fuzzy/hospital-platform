import { expect, test } from "bun:test";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HEALTH_KNOWLEDGE_TEXT_LIMITS,
	HealthKnowledgeContentUnavailableError,
	HealthKnowledgePublicationConflictError,
	HealthKnowledgeResultValidationError,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlHealthKnowledgeRepository } from "./mysql-health-knowledge-repository";

type FakePoolState = {
	statements: string[];
	values: unknown[][];
	responses: unknown[];
};

function createFakePool(responses: unknown[] = []): {
	pool: Pool;
	state: FakePoolState;
} {
	const state: FakePoolState = {
		statements: [],
		values: [],
		responses: [...responses],
	};
	const pool = {
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			return [state.responses.shift() ?? [], []];
		},
	} as unknown as Pool;
	return { pool, state };
}

const publicationRow = {
	content_version: "health-2026-08-15",
	status: "published",
	source_label: "医院健康科普审核组",
	reviewed_at: "2026-08-15 00:00:00.000",
	disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
};

test("MySQL health knowledge selects one published version before catalog reads", async () => {
	const { pool, state } = createFakePool([
		[publicationRow],
		[
			{ item_id: "part-respiratory", name: "呼吸系统" },
			{ item_id: "part-digestive", name: "消化系统" },
		],
	]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(repository.listCatalog("part")).resolves.toEqual({
		publication: {
			contentVersion: "health-2026-08-15",
			reviewedAt: "2026-08-15T00:00:00.000Z",
			sourceLabel: "医院健康科普审核组",
			disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
		},
		items: [
			{ id: "part-respiratory", name: "呼吸系统" },
			{ id: "part-digestive", name: "消化系统" },
		],
	});
	expect(state.statements[0]).toContain("status = 'published'");
	expect(state.statements[0]).toContain("effective_from <= UTC_TIMESTAMP(3)");
	expect(state.statements[0]).toContain("LIMIT 2");
	expect(state.statements[1]).toContain("content_version = ?");
	expect(state.values[1]).toEqual(["health-2026-08-15", "part"]);
});

test("MySQL health knowledge fails closed when no published content exists", async () => {
	const { pool, state } = createFakePool([[]]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(repository.listCatalog("crowd")).rejects.toBeInstanceOf(
		HealthKnowledgeContentUnavailableError,
	);
	expect(state.statements).toHaveLength(1);
});

test("MySQL health knowledge fails closed when published windows overlap", async () => {
	const { pool, state } = createFakePool([
		[
			publicationRow,
			{ ...publicationRow, content_version: "health-2026-08-16" },
		],
	]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(repository.listCatalog("part")).rejects.toBeInstanceOf(
		HealthKnowledgePublicationConflictError,
	);
	// 版本冲突必须在读取任何条目之前终止，不能让两个版本的内容被拼接。
	expect(state.statements).toHaveLength(1);
});

test("MySQL health knowledge classifies a malformed publication row as persistence-invalid", async () => {
	const { pool } = createFakePool([
		[
			{
				...publicationRow,
				// 错误的数据库值不能在 `isoUtc` 中变成普通 TypeError，
				// 否则 API 无法稳定区分内容坏行和查询参数错误。
				reviewed_at: [],
			},
		],
	]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(repository.listCatalog("part")).rejects.toMatchObject({
		name: "HealthKnowledgeResultValidationError",
		violation: "publication-invalid",
	});
});

test("MySQL health knowledge rejects malformed catalog rows without returning an empty success", async () => {
	const { pool } = createFakePool([
		[publicationRow],
		[
			{
				item_id: "part-respiratory",
				// 数组没有公开内容语义，不能被 `.trim()` 的异常掩盖。
				name: [],
			},
		],
	]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	const result = repository.listCatalog("part");
	await expect(result).rejects.toBeInstanceOf(
		HealthKnowledgeResultValidationError,
	);
	await expect(result).rejects.toMatchObject({
		violation: "catalog-item-invalid",
	});
});

test("MySQL disease detail keeps drug references on the selected content version", async () => {
	const { pool, state } = createFakePool([
		[publicationRow],
		[
			{
				disease_id: "disease-cold",
				disease_name: "普通感冒",
				disease_alias: null,
				affected_part: "呼吸道",
				treatment_department: "呼吸内科",
				susceptible_crowd: "一般人群",
				cause: "病毒感染",
				symptoms: "鼻塞",
				examination: null,
				prevention: "勤洗手",
				treatment: "对症处理",
			},
		],
		[
			{
				drug_id: "drug-cold",
				drug_item_kind: "drug",
				drug_name: "示例药物",
				is_clickable: 1,
			},
			{
				drug_id: null,
				drug_item_kind: null,
				drug_name: "非链接药物描述",
				is_clickable: 0,
			},
		],
	]);
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(
		repository.getDiseaseDetail("disease-cold"),
	).resolves.toMatchObject({
		item: {
			id: "disease-cold",
			diseaseName: "普通感冒",
			availableDrugs: [
				{ drugId: "drug-cold", drugName: "示例药物", isClickable: true },
				{ drugName: "非链接药物描述", isClickable: false },
			],
		},
	});
	expect(state.values[1]).toEqual(["health-2026-08-15", "disease-cold"]);
	expect(state.values[2]).toEqual(["health-2026-08-15", "disease-cold"]);
	for (const statement of state.statements.slice(1)) {
		expect(statement).toContain("content_version");
	}
	expect(state.statements[2]).toContain("drug.item_kind AS drug_item_kind");
});

test("MySQL health knowledge enforces relation item kinds in every version", async () => {
	const relationCases = [
		{
			name: "disease relation",
			read: (
				repository: ReturnType<typeof createMySqlHealthKnowledgeRepository>,
			) => repository.listDiseasesByRelation({ kind: "part", id: "part-1" }),
			needle: "relation_item.item_kind = r.relation_kind",
		},
		{
			name: "part symptom relation",
			read: (
				repository: ReturnType<typeof createMySqlHealthKnowledgeRepository>,
			) => repository.listSymptomsByPart("part-1"),
			needle: "p.item_kind = 'part'",
		},
		{
			name: "symptom disease relation",
			read: (
				repository: ReturnType<typeof createMySqlHealthKnowledgeRepository>,
			) => repository.listDiseasesBySymptoms(["symptom-1"]),
			needle: "s.item_kind = 'symptom'",
		},
	] as const;

	for (const relationCase of relationCases) {
		const { pool, state } = createFakePool([[publicationRow], []]);
		const repository = createMySqlHealthKnowledgeRepository(pool);
		await relationCase.read(repository);
		expect(state.statements[1], relationCase.name).toContain(
			relationCase.needle,
		);
	}
});

test("MySQL disease summaries do not return an unbounded LONGTEXT preview", async () => {
	const relationCases = [
		(repository: ReturnType<typeof createMySqlHealthKnowledgeRepository>) =>
			repository.listDiseasesByRelation({ kind: "part", id: "part-1" }),
		(repository: ReturnType<typeof createMySqlHealthKnowledgeRepository>) =>
			repository.listDiseasesBySymptoms(["symptom-1"]),
	] as const;

	for (const read of relationCases) {
		const { pool, state } = createFakePool([[publicationRow], []]);
		await read(createMySqlHealthKnowledgeRepository(pool));
		const statement = state.statements[1] ?? "";
		expect(statement).toContain("CHAR_LENGTH(dd.symptoms)");
		expect(statement).toContain(
			`<= ${HEALTH_KNOWLEDGE_TEXT_LIMITS.diseaseSummarySymptoms}`,
		);
		expect(statement).toContain("ELSE NULL");
	}
});

test("MySQL health knowledge rejects an invalid drug reference kind or boolean", async () => {
	const invalidKindPool = createFakePool([
		[publicationRow],
		[
			{
				disease_id: "disease-cold",
				disease_name: "普通感冒",
				disease_alias: null,
				affected_part: null,
				treatment_department: null,
				susceptible_crowd: null,
				cause: null,
				symptoms: null,
				examination: null,
				prevention: null,
				treatment: null,
			},
		],
		[
			{
				drug_id: "disease-cold",
				drug_item_kind: "disease",
				drug_name: "伪药品引用",
				is_clickable: 1,
			},
		],
	]);
	await expect(
		createMySqlHealthKnowledgeRepository(invalidKindPool.pool).getDiseaseDetail(
			"disease-cold",
		),
	).rejects.toThrow("invalid drug kind");

	const invalidBooleanPool = createFakePool([
		[publicationRow],
		[
			{
				disease_id: "disease-cold",
				disease_name: "普通感冒",
				disease_alias: null,
				affected_part: null,
				treatment_department: null,
				susceptible_crowd: null,
				cause: null,
				symptoms: null,
				examination: null,
				prevention: null,
				treatment: null,
			},
		],
		[
			{
				drug_id: null,
				drug_item_kind: null,
				drug_name: "未知标记",
				is_clickable: "maybe",
			},
		],
	]);
	await expect(
		createMySqlHealthKnowledgeRepository(
			invalidBooleanPool.pool,
		).getDiseaseDetail("disease-cold"),
	).rejects.toThrow("invalid health knowledge boolean");
});

test("MySQL health knowledge rejects invalid symptom queries before touching SQL", async () => {
	const { pool, state } = createFakePool();
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(
		repository.listDiseasesBySymptoms(["symptom-1", "symptom-1"]),
	).rejects.toThrow("invalid_symptom_query");
	expect(state.statements).toHaveLength(0);
});
