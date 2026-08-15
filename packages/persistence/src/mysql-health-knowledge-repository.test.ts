import { expect, test } from "bun:test";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	HealthKnowledgeContentUnavailableError,
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
			{ drug_id: "drug-cold", drug_name: "示例药物", is_clickable: 1 },
			{ drug_id: null, drug_name: "非链接药物描述", is_clickable: 0 },
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
});

test("MySQL health knowledge rejects invalid symptom queries before touching SQL", async () => {
	const { pool, state } = createFakePool();
	const repository = createMySqlHealthKnowledgeRepository(pool);

	await expect(
		repository.listDiseasesBySymptoms(["symptom-1", "symptom-1"]),
	).rejects.toThrow("invalid_symptom_query");
	expect(state.statements).toHaveLength(0);
});
