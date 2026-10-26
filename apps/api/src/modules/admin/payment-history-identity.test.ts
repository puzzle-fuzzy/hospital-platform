import { expect, test } from "bun:test";
import type { MedicalInsuranceOrder, PaymentOrder } from "@hospital/domain";
import {
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPaymentOrderRepository,
	createInMemoryWechatRefundRepository,
} from "@hospital/persistence";
import {
	AdminWechatRefundInputError,
	AdminWechatRefundService,
} from "./wechat-refund-service";

const firstIdentity = "11010519900101007X";
const secondIdentity = "110105199001010061";

function payment(
	index: number,
	overrides: Partial<PaymentOrder> = {},
): PaymentOrder {
	return {
		orderId: `payment-search-${index}`,
		ownerUserId: "search-owner-001",
		patientId: `search-patient-${index}`,
		idempotencyKey: `payment-search-key-${index}`,
		amounts: { totalFen: 300, insuranceFen: 0, cashFen: 300 },
		state: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: `2026-09-18T01:${String(index).padStart(2, "0")}:00.000Z`,
		...overrides,
	};
}

function medical(index: number): MedicalInsuranceOrder {
	return {
		medicalOrderId: `medical-search-${index}`,
		ownerUserId: "search-owner-001",
		patientId: `search-patient-${index}`,
		businessType: "outpatient",
		orderType: "DiagPay",
		businessId: `medical-search-business-${index}`,
		idempotencyKey: `medical-search-key-${index}`,
		medOrgOrd: `medical-search-org-${index}`,
		chrgBchno: `medical-search-batch-${index}`,
		payOrdId: null,
		payTokenHash: null,
		status: "cash_pending",
		ordStas: "1",
		amounts: { totalFen: 500, cashFen: 500, personalAccountFen: 0, fundFen: 0 },
		setlType: "CASH",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatOutTradeNo: `medical-search-out-${index}`,
		wechatPaymentState: "cash_paid",
		version: 1,
		createdAt: "2026-09-18T01:00:00.000Z",
		updatedAt: `2026-09-18T01:${String(index).padStart(2, "0")}:00.000Z`,
	};
}

async function fixture(
	options: {
		payments?: readonly PaymentOrder[];
		medicals?: readonly MedicalInsuranceOrder[];
		names?: Readonly<Record<string, string>>;
		contexts?: Readonly<Record<string, unknown>>;
		counts?: readonly [number, number];
		delayIdentities?: boolean;
	} = {},
) {
	const payments = options.payments ?? [payment(1), payment(2), payment(3)];
	const medicals = options.medicals ?? [];
	const paymentOrders = createInMemoryPaymentOrderRepository(payments);
	const medicalInsuranceOrders =
		createInMemoryMedicalInsuranceOrderRepository();
	for (const order of medicals) await medicalInsuranceOrders.insert(order);
	const reads: { owner: string; order: string; source: string }[] = [];
	let activeIdentities = 0;
	let maximumIdentities = 0;
	let patientReads = 0;
	let userReads = 0;
	let listReads = 0;
	const readIdentity = async (owner: string, order: string, source: string) => {
		reads.push({ owner, order, source });
		activeIdentities++;
		maximumIdentities = Math.max(maximumIdentities, activeIdentities);
		if (options.delayIdentities)
			await new Promise((resolve) => setTimeout(resolve, 2));
		activeIdentities--;
		return options.contexts?.[order];
	};
	paymentOrders.getRegistrationSelfPayContext = async (owner, order) =>
		(await readIdentity(owner, order, "payment_order")) as never;
	medicalInsuranceOrders.getSettlementContext = async (owner, order) =>
		(await readIdentity(owner, order, "medical_insurance")) as never;
	if (options.counts) {
		const counts = options.counts;
		paymentOrders.countForAdmin = async () => counts[0];
		medicalInsuranceOrders.countForAdmin = async () => counts[1];
	}
	const listPayment = paymentOrders.listRecentForAdmin;
	const listMedical = medicalInsuranceOrders.listRecentForAdmin;
	if (!listPayment || !listMedical)
		throw new Error("Missing synthetic history ports");
	paymentOrders.listRecentForAdmin = async (input) => {
		listReads++;
		return listPayment(input);
	};
	medicalInsuranceOrders.listRecentForAdmin = async (input) => {
		listReads++;
		return listMedical(input);
	};
	const service = new AdminWechatRefundService({
		refunds: createInMemoryWechatRefundRepository(),
		paymentOrders,
		medicalInsuranceOrders,
		patients: {
			async listByOwner(ownerUserId) {
				patientReads++;
				return [
					...new Set(
						[...payments, ...medicals]
							.filter((order) => order.ownerUserId === ownerUserId)
							.map((order) => order.patientId),
					),
				].map((id) => ({
					id,
					ownerUserId,
					displayName: options.names?.[id] ?? `就诊人-${id}`,
					relationship: "self" as const,
					cardNumberMasked: "未绑定",
					source: "hospital-his" as const,
					clinicalAccess: "ready" as const,
				}));
			},
		},
		userProfiles: {
			async findByUserId(userId) {
				userReads++;
				return {
					userId,
					displayName: `代缴用户-${userId}`,
					gender: "unknown" as const,
					age: null,
					email: null,
					version: 1,
				};
			},
		},
		gateway: {
			async requestRefund() {
				throw new Error("History search must not request refunds");
			},
			async queryRefund() {
				throw new Error("History search must not query Wechat");
			},
		},
	});
	return {
		service,
		reads,
		counters: () => ({ maximumIdentities, patientReads, userReads, listReads }),
	};
}

