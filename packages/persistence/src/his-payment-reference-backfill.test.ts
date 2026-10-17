import { expect, test } from "bun:test";
import {
	HisPaymentReferenceConflictError,
	type MedicalInsurancePluginPaymentState,
	type MedicalInsuranceSettlementContext,
	type PaymentOperationsBackfillQuery,
} from "@hospital/domain";
import {
	type HisPaymentReferenceBackfillInput,
	runHisPaymentReferenceBackfill,
} from "./his-payment-reference-backfill";
import { createInMemoryHisPaymentReferenceRepository } from "./his-payment-references";

function pluginContext(
	receipt = "9223372036854775807",
	state: MedicalInsurancePluginPaymentState = "29_succeeded",
): MedicalInsuranceSettlementContext {
	return {
		businessId: "his-business",
		hospitalId: "hospital-1",
		patientId: "patient-private-marker",
		networkRegister: { secret: "credential-private-marker" },
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		plugin: {
			paymentOrderId: "payment-1",
			payingId: "11",
			tradingId: "12",
			payTypeId: "5033",
			payType: "CREDIT",
			workStationId: "",
			tradeCode: "trade",
			tradeTypeCode: "10",
			outTradeNo: "out-trade",
			recordCode: "record",
			thirdPartPayRecordId: receipt,
			state,
			thirdPartPayRawResponse: "raw-response-private-marker",
		},
	};
}

function cashContext(
	receipt = "9007199254740993",
): MedicalInsuranceSettlementContext {
	const { plugin: _plugin, ...context } = pluginContext();
	return {
		...context,
		postPaymentComponents: [
			{
				componentId: "cash-1",
				kind: "wechat_cash",
				totalFen: 100,
				amountFen: 100,
				payModel: "H5",
				payTypeId: "5033",
				recordCode: "cash-record",
				state: "succeeded",
				attempts: 1,
				updatedAt: "2026-10-15T00:00:00.000Z",
			},
		],
		selfPayThirdPartyWriteback: {
			attemptedAt: "2026-10-15T00:00:00.000Z",
			status: "succeeded",
			thirdPartPayRecordId: receipt,
		},
	};
}

function fixture(
	contexts: Record<string, MedicalInsuranceSettlementContext | undefined>,
	references = createInMemoryHisPaymentReferenceRepository(),
) {
	const orders = Object.keys(contexts)
		.sort()
		.map((medicalOrderId) => ({
			medicalOrderId,
			ownerUserId: "owner-1",
			createdAt: "2026-10-15T00:00:00.000Z",
		}));
	const queries: PaymentOperationsBackfillQuery[] = [];
	const contextReads: string[] = [];
	const input: HisPaymentReferenceBackfillInput = {
		references,
		listOrders: async (query) => {
			queries.push(query);
			return orders
				.filter(
					(order) =>
						(!query.createdFrom || order.createdAt >= query.createdFrom) &&
						(!query.createdTo || order.createdAt < query.createdTo) &&
						(!query.afterCreatedAt ||
							order.createdAt > query.afterCreatedAt ||
							(order.createdAt === query.afterCreatedAt &&
								order.medicalOrderId > (query.afterSourceOrderId ?? ""))),
				)
				.slice(0, query.limit);
		},
		getSettlementContext: async (owner, id) => {
			expect(owner).toBe("owner-1");
			contextReads.push(id);
			return contexts[id];
		},
	};
	return { input, references, orders, queries, contextReads };
}

