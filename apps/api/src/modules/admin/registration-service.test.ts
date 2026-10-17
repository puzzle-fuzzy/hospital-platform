import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { ProviderRequestError } from "@hospital/adapters";
import {
	AppointmentCancellationBusyError,
	type AppointmentRecord,
	type AppointmentRecordProviderReference,
	type AppointmentRegistration,
	buildMedicalInsuranceOrderOperationsProjection,
	type MedicalInsuranceOrder,
	type MedicalInsuranceRefund,
	type MedicalInsuranceSettlementContext,
	type PaymentOperatorAudit,
	type PaymentOrder,
	type PaymentSyncTask,
	type RegistrationSelfPaySettlementContext,
	type WechatRefund,
} from "@hospital/domain";
import { RegistrationPaymentExitInputError } from "../payments/registration-payment-exit-service";
import {
	AdminRegistrationInputError,
	AdminRegistrationNotFoundError,
	AdminRegistrationService,
	type AdminRegistrationServiceDependencies,
	AdminRegistrationUnavailableError,
} from "./registration-service";

const instant = "2026-10-17T04:00:00.000Z";
const context = {
	traceId: "fixture-admin-registration",
	idempotencyKey: "fixture-cancellation",
};
const operatorRef = `admin-session:${"a".repeat(40)}`;
const input = {
	source: "payment_order" as const,
	orderId: "fixture-self-order",
};
const command = { ...input, context, operatorRef, reason: "用户要求取消挂号" };

function appointment(): AppointmentRegistration {
	return {
		appointmentId: "fixture-appointment",
		ownerUserId: "fixture-owner",
		patientId: "fixture-patient",
		holdId: "fixture-hold",
		idempotencyKey: "fixture-booking",
		providerAppointmentId: "fixture-private-hospital-appointment",
		providerPatientId: "fixture-private-hospital-patient",
		departmentName: "测试门诊",
		doctorName: "测试医生",
		workDate: "2026-10-17",
		shiftName: "上午",
		sourceSerialNumber: "8",
		totalFen: 1000,
		status: "booked",
		createdAt: instant,
		updatedAt: instant,
	};
}
function cashOrder(): PaymentOrder {
	return {
		orderId: input.orderId,
		ownerUserId: "fixture-owner",
		patientId: "fixture-patient",
		idempotencyKey: "registration-self-pay:fixture-appointment",
		amounts: { totalFen: 1000, insuranceFen: 0, cashFen: 1000 },
		state: "cancelled",
		version: 3,
		createdAt: instant,
		updatedAt: instant,
	};
}
function medicalOrder(): MedicalInsuranceOrder {
	return {
		medicalOrderId: "fixture-medical-order",
		ownerUserId: "fixture-owner",
		patientId: "fixture-patient",
		businessType: "registration",
		businessId: "fixture-appointment",
		appointmentId: "fixture-appointment",
		orderType: "RegPay",
		idempotencyKey: "fixture-medical-key",
		medOrgOrd: "fixture-org-order",
		chrgBchno: "fixture-charge-batch",
		payOrdId: "fixture-insurance-order",
		payTokenHash: null,
		status: "insurance_settled",
		ordStas: "4",
		amounts: {
			totalFen: 1000,
			cashFen: 200,
			personalAccountFen: 0,
			fundFen: 800,
		},
		setlType: "ALL",
		revsTokenHash: null,
		revsTokenExpiresAt: null,
		lastError: null,
		wechatPaymentState: "cash_paid",
		wechatOutTradeNo: "fixture-private-wechat-order",
		version: 6,
		createdAt: instant,
		updatedAt: instant,
	};
}
function refund(orderId = input.orderId, amount = 1000): WechatRefund {
	return {
		refundRecordId: "fixture-refund-record",
		merchantRefundNo: "fixture-refund-original",
		source: "payment_order",
		sourceOrderId: orderId,
		outTradeNo: "fixture-private-wechat-order",
		totalFen: amount,
		refundFen: amount,
		reason: null,
		idempotencyKey: "fixture-original-refund-key",
		status: "success",
		providerStatus: "SUCCESS",
		providerRefundId: "fixture-provider-refund",
		providerTransactionId: "fixture-provider-transaction",
		providerRequestId: "fixture-provider-request",
		successTime: instant,
		lastErrorCode: null,
		version: 3,
		createdAt: instant,
		updatedAt: instant,
	};
}
function medicalRefund(order = medicalOrder()): MedicalInsuranceRefund {
	return {
		refundId: "fixture-medical-refund",
		medicalOrderId: order.medicalOrderId,
		ownerUserId: order.ownerUserId,
		payOrdId: order.payOrdId ?? "fixture-insurance-order",
		refundNo: "fixture-original-medical-refund",
		idempotencyKey: "fixture-medical-refund-key",
		refundType: "HI",
		totalFen: 800,
		cashFen: 0,
		personalAccountFen: 0,
		fundFen: 800,
		medicalStatus: "success",
		medicalRefStatus: "SUCC",
		medicalProviderRequestId: "fixture-refund-request",
		wechatStatus: "not_required",
		wechatMerchantRefundNo: null,
		status: "succeeded",
		lastErrorCode: null,
		version: 2,
		createdAt: instant,
		updatedAt: instant,
	};
}
function medicalContext(cash = 0): MedicalInsuranceSettlementContext {
	return {
		businessId: "fixture-main",
		hospitalId: "fixture-hospital",
		patientId: "fixture-private-hospital-patient",
		networkRegister: {},
		outNetworkSettleMain: {},
		nationalUpDetailList: [],
		upDetailList: [],
		tradeOrderIds: [],
		postPaymentComponents: [
			{
				componentId: "fixture-combined",
				kind: "combined",
				totalFen: 1000,
				amountFen: 1000,
				payModel: "H5",
				payTypeId: "2",
				recordCode: "fixture-original-record",
				state: "succeeded",
				attempts: 1,
				updatedAt: instant,
				payTypeParams: [
					{ kind: "fund", payTypeId: "2", amountFen: 800 },
					...(cash
						? [
								{
									kind: "wechat_cash" as const,
									payTypeId: "5033" as const,
									amountFen: cash,
								},
							]
						: [
								{
									kind: "hospital_reduce" as const,
									payTypeId: "50" as const,
									amountFen: 200,
								},
							]),
				],
			},
		],
	};
}

