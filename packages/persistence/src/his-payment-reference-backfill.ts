import {
	HisPaymentReferenceConflictError,
	type HisPaymentReferenceRepository,
	type HisPaymentReferenceScope,
	type MedicalInsuranceOrder,
	type MedicalInsuranceSettlementContext,
	normalizeHisPaymentReference,
	type PaymentOperationsBackfillQuery,
} from "@hospital/domain";

type SourceOrder = Pick<
	MedicalInsuranceOrder,
	"medicalOrderId" | "ownerUserId" | "createdAt"
>;
type IssueReason =
	| "missing_context"
	| "no_successful_receipt"
	| "non_numeric_receipt"
	| "unknown_third_party_attempt"
	| "ambiguous_cash_component"
	| "context_read_failed"
	| "mapping_read_failed"
	| "mapping_conflict"
	| "mapping_quarantine_failed"
	| "mapping_write_failed";

export type HisPaymentReferenceBackfillInput = {
	listOrders(
		query: PaymentOperationsBackfillQuery,
	): Promise<readonly SourceOrder[]>;
	getSettlementContext(
		ownerUserId: string,
		medicalOrderId: string,
	): Promise<MedicalInsuranceSettlementContext | undefined>;
	references: Pick<
		HisPaymentReferenceRepository,
		| "findByReferenceId"
		| "findByScope"
		| "confirm"
		| "initializeNewNumbering"
		| "quarantineReferenceId"
	>;
	mode?: "dry_run" | "apply";
	createdFrom?: string;
	createdTo?: string;
	batchSize?: number;
	maxOrders?: number;
	/** 只在停写、无窗口限制的完整 apply 成功后显式启用新编号分配。 */
	initializeNewNumbering?: boolean;
};

export type HisPaymentReferenceBackfillReport = {
	mode: "dry_run" | "apply";
	filters: {
		createdFrom?: string;
		createdTo?: string;
		batchSize: number;
		maxOrders: number;
	};
	scannedOrders: number;
	eligibleReferences: number;
	wouldImport: number;
	imported: number;
	unchanged: number;
	skippedMissingContext: number;
	skippedNoSuccessfulReceipt: number;
	skippedNonNumericReceipt: number;
	skippedUnknownAttempt: number;
	skippedUnsafeReceipt: number;
	initialization: "not_requested" | "blocked" | "completed";
	initializationBlockedReasons: string[];
	conflicts: number;
	failed: number;
	limitReached: boolean;
	cursor?: { afterCreatedAt: string; afterSourceOrderId: string };
	/** 只包含平台内部订单引用和固定原因；不包含回执号或解密上下文。 */
	issues: { medicalOrderId: string; reason: IssueReason }[];
};

function boundedInteger(value: number, name: string, maximum: number): number {
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new Error(`HIS reference backfill ${name} must be 1-${maximum}`);
	}
	return value;
}

function instant(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (
		!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(
			value,
		) ||
		!Number.isFinite(Date.parse(value)) ||
		new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !==
			value.slice(0, 10)
	) {
		throw new Error(
			"HIS reference backfill time bound must be an ISO timestamp with timezone",
		);
	}
	return new Date(value).toISOString();
}

function key(scope: HisPaymentReferenceScope): string {
	return JSON.stringify([
		scope.ownerUserId,
		scope.medicalOrderId,
		scope.source,
		scope.paymentScopeId,
	]);
}

