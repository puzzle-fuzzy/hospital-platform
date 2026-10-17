import {
	type PaymentOperationsBackfillQuery,
	type PaymentOperationsBackfillSource,
	runPaymentOperationsBackfill,
} from "@hospital/domain";
import { createPool } from "mysql2/promise";
import {
	createMySqlRepositories,
	readCoreSchemaStateFromPool,
} from "../src/index.ts";

type BackfillOptions = {
	apply: boolean;
	createdFrom?: string;
	createdTo?: string;
	batchSize: number;
	sources?: readonly PaymentOperationsBackfillSource[];
};

function optionValue(
	args: readonly string[],
	name: string,
): string | undefined {
	const prefix = `${name}=`;
	const value = args.find((arg) => arg.startsWith(prefix));
	return value?.slice(prefix.length);
}

function positiveInteger(value: string | undefined, name: string): number {
	if (value === undefined) return 250;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
		throw new Error(`${name} must be an integer from 1 to 1000`);
	}
	return parsed;
}

function optionalInstant(
	value: string | undefined,
	name: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (!value.trim() || !Number.isFinite(Date.parse(value))) {
		throw new Error(`${name} must be an ISO timestamp`);
	}
	return value;
}

function parseOptions(args: readonly string[]): BackfillOptions {
	if (args.includes("--help")) {
		console.log(
			[
				"Usage: pnpm payment:operations:backfill [options]",
				"",
				"Default mode is dry-run. Writes require both --apply and --yes.",
				"  --apply                 write low-sensitivity operations projections",
				"  --yes                   confirm the apply operation",
				"  --source=...            payment_order, medical_insurance, or all",
				"  --from=ISO              created_at lower bound, inclusive",
				"  --to=ISO                created_at upper bound, exclusive",
				"  --batch-size=N          source page size, 1-1000",
			].join("\n"),
		);
		process.exit(0);
	}
	const apply = args.includes("--apply");
	if (apply && !args.includes("--yes")) {
		throw new Error("--apply requires --yes; run a dry-run first");
	}
	const sourceValue = optionValue(args, "--source");
	let sources: readonly PaymentOperationsBackfillSource[] | undefined;
	if (sourceValue && sourceValue !== "all") {
		if (
			sourceValue !== "payment_order" &&
			sourceValue !== "medical_insurance"
		) {
			throw new Error(
				"--source must be payment_order, medical_insurance, or all",
			);
		}
		sources = [sourceValue];
	}
	const createdFrom = optionalInstant(optionValue(args, "--from"), "--from");
	const createdTo = optionalInstant(optionValue(args, "--to"), "--to");
	return {
		apply,
		...(createdFrom ? { createdFrom } : {}),
		...(createdTo ? { createdTo } : {}),
		batchSize: positiveInteger(
			optionValue(args, "--batch-size"),
			"--batch-size",
		),
		...(sources ? { sources } : {}),
	};
}

async function main(): Promise<void> {
	const options = parseOptions(Bun.argv.slice(2));
	const databaseUrl = Bun.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("DATABASE_URL is required");

	const pool = createPool({
		uri: databaseUrl,
		connectionLimit: 4,
		connectTimeout: 3_000,
		dateStrings: true,
		waitForConnections: true,
	});
	try {
		const schema = await readCoreSchemaStateFromPool(pool);
		if (schema.status !== "ready") {
			throw new Error(
				`payment operations schema is not ready: ${schema.missingMigrationIds.join(", ")}`,
			);
		}
		const repositories = createMySqlRepositories(pool, {
			...(Bun.env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY
				? {
						medicalInsuranceCredentialEncryptionKey:
							Bun.env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY,
					}
				: {}),
		});
		if (
			!repositories.paymentOrders.listForPaymentOperationsBackfill ||
			!repositories.medicalInsuranceOrders.listForPaymentOperationsBackfill
		) {
			throw new Error("payment operations backfill source is not configured");
		}
		const report = await runPaymentOperationsBackfill({
			operations: repositories.paymentOperations,
			listPaymentOrders: (query: PaymentOperationsBackfillQuery) =>
				repositories.paymentOrders.listForPaymentOperationsBackfill?.(query) ??
				Promise.reject(
					new Error("payment order backfill source is unavailable"),
				),
			listMedicalInsuranceOrders: (query: PaymentOperationsBackfillQuery) =>
				repositories.medicalInsuranceOrders.listForPaymentOperationsBackfill?.(
					query,
				) ??
				Promise.reject(
					new Error("medical order backfill source is unavailable"),
				),
			loadMedicalInsuranceSettlementContext: (order) =>
				repositories.medicalInsuranceOrders.getSettlementContext(
					order.ownerUserId,
					order.medicalOrderId,
				),
			mode: options.apply ? "apply" : "dry_run",
			...(options.createdFrom ? { createdFrom: options.createdFrom } : {}),
			...(options.createdTo ? { createdTo: options.createdTo } : {}),
			batchSize: options.batchSize,
			...(options.sources ? { sources: options.sources } : {}),
		});
		console.log(JSON.stringify(report, null, 2));
		if (report.failures.length > 0) process.exitCode = 2;
	} finally {
		await pool.end();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : "UnknownError";
	console.error(`payment-operations-backfill failed: ${message}`);
	process.exitCode = 1;
});