test("默认 dry-run 无写入，只统计可信成功回执，不输出解密内容或编号", async () => {
	const data = fixture({
		"order-1": pluginContext(),
		"order-2": cashContext(),
	});
	let writes = 0;
	data.input.references = {
		findByReferenceId: data.references.findByReferenceId,
		findByScope: data.references.findByScope,
		initializeNewNumbering: data.references.initializeNewNumbering,
		quarantineReferenceId: data.references.quarantineReferenceId,
		confirm: async () => {
			writes++;
			throw new Error("must not write in dry-run");
		},
	};
	const report = await runHisPaymentReferenceBackfill(data.input);
	expect(report).toMatchObject({
		mode: "dry_run",
		scannedOrders: 2,
		eligibleReferences: 2,
		wouldImport: 2,
		imported: 0,
		conflicts: 0,
		failed: 0,
	});
	expect(writes).toBe(0);
	expect(data.contextReads).toEqual(["order-1", "order-2"]);
	const output = JSON.stringify(report);
	for (const marker of [
		"patient-private-marker",
		"credential-private-marker",
		"raw-response-private-marker",
		"9223372036854775807",
		"9007199254740993",
		"owner-1",
	])
		expect(output).not.toContain(marker);
});

test.each(["29_succeeded", "15_succeeded", "settled"] as const)(
	"apply 导入 plugin %s 的数字历史回执，重跑不改号",
	async (state) => {
		const data = fixture({
			"order-1": pluginContext("9223372036854775807", state),
		});
		const first = await runHisPaymentReferenceBackfill({
			...data.input,
			mode: "apply",
		});
		expect(first).toMatchObject({ imported: 1, failed: 0, conflicts: 0 });
		const stored = await data.references.findByReferenceId(
			"9223372036854775807",
		);
		expect(stored).toMatchObject({
			ownerUserId: "owner-1",
			medicalOrderId: "order-1",
			paymentScopeId: "payment-1",
			source: "plugin",
			status: "confirmed",
			receiptId: "9223372036854775807",
		});
		const again = await runHisPaymentReferenceBackfill({
			...data.input,
			mode: "apply",
		});
		expect(again).toMatchObject({ imported: 0, unchanged: 1, wouldImport: 0 });
		expect(
			(await data.references.findByReferenceId("9223372036854775807"))
				?.referenceId,
		).toBe(stored?.referenceId);
	},
);

test("cash 分项与 plugin 不同成功回执可分别绑定原支付记录", async () => {
	const combined = { ...cashContext(), plugin: pluginContext().plugin };
	const data = fixture({
		"order-1": combined as MedicalInsuranceSettlementContext,
	});
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({ imported: 2, conflicts: 0 });
	expect(
		await data.references.findByReferenceId("9007199254740993"),
	).toMatchObject({
		medicalOrderId: "order-1",
		paymentScopeId: "cash-1",
		source: "component",
	});
});

test("plugin .29 attempt 结果未知即使有数字回执及成功状态也不能导入", async () => {
	const context = pluginContext();
	if (!context.plugin) throw new Error("missing plugin fixture");
	context.plugin.thirdPartPayAttempt = {
		attemptedAt: "2026-10-15T00:00:00Z",
		status: "unknown",
	};
	const data = fixture({ "order-1": context });
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({
		imported: 0,
		eligibleReferences: 0,
		skippedUnknownAttempt: 1,
	});
	expect(report.issues).toEqual([
		{ medicalOrderId: "order-1", reason: "unknown_third_party_attempt" },
	]);
});