function fixture() {
	const state = {
		appointment: appointment() as AppointmentRegistration | undefined,
		cash: cashOrder() as PaymentOrder | undefined,
		medical: [] as MedicalInsuranceOrder[],
		cashRefunds: [] as WechatRefund[],
		medicalRefunds: [] as MedicalInsuranceRefund[],
		selfContext: undefined as RegistrationSelfPaySettlementContext | undefined,
		medicalContext: undefined as MedicalInsuranceSettlementContext | undefined,
		task: undefined as PaymentSyncTask | undefined,
		hospitalStatus: "scheduled" as AppointmentRecord["status"],
		needPay: true as boolean | undefined,
		hospitalReferences: undefined as
			| AppointmentRecordProviderReference[]
			| undefined,
		hospitalCalls: 0,
		writes: [] as string[],
		audits: [] as PaymentOperatorAudit[],
		lockCalls: [] as string[],
	};
	const cancelled = async (kind: string) => {
		state.writes.push(kind);
		if (state.appointment) state.appointment.status = "cancelled";
		state.hospitalStatus = "cancelled";
		return {
			appointmentId: "fixture-appointment",
			status: "cancelled" as const,
		};
	};
	let tail = Promise.resolve();
	const dependencies: AdminRegistrationServiceDependencies = {
		appointments: { findRegistration: async () => state.appointment },
		paymentOrders: {
			findById: async () => state.cash,
			findByOwnerAndIdempotencyKey: async () => state.cash,
			getRegistrationSelfPayContext: async () => state.selfContext,
		},
		medicalOrders: {
			findByMedicalOrderId: async (id) =>
				state.medical.find((item) => item.medicalOrderId === id),
			listByOwnerAndBusinessKey: async () => state.medical,
			getSettlementContext: async () => state.medicalContext,
		},
		wechatRefunds: {
			findBySourceAndSourceOrder: async (source, id) =>
				state.cashRefunds.filter(
					(item) => item.source === source && item.sourceOrderId === id,
				),
		},
		medicalRefunds: { listByMedicalOrderId: async () => state.medicalRefunds },
		paymentSync: { findTaskById: async () => state.task },
		audits: {
			append: async (audit) => {
				state.audits.push(audit);
				return audit;
			},
		},
		records: {
			listRecords: async () => {
				state.hospitalCalls++;
				return {
					records: [{ workDate: "2026-10-17", status: state.hospitalStatus }],
					providerRecordReferences: state.hospitalReferences ?? [
						{
							recordIndex: 0,
							providerAppointmentId: "fixture-private-hospital-appointment",
							...(state.needPay !== undefined
								? { needPay: state.needPay }
								: {}),
						},
					],
					trace: {
						provider: "zhongyang",
						operation: "appointment-records",
						requestId: "fixture-hospital-query",
					},
				};
			},
		},
		withCancellationLock: async (owner, id, operation) => {
			state.lockCalls.push(`${owner}:${id}`);
			const previous = tail;
			let release = () => {};
			tail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			try {
				return await operation();
			} finally {
				release();
			}
		},
		directCancel: async () => cancelled("direct"),
		cancelAfterRefund: async () => cancelled("after-refund"),
		cancelUnpaid: async () => cancelled("unpaid-safe-exit"),
		now: () => new Date(instant),
		createId: () => `fixture-audit-${state.audits.length}`,
	};
	return {
		state,
		dependencies,
		service: () => new AdminRegistrationService(dependencies),
	};
}