/** CLI 先验证全部边界，再创建数据库连接。 */
export function resolveHisPaymentReferenceBackfillOptions(
	input: Pick<
		HisPaymentReferenceBackfillInput,
		| "mode"
		| "batchSize"
		| "maxOrders"
		| "createdFrom"
		| "createdTo"
		| "initializeNewNumbering"
	>,
): HisPaymentReferenceBackfillReport["filters"] & {
	mode: "dry_run" | "apply";
	initializeNewNumbering: boolean;
} {
	const mode = input.mode ?? "dry_run";
	if (mode !== "dry_run" && mode !== "apply")
		throw new Error("Invalid HIS reference backfill mode");
	const batchSize = boundedInteger(input.batchSize ?? 250, "batchSize", 1_000);
	const maxOrders = boundedInteger(
		input.maxOrders ?? 10_000,
		"maxOrders",
		100_000,
	);
	const createdFrom = instant(input.createdFrom);
	const createdTo = instant(input.createdTo);
	if (createdFrom && createdTo && createdFrom >= createdTo)
		throw new Error("HIS reference backfill time bounds are reversed");
	const initializeNewNumbering = input.initializeNewNumbering ?? false;
	if (
		typeof initializeNewNumbering !== "boolean" ||
		(initializeNewNumbering && (mode !== "apply" || createdFrom || createdTo))
	)
		throw new Error(
			"New HIS numbering initialization requires an unbounded apply scan",
		);
	return {
		mode,
		initializeNewNumbering,
		batchSize,
		maxOrders,
		...(createdFrom ? { createdFrom } : {}),
		...(createdTo ? { createdTo } : {}),
	};
}

/**
 * 仅根据已持久化的 .29 成功事实补索引；不读取 provider 原文推断状态，
 * 不调用 allocate，也不发送/重放任何支付或退费请求。默认 dry-run。
 */