test("UUID、越界和未成功的历史回执只跳过，不强转或分配外部编号", async () => {
	const unknownCash = cashContext("321");
	if (unknownCash.selfPayThirdPartyWriteback)
		unknownCash.selfPayThirdPartyWriteback.status = "unknown";
	const pendingCash = cashContext("322");
	if (pendingCash.postPaymentComponents?.[0])
		pendingCash.postPaymentComponents[0].state = "pending";
	const data = fixture({
		"order-1": pluginContext("123e4567-e89b-12d3-a456-426614174000"),
		"order-2": pluginContext("9223372036854775808"),
		"order-3": pluginContext("1", "cash_paid"),
		"order-4": pluginContext("2", "prepay_ready"),
		"order-5": unknownCash,
		"order-6": pendingCash,
		"order-7": undefined,
	});
	let writes = 0;
	data.input.references = {
		findByReferenceId: data.references.findByReferenceId,
		findByScope: data.references.findByScope,
		initializeNewNumbering: data.references.initializeNewNumbering,
		quarantineReferenceId: data.references.quarantineReferenceId,
		confirm: async () => {
			writes++;
			throw new Error("must not confirm skipped facts");
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({
		imported: 0,
		eligibleReferences: 0,
		skippedNonNumericReceipt: 2,
		skippedNoSuccessfulReceipt: 1,
		skippedUnknownAttempt: 2,
		conflicts: 1,
		skippedMissingContext: 1,
	});
	expect(writes).toBe(0);
});

test.each(["dry_run", "apply"] as const)(
	"%s 跨批次相同回执属于不同 scope 时两笔都拒绝绑定",
	async (mode) => {
		const data = fixture({
			"order-1": pluginContext("12345"),
			"order-2": cashContext("12345"),
		});
		const report = await runHisPaymentReferenceBackfill({
			...data.input,
			mode,
			batchSize: 1,
		});
		expect(report).toMatchObject({
			scannedOrders: 2,
			conflicts: 2,
			wouldImport: 0,
			imported: 0,
		});
		expect(report.issues).toEqual([
			{ medicalOrderId: "order-1", reason: "mapping_conflict" },
			{ medicalOrderId: "order-2", reason: "mapping_conflict" },
		]);
		expect(await data.references.findByReferenceId("12345")).toBeUndefined();
	},
);

test("已存在的其他 scope 别名不会被历史回填覆盖", async () => {
	const data = fixture({ "order-1": pluginContext("12345") });
	await data.references.confirm({
		ownerUserId: "owner-2",
		medicalOrderId: "other-order",
		paymentScopeId: "other-payment",
		source: "plugin",
		referenceId: "12345",
	});
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({ conflicts: 1, imported: 0 });
	await expect(
		data.references.findByReferenceId("12345"),
	).rejects.toBeInstanceOf(HisPaymentReferenceConflictError);
	expect(
		await data.references.findByScope({
			ownerUserId: "owner-2",
			medicalOrderId: "other-order",
			paymentScopeId: "other-payment",
			source: "plugin",
		}),
	).toMatchObject({ medicalOrderId: "other-order", receiptId: "12345" });
});

test("并发确认冲突和异常只报告固定原因，不输出底层错误", async () => {
	const data = fixture({
		"order-1": pluginContext("10"),
		"order-2": pluginContext("11"),
		"order-3": pluginContext("12"),
	});
	data.input.references = {
		findByScope: data.references.findByScope,
		initializeNewNumbering: data.references.initializeNewNumbering,
		quarantineReferenceId: data.references.quarantineReferenceId,
		findByReferenceId: async (id) => {
			if (id === "12") throw new Error("secret-read-error");
			return undefined;
		},
		confirm: async ({ referenceId }) => {
			if (referenceId === "10") throw new HisPaymentReferenceConflictError();
			throw new Error("secret-write-error");
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({ conflicts: 1, failed: 2, imported: 0 });
	expect(report.issues.map((item) => item.reason)).toEqual([
		"mapping_read_failed",
		"mapping_conflict",
		"mapping_write_failed",
	]);
	expect(JSON.stringify(report)).not.toContain("secret-");
});

test("时间边界采用下含上不含，并按创建时间和 ID 推进有界游标", async () => {
	const data = fixture({
		"order-1": pluginContext("10"),
		"order-2": pluginContext("11"),
		"order-3": pluginContext("12"),
	});
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		batchSize: 1,
		maxOrders: 2,
		createdFrom: "2026-10-15T08:00:00+08:00",
		createdTo: "2026-10-15T00:00:01Z",
	});
	expect(report).toMatchObject({
		scannedOrders: 2,
		limitReached: true,
		cursor: {
			afterCreatedAt: "2026-10-15T00:00:00.000Z",
			afterSourceOrderId: "order-2",
		},
	});
	expect(data.queries).toHaveLength(2);
	expect(data.queries[0]).toMatchObject({
		createdFrom: "2026-10-15T00:00:00.000Z",
		createdTo: "2026-10-15T00:00:01.000Z",
		limit: 1,
	});
	expect(data.queries[1]).toMatchObject({ afterSourceOrderId: "order-1" });
	const excluded = await runHisPaymentReferenceBackfill({
		...data.input,
		createdTo: "2026-10-15T00:00:00Z",
	});
	expect(excluded.scannedOrders).toBe(0);
});

test("重复或逆序 cursor 在任何写入前终止，不会卡住", async () => {
	const data = fixture({ "order-1": pluginContext("10") });
	let calls = 0;
	let writes = 0;
	data.input.listOrders = async () => {
		calls++;
		return data.orders;
	};
	data.input.references = {
		findByReferenceId: data.references.findByReferenceId,
		findByScope: data.references.findByScope,
		initializeNewNumbering: data.references.initializeNewNumbering,
		quarantineReferenceId: data.references.quarantineReferenceId,
		confirm: async () => {
			writes++;
			throw new Error("source must be validated before writes");
		},
	};
	await expect(
		runHisPaymentReferenceBackfill({
			...data.input,
			mode: "apply",
			batchSize: 1,
		}),
	).rejects.toThrow("cursor is not strictly increasing");
	expect(calls).toBe(2);
	expect(writes).toBe(0);
});

test("失控 source 返回过量或越界行时在解密和写入前终止", async () => {
	const data = fixture({
		"order-1": pluginContext("10"),
		"order-2": pluginContext("11"),
	});
	data.input.listOrders = async () => data.orders;
	await expect(
		runHisPaymentReferenceBackfill({ ...data.input, batchSize: 1 }),
	).rejects.toThrow("batch limit");
	await expect(
		runHisPaymentReferenceBackfill({
			...data.input,
			createdTo: "2026-10-15T00:00:00Z",
		}),
	).rejects.toThrow("outside time bounds");
	expect(data.contextReads).toHaveLength(0);
});

test("maxOrders 最后一批缩小 limit，默认及显式配置都有上限", async () => {
	const data = fixture({
		"order-1": undefined,
		"order-2": undefined,
		"order-3": undefined,
		"order-4": undefined,
	});
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		batchSize: 2,
		maxOrders: 3,
	});
	expect(report.scannedOrders).toBe(3);
	expect(data.queries.map((query) => query.limit)).toEqual([2, 1]);
	for (const options of [
		{ batchSize: 0 },
		{ batchSize: 1001 },
		{ batchSize: 1.5 },
		{ maxOrders: 0 },
		{ maxOrders: 100001 },
		{ maxOrders: Number.POSITIVE_INFINITY },
		{ createdFrom: "2026-10-15" },
		{ createdFrom: "2026-02-31T00:00:00Z" },
		{ createdFrom: "2026-10-16T00:00:00Z", createdTo: "2026-10-15T00:00:00Z" },
	]) {
		await expect(
			runHisPaymentReferenceBackfill({ ...data.input, ...options }),
		).rejects.toThrow();
	}
});

