import { expect, test } from "bun:test";
import {
	AppointmentCancellationBusyError,
	type MedicalInsuranceOrder,
	type PaymentOrder,
} from "@hospital/domain";
import {
	createInMemoryAppointmentWriteRepository,
	createInMemoryMedicalInsuranceOrderRepository,
	createInMemoryPaymentOrderRepository,
	createNotConfiguredRepositories,
	type MySqlRepositories,
} from "@hospital/persistence";
import { createDefaultApplicationServices } from "./application";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Fixture dependency missing");
	return value;
}

const ownerUserId = "fixture-composition-owner";
const appointmentId = "fixture-composition-appointment";
const context = {
	traceId: "fixture-shared-operation",
	idempotencyKey: "fixture-shared-operation-key",
};
const time = "2026-10-17T08:00:00.000Z";
const medicalOrder: MedicalInsuranceOrder = {
	medicalOrderId: "fixture-composition-medical",
	ownerUserId,
	patientId: "fixture-patient",
	businessType: "registration",
	businessId: appointmentId,
	appointmentId,
	orderType: "RegPay",
	idempotencyKey: "fixture-medical-key",
	medOrgOrd: "fixture-org-order",
	chrgBchno: "fixture-batch",
	payOrdId: "fixture-provider-order",
	payTokenHash: null,
	status: "created",
	ordStas: "0",
	amounts: { totalFen: 1000, cashFen: 1000, personalAccountFen: 0, fundFen: 0 },
	setlType: "ALL",
	revsTokenHash: null,
	revsTokenExpiresAt: null,
	lastError: null,
	version: 1,
	createdAt: time,
	updatedAt: time,
};
const cashOrder: PaymentOrder = {
	orderId: "fixture-composition-cash",
	ownerUserId,
	patientId: "fixture-patient",
	idempotencyKey: `registration-self-pay:${appointmentId}`,
	amounts: { totalFen: 1000, cashFen: 1000, insuranceFen: 0 },
	state: "cash_pending",
	version: 1,
	createdAt: time,
	updatedAt: time,
};

test("真实组合根的挂号资金入口与管理员取消使用同一个持久锁，冲突时不进入服务或 Provider", async () => {
	const appointments = createInMemoryAppointmentWriteRepository();
	const medicalOrders = createInMemoryMedicalInsuranceOrderRepository();
	await medicalOrders.insert(medicalOrder);
	const services = createDefaultApplicationServices({
		repositories: {
			...createNotConfiguredRepositories(),
			appointmentWrites: appointments,
			paymentOrders: createInMemoryPaymentOrderRepository([cashOrder]),
			medicalInsuranceOrders: medicalOrders,
		} as unknown as MySqlRepositories,
	});
	const direct = { ownerUserId, appointmentId, context };
	const medical = {
		ownerUserId,
		orderId: medicalOrder.medicalOrderId,
		context,
	};
	const cash = { ownerUserId, orderId: cashOrder.orderId, context };
	const operations: [string, () => Promise<unknown>][] = [
		[
			"patient cancel",
			() => required(services.appointmentWrites).cancel(direct),
		],
		[
			"cancel refunded",
			() =>
				required(services.appointmentWrites).cancelAfterConfirmedSelfPayRefund(
					direct,
				),
		],
		[
			"authorize",
			() =>
				required(services.medicalInsurance).authorize({
					...direct,
					authCode: "fixture-auth-code",
				}),
		],
		["upload", () => required(services.medicalInsurance).uploadFees(medical)],
		["cashier", () => required(services.medicalInsurance).cashier(medical)],
		["settle", () => required(services.medicalInsurance).settle(medical)],
		["medical query", () => required(services.medicalInsurance).query(medical)],
		[
			"medical cancel",
			() =>
				required(services.medicalInsurance).cancel({
					...medical,
					reason: "reauthorization",
				}),
		],
		["wechat create", () => services.wechatPrepay.create(cash)],
		[
			"wechat read",
			() =>
				services.wechatPrepay.read({
					...cash,
					idempotencyKey: context.idempotencyKey,
				}),
		],
		["wechat reconcile", () => services.wechatPrepay.reconcile(cash)],
		["wechat close", () => services.wechatPrepay.cancel(cash)],
		[
			"split create",
			() => required(services.medicalInsuranceWechatPayment).create(medical),
		],
		[
			"split query",
			() => required(services.medicalInsuranceWechatPayment).query(medical),
		],
		[
			"plugin create",
			() => required(services.medicalInsurancePluginPayment).create(medical),
		],
		[
			"plugin query",
			() => required(services.medicalInsurancePluginPayment).query(medical),
		],
		[
			"self create",
			() => required(services.registrationSelfPay).create(direct),
		],
		["self query", () => required(services.registrationSelfPay).query(direct)],
		[
			"patient exit",
			() =>
				required(services.registrationPaymentExit).abandon({
					...direct,
					mode: "auto",
				}),
		],
	];
	let release!: () => void;
	let acquired!: () => void;
	const held = new Promise<void>((resolve) => {
		acquired = resolve;
	});
	const waiting = new Promise<void>((resolve) => {
		release = resolve;
	});
	const operation = required(appointments.withCancellationLock)(
		ownerUserId,
		appointmentId,
		async () => {
			acquired();
			await waiting;
		},
	);
	await held;
	try {
		for (const [name, run] of operations) {
			let error: unknown;
			try {
				await run();
			} catch (caught) {
				error = caught;
			}
			expect(error, name).toBeInstanceOf(AppointmentCancellationBusyError);
		}
	} finally {
		release();
		await operation;
	}
});
