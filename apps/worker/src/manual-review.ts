import { config } from "@hospital/config";
import {
	MANUAL_REVIEW_REASON_CODES,
	type ManualReviewKind,
	type ManualReviewReasonCode,
} from "@hospital/domain";
import { createLogger } from "@hospital/observability";
import { createPersistenceRuntime } from "@hospital/persistence";

/** 维护命令默认只读取有限条目，避免误把死信表当成数据导出接口。 */
const DEFAULT_LIST_LIMIT = 50;
/** 列表命令的最大输出条数；更大的清单必须由运维分页处理。 */
const MAX_LIST_LIMIT = 100;

export type ManualReviewCommand =
	| { action: "list"; limit: number }
	| { action: "check"; limit: number }
	| {
			action: "requeue";
			kind: ManualReviewKind;
			id: string;
			reasonCode: ManualReviewReasonCode;
			confirmed: true;
	  };

export const MANUAL_REVIEW_USAGE =
	"用法：bun run src/manual-review.ts list|check [--limit 1..100]；" +
	"bun run src/manual-review.ts requeue --kind outbox|wechat-payment-query " +
	"--id <id> --reason operator-confirmed|provider-evidence-confirmed|false-positive-reviewed --confirm";

function optionValue(
	args: readonly string[],
	name: string,
): string | undefined {
	const index = args.indexOf(name);
	if (index < 0) return undefined;
	const value = args[index + 1];
	return value && !value.startsWith("--") ? value : undefined;
}

function parseListLimit(value: string | undefined): number {
	if (value === undefined) return DEFAULT_LIST_LIMIT;
	if (!/^\d+$/u.test(value)) throw new Error("invalid-limit");
	const limit = Number(value);
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
		throw new Error("invalid-limit");
	}
	return limit;
}

function parseKind(value: string | undefined): ManualReviewKind {
	if (value === "outbox" || value === "wechat-payment-query") return value;
	throw new Error("invalid-kind");
}

function parseReasonCode(value: string | undefined): ManualReviewReasonCode {
	if (
		typeof value === "string" &&
		MANUAL_REVIEW_REASON_CODES.includes(value as ManualReviewReasonCode)
	) {
		return value as ManualReviewReasonCode;
	}
	throw new Error("invalid-reason");
}

/**
 * 解析维护命令参数并强制人工确认。
 *
 * requeue 是会改变支付/outbox 调度状态的命令，必须同时提供固定原因码和
 * `--confirm`；这样误把 list 参数写错、复制半条命令或在自动化脚本中漏掉
 * 人工授权时，命令会在连接数据库前直接失败。
 */
export function parseManualReviewArgs(
	args: readonly string[],
): ManualReviewCommand {
	const action = args[0];
	if (action === "list" || action === "check") {
		if (args.some((arg) => arg === "--confirm"))
			throw new Error("unexpected-confirm");
		return {
			action,
			limit: parseListLimit(optionValue(args, "--limit")),
		};
	}

	if (action !== "requeue") throw new Error("invalid-action");
	if (!args.includes("--confirm")) throw new Error("confirmation-required");
	const id = optionValue(args, "--id");
	if (!id || id.length > 128 || id !== id.trim()) throw new Error("invalid-id");
	return {
		action: "requeue",
		kind: parseKind(optionValue(args, "--kind")),
		id,
		reasonCode: parseReasonCode(optionValue(args, "--reason")),
		confirmed: true,
	};
}

function safeCommandError(error: unknown): string {
	if (!(error instanceof Error)) return "manual-review-command-failed";
	return [
		"invalid-action",
		"invalid-limit",
		"invalid-kind",
		"invalid-reason",
		"invalid-id",
		"confirmation-required",
		"unexpected-confirm",
	].includes(error.message)
		? error.message
		: "manual-review-command-failed";
}

async function assertMaintenanceReady() {
	if (!config.persistenceSchemaReady || !config.databaseUrl) {
		throw new Error("persistence-not-configured");
	}
	const runtime = createPersistenceRuntime({
		databaseUrl: config.databaseUrl,
		redisUrl: undefined,
		useRepositories: true,
	});
	try {
		const [database, schema] = await Promise.all([
			runtime.database.check(),
			runtime.schema.check(),
		]);
		if (database !== "ok" || schema !== "ok") {
			throw new Error("persistence-not-ready");
		}
		if (!runtime.repositories) throw new Error("persistence-not-configured");
		return { runtime, operations: runtime.repositories.operations };
	} catch (error) {
		await runtime.close();
		throw error;
	}
}

async function run(command: ManualReviewCommand): Promise<number> {
	const logger = createLogger({
		service: "hospital-worker-manual-review",
		environment: config.environment,
		level: config.logLevel,
	});
	const { runtime, operations } = await assertMaintenanceReady();
	try {
		if (command.action === "list") {
			const snapshot = await operations.list(command.limit);
			// 只输出仓储已经投影过的低敏摘要；不要在这里展开任何 payload。
			console.log(JSON.stringify({ success: true, data: snapshot }, null, 2));
			return 0;
		}

		if (command.action === "check") {
			const snapshot = await operations.list(command.limit);
			const outboxCount = snapshot.outbox.length;
			const paymentQueryCount = snapshot.paymentQueries.length;
			const total = outboxCount + paymentQueryCount;
			if (total > 0) {
				logger.error(
					{
						event: "maintenance.manual_review.alert",
						outboxCount,
						paymentQueryCount,
						truncated: total >= command.limit * 2,
						runtimeMode: config.environment,
					},
					"Manual review queue is not empty",
				);
			}
			console.log(
				JSON.stringify({
					success: true,
					data: {
						outboxCount,
						paymentQueryCount,
						total,
						hasManualReview: total > 0,
					},
				}),
			);
			// 退出码 2 供 systemd timer、监控或告警平台识别死信积压；
			// 这不是 API 错误，也不会触发自动重放。
			return total > 0 ? 2 : 0;
		}

		const changed = await operations.requeue({
			kind: command.kind,
			id: command.id,
			now: new Date(),
			reasonCode: command.reasonCode,
		});
		if (!changed) {
			throw new Error("manual-review-item-not-found-or-already-changed");
		}
		logger.warn(
			{
				event: "maintenance.manual_review.requeued",
				kind: command.kind,
				id: command.id,
				reasonCode: command.reasonCode,
				runtimeMode: config.environment,
			},
			"Manual review item requeued by an operator",
		);
		console.log(
			JSON.stringify({ success: true, kind: command.kind, id: command.id }),
		);
		return 0;
	} finally {
		await runtime.close();
	}
}

if (import.meta.main) {
	try {
		process.exitCode = await run(parseManualReviewArgs(Bun.argv.slice(2)));
	} catch (error) {
		console.error(
			JSON.stringify({
				success: false,
				error: {
					code: safeCommandError(error),
					message: MANUAL_REVIEW_USAGE,
				},
			}),
		);
		process.exitCode = 1;
	}
}