test("姓名搜索在跨来源排序后分页，统计全部匹配项且支持下单用户代缴", async () => {
	const current = await fixture({
		payments: [payment(1), payment(2), payment(3)],
		medicals: [medical(4)],
		names: {
			"search-patient-1": "同名患者甲",
			"search-patient-2": "其他患者",
			"search-patient-3": "同名患者乙",
			"search-patient-4": "同名患者丙",
		},
	});
	const page = await current.service.listPaymentHistory({
		participantName: "同名患者",
		page: 2,
		pageSize: 1,
	});
	expect(page.total).toBe(3);
	expect(page.page).toBe(2);
	expect(page.items.map((item) => item.orderId)).toEqual(["payment-search-3"]);
	expect(
		(
			await current.service.listPaymentHistory({
				participantName: "代缴用户",
				pageSize: 1,
			})
		).total,
	).toBe(4);
	expect(
		(
			await current.service.listPaymentHistory({
				participantName: "同名患者",
				source: "payment_order",
				pageSize: 1,
			})
		).total,
	).toBe(2);
});

test("身份证从对应来源上下文读取，X大小写一致，姓名与身份证按AND筛选", async () => {
	const current = await fixture({
		payments: [payment(1), payment(2)],
		medicals: [medical(3)],
		names: {
			"search-patient-1": "同名患者",
			"search-patient-2": "同名患者",
			"search-patient-3": "第三位患者",
		},
		contexts: {
			"payment-search-1": {
				certNo: firstIdentity.toLowerCase(),
				openid: "secret-unused",
			},
			"payment-search-2": { certNo: secondIdentity },
			"medical-search-3": {
				networkRegister: { id_no: firstIdentity, certNo: firstIdentity },
			},
		},
	});
	const all = await current.service.listPaymentHistory({
		identityNumber: firstIdentity.toLowerCase(),
		pageSize: 1,
	});
	expect(all.total).toBe(2);
	expect(all.items[0]).toMatchObject({
		orderId: "medical-search-3",
		patientIdentityNumber: firstIdentity,
	});
	const second = await current.service.listPaymentHistory({
		identityNumber: firstIdentity,
		page: 2,
		pageSize: 1,
	});
	expect(second.items[0]?.orderId).toBe("payment-search-1");
	const narrowed = await current.service.listPaymentHistory({
		identityNumber: firstIdentity,
		participantName: "同名患者",
	});
	expect(narrowed.total).toBe(1);
	expect(narrowed.items[0]?.orderId).toBe("payment-search-1");
	expect(JSON.stringify(narrowed)).not.toContain("secret-unused");
	expect(narrowed.items[0]).not.toHaveProperty("orderUserIdentityNumber");
});

