import { createPool } from "mysql2/promise";
import {
	resolveHisPaymentReferenceBackfillOptions,
	runHisPaymentReferenceBackfill,
} from "../src/his-payment-reference-backfill";
import { readCoreSchemaStateFromPool } from "../src/migrate";
import { createMySqlRepositories } from "../src/mysql-repositories";

function optionValue(
	args: readonly string[],
	name: string,
): string | undefined {
	const values = args.filter((arg) => arg.startsWith(`${name}=`));
	if (values.length > 1) throw new Error("Repeated backfill option");
	return values[0]?.slice(name.length + 1);
}

async function main(): Promise<void> {
	const args = Bun.argv.slice(2);
	if (args.includes("--help")) {
		console.log(
			[
				"Usage: bun run his:references:backfill [options]",
				"Default is dry-run; writes require --apply --yes.",
				"Requires HIS_REFERENCE_DATABASE_URL and MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY.",
				"  --apply --yes       import persisted successful numeric .29 receipts",
				"  --initialize-new-numbering  enable allocations only after a complete clean --apply --yes scan (stop API/Worker writes first)",
				"  --from=ISO          created_at lower bound, inclusive, with timezone",
				"  --to=ISO            created_at upper bound, exclusive, with timezone",
				"  --batch-size=N      1-1000, default 250",
				"  --max-orders=N      1-100000, default 10000",
			].join("\n"),
		);
		return;
	}
	if (
		args.some(
			(arg) =>
				!["--apply", "--yes", "--initialize-new-numbering"].includes(arg) &&
				!["--from=", "--to=", "--batch-size=", "--max-orders="].some((prefix) =>
					arg.startsWith(prefix),
				),
		)
	)
		throw new Error("Unknown backfill option");
	const apply = args.includes("--apply");
	if (apply && !args.includes("--yes"))
		throw new Error("--apply requires --yes");
	const from = optionValue(args, "--from");
	const to = optionValue(args, "--to");
	const batch = optionValue(args, "--batch-size");
	const maximum = optionValue(args, "--max-orders");
	for (const value of [batch, maximum]) {
		if (value !== undefined && !/^[1-9]\d*$/u.test(value))
			throw new Error("Backfill integer option is invalid");
	}
	const options = resolveHisPaymentReferenceBackfillOptions({
		mode: apply ? "apply" : "dry_run",
		initializeNewNumbering: args.includes("--initialize-new-numbering"),
		...(from !== undefined ? { createdFrom: from } : {}),
		...(to !== undefined ? { createdTo: to } : {}),
		...(batch !== undefined ? { batchSize: Number(batch) } : {}),
		...(maximum !== undefined ? { maxOrders: Number(maximum) } : {}),
	});
	const databaseUrl = Bun.env.HIS_REFERENCE_DATABASE_URL;
	const encryptionKey = Bun.env.MEDICAL_INSURANCE_CREDENTIAL_ENCRYPTION_KEY;
	if (!databaseUrl || !encryptionKey)
		throw new Error("Required backfill environment is not configured");
	const pool = createPool({
		uri: databaseUrl,
		connectionLimit: 2,
		connectTimeout: 3_000,
		dateStrings: true,
		waitForConnections: true,
	});
	try {
		if ((await readCoreSchemaStateFromPool(pool)).status !== "ready")
			throw new Error("HIS reference schema is not ready");
		const repositories = createMySqlRepositories(pool, {
			medicalInsuranceCredentialEncryptionKey: encryptionKey,
		});
		const source =
			repositories.medicalInsuranceOrders.listForPaymentOperationsBackfill;
		if (!source)
			throw new Error("HIS reference backfill source is unavailable");
		const report = await runHisPaymentReferenceBackfill({
			...options,
			listOrders: (query) => source(query),
			getSettlementContext: (owner, id) =>
				repositories.medicalInsuranceOrders.getSettlementContext(owner, id),
			references: repositories.hisPaymentReferences,
		});
		console.log(JSON.stringify(report, null, 2));
		if (
			report.failed ||
			report.conflicts ||
			report.initialization === "blocked"
		)
			process.exitCode = 2;
	} finally {
		await pool.end();
	}
}

if (import.meta.main) {
	main().catch(() => {
		// 不打印底层异常，避免连接配置、解密上下文或凭证进入控制台。
		console.error(
			"HIS payment reference backfill failed; check arguments, dedicated database configuration, key, and schema",
		);
		process.exitCode = 1;
	});
}