test("诊断明细最多 100 条，解密失败只统计固定原因", async () => {
	const data = fixture(
		Object.fromEntries(
			Array.from({ length: 105 }, (_, i) => [
				`order-${String(i).padStart(3, "0")}`,
				undefined,
			]),
		),
	);
	data.input.getSettlementContext = async () => {
		throw new Error("private decrypted context");
	};
	const report = await runHisPaymentReferenceBackfill(data.input);
	expect(report).toMatchObject({ scannedOrders: 105, failed: 105 });
	expect(report.issues).toHaveLength(100);
	expect(
		report.issues.every((entry) => entry.reason === "context_read_failed"),
	).toBeTrue();
	expect(JSON.stringify(report)).not.toContain("private");
});

test("多个成功现金 component 的同一回写事实存在歧义，不猜测支付记录", async () => {
	const context = cashContext();
	const component = context.postPaymentComponents?.[0];
	if (!component) throw new Error("missing fixture");
	context.postPaymentComponents = [
		component,
		{ ...component, componentId: "cash-2" },
	];
	const data = fixture({ "order-1": context });
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report).toMatchObject({ imported: 0, conflicts: 1 });
	expect(report.issues[0]?.reason).toBe("ambiguous_cash_component");
});

test("历史 A=2/B=1 的导入只注册真实回执，预演与执行不受内部编号顺序影响", async () => {
	const dryData = fixture({
		"order-a": pluginContext("2"),
		"order-b": pluginContext("1"),
	});
	const dry = await runHisPaymentReferenceBackfill(dryData.input);
	expect(dry).toMatchObject({ wouldImport: 2, conflicts: 0, imported: 0 });
	const applyData = fixture({
		"order-a": pluginContext("2"),
		"order-b": pluginContext("1"),
	});
	const applied = await runHisPaymentReferenceBackfill({
		...applyData.input,
		mode: "apply",
	});
	expect(applied).toMatchObject({ wouldImport: 2, conflicts: 0, imported: 2 });
	expect(await applyData.references.findByReferenceId("1")).toMatchObject({
		medicalOrderId: "order-b",
		receiptId: "1",
	});
	expect(await applyData.references.findByReferenceId("2")).toMatchObject({
		medicalOrderId: "order-a",
		receiptId: "2",
	});
	const again = await runHisPaymentReferenceBackfill({
		...applyData.input,
		mode: "apply",
	});
	expect(again).toMatchObject({ unchanged: 2, conflicts: 0, imported: 0 });
});