test("没有筛选时只读取当前页身份证，搜索复用每订单结果且并发不超过8", async () => {
	const payments = Array.from({ length: 24 }, (_, index) => payment(index + 1));
	const contexts = Object.fromEntries(
		payments.map((order) => [order.orderId, { certNo: firstIdentity }]),
	);
	const current = await fixture({ payments, contexts, delayIdentities: true });
	await current.service.listPaymentHistory({ pageSize: 2 });
	expect(current.reads).toHaveLength(2);
	current.reads.length = 0;
	const page = await current.service.listPaymentHistory({
		identityNumber: firstIdentity,
		pageSize: 2,
	});
	expect(page.total).toBe(24);
	expect(current.reads).toHaveLength(24);
	expect(current.counters().maximumIdentities).toBeLessThanOrEqual(8);
	expect(current.counters().maximumIdentities).toBeGreaterThan(1);
	expect(current.counters().patientReads).toBe(2);
	expect(current.counters().userReads).toBe(2);
});

test("搜索超出候选窗口或计数读取发生变化时明确失败，不静默漏单", async () => {
	const excessive = await fixture({ counts: [10001, 0] });
	await expect(
		excessive.service.listPaymentHistory({ participantName: "患者" }),
	).rejects.toThrow("超过10000条");
	expect(excessive.counters().listReads).toBe(0);
	expect(excessive.reads).toHaveLength(0);
	const changed = await fixture({ counts: [0, 0] });
	await expect(
		changed.service.listPaymentHistory({ identityNumber: firstIdentity }),
	).rejects.toThrow("查询范围已变化");
});

test("缺失、混淆、控制字符与未知证件字段不被当作患者身份证", async () => {
	const current = await fixture({
		payments: [payment(1), payment(2), payment(3)],
		medicals: [medical(4), medical(5), medical(6)],
		contexts: {
			"payment-search-1": {
				idNo: firstIdentity,
				ownerUserIdentityNumber: firstIdentity,
			},
			"payment-search-2": { certNo: `${firstIdentity}\nignored` },
			"payment-search-3": null,
			"medical-search-4": {
				networkRegister: { idNo: firstIdentity, certNo: secondIdentity },
			},
			"medical-search-5": { networkRegister: [{ idNo: firstIdentity }] },
			"medical-search-6": { networkRegister: { idNo: 12345 } },
		},
	});
	const page = await current.service.listPaymentHistory();
	for (const item of page.items)
		expect(item).not.toHaveProperty("patientIdentityNumber");
	expect(
		(
			await current.service.listPaymentHistory({
				identityNumber: firstIdentity,
			})
		).total,
	).toBe(0);
});

test("身份证读取始终绑定来源、owner与订单，不按患者或用户名跨订单借用", async () => {
	const first = payment(1),
		second = payment(2, {
			ownerUserId: "other-search-owner",
			patientId: first.patientId,
		});
	const current = await fixture({
		payments: [first, second],
		contexts: {
			[first.orderId]: { certNo: firstIdentity },
			[second.orderId]: { certNo: secondIdentity },
		},
	});
	const result = await current.service.listPaymentHistory({
		identityNumber: firstIdentity,
	});
	expect(result.items.map((item) => item.orderId)).toEqual([first.orderId]);
	expect(current.reads).toEqual(
		expect.arrayContaining([
			{
				owner: first.ownerUserId,
				order: first.orderId,
				source: "payment_order",
			},
			{
				owner: second.ownerUserId,
				order: second.orderId,
				source: "payment_order",
			},
		]),
	);
});

test("非法姓名与身份证查询在仓储读取前拒绝，旧15位身份证可精确匹配", async () => {
	const current = await fixture({
		payments: [payment(1)],
		contexts: { "payment-search-1": { certNo: "110105900101001" } },
	});
	for (const input of [
		{ participantName: "name\nquery" },
		{ participantName: "x".repeat(65) },
		{ identityNumber: "123" },
		{ identityNumber: "11010519900101007%" },
		{ identityNumber: 17 },
		{ participantName: { text: "patient" } },
	]) {
		await expect(
			current.service.listPaymentHistory(input as never),
		).rejects.toBeInstanceOf(AdminWechatRefundInputError);
	}
	expect(current.counters().listReads).toBe(0);
	expect(
		(
			await current.service.listPaymentHistory({
				identityNumber: "110105900101001",
			})
		).total,
	).toBe(1);
});
