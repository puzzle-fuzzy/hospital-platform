import { expect, test } from "bun:test";
import {
	type MedicalInsuranceRefund,
	MedicalInsuranceRefundAmountExceededError,
	type WechatRefund,
	WechatRefundAmountExceededError,
} from "@hospital/domain";
import type { Pool } from "mysql2/promise";
import { createMySqlRepositories } from "./mysql-repositories";
import {
	createInMemoryMedicalInsuranceRefundRepository,
	createInMemoryRefundReservationContext,
	createInMemoryWechatRefundRepository,
} from "./repositories";

const time = "2026-10-15T08:00:00.000Z";
const cap = { cashFen: 300, personalAccountFen: 200, fundFen: 500 };
function medical(
	id: string,
	overrides: Partial<MedicalInsuranceRefund> = {},
): MedicalInsuranceRefund {
	return {
		refundId: `medical-${id}`,
		medicalOrderId: "order-test",
		ownerUserId: "owner-test",
		payOrdId: "pay-test",
		refundNo: `refund-${id}`,
		idempotencyKey: `key-${id}`,
		refundType: "HI",
		totalFen: 700,
		cashFen: 0,
		personalAccountFen: 200,
		fundFen: 500,
		medicalStatus: "requested",
		medicalRefStatus: null,
		medicalProviderRequestId: null,
		wechatStatus: "not_required",
		wechatMerchantRefundNo: null,
		status: "requested",
		lastErrorCode: null,
		version: 1,
		createdAt: time,
		updatedAt: time,
		...overrides,
	};
}
function cash(id: string, refundFen = 300): WechatRefund {
	return {
		refundRecordId: `cash-${id}`,
		source: "medical_insurance",
		sourceOrderId: "order-test",
		outTradeNo: "out-test",
		merchantRefundNo: `cash-refund-${id}`,
		idempotencyKey: `cash-key-${id}`,
		totalFen: 300,
		refundFen,
		reason: null,
		status: "requested",
		providerStatus: null,
		providerRefundId: null,
		providerTransactionId: null,
		providerRequestId: null,
		successTime: null,
		lastErrorCode: null,
		version: 1,
		createdAt: time,
		updatedAt: time,
	};
}
test("医保 reserve 按分量累计，允许合法部分退款；并发 ALL/HI 只有一笔占用医保", async () => {
	const repo = createInMemoryMedicalInsuranceRefundRepository();
	await repo.reserve(
		medical("part1", { totalFen: 250, personalAccountFen: 50, fundFen: 200 }),
		cap,
	);
	await repo.reserve(
		medical("part2", { totalFen: 450, personalAccountFen: 150, fundFen: 300 }),
		cap,
	);
	await expect(
		repo.reserve(
			medical("overflow", { totalFen: 1, personalAccountFen: 0, fundFen: 1 }),
			cap,
		),
	).rejects.toBeInstanceOf(MedicalInsuranceRefundAmountExceededError);
	const concurrent = createInMemoryMedicalInsuranceRefundRepository();
	const results = await Promise.allSettled([
		concurrent.reserve(medical("hi"), cap),
		concurrent.reserve(
			medical("all", {
				refundType: "ALL",
				totalFen: 1000,
				cashFen: 300,
				wechatStatus: "requested",
				wechatMerchantRefundNo: "all-cash",
			}),
			cap,
		),
	]);
	expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
	expect(await concurrent.listByMedicalOrderId("order-test")).toHaveLength(1);
});
test("未知和本地失败360221保持占用，明确渠道FAIL释放医保分量", async () => {
	for (const failure of [
		{
			medicalStatus: "unknown",
			medicalRefStatus: "EXP",
			status: "manual_review",
		},
		{
			medicalStatus: "failed",
			medicalRefStatus: null,
			status: "failed",
			lastErrorCode: "360221",
		},
	] as const) {
		const repo = createInMemoryMedicalInsuranceRefundRepository([
			medical("prior", failure),
		]);
		await expect(repo.reserve(medical("next"), cap)).rejects.toBeInstanceOf(
			MedicalInsuranceRefundAmountExceededError,
		);
	}
	const released = createInMemoryMedicalInsuranceRefundRepository([
		medical("explicit-fail", {
			medicalStatus: "failed",
			medicalRefStatus: "FAIL",
			status: "failed",
		}),
	]);
	expect((await released.reserve(medical("next"), cap)).status).toBe(
		"inserted",
	);
});
test("两张台账共享现金预算，旧ALL现金只能由相同商户退款身份承接", async () => {
	const shared = createInMemoryRefundReservationContext();
	const mi = createInMemoryMedicalInsuranceRefundRepository([], shared);
	const wx = createInMemoryWechatRefundRepository([], shared);
	await mi.reserve(
		medical("all", {
			refundType: "ALL",
			totalFen: 1000,
			cashFen: 300,
			wechatStatus: "requested",
			wechatMerchantRefundNo: "same-original-cash",
		}),
		cap,
	);
	await expect(wx.reserve(cash("different"))).rejects.toBeInstanceOf(
		WechatRefundAmountExceededError,
	);
	await expect(
		wx.reserve({
			...cash("same"),
			merchantRefundNo: "same-original-cash",
			refundFen: 200,
		}),
	).rejects.toThrow();
	expect(
		(
			await wx.reserve({
				...cash("same"),
				merchantRefundNo: "same-original-cash",
			})
		).status,
	).toBe("inserted");
	const reverseShared = createInMemoryRefundReservationContext();
	const reverseWx = createInMemoryWechatRefundRepository([], reverseShared);
	const reverseMi = createInMemoryMedicalInsuranceRefundRepository(
		[],
		reverseShared,
	);
	await reverseWx.reserve(cash("first"));
	await expect(
		reverseMi.reserve(
			medical("old-all", { refundType: "ALL", totalFen: 1000, cashFen: 300 }),
			cap,
		),
	).rejects.toBeInstanceOf(MedicalInsuranceRefundAmountExceededError);
	expect((await reverseMi.reserve(medical("new-hi"), cap)).status).toBe(
		"inserted",
	);
});
test("负数和不等分量不能通过仓储降低累计预算", async () => {
	const repo = createInMemoryMedicalInsuranceRefundRepository();
	await expect(
		repo.reserve(medical("negative", { personalAccountFen: -1 }), cap),
	).rejects.toBeInstanceOf(MedicalInsuranceRefundAmountExceededError);
	await expect(
		repo.reserve(medical("sum", { totalFen: 699 }), cap),
	).rejects.toBeInstanceOf(MedicalInsuranceRefundAmountExceededError);
});