test.each(["dry_run", "apply"] as const)(
	"%s 预检同一 scope 已有其他回执的冲突且不尝试改绑",
	async (mode) => {
		const data = fixture({ "order-1": pluginContext("11") });
		await data.references.confirm({
			ownerUserId: "owner-1",
			medicalOrderId: "order-1",
			paymentScopeId: "payment-1",
			source: "plugin",
			referenceId: "10",
		});
		let writes = 0;
		data.input.references = {
			findByReferenceId: data.references.findByReferenceId,
			findByScope: data.references.findByScope,
			initializeNewNumbering: data.references.initializeNewNumbering,
			quarantineReferenceId: data.references.quarantineReferenceId,
			confirm: async () => {
				writes++;
				throw new Error("scope conflict must be detected before write");
			},
		};
		const report = await runHisPaymentReferenceBackfill({
			...data.input,
			mode,
		});
		expect(report).toMatchObject({
			wouldImport: 0,
			imported: 0,
			conflicts: 1,
			failed: 0,
		});
		expect(writes).toBe(0);
		expect((await data.references.findByReferenceId("10"))?.receiptId).toBe(
			"10",
		);
		expect(await data.references.findByReferenceId("11")).toBeUndefined();
	},
);

test("apply 在任何写入前完成所有 scope 的只读预检", async () => {
	const data = fixture({
		"order-a": pluginContext("20"),
		"order-b": pluginContext("21"),
	});
	const operations: string[] = [];
	data.input.references = {
		findByReferenceId: data.references.findByReferenceId,
		initializeNewNumbering: data.references.initializeNewNumbering,
		quarantineReferenceId: data.references.quarantineReferenceId,
		findByScope: async (scope) => {
			operations.push(`read:${scope.medicalOrderId}`);
			return data.references.findByScope(scope);
		},
		confirm: async (scope) => {
			operations.push(`write:${scope.medicalOrderId}`);
			return data.references.confirm(scope);
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
	});
	expect(report.imported).toBe(2);
	expect(operations).toEqual([
		"read:order-a",
		"read:order-b",
		"write:order-a",
		"write:order-b",
	]);
});