export async function runHisPaymentReferenceBackfill(
	input: HisPaymentReferenceBackfillInput,
): Promise<HisPaymentReferenceBackfillReport> {
	const {
		mode,
		batchSize,
		maxOrders,
		createdFrom,
		createdTo,
		initializeNewNumbering,
	} = resolveHisPaymentReferenceBackfillOptions(input);
	const report: HisPaymentReferenceBackfillReport = {
		mode,
		filters: {
			batchSize,
			maxOrders,
			...(createdFrom ? { createdFrom } : {}),
			...(createdTo ? { createdTo } : {}),
		},
		scannedOrders: 0,
		eligibleReferences: 0,
		wouldImport: 0,
		imported: 0,
		unchanged: 0,
		skippedMissingContext: 0,
		skippedNoSuccessfulReceipt: 0,
		skippedNonNumericReceipt: 0,
		skippedUnknownAttempt: 0,
		skippedUnsafeReceipt: 0,
		initialization: initializeNewNumbering ? "blocked" : "not_requested",
		initializationBlockedReasons: [],
		conflicts: 0,
		failed: 0,
		limitReached: false,
		issues: [],
	};
	const seenReceipts = new Map<string, string>();
	const ambiguousReceipts = new Set<string>();
	const staged: (HisPaymentReferenceScope & { referenceId: string })[] = [];
	let previous: { timestamp: number; medicalOrderId: string } | undefined;
	const issue = (medicalOrderId: string, reason: IssueReason) => {
		if (report.issues.length < 100)
			report.issues.push({ medicalOrderId, reason });
	};
	while (report.scannedOrders < maxOrders) {
		const limit = Math.min(batchSize, maxOrders - report.scannedOrders);
		const rows = await input.listOrders({
			limit,
			...(createdFrom ? { createdFrom } : {}),
			...(createdTo ? { createdTo } : {}),
			...(report.cursor ?? {}),
		});
		if (rows.length > limit)
			throw new Error("HIS reference backfill source exceeded its batch limit");
		if (rows.length === 0) break;
		// 整批先核验游标与时间边界，避免失控 source 在检查前产生写入。
		let pageCursor = previous;
		for (const order of rows) {
			const timestamp = Date.parse(order.createdAt);
			if (
				!Number.isFinite(timestamp) ||
				!/^[A-Za-z0-9._:-]{1,64}$/u.test(order.medicalOrderId) ||
				!/^[A-Za-z0-9._:-]{1,64}$/u.test(order.ownerUserId)
			)
				throw new Error("Invalid HIS reference backfill source row");
			if (
				(createdFrom && timestamp < Date.parse(createdFrom)) ||
				(createdTo && timestamp >= Date.parse(createdTo))
			)
				throw new Error(
					"HIS reference backfill source returned a row outside time bounds",
				);
			if (
				pageCursor &&
				(timestamp < pageCursor.timestamp ||
					(timestamp === pageCursor.timestamp &&
						order.medicalOrderId <= pageCursor.medicalOrderId))
			)
				throw new Error(
					"HIS reference backfill cursor is not strictly increasing",
				);
			pageCursor = { timestamp, medicalOrderId: order.medicalOrderId };
		}
		previous = pageCursor;
		for (const order of rows) {
			report.scannedOrders += 1;
			report.cursor = {
				afterCreatedAt: order.createdAt,
				afterSourceOrderId: order.medicalOrderId,
			};
			let context: MedicalInsuranceSettlementContext | undefined;
			try {
				context = await input.getSettlementContext(
					order.ownerUserId,
					order.medicalOrderId,
				);
			} catch {
				report.failed += 1;
				issue(order.medicalOrderId, "context_read_failed");
				continue;
			}
			if (!context) {
				report.skippedMissingContext += 1;
				issue(order.medicalOrderId, "missing_context");
				continue;
			}
			const candidates: (HisPaymentReferenceScope & {
				referenceId: unknown;
			})[] = [];
			const plugin = context.plugin;
			let ambiguousOrUnknown = false;
			if (
				plugin?.thirdPartPayAttempt?.status === "unknown" ||
				(plugin?.state === "cash_paid" &&
					(!plugin.thirdPartPayRecordId ||
						plugin.thirdPartPayAttempt?.status !== "succeeded"))
			) {
				report.skippedUnknownAttempt += 1;
				issue(order.medicalOrderId, "unknown_third_party_attempt");
				ambiguousOrUnknown = true;
			} else if (
				plugin &&
				["29_succeeded", "15_succeeded", "settled"].includes(plugin.state)
			) {
				candidates.push({
					ownerUserId: order.ownerUserId,
					medicalOrderId: order.medicalOrderId,
					paymentScopeId: plugin.paymentOrderId,
					source: "plugin",
					referenceId: plugin.thirdPartPayRecordId,
				});
			}
			const cash =
				context.postPaymentComponents?.filter(
					(component) =>
						component.kind === "wechat_cash" && component.state === "succeeded",
				) ?? [];
			if (
				context.selfPayThirdPartyWriteback?.status === "unknown" ||
				context.selfPayThirdPartyWriteback?.status === "failed"
			) {
				report.skippedUnknownAttempt += 1;
				ambiguousOrUnknown = true;
				issue(order.medicalOrderId, "unknown_third_party_attempt");
			} else if (
				context.selfPayThirdPartyWriteback?.status === "succeeded" &&
				(cash.length !== 1 ||
					context.postPaymentComponents?.filter(
						(item) => item.kind === "wechat_cash",
					).length !== 1)
			) {
				report.conflicts += 1;
				ambiguousOrUnknown = true;
				issue(order.medicalOrderId, "ambiguous_cash_component");
			} else if (
				context.selfPayThirdPartyWriteback?.status === "succeeded" &&
				cash[0]
			) {
				candidates.push({
					ownerUserId: order.ownerUserId,
					medicalOrderId: order.medicalOrderId,
					paymentScopeId: cash[0].componentId,
					source: "component",
					referenceId: context.selfPayThirdPartyWriteback.thirdPartPayRecordId,
				});
			}
			if (candidates.length === 0 && !ambiguousOrUnknown) {
				report.skippedNoSuccessfulReceipt += 1;
				issue(order.medicalOrderId, "no_successful_receipt");
			}
			for (const candidate of candidates) {
				let referenceId: string;
				try {
					referenceId = normalizeHisPaymentReference(candidate.referenceId);
				} catch {
					report.skippedNonNumericReceipt += 1;
					// 明确历史 opaque/UUID 标记保留旧恢复入口；缺失、溢出、
					// 小数和指数等可疑数值不能据此认定历史编号已完整占用。
					const value = candidate.referenceId;
					const numericLike =
						typeof value === "string" &&
						/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value);
					if (
						typeof value !== "string" ||
						!/^[A-Za-z0-9._:-]{1,128}$/u.test(value) ||
						numericLike
					)
						report.skippedUnsafeReceipt += 1;
					issue(order.medicalOrderId, "non_numeric_receipt");
					continue;
				}
				report.eligibleReferences += 1;
				const scopeKey = key(candidate);
				const seen = seenReceipts.get(referenceId);
				if (seen && seen !== scopeKey) ambiguousReceipts.add(referenceId);
				seenReceipts.set(referenceId, scopeKey);
				staged.push({ ...candidate, referenceId });
			}
		}
		if (rows.length < limit) break;
	}
	report.limitReached = report.scannedOrders >= maxOrders;
	// 所有候选先做相同的只读预检，再进入写入阶段，避免 dry-run 漏报已绑定
	// 同一 scope 的其他成功回执；扫描时出现的重复号也不靠写入先后决定归属。
	const prepared: typeof staged = [];
	const quarantineIds = new Set(ambiguousReceipts);
	for (const candidate of staged) {
		const { referenceId, medicalOrderId } = candidate;
		if (ambiguousReceipts.has(referenceId)) {
			report.conflicts += 1;
			issue(medicalOrderId, "mapping_conflict");
			continue;
		}
		let existing: Awaited<
			ReturnType<HisPaymentReferenceRepository["findByReferenceId"]>
		>;
		let existingScope: Awaited<
			ReturnType<HisPaymentReferenceRepository["findByScope"]>
		>;
		try {
			existing = await input.references.findByReferenceId(referenceId);
			existingScope = await input.references.findByScope(candidate);
		} catch (error) {
			if (error instanceof HisPaymentReferenceConflictError) {
				report.conflicts += 1;
				issue(medicalOrderId, "mapping_conflict");
			} else {
				report.failed += 1;
				issue(medicalOrderId, "mapping_read_failed");
			}
			continue;
		}
		if (
			[existing, existingScope].some(
				(record) =>
					record &&
					(key(record) !== key(candidate) ||
						(record.receiptId && record.receiptId !== referenceId)),
			)
		) {
			if (existing && key(existing) !== key(candidate))
				quarantineIds.add(referenceId);
			report.conflicts += 1;
			issue(medicalOrderId, "mapping_conflict");
			continue;
		}
		if (
			existing?.status === "confirmed" &&
			existing.receiptId === referenceId
		) {
			report.unchanged += 1;
			continue;
		}
		report.wouldImport += 1;
		prepared.push(candidate);
	}
	if (mode === "dry_run") return report;
	for (const referenceId of quarantineIds) {
		try {
			await input.references.quarantineReferenceId(referenceId);
		} catch {
			report.failed += 1;
			const candidate = staged.find((item) => item.referenceId === referenceId);
			if (candidate)
				issue(candidate.medicalOrderId, "mapping_quarantine_failed");
		}
	}
	for (const candidate of prepared) {
		const { medicalOrderId } = candidate;
		try {
			await input.references.confirm(candidate);
			report.imported += 1;
		} catch (error) {
			if (error instanceof HisPaymentReferenceConflictError) {
				report.conflicts += 1;
				issue(medicalOrderId, "mapping_conflict");
			} else {
				report.failed += 1;
				issue(medicalOrderId, "mapping_write_failed");
			}
		}
	}
	if (initializeNewNumbering) {
		if (report.limitReached)
			report.initializationBlockedReasons.push("scan_limit_reached");
		if (report.failed || report.conflicts)
			report.initializationBlockedReasons.push("mapping_errors");
		if (report.skippedUnknownAttempt)
			report.initializationBlockedReasons.push("unknown_payment_attempts");
		if (report.skippedUnsafeReceipt)
			report.initializationBlockedReasons.push("unverified_success_receipts");
		if (report.skippedMissingContext)
			report.initializationBlockedReasons.push("missing_context");
		if (report.initializationBlockedReasons.length === 0) {
			try {
				await input.references.initializeNewNumbering();
				report.initialization = "completed";
			} catch {
				report.failed += 1;
				report.initializationBlockedReasons.push("initialization_write_failed");
			}
		}
	}
	return report;
}