function fakePool(responses: unknown[]) {
	const statements: string[] = [];
	const values: unknown[][] = [];
	let committed = false;
	let rolledBack = false;
	const execute = async (sql: string, args: unknown[] = []) => {
		statements.push(sql);
		values.push(args);
		return [responses.shift() ?? { affectedRows: 1 }, []];
	};
	const connection = {
		execute,
		beginTransaction: async () => {},
		commit: async () => {
			committed = true;
		},
		rollback: async () => {
			rolledBack = true;
		},
		release: () => {},
	};
	return {
		pool: { execute, getConnection: async () => connection } as unknown as Pool,
		statements,
		values,
		committed: () => committed,
		rolledBack: () => rolledBack,
	};
}
const dbSource = {
	medical_order_id: "order-test",
	owner_user_id: "owner-test",
	pay_ord_id: "pay-test",
	cash_fen: 300,
	personal_account_fen: 200,
	fund_fen: 500,
	wechat_out_trade_no: "out-test",
};
function medicalRow(record: MedicalInsuranceRefund) {
	return {
		refund_id: record.refundId,
		medical_order_id: record.medicalOrderId,
		owner_user_id: record.ownerUserId,
		pay_ord_id: record.payOrdId,
		refund_no: record.refundNo,
		idempotency_key: record.idempotencyKey,
		refund_type: record.refundType,
		total_fen: record.totalFen,
		cash_fen: record.cashFen,
		personal_account_fen: record.personalAccountFen,
		fund_fen: record.fundFen,
		medical_status: record.medicalStatus,
		medical_ref_status: record.medicalRefStatus,
		medical_provider_request_id: record.medicalProviderRequestId,
		wechat_status: record.wechatStatus,
		wechat_merchant_refund_no: record.wechatMerchantRefundNo,
		status: record.status,
		last_error_code: record.lastErrorCode,
		version: record.version,
		created_at: "2026-10-15 08:00:00.000",
		updated_at: "2026-10-15 08:00:00.000",
	};
}
test("MySQL MI/WX首笔退款均先锁同一源订单，再读取跨台账累计预算", async () => {
	const mi = fakePool([[dbSource], [], [], [], [], { affectedRows: 1 }]);
	expect(
		(
			await createMySqlRepositories(mi.pool).medicalInsuranceRefunds.reserve(
				medical("hi"),
				cap,
			)
		).status,
	).toBe("inserted");
	expect(mi.statements[0]).toContain(
		"hp_medical_insurance_orders WHERE medical_order_id = ? FOR UPDATE",
	);
	expect(mi.statements[4]).toContain("hp_wechat_refunds");
	expect(mi.committed()).toBe(true);
	const wx = fakePool([
		[dbSource],
		[],
		[],
		[{ reserved_fen: 0 }],
		[],
		{ affectedRows: 1 },
	]);
	expect(
		(await createMySqlRepositories(wx.pool).wechatRefunds.reserve(cash("cash")))
			.status,
	).toBe("inserted");
	expect(wx.statements[0]).toContain(
		"hp_medical_insurance_orders WHERE medical_order_id = ? FOR UPDATE",
	);
	expect(wx.statements[4]).toContain("hp_medical_insurance_refunds");
	expect(wx.committed()).toBe(true);
});
test("MySQL已占用医保分量或旧ALL现金时事务回滚，无INSERT", async () => {
	const mi = fakePool([
		[dbSource],
		[],
		[],
		[
			medicalRow(
				medical("prior", {
					medicalStatus: "failed",
					status: "failed",
					lastErrorCode: "360221",
				}),
			),
		],
		[],
	]);
	await expect(
		createMySqlRepositories(mi.pool).medicalInsuranceRefunds.reserve(
			medical("next"),
			cap,
		),
	).rejects.toBeInstanceOf(MedicalInsuranceRefundAmountExceededError);
	expect(mi.rolledBack()).toBe(true);
	expect(mi.statements.some((sql) => sql.startsWith("INSERT"))).toBe(false);
	const wx = fakePool([
		[dbSource],
		[],
		[],
		[{ reserved_fen: 0 }],
		[{ cash_fen: 300, wechat_merchant_refund_no: "old-all" }],
	]);
	await expect(
		createMySqlRepositories(wx.pool).wechatRefunds.reserve(cash("next")),
	).rejects.toBeInstanceOf(WechatRefundAmountExceededError);
	expect(wx.rolledBack()).toBe(true);
	expect(wx.statements.some((sql) => sql.startsWith("INSERT"))).toBe(false);
});
test("MySQL退费凭证精确绑定4字段、排除撤销，普通读取TTL规则不变", async () => {
	const state = fakePool([[]]);
	const repo = createMySqlRepositories(state.pool, {
		medicalInsuranceCredentialEncryptionKey: Buffer.alloc(32, 8).toString(
			"base64",
		),
	}).medicalInsuranceCredentials;
	if (!repo.getForRefund) throw new Error("Refund-bound query lookup missing");
	await repo.getForRefund({
		ownerUserId: "owner-test",
		medicalOrderId: "order-test",
		payOrdId: "pay-test",
		purpose: "query",
	});
	expect(state.statements[0]).toContain(
		"owner_user_id = ? AND medical_order_id = ? AND pay_ord_id = ? AND purpose = ?",
	);
	expect(state.statements[0]).toContain("revoked_at IS NULL");
	expect(state.statements[0]).not.toContain("expires_at >");
	expect(state.values[0]).toEqual([
		"owner-test",
		"order-test",
		"pay-test",
		"query",
	]);
});
test("通知恢复扫描只返回成功医保腿并按稳定退款身份排除已入队记录", async () => {
	const state = fakePool([[]]);
	const scan = createMySqlRepositories(state.pool).medicalInsuranceRefunds
		.listAwaitingMedicalNotification;
	if (!scan) throw new Error("Notification recovery scan missing");
	await scan(20);
	expect(state.statements[0]).toContain("medical_status = 'success'");
	expect(state.statements[0]).toContain("medical_ref_status = 'SUCC'");
	expect(state.statements[0]).toContain("NOT EXISTS");
	expect(state.statements[0]).toContain(
		"last_error_code = 'medical-refund-notify-pending' OR NOT EXISTS",
	);
	expect(state.statements[0]).toContain("medical_refund_notify:");
	expect(state.values[0]).toEqual([20]);
});