test("默认预演不初始化新号，完整干净 apply 仅在显式请求后开启门禁", async () => {
	const data = fixture({
		"order-a": pluginContext("2"),
		"order-b": pluginContext("1"),
	});
	let initialized = 0;
	data.input.references = {
		...data.references,
		initializeNewNumbering: async () => {
			initialized++;
		},
	};
	expect(
		(await runHisPaymentReferenceBackfill(data.input)).initialization,
	).toBe("not_requested");
	expect(initialized).toBe(0);
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(report).toMatchObject({
		imported: 2,
		initialization: "completed",
		initializationBlockedReasons: [],
	});
	expect(initialized).toBe(1);
});

test.each([
	{ mode: "dry_run" as const },
	{ mode: "apply" as const, createdFrom: "2026-10-15T00:00:00Z" },
	{ mode: "apply" as const, createdTo: "2026-10-16T00:00:00Z" },
])("初始化不允许预演或窗口扫描 %j，并在读取任何订单前拒绝", async (options) => {
	const data = fixture({ "order-a": pluginContext("2") });
	await expect(
		runHisPaymentReferenceBackfill({
			...data.input,
			...options,
			initializeNewNumbering: true,
		}),
	).rejects.toThrow("unbounded apply scan");
	expect(data.queries).toHaveLength(0);
});

test("达到总量上限或缺失上下文不会初始化新编号", async () => {
	const data = fixture({ "order-a": pluginContext("2"), "order-b": undefined });
	let initialized = 0;
	data.input.references = {
		...data.references,
		initializeNewNumbering: async () => {
			initialized++;
		},
	};
	const limit = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
		maxOrders: 1,
	});
	expect(limit.initialization).toBe("blocked");
	expect(limit.initializationBlockedReasons).toContain("scan_limit_reached");
	const missing = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(missing.initializationBlockedReasons).toContain("missing_context");
	expect(initialized).toBe(0);
});

test.each(["missing", "9223372036854775808", "01", "1e3", "1.0"])(
	"成功但不可信的回执 %s 阻止新号初始化",
	async (receipt) => {
		const context = pluginContext(receipt);
		if (receipt === "missing" && context.plugin)
			delete context.plugin.thirdPartPayRecordId;
		const data = fixture({ "order-a": context });
		let initialized = 0;
		data.input.references = {
			...data.references,
			initializeNewNumbering: async () => {
				initialized++;
			},
		};
		const report = await runHisPaymentReferenceBackfill({
			...data.input,
			mode: "apply",
			initializeNewNumbering: true,
		});
		expect(report).toMatchObject({
			initialization: "blocked",
			skippedUnsafeReceipt: 1,
			imported: 0,
		});
		expect(report.initializationBlockedReasons).toContain(
			"unverified_success_receipts",
		);
		expect(initialized).toBe(0);
	},
);

test.each(["uuid-old-record", "123e4567-e89b-12d3-a456-426614174000"])(
	"明确历史 opaque 标记 %s 不会被强转为数字或阻止完整索引",
	async (receipt) => {
		const data = fixture({ "order-a": pluginContext(receipt) });
		let initialized = 0;
		data.input.references = {
			...data.references,
			initializeNewNumbering: async () => {
				initialized++;
			},
		};
		const report = await runHisPaymentReferenceBackfill({
			...data.input,
			mode: "apply",
			initializeNewNumbering: true,
		});
		expect(report).toMatchObject({
			initialization: "completed",
			skippedNonNumericReceipt: 1,
			skippedUnsafeReceipt: 0,
			imported: 0,
		});
		expect(initialized).toBe(1);
	},
);

