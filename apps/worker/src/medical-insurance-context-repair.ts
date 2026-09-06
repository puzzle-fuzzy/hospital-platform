import { config } from "@hospital/config";
import type {
	MedicalInsuranceOrderRepository,
	MedicalInsuranceSettlementContext,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";

const OPAQUE_IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/u;
const MAX_TRADE_ORDER_IDS = 64;

export type MedicalInsuranceContextRepairCommand = {
	orderId: string;
	confirmed: true;
};

export type MedicalInsuranceContextRepairInput = {
	businessId: string;
	businessCode?: string;
	hospitalId: string;
	patientId: string;
	tradeOrderIds: readonly string[];
	payingId: string;
	tradingId: string;
	evidenceSource: "provider-log" | "zhongyang-console";
};

export type MedicalInsuranceContextRepairResult = {
	orderId: string;
	status: string;
	evidenceSource: MedicalInsuranceContextRepairInput["evidenceSource"];
	tradeOrderCount: number;
	contextSaved: true;
};

export const MEDICAL_INSURANCE_CONTEXT_REPAIR_USAGE =
	"用法：bun run src/medical-insurance-context-repair.ts --order-id <平台医保订单号> --confirm < context.json；" +
	"context.json 只允许包含已从 provider 日志或众阳运维侧核实的完整关单上下文。";

function optionValue(
	args: readonly string[],
	name: string,
): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const value = args[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

function requireOpaque(value: unknown, field: string): string {
	if (typeof value !== "string" || !OPAQUE_IDENTIFIER.test(value)) {
		throw new Error(`invalid-${field}`);
	}
	return value;
}

function requireNumericOpaque(value: unknown, field: string): string {
	const normalized = requireOpaque(value, field);
	if (!/^\d+$/u.test(normalized)) throw new Error(`invalid-${field}`);
	return normalized;
}

function optionalOpaque(value: unknown, field: string): string | undefined {
	if (value === undefined) return undefined;
	return requireOpaque(value, field);
}

export function parseMedicalInsuranceContextRepairArgs(
	args: readonly string[],
): MedicalInsuranceContextRepairCommand {
	if (!args.includes("--confirm")) throw new Error("confirmation-required");
	const orderId = optionValue(args, "--order-id");
	if (!orderId || !OPAQUE_IDENTIFIER.test(orderId))
		throw new Error("invalid-order-id");
	if (
		args.length !== 3 ||
		args.filter((arg) => arg === "--order-id").length !== 1 ||
		args.filter((arg) => arg === "--confirm").length !== 1
	)
		throw new Error("invalid-argument");
	return { orderId, confirmed: true };
}

export function parseMedicalInsuranceContextRepairInput(
	value: unknown,
): MedicalInsuranceContextRepairInput {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("invalid-context-json");
	const input = value as Record<string, unknown>;
	const tradeOrderIds = input.tradeOrderIds;
	if (
		!Array.isArray(tradeOrderIds) ||
		tradeOrderIds.length < 1 ||
		tradeOrderIds.length > MAX_TRADE_ORDER_IDS
	) {
		throw new Error("invalid-trade-order-ids");
	}
	const normalizedTradeOrderIds = tradeOrderIds.map((item) =>
		requireOpaque(item, "trade-order-id"),
	);
	if (new Set(normalizedTradeOrderIds).size !== normalizedTradeOrderIds.length)
		throw new Error("duplicate-trade-order-id");

	const evidenceSource = input.evidenceSource;
	if (
		evidenceSource !== "provider-log" &&
		evidenceSource !== "zhongyang-console"
	)
		throw new Error("invalid-evidence-source");

	return {
		businessId: requireOpaque(input.businessId, "business-id"),
		...(optionalOpaque(input.businessCode, "business-code")
			? { businessCode: input.businessCode as string }
			: {}),
		hospitalId: requireOpaque(input.hospitalId, "hospital-id"),
		patientId: requireOpaque(input.patientId, "patient-id"),
		tradeOrderIds: normalizedTradeOrderIds,
		payingId: requireNumericOpaque(input.payingId, "paying-id"),
		tradingId: requireNumericOpaque(input.tradingId, "trading-id"),
		evidenceSource,
	};
}

/**
 * 将已核实的 Provider 三元组补入现有订单，仅允许“原来没有上下文”的订单。
 * 该函数不访问 Provider、不改变订单状态，也不会覆盖已经存在的密文上下文。
 */
export async function repairMedicalInsuranceSettlementContext(input: {
	orderId: string;
	context: MedicalInsuranceContextRepairInput;
	orders: MedicalInsuranceOrderRepository;
}): Promise<MedicalInsuranceContextRepairResult> {
	const order = await input.orders.findByMedicalOrderId(input.orderId);
	if (!order) throw new Error("medical-order-not-found");
	if (order.status === "cancelled" || order.status === "insurance_settled")
		throw new Error("medical-order-terminal");
	const existing = await input.orders.getSettlementContext(
		order.ownerUserId,
		order.medicalOrderId,
	);
	if (existing) throw new Error("settlement-context-already-exists");

	const settlementContext: MedicalInsuranceSettlementContext = {
		businessId: input.context.businessId,
		...(input.context.businessCode
			? { businessCode: input.context.businessCode }
			: {}),
		hospitalId: input.context.hospitalId,
		patientId: input.context.patientId,
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: input.context.tradeOrderIds,
		payingId: input.context.payingId,
		tradingId: input.context.tradingId,
	};
	const saved = await input.orders.saveSettlementContextIfMissing(
		order.ownerUserId,
		order.medicalOrderId,
		settlementContext,
	);
	if (!saved) throw new Error("settlement-context-already-exists");
	return {
		orderId: order.medicalOrderId,
		status: order.status,
		evidenceSource: input.context.evidenceSource,
		tradeOrderCount: input.context.tradeOrderIds.length,
		contextSaved: true,
	};
}

function safeCommandError(error: unknown): string {
	if (!(error instanceof Error)) return "context-repair-failed";
	return [
		"confirmation-required",
		"invalid-argument",
		"invalid-order-id",
		"invalid-context-json",
		"invalid-business-id",
		"invalid-business-code",
		"invalid-hospital-id",
		"invalid-patient-id",
		"invalid-paying-id",
		"invalid-trading-id",
		"invalid-trade-order-ids",
		"invalid-trade-order-id",
		"duplicate-trade-order-id",
		"invalid-evidence-source",
		"medical-order-not-found",
		"medical-order-terminal",
		"settlement-context-already-exists",
	].includes(error.message)
		? error.message
		: "context-repair-failed";
}

async function readContextFromStdin(): Promise<MedicalInsuranceContextRepairInput> {
	const text = await new Response(Bun.stdin).text();
	if (!text.trim()) throw new Error("invalid-context-json");
	try {
		return parseMedicalInsuranceContextRepairInput(JSON.parse(text));
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("invalid-context-json");
		throw error;
	}
}

async function createRepairRuntime() {
	if (
		!config.persistenceSchemaReady ||
		!config.databaseUrl ||
		!config.medicalInsuranceCredentialEncryptionKey
	) {
		throw new Error("persistence-or-encryption-not-configured");
	}
	const runtime = createPersistenceRuntime({
		databaseUrl: config.databaseUrl,
		redisUrl: undefined,
		medicalInsuranceCredentialEncryptionKey:
			config.medicalInsuranceCredentialEncryptionKey,
		useRepositories: true,
	});
	try {
		const [database, schema] = await Promise.all([
			runtime.database.check(),
			runtime.schema.check(),
		]);
		if (database !== "ok" || schema !== "ok" || !runtime.repositories)
			throw new Error("persistence-not-ready");
		return runtime;
	} catch (error) {
		await runtime.close();
		throw error;
	}
}

async function run(
	command: MedicalInsuranceContextRepairCommand,
): Promise<number> {
	const context = await readContextFromStdin();
	const runtime = await createRepairRuntime();
	const logger = createLogger({
		service: "hospital-worker-medical-insurance-context-repair",
		environment: config.environment,
		level: config.logLevel,
	});
	try {
		const result = await repairMedicalInsuranceSettlementContext({
			orderId: command.orderId,
			context,
			orders: runtime.repositories
				?.medicalInsuranceOrders as MedicalInsuranceOrderRepository,
		});
		logger.warn(
			{
				event: "maintenance.medical_insurance_context.repaired",
				orderId: result.orderId,
				status: result.status,
				evidenceSource: result.evidenceSource,
				tradeOrderCount: result.tradeOrderCount,
				contextSaved: result.contextSaved,
				runtimeMode: config.environment,
			},
			"Medical insurance cancellation context repaired by an operator",
		);
		console.log(JSON.stringify(result));
		return 0;
	} finally {
		await runtime.close();
	}
}

if (import.meta.main) {
	try {
		process.exitCode = await run(
			parseMedicalInsuranceContextRepairArgs(Bun.argv.slice(2)),
		);
	} catch (error) {
		console.error(
			JSON.stringify({
				success: false,
				error: {
					code: safeCommandError(error),
					message: MEDICAL_INSURANCE_CONTEXT_REPAIR_USAGE,
				},
			}),
		);
		process.exitCode = 1;
	}
}