function refundedSelf(f: ReturnType<typeof fixture>) {
	if (!f.state.cash) throw new Error("Missing cash fixture");
	f.state.cash.state = "completed";
	f.state.cashRefunds = [refund()];
	f.state.selfContext = {
		businessId: "fixture-main",
		payingId: "fixture-payer",
		tradingId: "fixture-trade",
		outTradeNo: "fixture-private-wechat-order",
		outTradeNoSource: "yunhealth_2_6_65_2",
		refundWriteBack: {
			merchantRefundNo: "fixture-refund-original",
			refundFen: 1000,
			syncedAt: instant,
			validationVersion: 1,
		},
	};
	f.state.needPay = false;
}
function refundedMedical(f: ReturnType<typeof fixture>, cash = 0) {
	f.state.cash = undefined;
	f.state.medical = [medicalOrder()];
	f.state.medicalRefunds = [medicalRefund()];
	f.state.medicalContext = medicalContext(cash);
	f.state.needPay = false;
	if (cash)
		f.state.cashRefunds = [
			{ ...refund("fixture-medical-order", cash), source: "medical_insurance" },
		];
	const record = f.state.medicalRefunds[0];
	const order = f.state.medical[0];
	if (!record || !order) throw new Error("Missing medical fixture");
	const aggregate = buildMedicalInsuranceOrderOperationsProjection(
		order,
		undefined,
		f.state.medicalContext,
	)?.aggregate;
	if (!aggregate) throw new Error("Missing projection");
	f.state.task = {
		taskId: `medrefundnotify-${createHash("sha256").update(record.refundNo).digest("hex").slice(0, 40)}`,
		aggregateId: aggregate.aggregateId,
		businessKey: `medical_refund_notify:${record.refundNo}:${Date.parse(instant).toString(36)}:${"a".repeat(43)}`,
		source: "wechat_pay",
		kind: "writeback",
		status: "succeeded",
		attempts: 1,
		maxAttempts: 20,
		nextRunAt: instant,
		claimedUntil: null,
		lastErrorCode: null,
		resultDigest: "b".repeat(64),
		version: 2,
		createdAt: instant,
		updatedAt: instant,
	};
}
const medInput = {
	source: "medical_insurance" as const,
	orderId: "fixture-medical-order",
};