test.each([
	"plugin-unknown",
	"legacy-cash-paid",
	"component-unknown",
	"component-failed",
])("结果不明的旧登记 %s 不会初始化新编号", async (kind) => {
	const context = kind.startsWith("component")
		? cashContext()
		: pluginContext();
	if (context.plugin) {
		if (kind === "plugin-unknown")
			context.plugin.thirdPartPayAttempt = {
				attemptedAt: "2026-10-15T00:00:00Z",
				status: "unknown",
			};
		else {
			context.plugin.state = "cash_paid";
			delete context.plugin.thirdPartPayRecordId;
		}
	} else if (context.selfPayThirdPartyWriteback)
		context.selfPayThirdPartyWriteback.status =
			kind === "component-failed" ? "failed" : "unknown";
	const data = fixture({ "order-a": context });
	let initialized = 0;
	data.input.references = {
		...data.references,
		initializeNewNumbering: async () => {
			initialized++;
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(report).toMatchObject({
		initialization: "blocked",
		skippedUnknownAttempt: 1,
		imported: 0,
	});
	expect(report.initializationBlockedReasons).toContain(
		"unknown_payment_attempts",
	);
	expect(initialized).toBe(0);
});

test("冲突或索引读取失败阻止初始化门禁", async () => {
	const data = fixture({
		"order-a": pluginContext("20"),
		"order-b": pluginContext("20"),
	});
	let initialized = 0;
	data.input.references = {
		...data.references,
		initializeNewNumbering: async () => {
			initialized++;
		},
	};
	const conflicts = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(conflicts.initializationBlockedReasons).toContain("mapping_errors");
	data.input.references.findByScope = async () => {
		throw new Error("hidden DB failure");
	};
	const single = fixture({ "order-a": pluginContext("30") }, data.references);
	const failed = await runHisPaymentReferenceBackfill({
		...single.input,
		references: data.input.references,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(failed).toMatchObject({ failed: 1, initialization: "blocked" });
	expect(initialized).toBe(0);
});

test("已隔离的回执在只读预检中报告冲突而不是尝试重绑", async () => {
	const data = fixture({ "order-a": pluginContext("20") });
	let writes = 0;
	data.input.references = {
		...data.references,
		findByReferenceId: async () => {
			throw new HisPaymentReferenceConflictError();
		},
		confirm: async () => {
			writes++;
			throw new Error("quarantined receipt cannot be rebound");
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(report).toMatchObject({
		conflicts: 1,
		failed: 0,
		wouldImport: 0,
		initialization: "blocked",
	});
	expect(writes).toBe(0);
});

test("预存 A/1 后扫描 A/B 同号：dry-run 保持原索引，apply 隔离冲突号并阻断初始化", async () => {
	const data = fixture({
		"order-a": pluginContext("1"),
		"order-b": pluginContext("1"),
	});
	const scope = {
		ownerUserId: "owner-1",
		medicalOrderId: "order-a",
		paymentScopeId: "payment-1",
		source: "plugin" as const,
	};
	await data.references.confirm({ ...scope, referenceId: "1" });
	const dry = await runHisPaymentReferenceBackfill(data.input);
	expect(dry).toMatchObject({ conflicts: 2, wouldImport: 0, imported: 0 });
	expect(await data.references.findByReferenceId("1")).toMatchObject({
		medicalOrderId: "order-a",
	});
	const applied = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(applied).toMatchObject({
		conflicts: 2,
		imported: 0,
		initialization: "blocked",
	});
	await expect(data.references.findByReferenceId("1")).rejects.toBeInstanceOf(
		HisPaymentReferenceConflictError,
	);
	expect(await data.references.findByScope(scope)).toMatchObject({
		medicalOrderId: "order-a",
		receiptId: "1",
	});
});

test("隔离写入失败只报告固定原因，且不会初始化或输出回执", async () => {
	const data = fixture({
		"order-a": pluginContext("20"),
		"order-b": pluginContext("20"),
	});
	data.input.references = {
		...data.references,
		quarantineReferenceId: async () => {
			throw new Error("secret quarantine failure");
		},
	};
	const report = await runHisPaymentReferenceBackfill({
		...data.input,
		mode: "apply",
		initializeNewNumbering: true,
	});
	expect(report).toMatchObject({
		failed: 1,
		conflicts: 2,
		initialization: "blocked",
	});
	expect(
		report.issues.some((issue) => issue.reason === "mapping_quarantine_failed"),
	).toBe(true);
	expect(JSON.stringify(report)).not.toContain("secret");
});
