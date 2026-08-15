import { expect, test } from "bun:test";
import {
	HEALTH_KNOWLEDGE_DISCLAIMER,
	type HealthKnowledgeImportBundle,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { importHealthKnowledgeBundle } from "./health-knowledge-import";

function validBundle(): HealthKnowledgeImportBundle {
	return {
		publication: {
			contentVersion: "health-2026-08-15",
			status: "published",
			reviewedAt: "2026-08-15T00:00:00.000Z",
			sourceLabel: "医院健康科普审核组",
			disclaimer: HEALTH_KNOWLEDGE_DISCLAIMER,
			reviewerRef: "reviewer-001",
		},
		items: [
			{ id: "crowd-adult", kind: "crowd", name: "成年人" },
			{ id: "department-respiratory", kind: "department", name: "呼吸内科" },
			{ id: "part-respiratory", kind: "part", name: "呼吸系统" },
			{
				id: "symptom-cough",
				kind: "symptom",
				name: "咳嗽",
				initialLetter: "K",
			},
			{
				id: "disease-cold",
				kind: "disease",
				name: "普通感冒",
				initialLetter: "P",
			},
			{ id: "drug-cold", kind: "drug", name: "示例药物" },
		],
		diseaseDetails: [
			{
				id: "disease-cold",
				diseaseName: "普通感冒",
				availableDrugs: [
					{ drugId: "drug-cold", drugName: "示例药物", isClickable: true },
				],
			},
		],
		drugDetails: [{ id: "drug-cold", drugName: "示例药物" }],
		diseaseRelations: [
			{
				kind: "crowd",
				relationId: "crowd-adult",
				diseaseId: "disease-cold",
			},
			{
				kind: "department",
				relationId: "department-respiratory",
				diseaseId: "disease-cold",
			},
			{
				kind: "part",
				relationId: "part-respiratory",
				diseaseId: "disease-cold",
			},
		],
		partSymptoms: [{ partId: "part-respiratory", symptomId: "symptom-cough" }],
		symptomDiseases: [
			{ symptomId: "symptom-cough", diseaseId: "disease-cold" },
		],
	};
}

function createFakePool(options: { failAt?: number } = {}): {
	pool: Pool;
	state: {
		statements: string[];
		values: unknown[][];
		committed: boolean;
		rolledBack: boolean;
		released: boolean;
		getConnectionCalls: number;
	};
} {
	const state = {
		statements: [] as string[],
		values: [] as unknown[][],
		committed: false,
		rolledBack: false,
		released: false,
		getConnectionCalls: 0,
	};
	const connection = {
		async beginTransaction() {},
		async commit() {
			state.committed = true;
		},
		async rollback() {
			state.rolledBack = true;
		},
		release() {
			state.released = true;
		},
		async execute(sql: string, values: readonly unknown[] = []) {
			state.statements.push(sql);
			state.values.push([...values]);
			if (options.failAt === state.statements.length) {
				throw new Error("fixture database failure");
			}
			return [[], []];
		},
	};
	const pool = {
		async getConnection() {
			state.getConnectionCalls += 1;
			return connection;
		},
	} as unknown as Pool;
	return { pool, state };
}

test("health knowledge import writes the reviewed bundle in one transaction", async () => {
	const { pool, state } = createFakePool();

	await expect(
		importHealthKnowledgeBundle(pool, validBundle()),
	).resolves.toMatchObject({
		contentVersion: "health-2026-08-15",
		status: "published",
		itemCount: 6,
		diseaseCount: 1,
		drugCount: 1,
		relationCount: 5,
	});
	expect(state.committed).toBe(true);
	expect(state.rolledBack).toBe(false);
	expect(state.released).toBe(true);
	expect(state.statements).toHaveLength(15);
	expect(state.statements[0]).toContain(
		"INSERT INTO hp_health_knowledge_publications",
	);
	expect(state.values[0]?.[0]).toBe("health-2026-08-15");
	expect(state.values.at(-1)).toEqual([
		"health-2026-08-15",
		"symptom-cough",
		"disease-cold",
	]);
});

test("health knowledge import validates before acquiring a connection", async () => {
	const { pool, state } = createFakePool();
	const bundle = validBundle();
	bundle.partSymptoms = [{ partId: "crowd-adult", symptomId: "symptom-cough" }];

	await expect(importHealthKnowledgeBundle(pool, bundle)).rejects.toThrow(
		"partSymptoms[0].partId",
	);
	expect(state.getConnectionCalls).toBe(0);
});

test("health knowledge import rolls back on the first database failure", async () => {
	const { pool, state } = createFakePool({ failAt: 3 });

	await expect(
		importHealthKnowledgeBundle(pool, validBundle()),
	).rejects.toThrow("fixture database failure");
	expect(state.committed).toBe(false);
	expect(state.rolledBack).toBe(true);
	expect(state.released).toBe(true);
});
