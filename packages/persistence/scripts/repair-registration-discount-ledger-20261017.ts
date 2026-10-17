/** Narrow maintenance: only the two audited 2026-10-17 orders; no provider API calls. */
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { buildMedicalInsuranceOrderOperationsProjection } from "@hospital/domain";
import { createPool, type Pool } from "mysql2/promise";
import { createMySqlRepositories } from "../src/index.ts";

const IDS = [
	"4a0a3941-3d0b-4da7-a371-0ae4c1b6d4fd",
	"72aa6724-758e-42c7-9dd8-a1e8f4d5705e",
] as const;

async function main() {
	const apply = Bun.argv.includes("--apply");
	if (apply && !Bun.argv.includes("--yes"))
		throw new Error("--apply requires --yes");
	const backupOption = Bun.argv
		.find((arg) => arg.startsWith("--backup-dir="))
		?.slice("--backup-dir=".length);
	if (apply && (!backupOption || !isAbsolute(backupOption)))
		throw new Error("--apply requires --backup-dir=ABSOLUTE_PATH");
	if (
		!Bun.env.DATABASE_URL ||
		!Bun.env.PAYMENT_DATA_ENCRYPTION_KEY ||
		!Bun.env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY
	)
		throw new Error(
			"Database and medical credential encryption configuration are required",
		);
	const pool = createPool({
		uri: Bun.env.DATABASE_URL,
		connectionLimit: 1,
		dateStrings: true,
	});
	const connection = await pool.getConnection();
	try {
		await connection.beginTransaction();
		// Lock only the two audited sources in a consistent order. All reads and writes
		// below share this connection, so an order callback cannot interleave a new fact.
		if (apply)
			await connection.execute(
				"SELECT medical_order_id FROM hp_medical_insurance_orders WHERE medical_order_id IN (?, ?) ORDER BY medical_order_id FOR UPDATE",
				[...IDS],
			);
		const scopedPool = {
			execute: connection.execute.bind(connection),
		} as unknown as Pool;
		const repositories = createMySqlRepositories(scopedPool, {
			paymentDataEncryptionKey: Bun.env.PAYMENT_DATA_ENCRYPTION_KEY,
			medicalInsuranceCredentialEncryptionKey:
				Bun.env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY,
		});
		const plans = [];
		for (const id of IDS) {
			const order =
				await repositories.medicalInsuranceOrders.findByMedicalOrderId(id);
			if (
				order?.status !== "insurance_settled" ||
				order.amounts?.totalFen !== 1000 ||
				order.amounts.cashFen !== 200 ||
				order.amounts.fundFen + order.amounts.personalAccountFen !== 800 ||
				(order.amounts.otherPaymentFen ?? 0) !== 0 ||
				(order.amounts.hospitalPartFen ?? 0) !== 0
			)
				throw new Error(`Audited source no longer matches: ${id}`);
			const previous =
				await repositories.paymentOperations.findAggregateByBusinessKey(
					`medical_insurance:${id}`,
				);
			if (!previous || previous.sourceVersion !== order.version)
				throw new Error(`Audited aggregate source changed: ${id}`);
			const previousLegs = await repositories.paymentOperations.listLegs(
				previous.aggregateId,
			);
			if (previousLegs.some((leg) => leg.status === "refunded"))
				throw new Error(`Refund state requires separate review: ${id}`);
			const context =
				await repositories.medicalInsuranceOrders.getSettlementContext(
					order.ownerUserId,
					id,
				);
			const projection = buildMedicalInsuranceOrderOperationsProjection(
				order,
				previous,
				context,
			);
			if (
				projection?.aggregate.status !== "paid" ||
				projection.aggregate.cashFen !== 0 ||
				projection.aggregate.insuranceFen !== 800 ||
				projection.legs.find((leg) => leg.legType === "hospital_reduce")
					?.amountFen !== 200 ||
				projection.legs.find((leg) => leg.legType === "unallocated")
					?.amountFen !== 0
			)
				throw new Error(`Successful allocation evidence mismatch: ${id}`);
			const unchanged =
				previous.cashFen === 0 &&
				previous.insuranceFen === 800 &&
				projection.legs.every((next) =>
					previousLegs.some(
						(old) =>
							old.legType === next.legType &&
							old.amountFen === next.amountFen &&
							old.status === next.status,
					),
				);
			plans.push({
				id,
				sourceVersion: order.version,
				previous,
				previousLegs,
				projection,
				unchanged,
			});
		}
		if (apply) {
			if (!backupOption) throw new Error("Missing backup directory");
			const backupDirectory = resolve(backupOption);
			await mkdir(backupDirectory, { recursive: true });
			// Write the before-image successfully before any database mutation.
			await writeFile(
				resolve(backupDirectory, `before-${Date.now()}.json`),
				JSON.stringify(
					{ capturedAt: new Date().toISOString(), plans },
					null,
					2,
				),
				{ flag: "wx", mode: 0o600 },
			);
			for (const plan of plans) {
				if (plan.unchanged) continue;
				await repositories.paymentOperations.upsertAggregate(
					plan.projection.aggregate,
					plan.previous.version,
				);
				for (const next of plan.projection.legs) {
					const old = plan.previousLegs.find(
						(leg) => leg.legType === next.legType,
					);
					await repositories.paymentOperations.upsertLeg(
						{
							...next,
							version: Math.max(next.version, (old?.version ?? 0) + 1),
						},
						old?.version,
					);
				}
				if (plan.projection.event)
					await repositories.paymentOperations.appendEvent(
						plan.projection.event,
					);
				const stored = await repositories.paymentOperations.findAggregateById(
					plan.previous.aggregateId,
				);
				const legs = await repositories.paymentOperations.listLegs(
					plan.previous.aggregateId,
				);
				if (
					stored?.cashFen !== 0 ||
					stored.insuranceFen !== 800 ||
					legs.reduce((sum, leg) => sum + leg.amountFen, 0) !== 1000 ||
					legs.find((leg) => leg.legType === "wechat_cash")?.status ===
						"confirmed"
				)
					throw new Error(`Post-write ledger validation failed: ${plan.id}`);
			}
			await connection.commit();
		} else await connection.rollback();
		console.log(
			JSON.stringify(
				{
					mode: apply ? "apply" : "dry_run",
					sourceOrdersChanged: 0,
					providerCalls: 0,
					plans: plans.map((plan) => ({
						medicalOrderId: plan.id,
						sourceVersion: plan.sourceVersion,
						unchanged: plan.unchanged,
						insuranceFen: 800,
						hospitalReduceFen: 200,
						wechatCashFen: 0,
					})),
				},
				null,
				2,
			),
		);
	} catch (error) {
		await connection.rollback();
		throw error;
	} finally {
		connection.release();
		await pool.end();
	}
}

if (import.meta.main)
	main().catch((error) => {
		console.error(
			error instanceof Error ? error.message : "Ledger repair failed",
		);
		process.exitCode = 1;
	});
