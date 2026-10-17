import { expect, test } from "bun:test";
import type { PaymentOperatorAudit } from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import { createInMemoryPaymentOperatorAuditRepository } from "./repositories";

for (const action of [
	"registration_status_read",
	"registration_cancel",
] as const) {
	test(`registration operator audit ${action} survives memory and MySQL append/read`, async () => {
		const audit: PaymentOperatorAudit = {
			auditId: `audit-${action}`,
			operatorRef: "admin-synthetic",
			action,
			aggregateId: "aggregate-synthetic",
			requestId: "request-synthetic",
			outcome: "succeeded",
			occurredAt: "2026-10-17T04:00:00.000Z",
		};
		const row = {
			audit_id: audit.auditId,
			operator_ref: audit.operatorRef,
			action,
			aggregate_id: audit.aggregateId,
			request_id: audit.requestId,
			outcome: audit.outcome,
			reason_code: null,
			result_digest: null,
			occurred_at: "2026-10-17 04:00:00.000",
		};
		const statements: string[] = [];
		const values: unknown[][] = [];
		const pool = {
			async execute(sql: string, params: readonly unknown[]) {
				statements.push(sql);
				values.push([...params]);
				return [
					sql.trimStart().startsWith("INSERT") ? { affectedRows: 1 } : [row],
					[],
				];
			},
		} as unknown as Pool;
		const mysql = createMySqlRepositories(pool).operatorAudits;
		const memory = createInMemoryPaymentOperatorAuditRepository();
		for (const repository of [memory, mysql]) {
			await expect(repository.append(audit)).resolves.toEqual(audit);
			await expect(
				repository.listByAggregate(audit.aggregateId ?? ""),
			).resolves.toEqual([audit]);
		}
		expect(values[0]?.[2]).toBe(action);
		expect(statements).toHaveLength(3);
		expect(statements[0]).toContain("hp_payment_operator_audits");
		expect(action.length).toBeLessThanOrEqual(32);
	});
}