test("local projection is pure local and keeps hospital references private", async () => {
	const f = fixture();
	const result = await f.service().localForOrder(input);
	expect(result.registration).toMatchObject({
		appointmentId: "fixture-appointment",
		localStatus: "booked",
		hospitalStatus: "not_checked",
		checkedAt: null,
		cancellation: { allowed: false },
	});
	expect(f.state.hospitalCalls).toBe(0);
	expect(f.state.audits).toEqual([]);
	expect(f.state.writes).toEqual([]);
	expect(JSON.stringify(result)).not.toContain("fixture-private");
});
test("missing local appointment is explicit and cannot be cancelled", async () => {
	const f = fixture();
	f.state.appointment = undefined;
	expect((await f.service().localForOrder(input)).registration).toMatchObject({
		appointmentId: null,
		localStatus: "not_found",
		cancellation: { allowed: false },
	});
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("live query audits without any cancellation or financial write", async () => {
	const f = fixture();
	const result = await f.service().query({ ...input, context, operatorRef });
	expect(result.registration).toMatchObject({
		hospitalStatus: "scheduled",
		hospitalPaymentStatus: "pending",
		checkedAt: instant,
		cancellation: { allowed: true, mode: "cancel_only" },
	});
	expect(f.state.audits).toHaveLength(1);
	expect(f.state.audits[0]?.action).toBe("registration_status_read");
	expect(f.state.writes).toEqual([]);
	expect(f.state.lockCalls).toEqual([]);
});
test("live cancelled state does not synchronize the local appointment during query", async () => {
	const f = fixture();
	f.state.hospitalStatus = "cancelled";
	expect(
		(await f.service().query({ ...input, context })).registration
			.hospitalStatus,
	).toBe("cancelled");
	expect(f.state.appointment?.status).toBe("booked");
	expect(f.state.writes).toEqual([]);
});
test.each([
	"unknown",
	"registered",
	"completed",
	"missed",
	"stopped",
	"substituted",
	"expired",
] as const)("hospital %s prevents cancellation", async (status) => {
	const f = fixture();
	f.state.hospitalStatus = status;
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("hospital query failure does not become cancellation success", async () => {
	const f = fixture();
	f.dependencies.records = {
		listRecords: async () => {
			throw new Error("private error");
		},
	};
	expect(
		(await f.service().query({ ...input, context })).registration
			.hospitalStatus,
	).toBe("unavailable");
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("matching date or serial number never substitutes for hospital appointment identity", async () => {
	const f = fixture();
	f.state.hospitalReferences = [
		{
			recordIndex: 0,
			providerAppointmentId: "another-appointment",
			needPay: true,
		},
	];
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test.each(["ownerUserId", "patientId", "appointmentId"] as const)(
	"mismatched local %s cannot be operated on",
	async (key) => {
		const f = fixture();
		if (f.state.appointment) f.state.appointment[key] = "another-value";
		await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
			AdminRegistrationNotFoundError,
		);
		expect(f.state.hospitalCalls).toBe(0);
	},
);
test("nonregistration payment source is rejected", async () => {
	const f = fixture();
	if (f.state.cash)
		f.state.cash.idempotencyKey = "outpatient-self-pay:fixture-appointment";
	await expect(f.service().localForOrder(input)).rejects.toBeInstanceOf(
		AdminRegistrationNotFoundError,
	);
});
test("medical outpatient business cannot borrow a registration appointment", async () => {
	const f = fixture();
	f.state.medical = [
		{ ...medicalOrder(), businessType: "outpatient", orderType: "DiagPay" },
	];
	await expect(
		f.service().cancel({ ...command, ...medInput }),
	).rejects.toBeInstanceOf(AdminRegistrationNotFoundError);
});
test("closed original payment can cancel inside durable appointment lock", async () => {
	const f = fixture();
	const result = await f.service().cancel(command);
	expect(result.outcome).toBe("cancelled");
	expect(result.registration.localStatus).toBe("cancelled");
	expect(f.state.writes).toEqual(["direct"]);
	expect(f.state.lockCalls).toEqual(["fixture-owner:fixture-appointment"]);
	expect(
		f.state.audits.some(
			(item) =>
				item.action === "registration_cancel" &&
				item.operatorRef === operatorRef,
		),
	).toBe(true);
	expect(JSON.stringify(f.state.audits)).not.toContain(command.reason);
});
test("unpaid active order uses no-refund safe exit callback", async () => {
	const f = fixture();
	if (f.state.cash) f.state.cash.state = "cash_pending";
	await f.service().cancel(command);
	expect(f.state.writes).toEqual(["unpaid-safe-exit"]);
});
test("a paid race rejected by safe exit never invokes another callback", async () => {
	const f = fixture();
	if (f.state.cash) f.state.cash.state = "cash_pending";
	f.dependencies.cancelUnpaid = async () => {
		throw new Error("payment now paid");
	};
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
	expect(f.state.appointment?.status).toBe("booked");
});
test("already paid selfpay requires refund rather than direct cancel", async () => {
	const f = fixture();
	if (f.state.cash) f.state.cash.state = "completed";
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("fully refunded selfpay recovers only cancellation", async () => {
	const f = fixture();
	refundedSelf(f);
	const before = JSON.stringify(f.state.cashRefunds);
	await f.service().cancel(command);
	expect(f.state.writes).toEqual(["after-refund"]);
	expect(JSON.stringify(f.state.cashRefunds)).toBe(before);
});

test("successful refund against a different original payment amount is rejected", async () => {
	const f = fixture();
	refundedSelf(f);
	const record = f.state.cashRefunds[0];
	if (record) record.totalFen = 2000;
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});

test.each([
	"different_original",
	"missing_original",
	"missing_source",
	"old_wrong_business_code",
])("selfpay original transaction proof rejects %s", async (problem) => {
	const f = fixture();
	refundedSelf(f);
	const saved = f.state.selfContext;
	if (!saved) throw new Error("Missing saved context");
	if (problem === "different_original")
		saved.outTradeNo = "another-original-order";
	if (problem === "missing_original") delete saved.outTradeNo;
	if (problem === "missing_source") delete saved.outTradeNoSource;
	if (problem === "old_wrong_business_code") {
		saved.payTypeId = "5032";
		saved.businessCode = "fixture-private-wechat-order";
	}
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test.each(["version", "merchant", "amount", "missing"])(
	"selfpay refund hospital proof rejects %s",
	async (problem) => {
		const f = fixture();
		refundedSelf(f);
		const marker = f.state.selfContext?.refundWriteBack;
		if (marker) {
			if (problem === "version") delete marker.validationVersion;
			if (problem === "merchant") marker.merchantRefundNo = "another-refund";
			if (problem === "amount") marker.refundFen--;
		}
		if (problem === "missing") f.state.selfContext = undefined;
		await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
			AdminRegistrationUnavailableError,
		);
		expect(f.state.writes).toEqual([]);
	},
);
test("pending extra refund blocks even when one successful record sums to full payment", async () => {
	const f = fixture();
	refundedSelf(f);
	f.state.cashRefunds.push({
		...refund(),
		merchantRefundNo: "another-pending-refund",
		status: "unknown",
	});
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
});
test("medical refund uses proven actual cash zero for hospital reduction", async () => {
	const f = fixture();
	refundedMedical(f);
	await f.service().cancel({ ...command, ...medInput });
	expect(f.state.writes).toEqual(["after-refund"]);
	expect(f.state.cashRefunds).toEqual([]);
});
test("medical real cash requires successful original WeChat refund as well", async () => {
	const f = fixture();
	refundedMedical(f, 200);
	f.state.cashRefunds = [];
	await expect(
		f.service().cancel({ ...command, ...medInput }),
	).rejects.toBeInstanceOf(AdminRegistrationUnavailableError);
	expect(f.state.writes).toEqual([]);
});
test("fully refunded medical and real WeChat cash recovers only cancellation", async () => {
	const f = fixture();
	refundedMedical(f, 200);
	await f.service().cancel({ ...command, ...medInput });
	expect(f.state.writes).toEqual(["after-refund"]);
});

test.each(["wrong_total", "wrong_original", "missing_original"])(
	"medical real cash identity rejects %s",
	async (problem) => {
		const f = fixture();
		refundedMedical(f, 200);
		const record = f.state.cashRefunds[0];
		const order = f.state.medical[0];
		if (problem === "wrong_total" && record) record.totalFen = 1000;
		if (problem === "wrong_original" && record)
			record.outTradeNo = "another-original-payment";
		if (problem === "missing_original" && order) delete order.wechatOutTradeNo;
		await expect(
			f.service().cancel({ ...command, ...medInput }),
		).rejects.toBeInstanceOf(AdminRegistrationUnavailableError);
		expect(f.state.writes).toEqual([]);
	},
);

test("zero actual medical cash does not require a WeChat payment identity", async () => {
	const f = fixture();
	refundedMedical(f);
	const order = f.state.medical[0];
	if (order) delete order.wechatOutTradeNo;
	await f.service().cancel({ ...command, ...medInput });
	expect(f.state.writes).toEqual(["after-refund"]);
});
test("unproven nominal cash cannot pass medical refund eligibility", async () => {
	const f = fixture();
	refundedMedical(f);
	f.state.medicalContext = undefined;
	await expect(
		f.service().cancel({ ...command, ...medInput }),
	).rejects.toBeInstanceOf(AdminRegistrationUnavailableError);
});
test.each([
	"missing",
	"pending",
	"wrong_aggregate",
	"wrong_business",
	"missing_receipt",
])("medical hospital refund notification rejects %s", async (problem) => {
	const f = fixture();
	refundedMedical(f);
	if (problem === "missing") f.state.task = undefined;
	if (f.state.task) {
		if (problem === "pending") f.state.task.status = "pending";
		if (problem === "wrong_aggregate")
			f.state.task.aggregateId = "another-aggregate";
		if (problem === "wrong_business")
			f.state.task.businessKey = "medical_refund_notify:another-refund:abc:def";
		if (problem === "missing_receipt") f.state.task.resultDigest = null;
	}
	await expect(
		f.service().cancel({ ...command, ...medInput }),
	).rejects.toBeInstanceOf(AdminRegistrationUnavailableError);
	expect(f.state.writes).toEqual([]);
});
test("all historical medical orders are inspected, not only latest", async () => {
	const f = fixture();
	f.state.medical = [
		{
			...medicalOrder(),
			status: "awaiting_confirmation",
			medicalOrderId: "fixture-hidden-old-medical",
		},
	];
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("multiple unresolved payment flows are blocked", async () => {
	const f = fixture();
	if (f.state.cash) f.state.cash.state = "cash_pending";
	f.state.medical = [
		{
			...medicalOrder(),
			status: "created",
			payOrdId: null,
			amounts: null,
			wechatPaymentState: "not_started",
		},
	];
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
	expect(f.state.writes).toEqual([]);
});
test("missing all-medical-order query capability fails closed", async () => {
	const f = fixture();
	delete f.dependencies.medicalOrders.listByOwnerAndBusinessKey;
	await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
		AdminRegistrationUnavailableError,
	);
});
test.each(["lock", "audit", "callback"])(
	"missing %s prevents writes",
	async (missing) => {
		const f = fixture();
		if (missing === "lock") delete f.dependencies.withCancellationLock;
		if (missing === "audit") delete f.dependencies.audits;
		if (missing === "callback") delete f.dependencies.directCancel;
		await expect(f.service().cancel(command)).rejects.toBeInstanceOf(
			AdminRegistrationUnavailableError,
		);
		expect(f.state.writes).toEqual([]);
	},
);
test("audit storage failure before cancellation prevents Provider writes", async () => {
	const f = fixture();
	f.dependencies.audits = {
		append: async () => {
			throw new Error("database unavailable");
		},
	};
	await expect(f.service().cancel(command)).rejects.toThrow(
		"database unavailable",
	);
	expect(f.state.writes).toEqual([]);
});
test("busy lock maps to a safe retry message without reading HIS", async () => {
	const f = fixture();
	f.dependencies.withCancellationLock = async () => {
		throw new AppointmentCancellationBusyError();
	};
	await expect(f.service().cancel(command)).rejects.toThrow(
		"该挂号正在处理中，请稍后核对",
	);
	expect(f.state.hospitalCalls).toBe(0);
	expect(f.state.writes).toEqual([]);
});
test("concurrent retries share appointment lock and cancel exactly once", async () => {
	const f = fixture();
	const service = f.service();
	const results = await Promise.all([
		service.cancel(command),
		service.cancel(command),
	]);
	expect(results.map((item) => item.outcome).sort()).toEqual([
		"already_cancelled",
		"cancelled",
	]);
	expect(f.state.writes).toEqual(["direct"]);
});
test("already cancelled hospital result is idempotent without invoking callbacks", async () => {
	const f = fixture();
	f.state.hospitalStatus = "cancelled";
	expect((await f.service().cancel(command)).outcome).toBe("already_cancelled");
	expect(f.state.writes).toEqual([]);
});

test("uncertain cancellation response never claims the original appointment remains active", async () => {
	const f = fixture();
	f.dependencies.directCancel = async () => {
		f.state.hospitalStatus = "cancelled";
		throw new Error("timeout after hospital accepted cancellation");
	};
	await expect(f.service().cancel(command)).rejects.toThrow(
		"取消结果尚未确认，请刷新医院挂号状态后再操作",
	);
	expect(f.state.appointment?.status).toBe("booked");
	expect((await f.service().cancel(command)).outcome).toBe("already_cancelled");
});

test("known hospital business rejection is preserved for the global safe error mapper", async () => {
	const f = fixture();
	const rejection = new ProviderRequestError({
		provider: "zhongyang",
		operation: "appointment-cancellation",
		message: "private raw text",
		retryable: false,
		reason: "appointment-cancellation-rejected",
		providerErrorCode: "fixture-rejected",
	});
	f.dependencies.directCancel = async () => {
		throw rejection;
	};
	await expect(f.service().cancel(command)).rejects.toBe(rejection);
	expect(f.state.audits.at(-1)?.outcome).toBe("failed");
});

test("safe exit payment race returns an actionable fixed message", async () => {
	const f = fixture();
	if (f.state.cash) f.state.cash.state = "cash_pending";
	f.dependencies.cancelUnpaid = async () => {
		throw new RegistrationPaymentExitInputError("private provider details");
	};
	await expect(f.service().cancel(command)).rejects.toThrow(
		"支付状态已变化，请先核对原订单；已付款的请先退费，再取消挂号",
	);
	expect(f.state.writes).toEqual([]);
});
test.each(["", "browser-user", `admin-session:${"g".repeat(40)}`])(
	"untrusted operator reference %s is rejected",
	async (operator) => {
		const f = fixture();
		await expect(
			f.service().cancel({ ...command, operatorRef: operator }),
		).rejects.toBeInstanceOf(AdminRegistrationInputError);
		expect(f.state.lockCalls).toEqual([]);
	},
);
test.each(["", " ", "a", " 一 ", "a".repeat(81), "reason\nwith-control"])(
	"invalid cancellation reason is rejected",
	async (reason) => {
		const f = fixture();
		await expect(
			f.service().cancel({ ...command, reason }),
		).rejects.toBeInstanceOf(AdminRegistrationInputError);
	},
);
